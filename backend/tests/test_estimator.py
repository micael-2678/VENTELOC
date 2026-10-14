"""Estimateur public (estimator.py) : formule (0,3-0,6 × CA, 2,5-4 × EBE, ±15 %, minimum 10 000 €, arrondi 5 000 €),
préremplissage open data + ADEME simulés, capture d'e-mail en double opt-in, confirmation"""
import copy
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import server  # noqa: F401
import opendata
import transmissibility
import estimator
from conftest import last_email

CONFIRM_RE = re.compile(r"/api/estimates/confirm/([A-Za-z0-9_\-]+)")
SIRET = "55203253400018"   # clé de Luhn valide

OPENDATA_RESPONSE = {
    "results": [{
        "siren": "552032534", "nom_complet": "SECRET ENERGIE", "nom_raison_sociale": "SECRET ENERGIE",
        "siege": {"activite_principale": "43.22A", "adresse": "12 RUE DE LA FONTAINE 29200 BREST", "code_postal": "29200",
                  "departement": "29", "libelle_commune": "BREST", "siret": SIRET, "date_creation": "2010-03-15",
                  "etat_administratif": "A", "est_siege": True, "tranche_effectif_salarie": "11"},
        "activite_principale": "43.22A", "date_creation": "2010-03-15",
        "dirigeants": [{"nom": "DUPONT", "prenoms": "Paul", "qualite": "Président", "type_dirigeant": "personne physique"}],
        "etat_administratif": "A", "nature_juridique": "5710", "tranche_effectif_salarie": "11",
        "matching_etablissements": [], "complements": {"est_rge": True},
    }],
    "total_results": 1,
}

ADEME_RESULT = {
    "available": True, "found": True, "message": "",
    "company": {"siret": SIRET, "nom_entreprise": "SECRET ENERGIE", "code_postal": "29200", "commune": "BREST"},
    "qualifications": [{"name": "QualiPAC", "organisme": "qualit-enr", "organisme_label": "Qualit'EnR",
                        "domaine": "Pompe à chaleur", "date_debut": "2024-01-01", "date_fin": "2028-01-01", "source": "ademe"}],
    "organismes": ["Qualit'EnR"], "domaines": ["Pompe à chaleur"], "verified_at": "2026-10-10T00:00:00+00:00",
}


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


@pytest.fixture
def sources(monkeypatch):
    """Open data (recherche-entreprises) et ADEME simulés ; `calls` liste les URL open data demandées"""
    state = {"calls": [], "opendata": copy.deepcopy(OPENDATA_RESPONSE), "opendata_error": None,
             "ademe": copy.deepcopy(ADEME_RESULT)}

    def fake_fetch(url):
        state["calls"].append(url)
        if state["opendata_error"]:
            raise state["opendata_error"]
        return copy.deepcopy(state["opendata"])

    async def fake_ademe(siret):
        return copy.deepcopy(state["ademe"])

    opendata.clear_cache()
    monkeypatch.setattr(opendata, "fetch_json", fake_fetch)
    monkeypatch.setattr(transmissibility, "fetch_ademe_qualifications", fake_ademe)
    yield state
    opendata.clear_cache()


# ---------- Formule ----------

