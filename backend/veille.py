"""
Veille BODACC mensuelle (SPEC §6.4 et §2.3), gratuite et sans clé.

- fetch_json(url) : appel HTTP synchrone (requests, 8 s), fonction module-level remplacée dans les tests.
- bodacc_events(siren, since) : annonces publiées au BODACC pour un SIREN depuis une date, via l'API
  opendatasoft v2.1 du dataset `annonces-commerciales` ; chaque annonce est normalisée {id, famille, type, date,
  description, relevant…}. Sont « pertinentes » les familles « Ventes et cessions » et « Modifications diverses »
  (changement de dirigeant, d'associés, cession de fonds…).
- monthly_job() (run_veille) : pour chaque SIREN sous mandat (signé, dénoncé ou expiré tant que la clause de suite court :
  `tail_ends_at` > maintenant) ou sous NDA signé (24 mois), interroge le BODACC depuis la date du mandat ou du
  NDA ; toute annonce pertinente sans vente déclarée crée un incident db.incidents
  {type: 'bodacc', siren, company_id, event, created_at, status: 'open'} (sans doublon) et envoie un e-mail au
  cédant et à ADMIN_NOTIFICATION_EMAIL.
- Routes admin : GET /admin/incidents, PUT /admin/incidents/{id} (clore / rouvrir), POST /admin/veille/run.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from business_model import EMAIL_TEMPLATES, site_url
from server import db, email_admin, email_user, require_admin

logger = logging.getLogger("veille")
router = APIRouter()

BODACC_URL = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records"
TIMEOUT_SECONDS = 8
PAGE_SIZE = 100
MANDATE_DURATION_MONTHS = 12        # mandat v2
TAIL_MONTHS = 18                    # clause de suite
NDA_DURATION_MONTHS = 24            # durée de l'accord de confidentialité
MANDATE_STATUSES = ("signed", "denounced", "expired")
MANDATE_STATUS_LABELS = {"signed": "signé", "denounced": "dénoncé", "expired": "expiré"}
# Statuts d'un closing (closing.py) qui valent « vente déclarée » : plus de veille sur ce SIREN
SALE_DECLARED_STATUSES = ("declared", "pending_confirmation", "confirmed", "invoiced", "paid", "completed")
COMPANY_SOLD_STATUSES = ("sold", "vendue", "sold_via_platform")

FAMILLES = {
    "vente": "Ventes et cessions",
    "modification": "Modifications diverses",
    "creation": "Créations",
    "immatriculation": "Immatriculations",
    "radiation": "Radiations",
    "collective": "Procédures collectives",
    "depot": "Dépôts des comptes",
    "rectificatif": "Rectificatifs",
    "annulation": "Annulations",
}
RELEVANT_FAMILLES = ("vente", "modification")
# Modifications qui signalent une cession : dirigeant, associés, capital, fonds (sans accents, minuscules)
MODIFICATION_KEYWORDS = ("dirigeant", "gerant", "president", "directeur", "associe", "actionnaire", "cession",
                         "fonds de commerce", "capital", "administration", "transmission", "apport", "fusion",
                         "location-gerance", "location gerance")


# ----------------------------------------------------------------------------------------------
# Gabarits d'e-mail

EMAIL_TEMPLATES.setdefault("bodacc_incident_seller", {
    "subject": "Publication au BODACC concernant votre société",
    "html": """
    <h2>Une publication au BODACC a été relevée</h2>
    <p>Bonjour {name},</p>
    <p>Dans le cadre du suivi de votre mandat, nous avons relevé une publication au Bulletin officiel des annonces civiles et commerciales (BODACC) concernant la société {company_label} (SIREN {siren}) :</p>
    <p>{events}</p>
    <p>Si la société a été cédée, merci de nous l'indiquer depuis votre espace (« Déclarer la vente ») ou en répondant à cet e-mail. Si cette publication ne correspond pas à une cession (changement d'adresse, modification statutaire…), répondez-nous simplement pour que nous clôturions l'alerte.</p>
    <p>Rappel : le mandat prévoit que la rémunération de {site_name} reste due si la cession est conclue avec un repreneur que nous vous avons présenté, pendant le mandat et dans les 18 mois qui suivent sa fin.</p>
    <p><a href="{link}">{link}</a></p>
    <p>Cordialement,<br>L'équipe {site_name}</p>
    """,
})

EMAIL_TEMPLATES.setdefault("bodacc_incident_admin", {
    "subject": "Incident BODACC : {company_label} ({siren})",
    "html": """
    <h2>Veille BODACC : publication sans vente déclarée</h2>
    <p>Société : {company_label} — SIREN {siren} — annonce {company_id}</p>
    <p>Origine de la veille : {sources}</p>
    <p>{events}</p>
    <p>Le cédant a reçu un e-mail lui demandant de confirmer si la société a été cédée. L'incident est dans « À faire ».</p>
    <p><a href="{link}">{link}</a></p>
    """,
})


# ----------------------------------------------------------------------------------------------
# HTTP


def _user_agent() -> str:
    site = os.environ.get("SITE_URL", "https://cessionbatiment.fr").strip()
    return f"cession-plateforme/1.0 (+{site})"


def fetch_json(url: str) -> Any:
    """Appel HTTP synchrone (lancé dans un thread). Lève une exception si réseau, délai ou statut ≠ 2xx.
    Remplacée dans les tests."""
    response = requests.get(url, timeout=TIMEOUT_SECONDS,
                            headers={"Accept": "application/json", "User-Agent": _user_agent()})
    response.raise_for_status()
    return response.json()


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _norm(value: Any) -> str:
    s = unicodedata.normalize("NFD", str(value or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _since_text(since: Any) -> str:
    if isinstance(since, datetime):
        return since.date().isoformat()
    text = str(since or "").strip()
    if not text:
        return (datetime.now(timezone.utc) - timedelta(days=30 * TAIL_MONTHS)).date().isoformat()
    return text[:10]


def bodacc_url(siren: str, since: Any, limit: int = PAGE_SIZE, offset: int = 0) -> str:
    where = f'registre like "{siren}" and dateparution >= "{_since_text(since)}"'
    order = quote("dateparution desc", safe="")
    return f"{BODACC_URL}?where={quote(where, safe='')}&order_by={order}&limit={int(limit)}&offset={int(offset)}"


# ----------------------------------------------------------------------------------------------
# Normalisation des annonces


def _json_text(value: Any) -> str:
    """Champs BODACC sérialisés en JSON (acte, modificationsgenerales, jugement…) → texte lisible."""
    if value is None:
        return ""
    if isinstance(value, str):
        text = value.strip()
        if text[:1] in ("{", "["):
            try:
                value = json.loads(text)
            except ValueError:
                return text
        else:
            return text
    parts: List[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
        elif node not in (None, ""):
            parts.append(str(node).strip())

    walk(value)
    return " ".join(p for p in parts if p)


DESCRIPTION_FIELDS = ("acte", "modificationsgenerales", "jugement", "listeprecedentproprietaire", "listeprecedentexploitant", "divers")


def event_description(record: Dict[str, Any]) -> str:
    chunks = [_json_text(record.get(k)) for k in DESCRIPTION_FIELDS]
    text = " ".join(c for c in chunks if c)
    return re.sub(r"\s+", " ", text)[:600]


def is_relevant(famille: str, description: str) -> bool:
    """Ventes et cessions : toujours ; modifications : si le texte évoque dirigeant/associés/capital/fonds
    (ou s'il est vide : on signale plutôt que de manquer une cession)."""
    if famille == "vente":
        return True
    if famille == "modification":
        text = _norm(description)
        return not text or any(k in text for k in MODIFICATION_KEYWORDS)
    return False


def normalize_record(record: Dict[str, Any], siren: str = "") -> Dict[str, Any]:
    famille = str(record.get("familleavis") or "").strip().lower()
    description = event_description(record)
    registre = record.get("registre")
    registre_digits = [_digits(r) for r in (registre if isinstance(registre, list) else [registre]) if r]
    return {
        "id": str(record.get("id") or f"{siren}-{record.get('dateparution', '')}-{record.get('numeroannonce', '')}"),
        "siren": siren or next((r for r in registre_digits if len(r) == 9), ""),
        "famille": famille,
        "famille_label": record.get("familleavis_lib") or FAMILLES.get(famille, famille),
        "type": str(record.get("typeavis") or "").strip().lower(),
        "type_label": record.get("typeavis_lib") or "",
        "date": str(record.get("dateparution") or "")[:10],
        "numero": record.get("numeroannonce"),
        "tribunal": record.get("tribunal") or "",
        "commercant": record.get("commercant") or "",
        "ville": record.get("ville") or "",
        "departement": record.get("numerodepartement") or "",
        "description": description,
        "url": record.get("url_complete") or "",
        "relevant": is_relevant(famille, description),
    }


async def bodacc_events(siren: str, since: Any) -> List[Dict[str, Any]]:
    """Annonces BODACC d'un SIREN depuis `since` (date ou datetime), les plus récentes d'abord ; [] si SIREN invalide.
    Lève une exception en cas de panne de l'API (l'appelant décide)."""
    siren = _digits(siren)
    if len(siren) != 9:
        return []
    results: List[Dict[str, Any]] = []
    offset = 0
    while True:
        data = await asyncio.to_thread(fetch_json, bodacc_url(siren, since, PAGE_SIZE, offset))
        rows = (data or {}).get("results") or []
        results.extend(normalize_record(r, siren) for r in rows if isinstance(r, dict))
        total = int((data or {}).get("total_count") or 0)
        offset += len(rows)
        if not rows or offset >= total or offset >= 1000:
            break
    return results


# ----------------------------------------------------------------------------------------------
# Cibles de la veille


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _add_months(dt: datetime, months: int) -> datetime:
    return dt + timedelta(days=int(round(months * 30.44)))


def _fr_date(value: Any) -> str:
    """AAAA-MM-JJ (ou datetime) → JJ/MM/AAAA ; texte inchangé si illisible."""
    dt = value if isinstance(value, datetime) else _parse_dt(str(value or "")[:10])
    return dt.strftime("%d/%m/%Y") if dt else str(value or "")


def mandate_tail_end(contract: Dict[str, Any]) -> Optional[datetime]:
    """Fin de la clause de suite : `tail_ends_at`, sinon `ends_at` + 18 mois, sinon signature + 12 + 18 mois."""
    tail = _parse_dt(contract.get("tail_ends_at"))
    if tail:
        return tail
    ends = _parse_dt(contract.get("ends_at"))
    if ends:
        return _add_months(ends, TAIL_MONTHS)
    signed = _parse_dt(contract.get("signed_at") or contract.get("created_at"))
    return _add_months(signed, MANDATE_DURATION_MONTHS + TAIL_MONTHS) if signed else None


async def sale_declared(company: Dict[str, Any]) -> bool:
    if str(company.get("status") or "").lower() in COMPANY_SOLD_STATUSES or company.get("sale_declared_at"):
        return True
    closing = await db.closings.find_one({"company_id": company["id"], "status": {"$in": list(SALE_DECLARED_STATUSES)}},
                                         {"_id": 0, "id": 1})
    return closing is not None


async def collect_targets(now: Optional[datetime] = None) -> Dict[str, Dict[str, Any]]:
    """{siren: {company_id, company_label, seller_id, since, sources: [...]}} pour les SIREN à surveiller."""
    now = now or datetime.now(timezone.utc)
    candidates: List[Dict[str, Any]] = []
    async for c in db.generated_contracts.find({"type": "mandat", "status": {"$in": list(MANDATE_STATUSES)}},
                                               {"_id": 0, "id": 1, "company_id": 1, "status": 1, "signed_at": 1,
                                                "created_at": 1, "ends_at": 1, "tail_ends_at": 1}):
        tail = mandate_tail_end(c)
        since = _parse_dt(c.get("signed_at") or c.get("created_at"))
        if tail and since and tail > now:
            candidates.append({"company_id": c.get("company_id"), "since": since,
                               "source": f"mandat {MANDATE_STATUS_LABELS.get(c.get('status'), c.get('status'))} "
                                         f"(clause de suite jusqu'au {_fr_date(tail)})"})
    async for d in db.documents.find({"doc_type": "nda"}, {"_id": 0, "company_id": 1, "signed_at": 1, "signer_id": 1}):
        since = _parse_dt(d.get("signed_at"))
        if since and _add_months(since, NDA_DURATION_MONTHS) > now:
            candidates.append({"company_id": d.get("company_id"), "since": since,
                               "source": f"NDA signé le {_fr_date(since)}"})

    targets: Dict[str, Dict[str, Any]] = {}
    companies: Dict[str, Optional[Dict[str, Any]]] = {}
    for cand in candidates:
        cid = cand.get("company_id")
        if not cid:
            continue
        if cid not in companies:
            companies[cid] = await db.companies.find_one({"id": cid}, {"_id": 0, "id": 1, "siren": 1, "siret": 1,
                                                                       "seller_id": 1, "president_id": 1, "status": 1,
                                                                       "company_name": 1, "title": 1, "sale_declared_at": 1})
        company = companies[cid]
        if not company:
            continue
        siren = _digits(company.get("siren")) or _digits(company.get("siret"))[:9]
        if len(siren) != 9 or await sale_declared(company):
            continue
        target = targets.setdefault(siren, {
            "siren": siren, "company_id": cid, "seller_id": company.get("seller_id") or company.get("president_id"),
            "company_label": company.get("company_name") or company.get("title") or f"annonce {cid[:8]}",
            "since": cand["since"], "sources": [],
        })
        target["since"] = min(target["since"], cand["since"])
        if cand["source"] not in target["sources"]:
            target["sources"].append(cand["source"])
    return targets


# ----------------------------------------------------------------------------------------------
# Incidents et notifications


def _events_text(events: List[Dict[str, Any]]) -> str:
    lines = []
    for ev in events:
        label = ev.get("famille_label") or ev.get("famille") or "annonce"
        date = _fr_date(ev.get("date")) or "date inconnue"
        desc = (ev.get("description") or "")[:200]
        lines.append(f"{date} — {label}" + (f" : {desc}" if desc else "") + (f" ({ev['tribunal']})" if ev.get("tribunal") else ""))
    return " | ".join(lines)


async def _notify(target: Dict[str, Any], events: List[Dict[str, Any]]) -> None:
    events_text = _events_text(events)
    await email_user(target.get("seller_id"), "bodacc_incident_seller", company_label=target["company_label"],
                     siren=target["siren"], events=events_text, link=site_url("/seller/dashboard"))
    await email_admin("bodacc_incident_admin", company_label=target["company_label"], siren=target["siren"],
                      company_id=target["company_id"], sources=", ".join(target.get("sources") or []),
                      events=events_text, link=site_url("/admin"))


async def record_incidents(target: Dict[str, Any], events: List[Dict[str, Any]], now: datetime) -> List[Dict[str, Any]]:
    """Crée les incidents manquants pour les annonces pertinentes ; renvoie ceux créés."""
    created = []
    for ev in events:
        if not ev.get("relevant"):
            continue
        exists = await db.incidents.find_one({"type": "bodacc", "siren": target["siren"], "event.id": ev["id"]}, {"_id": 0, "id": 1})
        if exists:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "type": "bodacc",
            "siren": target["siren"],
            "company_id": target["company_id"],
            "seller_id": target.get("seller_id"),
            "company_label": target["company_label"],
            "sources": list(target.get("sources") or []),
            "event": ev,
            "created_at": now.isoformat(),
            "status": "open",
            "note": "",
        }
        await db.incidents.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)
    return created


