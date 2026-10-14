"""Intégration de la vague 3 : vérification d'identité limitée aux étapes qui l'exigent (coût Stripe Identity), âge de la
sauvegarde, plafond journalier et journal des e-mails, tâches en heure de Paris, mentions légales."""
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import stripe

import business_model
import server
from conftest import listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


# ---------- Stripe Identity : seulement au mandat (cédant) ou au NDA (repreneur) ----------

def _fake_session(monkeypatch, calls):
    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(id=f"vs_{uuid.uuid4().hex[:8]}", url="https://verify.stripe.test/x", status="requires_input")
    monkeypatch.setattr(stripe.identity.VerificationSession, "create", staticmethod(create))


def test_identite_refusee_hors_des_etapes_qui_l_exigent(api, client, monkeypatch):
    calls = []
    _fake_session(monkeypatch, calls)
    buyer = api.register(uid("kyc-b"), "buyer")
    r = client.post("/api/kyc/create-verification-session", headers=api.h(buyer))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "identity_not_needed_yet"
    seller = api.register(uid("kyc-s"), "seller")
    r = client.post("/api/kyc/create-verification-session", headers=api.h(seller))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "identity_not_needed_yet"
    assert calls == [], "aucune session Stripe facturée"


def test_identite_ouverte_au_mandat_et_apres_acceptation_du_dossier(api, client, monkeypatch):
    calls = []
    _fake_session(monkeypatch, calls)
    seller = api.register(uid("kyc-s2"), "seller")
    assert client.post("/api/companies", headers=api.h(seller), json=listing()).status_code == 200
    r = client.post("/api/kyc/create-verification-session", headers=api.h(seller))
    assert r.status_code == 200 and r.json()["url"], r.text

    buyer = api.register(uid("kyc-b2"), "buyer")
    db_call(client, server.db.dataroom_access.insert_one, {"id": str(uuid.uuid4()), "buyer_id": buyer["id"],
                                                            "company_id": "c-x", "status": "accepted"})
    r = client.post("/api/kyc/create-verification-session", headers=api.h(buyer))
    assert r.status_code == 200, r.text
    assert len(calls) == 2


def test_identite_deja_verifiee_409(api, client, monkeypatch):
    calls = []
    _fake_session(monkeypatch, calls)
    seller = api.register(uid("kyc-s3"), "seller")
    db_call(client, server.db.users.update_one, {"id": seller["id"]}, {"$set": {"identity_verified": True, "kyc_status": "verified"}})
    r = client.post("/api/kyc/create-verification-session", headers=api.h(seller))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_verified"
    assert calls == []


def test_identite_limitee_a_3_sessions_par_heure(api, client, monkeypatch):
    calls = []
    _fake_session(monkeypatch, calls)
    buyer = api.register(uid("kyc-rl"), "buyer")
    server.limiter.reset()
    server.limiter.enabled = True
    try:
        codes = [client.post("/api/kyc/create-verification-session", headers=api.h(buyer)).status_code for _ in range(4)]
    finally:
        server.limiter.enabled = False
    assert codes[:3] == [403] * 3 and codes[3] == 429


# ---------- Sauvegarde : âge de la dernière réussite (health + « À faire ») ----------

def test_age_de_la_sauvegarde_dans_health_et_a_faire(api, client, monkeypatch, tmp_path):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    marker = tmp_path / "last_success"
    marker.write_text("ok")
    old = datetime.now(timezone.utc).timestamp() - 40 * 3600
    os.utime(marker, (old, old))
    health = client.get("/api/health").json()
    assert 39.5 <= health["backup_age_hours"] <= 40.5
    todo = db_call(client, server.build_admin_todo)
    rows = {s["key"]: s["rows"] for s in todo["sections"]}["job_failures"]
    assert any(r["type"] == "backup_stale" and "40 h" in r["title"] for r in rows)
    os.utime(marker, None)
    todo = db_call(client, server.build_admin_todo)
    assert not any(r["type"] == "backup_stale" for r in {s["key"]: s["rows"] for s in todo["sections"]}["job_failures"])
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path / "absent"))
    assert client.get("/api/health").json()["backup_age_hours"] is None


# ---------- E-mails : plafond journalier, échecs journalisés ----------

def test_plafond_journalier_ne_bloque_que_les_e_mails_non_transactionnels(client, monkeypatch, emails):
    monkeypatch.setenv("EMAIL_DAILY_SOFT_LIMIT", "5")
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    db_call(client, server.db.email_counters.update_one, {"_id": day}, {"$set": {"sent": 5}}, upsert=True)
    try:
        r = db_call(client, business_model.send_brevo_email, "a@test.fr", "", "Nouvelles annonces", "<p>x</p>",
                    unsubscribe_url="https://x/unsub")
        assert r == {"success": False, "error": "daily_soft_limit"} and not emails
        r = db_call(client, business_model.send_brevo_email, "a@test.fr", "", "Votre code", "<p>123456</p>")
        assert r["success"] and len(emails) == 1
        doc = db_call(client, server.db.email_counters.find_one, {"_id": day})
        assert doc["sent"] == 6
        failure = db_call(client, server.db.job_failures.find_one, {"kind": "email", "error": {"$regex": "Nouvelles annonces"}})
        assert failure and "plafond" in failure["error"]
    finally:
        db_call(client, server.db.email_counters.delete_one, {"_id": day})


