"""
Fiche de reprise du bail (docs/venteloc/SPEC.md §6.2, API.md §4), remplace le diagnostic de transmissibilité hérité.

Ce que l'acquéreur d'un bien loué doit savoir sur le bail en cours : le bail continue, dépôt de garantie, prorata,
révision du loyer, congé, droit de préférence du locataire commerçant, résidence gérée, vente de parts, décence
énergétique. Constantes françaises, phrases courtes, références légales ; information générale, le notaire vérifie et
rédige.

- lease_transfer_sheet(lease_type, property_type=None, sale_object=None, property=None, today=None) : fiche pure
  (testable) → {lease_type, lease_label, regime, sale_object, points: [{key, title, text, level}], dpe?, summary, disclaimer}.
- GET /lease-transfer/rules?lease_type=&property_type=&sale_object= : version publique, sans données du bien.
- GET /properties/{property_id}/lease-transfer : version complète (montants, dates, DPE du bien) pour le vendeur,
  l'admin et les acquéreurs dont l'accès au dossier est accordé.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import taxonomy
from business_model import fmt_eur_fr, site_name
from events import SlidingWindowLimiter, check_rate_limit
from server import api_error, db, get_current_user, is_property_owner

logger = logging.getLogger("bail")
router = APIRouter()
public_limiter = SlidingWindowLimiter(60, 60)

LEVEL_INFO = "info"
LEVEL_ATTENTION = "attention"
DATAROOM_GRANTED_STATUSES = ("granted",)
INDEXATION_LABELS = {"irl": "indice de référence des loyers (IRL)", "ilc": "indice des loyers commerciaux (ILC)",
                     "ilat": "indice des loyers des activités tertiaires (ILAT)", "aucune": "aucune indexation prévue au bail"}
MONTHS_FR = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre",
             "décembre")

DISCLAIMER = ("Information générale fournie à titre indicatif : elle ne remplace pas un conseil juridique. Le notaire "
              "vérifie la situation du bien et du bail, et rédige l'avant-contrat et l'acte authentique de vente.")


def fr_long_date(value: Any) -> str:
    """'2025-01-01' → « 1ᵉʳ janvier 2025 » ; '' si la date est illisible"""
    try:
        d = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return ""
    day = "1ᵉʳ" if d.day == 1 else str(d.day)
    return f"{day} {MONTHS_FR[d.month - 1]} {d.year}"


def fr_short_date(value: Any) -> str:
    try:
        d = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return ""
    return d.strftime("%d/%m/%Y")


def dpe_text(dpe_class: Optional[str], status: Dict[str, Optional[str]]) -> str:
    """Phrase d'alerte de décence énergétique (fiche du bien, fiche de reprise du bail)"""
    cls = str(dpe_class or "").strip().upper()
    when = fr_long_date(status.get("date"))
    if status.get("status") == "interdit":
        return (f"Logement classé {cls} : depuis le {when} il ne peut plus faire l'objet d'un nouveau bail ni d'un "
                "renouvellement. Le bail en cours continue jusqu'à son terme.")
    if status.get("status") == "echeance":
        return (f"Logement classé {cls} : à partir du {when} il ne pourra plus faire l'objet d'un nouveau bail ni d'un "
                "renouvellement. Le bail en cours continue jusqu'à son terme ; des travaux sont à prévoir avant cette date.")
    if status.get("status") == "ok":
        return (f"Classe énergie {cls} : aucune interdiction de louer n'est prévue par le calendrier actuel."
                if cls in {"A", "B", "C", "D"} else "Aucune interdiction de louer n'est prévue par le calendrier actuel.")
    return "Bail non soumis au calendrier de décence énergétique des logements."


def _point(key: str, title: str, text: str, level: str = LEVEL_INFO, summary: str = "") -> Dict[str, str]:
    return {"key": key, "title": title, "text": text, "level": level, "summary": summary}