async def run_veille(now: Optional[datetime] = None) -> Dict[str, Any]:
    """Un passage de veille : {targets, checked, incidents_created, errors, all_failed}. Une panne sur un SIREN ne
    bloque pas les autres ; une panne sur tous les SIREN est consignée dans db.job_failures (« échecs de jobs » de
    l'admin) sans lever d'exception."""
    now = now or datetime.now(timezone.utc)
    targets = await collect_targets(now)
    created_total = 0
    errors: List[str] = []
    for siren, target in targets.items():
        try:
            events = await bodacc_events(siren, target["since"])
        except Exception as e:  # une panne sur un SIREN ne bloque pas les autres
            logger.warning("BODACC indisponible pour %s : %s", siren, e)
            errors.append(f"{siren}: {str(e)[:200]}")
            continue
        created = await record_incidents(target, events, now)
        if created:
            await _notify(target, [c["event"] for c in created])
            created_total += len(created)
    all_failed = bool(targets) and len(errors) == len(targets)
    await db.veille_runs.insert_one({
        "id": str(uuid.uuid4()), "at": now.isoformat(), "sirens_checked": len(targets) - len(errors),
        "sirens_total": len(targets), "incidents_created": created_total, "errors": errors,
        "expire_at": now + timedelta(days=400),
    })
    if all_failed:
        message = f"Veille BODACC : API injoignable pour les {len(targets)} SIREN surveillés"
        logger.error(message)
        await db.job_failures.insert_one({"job": "monthly:veille", "error": message, "at": now.isoformat(),
                                          "expire_at": now + timedelta(days=90)})
    elif errors:
        logger.warning("Veille BODACC : %s SIREN en erreur sur %s", len(errors), len(targets))
    return {"targets": len(targets), "checked": len(targets) - len(errors), "incidents_created": created_total,
            "errors": errors, "all_failed": all_failed}


