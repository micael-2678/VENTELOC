"""
Étape de vente, facture et relances (docs/venteloc/SPEC.md §7.4, API.md §7).

- Un `closing` est créé à l'acceptation d'une offre d'achat (`create_closing_for_offer`, appelée par server.py, ou
  `POST /closing/from-offer/{offer_id}` pour une offre déjà acceptée) : {property_id, buyer_id, seller_id, offer_id,
  sale_object (bien | parts), expected_date, avant_contrat_on, redacteur (notaire), status} ; ou sans offre acceptée, par
  le vendeur, pour un acquéreur présenté (`POST /closing/direct {property_id, buyer_id}` : `buyer_id` dans
  `presented_buyers`). Les deux parties reçoivent une checklist, renseignent le notaire en charge de la vente
  (`PUT /closing/{id}/redacteur`) et la date de l'avant-contrat (`PUT /closing/{id}/avant-contrat`).
- Relances J+30 / J+60 / J+90 (tâche quotidienne) avec trois réponses en un clic par lien signé
  (`GET /closing/{id}/status/{token}?answer=en_cours|signe|abandonne`).
- Déclaration de la vente = acte authentique signé, par l'une des parties (`POST /closing/{id}/declare`), confirmation par
  l'autre (`POST /closing/{id}/confirm`) ou contestation (`POST /closing/{id}/dispute`) ; confirmation automatique après
  7 jours sans contestation (tâche quotidienne) pour une déclaration du vendeur ou de l'admin seulement ; une déclaration
  de l'acquéreur attend l'accord du vendeur ou l'arbitrage admin (ligne « À faire » à l'échéance).
- Mode test (MODE-TEST.md §2.6) : étape de vente rattachée à une donnée de test → `is_test`, facture
  TEST-FAC-AAAA-NNNNN (compteur `invoice_test`, avoir TEST-AV-… sur `credit_note_test`), mention « DOCUMENT DE TEST —
  SANS VALEUR JURIDIQUE » sur la facture, l'avoir, l'ordre de paiement et la mise en demeure ; le compteur réel n'avance pas.
- À la confirmation : facture FAC-AAAA-NNNNN (compteur continu `next_sequence("invoice")`), débiteur = vendeur,
  « Honoraires de négociation — mandat n° … — vente de {titre} », montant par `business_model.calculate_commission`
  (seule source du barème), échéance acte + 30 jours (et au moins facture + 15 jours), mentions L441-9, PDF
  (`GET /invoices/{id}/pdf`), e-mail au vendeur, ordre de paiement PDF au notaire (`GET /closing/{id}/payment-order.pdf`,
  envoyé par e-mail s'il a une adresse).
- Relances de facture J+15/30/45 ; après la troisième, et une fois l'échéance passée, modèle de mise en demeure
  (`GET /admin/invoices/{id}/mise-en-demeure.pdf`) et ligne « À faire » (db.todos).
- Admin : GET /admin/invoices, PUT /admin/invoices/{id}/paid, PUT /admin/invoices/{id}/cancel, GET /admin/closings,
  PUT /admin/closings/{id}/resolve, GET /admin/todos, PUT /admin/todos/{id}/done.

Statuts d'un closing : in_progress → declared → confirmed (ou disputed → declared / in_progress) ; abandoned.
Statuts d'une facture : issued → paid | cancelled (draft : anciennes factures migrées).
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

import business_model
from business_model import (EMAIL_TEMPLATES, TEST_DOCUMENT_BANNER, fmt_eur_fr, is_test_related, render_email, send_brevo_email,
                            site_name, site_url, test_mode_enabled)
from server import (LEGAL_ENTITY, _parse_dt, claim_once, db, display_name, draw_test_watermark, email_admin, email_user,
                    get_current_user, get_current_user_optional, next_sequence, pdf_test_banner, require_admin)

logger = logging.getLogger("closing")
router = APIRouter()

# ----------------------------------------------------------------------------------------------
# Constantes

STATUS_IN_PROGRESS = "in_progress"
STATUS_DECLARED = "declared"
STATUS_CONFIRMED = "confirmed"
STATUS_DISPUTED = "disputed"
STATUS_ABANDONED = "abandoned"
CLOSING_STATUSES = (STATUS_IN_PROGRESS, STATUS_DECLARED, STATUS_CONFIRMED, STATUS_DISPUTED, STATUS_ABANDONED)
CLOSING_STATUS_LABELS = {
    STATUS_IN_PROGRESS: "Vente en cours",
    STATUS_DECLARED: "Vente déclarée, en attente de confirmation",
    STATUS_CONFIRMED: "Vente confirmée",
    STATUS_DISPUTED: "Déclaration contestée",
    STATUS_ABANDONED: "Vente abandonnée",
}

REDACTEUR_TYPES = ("notaire", "autre")
REDACTEUR_LABELS = {"notaire": "Notaire en charge de la vente", "autre": "Autre notaire"}

SALE_OBJECTS = ("bien", "parts")
SALE_OBJECT_LABELS = {"bien": "vente du bien", "parts": "cession des parts de la société propriétaire"}

FOLLOWUP_DAYS = (30, 60, 90)                      # relances après l'acceptation de l'offre
FOLLOWUP_ANSWERS = {"en_cours": "Toujours en cours", "signe": "Acte signé", "abandonne": "Vente abandonnée"}
CONFIRMATION_DAYS = 7                             # confirmation automatique de la déclaration

# Échéance de la facture : acte authentique + 30 jours, et au moins INVOICE_MIN_DELAY_DAYS jours après la date de facture,
# quel que soit l'objet de la vente (SPEC §7.4) ; le notaire règle les honoraires sur le prix (ordre irrévocable du mandat).
# Relances : en jours après la date de facture, rapprochées de l'échéance quand celle-ci est proche (_reminder_thresholds).
# La mise en demeure est proposée après la troisième relance, une fois l'échéance passée.
INVOICE_MIN_DELAY_DAYS = 15
INVOICE_DUE_DAYS = 30
INVOICE_REMINDER_DAYS = (15, 30, 45)
INVOICE_PAYMENT_TEXT = ("Payable par virement au plus tard 30 jours après la signature de l'acte authentique (mandat, art. 9), et au "
                        f"plus tôt {INVOICE_MIN_DELAY_DAYS} jours après la date de facture : réglée par le notaire en charge de la "
                        "vente sur le prix, en exécution de l'ordre irrévocable donné par le vendeur, ou à défaut par le vendeur.")


def invoice_due_on(signed_on: date, issued_on: date, sale_object: Optional[str] = None) -> date:
    """Échéance contractuelle : acte authentique + 30 jours, jamais moins de 15 jours après la date de facture"""
    return max(signed_on + timedelta(days=INVOICE_DUE_DAYS), issued_on + timedelta(days=INVOICE_MIN_DELAY_DAYS))


def _reminder_thresholds(invoice: dict, issued: date, due: date) -> List[int]:
    """Jours après la facture : barème habituel, ramené à échéance, +15 j, +30 j quand l'échéance est plus proche"""
    to_due = (due - issued).days
    return [min(offset, to_due + 15 * k) for k, offset in enumerate(INVOICE_REMINDER_DAYS)]
REMINDER_LABELS = ("Premier rappel", "Deuxième rappel", "Dernier rappel avant mise en demeure")

INVOICE_ISSUED = "issued"
INVOICE_PAID = "paid"
INVOICE_CANCELLED = "cancelled"
INVOICE_DRAFT = "draft"
# Mode test : numérotation séparée (TEST-FAC-AAAA-NNNNN, TEST-AV-AAAA-NNNNN), supprimée par la purge des données de test
INVOICE_TEST_COUNTER = "invoice_test"
CREDIT_NOTE_TEST_COUNTER = "credit_note_test"

TODO_INVOICE_OVERDUE = "invoice_overdue"
TODO_CLOSING_DISPUTED = "closing_disputed"
TODO_INVOICE_ADDRESS = "invoice_debtor_address"
TODO_PAYMENT_ORDER = "payment_order_to_confirm"
TODO_DECLARATION_UNCONFIRMED = "closing_declaration_unconfirmed"
# Seule une déclaration du vendeur (débiteur des honoraires) ou de l'admin est confirmée automatiquement après 7 jours
AUTO_CONFIRM_DECLARANTS = ("seller", "admin")

LATE_PENALTY_TEXT = ("Pénalités de retard : trois fois le taux d'intérêt légal en vigueur, exigibles de plein droit le jour "
                     "suivant la date d'échéance, sans qu'un rappel soit nécessaire (art. L441-10 du Code de commerce). "
                     "Indemnité forfaitaire pour frais de recouvrement : 40 € (art. D441-5 du Code de commerce). "
                     "Aucun escompte n'est accordé pour paiement anticipé.")


# ----------------------------------------------------------------------------------------------
# Gabarits d'e-mail (ajoutés sans modifier les entrées existantes de business_model)

