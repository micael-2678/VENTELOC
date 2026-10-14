"""
Module métier partagé (CessionBâtiment / CessionRGE)
- Marque et URL du site (SITE_NAME, SITE_URL, SENDER_EMAIL, SENDER_NAME)
- Barème de la commission de cession (6 % HT, 3 % HT au-delà d'un million, minimum 4 000 € HT, cédant débiteur)
- Envoi d'e-mails Brevo et gabarits
- Offres et génération PDF
"""

from datetime import datetime, timedelta, timezone
import os
import stripe
import sib_api_v3_sdk
from sib_api_v3_sdk.rest import ApiException
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.units import cm
import io
import asyncio
import logging
import uuid

# Initialize Stripe
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")


# ============ MARQUE ET CONFIGURATION ============

def site_name() -> str:
    """Nom de marque affiché partout (e-mails, PDF, mentions). Jamais écrit en dur."""
    return os.environ.get("SITE_NAME", "").strip() or "CessionBâtiment"

def site_url(path: str = "") -> str:
    """URL publique du site (SITE_URL ; FRONTEND_URL conservé pour compatibilité)."""
    base = os.environ.get("SITE_URL", "").strip() or os.environ.get("FRONTEND_URL", "").strip() or "http://localhost:3000"
    return base.rstrip("/") + path

def sender_email() -> str:
    return os.environ.get("SENDER_EMAIL", "").strip() or "contact@cessionbatiment.fr"

def sender_name() -> str:
    return os.environ.get("SENDER_NAME", "").strip() or site_name()

def seller_commission_enabled() -> bool:
    """Commission de cession due par le cédant au succès (toujours activée en production ; désactivable pour un test)."""
    return os.environ.get("FF_SELLER_COMMISSION", "true").strip().lower() not in ("false", "0", "no")


# ============ MODE TEST (docs/refonte-2026-10/MODE-TEST-ET-APP.md, partie B) ============
# Primitives partagées par server.py, closing.py et testmode.py (ce module n'importe rien de l'application).
TEST_DOCUMENT_BANNER = "DOCUMENT DE TEST — SANS VALEUR JURIDIQUE"
# Domaine réservé aux comptes de démonstration (vendeur.demo@test.local…) : refusé à l'inscription, jamais envoyé à Brevo
DEMO_EMAIL_DOMAIN = "test.local"
TEST_EMAIL_RETENTION_DAYS = 30

def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("true", "1", "yes", "oui")

def test_mode_enabled() -> bool:
    """TEST_MODE=true : identité simulée, e-mails capturés, documents sans valeur juridique. Lu à chaque appel."""
    return _env_flag("TEST_MODE")

def test_mode_send_emails() -> bool:
    """En mode test, les e-mails capturés partent aussi par Brevo si TEST_MODE_SEND_EMAILS=true et qu'une clé est configurée"""
    return _env_flag("TEST_MODE_SEND_EMAILS") and bool(os.environ.get("BREVO_API_KEY", "").strip())

def is_demo_email(email) -> bool:
    return str(email or "").strip().lower().endswith("@" + DEMO_EMAIL_DOMAIN)

def is_test_related(*docs) -> bool:
    """Vrai si l'un des documents liés (utilisateur, annonce, contrat, étape de vente…) est une donnée de test"""
    return any(isinstance(d, dict) and d.get("is_test") for d in docs)

def mark_test(doc: dict, *related) -> dict:
    """Marque `is_test: true` une donnée créée pendant le mode test, ou rattachée à une donnée de test (utilisateur
    `is_test`, annonce de test…). Point unique appelé aux points de création ; la purge s'appuie sur ce marquage."""
    if test_mode_enabled() or is_test_related(*related):
        doc["is_test"] = True
    return doc


