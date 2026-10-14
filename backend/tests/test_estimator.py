"""Estimateur par la méthode du rendement (estimator.py, SPEC §6.1) : loyer net / rendement net attendu selon la zone et
le type de bien, arrondi au millier ; aucune donnée nominative sans consentement, double opt-in, confirmation"""
import re
import uuid
from datetime import datetime, timedelta, timezone

import server  # noqa: F401
import estimator
from conftest import last_email

CONFIRM_RE = re.compile(r"/api/estimates/confirm/([A-Za-z0-9_\-]+)")
# Appartement loué vide à Lyon (zone 2 : 3,5 % à 5 % net), 800 € HC, taxe foncière 900 €, charges non récupérables 400 €
BASE = {"property_type": "appartement", "lease_type": "habitation-vide", "department": "69", "rent_monthly": 800,
        "property_tax": 900, "non_recoverable_charges": 400}


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


# ---------- Formule ----------

def test_methode_du_rendement_zone_2():
    r = estimator.compute_estimate("appartement", "habitation-vide", "69", 800, 900, 400)
    # Loyer net : 9 600 − 900 − 400 = 8 300 € ; 8 300 / 5 % = 166 000 ; 8 300 / 3,5 % = 237 143 → 237 000 ; milieu 201 500 → 202 000
    assert (r["low"], r["high"], r["mid"]) == (166_000, 237_000, 202_000)
    assert r["zone"] == 2 and r["expected_net_yield"] == {"low": 3.5, "high": 5.0} and r["net_rent"] == 8300
    assert r["yields"] == {"gross_at_mid": 4.75, "net_at_mid": 4.11}
    assert "rendement" in r["method"] and "avis de valeur" in r["disclaimer"]
    assert all(set(d) == {"label", "effect"} for d in r["drivers"])
    assert len(r["pedagogy"]) == 5 and any("GLI" in p or "garantie loyers impayés" in p for p in r["pedagogy"])


def test_valeurs_par_defaut_taxe_et_charges():
    r = estimator.compute_estimate("appartement", "habitation-vide", "75", 1000)
    # Paris (2,5-3,5 %) : taxe foncière = un mois de loyer, charges non récupérables = 5 % des loyers → net 10 400 €
    assert r["zone"] == 1 and r["property_tax_used"] == 1000 and r["non_recoverable_used"] == 600
    assert (r["low"], r["high"]) == (297_000, 416_000)
    labels = " ".join(d["label"] for d in r["drivers"])
    assert "Taxe foncière non saisie" in labels and "Charges non récupérables non saisies" in labels


def test_majorations_par_type_de_bien_et_dpe():
    local = estimator.compute_estimate("local-commercial", "commercial", "22", 1000, 1200, 600)
    # Zone 3 (5-7,5 %) + 1,5 point → 6,5-9 % ; net 10 200 €
    assert local["zone"] == 3 and local["expected_net_yield"] == {"low": 6.5, "high": 9.0}
    assert (local["low"], local["high"]) == (113_000, 157_000)
    assert estimator.compute_estimate("parking", "parking", "22", 100, 100, 60)["expected_net_yield"] == {"low": 6.0, "high": 8.5}
    assert estimator.compute_estimate("residence-geree", "residence-geree", "22", 500, 400, 200)["expected_net_yield"] == {"low": 5.5, "high": 8.0}
    f = estimator.compute_estimate("appartement", "habitation-vide", "69", 800, 900, 400, dpe_class="G")
    assert f["expected_net_yield"] == {"low": 4.5, "high": 6.0} and (f["low"], f["high"]) == (138_000, 184_000)
    assert any("classé G" in d["label"] for d in f["drivers"])
    # Un local commercial classé G n'a pas la majoration « logement » (pas de calendrier de décence énergétique)
    assert estimator.compute_estimate("local-commercial", "commercial", "22", 1000, 1200, 600, dpe_class="G")["low"] == local["low"]


def test_rendements_au_prix_envisage():
    r = estimator.compute_estimate("appartement", "habitation-vide", "69", 800, 900, 400, asking_price=250_000)
    assert r["yields"]["gross_at_price"] == 3.84 and r["yields"]["net_at_price"] == 3.32
    assert any("au-dessus" in d["effect"] for d in r["drivers"])


def test_entrees_invalides():
    import pytest
    for args in (("inconnu", "habitation-vide", "69", 800), ("appartement", "bail-inconnu", "69", 800),
                 ("appartement", "habitation-vide", "999", 800), ("appartement", "habitation-vide", "69", 0)):
        with pytest.raises(ValueError):
            estimator.compute_estimate(*args)
    with pytest.raises(ValueError):
        estimator.compute_estimate("appartement", "habitation-vide", "69", 100, 900, 400)  # charges > loyers


# ---------- Route POST /estimates ----------

