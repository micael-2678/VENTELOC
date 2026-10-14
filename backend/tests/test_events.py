"""Statistiques maison (events.py) : enregistrement anonyme sans cookie, chemin normalisé, limite 60/min/IP,
agrégation par jour et par nom, purge à 400 jours, route admin"""
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone

import server  # noqa: F401  (toujours avant les modules)
import events


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


# ---------- Fonctions pures ----------

def test_visitor_hash_sans_ip_et_sel_quotidien():
    h1 = events.visitor_hash("203.0.113.5", "Mozilla/5.0", date(2026, 10, 10))
    assert len(h1) == 32 and "203.0.113.5" not in h1
    assert h1 == events.visitor_hash("203.0.113.5", "Mozilla/5.0", date(2026, 10, 10))
    assert h1 != events.visitor_hash("203.0.113.5", "Mozilla/5.0", date(2026, 10, 11)), "le sel change chaque jour"
    assert h1 != events.visitor_hash("203.0.113.6", "Mozilla/5.0", date(2026, 10, 10))


def test_normalize_path_retire_identifiants_et_parametres():
    assert events.normalize_path("/property/0b2f6c1e-7d2a-4c0e-9b1e-2f1a3c4d5e6f?utm=x#frag") == "/property/:id"
    assert events.normalize_path("/confirmer-email/" + secrets.token_urlsafe(32)) == "/confirmer-email/:id"
    assert events.normalize_path("/guides/la-qualification-rge-est-elle-transmissible") == "/guides/la-qualification-rge-est-elle-transmissible"
    assert events.normalize_path("/verifier-entreprise-rge/12345678900011") == "/verifier-entreprise-rge/:id"
    assert events.normalize_path("entreprises-a-vendre/") == "/entreprises-a-vendre"
    assert events.normalize_path("") == "/" and events.normalize_path(None) == "/"
    assert len(events.normalize_path("/" + "x" * 500)) == events.MAX_PATH_LENGTH


def test_sanitize_props():
    props = events.sanitize_props({"source": "hero", "Bad Key": 1, "n": 3, "ok": True, "nested": {"a": 1},
                                   "long": "y" * 900, "none": None, **{f"k{i}": i for i in range(20)}})
    assert props["source"] == "hero" and props["n"] == 3 and props["ok"] is True and props["none"] is None
    assert "Bad Key" not in props and "nested" not in props
    assert len(props["long"]) == events.MAX_PROP_LENGTH
    assert len(props) <= events.MAX_PROPS
    assert events.sanitize_props("pas un dict") == {}


def test_limiteur_fenetre_glissante():
    lim = events.SlidingWindowLimiter(3, 60)
    assert [lim.hit("a", now=100.0) for _ in range(3)] == [True, True, True]
    assert lim.hit("a", now=101.0) is False
    assert lim.hit("b", now=101.0) is True, "clé indépendante"
    assert lim.hit("a", now=161.0) is True, "la fenêtre a glissé"
    assert lim.remaining("b", now=101.0) == 2
    lim.reset()
    assert lim.remaining("a") == 3


# ---------- Route POST /events ----------

