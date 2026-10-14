"""
Intégration de la vague 1 (refonte octobre 2026) : branchements entre chantiers dans server.py.
- open data (recherche-entreprises simulée dans conftest) pour les dirigeants et les contrôles de publication (§2.3, §4.4)
- publication automatique : motifs bloquants → brouillon + e-mail, correction → re-soumission (§4.4)
- étape de vente créée à l'acceptation d'une offre (closing.py, §4.5)
- onglet « À faire » et digest quotidien admin (§6.1, §6.3)
- statistiques maison dans /admin/metrics (§6.2), mentions légales (§1), suppression de compte (§4.1)
"""
import uuid
from datetime import datetime, timedelta, timezone

import server
from conftest import listing, last_email

NOW = datetime.now(timezone.utc)


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


def _published(api, client, prefix, siret, first="Paul", last="Dupont"):
    seller = api.register(uid(prefix), "seller", first=first, last=last)
    api.verify_kyc(seller)
    c = client.post("/api/companies", headers=api.h(seller), json=listing(siret=siret)).json()
    api.publish(seller, c["id"])
    return seller, c


# ---------- Open data : dirigeants et vérification ----------

def test_dirigeants_route_lit_le_registre_national(api, client):
    r = client.get("/api/company/123456789/dirigeants")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["found"] is True and data["source"] == "API_GOUV_ENTREPRISES"
    assert data["company"]["siren"] == "123456789" and data["company"]["departement"] == "29"
    assert data["president"]["nom_complet"] == "Paul DUPONT" and data["president"]["prenom"] == "Paul"
    assert client.get("/api/company/12/dirigeants").status_code == 400


def test_verify_dirigeant_statuts_et_motif(api, client, db):
    jean = api.register(uid("jean"), "seller", first="Jean", last="Test")
    r = client.post("/api/company/111222333/verify-dirigeant", headers=api.h(jean)).json()
    assert r["verified"] is False and r["status"] == "no_match" and r["reason"] == "name_mismatch"
    assert r["can_invite_president"] is True and r["president"]["nom_complet"] == "Paul DUPONT"
    paul = api.register(uid("paul"), "seller", first="Paul", last="Dupont")
    r = client.post("/api/company/111222333/verify-dirigeant", headers=api.h(paul)).json()
    assert r["verified"] is True and r["status"] == "match_exact" and r["matched_as"] == "Président"
    stored = db_call(client, server.db.dirigeant_verifications.find_one, {"user_id": paul["id"], "siren": "111222333"})
    assert stored["status"] == "match_exact" and stored["reason"] is None and stored["identity_source"] == "declared"


def test_open_data_indisponible_ne_bloque_pas(api, client, monkeypatch):
    import opendata

    def down(url):
        raise opendata.OpenDataUnavailable("timeout")

    monkeypatch.setattr(opendata, "fetch_json", down)
    opendata.clear_cache()
    try:
        seller = api.register(uid("panne"), "seller", first="Paul", last="Dupont")
        api.verify_kyc(seller)
        c = client.post("/api/companies", headers=api.h(seller), json=listing(siret="99988866600011")).json()
        m = api.mandate(seller, c["id"])
        assert api.sign_mandate(seller, m["contract_id"]).json()["listing_status"] == "published"
        doc = client.get(f"/api/companies/{c['id']}", headers=api.h(seller)).json()
        assert doc["company_checks"]["opendata_available"] is False and doc["company_checks"]["siren_active"] is None
        assert "open_data_indisponible" in doc["moderation"]["flags"]
    finally:
        opendata.clear_cache()


# ---------- Publication automatique : motifs bloquants, correction, validation des référentiels ----------

def test_annonce_bloquee_puis_corrigee(api, client, emails):
    seller = api.register(uid("bloque"), "seller", first="Paul", last="Dupont")
    api.verify_kyc(seller)
    c = client.post("/api/companies", headers=api.h(seller), json=listing(siret="55566688800011", asking_price=0)).json()
    assert c["status"] == "mandat_en_attente"
    m = api.mandate(seller, c["id"])
    r = api.sign_mandate(seller, m["contract_id"]).json()
    assert r["listing_status"] == "draft"
    doc = client.get(f"/api/companies/{c['id']}", headers=api.h(seller)).json()
    assert doc["blocking"] == ["prix_manquant"] and doc["blocked_reason"] == "prix_manquant"
    e = last_email(seller["email"], "Votre annonce n'est pas encore publiable")
    assert e and "prix demandé" in e["html"]
    # Correction depuis l'espace : re-soumission automatique, publication immédiate
    r = client.put(f"/api/companies/{c['id']}", headers=api.h(seller), json={"asking_price": 420000})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published" and r.json()["blocking"] == []
    assert client.get(f"/api/companies/{c['id']}").status_code == 200


def test_doublon_siren_bloquant(api, client):
    seller1, c1 = _published(api, client, "dbl1", "44455577700011")
    seller2 = api.register(uid("dbl2"), "seller", first="Paul", last="Dupont")
    api.verify_kyc(seller2)
    c2 = client.post("/api/companies", headers=api.h(seller2), json=listing(siret="44455577700022")).json()
    m = api.mandate(seller2, c2["id"])
    assert api.sign_mandate(seller2, m["contract_id"]).json()["listing_status"] == "draft"
    doc = client.get(f"/api/companies/{c2['id']}", headers=api.h(seller2)).json()
    assert "doublon_siren" in doc["blocking"] and doc["company_checks"]["duplicate_siren"] is True


