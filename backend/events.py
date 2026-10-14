"""
Statistiques de fréquentation maison, sans cookie et sans prestataire (SPEC §6.2 ; Plausible supprimé).

- POST /events {name, path, props?} : enregistre un événement anonyme. Le visiteur est identifié par
  `visitor_hash` = sha256(adresse IP + user-agent + sel du jour) : l'adresse IP n'est jamais stockée et le
  sel change chaque jour, donc aucun suivi d'un jour à l'autre. Limité à 60 requêtes par minute et par
  adresse IP, en mémoire dans ce module (indépendant de slowapi).
- metrics_by_day(days, names) : agrégation par jour et par nom (utilisée par /admin/metrics et par
  GET /admin/events).
- daily_job() : purge des événements de plus de 400 jours.

Chemins relatifs à /api (routeur inclus par server.py).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import threading
import time
import uuid
from collections import deque
from datetime import date, datetime, timedelta, timezone
from typing import Any, Deque, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

import server
from business_model import mark_test
from server import client_ip, db, rate_limit_enabled, require_admin

logger = logging.getLogger("events")
router = APIRouter()

# Événements acceptés (front : analytics.js). Une liste fermée évite qu'un script tiers ne crée des milliers de
# noms différents. `front_error` : remontée des erreurs de l'ErrorBoundary (SPEC §7.4).
EVENT_NAMES = (
    "page_view",
    "hero_cta_seller",
    "estimate_started",
    "estimate_completed",
    "calc_used",
    "alert_created",
    "listing_card_click",
    "contact_sent",
    "register_started",
    "register_completed",
    "front_error",
    "report",            # page /signaler (section `reports` de GET /admin/todo)
    "listing_created",   # écran 1 de CreateListing enregistré
    "mandate_signed",
    "nda_signed",
    "offer_signed",
)
RATE_LIMIT_PER_MINUTE = 60
RETENTION_DAYS = 400
MAX_PROPS = 10
MAX_PROP_LENGTH = 500
MAX_PATH_LENGTH = 200

_PROP_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
# Segments d'URL qui identifient quelqu'un (uuid, jeton, SIRET, identifiant numérique) : remplacés par « :id ».
# Un slug éditorial (lettres minuscules et tirets, même long) est conservé.
_TOKEN_SEGMENT = re.compile(
    r"^(?:[0-9a-fA-F-]{32,}"                                  # uuid / empreinte hexadécimale
    r"|\d{6,}"                                                 # SIRET, SIREN, numéro
    r"|(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_\-]{16,}"              # jeton (lettres et chiffres mêlés)
    r"|(?=.*[A-Z])[A-Za-z0-9_\-]{20,})$"                       # jeton avec majuscules
)


# ----------------------------------------------------------------------------------------------
# Limitation de débit en mémoire (fenêtre glissante, un seul processus)


class SlidingWindowLimiter:
    """`hit(clé)` renvoie False quand la clé a dépassé `limit` appels sur les `window_seconds` dernières secondes."""

    def __init__(self, limit: int, window_seconds: int = 60, max_keys: int = 20_000):
        self.limit = int(limit)
        self.window = float(window_seconds)
        self.max_keys = int(max_keys)
        self._hits: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, now: Optional[float] = None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            queue = self._hits.get(key)
            if queue is None:
                if len(self._hits) >= self.max_keys:
                    self._purge_locked(now)
                queue = self._hits[key] = deque()
            cutoff = now - self.window
            while queue and queue[0] <= cutoff:
                queue.popleft()
            if len(queue) >= self.limit:
                return False
            queue.append(now)
            return True

    def remaining(self, key: str, now: Optional[float] = None) -> int:
        now = time.monotonic() if now is None else now
        with self._lock:
            queue = self._hits.get(key)
            if not queue:
                return self.limit
            cutoff = now - self.window
            return max(0, self.limit - sum(1 for t in queue if t > cutoff))

    def _purge_locked(self, now: float) -> None:
        cutoff = now - self.window
        for key in [k for k, q in self._hits.items() if not q or q[-1] <= cutoff]:
            del self._hits[key]

    def purge(self, now: Optional[float] = None) -> None:
        with self._lock:
            self._purge_locked(time.monotonic() if now is None else now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter(RATE_LIMIT_PER_MINUTE, 60)


def check_rate_limit(request: Request, bucket: SlidingWindowLimiter = limiter, scope: str = "") -> None:
    """Lève 429 si l'adresse IP a dépassé la limite (désactivable par RATE_LIMIT_ENABLED=false, comme slowapi)."""
    if not rate_limit_enabled():
        return
    key = f"{scope}:{client_ip(request)}" if scope else client_ip(request)
    if not bucket.hit(key):
        raise HTTPException(status_code=429, detail="Trop de requêtes. Réessayez dans une minute.")