def test_estimation_sans_email_ne_stocke_aucune_donnee_nominative(client, emails):
    r = client.post("/api/estimates", json={**BASE, "surface": 42, "asking_price": 200000})
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"id", "low", "high", "mid", "method", "drivers", "pedagogy", "yields", "disclaimer"} <= set(body)
    assert body["low"] < body["mid"] < body["high"] and "email" not in body
    assert {"gross_at_mid", "net_at_mid", "gross_at_price", "net_at_price"} <= set(body["yields"])
    doc = db_call(client, server.db.estimates.find_one, {"id": body["id"]})
    assert doc["status"] == "anonymous" and "email" not in doc and "consent" not in doc
    assert doc["inputs"]["rent_monthly"] == 800 and doc["result"]["low"] == body["low"]
    assert emails == []


def test_validation_des_entrees(client):
    assert client.post("/api/estimates", json={**BASE, "rent_monthly": -5}).status_code == 422
    r = client.post("/api/estimates", json={**BASE, "rent_monthly": 0})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "validation" and "loyer" in r.json()["detail"]["message"]
    r = client.post("/api/estimates", json={**BASE, "property_type": "entreprise"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "validation"
    assert client.post("/api/estimates", json={**BASE, "email": "pas-un-email", "consent": True}).status_code == 422
    # Adresse sans consentement : refusée, rien n'est conservé
    r = client.post("/api/estimates", json={**BASE, "email": "sans-consentement@test.fr"})
    assert r.status_code == 400 and r.json()["detail"]["field"] == "consent"
    assert db_call(client, server.db.estimates.find_one, {"email": "sans-consentement@test.fr"}) is None


def test_routes_siret_et_ademe_supprimees(client):
    assert client.get("/api/estimates/company/55203253400018").status_code == 404
    assert client.get("/api/estimates/property/55203253400018").status_code in (404, 405)


# ---------- Double opt-in ----------

def test_email_double_opt_in_puis_confirmation(client, emails):
    email = f"estim-{uuid.uuid4().hex[:8]}@test.fr"
    r = client.post("/api/estimates", json={**BASE, "email": email.upper(), "consent": True},
                    headers={"x-forwarded-for": "198.51.100.20"})
    assert r.status_code == 200, r.text
    info = r.json()["email"]
    assert info["confirmation_required"] is True and info["email_sent"] is True and info["estimate_id"] == r.json()["id"]
    doc = db_call(client, server.db.estimates.find_one, {"id": info["estimate_id"]})
    assert doc["email"] == email and doc["status"] == "pending_confirmation"
    assert doc["consent"]["purpose"] == "estimation" and doc["consent"]["confirmed_at"] is None
    assert "198.51.100.20" not in str(doc) and "confirm_token_hash" in doc
    assert doc["inputs"]["property_tax"] == 900 and doc["result"]["low"] == r.json()["low"]
    e = last_email(email, "Confirmez votre adresse pour recevoir votre estimation")
    assert e, "e-mail de confirmation attendu"
    token = CONFIRM_RE.search(e["html"]).group(1)
    assert token not in str(doc), "seule l'empreinte du jeton est stockée"
    # Deuxième demande immédiate : pas de second e-mail
    r2 = client.post("/api/estimates", json={**BASE, "email": email, "consent": True})
    assert r2.status_code == 429
    assert len([x for x in emails if x["to"] == email]) == 1

    # Confirmation par appel JSON (fetch) : estimation renvoyée + e-mail de résultat
    r = client.get(f"/api/estimates/confirm/{token}", headers={"accept": "application/json"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["confirmed"] is True and body["already_confirmed"] is False
    assert body["estimate"]["result"]["low"] == doc["result"]["low"]
    doc = db_call(client, server.db.estimates.find_one, {"id": info["estimate_id"]})
    assert doc["status"] == "confirmed" and doc["consent"]["confirmed_at"] and doc["confirmed_at"]
    result_mail = last_email(email, "Votre estimation")
    assert result_mail and "/register?role=seller" in result_mail["html"] and "bien loué" in result_mail["html"]
    assert "€" in result_mail["subject"] and "Ce qui fait monter le prix" in result_mail["html"]
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
    r = client.post("/api/estimates", json={**BASE, "email": email, "consent": True})
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
        doc("confirmed", 3 * 365 + 5, "confirmed-old"), doc("confirmed", 100, "confirmed-recent"),
        doc("anonymous", 3 * 365 + 5, "anonymous-old"), doc("anonymous", 10, "anonymous-recent")])
    assert db_call(client, estimator.daily_job, now) == 3
    remaining = {d["tag"] for d in db_call(client, server.db.estimates.find({"tag": {"$exists": True}}, {"_id": 0}).to_list, 10)}
    assert remaining == {"pending-recent", "confirmed-recent", "anonymous-recent"}
    assert db_call(client, estimator.daily_job, now) == 0
    assert any(name == "estimator" for name, _ in server.DAILY_JOBS)


def test_gabarits_ajoutes_au_module_metier():
    from business_model import EMAIL_TEMPLATES
    assert "estimate_confirm" in EMAIL_TEMPLATES and "estimate_result" in EMAIL_TEMPLATES
    assert "estimator" in server.LOADED_MODULES