def test_validation_des_referentiels(api, client):
    seller = api.register(uid("ref"), "seller")
    r = client.post("/api/companies", headers=api.h(seller), json=listing(siret="33344499900011", trades=["plomberie"]))
    assert r.status_code == 400 and "plomberie" in r.json()["detail"]
    r = client.post("/api/companies", headers=api.h(seller), json=listing(siret="33344499900011", department="Nulle-part"))
    assert r.status_code == 400 and "Département" in r.json()["detail"]
    r = client.post("/api/companies", headers=api.h(seller),
                    json=listing(siret="33344499900011", trades=["isolation", "pac-clim-cvc"], department="Finistère",
                                 other_qualifications=["qualibat"], sale_object="fonds", sale_reason="retraite", handover_months=6))
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["trades"] == ["isolation", "pac-clim-cvc"] and c["department"] == "29" and c["is_rge"] is True
    assert c["other_qualifications"] == ["qualibat"] and c["commission_terms_version"] == "v2"
    # Sans métier : déduit des domaines RGE
    c2 = client.post("/api/companies", headers=api.h(seller), json=listing(siret="33344499900022")).json()
    assert c2["trades"] == ["pac-clim-cvc"]
    r = client.put(f"/api/companies/{c2['id']}", headers=api.h(seller), json={"description": "trop court"})
    assert r.status_code == 400


# ---------- Étape de vente créée à l'acceptation d'une offre ----------

def test_acceptation_offre_cree_etape_de_vente(api, client, emails):
    seller, c = _published(api, client, "clo", "22233355500011")
    buyer = api.register(uid("clo-rep"), "buyer", first="Marie", last="Martin")
    offer = {"id": str(uuid.uuid4()), "company_id": c["id"], "buyer_id": buyer["id"], "buyer_email": buyer["email"],
             "seller_id": seller["id"], "amount": 450000, "status": "pending", "created_at": NOW.isoformat()}
    db_call(client, server.db.offers.insert_one, offer)
    r = client.put(f"/api/offers/{offer['id']}/respond", headers=api.h(seller), json={"action": "accept"})
    assert r.status_code == 200, r.text
    closing = db_call(client, server.db.closings.find_one, {"offer_id": offer["id"]}, {"_id": 0})
    assert closing and closing["status"] == "in_progress" and closing["seller_id"] == seller["id"] and closing["buyer_id"] == buyer["id"]
    assert closing["offer_amount"] == 450000
    mine = client.get("/api/closing/my", headers=api.h(buyer)).json()
    assert any(x["id"] == closing["id"] for x in (mine if isinstance(mine, list) else mine.get("closings", [])))
    # Checklist envoyée aux deux parties
    assert last_email(seller["email"], "Offre acceptée : les prochaines étapes")
    assert last_email(buyer["email"], "Offre acceptée : les prochaines étapes")


# ---------- Onglet « À faire », digest quotidien ----------

def test_admin_todo_et_digest(api, client, emails):
    seller, c = _published(api, client, "todo", "11122244400011")
    buyer = api.register(uid("todo-rep"), "buyer")
    # Demande de dossier sans réponse depuis 9 jours
    db_call(client, server.db.dataroom_access.insert_one,
            {"id": str(uuid.uuid4()), "company_id": c["id"], "buyer_id": buyer["id"], "buyer_email": buyer["email"],
             "status": "pending", "requested_at": (NOW - timedelta(days=9)).isoformat()})
    db_call(client, server.db.job_failures.insert_one, {"job": "test_job", "error": "boom", "at": NOW.isoformat()})
    db_call(client, server.db.incidents.insert_one,
            {"id": "inc-todo", "type": "bodacc", "siren": "111222333", "company_id": c["id"], "status": "open",
             "created_at": NOW.isoformat(), "event": {"famille": "vente", "famille_label": "Vente et cession", "description": "cession"}})
    assert client.get("/api/admin/todo", headers=api.h(seller)).status_code == 403
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    keys = {s["key"]: s for s in todo["sections"]}
    assert {"listings_review", "dataroom_unanswered", "closings_declared", "closings_stale", "todos", "mandates_expiring",
            "incidents", "job_failures", "kyc_manual"} <= set(keys)
    assert any(r["ref"].get("company_id") == c["id"] for r in keys["dataroom_unanswered"]["rows"])
    assert any(r["id"] == "inc-todo" for r in keys["incidents"]["rows"])
    assert any("test_job" in r["title"] for r in keys["job_failures"]["rows"])
    assert todo["total"] >= 3
    # Digest : un seul e-mail admin, sections non vides seulement
    emails.clear()
    client.post("/api/admin/jobs/run", headers=api.h(api.admin()))
    digest = [e for e in emails if e["to"] == "admin@test.fr" and "À faire" in e["subject"]]
    assert len(digest) == 1 and "Incidents BODACC" in digest[0]["html"] and "Demandes de dossier" in digest[0]["html"]


# ---------- Métriques, mentions légales, suppression de compte ----------

def test_metrics_evenements_et_legal_info(api, client):
    client.post("/api/events", json={"name": "page_view", "path": "/estimer"})
    m = client.get("/api/admin/metrics", params={"days": 7}, headers=api.h(api.admin())).json()
    assert m["events"]["period_days"] == 7 and m["events"]["totals"].get("page_view", 0) >= 1
    info = client.get("/api/public/legal-info").json()
    assert "rc_pro" in info and "mediateur" in info and "ne recevoir ni détenir" in info["fonds_mention"]


def test_suppression_de_compte_purge_les_estimations(api, client):
    seller = api.register(uid("estim"), "seller")
    db_call(client, server.db.estimates.insert_one, {"id": str(uuid.uuid4()), "email": seller["email"], "status": "confirmed",
                                                      "created_at": NOW.isoformat()})
    r = client.request("DELETE", "/api/auth/account", headers=api.h(seller), json={"password": "Password1!"})
    assert r.status_code == 200
    assert db_call(client, server.db.estimates.count_documents, {"email": seller["email"]}) == 0