EMAIL_TEMPLATES.setdefault("closing_checklist", {
    "subject": "Offre acceptée : les prochaines étapes jusqu'à l'acte authentique",
    "html": """
    <h2>L'offre d'achat est acceptée : direction le notaire</h2>
    <p>Bonjour {name},</p>
    <p>L'offre d'achat de <strong>{amount}</strong> pour le bien {property_label} est acceptée. Elle n'emporte pas encore vente : voici les étapes qui mènent à l'acte authentique.</p>
    <ol>
      <li><strong>Notaire</strong> : choisissez le notaire en charge de la vente (chaque partie peut avoir le sien) et renseignez ses coordonnées depuis votre espace : nous lui transmettrons l'ordre de paiement des honoraires prévu au mandat.</li>
      <li><strong>Avant-contrat</strong> : promesse ou compromis de vente signé chez le notaire, avec les conditions suspensives (prêt…), le transfert du bail et du dépôt de garantie. Indiquez sa date dans votre espace.</li>
      <li><strong>Financement</strong> : demande et accord de prêt de l'acquéreur dans les délais de l'avant-contrat.</li>
      <li><strong>Acte authentique</strong> : à la signature chez le notaire, déclarez la vente depuis votre espace (date, prix, objet) ; l'autre partie confirme et la facture d'honoraires est émise au vendeur.</li>
    </ol>
    <p>{site_name} ne négocie pas et ne rédige pas les actes : le notaire et vos conseils vous accompagnent. Nous vous demanderons des nouvelles tous les 30 jours, avec une réponse en un clic.</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("closing_followup", {
    "subject": "Où en est la vente de {property_label} ?",
    "html": """
    <h2>Où en est la vente ?</h2>
    <p>Bonjour {name},</p>
    <p>L'offre d'achat pour le bien {property_label} a été acceptée il y a {days} jours. Où en êtes-vous ? Un seul clic suffit :</p>
    <p>
      <a href="{link_en_cours}">Toujours en cours</a><br>
      <a href="{link_signe}">L'acte authentique est signé</a><br>
      <a href="{link_abandonne}">La vente est abandonnée</a>
    </p>
    <p>Si l'acte authentique est signé, pensez à déclarer la vente depuis votre espace (date, prix) : l'autre partie la confirme et la facture d'honoraires est établie.</p>
    <p>Merci,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("closing_redacteur_set", {
    "subject": "Notaire en charge de la vente renseigné pour {property_label}",
    "html": """
    <h2>Notaire en charge de la vente</h2>
    <p>Bonjour {name},</p>
    <p>{by_label} a renseigné le notaire en charge de la vente de {property_label} : <strong>{redacteur}</strong>.</p>
    <p>Vous pouvez corriger ces coordonnées depuis votre espace. À la confirmation de la vente, l'ordre de paiement des honoraires est adressé au notaire renseigné ou confirmé par le vendeur.</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("closing_avant_contrat", {
    "subject": "Avant-contrat signé pour {property_label}",
    "html": """
    <h2>Avant-contrat enregistré</h2>
    <p>Bonjour {name},</p>
    <p>{by_label} indique que l'avant-contrat (promesse ou compromis de vente) de {property_label} a été signé le <strong>{avant_contrat_on}</strong>.</p>
    <p>Prochaine étape : la signature de l'acte authentique chez le notaire, à déclarer ensuite depuis votre espace.</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("closing_declared_to_confirm", {
    "subject": "Vente déclarée : merci de confirmer sous 7 jours",
    "html": """
    <h2>Une vente a été déclarée</h2>
    <p>Bonjour {name},</p>
    <p>{by_label} a déclaré la vente du bien {property_label} : acte authentique signé le <strong>{signed_on}</strong>, prix de <strong>{final_price}</strong>, {sale_object}.</p>
    <p>Merci de confirmer ou de contester cette déclaration depuis votre espace. Sans réponse de votre part, elle sera considérée comme confirmée le {deadline}.</p>
    <p>À la confirmation, la facture d'honoraires de {site_name} est émise au vendeur conformément au mandat.</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("closing_declared_by_buyer", {
    "subject": "Vente déclarée par l'acquéreur : merci de confirmer",
    "html": """
    <h2>Une vente a été déclarée</h2>
    <p>Bonjour {name},</p>
    <p>{by_label} a déclaré la vente du bien {property_label} : acte authentique signé le <strong>{signed_on}</strong>, prix de <strong>{final_price}</strong>, {sale_object}.</p>
    <p>Merci de confirmer ou de contester cette déclaration depuis votre espace, de préférence avant le {deadline}. Rien n'est facturé ni retiré tant que vous ne l'avez pas confirmée : sans réponse, notre équipe reprendra contact avec vous.</p>
    <p>À la confirmation, la facture d'honoraires de {site_name} est émise au vendeur conformément au mandat.</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("closing_declared_admin", {
    "subject": "Vente déclarée : {property_label}",
    "html": """
    <h2>Vente déclarée</h2>
    <p>{by_label} a déclaré la vente de {property_label} (annonce {property_id}) : acte authentique signé le {signed_on}, prix {final_price}, {sale_object}.</p>
    <p>Confirmation attendue de l'autre partie avant le {deadline} (automatique ensuite pour une déclaration du vendeur ; une déclaration de l'acquéreur attend l'accord du vendeur ou votre arbitrage). Honoraires estimés : {commission_ht} HT.</p>
    """,
})

EMAIL_TEMPLATES.setdefault("closing_disputed", {
    "subject": "Déclaration de vente contestée : {property_label}",
    "html": """
    <h2>La déclaration de vente est contestée</h2>
    <p>Bonjour {name},</p>
    <p>{by_label} conteste la déclaration de vente de {property_label} pour le motif suivant :</p>
    <p><em>{reason}</em></p>
    <p>Nous examinons la situation et revenons vers vous. Vous pouvez corriger votre déclaration depuis votre espace si une information était inexacte.</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("closing_disputed_admin", {
    "subject": "Contestation d'une vente déclarée : {property_label}",
    "html": """
    <h2>Déclaration de vente contestée</h2>
    <p>{by_label} conteste la déclaration de vente de {property_label} (annonce {property_id}) : acte authentique déclaré signé le {signed_on}, prix {final_price}.</p>
    <p>Motif : <em>{reason}</em></p>
    <p>La ligne est dans « À faire » : confirmer la vente ou annuler la déclaration depuis l'administration.</p>
    """,
})

EMAIL_TEMPLATES.setdefault("closing_confirmed_buyer", {
    "subject": "Vente confirmée : {property_label}",
    "html": """
    <h2>Félicitations pour cette acquisition</h2>
    <p>Bonjour {name},</p>
    <p>La vente du bien {property_label} est confirmée (acte authentique signé le {signed_on}). Vous êtes désormais le bailleur : le bail en cours continue avec vous.</p>
    <p>Pensez à informer le locataire du changement de bailleur et des nouvelles modalités de paiement du loyer, à souscrire votre assurance propriétaire non occupant et, le cas échéant, à prévenir le syndic de copropriété. La fiche de reprise du bail reste consultable depuis votre espace.</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("invoice_issued", {
    "subject": "Votre facture n° {number}",
    "html": """
    <h2>Facture d'honoraires</h2>
    <p>Bonjour {name},</p>
    <p>La vente de {property_label} est confirmée. Conformément au mandat n° {registry_number}, voici la facture d'honoraires de négociation de {site_name} :</p>
    <ul>
      <li>Facture n° <strong>{number}</strong> du {issued_on}</li>
      <li>Montant : <strong>{total_ttc} TTC</strong> ({total_ht} HT, TVA {vat})</li>
      <li>Échéance : <strong>{due_on}</strong></li>
    </ul>
    <p>{payment_terms}</p>
    <p><a href="{link}">Télécharger la facture (PDF)</a></p>
    <p>{redacteur_line}</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("invoice_reminder", {
    "subject": "{headline} : facture n° {number}",
    "html": """
    <h2>{headline}</h2>
    <p>Bonjour {name},</p>
    <p>{status_line}</p>
    <ul>
      <li>Facture n° <strong>{number}</strong> du {issued_on} — {total_ttc} TTC</li>
      <li>Échéance : <strong>{due_on}</strong></li>
    </ul>
    <p>{payment_terms}</p>
    <p><a href="{link}">Télécharger la facture (PDF)</a></p>
    <p>Si le règlement a déjà été effectué, merci de ne pas tenir compte de ce message. {closing_line}</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("invoice_paid", {
    "subject": "Paiement reçu : facture n° {number}",
    "html": """
    <h2>Merci, votre règlement est enregistré</h2>
    <p>Bonjour {name},</p>
    <p>Nous avons bien reçu le règlement de {amount} le {paid_on} pour la facture n° {number}. La facture acquittée reste téléchargeable depuis votre espace.</p>
    <p>Merci de votre confiance,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("invoice_cancelled", {
    "subject": "Facture n° {number} annulée : avoir n° {credit_number}",
    "html": """
    <h2>Facture annulée</h2>
    <p>Bonjour {name},</p>
    <p>La facture n° {number} ({total_ttc} TTC) est annulée par l'avoir n° <strong>{credit_number}</strong> du {issued_on}. Motif : {reason}.</p>
    <p>Cette facture n'est plus due. Si une facture corrigée doit être établie, elle vous sera adressée séparément.</p>
    <p><a href="{link}">Télécharger l'avoir (PDF)</a></p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("invoice_partial_payment", {
    "subject": "Acompte reçu : facture n° {number}",
    "html": """
    <h2>Acompte enregistré</h2>
    <p>Bonjour {name},</p>
    <p>Nous avons bien reçu un règlement de {amount} le {paid_on} pour la facture n° {number} ({total_ttc} TTC).</p>
    <p>Total encaissé à ce jour : {paid_total}. <strong>Reste dû : {balance} TTC</strong>, à régler au plus tard le {due_on}.</p>
    <p><a href="{link}">Télécharger la facture (PDF)</a></p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("payment_order_redacteur", {
    "subject": "Ordre de paiement des honoraires — vente de {property_label}",
    "html": """
    <h2>Ordre de paiement des honoraires de négociation</h2>
    <p>Bonjour {name},</p>
    <p>Vous êtes désigné comme notaire en charge de la vente de {property_label}. Dans le cadre du mandat de vente n° {registry_number} conclu avec {site_name} (AlterEgo SAS, carte professionnelle T), le vendeur a donné ordre irrévocable de régler nos honoraires sur le prix de vente.</p>
    <ul>
      <li>Facture n° <strong>{number}</strong> du {issued_on} : <strong>{total_ttc} TTC</strong> ({total_ht} HT)</li>
      <li>Échéance : {due_on}</li>
    </ul>
    <p><a href="{link}">Télécharger l'ordre de paiement et la facture (PDF)</a></p>
    <p>Nous restons à votre disposition à l'adresse {contact_email}.</p>
    <p>Cordialement,<br>{site_name} — AlterEgo SAS</p>
    """,
})


# ----------------------------------------------------------------------------------------------
# Utilitaires


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse_date(value) -> Optional[date]:
    """Date ISO (AAAA-MM-JJ) ou ISO 8601 complet → date ; None si invalide"""
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        dt = _parse_dt(text)
        return dt.date() if dt else None


def fmt_date_fr(value) -> str:
    d = _parse_date(value)
    return d.strftime("%d/%m/%Y") if d else ""


def fmt_eur_cents(amount) -> str:
    """Montant au centime, format fr-FR : 4 800,00 €"""
    value = float(amount or 0)
    whole = f"{int(abs(value)):,}".replace(",", " ")
    cents = f"{abs(value) - int(abs(value)):.2f}"[2:]
    sign = "-" if value < 0 else ""
    return f"{sign}{whole},{cents} €"


def fmt_siren(value: str) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 9:
        return f"{digits[:3]} {digits[3:6]} {digits[6:]}"
    return digits or ""


def property_siren(property: dict) -> str:
    return re.sub(r"\D", "", str(property.get("siren") or property.get("siret") or ""))[:9]


def property_label(property: dict) -> str:
    """Désignation du bien dans les e-mails, factures et ordres de paiement : titre généré (jamais l'adresse)"""
    return property.get("title") or f"annonce {str(property.get('id', ''))[:8]}"


def vat_number() -> str:
    """Numéro de TVA intracommunautaire de l'entité (LEGAL_TVA, sinon calculé depuis le SIREN : FR + clé + SIREN)"""
    env = os.environ.get("LEGAL_TVA", "").strip()
    if env:
        return env
    siren = re.sub(r"\D", "", LEGAL_ENTITY.get("siren") or "")
    if len(siren) != 9:
        return ""
    key = (12 + 3 * (int(siren) % 97)) % 97
    return f"FR{key:02d}{siren}"


def bank_details() -> dict:
    return {"iban": os.environ.get("INVOICE_IBAN", "").strip(), "bic": os.environ.get("INVOICE_BIC", "").strip(),
            "bank": os.environ.get("INVOICE_BANK", "").strip()}


def bank_text() -> str:
    bank = bank_details()
    if bank["iban"]:
        parts = [f"IBAN {bank['iban']}"]
        if bank["bic"]:
            parts.append(f"BIC {bank['bic']}")
        if bank["bank"]:
            parts.append(bank["bank"])
        return "Règlement par virement : " + " — ".join(parts) + ". Référence à rappeler : numéro de facture."
    return (f"Règlement par virement ; les coordonnées bancaires sont communiquées sur simple demande à "
            f"{LEGAL_ENTITY.get('email', '')}. Référence à rappeler : numéro de facture.")


def entity_lines() -> List[str]:
    """Identité complète de l'entité émettrice (en-tête des PDF)"""
    legal = LEGAL_ENTITY
    rc_pro = os.environ.get("LEGAL_RC_PRO", "").strip() or "RC professionnelle souscrite conformément à la loi n° 70-9 du 2 janvier 1970"
    lines = [
        f"{legal.get('denomination', 'AlterEgo')} SAS — {legal.get('forme_juridique', '')} au capital de {fmt_eur_fr(legal.get('capital') or 0)}",
        f"{legal.get('adresse', '')} — RCS {legal.get('rcs_ville', '')} {fmt_siren(legal.get('siren', ''))}",
    ]
    tva = vat_number()
    if tva:
        lines.append(f"N° TVA intracommunautaire : {tva}")
    lines.append(f"Carte professionnelle T n° {legal.get('carte_t', '')} délivrée par la {legal.get('carte_t_issuer', '')} "
                 f"(Transactions sur immeubles et fonds de commerce)")
    lines.append(rc_pro)
    lines.append("AlterEgo SAS déclare ne recevoir ni détenir d'autres fonds, effets ou valeurs que ceux représentatifs de sa rémunération.")
    lines.append(f"Marque : {site_name()} — {site_url()} — {legal.get('email', '')}")
    return lines


def party_label(role: str) -> str:
    return "Le vendeur" if role == "seller" else ("L'acquéreur" if role == "buyer" else "L'administrateur")


def closing_role(closing: dict, user: dict) -> Optional[str]:
    """Rôle de l'utilisateur dans ce closing : seller | buyer | admin | None"""
    if user.get("id") == closing.get("seller_id"):
        return "seller"
    if user.get("id") == closing.get("buyer_id"):
        return "buyer"
    if user.get("role") == "admin":
        return "admin"
    return None


def _other_role(role: str) -> str:
    return "buyer" if role == "seller" else "seller"


def public_closing(closing: dict) -> dict:
    """Vue d'un closing sans les jetons de lien signé"""
    doc = {k: v for k, v in closing.items() if k not in ("_id", "tokens", "payment_order_token")}
    doc["status_label"] = CLOSING_STATUS_LABELS.get(doc.get("status"), doc.get("status"))
    if is_direct_offer_id(doc.get("offer_id")):
        doc["offer_id"] = None
    return doc


def public_invoice(invoice: dict) -> dict:
    return {k: v for k, v in invoice.items() if k not in ("_id", "access_token")}


async def add_todo(todo_type: str, key: str, title: str, ref: Optional[dict] = None, action: str = "") -> dict:
    """Ligne « À faire » admin (db.todos), sans doublon ouvert pour (type, key)"""
    existing = await db.todos.find_one({"type": todo_type, "key": key, "status": "open"}, {"_id": 0})
    if existing:
        return existing
    doc = {"id": str(uuid.uuid4()), "type": todo_type, "key": key, "title": title, "ref": ref or {}, "action": action,
           "status": "open", "created_at": _iso(_now()), "done_at": None}
    await db.todos.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def close_todos(todo_type: str, key: str, note: str = "") -> int:
    res = await db.todos.update_many({"type": todo_type, "key": key, "status": "open"},
                                     {"$set": {"status": "done", "done_at": _iso(_now()), "note": note}})
    return res.modified_count


async def _mandate_for(property: dict) -> Optional[dict]:
    """Mandat signé de l'annonce (property.mandate_id, sinon le dernier mandat signé de la société)"""
    if property.get("mandate_id"):
        mandate = await db.generated_contracts.find_one({"id": property["mandate_id"], "type": "mandat"}, {"_id": 0})
        if mandate:
            return mandate
    return await db.generated_contracts.find_one({"property_id": property["id"], "type": "mandat", "status": "signed"},
                                                 {"_id": 0}, sort=[("signed_at", -1)])


def _redacteur_text(redacteur: Optional[dict]) -> str:
    if not redacteur or not redacteur.get("name"):
        return ""
    parts = [f"{REDACTEUR_LABELS.get(redacteur.get('type'), 'Rédacteur')} : {redacteur['name']}"]
    if redacteur.get("email"):
        parts.append(redacteur["email"])
    if redacteur.get("phone"):
        parts.append(redacteur["phone"])
    return " — ".join(parts)


# ----------------------------------------------------------------------------------------------
# Création d'un closing à l'acceptation d'une offre


DIRECT_OFFER_PREFIX = "direct:"


def is_direct_offer_id(value) -> bool:
    """Les étapes de vente directes (sans offre) portent une clé synthétique `direct:<id>` dans `offer_id`, parce que l'index
    unique de la collection n'accepte qu'une seule valeur nulle ; l'API expose `offer_id: null` (`public_closing`)."""
    return isinstance(value, str) and value.startswith(DIRECT_OFFER_PREFIX)


async def _has_test_data(property: dict, *user_ids) -> bool:
    """Donnée de test par ses liens (indépendamment du mode) : annonce de test ou partie dont le compte est un compte de test"""
    if is_test_related(property):
        return True
    ids = [u for u in user_ids if u]
    return bool(ids) and await db.users.find_one({"id": {"$in": ids}, "is_test": True}, {"_id": 0, "id": 1}) is not None


async def _is_test_closing(property: dict, *user_ids) -> bool:
    """Étape de vente de test : mode test actif, annonce de test ou partie dont le compte est un compte de test"""
    return test_mode_enabled() or await _has_test_data(property, *user_ids)


async def _new_closing(property: dict, buyer_id: str, seller_id: str, sale_object: Optional[str], expected: Optional[date],
                       amount: float, offer_id: Optional[str], accepted_at: Optional[str], notify: bool, origin: str) -> dict:
    now = _now()
    if sale_object not in SALE_OBJECTS:
        sale_object = None
    closing = {
        "id": str(uuid.uuid4()),
        "property_id": property["id"],
        "property_label": property_label(property),
        "property_title": property.get("title") or property_label(property),
        "buyer_id": buyer_id,
        "seller_id": seller_id,
        "offer_id": offer_id,
        "origin": origin,
        "offer_amount": float(amount or 0),
        "sale_object": sale_object,
        "expected_date": expected.isoformat() if expected else None,
        "avant_contrat_on": None,
        "redacteur": None,
        "status": STATUS_IN_PROGRESS,
        "accepted_at": accepted_at or _iso(now),
        "created_at": _iso(now),
        "updated_at": _iso(now),
        "progress": [],
        "followups_sent": [],
        "declaration": None,
        "confirmed_at": None,
        "confirmed_by": None,
        "dispute": None,
        "invoice_id": None,
        "tokens": {"seller": secrets.token_urlsafe(24), "buyer": secrets.token_urlsafe(24)},
        "payment_order_token": secrets.token_urlsafe(24),
    }
    if await _is_test_closing(property, buyer_id, seller_id):
        closing["is_test"] = True
    await db.closings.insert_one(closing)
    closing.pop("_id", None)
    if notify:
        amount_text = fmt_eur_fr(closing["offer_amount"]) if closing["offer_amount"] else "à définir dans l'acte"
        for user_id in (seller_id, buyer_id):
            await email_user(user_id, "closing_checklist", amount=amount_text, property_label=closing["property_label"])
    return closing


async def create_closing_for_offer(offer: dict, property: dict, notify: bool = True) -> dict:
    """Crée (une seule fois) l'étape de vente d'une offre acceptée et envoie la checklist aux deux parties.
    Appelée par server.py à l'acceptation d'une offre (contre-signature du vendeur ou acceptation d'une contre-proposition)."""
    existing = await db.closings.find_one({"offer_id": offer["id"]}, {"_id": 0})
    if existing:
        return existing
    closing = await _new_closing(property, offer["buyer_id"], offer.get("seller_id") or property.get("seller_id"),
                                 offer.get("sale_object") or property.get("sale_object"), _parse_date(offer.get("target_date")),
                                 offer.get("amount") or 0, offer["id"], offer.get("responded_at"), notify, "offer")
    await db.offers.update_one({"id": offer["id"]}, {"$set": {"closing_id": closing["id"]}})
    return closing


async def create_closing_direct(property: dict, buyer_id: str, notify: bool = True) -> dict:
    """Vente via la plateforme sans offre acceptée : étape de vente ouverte par le vendeur pour un acquéreur présenté
    (une seule étape en cours par couple annonce / acquéreur)."""
    existing = await db.closings.find_one({"property_id": property["id"], "buyer_id": buyer_id,
                                           "status": {"$in": [STATUS_IN_PROGRESS, STATUS_DECLARED, STATUS_DISPUTED]}}, {"_id": 0})
    if existing:
        return existing
    return await _new_closing(property, buyer_id, property.get("seller_id"), property.get("sale_object"), None,
                              0, DIRECT_OFFER_PREFIX + str(uuid.uuid4()), None, notify, "direct")


# ----------------------------------------------------------------------------------------------
# Modèles d'entrée


class RedacteurInput(BaseModel):
    type: str = Field("notaire", description="notaire | autre")
    name: str = Field(..., min_length=2, max_length=200)
    email: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=40)


class DeclareInput(BaseModel):
    signed_on: str = Field(..., description="Date de signature de l'acte authentique (AAAA-MM-JJ)")
    final_price: float = Field(..., gt=0)
    sale_object: str = Field(..., description="bien | parts")


class AvantContratInput(BaseModel):
    avant_contrat_on: Optional[str] = Field(None, description="Date de signature de la promesse ou du compromis (AAAA-MM-JJ) ; vide pour effacer")


class DisputeInput(BaseModel):
    reason: str = Field(..., min_length=5, max_length=2000)


class PaidInput(BaseModel):
    paid_on: str = Field(..., description="Date d'encaissement (AAAA-MM-JJ)")
    amount: float = Field(..., gt=0)


class CancelInput(BaseModel):
    reason: str = Field(..., min_length=3, max_length=2000)


class ResolveInput(BaseModel):
    """`{action: 'confirm'|'cancel', note}` ; API.md §7 écrit `{status, note}` : les deux formes sont acceptées"""
    action: Optional[str] = Field(None, description="confirm | cancel")
    status: Optional[str] = Field(None, description="synonyme de action (confirmed/confirm | cancelled/cancel/abandoned)")
    note: Optional[str] = Field(None, max_length=2000)

    def resolved_action(self) -> str:
        value = (self.action or self.status or "").strip().lower()
        if value in ("confirm", "confirmed"):
            return "confirm"
        if value in ("cancel", "cancelled", "canceled", "abandon", "abandoned"):
            return "cancel"
        return value


class DirectClosingInput(BaseModel):
    property_id: str
    buyer_id: str


async def _load_closing(closing_id: str, user: dict) -> tuple:
    closing = await db.closings.find_one({"id": closing_id}, {"_id": 0})
    if not closing:
        raise HTTPException(status_code=404, detail="Étape de vente introuvable")
    role = closing_role(closing, user)
    if not role:
        raise HTTPException(status_code=403, detail="Non autorisé")
    return closing, role


async def _closing_view(closing: dict, user: dict) -> dict:
    doc = public_closing(closing)
    doc["role"] = closing_role(closing, user)
    doc["followup_links"] = None
    if not doc.get("property_title"):
        property = await db.properties.find_one({"id": closing.get("property_id")}, {"_id": 0, "title": 1, "id": 1})
        doc["property_title"] = (property or {}).get("title") or closing.get("property_label") or ""
    # Facture et honoraires : vendeur (débiteur) et admin uniquement. L'acquéreur ne voit ni l'adresse, ni l'e-mail,
    # ni le SIREN du vendeur (bloc débiteur), ni le montant des honoraires.
    seller_side = doc["role"] in ("seller", "admin")
    if closing.get("invoice_id") and seller_side:
        invoice = await db.invoices.find_one({"id": closing["invoice_id"]}, {"_id": 0, "access_token": 0})
        doc["invoice"] = invoice
    else:
        doc["invoice"] = None
    if not seller_side:
        doc.pop("invoice_id", None)
        doc.pop("invoice_number", None)
        doc.pop("payment_order_sent_to", None)
    seller = await db.users.find_one({"id": closing.get("seller_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company_name": 1})
    buyer = await db.users.find_one({"id": closing.get("buyer_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company_name": 1})
    doc["seller_name"] = display_name(seller)
    doc["buyer_name"] = display_name(buyer)
    doc.setdefault("avant_contrat_on", None)
    doc["redacteur_label"] = REDACTEUR_LABELS.get((closing.get("redacteur") or {}).get("type") or "notaire")
    doc["commission_preview"] = business_model.calculate_commission(
        (closing.get("declaration") or {}).get("final_price") or closing.get("offer_amount") or 0) if seller_side else None
    return doc


# ----------------------------------------------------------------------------------------------
# Routes : création, consultation, notaire, avant-contrat


@router.post("/closing/from-offer/{offer_id}")
async def closing_from_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    """Crée l'étape de vente d'une offre déjà acceptée (idempotent) ; parties de l'offre ou admin"""
    offer = await db.offers.find_one({"id": offer_id}, {"_id": 0})
    if not offer:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    if current_user.get("role") != "admin" and current_user["id"] not in (offer.get("seller_id"), offer.get("buyer_id")):
        raise HTTPException(status_code=403, detail="Non autorisé")
    if offer.get("status") != "accepted":
        raise HTTPException(status_code=400, detail="Seule une offre acceptée ouvre une étape de vente")
    property = await db.properties.find_one({"id": offer["property_id"]}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    closing = await create_closing_for_offer(offer, property)
    return await _closing_view(closing, current_user)


@router.post("/closing/direct")
async def closing_direct(data: DirectClosingInput, current_user: dict = Depends(get_current_user)):
    """Vendeur : ouvre l'étape de vente avec un acquéreur présenté (engagement de confidentialité signé) sans offre acceptée
    sur la plateforme ; la déclaration de vente suit. L'acquéreur doit figurer dans `presented_buyers` de l'annonce."""
    property = await db.properties.find_one({"id": data.property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    if current_user.get("role") != "admin" and current_user["id"] != property.get("seller_id"):
        raise HTTPException(status_code=403, detail={"code": "not_allowed", "message": "Seul le vendeur peut ouvrir une étape de vente"})
    presented = {p.get("buyer_id") for p in (property.get("presented_buyers") or [])}
    if data.buyer_id not in presented:
        raise HTTPException(status_code=400, detail={"code": "validation", "message": "Cet acquéreur ne figure pas sur la liste des acquéreurs présentés (engagement de confidentialité signé)",
                                                     "missing": ["buyer_id"]})
    closing = await create_closing_direct(property, data.buyer_id)
    return await _closing_view(closing, current_user)


@router.get("/closing/my")
async def my_closings(current_user: dict = Depends(get_current_user)):
    """Étapes de vente de l'utilisateur (vendeur ou acquéreur), les plus récentes d'abord"""
    query = {"$or": [{"seller_id": current_user["id"]}, {"buyer_id": current_user["id"]}]}
    closings = await db.closings.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"closings": [await _closing_view(c, current_user) for c in closings]}


@router.get("/closing/{closing_id}")
async def get_closing(closing_id: str, current_user: dict = Depends(get_current_user)):
    closing, _ = await _load_closing(closing_id, current_user)
    return await _closing_view(closing, current_user)


@router.put("/closing/{closing_id}/redacteur")
async def set_redacteur(closing_id: str, data: RedacteurInput, current_user: dict = Depends(get_current_user)):
    """Les deux parties peuvent renseigner (ou corriger) le notaire en charge de la vente ; l'autre partie est prévenue.
    L'ordre de paiement (qui reprend la facture du vendeur) n'est adressé qu'à un notaire renseigné ou confirmé par le
    vendeur (ou l'admin) : après confirmation de la vente, seul le vendeur ou l'admin peut encore le renseigner, et l'ordre
    de paiement part alors s'il n'a pas encore été envoyé."""
    closing, role = await _load_closing(closing_id, current_user)
    late_seller_update = (closing["status"] == STATUS_CONFIRMED and role in ("seller", "admin")
                          and not closing.get("payment_order_sent_at"))
    if closing["status"] == STATUS_ABANDONED or (closing["status"] == STATUS_CONFIRMED and not late_seller_update):
        raise HTTPException(status_code=400, detail="Cette étape de vente est close")
    rtype = (data.type or "notaire").strip().lower()
    if rtype not in REDACTEUR_TYPES:
        raise HTTPException(status_code=400, detail={"code": "validation", "message": "Type invalide (notaire ou autre)"})
    email = (data.email or "").strip().lower() or None
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail={"code": "validation", "message": "Adresse e-mail du notaire invalide"})
    redacteur = {"type": rtype, "name": data.name.strip(), "email": email, "phone": (data.phone or "").strip() or None,
                 "set_by": role, "set_at": _iso(_now())}
    await db.closings.update_one({"id": closing_id}, {"$set": {"redacteur": redacteur, "updated_at": _iso(_now())}})
    closing["redacteur"] = redacteur
    if late_seller_update and closing.get("invoice_id"):
        invoice = await db.invoices.find_one({"id": closing["invoice_id"]}, {"_id": 0})
        if invoice and await send_payment_order(closing, invoice):
            await close_todos(TODO_PAYMENT_ORDER, closing_id, "Notaire confirmé par le vendeur")
            closing = await db.closings.find_one({"id": closing_id}, {"_id": 0}) or closing
    if role in ("seller", "buyer"):
        other_id = closing.get(f"{_other_role(role)}_id")
        await email_user(other_id, "closing_redacteur_set", property_label=closing["property_label"],
                         by_label=party_label(role), redacteur=_redacteur_text(redacteur))
    return await _closing_view(closing, current_user)


@router.put("/closing/{closing_id}/avant-contrat")
async def set_avant_contrat(closing_id: str, data: AvantContratInput, current_user: dict = Depends(get_current_user)):
    """Date de signature de l'avant-contrat (promesse ou compromis), renseignée par l'une ou l'autre partie (ou l'admin)
    avant la déclaration de la vente ; l'autre partie est prévenue. `null` efface la date."""
    closing, role = await _load_closing(closing_id, current_user)
    if closing["status"] != STATUS_IN_PROGRESS:
        raise HTTPException(status_code=400, detail={"code": "validation", "message":
                            "La date de l'avant-contrat se renseigne avant la déclaration de la vente"})
    value = None
    if data.avant_contrat_on:
        parsed = _parse_date(data.avant_contrat_on)
        if not parsed:
            raise HTTPException(status_code=400, detail={"code": "validation", "message": "Date invalide (format AAAA-MM-JJ)"})
        if parsed > _now().date():
            raise HTTPException(status_code=400, detail={"code": "validation", "message": "La date de l'avant-contrat ne peut pas être dans le futur"})
        value = parsed.isoformat()
    now = _now()
    await db.closings.update_one({"id": closing_id}, {"$set": {"avant_contrat_on": value, "avant_contrat_set_by": role,
                                                                "updated_at": _iso(now)},
                                                       "$push": {"progress": {"at": _iso(now), "by": role, "avant_contrat_on": value}}})
    closing.update({"avant_contrat_on": value, "avant_contrat_set_by": role})
    if value and role in ("seller", "buyer"):
        await email_user(closing.get(f"{_other_role(role)}_id"), "closing_avant_contrat", property_label=closing["property_label"],
                         by_label=party_label(role), avant_contrat_on=fmt_date_fr(value))
    return await _closing_view(closing, current_user)


# ----------------------------------------------------------------------------------------------
# Réponses en un clic (lien signé, sans connexion)


def followup_links(closing: dict, role: str) -> dict:
    token = (closing.get("tokens") or {}).get(role, "")
    base = site_url(f"/api/closing/{closing['id']}/status/{token}?answer=")
    return {f"link_{answer}": base + answer for answer in FOLLOWUP_ANSWERS}


def _html_page(title: str, text: str, cta_label: str = "Accéder à mon espace", cta_url: str = "",
               form_action: str = "", form_label: str = "") -> str:
    """Page HTML minimale ; avec `form_action`, un bouton envoie la réponse en POST (aucune action sur un simple GET)"""
    from html import escape
    cta_url = cta_url or site_url("/login")
    action = (f'<form method="post" action="{escape(form_action)}"><button type="submit" class="btn">{escape(form_label)}</button></form>'
              if form_action else f'<a class="btn" href="{escape(cta_url)}">{escape(cta_label)}</a>')
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{escape(title)} — {escape(site_name())}</title>
<style>body{{font-family:Inter,Arial,sans-serif;background:#f5f7fa;color:#0b1220;margin:0;padding:24px}}
.card{{max-width:560px;margin:40px auto;background:#fff;border:1px solid #e3e7ee;border-radius:12px;padding:32px}}
h1{{font-size:22px;margin:0 0 12px}}p{{line-height:1.5}}.btn{{display:inline-block;margin-top:16px;padding:12px 20px;background:#0b1220;color:#fff;border:0;border-radius:8px;text-decoration:none;font:inherit;font-weight:600;cursor:pointer}}
.btn:focus{{outline:3px solid #1d4ed8;outline-offset:2px}}.brand{{font-weight:700;margin-bottom:16px}}</style></head><body><div class="card"><div class="brand">{escape(site_name())}</div>
<h1>{escape(title)}</h1><p>{escape(text)}</p>{action}</div></body></html>"""


FOLLOWUP_CONFIRM_TEXTS = {
    "en_cours": "Confirmez que la vente est toujours en cours : nous reprendrons des nouvelles dans 30 jours.",
    "signe": "Confirmez que l'acte authentique est signé : vous pourrez ensuite déclarer la vente depuis votre espace.",
    "abandonne": "Confirmez que la vente avec cet acquéreur est abandonnée : les relances s'arrêtent et l'annonce reste en ligne.",
}


async def _followup_closing(closing_id: str, token: str, answer: str) -> tuple:
    if answer not in FOLLOWUP_ANSWERS:
        raise HTTPException(status_code=400, detail="Réponse invalide")
    closing = await db.closings.find_one({"id": closing_id}, {"_id": 0})
    tokens = (closing or {}).get("tokens") or {}
    role = next((r for r, t in tokens.items() if t and secrets.compare_digest(t, token)), None)
    if not closing or not role:
        raise HTTPException(status_code=404, detail="Lien invalide")
    return closing, role


def _wants_html(request: Request) -> bool:
    return "text/html" in (request.headers.get("accept") or "")


@router.get("/closing/{closing_id}/status/{token}")
async def followup_confirmation_page(closing_id: str, token: str, request: Request, answer: str = Query(...)):
    """Lien de la relance J+30/60/90 : page de confirmation SANS effet (les passerelles de sécurité des messageries
    ouvrent tous les liens d'un e-mail) ; la réponse est enregistrée par le bouton (POST)."""
    closing, _ = await _followup_closing(closing_id, token, answer)
    label = FOLLOWUP_ANSWERS[answer]
    if _wants_html(request):
        return HTMLResponse(_html_page(label, FOLLOWUP_CONFIRM_TEXTS[answer], form_action=f"{request.url.path}?{request.url.query}",
                                       form_label=f"Confirmer : {label}"))
    return {"ok": False, "confirm_required": True, "answer": answer, "label": label, "status": closing["status"]}


@router.post("/closing/{closing_id}/status/{token}")
async def answer_followup(closing_id: str, token: str, request: Request, answer: str = Query(...)):
    """Réponse à la relance J+30/60/90 (bouton de la page de confirmation ; lien signé propre à chaque partie).
    « Toujours en cours » ou « Acte signé » de la partie qui avait déclaré l'abandon rouvre l'étape de vente."""
    closing, role = await _followup_closing(closing_id, token, answer)
    now = _now()
    entry = {"at": _iso(now), "by": role, "answer": answer}
    update: Dict[str, Any] = {"$push": {"progress": entry}, "$set": {"updated_at": _iso(now)}}
    status = closing["status"]
    if status == STATUS_ABANDONED and answer in ("en_cours", "signe") and closing.get("abandoned_by") == role:
        update["$set"].update({"status": STATUS_IN_PROGRESS, "reopened_at": _iso(now)})
        status = STATUS_IN_PROGRESS
    if answer == "abandonne" and status == STATUS_IN_PROGRESS:
        update["$set"].update({"status": STATUS_ABANDONED, "abandoned_at": _iso(now), "abandoned_by": role})
    elif answer == "signe" and status == STATUS_IN_PROGRESS:
        update["$set"]["signature_reported"] = {"by": role, "at": _iso(now)}
    await db.closings.update_one({"id": closing_id}, update)
    label = FOLLOWUP_ANSWERS[answer]
    texts = {
        "en_cours": "Merci, nous reprendrons des nouvelles dans 30 jours. Bonne continuation jusqu'à l'acte authentique.",
        "signe": "Merci. Pour établir la facture d'honoraires prévue au mandat, déclarez la vente depuis votre espace "
                 "(date de l'acte authentique, prix, objet) : l'autre partie la confirmera.",
        "abandonne": "Merci de nous l'avoir indiqué. L'annonce reste en ligne et vous pouvez poursuivre avec un autre acquéreur. "
                     "Si la vente reprend, répondez « Toujours en cours » depuis le même e-mail.",
    }
    if _wants_html(request):
        return HTMLResponse(_html_page(label, texts[answer]))
    return {"ok": True, "answer": answer, "label": label, "status": (update["$set"].get("status") or status)}


# ----------------------------------------------------------------------------------------------
# Déclaration, confirmation, contestation


@router.post("/closing/{closing_id}/declare")
async def declare_sale(closing_id: str, data: DeclareInput, current_user: dict = Depends(get_current_user)):
    """Déclaration de la vente (acte authentique signé) par l'une des parties : l'autre reçoit une demande de confirmation (7 jours)"""
    closing, role = await _load_closing(closing_id, current_user)
    if closing["status"] == STATUS_CONFIRMED:
        raise HTTPException(status_code=400, detail="Cette vente est déjà confirmée")
    dispute = closing.get("dispute") or {}
    if closing["status"] == STATUS_DISPUTED and role != "admin" and role != dispute.get("by"):
        # La partie contestée ne peut pas effacer la contestation en redéclarant : l'administrateur tranche
        # (seule la partie qui a contesté peut déclarer sa propre version, que l'autre partie devra confirmer)
        raise HTTPException(status_code=400, detail={"code": "disputed", "message": "Déclaration contestée : l'administrateur tranche. "
                                                     "Vous serez informé de sa décision par e-mail."})
    if closing["status"] == STATUS_ABANDONED and role == "buyer":
        raise HTTPException(status_code=400, detail="Cette étape de vente a été abandonnée : seul le vendeur peut déclarer la vente")
    signed_on = _parse_date(data.signed_on)
    if not signed_on:
        raise HTTPException(status_code=400, detail="Date de signature invalide (format AAAA-MM-JJ)")
    today = _now().date()
    if signed_on > today:
        raise HTTPException(status_code=400, detail="La date de signature ne peut pas être dans le futur")
    if signed_on < today - timedelta(days=3 * 365):
        raise HTTPException(status_code=400, detail="Date de signature trop ancienne")
    sale_object = (data.sale_object or "").strip().lower()
    if sale_object not in SALE_OBJECTS:
        raise HTTPException(status_code=400, detail={"code": "validation", "message": "Objet de la vente invalide (bien ou parts)"})
    now = _now()
    deadline = now + timedelta(days=CONFIRMATION_DAYS)
    declaration = {
        "signed_on": signed_on.isoformat(), "final_price": round(float(data.final_price), 2), "sale_object": sale_object,
        "declared_by": role, "declared_by_user_id": current_user["id"], "declared_at": _iso(now),
        "confirm_deadline": _iso(deadline),
    }
    push = {"declarations": declaration}  # historique complet des déclarations (la courante en dernier)
    if closing.get("dispute"):
        push["disputes"] = closing["dispute"]  # historique des contestations ; la ligne « À faire » reste ouverte
    await db.closings.update_one({"id": closing_id}, {
        "$set": {"declaration": declaration, "status": STATUS_DECLARED, "sale_object": sale_object, "dispute": None,
                 "updated_at": _iso(now)},
        "$push": push})
    # Vente notée sur l'annonce
    await db.properties.update_one({"id": closing["property_id"]}, {"$set": {"sale_declared_at": _iso(now), "closing_id": closing_id}})
    commission = business_model.calculate_commission(declaration["final_price"])
    values = {"property_label": closing["property_label"], "property_id": closing["property_id"], "by_label": party_label(role),
              "signed_on": fmt_date_fr(signed_on), "final_price": fmt_eur_fr(declaration["final_price"]),
              "sale_object": SALE_OBJECT_LABELS[sale_object], "deadline": fmt_date_fr(deadline),
              "commission_ht": fmt_eur_cents(commission["final_commission_ht"])}
    if role == "admin":
        for user_id in (closing.get("seller_id"), closing.get("buyer_id")):
            await email_user(user_id, "closing_declared_to_confirm", **values)
    elif role == "buyer":
        # Déclaration de l'acquéreur : jamais confirmée automatiquement (facture et retrait de l'annonce sur accord du vendeur)
        await email_user(closing.get("seller_id"), "closing_declared_by_buyer", **values)
    else:
        await email_user(closing.get(f"{_other_role(role)}_id"), "closing_declared_to_confirm", **values)
    await email_admin("closing_declared_admin", **values)
    closing.update({"declaration": declaration, "status": STATUS_DECLARED, "sale_object": sale_object, "dispute": None})
    return await _closing_view(closing, current_user)


async def confirm_closing(closing: dict, by: str, now: Optional[datetime] = None, note: str = "") -> dict:
    """Confirme la vente déclarée, marque l'annonce vendue et émet la facture (idempotent)"""
    now = now or _now()
    declaration = closing.get("declaration")
    if not declaration:
        raise HTTPException(status_code=400, detail="Aucune vente déclarée")
    res = await db.closings.update_one(
        {"id": closing["id"], "status": {"$ne": STATUS_CONFIRMED}},
        {"$set": {"status": STATUS_CONFIRMED, "confirmed_at": _iso(now), "confirmed_by": by, "confirmation_note": note,
                  "updated_at": _iso(now)}})
    if res.modified_count == 0:
        return await db.closings.find_one({"id": closing["id"]}, {"_id": 0})
    closing.update({"status": STATUS_CONFIRMED, "confirmed_at": _iso(now), "confirmed_by": by})
    await db.properties.update_one({"id": closing["property_id"]},
                                  {"$set": {"status": "sold", "sold_at": _iso(now), "sale_declared_at": _iso(now),
                                            "sold_via_platform": True, "closing_id": closing["id"], "updated_at": _iso(now)}})
    if not is_direct_offer_id(closing.get("offer_id")):
        await db.offers.update_one({"id": closing["offer_id"]}, {"$set": {"closing_status": STATUS_CONFIRMED}})
    await close_todos(TODO_CLOSING_DISPUTED, closing["id"], "Vente confirmée")
    await close_todos(TODO_DECLARATION_UNCONFIRMED, closing["id"], "Vente confirmée")
    invoice = await issue_invoice(closing, now)
    await email_user(closing.get("buyer_id"), "closing_confirmed_buyer", property_label=closing["property_label"],
                     signed_on=fmt_date_fr(declaration["signed_on"]))
    closing["invoice_id"] = invoice["id"]
    return closing


@router.post("/closing/{closing_id}/confirm")
async def confirm_sale(closing_id: str, current_user: dict = Depends(get_current_user)):
    """Confirmation de la vente par l'autre partie (ou l'admin) → facture"""
    closing, role = await _load_closing(closing_id, current_user)
    if closing["status"] != STATUS_DECLARED:
        raise HTTPException(status_code=400, detail="Aucune déclaration en attente de confirmation")
    declared_by = (closing.get("declaration") or {}).get("declared_by")
    if role != "admin" and role == declared_by:
        raise HTTPException(status_code=403, detail="La confirmation revient à l'autre partie")
    closing = await confirm_closing(closing, by=role)
    return await _closing_view(closing, current_user)


@router.post("/closing/{closing_id}/dispute")
async def dispute_sale(closing_id: str, data: DisputeInput, current_user: dict = Depends(get_current_user)):
    """Contestation de la déclaration par l'autre partie → ligne « À faire » admin, e-mails"""
    closing, role = await _load_closing(closing_id, current_user)
    if closing["status"] != STATUS_DECLARED:
        raise HTTPException(status_code=400, detail="Aucune déclaration en attente de confirmation")
    declaration = closing.get("declaration") or {}
    if role != "admin" and role == declaration.get("declared_by"):
        raise HTTPException(status_code=403, detail="Seule l'autre partie peut contester")
    now = _now()
    dispute = {"reason": data.reason.strip(), "by": role, "by_user_id": current_user["id"], "at": _iso(now)}
    await db.closings.update_one({"id": closing_id}, {"$set": {"status": STATUS_DISPUTED, "dispute": dispute, "updated_at": _iso(now)}})
    values = {"property_label": closing["property_label"], "property_id": closing["property_id"], "by_label": party_label(role),
              "reason": dispute["reason"], "signed_on": fmt_date_fr(declaration.get("signed_on")),
              "final_price": fmt_eur_fr(declaration.get("final_price") or 0)}
    await add_todo(TODO_CLOSING_DISPUTED, closing_id,
                   f"Vente contestée : {closing['property_label']} — {party_label(role).lower()} conteste la déclaration",
                   ref={"closing_id": closing_id, "property_id": closing["property_id"], "reason": dispute["reason"]},
                   action=f"/api/admin/closings/{closing_id}/resolve")
    await email_user(declaration.get("declared_by_user_id"), "closing_disputed", **values)
    await email_admin("closing_disputed_admin", **values)
    closing.update({"status": STATUS_DISPUTED, "dispute": dispute})
    return await _closing_view(closing, current_user)


# ----------------------------------------------------------------------------------------------
# Facture


async def build_debtor(closing: dict, property: dict, mandate: Optional[dict]) -> dict:
    """Débiteur : toujours le vendeur — nom, adresse postale du mandat (sinon profil), société propriétaire et SIREN le cas échéant"""
    seller = await db.users.find_one({"id": closing["seller_id"]}, {"_id": 0, "password_hash": 0}) or {}
    address = ((mandate or {}).get("mandant_address") or seller.get("address") or seller.get("company_address") or "").strip()
    return {
        "user_id": closing["seller_id"],
        "name": display_name(seller) or seller.get("email", ""),
        "email": seller.get("email", ""),
        "address": address,
        "address_source": "mandat" if (mandate or {}).get("mandant_address") else ("profil" if address else ""),
        "company_name": property.get("company_name") or "",
        "siren": property_siren(property),
        "owner_type": property.get("owner_type") or "",
    }


def invoice_lines(commission: dict, sale_object: str, mandate_number: str, property_title: str) -> List[dict]:
    """Lignes de la facture à partir du détail renvoyé par calculate_commission (aucun montant en dur)"""
    object_text = "cession des parts de la société propriétaire de" if sale_object == "parts" else "vente de"
    designation = f"Honoraires de négociation — mandat n° {mandate_number} — {object_text} {property_title}"
    lines = []
    for part in commission.get("breakdown") or []:
        rate_pct = f"{round(part['rate'] * 100, 2):g}".replace(".", ",")
        lines.append({"label": f"Prix de vente × {rate_pct} % HT", "base": part["base"], "rate": part["rate"], "amount_ht": part["amount_ht"]})
    if commission.get("applied_minimum"):
        adjustment = round(commission["final_commission_ht"] - commission["calculated_commission"], 2)
        lines.append({"label": f"Ajustement au minimum contractuel ({fmt_eur_fr(commission['minimum_fee'])} HT)",
                      "base": None, "rate": None, "amount_ht": adjustment})
    if not lines:
        lines.append({"label": "Honoraires de négociation", "base": commission.get("sale_amount"), "rate": None,
                      "amount_ht": commission["final_commission_ht"]})
    return [{"designation": designation, **lines[0]}] + lines[1:]


async def issue_invoice(closing: dict, now: Optional[datetime] = None) -> dict:
    """Facture d'honoraires au vendeur à la confirmation (une seule par closing) : numéro continu, mentions L441-9,
    e-mail au vendeur, ordre de paiement au notaire."""
    now = now or _now()
    if closing.get("invoice_id"):
        existing = await db.invoices.find_one({"id": closing["invoice_id"]}, {"_id": 0})
        if existing and existing.get("status") != INVOICE_CANCELLED:
            return existing
    existing = await db.invoices.find_one({"closing_id": closing["id"], "status": {"$ne": INVOICE_CANCELLED}}, {"_id": 0})
    if existing:
        await db.closings.update_one({"id": closing["id"]}, {"$set": {"invoice_id": existing["id"]}})
        return existing
    declaration = closing["declaration"]
    sale_object = declaration["sale_object"]
    property = await db.properties.find_one({"id": closing["property_id"]}, {"_id": 0}) or {"id": closing["property_id"]}
    mandate = await _mandate_for(property)
    debtor = await build_debtor(closing, property, mandate)
    commission = business_model.calculate_commission(declaration["final_price"])
    issued_on = now.date()
    due_on = invoice_due_on(_parse_date(declaration["signed_on"]) or issued_on, issued_on, sale_object)
    test = bool(closing.get("is_test")) or await _is_test_closing(property, closing.get("buyer_id"), closing.get("seller_id"))
    if test:
        # Facture de test : compteur séparé, le compteur réel des factures n'avance jamais
        sequence = await next_sequence(INVOICE_TEST_COUNTER)
        number = f"TEST-FAC-{issued_on.year}-{sequence:05d}"
    else:
        sequence = await next_sequence("invoice")
        number = f"FAC-{issued_on.year}-{sequence:05d}"
    mandate_number = str((mandate or {}).get("registry_number") or (mandate or {}).get("contract_number") or "—")
    invoice = {
        "id": str(uuid.uuid4()),
        "number": number,
        "sequence": sequence,
        "status": INVOICE_ISSUED,
        "terms_version": business_model.COMMISSION_TERMS_VERSION,
        "closing_id": closing["id"],
        "offer_id": None if is_direct_offer_id(closing.get("offer_id")) else closing.get("offer_id"),
        "property_id": closing["property_id"],
        "property_label": closing.get("property_label") or property_label(property),
        "buyer_id": closing.get("buyer_id"),
        "mandate_id": (mandate or {}).get("id"),
        "mandate_number": mandate_number,
        "issued_on": issued_on.isoformat(),
        "issued_at": _iso(now),
        "sale_object": sale_object,
        "signed_on": declaration["signed_on"],
        "final_price": declaration["final_price"],
        "debtor": debtor,
        "lines": invoice_lines(commission, sale_object, mandate_number, closing.get("property_label") or property_label(property)),
        "commission": commission,
        "total_ht": commission["final_commission_ht"],
        "vat_rate": commission["vat_rate"],
        "vat": commission["vat"],
        "total_ttc": commission["final_commission_ttc"],
        "due_on": due_on.isoformat(),
        "due_days": INVOICE_DUE_DAYS,
        "payment_terms": INVOICE_PAYMENT_TEXT,
        "late_penalties": LATE_PENALTY_TEXT,
        "bank": bank_details(),
        "issuer": {"denomination": f"{LEGAL_ENTITY.get('denomination', 'AlterEgo')} SAS", "siren": LEGAL_ENTITY.get("siren"),
                   "vat_number": vat_number(), "address": LEGAL_ENTITY.get("adresse"), "carte_t": LEGAL_ENTITY.get("carte_t")},
        "redacteur": closing.get("redacteur"),
        "reminders": [],
        "reminder_count": 0,
        "formal_notice_at": None,
        "paid_on": None,
        "paid_amount": None,
        "cancelled_at": None,
        "cancelled_reason": None,
        "access_token": secrets.token_urlsafe(24),
        "created_at": _iso(now),
        "updated_at": _iso(now),
    }
    if test:
        invoice["is_test"] = True
    await db.invoices.insert_one(invoice)
    invoice.pop("_id", None)
    closing_update = {"invoice_id": invoice["id"], "invoice_number": number}
    # Une étape de vente réelle (annonce et parties réelles) facturée pendant l'essai garde son statut : seule sa facture est
    # une facture de test (supprimée par la purge, une facture réelle pourra ensuite être émise) ; l'étape n'est marquée
    # de test que si elle l'est par ses liens
    if test and (closing.get("is_test") or await _has_test_data(property, closing.get("buyer_id"), closing.get("seller_id"))):
        closing_update["is_test"] = True
    await db.closings.update_one({"id": closing["id"]}, {"$set": closing_update})
    closing["invoice_id"] = invoice["id"]
    if not debtor["address"]:
        await add_todo(TODO_INVOICE_ADDRESS, invoice["id"],
                       f"Facture n° {number} : adresse postale du vendeur absente du mandat et du profil",
                       ref={"invoice_id": invoice["id"], "closing_id": closing["id"], "property_id": closing["property_id"]})
    # E-mail au vendeur (lien vers le PDF, authentifié ou par jeton du lien)
    redacteur = closing.get("redacteur") or {}
    if redacteur.get("email") and redacteur_trusted(redacteur):
        redacteur_line = f"L'ordre de paiement prévu au mandat a été adressé au notaire en charge de la vente ({_redacteur_text(redacteur)})."
    elif redacteur.get("email"):
        redacteur_line = (f"Le notaire a été indiqué par l'acquéreur ({_redacteur_text(redacteur)}) : confirmez-le depuis votre "
                          "espace pour que nous lui adressions l'ordre de paiement prévu au mandat.")
    else:
        redacteur_line = "Renseignez le notaire en charge de la vente depuis votre espace pour que nous lui adressions l'ordre de paiement prévu au mandat."
    await email_user(debtor["user_id"], "invoice_issued", number=number, property_label=invoice["property_label"],
                     registry_number=mandate_number, issued_on=fmt_date_fr(issued_on), total_ht=fmt_eur_cents(invoice["total_ht"]),
                     vat=fmt_eur_cents(invoice["vat"]), total_ttc=fmt_eur_cents(invoice["total_ttc"]), due_on=fmt_date_fr(due_on),
                     payment_terms=INVOICE_PAYMENT_TEXT, link=invoice_link(invoice), redacteur_line=redacteur_line)
    await send_payment_order(closing, invoice)
    return invoice


def invoice_link(invoice: dict) -> str:
    return site_url(f"/api/invoices/{invoice['id']}/pdf?token={invoice.get('access_token', '')}")


def credit_note_link(invoice: dict) -> str:
    return site_url(f"/api/invoices/{invoice['id']}/avoir.pdf?token={invoice.get('access_token', '')}")


def redacteur_trusted(redacteur: dict) -> bool:
    """Notaire renseigné par le vendeur (débiteur de la facture) ou l'admin : seul destinataire possible de l'ordre de paiement"""
    return (redacteur or {}).get("set_by") in ("seller", "admin")


async def send_payment_order(closing: dict, invoice: dict) -> bool:
    """Ordre de paiement envoyé au notaire s'il a une adresse e-mail (lien signé vers le PDF). Un notaire indiqué par
    l'acquéreur doit d'abord être confirmé par le vendeur : sinon ligne « À faire » admin, rien n'est envoyé."""
    redacteur = closing.get("redacteur") or {}
    if not redacteur.get("email"):
        return False
    if not redacteur_trusted(redacteur):
        await add_todo(TODO_PAYMENT_ORDER, closing["id"],
                       f"Ordre de paiement {invoice.get('number', '')} : notaire indiqué par l'acquéreur, à confirmer par le vendeur",
                       ref={"closing_id": closing["id"], "invoice_id": invoice.get("id"), "property_id": closing.get("property_id")})
        return False
    link = site_url(f"/api/closing/{closing['id']}/payment-order.pdf?token={closing.get('payment_order_token', '')}")
    subject, html = render_email("payment_order_redacteur", name=redacteur.get("name", ""), property_label=closing["property_label"],
                                 registry_number=invoice.get("mandate_number", ""), number=invoice["number"],
                                 issued_on=fmt_date_fr(invoice["issued_on"]), total_ttc=fmt_eur_cents(invoice["total_ttc"]),
                                 total_ht=fmt_eur_cents(invoice["total_ht"]), due_on=fmt_date_fr(invoice["due_on"]),
                                 link=link, contact_email=LEGAL_ENTITY.get("email", ""))
    await send_brevo_email(redacteur["email"], redacteur.get("name", ""), subject, html)
    await db.closings.update_one({"id": closing["id"]}, {"$set": {"payment_order_sent_at": _iso(_now()),
                                                                  "payment_order_sent_to": redacteur["email"]}})
    return True


# ----------------------------------------------------------------------------------------------
# PDF (reportlab)

_NAVY = colors.HexColor("#0b1220")
_BORDER = colors.HexColor("#e3e7ee")
_SURFACE = colors.HexColor("#f5f7fa")


def _styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("CTitle", parent=base["Title"], fontSize=18, leading=22, alignment=0, spaceAfter=4, textColor=_NAVY),
        "h": ParagraphStyle("CHead", parent=base["Heading3"], fontSize=11, leading=14, spaceBefore=10, spaceAfter=4, textColor=_NAVY),
        "p": ParagraphStyle("CBody", parent=base["Normal"], fontSize=9.5, leading=13, spaceAfter=4),
        "small": ParagraphStyle("CSmall", parent=base["Normal"], fontSize=7.5, leading=10, textColor=colors.HexColor("#4b5563")),
        "cell": ParagraphStyle("CCell", parent=base["Normal"], fontSize=9, leading=12),
        "cellb": ParagraphStyle("CCellB", parent=base["Normal"], fontSize=9, leading=12, fontName="Helvetica-Bold"),
        "right": ParagraphStyle("CRight", parent=base["Normal"], fontSize=9, leading=12, alignment=2),
        "rightb": ParagraphStyle("CRightB", parent=base["Normal"], fontSize=9, leading=12, alignment=2, fontName="Helvetica-Bold"),
    }


def _p(text: str, style) -> Paragraph:
    return Paragraph(xml_escape(str(text or "")).replace("\n", "<br/>"), style)


def _kv_table(rows: List[tuple], st: dict, widths=(5 * cm, 12 * cm)) -> Table:
    data = [[_p(k, st["cellb"]), _p(v, st["cell"])] for k, v in rows]
    table = Table(data, colWidths=list(widths))
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (0, -1), _SURFACE),
                               ("GRID", (0, 0), (-1, -1), 0.4, _BORDER), ("TOPPADDING", (0, 0), (-1, -1), 4),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return table


def _two_columns(left: List[Paragraph], right: List[Paragraph]) -> Table:
    table = Table([[left, right]], colWidths=[8.5 * cm, 8.5 * cm])
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    return table


def _build(elements: List, test: bool = False) -> bytes:
    """PDF du module ; `test` : bandeau et filigrane « DOCUMENT DE TEST — SANS VALEUR JURIDIQUE » (facture, avoir,
    ordre de paiement ou mise en demeure d'une vente de test)"""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.8 * cm, leftMargin=1.8 * cm, topMargin=1.6 * cm, bottomMargin=1.6 * cm,
                            title=(f"{TEST_DOCUMENT_BANNER} — {site_name()}" if test else site_name()),
                            author=f"{LEGAL_ENTITY.get('denomination', 'AlterEgo')} SAS")
    if test:
        doc.build(pdf_test_banner(doc.width) + list(elements), onFirstPage=draw_test_watermark, onLaterPages=draw_test_watermark)
    else:
        doc.build(elements)
    return buffer.getvalue()


def _entity_block(st: dict) -> List[Paragraph]:
    return [_p(site_name(), st["cellb"])] + [_p(line, st["small"]) for line in entity_lines()]


def _debtor_block(debtor: dict, st: dict, heading: str = "Facturé à") -> List[Paragraph]:
    block = [_p(heading, st["cellb"]), _p(debtor.get("name", ""), st["cell"])]
    if debtor.get("company_name"):
        structure = f" ({debtor['legal_structure']})" if debtor.get("legal_structure") else ""
        block.append(_p(f"{debtor['company_name']}{structure}", st["cell"]))
    if debtor.get("siren"):
        block.append(_p(f"SIREN {fmt_siren(debtor['siren'])}", st["cell"]))
    if debtor.get("address"):
        block.append(_p(debtor["address"], st["cell"]))
    if debtor.get("email"):
        block.append(_p(debtor["email"], st["cell"]))
    return block


def _lines_table(invoice: dict, st: dict) -> Table:
    hl = ParagraphStyle("hdrL", parent=st["cellb"], textColor=colors.white)
    hr = ParagraphStyle("hdrR", parent=st["rightb"], textColor=colors.white)
    data = [[_p("Désignation", hl), _p("Base", hr), _p("Taux", hr), _p("Montant HT", hr)]]
    for i, line in enumerate(invoice["lines"]):
        label = (f"{line['designation']}\n{line['label']}" if i == 0 and line.get("designation") else line["label"])
        rate = f"{round(line['rate'] * 100, 2):g} %".replace(".", ",") if line.get("rate") is not None else "—"
        base = fmt_eur_cents(line["base"]) if line.get("base") is not None else "—"
        data.append([_p(label, st["cell"]), _p(base, st["right"]), _p(rate, st["right"]), _p(fmt_eur_cents(line["amount_ht"]), st["right"])])
    vat_pct = f"{round(float(invoice['vat_rate']) * 100, 2):g} %".replace(".", ",")
    data.append([_p("Total HT", st["rightb"]), "", "", _p(fmt_eur_cents(invoice["total_ht"]), st["rightb"])])
    data.append([_p(f"TVA {vat_pct}", st["right"]), "", "", _p(fmt_eur_cents(invoice["vat"]), st["right"])])
    data.append([_p("Total TTC", st["rightb"]), "", "", _p(fmt_eur_cents(invoice["total_ttc"]), st["rightb"])])
    table = Table(data, colWidths=[9.2 * cm, 3 * cm, 1.8 * cm, 3 * cm], repeatRows=1)
    n = len(invoice["lines"])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _NAVY),
        ("GRID", (0, 0), (-1, n), 0.4, _BORDER), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("SPAN", (0, n + 1), (2, n + 1)), ("SPAN", (0, n + 2), (2, n + 2)), ("SPAN", (0, n + 3), (2, n + 3)),
        ("LINEABOVE", (0, n + 1), (-1, n + 1), 0.6, _NAVY), ("BACKGROUND", (0, n + 3), (-1, n + 3), _SURFACE),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def invoice_pdf(invoice: dict) -> bytes:
    """Facture conforme L441-9 : identités, numéro, dates, désignation, HT/TVA/TTC, échéance, pénalités, IBAN"""
    st = _styles()
    status_note = ""
    if invoice.get("status") == INVOICE_PAID:
        status_note = f"Facture acquittée le {fmt_date_fr(invoice.get('paid_on'))} ({fmt_eur_cents(invoice.get('paid_amount'))})."
    elif invoice.get("status") == INVOICE_CANCELLED:
        status_note = f"Facture annulée le {fmt_date_fr(invoice.get('cancelled_at'))} : {invoice.get('cancelled_reason', '')}"
        credit = invoice.get("credit_note") or {}
        if credit.get("number"):
            status_note += (f" — annulée par l'avoir n° {credit['number']} du {fmt_date_fr(credit.get('issued_on'))} "
                            f"({fmt_eur_cents(-float(invoice.get('total_ttc') or 0))} TTC).")
    elif invoice.get("payments"):
        received = "; ".join(f"{fmt_eur_cents(p['amount'])} le {fmt_date_fr(p['paid_on'])}" for p in invoice["payments"])
        status_note = (f"Acompte(s) reçu(s) : {received}. Reste dû : {fmt_eur_cents(invoice_balance(invoice))} TTC, "
                       f"à régler au plus tard le {fmt_date_fr(invoice.get('due_on'))}.")
    elements = [
        _two_columns(_entity_block(st), [_p(f"FACTURE n° {invoice['number']}", st["title"]),
                                         _p(f"Date de facture : {fmt_date_fr(invoice['issued_on'])}", st["cell"]),
                                         _p(f"Date d'échéance : {fmt_date_fr(invoice['due_on'])}", st["cellb"]),
                                         _p(f"Mandat de vente n° {invoice.get('mandate_number', '')}", st["cell"]),
                                         _p(f"Acte authentique de vente signé le {fmt_date_fr(invoice.get('signed_on'))}", st["cell"])]),
        Spacer(1, 10),
        _two_columns(_debtor_block(invoice["debtor"], st), [
            _p("Opération", st["cellb"]),
            _p(f"{SALE_OBJECT_LABELS.get(invoice['sale_object'], 'vente du bien').capitalize()} : {invoice.get('property_label', '')}", st["cell"]),
            _p(f"Prix de vente : {fmt_eur_cents(invoice['final_price'])}", st["cell"]),
            _p("Nature : prestation de services (négociation immobilière, loi n° 70-9 du 2 janvier 1970)", st["cell"]),
        ]),
        Spacer(1, 12),
        _lines_table(invoice, st),
        Spacer(1, 10),
        _p("Conditions de règlement", st["h"]),
        _p(invoice["payment_terms"], st["p"]),
        _p(bank_text(), st["p"]),
        _p(invoice.get("late_penalties") or LATE_PENALTY_TEXT, st["p"]),
    ]
    if invoice.get("redacteur") and invoice["redacteur"].get("name"):
        elements.append(_p(f"Notaire en charge de la vente : {_redacteur_text(invoice['redacteur'])}", st["p"]))
    if status_note:
        elements += [Spacer(1, 6), _p(status_note, st["cellb"])]
    elements += [Spacer(1, 14),
                 _p("Honoraires de négociation dus en exécution du mandat de vente simple conclu avec le vendeur (rémunération de "
                    "l'intermédiaire, art. 6 de la loi n° 70-9 du 2 janvier 1970), exigibles à la signature de l'acte authentique "
                    "de vente et réglés par le notaire sur le prix. TVA sur les encaissements.", st["small"]),
                 _p(f"Document généré par {site_name()} le {fmt_date_fr(invoice.get('issued_on'))}.", st["small"])]
    return _build(elements, bool(invoice.get("is_test")))


def credit_note_pdf(invoice: dict) -> bytes:
    """Avoir annulant en totalité une facture émise (numérotation continue AV-AAAA-NNNNN, mentions de la facture d'origine)"""
    st = _styles()
    credit = invoice.get("credit_note") or {}
    elements = [
        _two_columns(_entity_block(st), [_p(f"AVOIR n° {credit.get('number', '')}", st["title"]),
                                         _p(f"Date de l'avoir : {fmt_date_fr(credit.get('issued_on'))}", st["cell"]),
                                         _p(f"Facture d'origine : n° {invoice['number']} du {fmt_date_fr(invoice['issued_on'])}", st["cellb"]),
                                         _p(f"Mandat de vente n° {invoice.get('mandate_number', '')}", st["cell"])]),
        Spacer(1, 10),
        _two_columns(_debtor_block(invoice["debtor"], st), [
            _p("Motif", st["cellb"]), _p(credit.get("reason") or invoice.get("cancelled_reason") or "", st["cell"])]),
        Spacer(1, 12),
        _kv_table([("Désignation", f"Annulation totale de la facture n° {invoice['number']} (honoraires de négociation)"),
                   ("Montant HT", fmt_eur_cents(credit.get("total_ht"))),
                   (f"TVA {round(float(invoice.get('vat_rate') or 0) * 100):g} %", fmt_eur_cents(credit.get("vat"))),
                   ("Montant TTC", fmt_eur_cents(credit.get("total_ttc")))], st),
        Spacer(1, 10),
        _p("Cet avoir annule la facture d'origine, qui n'est plus due. Aucun remboursement n'est à prévoir : la facture n'avait "
           "fait l'objet d'aucun encaissement.", st["p"]),
        Spacer(1, 14),
        _p(f"Document généré par {site_name()} le {fmt_date_fr(credit.get('issued_on'))}.", st["small"]),
    ]
    return _build(elements, bool(invoice.get("is_test")))


def payment_order_pdf(closing: dict, invoice: dict, seller: dict) -> bytes:
    """Ordre de paiement adressé au notaire en charge de la vente : instruction irrévocable prévue au mandat + rappel de la facture"""
    st = _styles()
    redacteur = closing.get("redacteur") or {}
    debtor = invoice["debtor"]
    elements = [
        _two_columns(_entity_block(st), [_p("ORDRE DE PAIEMENT", st["title"]),
                                         _p(f"Honoraires de négociation — facture n° {invoice['number']}", st["cellb"]),
                                         _p(f"Établi le {fmt_date_fr(invoice['issued_on'])}", st["cell"])]),
        Spacer(1, 10),
        _two_columns([_p("Destinataire (notaire en charge de la vente)", st["cellb"]),
                      _p(f"{REDACTEUR_LABELS.get(redacteur.get('type'), 'Notaire en charge de la vente')} : "
                         f"{redacteur.get('name') or 'à désigner par les parties'}", st["cell"]),
                      _p(redacteur.get("email") or "", st["cell"]), _p(redacteur.get("phone") or "", st["cell"])],
                     _debtor_block(debtor, st, heading="Donneur d'ordre (vendeur, débiteur des honoraires)")),
        Spacer(1, 12),
        _p("Objet", st["h"]),
        _p(f"{SALE_OBJECT_LABELS.get(invoice['sale_object'], 'vente du bien').capitalize()} : {closing.get('property_label', '')}, "
           f"acte authentique signé le {fmt_date_fr(invoice.get('signed_on'))}, prix de {fmt_eur_cents(invoice['final_price'])}, "
           f"acquéreur présenté par {site_name()} dans le cadre du mandat de vente n° {invoice.get('mandate_number', '')}.", st["p"]),
        _p("Instruction", st["h"]),
        _p(f"Conformément au mandat de vente simple conclu avec AlterEgo SAS ({site_name()}), le vendeur a donné ordre irrévocable au "
           f"notaire chargé de la vente de prélever la rémunération du mandataire sur le prix de vente et de la lui verser. Nous vous "
           f"remercions de bien vouloir procéder au règlement de la facture ci-dessous, par virement, et de nous confirmer la date "
           f"de paiement.", st["p"]),
        Spacer(1, 6),
        _kv_table([("Facture", f"n° {invoice['number']} du {fmt_date_fr(invoice['issued_on'])}"),
                   ("Montant HT", fmt_eur_cents(invoice["total_ht"])),
                   (f"TVA {round(float(invoice['vat_rate']) * 100):g} %", fmt_eur_cents(invoice["vat"])),
                   ("Montant TTC à régler", fmt_eur_cents(invoice["total_ttc"])),
                   ("Échéance", f"{fmt_date_fr(invoice['due_on'])} — {INVOICE_PAYMENT_TEXT}"),
                   ("Bénéficiaire", f"{LEGAL_ENTITY.get('denomination', 'AlterEgo')} SAS — {bank_text()}")], st),
        Spacer(1, 10),
        _p("Rappel", st["h"]),
        _p("AlterEgo SAS, titulaire de la carte professionnelle T, ne reçoit ni ne détient d'autres fonds que ceux représentatifs "
           "de sa rémunération ; elle n'intervient ni dans la négociation ni dans la rédaction de l'acte. Le présent ordre vaut "
           "instruction de règlement d'honoraires sur le prix et ne constitue pas un séquestre.", st["p"]),
        _p(LATE_PENALTY_TEXT, st["small"]),
        Spacer(1, 10),
        _p(f"Pour le vendeur (donneur d'ordre) : {debtor.get('name', '')}, ordre consenti dans le mandat n° {invoice.get('mandate_number', '')}.",
           st["cell"]),
        _p(f"Pour AlterEgo SAS : {LEGAL_ENTITY.get('representant', '')}, Présidente.", st["cell"]),
        Spacer(1, 10),
        _p(f"Document généré par {site_name()}. La facture correspondante est jointe au même lien ou disponible sur demande à "
           f"{LEGAL_ENTITY.get('email', '')}.", st["small"]),
    ]
    return _build(elements, bool(invoice.get("is_test") or closing.get("is_test")))


def formal_notice_pdf(invoice: dict, today: Optional[date] = None) -> bytes:
    """Modèle de mise en demeure (courrier à envoyer par le fondateur, en recommandé ou par e-mail avec accusé)"""
    st = _styles()
    today = today or _now().date()
    debtor = invoice["debtor"]
    reminders = invoice.get("reminders") or []
    reminder_dates = ", ".join(fmt_date_fr(r.get("sent_at")) for r in reminders) or "—"
    overdue_days = max(0, (today - _parse_date(invoice["due_on"])).days) if _parse_date(invoice["due_on"]) else 0
    deadline = today + timedelta(days=8)
    elements = [
        _two_columns(_entity_block(st), _debtor_block(debtor, st, heading="Destinataire")),
        Spacer(1, 10),
        _p(f"{LEGAL_ENTITY.get('rcs_ville', 'Versailles')}, le {fmt_date_fr(today)}", st["cell"]),
        _p("Lettre recommandée avec accusé de réception (ou e-mail avec accusé de réception)", st["small"]),
        Spacer(1, 8),
        _p("MISE EN DEMEURE DE PAYER", st["title"]),
        _p(f"Objet : facture n° {invoice['number']} du {fmt_date_fr(invoice['issued_on'])} — {fmt_eur_cents(invoice['total_ttc'])} TTC", st["cellb"]),
        Spacer(1, 8),
        _p(f"Madame, Monsieur {debtor.get('name', '')},", st["p"]),
        _p(f"En exécution du mandat de vente n° {invoice.get('mandate_number', '')}, nous vous avons adressé la facture d'honoraires "
           f"n° {invoice['number']} d'un montant de {fmt_eur_cents(invoice['total_ttc'])} TTC ({fmt_eur_cents(invoice['total_ht'])} HT), "
           f"relative à la {SALE_OBJECT_LABELS.get(invoice['sale_object'], 'vente du bien')} « {invoice.get('property_label', '')} », "
           f"dont l'acte authentique a été signé le {fmt_date_fr(invoice.get('signed_on'))}.", st["p"]),
        _p(f"Cette facture, échue le {fmt_date_fr(invoice['due_on'])} (soit depuis {overdue_days} jours), demeure impayée malgré nos rappels "
           f"des {reminder_dates}.", st["p"]),
        _p((f"Compte tenu des acomptes reçus ({fmt_eur_cents(invoice.get('paid_amount'))} TTC), le solde restant dû s'élève à "
            f"{fmt_eur_cents(invoice_balance(invoice))} TTC.") if invoice.get("payments") else "", st["p"]),
        _p(f"Par la présente, nous vous mettons en demeure de régler la somme de {fmt_eur_cents(invoice_balance(invoice))} sous huit jours "
           f"à compter de la réception de ce courrier, soit au plus tard le {fmt_date_fr(deadline)}, par virement "
           f"({bank_text()}).", st["p"]),
        _p("À défaut de règlement dans ce délai, nous engagerons sans autre avis le recouvrement de la créance par toute voie de droit "
           "(injonction de payer ou assignation devant le tribunal compétent), et vous serez redevable, outre le principal, des "
           "pénalités de retard au taux de trois fois le taux d'intérêt légal courant depuis la date d'échéance, de l'indemnité "
           "forfaitaire de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce) et, le cas échéant, des frais de "
           "procédure.", st["p"]),
        _p("La présente mise en demeure fait courir les intérêts au sens de l'article 1231-6 du Code civil.", st["p"]),
        _p("Si votre règlement nous est parvenu entre-temps, nous vous prions de ne pas tenir compte de ce courrier et de nous en "
           "excuser.", st["p"]),
        Spacer(1, 10),
        _p("Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.", st["p"]),
        Spacer(1, 16),
        _p(f"{LEGAL_ENTITY.get('representant', '')}, Présidente — {LEGAL_ENTITY.get('denomination', 'AlterEgo')} SAS ({site_name()})", st["cellb"]),
        Spacer(1, 10),
        _p("Pièce jointe : copie de la facture.", st["small"]),
    ]
    return _build(elements, bool(invoice.get("is_test")))


def _pdf_response(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{filename}"'})


# ----------------------------------------------------------------------------------------------
# Routes : PDF et factures


async def _invoice_for(invoice_id: str, user: Optional[dict], token: Optional[str]) -> dict:
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    allowed = False
    if user and (user.get("role") == "admin" or user.get("id") == (invoice.get("debtor") or {}).get("user_id")):
        allowed = True
    elif token and invoice.get("access_token") and secrets.compare_digest(invoice["access_token"], token):
        allowed = True
    if not allowed:
        raise HTTPException(status_code=403 if user else 401, detail="Non autorisé")
    return invoice


@router.get("/invoices/my")
async def my_invoices(current_user: dict = Depends(get_current_user)):
    """Factures dont l'utilisateur est le débiteur (vendeur)"""
    invoices = await db.invoices.find({"debtor.user_id": current_user["id"]}, {"_id": 0, "access_token": 0}).sort("issued_at", -1).to_list(200)
    return {"invoices": invoices}


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await _invoice_for(invoice_id, current_user, None)
    return public_invoice(invoice)


@router.get("/invoices/{invoice_id}/pdf")
async def invoice_pdf_route(invoice_id: str, token: Optional[str] = None, current_user: Optional[dict] = Depends(get_current_user_optional)):
    """PDF de la facture : vendeur débiteur ou admin (jeton Bearer), ou lien signé de l'e-mail (?token=)"""
    invoice = await _invoice_for(invoice_id, current_user, token)
    if not invoice.get("lines") or not invoice.get("debtor"):
        raise HTTPException(status_code=400, detail="Facture d'un ancien format (avant la refonte) : PDF non disponible, détail dans l'administration")
    pdf = await asyncio.to_thread(invoice_pdf, invoice)
    return _pdf_response(pdf, f"{invoice['number']}.pdf")


@router.get("/invoices/{invoice_id}/avoir.pdf")
async def credit_note_pdf_route(invoice_id: str, token: Optional[str] = None, current_user: Optional[dict] = Depends(get_current_user_optional)):
    """PDF de l'avoir d'une facture annulée : vendeur débiteur ou admin, ou lien signé de l'e-mail (?token=)"""
    invoice = await _invoice_for(invoice_id, current_user, token)
    if not (invoice.get("credit_note") or {}).get("number"):
        raise HTTPException(status_code=404, detail="Aucun avoir pour cette facture")
    pdf = await asyncio.to_thread(credit_note_pdf, invoice)
    return _pdf_response(pdf, f"{invoice['credit_note']['number']}.pdf")


@router.get("/closing/{closing_id}/payment-order.pdf")
async def payment_order_route(closing_id: str, token: Optional[str] = None, current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Ordre de paiement au notaire (vendeur, admin, ou lien signé envoyé au notaire)"""
    closing = await db.closings.find_one({"id": closing_id}, {"_id": 0})
    if not closing:
        raise HTTPException(status_code=404, detail="Étape de vente introuvable")
    # Le PDF reprend la facture du vendeur (donneur d'ordre : nom, adresse, SIREN) : jamais pour l'acquéreur
    allowed = bool(current_user and closing_role(closing, current_user) in ("seller", "admin"))
    if not allowed and token and closing.get("payment_order_token"):
        allowed = secrets.compare_digest(closing["payment_order_token"], token)
    if not allowed:
        raise HTTPException(status_code=403 if current_user else 401, detail="Non autorisé")
    if not closing.get("invoice_id"):
        raise HTTPException(status_code=400, detail="L'ordre de paiement est établi à la confirmation de la vente")
    invoice = await db.invoices.find_one({"id": closing["invoice_id"]}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    seller = await db.users.find_one({"id": closing["seller_id"]}, {"_id": 0, "password_hash": 0}) or {}
    pdf = await asyncio.to_thread(payment_order_pdf, closing, invoice, seller)
    return _pdf_response(pdf, f"ordre-de-paiement-{invoice['number']}.pdf")


# ----------------------------------------------------------------------------------------------
# Routes admin


@router.get("/admin/invoices")
async def admin_invoices(status: Optional[str] = None, current_user: dict = Depends(require_admin)):
    """Liste des factures (toutes, ou par statut : issued | paid | cancelled | draft | overdue)"""
    query: Dict[str, Any] = {}
    today = _now().date().isoformat()
    if status == "overdue":
        query = {"status": INVOICE_ISSUED, "due_on": {"$lt": today}}
    elif status:
        query = {"status": status}
    invoices = await db.invoices.find(query, {"_id": 0, "access_token": 0}).sort("sequence", -1).to_list(1000)
    for inv in invoices:
        inv["overdue"] = inv.get("status") == INVOICE_ISSUED and (inv.get("due_on") or "") < today
        inv["pdf_url"] = f"/api/invoices/{inv['id']}/pdf"
        if inv.get("formal_notice_at"):
            inv["formal_notice_url"] = f"/api/admin/invoices/{inv['id']}/mise-en-demeure.pdf"
    totals = {
        "issued_ht": round(sum(float(i.get("total_ht") or 0) for i in invoices if i.get("status") in (INVOICE_ISSUED, INVOICE_PAID)), 2),
        "paid_ht": round(sum(float(i.get("total_ht") or 0) for i in invoices if i.get("status") == INVOICE_PAID), 2),
        "overdue_ttc": round(sum(invoice_balance(i) for i in invoices if i.get("overdue")), 2),
    }
    return {"invoices": invoices, "totals": totals}


def invoice_balance(invoice: dict) -> float:
    """Reste dû TTC : total moins les encaissements enregistrés"""
    if invoice.get("balance_due") is not None and invoice.get("status") == INVOICE_ISSUED:
        return round(float(invoice["balance_due"]), 2)
    if invoice.get("status") == INVOICE_PAID:
        return 0.0
    return round(float(invoice.get("total_ttc") or 0) - float(invoice.get("paid_amount") or 0), 2)


@router.put("/admin/invoices/{invoice_id}/paid")
async def admin_invoice_paid(invoice_id: str, data: PaidInput, current_user: dict = Depends(require_admin)):
    """Encaissement (total ou partiel) : les règlements sont cumulés dans `payments[]` ; la facture n'est « payée »
    (acquittée) qu'une fois le total TTC encaissé. Un acompte laisse la facture émise : relances et mise en demeure
    portent sur le solde."""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    if invoice.get("status") == INVOICE_CANCELLED:
        raise HTTPException(status_code=400, detail="Facture annulée")
    if invoice.get("status") == INVOICE_PAID:
        raise HTTPException(status_code=400, detail="Cette facture est déjà entièrement payée")
    paid_on = _parse_date(data.paid_on)
    if not paid_on or paid_on > _now().date():
        raise HTTPException(status_code=400, detail="Date d'encaissement invalide")
    amount = round(float(data.amount), 2)
    balance_before = invoice_balance(invoice)
    if amount > balance_before + 0.01:
        raise HTTPException(status_code=400, detail=f"Montant supérieur au reste dû ({fmt_eur_cents(balance_before)} TTC)")
    now = _now()
    total_ttc = round(float(invoice.get("total_ttc") or 0), 2)
    payments = list(invoice.get("payments") or [])
    payments.append({"paid_on": paid_on.isoformat(), "amount": amount, "by_admin": current_user["id"], "at": _iso(now)})
    paid_total = round(sum(float(p["amount"]) for p in payments), 2)
    balance = round(max(0.0, total_ttc - paid_total), 2)
    fully_paid = paid_total >= total_ttc - 0.01
    update = {"paid_amount": paid_total, "balance_due": 0.0 if fully_paid else balance, "payments": payments,
              "paid_by_admin": current_user["id"], "updated_at": _iso(now)}
    if fully_paid:
        update.update({"status": INVOICE_PAID, "paid_on": paid_on.isoformat()})
    await db.invoices.update_one({"id": invoice_id}, {"$set": update})
    debtor_id = (invoice.get("debtor") or {}).get("user_id")
    if fully_paid:
        await close_todos(TODO_INVOICE_OVERDUE, invoice_id, "Facture payée")
        await db.closings.update_one({"id": invoice.get("closing_id")}, {"$set": {"paid_at": _iso(now), "updated_at": _iso(now)}})
        await email_user(debtor_id, "invoice_paid", number=invoice["number"], amount=fmt_eur_cents(amount), paid_on=fmt_date_fr(paid_on))
    else:
        await email_user(debtor_id, "invoice_partial_payment", number=invoice["number"], amount=fmt_eur_cents(amount),
                         paid_on=fmt_date_fr(paid_on), paid_total=fmt_eur_cents(paid_total), balance=fmt_eur_cents(balance),
                         total_ttc=fmt_eur_cents(total_ttc), due_on=fmt_date_fr(invoice.get("due_on")), link=invoice_link(invoice))
    invoice.update(update)
    return public_invoice(invoice)


@router.put("/admin/invoices/{invoice_id}/cancel")
async def admin_invoice_cancel(invoice_id: str, data: CancelInput, current_user: dict = Depends(require_admin)):
    """Annulation motivée d'une facture émise : avoir AV-AAAA-NNNNN (compteur continu) qui l'annule en totalité, e-mail au
    vendeur ; la vente reste confirmée mais sans facture active : l'admin corrige la déclaration
    (PUT /admin/closings/{id}/declaration) et une nouvelle facture est émise sous le numéro suivant."""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    if invoice.get("status") == INVOICE_PAID:
        raise HTTPException(status_code=400, detail="Une facture payée ne peut pas être annulée")
    if invoice.get("status") == INVOICE_CANCELLED:
        raise HTTPException(status_code=400, detail="Facture déjà annulée")
    if invoice.get("payments"):
        raise HTTPException(status_code=400, detail="Un acompte a été encaissé sur cette facture : annulation impossible")
    now = _now()
    update = {"status": INVOICE_CANCELLED, "cancelled_at": _iso(now), "cancelled_reason": data.reason.strip(),
              "cancelled_by_admin": current_user["id"], "updated_at": _iso(now)}
    if invoice.get("lines"):  # factures v2 (les brouillons d'avant la refonte n'ont jamais été émises)
        issued_on = now.date()
        if invoice.get("is_test"):
            sequence = await next_sequence(CREDIT_NOTE_TEST_COUNTER)
            credit_number = f"TEST-AV-{issued_on.year}-{sequence:05d}"
        else:
            sequence = await next_sequence("credit_note")
            credit_number = f"AV-{issued_on.year}-{sequence:05d}"
        update["credit_note"] = {"number": credit_number, "sequence": sequence, "issued_on": issued_on.isoformat(),
                                 "issued_at": _iso(now), "reason": data.reason.strip(), "total_ht": -float(invoice.get("total_ht") or 0),
                                 "vat": -float(invoice.get("vat") or 0), "total_ttc": -float(invoice.get("total_ttc") or 0)}
    res = await db.invoices.update_one({"id": invoice_id, "status": {"$ne": INVOICE_CANCELLED}}, {"$set": update})
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Facture déjà annulée")
    await close_todos(TODO_INVOICE_OVERDUE, invoice_id, "Facture annulée")
    await close_todos(TODO_INVOICE_ADDRESS, invoice_id, "Facture annulée")
    if invoice.get("closing_id"):
        # La vente n'a plus de facture active : une facture corrigée pourra être émise
        await db.closings.update_one({"id": invoice["closing_id"], "invoice_id": invoice_id}, {
            "$unset": {"invoice_id": "", "invoice_number": ""},
            "$push": {"invoice_history": {"invoice_id": invoice_id, "number": invoice.get("number"), "cancelled_at": _iso(now),
                                          "reason": data.reason.strip(), "credit_note": (update.get("credit_note") or {}).get("number")}},
            "$set": {"updated_at": _iso(now)}})
    invoice.update(update)
    if update.get("credit_note"):
        credit = update["credit_note"]
        await email_user((invoice.get("debtor") or {}).get("user_id"), "invoice_cancelled", number=invoice["number"],
                         credit_number=credit["number"], issued_on=fmt_date_fr(credit["issued_on"]), reason=credit["reason"],
                         total_ttc=fmt_eur_cents(invoice.get("total_ttc")), link=credit_note_link(invoice))
    return public_invoice(invoice)


class DeclarationCorrection(BaseModel):
    signed_on: str = Field(..., description="Date de signature de l'acte (AAAA-MM-JJ)")
    final_price: float = Field(..., gt=0)
    sale_object: str = Field(..., description="bien | parts")
    note: Optional[str] = Field(None, max_length=2000)


@router.put("/admin/closings/{closing_id}/declaration")
async def admin_correct_declaration(closing_id: str, data: DeclarationCorrection, current_user: dict = Depends(require_admin)):
    """Vente confirmée dont la facture a été annulée (avoir) : l'admin corrige la déclaration (date, prix, objet) et une
    nouvelle facture est émise sous le numéro suivant"""
    closing = await db.closings.find_one({"id": closing_id}, {"_id": 0})
    if not closing:
        raise HTTPException(status_code=404, detail="Étape de vente introuvable")
    if closing["status"] != STATUS_CONFIRMED:
        raise HTTPException(status_code=400, detail="Seule une vente confirmée se corrige ici (sinon : déclaration ou arbitrage)")
    if closing.get("invoice_id"):
        active = await db.invoices.find_one({"id": closing["invoice_id"]}, {"_id": 0, "status": 1})
        if active and active.get("status") != INVOICE_CANCELLED:
            raise HTTPException(status_code=400, detail="Annulez d'abord la facture en cours (un avoir sera émis)")
    signed_on = _parse_date(data.signed_on)
    if not signed_on or signed_on > _now().date():
        raise HTTPException(status_code=400, detail="Date de signature invalide (format AAAA-MM-JJ, pas dans le futur)")
    sale_object = (data.sale_object or "").strip().lower()
    if sale_object not in SALE_OBJECTS:
        raise HTTPException(status_code=400, detail={"code": "validation", "message": "Objet de la vente invalide (bien ou parts)"})
    now = _now()
    declaration = {**(closing.get("declaration") or {}), "signed_on": signed_on.isoformat(), "final_price": round(float(data.final_price), 2),
                   "sale_object": sale_object, "corrected_by_admin": current_user["id"], "corrected_at": _iso(now),
                   "correction_note": (data.note or "").strip() or None}
    await db.closings.update_one({"id": closing_id}, {"$set": {"declaration": declaration, "sale_object": sale_object, "updated_at": _iso(now)},
                                                      "$unset": {"invoice_id": "", "invoice_number": ""},
                                                      "$push": {"declarations": declaration}})
    closing.update({"declaration": declaration, "sale_object": sale_object})
    closing.pop("invoice_id", None)
    await issue_invoice(closing, now)
    closing = await db.closings.find_one({"id": closing_id}, {"_id": 0})
    return await _closing_view(closing, current_user)


@router.get("/admin/invoices/{invoice_id}/mise-en-demeure.pdf")
async def admin_formal_notice(invoice_id: str, current_user: dict = Depends(require_admin)):
    """Modèle de mise en demeure (après la troisième relance ; le fondateur l'envoie)"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Facture introuvable")
    if invoice.get("status") != INVOICE_ISSUED:
        raise HTTPException(status_code=400, detail="La mise en demeure ne concerne qu'une facture émise et impayée")
    pdf = await asyncio.to_thread(formal_notice_pdf, invoice)
    return _pdf_response(pdf, f"mise-en-demeure-{invoice['number']}.pdf")


@router.get("/admin/closings")
async def admin_closings(status: Optional[str] = None, current_user: dict = Depends(require_admin)):
    query = {"status": status} if status else {}
    closings = await db.closings.find(query, {"_id": 0, "tokens": 0, "payment_order_token": 0}).sort("updated_at", -1).to_list(1000)
    return {"closings": [public_closing(c) for c in closings]}


@router.put("/admin/closings/{closing_id}/resolve")
async def admin_resolve_closing(closing_id: str, data: ResolveInput, current_user: dict = Depends(require_admin)):
    """Contestation : l'admin confirme la vente (facture) ou annule la déclaration (retour à « en cours »)"""
    closing = await db.closings.find_one({"id": closing_id}, {"_id": 0})
    if not closing:
        raise HTTPException(status_code=404, detail="Étape de vente introuvable")
    if closing["status"] not in (STATUS_DECLARED, STATUS_DISPUTED):
        raise HTTPException(status_code=400, detail="Aucune déclaration à trancher")
    now = _now()
    action = data.resolved_action()
    if action == "confirm":
        closing = await confirm_closing(closing, by="admin", now=now, note=data.note or "")
    elif action == "cancel":
        await db.closings.update_one({"id": closing_id}, {
            "$set": {"status": STATUS_IN_PROGRESS, "declaration": None, "dispute": None, "updated_at": _iso(now),
                     "resolution": {"action": "cancel", "note": data.note or "", "by": current_user["id"], "at": _iso(now),
                                    "cancelled_declaration": closing.get("declaration")}}})
        await db.properties.update_one({"id": closing["property_id"]}, {"$unset": {"sale_declared_at": ""}})
        await close_todos(TODO_CLOSING_DISPUTED, closing_id, "Déclaration annulée par l'admin")
        await close_todos(TODO_DECLARATION_UNCONFIRMED, closing_id, "Déclaration annulée par l'admin")
        closing = await db.closings.find_one({"id": closing_id}, {"_id": 0})
    else:
        raise HTTPException(status_code=400, detail="Action invalide (confirm ou cancel)")
    return await _closing_view(closing, current_user)


@router.get("/admin/todos")
async def admin_todos(status: str = "open", current_user: dict = Depends(require_admin)):
    query = {} if status == "all" else {"status": status}
    todos = await db.todos.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"todos": todos}


@router.put("/admin/todos/{todo_id}/done")
async def admin_todo_done(todo_id: str, current_user: dict = Depends(require_admin)):
    res = await db.todos.update_one({"id": todo_id, "status": "open"},
                                    {"$set": {"status": "done", "done_at": _iso(_now()), "done_by": current_user["id"]}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ligne introuvable ou déjà traitée")
    return await db.todos.find_one({"id": todo_id}, {"_id": 0})


# ----------------------------------------------------------------------------------------------
# Tâche quotidienne : relances J+30/60/90, confirmation automatique, relances de facture, mise en demeure


async def _followup_closings(now: datetime) -> int:
    sent = 0
    async for closing in db.closings.find({"status": STATUS_IN_PROGRESS}, {"_id": 0}):
        start = _parse_dt(closing.get("accepted_at")) or _parse_dt(closing.get("created_at"))
        if not start:
            continue
        elapsed = (now - start).days
        due = [d for d in FOLLOWUP_DAYS if elapsed >= d]
        if not due:
            continue
        day = due[-1]  # une seule relance par passage : la plus récente échue (pas de rattrapage en rafale)
        if not await claim_once("closing_followup", f"{closing['id']}:{day}"):
            continue
        for role in ("seller", "buyer"):
            await email_user(closing.get(f"{role}_id"), "closing_followup", property_label=closing.get("property_label", ""),
                             days=str(day), **followup_links(closing, role))
        await db.closings.update_one({"id": closing["id"]}, {"$push": {"followups_sent": {"day": day, "at": _iso(now)}}})
        sent += 1
    return sent


async def _auto_confirm(now: datetime) -> int:
    confirmed = 0
    async for closing in db.closings.find({"status": STATUS_DECLARED}, {"_id": 0}):
        declaration = closing.get("declaration") or {}
        deadline = _parse_dt(declaration.get("confirm_deadline"))
        if not deadline or deadline > now:
            continue
        if declaration.get("declared_by") not in AUTO_CONFIRM_DECLARANTS:
            # Déclaration de l'acquéreur restée sans réponse : arbitrage admin (aucune facture sans accord du vendeur)
            await add_todo(TODO_DECLARATION_UNCONFIRMED, closing["id"],
                           f"Vente déclarée par l'acquéreur sans confirmation du vendeur : {closing.get('property_label', '')}",
                           ref={"closing_id": closing["id"], "property_id": closing.get("property_id")},
                           action=f"/api/admin/closings/{closing['id']}/resolve")
            continue
        if not await claim_once("closing_autoconfirm", closing["id"]):
            continue
        await confirm_closing(closing, by="auto", now=now, note=f"Confirmée automatiquement après {CONFIRMATION_DAYS} jours sans contestation")
        confirmed += 1
    return confirmed


async def _invoice_reminders(now: datetime) -> int:
    actions = 0
    today = now.date()
    async for invoice in db.invoices.find({"status": INVOICE_ISSUED}, {"_id": 0}):
        issued = _parse_date(invoice.get("issued_on"))
        due = _parse_date(invoice.get("due_on"))
        if not issued or not due:
            continue
        thresholds = _reminder_thresholds(invoice, issued, due)
        elapsed = (today - issued).days
        step = int(invoice.get("reminder_count") or 0)
        if step < len(thresholds) and elapsed >= thresholds[step]:
            if await claim_once("invoice_reminder", f"{invoice['id']}:{step + 1}"):
                overdue = today > due
                headline = "Facture en retard de paiement" if overdue else f"Rappel d'échéance ({REMINDER_LABELS[step].lower()})"
                status_line = (f"{REMINDER_LABELS[step]} : la facture ci-dessous est échue depuis le {fmt_date_fr(due)} et reste impayée à ce jour."
                               if overdue else
                               f"{REMINDER_LABELS[step]} : la facture ci-dessous arrive à échéance le {fmt_date_fr(due)}.")
                closing_line = ("Sans règlement après ce dernier rappel, une mise en demeure vous sera adressée."
                                if step == len(INVOICE_REMINDER_DAYS) - 1 else "")
                amount_text = fmt_eur_cents(invoice["total_ttc"])
                if invoice.get("payments"):
                    amount_text += f" (reste dû après acompte : {fmt_eur_cents(invoice_balance(invoice))})"
                await email_user((invoice.get("debtor") or {}).get("user_id"), "invoice_reminder", headline=headline, status_line=status_line,
                                 number=invoice["number"], issued_on=fmt_date_fr(issued), total_ttc=amount_text,
                                 due_on=fmt_date_fr(due), payment_terms=invoice.get("payment_terms", ""), link=invoice_link(invoice),
                                 closing_line=closing_line)
                await db.invoices.update_one({"id": invoice["id"]}, {
                    "$push": {"reminders": {"step": step + 1, "sent_at": _iso(now), "overdue": overdue}},
                    "$set": {"reminder_count": step + 1, "updated_at": _iso(now)}})
                step += 1
                actions += 1
        # Mise en demeure : après la 3e relance, une fois l'échéance passée
        if step >= len(INVOICE_REMINDER_DAYS) and today > due and not invoice.get("formal_notice_at"):
            if await claim_once("invoice_formal_notice", invoice["id"]):
                await db.invoices.update_one({"id": invoice["id"]}, {"$set": {"formal_notice_at": _iso(now), "updated_at": _iso(now)}})
                debtor = invoice.get("debtor") or {}
                await add_todo(TODO_INVOICE_OVERDUE, invoice["id"],
                               f"Facture n° {invoice['number']} impayée ({fmt_eur_cents(invoice_balance(invoice))} TTC restant dus, échue le "
                               f"{fmt_date_fr(due)}) : mise en demeure à envoyer à {debtor.get('name', '')}",
                               ref={"invoice_id": invoice["id"], "invoice_number": invoice["number"], "closing_id": invoice.get("closing_id"),
                                    "property_id": invoice.get("property_id"), "debtor_name": debtor.get("name", ""),
                                    "debtor_email": debtor.get("email", ""), "total_ttc": invoice["total_ttc"], "due_on": invoice["due_on"]},
                               action=f"/api/admin/invoices/{invoice['id']}/mise-en-demeure.pdf")
                actions += 1
    return actions


async def daily_job(now: Optional[datetime] = None) -> int:
    """Relances J+30/60/90, confirmations automatiques à 7 jours, relances de facture et mises en demeure (idempotent)"""
    now = now or _now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    total = 0
    total += await _followup_closings(now)
    total += await _auto_confirm(now)
    total += await _invoice_reminders(now)
    return total


__all__ = ["router", "daily_job", "create_closing_for_offer", "confirm_closing", "issue_invoice", "invoice_pdf", "credit_note_pdf",
           "payment_order_pdf", "formal_notice_pdf", "INVOICE_DUE_DAYS", "INVOICE_REMINDER_DAYS", "FOLLOWUP_DAYS", "CONFIRMATION_DAYS"]