# ============ BARÈME DE LA COMMISSION ============
# 6 % HT du prix de cession jusqu'à 1 000 000 €, 3 % HT sur la part au-delà, minimum 4 000 € HT (COMMISSION_MIN_HT),
# TVA 20 %, toujours à la charge du cédant, exigible uniquement à la signature de l'acte de cession.
COMMISSION_RATE = 0.06
COMMISSION_RATE_ABOVE = 0.03
COMMISSION_THRESHOLD = 1_000_000
COMMISSION_TERMS_VERSION = "v2"
VAT_RATE = 0.20
COMMISSION_PAYER = "cedant"

def commission_minimum_ht() -> float:
    """Minimum HT (lu à l'appel pour tenir compte de l'environnement) : 4 000 € par défaut."""
    try:
        return float(os.environ.get("COMMISSION_MIN_HT", "4000") or 4000)
    except ValueError:
        return 4000.0

def commission_scale() -> dict:
    """Barème exposé par GET /config et repris par le front (offer.js)."""
    return {
        "mode": "simple",
        "rate_percent": 6,
        "rate_percent_above": 3,
        "threshold": COMMISSION_THRESHOLD,
        "minimum_ht": commission_minimum_ht(),
        "vat_rate": VAT_RATE,
        "payer": COMMISSION_PAYER,
        "terms_version": COMMISSION_TERMS_VERSION,
    }

# ============ PYDANTIC MODELS ============

# ============ HELPER FUNCTIONS ============

def fmt_eur_fr(amount) -> str:
    """Montant entier au format fr-FR : 4 000 €"""
    return f"{round(float(amount or 0)):,}".replace(",", "\u00a0") + "\u00a0€"

def calculate_commission(sale_amount: float) -> dict:
    """Commission de cession : 6 % HT jusqu'à 1 000 000 €, 3 % HT sur la part au-delà, minimum 4 000 € HT,
    TVA 20 %. Montants HT, TVA et TTC ; débiteur : le cédant."""
    sale_amount = float(sale_amount or 0)
    base_low = min(sale_amount, COMMISSION_THRESHOLD)
    base_high = max(0.0, sale_amount - COMMISSION_THRESHOLD)
    breakdown = []
    if base_low > 0:
        breakdown.append({"from": 0, "to": COMMISSION_THRESHOLD, "base": round(base_low, 2), "rate": COMMISSION_RATE,
                          "amount_ht": round(base_low * COMMISSION_RATE, 2)})
    if base_high > 0:
        breakdown.append({"from": COMMISSION_THRESHOLD, "to": None, "base": round(base_high, 2), "rate": COMMISSION_RATE_ABOVE,
                          "amount_ht": round(base_high * COMMISSION_RATE_ABOVE, 2)})
    computed = round(base_low * COMMISSION_RATE + base_high * COMMISSION_RATE_ABOVE, 2)
    minimum = commission_minimum_ht()
    final_ht = round(max(computed, minimum), 2)
    vat = round(final_ht * VAT_RATE, 2)
    effective_rate = (final_ht / sale_amount) if sale_amount else 0.0
    return {
        "sale_amount": sale_amount,
        "mode": "simple",
        "rate": round(effective_rate, 6),
        "rate_percent": f"{round(effective_rate * 100, 2):g} %".replace(".", ","),
        "nominal_rate_percent": "6 %",
        "breakdown": breakdown,
        "calculated_commission": computed,
        "minimum_fee": minimum,
        "final_commission": final_ht,
        "final_commission_ht": final_ht,
        "vat_rate": VAT_RATE,
        "vat": vat,
        "final_commission_ttc": round(final_ht + vat, 2),
        "applied_minimum": computed < minimum,
        "payer": COMMISSION_PAYER,
        "terms_version": COMMISSION_TERMS_VERSION,
    }

def commission_scale_text() -> str:
    """Texte unique du barème (mandat, NDA, pages publiques, e-mails)."""
    return ("6 % HT du prix de cession (3 % HT sur la part au-delà d'un million d'euros), "
            f"minimum {fmt_eur_fr(commission_minimum_ht())} HT, TVA en sus, à la charge du cédant, "
            "exigible uniquement à la signature de l'acte de cession. Rien avant. Rien pour le repreneur.")