def test_formule_combinee_et_ajustements():
    base = estimator.compute_estimate(900_000, 150_000, 10)
    # CA : 270 000-540 000 ; EBE : 375 000-600 000 ; combiné 40/60 : 333 000-576 000 ; −15 % (aucune case) → 283 050 / 489 600
    assert (base["low"], base["high"]) == (285_000, 490_000)
    assert base["mid"] == 390_000 and base["method_code"] == "ca_ebe" and base["adjustment_percent"] == -15
    assert base["components"]["ca"]["multiples"] == [0.3, 0.6] and base["components"]["ebe"]["multiples"] == [2.5, 4.0]
    assert all(d["effect"] == -5 and d["active"] is False for d in base["drivers"])
    assert [d["key"] for d in base["drivers"]] == ["maintenance_contracts", "team_stays", "owner_dispensable"]

    top = estimator.compute_estimate(900_000, 150_000, 10, maintenance_contracts=True, team_stays=True, owner_dispensable=True)
    assert (top["low"], top["high"]) == (385_000, 660_000) and top["adjustment_percent"] == 15
    assert all(d["effect"] == 5 and d["active"] for d in top["drivers"])
    assert all(d["effect_label"] in ("+5 %", "−5 %") for d in top["drivers"] + base["drivers"])

    one = estimator.compute_estimate(900_000, 150_000, 10, maintenance_contracts=True)
    assert one["adjustment_percent"] == -5
    # Arrondi à 5 000 € et fourchette toujours ouverte
    for r in (base, top, one):
        assert r["low"] % 5_000 == 0 and r["high"] % 5_000 == 0 and r["mid"] % 5_000 == 0 and r["high"] > r["low"]
    assert "0,3 à 0,6 × CA" in base["method"] and "2,5 à 4 × EBE" in base["method"]


def test_bornes_minimum_et_petites_entreprises():
    r = estimator.compute_estimate(20_000, 2_000, 0)
    assert r["low"] == estimator.MIN_VALUE == 10_000 and r["high"] == 15_000
    assert any("Sans salarié" in p for p in r["pedagogy"])


def test_ebe_nul_ou_negatif_et_approches_seules():
    r = estimator.compute_estimate(1_000_000, -20_000, 8)
    assert r["method_code"] == "ca" and r["components"]["ca"]["multiples"] == [0.3, 0.45] and "ebe" not in r["components"]
    assert (r["low"], r["high"]) == (255_000, 385_000)   # 300 000-450 000 × 0,85
    ca_only = estimator.compute_estimate(1_000_000, None, 8)
    assert ca_only["method_code"] == "ca_only" and ca_only["components"]["ca"]["multiples"] == [0.3, 0.6]
    ebe_only = estimator.compute_estimate(0, 100_000, 8)
    assert ebe_only["method_code"] == "ebe" and (ebe_only["low"], ebe_only["high"]) == (215_000, 340_000)
    with pytest.raises(ValueError):
        estimator.compute_estimate(0, 0, 3)
    with pytest.raises(ValueError):
        estimator.compute_estimate(None, None)


def test_pedagogie_cases_non_cochees_en_premier():
    r = estimator.compute_estimate(500_000, 60_000, 4, maintenance_contracts=True)
    assert len(r["pedagogy"]) == 5
    assert "référent technique" in r["pedagogy"][0].lower() or "équipe" in r["pedagogy"][0].lower()
    assert "délég" in r["pedagogy"][1].lower()
    full = estimator.compute_estimate(500_000, 60_000, 4, True, True, True)
    assert full["pedagogy"] == estimator.PEDAGOGY_GENERIC[:5]


# ---------- Route POST /estimates ----------