# ----------------------------------------------------------------------------------------------
# Anonymisation


def _salt_secret() -> str:
    return (os.environ.get("EVENTS_SALT_SECRET") or "").strip() or server.JWT_SECRET


def daily_salt(day: Optional[date] = None) -> str:
    """Sel du jour : HMAC(secret, date). Change chaque jour, jamais stocké."""
    day = day or datetime.now(timezone.utc).date()
    return hmac.new(_salt_secret().encode(), day.isoformat().encode(), hashlib.sha256).hexdigest()


def visitor_hash(ip: str, user_agent: str, day: Optional[date] = None) -> str:
    """Empreinte anonyme du visiteur pour la journée (jamais l'adresse IP en clair)."""
    raw = f"{ip or ''}|{(user_agent or '')[:500]}|{daily_salt(day)}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def normalize_path(path: Any) -> str:
    """Chemin sans paramètres ni fragment, segments identifiants remplacés par « :id », 200 caractères max."""
    raw = str(path or "").strip().split("?", 1)[0].split("#", 1)[0]
    if not raw.startswith("/"):
        raw = "/" + raw
    segments = [":id" if _TOKEN_SEGMENT.match(s) else s for s in raw.split("/")]
    cleaned = "/".join(segments)
    if len(cleaned) > 1:
        cleaned = cleaned.rstrip("/") or "/"
    return cleaned[:MAX_PATH_LENGTH] or "/"


def sanitize_props(props: Any) -> Dict[str, Any]:
    """Au plus 10 propriétés, clés simples, valeurs scalaires tronquées (pas d'objets imbriqués)."""
    out: Dict[str, Any] = {}
    if not isinstance(props, dict):
        return out
    for key, value in props.items():
        k = str(key).strip().lower()
        if not _PROP_KEY.match(k):
            continue
        if isinstance(value, (dict, list, tuple, set)):
            continue  # pas d'objets imbriqués
        if isinstance(value, bool) or value is None:
            out[k] = value
        elif isinstance(value, (int, float)):
            out[k] = value if abs(value) < 1e15 else str(value)[:MAX_PROP_LENGTH]
        else:
            out[k] = str(value)[:MAX_PROP_LENGTH]
        if len(out) >= MAX_PROPS:
            break
    return out


# ----------------------------------------------------------------------------------------------
# Routes


class EventIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    path: Optional[str] = Field(None, max_length=2000)
    props: Optional[Dict[str, Any]] = None


@router.post("/events")
async def record_event(event: EventIn, request: Request):
    """Enregistre un événement anonyme (sans cookie, sans adresse IP). 60 par minute et par adresse IP."""
    name = event.name.strip()
    if name not in EVENT_NAMES:
        raise HTTPException(status_code=400, detail="Événement inconnu")
    check_rate_limit(request)
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "name": name,
        "path": normalize_path(event.path),
        "props": sanitize_props(event.props),
        "visitor_hash": visitor_hash(client_ip(request), request.headers.get("user-agent", ""), now.date()),
        "day": now.strftime("%Y-%m-%d"),
        "created_at": now.isoformat(),
        # Purge automatique (index TTL si le serveur le crée) en plus de daily_job
        "expire_at": now + timedelta(days=RETENTION_DAYS),
    }
    mark_test(doc)  # événement enregistré pendant le mode test : supprimé par la purge des données de test
    await db.events.insert_one(doc)
    return {"ok": True}