def is_business_day(date: datetime) -> bool:
    """Check if date is a business day (Mon-Fri)"""
    return date.weekday() < 5

def add_business_days(start_date: datetime, days: int) -> datetime:
    """Add (or subtract, if days < 0) business days to a date"""
    current = start_date
    step = 1 if days >= 0 else -1
    added = 0
    while added < abs(days):
        current += timedelta(days=step)
        if is_business_day(current):
            added += 1
    return current

def legal_email_footer() -> str:
    """Pied de page légal commun à tous les e-mails (carte T, mention Hoguet)."""
    carte_t = os.environ.get("LEGAL_CARTE_T", "").strip() or "CPI 7801 2025 000 000 049"
    return (f"{site_name()} est opéré par AlterEgo SAS, 43 rue Massenet 78500 Sartrouville, RCS Versailles 952 180 230, "
            f"carte professionnelle T n° {carte_t} délivrée par la CCI Paris Île-de-France "
            "(Transactions sur immeubles et fonds de commerce). AlterEgo SAS déclare ne recevoir ni détenir d'autres fonds, "
            "effets ou valeurs que ceux représentatifs de sa rémunération.")

def wrap_email_html(html_content: str, unsubscribe_url: str = "") -> str:
    """Mise en page commune : contenu + un seul bouton d'action + pied de page légal.
    `unsubscribe_url` : lien de désinscription pour les e-mails non transactionnels."""
    unsubscribe = (f'<br><a href="{unsubscribe_url}" style="color:#6b7280">Ne plus recevoir ces e-mails</a>'
                   if unsubscribe_url else "")
    return f"""
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0b1220;line-height:1.5">
      <div style="padding:16px 0;border-bottom:2px solid #0b1220;font-size:20px;font-weight:bold">{site_name()}</div>
      <div style="padding:16px 0">{html_content}</div>
      <p style="padding:8px 0 24px"><a href="{site_url('/login')}" style="display:inline-block;padding:12px 24px;background:#0b1220;color:#ffffff;text-decoration:none;border-radius:8px">Accéder à mon espace</a></p>
      <div style="border-top:1px solid #e3e7ee;padding-top:12px;font-size:12px;color:#6b7280">
        {legal_email_footer()}<br>
        Cet e-mail vous est envoyé automatiquement à la suite d'une action sur votre compte.{unsubscribe}
      </div>
    </div>"""

