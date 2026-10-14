"""
Estimateur public de valeur (SPEC §4.2 point 1), sans compte et gratuit.

- GET  /estimates/property/{siret} : préremplissage depuis l'open data (nom, NAF, création, effectif, département)
  et la liste ADEME (qualifications RGE) ; jamais bloquant (« vérification différée »).
- POST /estimates {siret?, ca, ebe, staff, maintenance_contracts, team_stays, owner_dispensable, email?}
  → {low, high, mid, method, drivers: [{label, effect}], pedagogy: [...], property, rge}.
  Base : 0,3-0,6 × CA et 2,5-4 × EBE combinés (pondération 40 % CA / 60 % EBE), ajustements ±15 % selon les trois
  cases (±5 % chacune), minimum 10 000 €, arrondi à 5 000 €.
  Avec `email` : enregistrement dans db.estimates avec consentement + e-mail de confirmation (double opt-in).
  Sans e-mail : rien n'est conservé de nominatif.
- GET  /estimates/confirm/{token} : confirme l'adresse, envoie l'estimation par e-mail ; redirige vers le site pour
  un navigateur, renvoie du JSON sinon.
- daily_job() : purge des estimations jamais confirmées (7 jours) et des estimations confirmées (3 ans).

Gabarits d'e-mail ajoutés à business_model.EMAIL_TEMPLATES (estimate_confirm, estimate_result).
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field

import opendata
import transmissibility
from business_model import EMAIL_TEMPLATES, fmt_eur_fr, mark_test, render_email, send_brevo_email, site_url
from events import SlidingWindowLimiter, check_rate_limit, visitor_hash
from server import client_ip, db

logger = logging.getLogger("estimator")
router = APIRouter()

# ----------------------------------------------------------------------------------------------
# Paramètres du calcul

CA_MULTIPLES = (0.3, 0.6)          # × chiffre d'affaires annuel HT
CA_MULTIPLES_NO_PROFIT = (0.3, 0.45)  # EBE nul ou négatif : le repreneur paie la clientèle et le matériel, pas un résultat
EBE_MULTIPLES = (2.5, 4.0)         # × EBE (excédent brut d'exploitation) retraité
CA_WEIGHT, EBE_WEIGHT = 0.4, 0.6   # pondération quand les deux approches sont disponibles
DRIVER_EFFECT = 5                  # ± 5 % par levier, soit ± 15 % au total
MIN_VALUE = 10_000
ROUNDING = 5_000
CONFIRM_TTL = timedelta(hours=48)
RESEND_DELAY = timedelta(minutes=2)
RATE_LIMIT_PER_MINUTE = 20
PENDING_RETENTION = timedelta(days=7)        # adresse jamais confirmée : effacée (pas de consentement)
CONFIRMED_RETENTION = timedelta(days=3 * 365)  # estimation confirmée : même durée qu'un compte (3 ans)

DRIVERS = (
    {"key": "maintenance_contracts", "label": "Contrats d'entretien récurrents",
     "on": "Des contrats d'entretien signés donnent au repreneur un chiffre d'affaires prévisible : c'est le premier levier de valeur.",
     "off": "Sans contrats d'entretien, le chiffre d'affaires est à reconstruire chaque année : proposez des contrats à vos clients dès maintenant, même modestes."},
    {"key": "team_stays", "label": "Référent technique et équipe qui restent",
     "on": "Une équipe qui reste (et le référent technique des qualifications RGE) rassure le repreneur et conserve les qualifications.",
     "off": "Si l'équipe ou le référent technique part avec vous, le repreneur achète une coquille : formez un second référent et fidélisez les salariés clés."},
    {"key": "owner_dispensable", "label": "Dirigeant non indispensable au quotidien",
     "on": "L'entreprise tourne sans vous au quotidien : le repreneur n'a pas à racheter votre carnet d'adresses.",
     "off": "Si tout passe par vous (devis, clients, chantiers), déléguez progressivement : un accompagnement de 3 à 6 mois après la vente se négocie aussi."},
)

PEDAGOGY_GENERIC = [
    "Un carnet de commandes signé sur plus de trois mois se valorise : tenez-le à jour avant de vendre.",
    "Des comptes à jour et un EBE retraité (rémunération du dirigeant, charges exceptionnelles) donnent confiance et justifient le haut de la fourchette.",
    "Des qualifications RGE en cours de validité avec un référent technique qui reste se négocient mieux en cession de titres qu'en cession de fonds.",
    "Une assurance décennale à jour sans sinistre et des locaux ou un bail transférables évitent les décotes de dernière minute.",
]

METHOD_LABELS = {
    "ca_ebe": "Fourchette combinée : 40 % de l'approche chiffre d'affaires (0,3 à 0,6 × CA) et 60 % de l'approche "
              "rentabilité (2,5 à 4 × EBE), ajustée de −15 % à +15 % selon vos trois réponses, arrondie à 5 000 €.",
    "ca": "Approche chiffre d'affaires seule (0,3 à 0,45 × CA, l'EBE étant nul ou négatif), ajustée de −15 % à +15 % "
          "selon vos trois réponses, arrondie à 5 000 €.",
    "ca_only": "Approche chiffre d'affaires seule (0,3 à 0,6 × CA, EBE non renseigné), ajustée de −15 % à +15 % selon "
               "vos trois réponses, arrondie à 5 000 €.",
    "ebe": "Approche rentabilité seule (2,5 à 4 × EBE, chiffre d'affaires non renseigné), ajustée de −15 % à +15 % "
           "selon vos trois réponses, arrondie à 5 000 €.",
}

limiter = SlidingWindowLimiter(RATE_LIMIT_PER_MINUTE, 60)


# ----------------------------------------------------------------------------------------------
# Gabarits d'e-mail (ajoutés sans écraser ceux de business_model)

EMAIL_TEMPLATES.setdefault("estimate_confirm", {
    "subject": "Confirmez votre adresse pour recevoir votre estimation",
    "html": """
    <h2>Votre estimation est prête</h2>
    <p>Bonjour,</p>
    <p>Vous avez demandé l'estimation de la valeur de votre entreprise sur {site_name}. Pour la recevoir, confirmez votre adresse e-mail en cliquant sur ce lien (valable 48 heures) :</p>
    <p><a href="{link}">{link}</a></p>
    <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre adresse ne sera pas conservée.</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("estimate_result", {
    "subject": "Votre estimation : entre {low} et {high}",
    "html": """
    <h2>Votre estimation indicative</h2>
    <p>Bonjour,</p>
    <p>D'après les éléments saisis{company_suffix}, la valeur de votre entreprise se situe entre <strong>{low}</strong> et <strong>{high}</strong> (valeur centrale : {mid}).</p>
    <p style="font-size:13px;color:#6b7280">{method}</p>
    <h3>Ce qui fait monter la valeur</h3>
    <p>• {pedagogy_1}</p>
    <p>• {pedagogy_2}</p>
    <p>• {pedagogy_3}</p>
    <p>Pour aller plus loin, déposez une annonce anonyme : rien à payer avant la vente, mandat simple sans exclusivité, résiliable à tout moment.</p>
    <p><a href="{link}">{link}</a></p>
    <p>Cette estimation est indicative et ne constitue ni une expertise ni une promesse de prix : le prix final dépend des négociations et de l'audit du repreneur.</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})


# ----------------------------------------------------------------------------------------------
# Calcul (pur, testable)


def round_to_step(value: float, step: int = ROUNDING) -> int:
    """Arrondi au multiple de `step` le plus proche, demi vers le haut (382 500 → 385 000)."""
    return int(math.floor(float(value) / step + 0.5) * step)


def compute_estimate(ca: Optional[float], ebe: Optional[float], staff: Optional[int] = None,
                     maintenance_contracts: bool = False, team_stays: bool = False,
                     owner_dispensable: bool = False) -> Dict[str, Any]:
    """
    Fourchette {low, high, mid, method, method_code, components, adjustment_percent, drivers, pedagogy}.
    Lève ValueError si ni le chiffre d'affaires ni l'EBE ne permettent un calcul.
    """
    ca = float(ca or 0)
    ebe_value = None if ebe is None else float(ebe)
    components: Dict[str, Any] = {}
    if ca > 0:
        mult = CA_MULTIPLES_NO_PROFIT if (ebe_value is not None and ebe_value <= 0) else CA_MULTIPLES
        components["ca"] = {"low": ca * mult[0], "high": ca * mult[1], "multiples": list(mult)}
    if ebe_value is not None and ebe_value > 0:
        components["ebe"] = {"low": ebe_value * EBE_MULTIPLES[0], "high": ebe_value * EBE_MULTIPLES[1],
                             "multiples": list(EBE_MULTIPLES)}
    if "ca" in components and "ebe" in components:
        code = "ca_ebe"
        low = CA_WEIGHT * components["ca"]["low"] + EBE_WEIGHT * components["ebe"]["low"]
        high = CA_WEIGHT * components["ca"]["high"] + EBE_WEIGHT * components["ebe"]["high"]
    elif "ca" in components:
        code = "ca" if ebe_value is not None else "ca_only"
        low, high = components["ca"]["low"], components["ca"]["high"]
    elif "ebe" in components:
        code = "ebe"
        low, high = components["ebe"]["low"], components["ebe"]["high"]
    else:
        raise ValueError("Indiquez au moins un chiffre d'affaires ou un EBE positif pour obtenir une estimation.")

    answers = {"maintenance_contracts": bool(maintenance_contracts), "team_stays": bool(team_stays),
               "owner_dispensable": bool(owner_dispensable)}
    drivers = []
    adjustment = 0
    for d in DRIVERS:
        active = answers[d["key"]]
        effect = DRIVER_EFFECT if active else -DRIVER_EFFECT
        adjustment += effect
        drivers.append({"key": d["key"], "label": d["label"], "active": active, "effect": effect,
                        "effect_label": f"{'+' if effect > 0 else '−'}{abs(effect)} %",
                        "hint": d["on"] if active else d["off"]})
    factor = 1 + adjustment / 100
    low_r = max(MIN_VALUE, round_to_step(low * factor))
    high_r = max(low_r + ROUNDING, round_to_step(high * factor))
    mid_r = round_to_step((low_r + high_r) / 2)

    pedagogy = [d["off"] for d in DRIVERS if not answers[d["key"]]]
    if staff is not None and int(staff) == 0:
        pedagogy.append("Sans salarié, la valeur repose sur votre clientèle et votre matériel : un repreneur paiera surtout "
                        "les contrats récurrents et un accompagnement de votre part.")
    pedagogy.extend(PEDAGOGY_GENERIC)
    return {
        "low": low_r,
        "high": high_r,
        "mid": mid_r,
        "method": METHOD_LABELS[code],
        "method_code": code,
        "components": {k: {"low": round_to_step(v["low"]), "high": round_to_step(v["high"]), "multiples": v["multiples"]}
                       for k, v in components.items()},
        "adjustment_percent": adjustment,
        "drivers": drivers,
        "pedagogy": pedagogy[:5],
    }


# ----------------------------------------------------------------------------------------------
# Préremplissage (open data + ADEME), jamais bloquant

DEFERRED_MESSAGE = "Vérification différée : l'annuaire des entreprises n'a pas répondu, vous pouvez continuer."


def company_prefill(property: Dict[str, Any]) -> Dict[str, Any]:
    """Champs d'annonce préremplis depuis opendata.lookup_siren (voir HANDOFF taxonomie-opendata §3)."""
    if not property.get("available"):
        return {"available": False, "found": False, "message": property.get("message") or DEFERRED_MESSAGE}
    if not property.get("found"):
        return {"available": True, "found": False,
                "message": property.get("message") or "SIRET inconnu de l'annuaire des entreprises."}
    trade = property.get("trade_suggestion")
    return {
        "available": True,
        "found": True,
        "message": "",
        "siren": property.get("siren"),
        "siret": property.get("siret"),
        "company_name": property.get("nom_complet") or "",
        "naf_code": property.get("naf") or "",
        "naf_label": property.get("naf_libelle") or "",
        "naf_in_building": property.get("naf_in_building"),
        "creation_date": property.get("date_creation") or "",
        "staff_count": property.get("effectif_estime"),
        "staff_label": property.get("tranche_effectif_libelle") or "",
        "department": property.get("departement") or "",
        "department_label": property.get("departement_libelle") or "",
        "region": property.get("region") or "",
        "legal_structure": property.get("legal_structure") or "",
        "forme_juridique": property.get("forme_juridique") or "",
        "trades": [trade] if trade else [],
        "etat": property.get("etat"),
        "siren_active": property.get("siren_active"),
    }


async def lookup_company(siret: str) -> Dict[str, Any]:
    try:
        return company_prefill(await opendata.lookup_siren(siret))
    except Exception as e:  # jamais bloquant
        logger.warning("Open data en erreur pour %s : %s", siret, e)
        return {"available": False, "found": False, "message": DEFERRED_MESSAGE}


def rge_summary(ademe: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "available": ademe.get("available", False),
        "found": ademe.get("found", False),
        "message": ademe.get("message") or "",
        "qualifications": [q.get("name") for q in ademe.get("qualifications") or [] if q.get("name")],
        "organismes": ademe.get("organismes") or [],
        "domaines": ademe.get("domaines") or [],
        "details": ademe.get("qualifications") or [],
        "verified_at": ademe.get("verified_at"),
    }


def _clean_siret(value: Optional[str]) -> Optional[str]:
    """14 chiffres (espaces tolérés). La clé de Luhn n'est pas exigée : l'annuaire répondra « inconnu », jamais bloquant."""
    if value is None or not str(value).strip():
        return None
    siret = re.sub(r"\D", "", str(value))
    if len(siret) != 14:
        raise HTTPException(status_code=400, detail="SIRET invalide : 14 chiffres attendus")
    return siret


@router.get("/estimates/property/{siret}")
async def estimate_property(siret: str, request: Request):
    """Préremplissage de l'estimateur et de l'annonce : open data + qualifications RGE (ADEME)."""
    check_rate_limit(request, limiter, "estimates")
    siret_clean = _clean_siret(siret)
    property = await lookup_company(siret_clean)
    rge = rge_summary(await transmissibility.fetch_ademe_qualifications(siret_clean))
    return {"siret": siret_clean, "siren": siret_clean[:9], "company": property, "rge": rge}


# ----------------------------------------------------------------------------------------------
# POST /estimates


class EstimateIn(BaseModel):
    siret: Optional[str] = Field(None, max_length=20)
    ca: Optional[float] = Field(None, ge=0, le=100_000_000, description="Chiffre d'affaires annuel HT")
    ebe: Optional[float] = Field(None, ge=-100_000_000, le=100_000_000, description="EBE ou résultat net")
    staff: Optional[int] = Field(None, ge=0, le=10_000)
    maintenance_contracts: bool = False
    team_stays: bool = False
    owner_dispensable: bool = False
    email: Optional[EmailStr] = None


COMPANY_STORED_FIELDS = ("company_name", "naf_code", "department", "region", "staff_count", "legal_structure", "trades")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def confirmation_link(token: str) -> str:
    return site_url(f"/api/estimates/confirm/{token}")


async def _store_and_send_confirmation(email: str, payload: EstimateIn, result: Dict[str, Any], siret: Optional[str],
                                       property: Dict[str, Any], rge: Dict[str, Any], request: Request) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    recent = await db.estimates.find_one({"email": email, "status": "pending_confirmation",
                                          "created_at": {"$gte": (now - RESEND_DELAY).isoformat()}}, {"_id": 0, "id": 1})
    if recent:
        raise HTTPException(status_code=429, detail="Un e-mail de confirmation vient de vous être envoyé : vérifiez votre boîte de réception.")
    token = secrets.token_urlsafe(32)
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "status": "pending_confirmation",
        "created_at": now.isoformat(),
        "expires_at": (now + CONFIRM_TTL).isoformat(),
        "confirm_token_hash": _token_hash(token),
        "siret": siret,
        "inputs": {"ca": payload.ca, "ebe": payload.ebe, "staff": payload.staff,
                   "maintenance_contracts": payload.maintenance_contracts, "team_stays": payload.team_stays,
                   "owner_dispensable": payload.owner_dispensable},
        "result": {k: result[k] for k in ("low", "high", "mid", "method", "method_code", "adjustment_percent")},
        "company": {k: property.get(k) for k in COMPANY_STORED_FIELDS if property.get("found")},
        "rge": {"found": rge.get("found"), "qualifications": rge.get("qualifications") or []},
        # Consentement : l'adresse est utilisée pour envoyer l'estimation ; confirmé par le lien (double opt-in)
        "consent": {"purpose": "estimation", "requested_at": now.isoformat(), "confirmed_at": None,
                    "visitor_hash": visitor_hash(client_ip(request), request.headers.get("user-agent", ""), now.date())},
    }
    mark_test(doc)  # estimation demandée pendant le mode test : supprimée par la purge des données de test
    await db.estimates.insert_one(doc)
    subject, html = render_email("estimate_confirm", link=confirmation_link(token))
    await send_brevo_email(email, email, subject, html)
    return {"estimate_id": doc["id"], "confirmation_required": True, "email_sent": True}


@router.post("/estimates")
async def create_estimate(payload: EstimateIn, request: Request):
    """Fourchette de valeur indicative ; avec `email`, enregistrement et confirmation par double opt-in."""
    check_rate_limit(request, limiter, "estimates")
    try:
        result = compute_estimate(payload.ca, payload.ebe, payload.staff, payload.maintenance_contracts,
                                  payload.team_stays, payload.owner_dispensable)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    siret = _clean_siret(payload.siret)
    property: Dict[str, Any] = {"available": None, "found": False, "message": ""}
    rge: Dict[str, Any] = {"available": None, "found": False, "message": "", "qualifications": []}
    if siret:
        property = await lookup_company(siret)
        rge = rge_summary(await transmissibility.fetch_ademe_qualifications(siret))
    response = {**result, "siret": siret, "company": property, "rge": rge,
                "disclaimer": "Estimation indicative, gratuite et sans engagement : le prix final dépend des négociations et "
                              "de l'audit du repreneur."}
    if payload.email:
        response["email"] = await _store_and_send_confirmation(
            str(payload.email).lower(), payload, result, siret, property, rge, request)
    return response


# ----------------------------------------------------------------------------------------------
# Confirmation (double opt-in)


def _wants_html(request: Request) -> bool:
    """Navigateur (clic sur le lien de l'e-mail) → redirection ; appel fetch/axios → JSON."""
    return request.headers.get("accept", "").strip().lower().startswith("text/html")


def _redirect(outcome: str) -> RedirectResponse:
    return RedirectResponse(site_url(f"/estimer?confirmation={outcome}"), status_code=302)


async def _send_result_email(estimate: Dict[str, Any]) -> None:
    result = estimate.get("result") or {}
    company_name = (estimate.get("company") or {}).get("company_name")
    try:
        pedagogy = compute_estimate(**(estimate.get("inputs") or {}))["pedagogy"]
    except (ValueError, TypeError):
        pedagogy = list(PEDAGOGY_GENERIC)
    subject, html = render_email(
        "estimate_result",
        low=fmt_eur_fr(result.get("low", 0)), high=fmt_eur_fr(result.get("high", 0)), mid=fmt_eur_fr(result.get("mid", 0)),
        method=result.get("method", ""), company_suffix=f" pour {company_name}" if company_name else "",
        pedagogy_1=pedagogy[0] if len(pedagogy) > 0 else PEDAGOGY_GENERIC[0],
        pedagogy_2=pedagogy[1] if len(pedagogy) > 1 else PEDAGOGY_GENERIC[1],
        pedagogy_3=pedagogy[2] if len(pedagogy) > 2 else PEDAGOGY_GENERIC[2],
        link=site_url("/register?role=seller"),
    )
    await send_brevo_email(estimate["email"], estimate["email"], subject, html)


@router.get("/estimates/confirm/{token}")
async def confirm_estimate(token: str, request: Request):
    """Lien de l'e-mail : confirme l'adresse (consentement) et envoie l'estimation. Idempotent."""
    estimate = await db.estimates.find_one({"confirm_token_hash": _token_hash(token)}, {"_id": 0})
    html = _wants_html(request)
    if not estimate:
        if html:
            return _redirect("invalide")
        raise HTTPException(status_code=404, detail="Lien de confirmation invalide")
    if estimate.get("status") == "confirmed":
        if html:
            return _redirect("ok")
        return {"confirmed": True, "already_confirmed": True, "estimate": _public_estimate(estimate)}
    expires = estimate.get("expires_at") or ""
    now = datetime.now(timezone.utc)
    if expires and expires < now.isoformat():
        if html:
            return _redirect("expire")
        raise HTTPException(status_code=410, detail="Lien expiré : refaites une estimation pour recevoir un nouveau lien")
    await db.estimates.update_one({"id": estimate["id"]}, {"$set": {
        "status": "confirmed", "confirmed_at": now.isoformat(), "consent.confirmed_at": now.isoformat(),
    }})
    estimate["status"] = "confirmed"
    estimate["confirmed_at"] = now.isoformat()
    await _send_result_email(estimate)
    if html:
        return _redirect("ok")
    return {"confirmed": True, "already_confirmed": False, "estimate": _public_estimate(estimate)}


def _public_estimate(estimate: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": estimate.get("id"), "status": estimate.get("status"), "created_at": estimate.get("created_at"),
            "confirmed_at": estimate.get("confirmed_at"), "result": estimate.get("result"),
            "inputs": estimate.get("inputs"), "company": estimate.get("company"), "rge": estimate.get("rge")}


# ----------------------------------------------------------------------------------------------
# Tâche quotidienne (RGPD)


async def daily_job(now: Optional[datetime] = None) -> int:
    """Efface les demandes jamais confirmées après 7 jours (aucun consentement) et les estimations confirmées
    après 3 ans (durée annoncée dans la politique de confidentialité). Renvoie le nombre de documents effacés."""
    now = now or datetime.now(timezone.utc)
    pending = await db.estimates.delete_many({"status": "pending_confirmation",
                                              "created_at": {"$lt": (now - PENDING_RETENTION).isoformat()}})
    confirmed = await db.estimates.delete_many({"status": "confirmed",
                                                "created_at": {"$lt": (now - CONFIRMED_RETENTION).isoformat()}})
    deleted = int(getattr(pending, "deleted_count", 0) or 0) + int(getattr(confirmed, "deleted_count", 0) or 0)
    if deleted:
        logger.info("Estimations purgées : %s", deleted)
    return deleted