@router.get("/admin/events")
async def admin_events(days: int = Query(30, ge=1, le=RETENTION_DAYS), names: Optional[str] = None,
                       current_user: dict = Depends(require_admin)):
    """Admin : événements agrégés par jour et par nom (`names` : liste séparée par des virgules)."""
    wanted = [n.strip() for n in (names or "").split(",") if n.strip()] or None
    return await metrics_by_day(days, wanted)


# ----------------------------------------------------------------------------------------------
# Agrégation


def _day_range(days: int, now: datetime) -> List[str]:
    start = (now - timedelta(days=days - 1)).date()
    return [(start + timedelta(days=i)).isoformat() for i in range(days)]


async def metrics_by_day(days: int = 30, names: Optional[List[str]] = None, now: Optional[datetime] = None) -> dict:
    """
    Compteurs par jour et par nom d'événement sur les `days` derniers jours (aujourd'hui inclus).
    Renvoie {period_days, from, to, names, days: [{day, visitors, events: {nom: n}}], totals: {nom: n},
    visitor_days, paths: [{path, count}]}.
    `visitors` est le nombre d'empreintes distinctes du jour ; le sel changeant chaque jour, la somme sur la
    période (`visitor_days`) compte un même visiteur une fois par jour de visite.
    """
    days = max(1, min(int(days), RETENTION_DAYS))
    now = now or datetime.now(timezone.utc)
    day_list = _day_range(days, now)
    match: Dict[str, Any] = {"day": {"$gte": day_list[0], "$lte": day_list[-1]}}
    wanted = [n for n in (names or []) if n] or None
    if wanted:
        match["name"] = {"$in": wanted}
    rows = await db.events.aggregate([
        {"$match": match},
        {"$group": {"_id": {"day": "$day", "name": "$name"}, "count": {"$sum": 1},
                    "visitors": {"$addToSet": "$visitor_hash"}}},
    ]).to_list(None)

    per_day: Dict[str, Dict[str, int]] = {d: {} for d in day_list}
    visitors_per_day: Dict[str, set] = {d: set() for d in day_list}
    totals: Dict[str, int] = {}
    for row in rows:
        day = row["_id"].get("day")
        name = row["_id"].get("name")
        if day not in per_day or not name:
            continue
        per_day[day][name] = per_day[day].get(name, 0) + int(row.get("count") or 0)
        totals[name] = totals.get(name, 0) + int(row.get("count") or 0)
        visitors_per_day[day].update(row.get("visitors") or [])

    all_names = sorted(set(wanted or []) | set(totals))
    for name in all_names:
        totals.setdefault(name, 0)
    paths = await db.events.aggregate([
        {"$match": {**match, "name": "page_view"}},
        {"$group": {"_id": "$path", "count": {"$sum": 1}}},
    ]).to_list(None) if (not wanted or "page_view" in wanted) else []
    top_paths = sorted(({"path": p["_id"] or "/", "count": int(p["count"])} for p in paths),
                       key=lambda x: (-x["count"], x["path"]))[:20]
    return {
        "period_days": days,
        "from": day_list[0],
        "to": day_list[-1],
        "names": all_names,
        "days": [{"day": d, "visitors": len(visitors_per_day[d]),
                  "events": {n: per_day[d].get(n, 0) for n in all_names}} for d in day_list],
        "totals": totals,
        "visitor_days": sum(len(v) for v in visitors_per_day.values()),
        "paths": top_paths,
    }


# ----------------------------------------------------------------------------------------------
# Tâche quotidienne


async def daily_job(now: Optional[datetime] = None) -> int:
    """Purge les événements de plus de 400 jours (statistiques anonymes, durée annoncée dans la politique de confidentialité)."""
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=RETENTION_DAYS)).isoformat()
    result = await db.events.delete_many({"created_at": {"$lt": cutoff}})
    limiter.purge()
    deleted = int(getattr(result, "deleted_count", 0) or 0)
    if deleted:
        logger.info("Événements purgés : %s", deleted)
    return deleted