def lease_transfer_sheet(lease_type: str, property_type: Optional[str] = None, sale_object: Optional[str] = None,
                         property: Optional[Dict[str, Any]] = None, today: Optional[str] = None) -> Dict[str, Any]:
    """Fiche de reprise du bail. `property` (facultatif) complète les textes avec les données du bien (dépôt de
    garantie, indexation, échéances, DPE). ValueError si le type de bail est inconnu."""
    lease = taxonomy.lease_type_by_id(lease_type)
    if not lease:
        raise ValueError("Type de bail inconnu")
    regime = lease["regime"]
    prop = property or {}
    property_type = property_type or prop.get("property_type")
    sale_object = sale_object if sale_object in taxonomy.SALE_OBJECT_IDS else (prop.get("sale_object") or "bien")
    if sale_object not in taxonomy.SALE_OBJECT_IDS:
        sale_object = "bien"
    housing = regime == "habitation"
    parts_only = sale_object == "parts"
    points: List[Dict[str, str]] = []

    # 1. Le bail continue (ou : la société reste bailleresse)
    if parts_only:
        points.append(_point(
            "vente_parts", "Vente des parts : rien ne change pour le locataire",
            "La société reste propriétaire du bien et bailleresse : la cession de ses parts ne change rien pour le locataire, "
            "ni bail, ni dépôt de garantie à transférer. L'acquéreur reprend la société avec son actif et son passif : une "
            "garantie d'actif et de passif est à négocier, et les statuts peuvent soumettre la cession à l'agrément des associés.",
            LEVEL_ATTENTION, "Vente des parts : la société reste bailleresse, garantie de passif à négocier."))
    else:
        points.append(_point(
            "bail_continue", "Le bail continue",
            "L'acquéreur devient le bailleur et reprend le bail en cours dans toutes ses conditions (loyer, durée, charges). "
            "Le locataire ne peut pas être expulsé du fait de la vente (article 1743 du code civil).",
            LEVEL_INFO, "Le bail en cours continue : l'acquéreur devient le bailleur."))
        # 2. Dépôt de garantie
        deposit = prop.get("deposit")
        amount = f" ({fmt_eur_fr(deposit)})" if isinstance(deposit, (int, float)) and deposit > 0 else ""
        if housing:
            text = (f"Le dépôt de garantie{amount} versé par le locataire reste dû au locataire : le nouveau bailleur devra le "
                    "lui restituer à son départ. La somme est réglée entre vendeur et acquéreur à l'acte, par le notaire "
                    "(article 22 de la loi du 6 juillet 1989).")
        else:
            text = (f"Le sort du dépôt de garantie{amount} dépend du bail : son transfert à l'acquéreur est à prévoir dans "
                    "l'acte de vente, qui organise en général le versement de la somme entre vendeur et acquéreur.")
        points.append(_point("depot_garantie", "Dépôt de garantie", text, LEVEL_ATTENTION,
                             "Dépôt de garantie : transféré à l'acquéreur à l'acte, à restituer au locataire à son départ."))
        # 3. Prorata
        points.append(_point(
            "prorata", "Prorata des loyers, des charges et de la taxe foncière",
            "Les loyers, les provisions sur charges et la taxe foncière de l'année sont répartis entre vendeur et acquéreur à "
            "la date de l'acte authentique, au prorata. La régularisation annuelle des charges avec le locataire est à "
            "organiser entre eux ; le notaire peut prévoir une somme mise de côté à cet effet.",
            LEVEL_INFO, "Loyers, charges et taxe foncière répartis au prorata à la date de l'acte."))
        if sale_object == "indifferent":
            points.append(_point(
                "vente_parts", "Si la vente se fait par cession des parts",
                "La société reste propriétaire et bailleresse : rien ne change pour le locataire. L'acquéreur reprend la "
                "société avec son passif : une garantie d'actif et de passif est à négocier.",
                LEVEL_INFO, "En cas de cession des parts, la société reste bailleresse."))

    # 4. Révision du loyer
    indexation = prop.get("indexation")
    index_text = INDEXATION_LABELS.get(indexation or "")
    if housing:
        text = ("Le loyer est révisable une fois par an, à la date anniversaire du bail, selon l'indice de référence des "
                "loyers (IRL) si le bail le prévoit. Depuis le 24 août 2022, le loyer d'un logement classé F ou G ne peut "
                "plus être augmenté, ni en cours de bail, ni au renouvellement (loi Climat et résilience).")
    elif regime == "commercial":
        text = ("Le loyer est révisé selon la clause d'indexation du bail (indice des loyers commerciaux pour un commerce, "
                "indice des loyers des activités tertiaires pour des bureaux) ou, à défaut, tous les trois ans (révision "
                "triennale, article L145-38 du code de commerce).")
    else:
        text = "Le loyer est révisé selon la clause d'indexation prévue au bail, le cas échéant, à sa date anniversaire."
    if index_text:
        text += f" Indexation déclarée par le vendeur : {index_text}."
    if prop.get("last_revision"):
        text += f" Dernière révision : {fr_short_date(prop['last_revision'])}."
    points.append(_point("revision", "Révision du loyer", text, LEVEL_INFO, "Loyer révisable à la date anniversaire du bail selon son indice."))

    # 5. Congé et sortie du locataire
    if housing:
        text = ("Un logement acheté occupé ne peut être repris par l'acquéreur pour y habiter (ou y loger un proche) qu'au "
                "terme du bail, et au plus tôt deux ans après l'achat. Le congé pour vendre n'est possible qu'au terme du "
                "premier renouvellement du bail en cours (article 15 de la loi du 6 juillet 1989). Un locataire âgé de plus "
                "de 65 ans aux ressources modestes bénéficie de protections particulières (offre de relogement).")
        if lease["id"] == "bail-mobilite":
            text += " Le bail mobilité (1 à 10 mois) ne se renouvelle pas : à son terme, le logement est libéré ou un nouveau bail est conclu."
        if prop.get("lease_end"):
            text += f" Prochaine échéance déclarée : {fr_short_date(prop['lease_end'])}."
        points.append(_point("conge", "Congé : ce que l'acquéreur peut faire, et quand", text, LEVEL_ATTENTION,
                             "Reprise pour habiter au terme du bail et au plus tôt deux ans après l'achat."))
    elif regime == "commercial" and lease["id"] != "residence-geree":
        text = ("Le bail commercial dure au moins neuf ans ; le locataire peut donner congé à chaque échéance triennale. "
                "Le bailleur qui refuse le renouvellement doit en principe verser une indemnité d'éviction (article L145-14 "
                "du code de commerce).")
        if prop.get("lease_end"):
            text += f" Prochaine échéance déclarée : {fr_short_date(prop['lease_end'])}."
        points.append(_point("bail_369", "Bail commercial 3-6-9", text, LEVEL_INFO,
                             "Bail commercial : neuf ans, congé triennal du locataire, indemnité d'éviction en cas de refus de renouvellement."))
        if not parts_only:
            points.append(_point(
                "preference", "Droit de préférence du locataire",
                "En cas de vente du local, le locataire commerçant ou artisan bénéficie d'un droit de préférence (article "
                "L145-46-1 du code de commerce) : le notaire lui notifie le prix et les conditions de la vente, et il dispose "
                "d'un mois pour se porter acquéreur. Ce droit ne s'applique pas notamment à la vente globale d'un immeuble "
                "comprenant plusieurs locaux commerciaux, ni à la vente au conjoint, à un ascendant ou à un descendant du "
                "vendeur. Le notaire vérifie et purge ce droit avant l'acte.",
                LEVEL_ATTENTION, "Droit de préférence du locataire commerçant, purgé par le notaire."))
    elif lease["id"] == "professionnel":
        points.append(_point(
            "bail_professionnel", "Bail professionnel",
            "Le bail professionnel dure au moins six ans ; le locataire peut le résilier à tout moment avec un préavis de six "
            "mois (article 57 A de la loi du 23 décembre 1986).",
            LEVEL_INFO, "Bail professionnel : six ans minimum, résiliable par le locataire avec six mois de préavis."))
    elif lease["id"] == "parking":
        points.append(_point(
            "location_parking", "Location d'un parking",
            "La location d'un parking ou d'un box indépendant d'un logement relève du code civil et du contrat : durée, "
            "préavis et révision sont ceux prévus au contrat de location.",
            LEVEL_INFO, "Parking : durée et congé selon le contrat."))

    # 6. Résidence gérée
    if lease["id"] == "residence-geree" or property_type == "residence-geree":
        text = ("Le lot est loué à l'exploitant de la résidence par un bail commercial, que l'acquéreur reprend en l'état "
                "(loyer, durée, répartition des charges et des travaux). Vérifiez la solidité financière de l'exploitant, "
                "l'échéance du bail et ses conditions de renouvellement.")
        if prop.get("operator_lease_end"):
            text += f" Fin du bail de l'exploitant déclarée : {fr_short_date(prop['operator_lease_end'])}."
        points.append(_point("exploitant", "Résidence gérée : le bail de l'exploitant", text, LEVEL_ATTENTION,
                             "Résidence gérée : bail commercial de l'exploitant repris en l'état."))

    # 7. Décence énergétique (logement)
    dpe = None
    if housing:
        points.append(_point(
            "decence_energetique", "Décence énergétique",
            "Un logement classé G ne peut plus faire l'objet d'un nouveau bail ni d'un renouvellement depuis le 1ᵉʳ janvier "
            "2025, un logement classé F à partir du 1ᵉʳ janvier 2028 et un logement classé E à partir du 1ᵉʳ janvier 2034 "
            "(loi Climat et résilience). Le bail en cours continue jusqu'à son terme ; des travaux sont à prévoir avant tout "
            "nouveau bail ou renouvellement.",
            LEVEL_ATTENTION if (prop.get("dpe_class") or "").upper() in taxonomy.DPE_RENTAL_BAN else LEVEL_INFO,
            "Décence énergétique : G interdit depuis 2025, F en 2028, E en 2034 (bail en cours maintenu)."))
    if prop.get("dpe_class"):
        status = taxonomy.dpe_rental_status(prop.get("dpe_class"), lease["id"], today)
        dpe = {"status": status["status"], "date": status["date"], "text": dpe_text(prop.get("dpe_class"), status)}

    summary = [p["summary"] for p in points if p.get("summary")]
    sheet = {
        "lease_type": lease["id"],
        "lease_label": lease["label"],
        "regime": regime,
        "property_type": property_type,
        "sale_object": sale_object,
        "points": [{k: p[k] for k in ("key", "title", "text", "level")} for p in points],
        "summary": summary,
        "disclaimer": DISCLAIMER,
        "source": site_name(),
    }
    if dpe:
        sheet["dpe"] = dpe
    return sheet