def test_echec_d_envoi_journalise_et_visible_dans_a_faire(client, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("Brevo 401 unauthorized")
    monkeypatch.setattr(business_model, "_send_brevo_email_sync", broken)
    r = db_call(client, business_model.send_brevo_email, "b@test.fr", "", "Sujet en échec", "<p>x</p>")
    assert r["success"] is False
    todo = db_call(client, server.build_admin_todo)
    rows = {s["key"]: s["rows"] for s in todo["sections"]}["job_failures"]
    assert any(r["title"] == "E-mail non envoyé" and "Sujet en échec" in r["detail"] for r in rows)


def test_digest_hebdomadaire_reessaye_apres_un_echec(api, client, monkeypatch):
    now = datetime.now(timezone.utc)
    cid = str(uuid.uuid4())
    db_call(client, server.db.companies.insert_one, {"id": cid, "status": "published", "published_at": now.isoformat(),
                                                     "title": "Plomberie", "region": "Bretagne", "asking_price": 200000})
    alert_id = str(uuid.uuid4())
    db_call(client, server.db.public_alerts.insert_one, {"id": alert_id, "email": uid("digest"), "status": "active", "criteria": {}})
    monkeypatch.setattr(server, "alert_matches", lambda alert, c: c["id"] == cid)

    async def failing(*args, **kwargs):
        return {"success": False, "error": "boom"}
    monkeypatch.setattr(server, "send_brevo_email", failing)
    try:
        db_call(client, server.job_alerts_weekly_digest, now)
        week = server._period_keys(now)["weekly"]
        assert db_call(client, server.db.job_marks.find_one, {"kind": "alert_digest", "key": f"{alert_id}:{week}"}) is None
        monkeypatch.setattr(server, "send_brevo_email", business_model.send_brevo_email)
        assert db_call(client, server.job_alerts_weekly_digest, now) >= 1
        assert db_call(client, server.db.job_marks.find_one, {"kind": "alert_digest", "key": f"{alert_id}:{week}"})
    finally:
        db_call(client, server.db.companies.delete_one, {"id": cid})
        db_call(client, server.db.public_alerts.delete_one, {"id": alert_id})


# ---------- Tâches planifiées : heure de Paris ----------

def test_periodes_en_heure_de_paris():
    # 23 h 30 UTC le 31 décembre = 0 h 30 le 1er janvier à Paris
    keys = server._period_keys(datetime(2026, 12, 31, 23, 30, tzinfo=timezone.utc))
    assert keys["daily"] == "2027-01-01" and keys["monthly"] == "2027-01"
    assert any(name == "backup_s3" for name, _ in server.HOURLY_JOBS)
    assert not any(name == "backup_s3" for name, _ in server.DAILY_JOBS)


def test_taches_quotidiennes_pas_avant_8_h_a_paris(client, monkeypatch):
    ran = []

    async def job(now):
        ran.append(now)
        return 1
    monkeypatch.setattr(server, "DAILY_JOBS", [("probe", job)])
    monkeypatch.setattr(server, "WEEKLY_JOBS", [])
    monkeypatch.setattr(server, "MONTHLY_JOBS", [])
    monkeypatch.setattr(server, "HOURLY_JOBS", ())

    class _Clock(datetime):
        current = datetime(2030, 3, 4, 5, 0, tzinfo=timezone.utc)  # 6 h à Paris

        @classmethod
        def now(cls, tz=None):
            return cls.current
    monkeypatch.setattr(server, "datetime", _Clock)
    db_call(client, server.run_scheduled_jobs)
    assert ran == []
    _Clock.current = datetime(2030, 3, 4, 7, 5, tzinfo=timezone.utc)  # 8 h 05 à Paris
    db_call(client, server.run_scheduled_jobs)
    db_call(client, server.run_scheduled_jobs)
    assert len(ran) == 1


# ---------- Mentions légales ----------

def test_mentions_legales_carte_t_tva_et_valeurs_vides(client, monkeypatch):
    info = client.get("/api/public/legal-info").json()
    assert info["carte_t_activities"] == ["Transactions sur immeubles et fonds de commerce"]
    assert info["tva"].startswith("FR") and info["tva"].endswith("952180230")
    assert "telephone" in info
    monkeypatch.setenv("LEGAL_REPRESENTANT", "")
    assert server._legal_env("LEGAL_REPRESENTANT", "Défaut") == "Défaut"


def test_e_mail_de_retrait_indique_la_voie_de_contestation():
    _, html = business_model.render_email("listing_removed", name="Jean", reason="Doublon", link="https://x")
    assert "contester ce retrait" in html


def test_aucun_ancien_domaine_dans_le_code_publie():
    """L'ancien domaine (cessionrge.alteregopatrimoine.com) ne doit plus apparaître dans le front ni dans le backend"""
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    files = [p for d in ("frontend/public", "frontend/src") for p in (root / d).rglob("*") if p.is_file()]
    files += list((root / "backend").glob("*.py")) + [root / "frontend" / ".env.production"]
    hits = [str(p.relative_to(root)) for p in files
            if p.exists() and "alteregopatrimoine" in p.read_bytes().decode("utf-8", errors="ignore")]
    assert hits == []


def test_purge_des_documents_trois_ans_apres_la_fin_de_l_annonce(client):
    now = datetime.now(timezone.utc)
    old = (now - timedelta(days=3 * 365 + 5)).isoformat()
    ended, active = str(uuid.uuid4()), str(uuid.uuid4())
    db_call(client, server.db.companies.insert_many, [
        {"id": ended, "status": "withdrawn", "updated_at": old, "withdrawn_at": old},
        {"id": active, "status": "published", "updated_at": old}])
    db_call(client, server.db.dataroom.insert_many, [
        {"id": f"d-{ended}", "company_id": ended, "content": "eA==", "created_at": old},
        {"id": f"d-{active}", "company_id": active, "content": "eA==", "created_at": old}])
    db_call(client, server.job_rgpd_purge, now)
    assert db_call(client, server.db.dataroom.find_one, {"id": f"d-{ended}"}) is None
    assert db_call(client, server.db.dataroom.find_one, {"id": f"d-{active}"}) is not None