def _send_brevo_email_sync(to_email: str, to_name: str, subject: str, html_content: str, unsubscribe_url: str = ""):
    # Clé lue à l'appel : le .env est chargé par server.py
    brevo_config = sib_api_v3_sdk.Configuration()
    brevo_config.api_key['api-key'] = os.environ.get("BREVO_API_KEY", "")
    api_instance = sib_api_v3_sdk.TransactionalEmailsApi(sib_api_v3_sdk.ApiClient(brevo_config))
    # E-mails non transactionnels : désinscription en un clic depuis le client de messagerie (RFC 8058, POST sur le lien)
    headers = ({"List-Unsubscribe": f"<{unsubscribe_url}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
               if unsubscribe_url else None)
    send_smtp_email = sib_api_v3_sdk.SendSmtpEmail(
        to=[{"email": to_email, "name": to_name or to_email}],
        sender={"email": sender_email(), "name": sender_name()},
        subject=subject,
        html_content=wrap_email_html(html_content, unsubscribe_url),
        headers=headers
    )
    return api_instance.send_transac_email(send_smtp_email)

# Base MongoDB (posée par server.py au démarrage du module) : compteur journalier d'envois et journal des échecs
email_db = None

def email_daily_soft_limit() -> int:
    """Plafond souple d'envois par jour (UTC) : le plan gratuit Brevo autorise 300 e-mails par jour. Au-delà de ce seuil,
    seuls les e-mails transactionnels (sans lien de désinscription) partent encore. 0 = pas de plafond."""
    try:
        return max(0, int(os.environ.get("EMAIL_DAILY_SOFT_LIMIT", "250")))
    except ValueError:
        return 250

async def _email_counter(day: str) -> int:
    doc = await email_db.email_counters.find_one({"_id": day})
    return int((doc or {}).get("sent", 0))

async def _record_email_failure(subject: str, error: str):
    """Échec d'envoi : consigné dans db.job_failures (rubrique « Échecs de tâches » de l'écran À faire)"""
    if email_db is None:
        return
    now = datetime.now(timezone.utc)
    try:
        await email_db.job_failures.insert_one({"job": "email", "kind": "email", "error": f"{subject} : {error}"[:1000],
                                                "at": now.isoformat(), "expire_at": now + timedelta(days=90)})
    except Exception as e:  # le journal ne doit jamais faire échouer l'appelant
        logging.warning(f"Échec d'envoi non journalisé : {e}")

async def _capture_test_email(to_email: str, to_name: str, subject: str, html_content: str, unsubscribe_url: str = ""):
    """Copie de l'e-mail (mise en page complète) dans db.test_emails ; ne fait jamais échouer l'appelant"""
    if email_db is None:
        return None
    now = datetime.now(timezone.utc)
    doc = {"id": str(uuid.uuid4()), "to": str(to_email).strip().lower(), "to_name": to_name or "", "subject": subject,
           "html": wrap_email_html(html_content, unsubscribe_url), "created_at": now.isoformat(), "is_test": True,
           "expire_at": now + timedelta(days=TEST_EMAIL_RETENTION_DAYS)}
    try:
        await email_db.test_emails.insert_one(doc)
    except Exception as e:
        logging.warning(f"E-mail de test non capturé ({subject}) : {e}")
        return None
    return doc["id"]

async def send_brevo_email(to_email: str, to_name: str, subject: str, html_content: str, template_id: int = None,
                           unsubscribe_url: str = ""):
    """Send email via Brevo API (sans bloquer le serveur, sans jamais faire échouer la requête appelante).
    Mode test : l'e-mail est capturé dans db.test_emails et n'est envoyé que si TEST_MODE_SEND_EMAILS=true (jamais aux
    adresses de démonstration @test.local).
    Les e-mails non transactionnels (avec lien de désinscription) ne partent plus au-delà de EMAIL_DAILY_SOFT_LIMIT envois
    dans la journée ; chaque échec est journalisé dans db.job_failures."""
    if not to_email or to_email.endswith("@anonyme.invalid"):
        return {"success": False, "error": "no recipient"}
    if test_mode_enabled():
        # Mode test : chaque e-mail est d'abord capturé dans la boîte de test (point unique d'interception)
        captured_id = await _capture_test_email(to_email, to_name, subject, html_content, unsubscribe_url)
        if not test_mode_send_emails() or is_demo_email(to_email):
            return {"success": True, "captured": True, "sent": False, "test_email_id": captured_id}
    elif is_demo_email(to_email):
        return {"success": False, "error": "no recipient"}
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    limit = email_daily_soft_limit()
    if email_db is not None and unsubscribe_url and limit:
        try:
            if await _email_counter(day) >= limit:
                logging.warning(f"Plafond journalier d'e-mails atteint ({limit}) : « {subject} » non envoyé")
                await _record_email_failure(subject, f"plafond journalier atteint ({limit} e-mails), e-mail non transactionnel reporté")
                return {"success": False, "error": "daily_soft_limit"}
        except Exception as e:
            logging.warning(f"Compteur d'e-mails illisible : {e}")
    try:
        if unsubscribe_url:
            api_response = await asyncio.to_thread(_send_brevo_email_sync, to_email, to_name, subject, html_content, unsubscribe_url)
        else:
            api_response = await asyncio.to_thread(_send_brevo_email_sync, to_email, to_name, subject, html_content)
    except (ApiException, Exception) as e:
        logging.warning(f"Envoi email Brevo échoué ({subject}): {e}")
        await _record_email_failure(subject, str(e))
        return {"success": False, "error": str(e)}
    if email_db is not None:
        try:
            await email_db.email_counters.update_one({"_id": day}, {"$inc": {"sent": 1}}, upsert=True)
        except Exception as e:
            logging.warning(f"Compteur d'e-mails non mis à jour : {e}")
    return {"success": True, "message_id": getattr(api_response, "message_id", None)}

class _Defaults(dict):
    """Les variables absentes d'un gabarit restent vides plutôt que de faire échouer l'envoi."""
    def __missing__(self, key):
        return ""

def render_email(template: str, **values) -> tuple:
    """(objet, html) d'un gabarit : les valeurs sont échappées pour le HTML, l'objet reste du texte brut ;
    `site_name` est toujours disponible."""
    from html import escape as html_escape
    tpl = EMAIL_TEMPLATES[template]
    raw = {k: str(v) for k, v in values.items()}
    raw["site_name"] = site_name()
    safe = {k: html_escape(v) for k, v in raw.items()}
    safe["site_name"] = site_name()
    return tpl["subject"].format_map(_Defaults(raw)), tpl["html"].format_map(_Defaults(safe))

def text_to_pdf(title: str, text: str, footer: str = "") -> bytes:
    """PDF simple (mandat, facture…) : titre, paragraphes, pied de page"""
    from xml.sax.saxutils import escape as xml_escape
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    body = ParagraphStyle('Body', parent=styles['Normal'], fontSize=10, leading=14, spaceAfter=6)
    elements = [Paragraph(xml_escape(title), ParagraphStyle('T', parent=styles['Title'], fontSize=15, spaceAfter=16)), Spacer(1, 6)]
    for block in (text or "").split("\n\n"):
        if block.strip():
            elements.append(Paragraph(xml_escape(block.strip()).replace("\n", "<br/>"), body))
    if footer:
        elements += [Spacer(1, 16), Paragraph(xml_escape(footer), ParagraphStyle('F', parent=styles['Normal'], fontSize=8, textColor=colors.grey))]
    doc.build(elements)
    return buffer.getvalue()

# ============ EMAIL TEMPLATES ============

EMAIL_TEMPLATES = {
    "verify_email": {
        "subject": "Confirmez votre adresse e-mail",
        "html": """
        <h2>Confirmez votre adresse e-mail</h2>
        <p>Bonjour {name},</p>
        <p>Merci de votre inscription sur {site_name}. Pour activer votre compte, confirmez votre adresse en cliquant sur ce lien (valable 48 heures) :</p>
        <p><a href="{link}">{link}</a></p>
        <p>Tant que votre adresse n'est pas confirmée, vous pouvez consulter les annonces mais ni contacter un cédant, ni créer une alerte, ni signer ou publier.</p>
        <p>Si vous n'êtes pas à l'origine de cette inscription, ignorez cet e-mail.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "admin_otp": {
        "subject": "Votre code de connexion administrateur",
        "html": """
        <h2>Code de connexion</h2>
        <p>Bonjour,</p>
        <p>Voici votre code pour terminer la connexion à l'administration de {site_name} :</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{code}</p>
        <p>Il est valable 10 minutes. Ne le communiquez à personne. Si vous n'êtes pas à l'origine de cette connexion, changez votre mot de passe sans attendre.</p>
        """
    },
    "account_deleted": {
        "subject": "Votre compte a été supprimé",
        "html": """
        <h2>Compte supprimé</h2>
        <p>Bonjour {name},</p>
        <p>Votre compte {site_name} a été supprimé et vos données personnelles anonymisées, conformément à notre politique de confidentialité.</p>
        <p>Les documents à valeur contractuelle (mandats, accords de confidentialité, factures et leurs preuves de signature) sont conservés pendant la durée légale, sans vos coordonnées.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "welcome": {
        "subject": "Bienvenue sur {site_name} !",
        "html": """
        <h2>Bienvenue sur {site_name} !</h2>
        <p>Bonjour {name},</p>
        <p>Votre compte a été créé avec succès.</p>
        <p>{role_message}</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "listing_draft": {
        "subject": "Votre annonce est enregistrée en brouillon",
        "html": """
        <h2>Encore une étape avant la mise en ligne</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce est enregistrée en brouillon. Pour protéger les acquéreurs et votre entreprise, elle sera publiée automatiquement dès que vous aurez vérifié votre identité et signé le mandat de vente simple (code reçu par e-mail).</p>
        <p>La vérification d'identité prend quelques minutes (pièce d'identité + selfie) depuis votre espace vendeur ; la signature du mandat se fait ensuite en ligne, sans frais.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "followup_30d": {
        "subject": "Où en êtes-vous avec ce vendeur ?",
        "html": """
        <h2>Votre avis nous aide à améliorer {site_name}</h2>
        <p>Bonjour {name},</p>
        <p>Il y a un mois, vous avez contacté le vendeur d'une entreprise du bâtiment ({property_label}). Où en êtes-vous ? Un seul clic suffit :</p>
        <p>
          <a href="{link_base}&r=en_discussion">Toujours en discussion</a><br>
          <a href="{link_base}&r=rencontre">Rencontre prévue ou faite</a><br>
          <a href="{link_base}&r=accord">Accord ou offre en cours</a><br>
          <a href="{link_base}&r=pas_de_suite">Pas de suite</a>
        </p>
        <p>Merci !<br>L'équipe {site_name}</p>
        """
    },
    "seller_no_listing": {
        "subject": "Votre annonce de cession en 10 minutes",
        "html": """
        <h2>Publiez votre annonce anonyme</h2>
        <p>Bonjour {name},</p>
        <p>Vous avez créé votre compte vendeur mais pas encore d'annonce. L'annonce est publiée sans frais : une commission n'est due qu'en cas de vente, à la signature de l'acte.</p>
        <p>Votre annonce reste anonyme : votre nom et celui de votre entreprise ne sont révélés qu'aux acquéreurs que vous validez, après signature d'un accord de confidentialité.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "seller_draft_reminder": {
        "subject": "Votre annonce attend deux étapes avant sa publication",
        "html": """
        <h2>Votre annonce est prête : vérification d'identité et mandat</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce est enregistrée en brouillon. Elle sera publiée automatiquement dès que vous aurez vérifié votre identité (quelques minutes, pièce d'identité + selfie) et signé le mandat de vente simple (code reçu par e-mail), depuis votre espace vendeur.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "listing_mandate_required": {
        "subject": "Dernière étape : signez votre mandat",
        "html": """
        <h2>Votre annonce est prête</h2>
        <p>Bonjour {name},</p>
        <p>Pour la publier, signez votre mandat de vente simple avec AlterEgo SAS (carte professionnelle T). La commission, à votre charge, n'est due que si la vente se fait, à la signature de l'acte.</p>
        <p>La signature se fait en ligne en deux minutes, avec un code reçu par e-mail : <a href="{link}">signer mon mandat</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "listing_mandate_backfill": {
        "subject": "Action requise : signez votre mandat pour garder votre annonce en ligne",
        "html": """
        <h2>Votre annonce est suspendue en attendant votre mandat</h2>
        <p>Bonjour {name},</p>
        <p>{site_name} est opéré par AlterEgo SAS, titulaire d'une carte professionnelle T. La loi impose un mandat écrit avant toute mise en relation : votre annonce a donc été retirée temporairement des résultats. Rien n'est supprimé.</p>
        <p>Signez votre mandat en ligne (deux minutes, code reçu par e-mail) et votre annonce reviendra dans le circuit de publication : <a href="{link}">signer mon mandat</a>.</p>
        <p>La publication reste gratuite ; une commission n'est due qu'en cas de vente.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "mandate_signed": {
        "subject": "Votre mandat n° {registry_number} est signé",
        "html": """
        <h2>Mandat signé</h2>
        <p>Bonjour {name},</p>
        <p>Votre mandat de vente simple n° {registry_number} ({contract_number}) est signé. Commission à la charge du cédant ({payer}), due uniquement à la signature de l'acte de cession.</p>
        <p>Le mandat signé est téléchargeable à tout moment depuis votre espace vendeur.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "listing_blocked": {
        "subject": "Votre annonce n'est pas encore publiable",
        "html": """
        <h2>Il manque quelques éléments</h2>
        <p>Bonjour {name},</p>
        <p>Votre mandat est signé, mais votre annonce ne peut pas encore être mise en ligne :</p>
        <ul>{reasons}</ul>
        <p>Corrigez ces points depuis votre espace et votre annonce partira immédiatement : <a href="{link}">accéder à mon espace</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "listing_rejected": {
        "subject": "Votre annonce n'a pas été publiée",
        "html": """
        <h2>Annonce non publiée</h2>
        <p>Bonjour {name},</p>
        <p>Après vérification, votre annonce n'a pas pu être publiée en l'état.</p>
        <p>Répondez à cet email ou contactez-nous pour en connaître la raison et la corriger.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "listing_removed": {
        "subject": "Votre annonce a été retirée",
        "html": """
        <h2>Annonce retirée</h2>
        <p>Bonjour {name},</p>
        <p>Après relecture, nous avons retiré votre annonce pour le motif suivant :</p>
        <p><strong>{reason}</strong></p>
        <p>Le mandat qui y était rattaché est caduc. Vous pouvez corriger votre annonce depuis votre espace et la soumettre à nouveau (un nouveau mandat vous sera proposé) : <a href="{link}">accéder à mon espace</a>.</p>
        <p>Vous pouvez contester ce retrait en répondant à cet e-mail ou en écrivant à l'adresse de contact du site ; nous vous répondons avec un motif. À défaut d'accord, les juridictions compétentes sont celles indiquées dans les conditions générales.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "admin_todo_digest": {
        "subject": "[Admin] À faire aujourd'hui : {count} ligne(s)",
        "html": """
        <h2>À faire</h2>
        {sections}
        <p><a href="{link}">Ouvrir l'onglet « À faire »</a></p>
        """
    },
    "document_signed": {
        "subject": "Nouvelle signature : {doc_label}",
        "html": """
        <h2>Nouvelle signature : {doc_label}</h2>
        <p>Bonjour {name},</p>
        <p>Un acquéreur a signé le document suivant pour votre entreprise : <strong>{doc_label}</strong> (n° {contract_number}).</p>
        <p>{next_step}</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "listing_modified": {
        "subject": "Votre annonce a été modifiée",
        "html": """
        <h2>Modification de votre annonce</h2>
        <p>Bonjour {name},</p>
        <p>Les modifications de votre annonce ont bien été enregistrées.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "seller_reminder": {
        "subject": "{subject_text}",
        "html": """
        <h2>Des messages attendent votre réponse</h2>
        <p>Bonjour {name},</p>
        <p>{intro}</p>
        <p><a href="{link}">Répondre depuis votre messagerie</a></p>
        <p>Même une réponse courte (« pas pour le moment », « parlons-en ») compte : un acquéreur sans nouvelles passe rapidement à une autre entreprise.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
}

# Export for use in main server.py
__all__ = [
    'site_name',
    'site_url',
    'sender_email',
    'sender_name',
    'seller_commission_enabled',
    'commission_scale',
    'commission_scale_text',
    'commission_minimum_ht',
    'fmt_eur_fr',
    'VAT_RATE',
    'COMMISSION_RATE',
    'COMMISSION_RATE_ABOVE',
    'COMMISSION_THRESHOLD',
    'COMMISSION_TERMS_VERSION',
    'COMMISSION_PAYER',
    'calculate_commission',
    'add_business_days',
    'send_brevo_email',
    'render_email',
    'legal_email_footer',
    'wrap_email_html',
    'text_to_pdf',
    'EMAIL_TEMPLATES',
    'TEST_DOCUMENT_BANNER',
    'DEMO_EMAIL_DOMAIN',
    'test_mode_enabled',
    'test_mode_send_emails',
    'is_demo_email',
    'is_test_related',
    'mark_test',
]
