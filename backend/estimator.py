"""
Estimateur public par la méthode du rendement (docs/venteloc/SPEC.md §6.1, API.md §8), sans compte, gratuit et sans
appel externe.

- POST /estimates {property_type, lease_type, department, surface?, rent_monthly, charges_monthly?, property_tax?,
  non_recoverable_charges?, dpe_class?, asking_price?, email?, consent?}
  → {id, low, high, mid, method, drivers: [{label, effect}], pedagogy: [string],
     yields: {gross_at_mid, net_at_mid, gross_at_price?, net_at_price?}, disclaimer}.
  Loyer net annuel = loyer mensuel × 12 − taxe foncière − charges non récupérables (taxe foncière non saisie : un mois
  de loyer ; charges non récupérables non saisies : 5 % des loyers). Rendement net attendu selon la zone (Paris 2,5-3,5 % ;
  petite couronne et grandes métropoles 3,5-5 % ; ailleurs 5-7,5 %), majoré pour un local commercial ou des bureaux
  (+1,5 point), un parking (+1 point), une résidence gérée (+0,5 point) et un logement classé F ou G (+1 point).
  Valeur basse = loyer net / rendement haut ; valeur haute = loyer net / rendement bas ; arrondis au millier.
  Chaque estimation est conservée sans donnée nominative (statistiques) ; avec `email` et `consent: true`, l'adresse
  est enregistrée et confirmée par double opt-in avant l'envoi du résultat.
- GET /estimates/confirm/{token} : confirme l'adresse, envoie l'estimation par e-mail ; redirige vers le site pour
  un navigateur, renvoie du JSON sinon.
- daily_job() : purge des adresses jamais confirmées (7 jours) et des estimations de plus de 3 ans.

Gabarits d'e-mail ajoutés à business_model.EMAIL_TEMPLATES (estimate_confirm, estimate_result).
"""
from __future__ import annotations

import hashlib
import logging
import math
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field

import taxonomy
from business_model import EMAIL_TEMPLATES, fmt_eur_fr, fmt_percent_fr, mark_test, render_email, send_brevo_email, site_url
from events import SlidingWindowLimiter, check_rate_limit, visitor_hash
from server import api_error, client_ip, db

logger = logging.getLogger("estimator")
router = APIRouter()

# ----------------------------------------------------------------------------------------------
# Paramètres du calcul (SPEC §6.1)

ZONE_1 = {"75"}
ZONE_2 = {"92", "93", "94", "06", "13", "31", "33", "34", "35", "44", "59", "67", "69", "74"}
ZONE_YIELDS = {1: (2.5, 3.5), 2: (3.5, 5.0), 3: (5.0, 7.5)}
ZONE_LABELS = {1: "Paris", 2: "petite couronne ou grande métropole", 3: "autres départements"}
TYPE_PREMIUMS = {"local-commercial": 1.5, "bureaux": 1.5, "parking": 1.0, "residence-geree": 0.5}
DPE_PREMIUM = 1.0                      # logement classé F ou G : risque de travaux
DEFAULT_TAX_MONTHS = 1                 # taxe foncière non saisie : un mois de loyer
DEFAULT_NON_RECOVERABLE_RATE = 0.05    # charges non récupérables non saisies : 5 % des loyers
ROUNDING = 1_000
CONFIRM_TTL = timedelta(hours=48)
RESEND_DELAY = timedelta(minutes=2)
RATE_LIMIT_PER_MINUTE = 20
PENDING_RETENTION = timedelta(days=7)          # adresse jamais confirmée : effacée (pas de consentement)
CONFIRMED_RETENTION = timedelta(days=3 * 365)  # estimation conservée 3 ans

PEDAGOGY = [
    "Un bail récent et un loyer au prix du marché rassurent l'acquéreur sur la pérennité du revenu.",
    "Un locataire stable, sans incident de paiement, et une garantie loyers impayés font monter le prix.",
    "Un DPE classé A à D évite la décote liée au calendrier de décence énergétique (G interdit depuis 2025, F en 2028).",
    "Des charges maîtrisées (taxe foncière, copropriété, assurance) améliorent le rendement net, que l'acquéreur compare.",
    "Un dossier complet (bail, quittances, diagnostics, procès-verbaux d'assemblée générale) raccourcit les négociations.",
]
METHOD = ("Méthode du rendement : loyer net annuel (loyers hors charges moins taxe foncière et charges non récupérables) "
          "divisé par le rendement net qu'attend un acquéreur pour ce type de bien dans cette zone ; valeurs arrondies au millier.")