def test_evenement_enregistre_sans_cookie_ni_ip(client, proxied_client):
    r = proxied_client.post("/api/events", json={"name": "listing_card_click", "path": "/property/abcd1234-abcd-1234-abcd-1234abcd1234?x=1",
                                         "props": {"position": 2, "nested": {"a": 1}}},
                    headers={"user-agent": "pytest-agent", "x-forwarded-for": "198.51.100.7"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert "set-cookie" not in {k.lower() for k in r.headers}
    doc = db_call(client, server.db.events.find_one, {"name": "listing_card_click", "path": "/property/:id"})
    assert doc and doc["props"] == {"position": 2}
    assert "198.51.100.7" not in str(doc) and "ip" not in doc
    assert doc["visitor_hash"] == events.visitor_hash("198.51.100.7", "pytest-agent", datetime.now(timezone.utc).date())
    assert doc["day"] == datetime.now(timezone.utc).strftime("%Y-%m-%d")


def test_evenement_inconnu_refuse(client):
    assert client.post("/api/events", json={"name": "track_everything", "path": "/"}).status_code == 400
    assert client.post("/api/events", json={"path": "/"}).status_code == 422
    assert client.post("/api/events", json={"name": "front_error", "props": {"message": "boom"}}).status_code == 200


def test_limite_60_par_minute_et_par_ip(proxied_client, monkeypatch):
    # Derrière Traefik puis nginx (TRUSTED_PROXY_HOPS=2) : X-Forwarded-For = « <client>, <ip de Traefik> »
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
    events.limiter.reset()
    client = proxied_client
    try:
        ip = "203.0.113.42"
        for i in range(events.RATE_LIMIT_PER_MINUTE):
            # Une valeur ajoutée en tête par le client ne change pas l'adresse retenue
            assert client.post("/api/events", json={"name": "page_view", "path": "/"},
                               headers={"x-forwarded-for": f"10.9.0.{i}, {ip}, 172.18.0.2"}).status_code == 200
        r = client.post("/api/events", json={"name": "page_view", "path": "/"}, headers={"x-forwarded-for": f"{ip}, 172.18.0.2"})
        assert r.status_code == 429 and "minute" in r.json()["detail"]
        # Une autre adresse n'est pas affectée
        assert client.post("/api/events", json={"name": "page_view", "path": "/"},
                           headers={"x-forwarded-for": "203.0.113.43, 172.18.0.2"}).status_code == 200
    finally:
        events.limiter.reset()


# ---------- Agrégation ----------

def _event(day, name, visitor, path="/"):
    return {"id": str(uuid.uuid4()), "name": name, "path": path, "props": {}, "visitor_hash": visitor, "day": day,
            "created_at": f"{day}T10:00:00+00:00"}


def test_metrics_by_day_agrege_par_jour_et_par_nom(client):
    # Période ancienne : aucun autre test n'y écrit
    now = datetime(2020, 3, 3, 12, tzinfo=timezone.utc)
    docs = [_event("2020-03-01", "page_view", "v1", "/"), _event("2020-03-01", "page_view", "v2", "/estimer"),
            _event("2020-03-01", "calc_used", "v1"), _event("2020-03-03", "page_view", "v3", "/estimer"),
            _event("2020-03-03", "contact_sent", "v3"), _event("2020-02-20", "page_view", "old"),
            _event("2020-03-04", "page_view", "futur")]
    db_call(client, server.db.events.insert_many, docs)
    m = db_call(client, events.metrics_by_day, 3, None, now)
    assert (m["from"], m["to"], m["period_days"]) == ("2020-03-01", "2020-03-03", 3)
    assert [d["day"] for d in m["days"]] == ["2020-03-01", "2020-03-02", "2020-03-03"]
    assert m["names"] == ["calc_used", "contact_sent", "page_view"]
    assert m["days"][0] == {"day": "2020-03-01", "visitors": 2, "events": {"calc_used": 1, "contact_sent": 0, "page_view": 2}}
    assert m["days"][1]["events"] == {"calc_used": 0, "contact_sent": 0, "page_view": 0} and m["days"][1]["visitors"] == 0
    assert m["days"][2]["visitors"] == 1
    assert m["totals"] == {"calc_used": 1, "contact_sent": 1, "page_view": 3}
    assert m["visitor_days"] == 3
    assert m["paths"][0] == {"path": "/estimer", "count": 2}
    # Filtre par nom : les noms demandés figurent même à zéro
    f = db_call(client, events.metrics_by_day, 3, ["page_view", "alert_created"], now)
    assert f["names"] == ["alert_created", "page_view"] and f["totals"] == {"alert_created": 0, "page_view": 3}
    g = db_call(client, events.metrics_by_day, 3, ["calc_used"], now)
    assert g["paths"] == [] and g["totals"] == {"calc_used": 1}


def test_route_admin_events(api, client):
    assert client.get("/api/admin/events").status_code in (401, 403)
    buyer = api.register(f"ev-{uuid.uuid4().hex[:8]}@test.fr", "buyer")
    assert client.get("/api/admin/events", headers=api.h(buyer)).status_code == 403
    r = client.get("/api/admin/events", params={"days": 7, "names": "page_view, calc_used"}, headers=api.h(api.admin()))
    assert r.status_code == 200
    body = r.json()
    assert body["period_days"] == 7 and len(body["days"]) == 7 and body["names"] == ["calc_used", "page_view"]
    assert client.get("/api/admin/events", params={"days": 0}, headers=api.h(api.admin())).status_code == 422


# ---------- Purge ----------

def test_daily_job_purge_apres_400_jours(client):
    now = datetime.now(timezone.utc)
    old_day = (now - timedelta(days=events.RETENTION_DAYS + 1)).strftime("%Y-%m-%d")
    recent_day = (now - timedelta(days=10)).strftime("%Y-%m-%d")
    db_call(client, server.db.events.insert_many, [_event(old_day, "page_view", "ancien"), _event(recent_day, "page_view", "recent")])
    deleted = db_call(client, events.daily_job, now)
    assert deleted >= 1
    assert db_call(client, server.db.events.find_one, {"visitor_hash": "ancien"}) is None
    assert db_call(client, server.db.events.find_one, {"visitor_hash": "recent"}) is not None
    assert db_call(client, events.daily_job, now) == 0


def test_module_branche_dans_le_serveur():
    assert "events" in server.LOADED_MODULES
    assert any(name == "events" for name, _ in server.DAILY_JOBS)