def test_estimation_sans_email_ne_stocke_rien(client, emails):
    before = db_call(client, server.db.estimates.count_documents, {})
    r = client.post("/api/estimates", json={"ca": 900000, "ebe": 150000, "staff": 10, "maintenance_contracts": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"low", "high", "mid", "method", "drivers", "pedagogy", "company", "rge", "disclaimer"} <= set(body)
    assert body["low"] < body["mid"] < body["high"] and body["siret"] is None and "email" not in body
    assert body["company"]["found"] is False and body["rge"]["found"] is False
    assert db_call(client, server.db.estimates.count_documents, {}) == before
    assert emails == []


def test_validation_des_entrees(client):
    assert client.post("/api/estimates", json={"ca": -5, "ebe": 10}).status_code == 422
    r = client.post("/api/estimates", json={"ca": 0, "ebe": 0})
    assert r.status_code == 400 and "chiffre d'affaires" in r.json()["detail"]
    r = client.post("/api/estimates", json={"ca": 100000, "ebe": 10000, "siret": "552 032 534"})
    assert r.status_code == 400 and "SIRET" in r.json()["detail"]
    assert client.post("/api/estimates", json={"ca": 100000, "email": "pas-un-email"}).status_code == 422


def test_siret_preremplit_open_data_et_rge(client, sources):
    r = client.post("/api/estimates", json={"ca": 900000, "ebe": 150000, "staff": 10, "siret": "552 032 534 00018"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["siret"] == SIRET
    c = body["company"]
    assert c["found"] is True and c["company_name"] == "SECRET ENERGIE" and c["naf_code"] == "43.22A"
    assert c["department"] == "29" and c["region"] == "Bretagne" and c["legal_structure"] == "SAS"
    assert c["creation_date"] == "2010-03-15" and c["staff_count"] == 14 and c["trades"] == ["plomberie-chauffage"]
    assert body["rge"]["found"] is True and body["rge"]["qualifications"] == ["QualiPAC"] and body["rge"]["organismes"] == ["Qualit'EnR"]
    assert sources["calls"] and "552032534" in sources["calls"][0]


def test_open_data_en_panne_n_est_pas_bloquant(client, sources):
    sources["opendata_error"] = ConnectionError("réseau")
    sources["ademe"] = {"available": False, "found": False, "message": "Vérification RGE différée : la base ADEME n'a pas répondu.",
                        "qualifications": [], "organismes": [], "domaines": [], "verified_at": None}
    r = client.post("/api/estimates", json={"ca": 400000, "ebe": 50000, "siret": SIRET})
    assert r.status_code == 200
    body = r.json()
    assert body["low"] >= 10000
    assert body["company"]["available"] is False and "différée" in body["company"]["message"]
    assert body["rge"]["available"] is False and "différée" in body["rge"]["message"]


def test_route_prefill_company(client, sources):
    r = client.get(f"/api/estimates/company/{SIRET}")
    assert r.status_code == 200
    body = r.json()
    assert body["siren"] == "552032534" and body["company"]["company_name"] == "SECRET ENERGIE"
    assert body["rge"]["details"][0]["date_fin"] == "2028-01-01"
    assert client.get("/api/estimates/company/123").status_code == 400


# ---------- Double opt-in ----------

def test_email_double_opt_in_puis_confirmation(client, emails, sources):
    email = f"estim-{uuid.uuid4().hex[:8]}@test.fr"
    r = client.post("/api/estimates", json={"ca": 900000, "ebe": 150000, "staff": 10, "siret": SIRET, "email": email.upper(),
                                            "team_stays": True}, headers={"x-forwarded-for": "198.51.100.20"})
    assert r.status_code == 200, r.text
    info = r.json()["email"]
    assert info["confirmation_required"] is True and info["email_sent"] is True
    doc = db_call(client, server.db.estimates.find_one, {"id": info["estimate_id"]})
    assert doc["email"] == email and doc["status"] == "pending_confirmation"
    assert doc["consent"]["purpose"] == "estimation" and doc["consent"]["confirmed_at"] is None
    assert "198.51.100.20" not in str(doc) and "confirm_token_hash" in doc
    assert doc["inputs"]["team_stays"] is True and doc["result"]["low"] == r.json()["low"]
    assert doc["company"]["company_name"] == "SECRET ENERGIE" and doc["rge"]["qualifications"] == ["QualiPAC"]
    e = last_email(email, "Confirmez votre adresse pour recevoir votre estimation")
    assert e, "e-mail de confirmation attendu"
    token = CONFIRM_RE.search(e["html"]).group(1)
    assert token not in str(doc), "seule l'empreinte du jeton est stockée"
    # Deuxième demande immédiate : pas de second e-mail
    r2 = client.post("/api/estimates", json={"ca": 900000, "ebe": 150000, "email": email})
    assert r2.status_code == 429
    assert len([x for x in emails if x["to"] == email]) == 1

    # Confirmation par appel JSON (fetch) : estimation renvoyée + e-mail de résultat
    r = client.get(f"/api/estimates/confirm/{token}", headers={"accept": "application/json"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["confirmed"] is True and body["already_confirmed"] is False
    assert body["estimate"]["result"]["low"] == doc["result"]["low"] and body["estimate"]["company"]["company_name"] == "SECRET ENERGIE"
    doc = db_call(client, server.db.estimates.find_one, {"id": info["estimate_id"]})
    assert doc["status"] == "confirmed" and doc["consent"]["confirmed_at"] and doc["confirmed_at"]
    result_mail = last_email(email, "Votre estimation")
    assert result_mail and "SECRET ENERGIE" in result_mail["html"] and "/register?role=seller" in result_mail["html"]
    assert "€" in result_mail["subject"] and "Ce qui fait monter la valeur" in result_mail["html"]
    # Idempotent : pas de nouvel e-mail
    sent_before = len(emails)
    r = client.get(f"/api/estimates/confirm/{token}", headers={"accept": "application/json"})
    assert r.status_code == 200 and r.json()["already_confirmed"] is True and len(emails) == sent_before
    # Un navigateur est redirigé vers le site
    r = client.get(f"/api/estimates/confirm/{token}", headers={"accept": "text/html,application/xhtml+xml"}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("/estimer?confirmation=ok")


def test_lien_invalide_ou_expire(client, emails):
    assert client.get("/api/estimates/confirm/inconnu", headers={"accept": "application/json"}).status_code == 404
    r = client.get("/api/estimates/confirm/inconnu", headers={"accept": "text/html"}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("/estimer?confirmation=invalide")
    email = f"expire-{uuid.uuid4().hex[:8]}@test.fr"
    r = client.post("/api/estimates", json={"ca": 300000, "ebe": 40000, "email": email})
    assert r.status_code == 200
    token = CONFIRM_RE.search(last_email(email, "Confirmez")["html"]).group(1)
    db_call(client, server.db.estimates.update_many, {"email": email},
            {"$set": {"expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}})
    assert client.get(f"/api/estimates/confirm/{token}", headers={"accept": "application/json"}).status_code == 410
    r = client.get(f"/api/estimates/confirm/{token}", headers={"accept": "text/html"}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("/estimer?confirmation=expire")
    assert db_call(client, server.db.estimates.find_one, {"email": email})["status"] == "pending_confirmation"


def test_purge_quotidienne_des_estimations(client):
    now = datetime.now(timezone.utc)

    def doc(status, days_ago, tag):
        return {"id": f"purge-{tag}-{uuid.uuid4().hex[:6]}", "email": f"{tag}@test.fr", "status": status,
                "created_at": (now - timedelta(days=days_ago)).isoformat(), "tag": tag}

    db_call(client, server.db.estimates.insert_many, [
        doc("pending_confirmation", 8, "pending-old"), doc("pending_confirmation", 2, "pending-recent"),
        doc("confirmed", 3 * 365 + 5, "confirmed-old"), doc("confirmed", 100, "confirmed-recent")])
    assert db_call(client, estimator.daily_job, now) == 2
    remaining = {d["tag"] for d in db_call(client, server.db.estimates.find({"tag": {"$exists": True}}, {"_id": 0}).to_list, 10)}
    assert remaining == {"pending-recent", "confirmed-recent"}
    assert db_call(client, estimator.daily_job, now) == 0
    assert any(name == "estimator" for name, _ in server.DAILY_JOBS)


def test_gabarits_ajoutes_au_module_metier():
    from business_model import EMAIL_TEMPLATES
    assert "estimate_confirm" in EMAIL_TEMPLATES and "estimate_result" in EMAIL_TEMPLATES
    assert "estimator" in server.LOADED_MODULES