DISCLAIMER = ("Estimation indicative et gratuite, fondée sur la méthode du rendement : ce n'est pas un avis de valeur. Le "
              "prix final dépend de l'état du bien, du bail, du marché local et de la négociation avec l'acquéreur.")

limiter = SlidingWindowLimiter(RATE_LIMIT_PER_MINUTE, 60)


# ----------------------------------------------------------------------------------------------
# Gabarits d'e-mail (ajoutés sans écraser ceux de business_model)

EMAIL_TEMPLATES.setdefault("estimate_confirm", {
    "subject": "Confirmez votre adresse pour recevoir votre estimation",
    "html": """
    <h2>Votre estimation est prête</h2>
    <p>Bonjour,</p>
    <p>Vous avez demandé l'estimation de votre bien loué sur {site_name}. Pour la recevoir, confirmez votre adresse e-mail en cliquant sur ce lien (valable 48 heures) :</p>
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
    <p>D'après le loyer et les charges saisis, la valeur de votre bien loué se situe entre <strong>{low}</strong> et <strong>{high}</strong> (valeur centrale : {mid}, soit un rendement brut de {gross_at_mid}).</p>
    <p style="font-size:13px;color:#5b5b5b">{method}</p>
    <h3>Ce qui fait monter le prix</h3>
    <p>• {pedagogy_1}</p>
    <p>• {pedagogy_2}</p>
    <p>• {pedagogy_3}</p>
    <p>Pour aller plus loin, déposez votre annonce : rien à payer avant la signature de l'acte authentique, mandat simple sans exclusivité, résiliable à tout moment.</p>
    <p><a href="{link}">{link}</a></p>
    <p>{disclaimer}</p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})


# ----------------------------------------------------------------------------------------------
# Calcul (pur, testable)

def round_to_step(value: float, step: int = ROUNDING) -> int:
    """Arrondi au multiple de `step` le plus proche, demi vers le haut (152 500 → 153 000)."""
    return int(math.floor(float(value) / step + 0.5) * step)


def zone_for(department: str) -> int:
    code = taxonomy.normalize_departement(department)
    if code in ZONE_1:
        return 1
    if code in ZONE_2:
        return 2
    return 3


def _num(value) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _pct(value: float) -> str:
    return fmt_percent_fr(value)


def compute_estimate(property_type: str, lease_type: str, department: str, rent_monthly: float,
                     property_tax: Optional[float] = None, non_recoverable_charges: Optional[float] = None,
                     dpe_class: Optional[str] = None, surface: Optional[float] = None,
                     asking_price: Optional[float] = None, charges_monthly: Optional[float] = None) -> Dict[str, Any]:
    """
    Fourchette {low, high, mid, method, zone, expected_net_yield: {low, high}, net_rent, drivers, pedagogy, yields}.
    ValueError (message en français) si les entrées ne permettent pas le calcul.
    """
    if not taxonomy.property_type_by_id(property_type):
        raise ValueError("Type de bien inconnu")
    if not taxonomy.lease_type_by_id(lease_type):
        raise ValueError("Type de bail inconnu")
    dep = taxonomy.normalize_departement(department)
    if not dep:
        raise ValueError("Département inconnu")
    rent = _num(rent_monthly) or 0
    if rent <= 0:
        raise ValueError("Indiquez le loyer mensuel hors charges : c'est la base de l'estimation d'un bien loué.")
    annual = rent * 12
    drivers: List[Dict[str, str]] = []
    tax = _num(property_tax)
    if tax is None:
        tax = rent * DEFAULT_TAX_MONTHS
        drivers.append({"label": "Taxe foncière non saisie", "effect": f"estimée à un mois de loyer ({fmt_eur_fr(tax)} par an)"})
    nrc = _num(non_recoverable_charges)
    if nrc is None:
        nrc = annual * DEFAULT_NON_RECOVERABLE_RATE
        drivers.append({"label": "Charges non récupérables non saisies", "effect": f"estimées à 5 % des loyers ({fmt_eur_fr(nrc)} par an)"})
    if tax < 0 or nrc < 0:
        raise ValueError("Les montants ne peuvent pas être négatifs")
    net_rent = annual - tax - nrc
    if net_rent <= 0:
        raise ValueError("Les charges saisies dépassent les loyers : le rendement net est nul, l'estimation est impossible.")

    zone = zone_for(dep)
    low_rate, high_rate = ZONE_YIELDS[zone]
    drivers.insert(0, {"label": f"Zone : {ZONE_LABELS[zone]} ({taxonomy.departement_label(dep)})",
                       "effect": f"rendement net attendu de {_pct(low_rate)} à {_pct(high_rate)}"})
    premium = TYPE_PREMIUMS.get(property_type, 0.0)
    if not premium and lease_type == "residence-geree":
        premium = TYPE_PREMIUMS["residence-geree"]
    if premium:
        drivers.append({"label": taxonomy.property_type_label(property_type, short=True) if property_type in TYPE_PREMIUMS
                        else "Résidence gérée",
                        "effect": f"+{premium:g}".replace(".", ",") + " point de rendement attendu, valeur plus basse"})
    housing = taxonomy.is_housing_lease(lease_type) and taxonomy.property_type_by_id(property_type)["category"] == "habitation"
    if housing and str(dpe_class or "").strip().upper() in ("F", "G"):
        premium += DPE_PREMIUM
        drivers.append({"label": f"Logement classé {str(dpe_class).strip().upper()}",
                        "effect": "+1 point de rendement attendu (travaux à prévoir avant tout nouveau bail)"})
    low_rate += premium
    high_rate += premium

    low = round_to_step(net_rent / (high_rate / 100))
    high = round_to_step(net_rent / (low_rate / 100))
    high = max(high, low + ROUNDING)
    mid = round_to_step((low + high) / 2)
    yields = {"gross_at_mid": taxonomy.gross_yield(rent, mid), "net_at_mid": taxonomy.net_yield(rent, mid, tax, nrc)}
    price = _num(asking_price)
    if price and price > 0:
        yields["gross_at_price"] = taxonomy.gross_yield(rent, price)
        yields["net_at_price"] = taxonomy.net_yield(rent, price, tax, nrc)
        position = "au-dessus de" if price > high else ("en dessous de" if price < low else "dans")
        drivers.append({"label": f"Prix envisagé : {fmt_eur_fr(price)}", "effect": f"{position} la fourchette estimée"})
    return {
        "low": low,
        "high": high,
        "mid": mid,
        "method": METHOD,
        "zone": zone,
        "expected_net_yield": {"low": round(low_rate, 2), "high": round(high_rate, 2)},
        "net_rent": round(net_rent, 2),
        "property_tax_used": round(tax, 2),
        "non_recoverable_used": round(nrc, 2),
        "drivers": drivers,
        "pedagogy": list(PEDAGOGY),
        "yields": yields,
        "disclaimer": DISCLAIMER,
    }


# ----------------------------------------------------------------------------------------------
# POST /estimates

class EstimateIn(BaseModel):
    property_type: str = Field(..., max_length=40)
    lease_type: str = Field(..., max_length=40)
    department: str = Field(..., max_length=40)
    surface: Optional[float] = Field(None, ge=0, le=100_000)
    rent_monthly: float = Field(..., ge=0, le=10_000_000, description="Loyer mensuel hors charges")
    charges_monthly: Optional[float] = Field(None, ge=0, le=1_000_000)
    property_tax: Optional[float] = Field(None, ge=0, le=10_000_000)
    non_recoverable_charges: Optional[float] = Field(None, ge=0, le=10_000_000)
    dpe_class: Optional[str] = Field(None, max_length=20)
    asking_price: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    email: Optional[EmailStr] = None
    consent: Optional[bool] = None


INPUT_FIELDS = ("property_type", "lease_type", "department", "surface", "rent_monthly", "charges_monthly", "property_tax",
                "non_recoverable_charges", "dpe_class", "asking_price")
RESULT_FIELDS = ("low", "high", "mid", "method", "zone", "expected_net_yield", "net_rent", "yields")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def confirmation_link(token: str) -> str:
    return site_url(f"/api/estimates/confirm/{token}")


def _inputs(payload: EstimateIn) -> Dict[str, Any]:
    return {k: getattr(payload, k) for k in INPUT_FIELDS}


@router.post("/estimates")
async def create_estimate(payload: EstimateIn, request: Request):
    """Fourchette de valeur indicative par le rendement ; avec `email` et `consent`, enregistrement de l'adresse et
    confirmation par double opt-in (le résultat est envoyé après confirmation)."""
    check_rate_limit(request, limiter, "estimates")
    try:
        result = compute_estimate(**_inputs(payload))
    except ValueError as e:
        raise api_error(400, "validation", str(e))
    email = str(payload.email).lower() if payload.email else None
    if email and payload.consent is not True:
        raise api_error(400, "validation", "Cochez la case de consentement pour recevoir l'estimation par e-mail", field="consent")
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()), "status": "anonymous", "created_at": now.isoformat(), "inputs": _inputs(payload),
        "result": {k: result[k] for k in RESULT_FIELDS},
    }
    response = {"id": doc["id"], **result}
    if email:
        recent = await db.estimates.find_one({"email": email, "status": "pending_confirmation",
                                              "created_at": {"$gte": (now - RESEND_DELAY).isoformat()}}, {"_id": 0, "id": 1})
        if recent:
            raise HTTPException(status_code=429, detail="Un e-mail de confirmation vient de vous être envoyé : vérifiez votre boîte de réception.")
        token = secrets.token_urlsafe(32)
        doc.update({
            "email": email, "status": "pending_confirmation", "expires_at": (now + CONFIRM_TTL).isoformat(),
            "confirm_token_hash": _token_hash(token),
            # Consentement : l'adresse sert à envoyer l'estimation ; confirmé par le lien (double opt-in)
            "consent": {"purpose": "estimation", "requested_at": now.isoformat(), "confirmed_at": None,
                        "visitor_hash": visitor_hash(client_ip(request), request.headers.get("user-agent", ""), now.date())},
        })
        subject, html = render_email("estimate_confirm", link=confirmation_link(token))
        await send_brevo_email(email, email, subject, html)
        response["email"] = {"estimate_id": doc["id"], "confirmation_required": True, "email_sent": True}
    mark_test(doc)  # estimation faite pendant le mode test : supprimée par la purge des données de test
    await db.estimates.insert_one(doc)
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
    gross = (result.get("yields") or {}).get("gross_at_mid")
    subject, html = render_email(
        "estimate_result",
        low=fmt_eur_fr(result.get("low", 0)), high=fmt_eur_fr(result.get("high", 0)), mid=fmt_eur_fr(result.get("mid", 0)),
        gross_at_mid=fmt_percent_fr(gross) if gross is not None else "non calculable", method=result.get("method", METHOD),
        pedagogy_1=PEDAGOGY[0], pedagogy_2=PEDAGOGY[1], pedagogy_3=PEDAGOGY[2], disclaimer=DISCLAIMER,
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
            "confirmed_at": estimate.get("confirmed_at"), "result": estimate.get("result"), "inputs": estimate.get("inputs")}


# ----------------------------------------------------------------------------------------------
# Tâche quotidienne (RGPD)

async def daily_job(now: Optional[datetime] = None) -> int:
    """Efface les demandes jamais confirmées après 7 jours (aucun consentement) et les estimations (confirmées ou
    anonymes) après 3 ans (durée annoncée dans la politique de confidentialité). Renvoie le nombre d'effacements."""
    now = now or datetime.now(timezone.utc)
    pending = await db.estimates.delete_many({"status": "pending_confirmation",
                                              "created_at": {"$lt": (now - PENDING_RETENTION).isoformat()}})
    old = await db.estimates.delete_many({"status": {"$in": ["confirmed", "anonymous"]},
                                          "created_at": {"$lt": (now - CONFIRMED_RETENTION).isoformat()}})
    deleted = int(getattr(pending, "deleted_count", 0) or 0) + int(getattr(old, "deleted_count", 0) or 0)
    if deleted:
        logger.info("Estimations purgées : %s", deleted)
    return deleted