# ----------------------------------------------------------------------------------------------
# Routes

@router.get("/lease-transfer/rules")
async def lease_transfer_rules(request: Request, lease_type: str, property_type: Optional[str] = None,
                               sale_object: Optional[str] = None):
    """Version publique de la fiche de reprise du bail (aucune donnée de bien)"""
    check_rate_limit(request, public_limiter, "lease_transfer")
    if property_type and not taxonomy.property_type_by_id(property_type):
        raise api_error(400, "validation", "Type de bien inconnu", field="property_type")
    if sale_object and sale_object not in taxonomy.SALE_OBJECT_IDS:
        raise api_error(400, "validation", "Objet de la vente inconnu", field="sale_object")
    try:
        return lease_transfer_sheet(lease_type, property_type, sale_object)
    except ValueError as e:
        raise api_error(400, "validation", str(e), field="lease_type")


async def has_dataroom_access(property: Dict[str, Any], user: Optional[Dict[str, Any]]) -> bool:
    """Vendeur du bien, admin, ou acquéreur dont l'accès au dossier est accordé"""
    if not user:
        return False
    if user.get("role") == "admin" or is_property_owner(property, user):
        return True
    access = await db.dataroom_access.find_one({"property_id": property["id"], "buyer_id": user["id"]}, {"_id": 0, "status": 1})
    return bool(access and access.get("status") in DATAROOM_GRANTED_STATUSES)


@router.get("/properties/{property_id}/lease-transfer")
async def property_lease_transfer(property_id: str, current_user: dict = Depends(get_current_user)):
    """Fiche de reprise du bail complétée avec les données du bien (accès au dossier accordé, vendeur, admin)"""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    if not await has_dataroom_access(property, current_user):
        raise api_error(403, "not_allowed", "Fiche réservée au vendeur et aux acquéreurs dont l'accès au dossier est ouvert")
    if not property.get("lease_type"):
        raise api_error(400, "validation", "Le type de bail n'est pas renseigné sur l'annonce", field="lease_type")
    sheet = lease_transfer_sheet(property["lease_type"], property.get("property_type"), property.get("sale_object"), property,
                                 today=datetime.now(timezone.utc).date().isoformat())
    sheet["property_id"] = property_id
    sheet["property_title"] = property.get("title") or ""
    return sheet