async def monthly_job(now: Optional[datetime] = None) -> int:
    """Veille mensuelle (run_scheduled_jobs) : nombre d'incidents créés."""
    return (await run_veille(now))["incidents_created"]


# ----------------------------------------------------------------------------------------------
# Routes admin


class IncidentUpdate(BaseModel):
    status: str = Field(..., pattern="^(open|closed)$")
    note: Optional[str] = Field(None, max_length=2000)


@router.get("/admin/incidents")
async def list_incidents(status: Optional[str] = Query("open", pattern="^(open|closed|all)$"),
                         current_user: dict = Depends(require_admin)):
    """Admin : incidents de veille (BODACC), ouverts par défaut, les plus récents d'abord."""
    query: Dict[str, Any] = {} if status == "all" else {"status": status}
    incidents = await db.incidents.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"incidents": incidents, "total": len(incidents)}


@router.put("/admin/incidents/{incident_id}")
async def update_incident(incident_id: str, data: IncidentUpdate, current_user: dict = Depends(require_admin)):
    """Admin : clore (ou rouvrir) un incident avec une note."""
    incident = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not incident:
        raise HTTPException(status_code=404, detail="Incident introuvable")
    now = datetime.now(timezone.utc).isoformat()
    update: Dict[str, Any] = {"status": data.status, "updated_at": now}
    if data.note is not None:
        update["note"] = data.note.strip()
    if data.status == "closed":
        update["closed_at"] = now
        update["closed_by"] = current_user["id"]
    else:
        update["closed_at"] = None
        update["closed_by"] = None
    await db.incidents.update_one({"id": incident_id}, {"$set": update})
    return {**incident, **update}


@router.post("/admin/veille/run")
async def run_veille_now(current_user: dict = Depends(require_admin)):
    """Admin : lance la veille BODACC immédiatement (hors calendrier mensuel)."""
    result = await run_veille()
    if result["all_failed"]:
        raise HTTPException(status_code=503, detail=f"Veille BODACC : API injoignable pour les {result['targets']} SIREN surveillés")
    return {"sirens": result["targets"], "checked": result["checked"], "incidents_created": result["incidents_created"],
            "errors": result["errors"]}
