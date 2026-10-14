"""
Intégration de la vague 1 (refonte octobre 2026) : branchements entre chantiers dans server.py.
- open data (recherche-entreprises simulée dans conftest) pour les contrôles d'une SCI propriétaire (SPEC §5.4)
- publication automatique : motifs bloquants → brouillon + e-mail, correction → re-soumission (SPEC §5.4)
- étape de vente créée à l'acceptation d'une offre d'achat (closing.py, SPEC §7.4)
- onglet « À faire » et digest quotidien admin (SPEC §9)
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
    c = client.post("/api/properties", headers=api.h(seller), json=listing(siret=siret)).json()
    api.publish(seller, c["id"])
    return seller, c


# ---------- Routes de l'ancienne plateforme retirées ----------

def test_routes_entreprise_retirees(api, client):
    seller = api.register(uid("ret"), "seller", first="Paul", last="Dupont")
    assert client.get("/api/property/123456789/dirigeants").status_code == 404
    assert client.post("/api/property/111222333/verify-dirigeant", headers=api.h(seller)).status_code == 404
    assert client.get("/api/rge/verify/123456789").status_code == 404
    assert client.get("/api/estimates/property/12345678900011").status_code in (404, 405)
    assert client.get("/api/admin/incidents", headers=api.h(api.admin())).status_code == 404


# ---------- Open data : SCI propriétaire ----------

def test_open_data_indisponible_ne_bloque_pas(api, client, monkeypatch):
    import opendata

    def down(url):
        raise opendata.OpenDataUnavailable("timeout")

    monkeypatch.setattr(opendata, "fetch_json", down)
    opendata.clear_cache()
    try:
        seller = api.register(uid("panne"), "seller", first="Paul", last="Dupont")
        api.verify_kyc(seller)
        c = client.post("/api/properties", headers=api.h(seller), json=listing(siret="99988866600011")).json()
        api.ownership(seller, c["id"])
        m = api.mandate(seller, c["id"])
        assert api.sign_mandate(seller, m["contract_id"]).json()["listing_status"] == "published"
        doc = client.get(f"/api/properties/{c['id']}", headers=api.h(seller)).json()
        assert doc["property_checks"]["opendata_available"] is False and doc["property_checks"]["siren_active"] is None
        assert doc["property_checks"]["gerant_match"] is None
        assert "opendata_unavailable" in doc["moderation"]["flags"] and "ownership_pending" in doc["moderation"]["flags"]
    finally:
        opendata.clear_cache()


# ---------- Publication automatique : motifs bloquants, correction, validation des référentiels ----------

def test_annonce_bloquee_puis_corrigee(api, client, emails):
    seller = api.register(uid("bloque"), "seller", first="Paul", last="Dupont")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(dpe_class=None)).json()
    assert c["status"] == "mandat_en_attente"
    assert {b["code"] for b in c["blocking"]} >= {"mandate", "dpe", "ownership_proof"}
    api.ownership(seller, c["id"])
    m = api.mandate(seller, c["id"])
    r = api.sign_mandate(seller, m["contract_id"]).json()
    assert r["listing_status"] == "draft"
    doc = client.get(f"/api/properties/{c['id']}", headers=api.h(seller)).json()
    assert [b["code"] for b in doc["blocking"]] == ["dpe"] and doc["blocked_reason"] == "dpe"
    assert doc["blocking"][0]["label"].startswith("la classe énergie (DPE) n'est pas renseignée")
    e = last_email(seller["email"], "Votre annonce n'est pas encore publiable")
    assert e and "classe énergie" in e["html"]
    # Correction depuis l'espace : re-soumission automatique, publication immédiate
    r = client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"dpe_class": "D"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published" and r.json()["blocking"] == [] and r.json()["dpe_rental"]["status"] == "ok"
    assert client.get(f"/api/properties/{c['id']}").status_code == 200


def _blocking_after_signature(api, client, seller, body):
    c = client.post("/api/properties", headers=api.h(seller), json=body).json()
    api.ownership(seller, c["id"])
    m = api.mandate(seller, c["id"])
    status = api.sign_mandate(seller, m["contract_id"]).json()["listing_status"]
    doc = client.get(f"/api/properties/{c['id']}", headers=api.h(seller)).json()
    return status, doc


def test_controles_de_publication(api, client, monkeypatch):
    paul = api.register(uid("ctrl"), "seller", first="Paul", last="Dupont")
    api.verify_kyc(paul)
    # Logement « non soumis » au DPE : refusé (seuls local, bureaux, parking, autre) ; parking sans surface : accepté
    status, doc = _blocking_after_signature(api, client, paul, listing(dpe_class="non-soumis"))
    assert status == "draft" and [b["code"] for b in doc["blocking"]] == ["dpe"]
    status, doc = _blocking_after_signature(api, client, paul, listing(property_type="parking", lease_type="parking", surface=None,
                                                                      rooms=None, dpe_class="non-soumis", rent_monthly=100,
                                                                      asking_price=25000))
    assert status == "published" and doc["blocking"] == [] and doc["title"] == "Parking loué · Lyon (69)"
    status, doc = _blocking_after_signature(api, client, paul, listing(surface=None))
    assert status == "draft" and [b["code"] for b in doc["blocking"]] == ["surface"]
    # SCI sans SIRET : bloquant, et le mandat ne peut pas être généré ; gérant différent du vendeur : drapeau seulement
    c = client.post("/api/properties", headers=api.h(paul), json=listing(owner_type="sci", company_name="SCI sans numéro")).json()
    assert "siret" in [b["code"] for b in c["blocking"]]
    api.prepare_mandate(paul, c["id"])
    r = client.post("/api/seller/mandat/generate", params={"property_id": c["id"]}, headers=api.h(paul))
    assert r.status_code == 400 and "siret" in r.json()["detail"]["missing"]
    jean = api.register(uid("ctrl-jean"), "seller", first="Jean", last="Martin")
    api.verify_kyc(jean)
    status, doc = _blocking_after_signature(api, client, jean, listing(siret="12312312300011"))
    assert status == "published" and "gerant_mismatch" in doc["moderation"]["flags"]
    assert doc["property_checks"]["gerant_match"] == "no_match" and doc["property_checks"]["siren_active"] is True
    # Locataire en impayés, DPE G en location (interdite depuis 2025) : drapeaux non bloquants, visibles de l'admin
    status, doc = _blocking_after_signature(api, client, paul, listing(tenant_payment_status="impayes", dpe_class="G"))
    assert status == "published" and {"tenant_unpaid", "dpe_rental_ban"} <= set(doc["moderation"]["flags"])
    assert doc["property_checks"]["dpe_rental_status"] == "interdit"
    # Société cessée au registre national : bloquant
    import copy
    import opendata
    from conftest import _fake_fetch

    def ceased(url):
        data = copy.deepcopy(_fake_fetch(url))
        for result in data.get("results", []):
            result["etat_administratif"] = "C"
            result["siege"]["etat_administratif"] = "C"
            for e in result.get("matching_etablissements", []):
                e["etat_administratif"] = "C"
        return data

    monkeypatch.setattr(opendata, "fetch_json", ceased)
    opendata.clear_cache()
    try:
        status, doc = _blocking_after_signature(api, client, paul, listing(siret="98798798700011"))
        assert status == "draft" and "societe_cessee" in [b["code"] for b in doc["blocking"]]
        assert doc["property_checks"]["siren_active"] is False
    finally:
        opendata.clear_cache()


def test_validation_des_referentiels(api, client):
    seller = api.register(uid("ref"), "seller")
    for bad, field in (({"property_type": "chateau"}, "property_type"), ({"lease_type": "bail-emphyteotique"}, "lease_type"),
                       ({"dpe_class": "H"}, "dpe_class"), ({"postal_code": "123"}, "postal_code"), ({"rent_monthly": -5}, "rent_monthly"),
                       ({"sale_object": "parts"}, "sale_object"), ({"siret": "123"}, "siret"), ({"indexation": "icc"}, "indexation"),
                       ({"lease_start": "01/02/2023"}, "lease_start")):
        r = client.post("/api/properties", headers=api.h(seller), json=listing(**bad))
        assert r.status_code == 400 and r.json()["detail"]["code"] == "validation" and r.json()["detail"]["field"] == field, (bad, r.text)
    r = client.post("/api/properties", headers=api.h(seller),
                    json=listing(siret="333 444 999 00011", name="SCI du Port", postal_code="29200", city="Brest", dpe_class="d",
                                 sale_object="indifferent", sale_reason="succession"))
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["department"] == "29" and c["region"] == "Bretagne" and c["siret"] == "33344499900011" and c["dpe_class"] == "D"
    assert c["title"] == "Appartement T2 loué · 42 m² · Brest (29)" and c["gross_yield"] == 4.8
    assert c["commission_terms_version"] == "v1" and c["sale_object"] == "indifferent"
    # Parts possibles pour une SCI ; le titre ne contient jamais l'adresse
    r = client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"sale_object": "parts", "rooms": 3})
    assert r.status_code == 200 and r.json()["sale_object"] == "parts" and r.json()["title"].startswith("Appartement T3 loué")
    assert c["address"] not in r.json()["title"]
    r = client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"description": "x" * 3001})
    assert r.status_code in (400, 422)


# ---------- Étape de vente créée à l'acceptation d'une offre ----------

def test_acceptation_offre_cree_etape_de_vente(api, client, emails):
    seller, c = _published(api, client, "clo", "22233355500011")
    buyer = api.register(uid("clo-acq"), "buyer", first="Marie", last="Martin")
    offer = {"id": str(uuid.uuid4()), "property_id": c["id"], "buyer_id": buyer["id"], "buyer_email": buyer["email"],
             "seller_id": seller["id"], "amount": 190000, "status": "pending", "created_at": NOW.isoformat()}
    db_call(client, server.db.offers.insert_one, offer)
    r = client.put(f"/api/offers/{offer['id']}/respond", headers=api.h(seller), json={"action": "accept"})
    assert r.status_code == 200, r.text
    closing = db_call(client, server.db.closings.find_one, {"offer_id": offer["id"]}, {"_id": 0})
    assert closing and closing["status"] == "in_progress" and closing["seller_id"] == seller["id"] and closing["buyer_id"] == buyer["id"]
    assert closing["offer_amount"] == 190000
    mine = client.get("/api/closing/my", headers=api.h(buyer)).json()
    assert any(x["id"] == closing["id"] for x in (mine if isinstance(mine, list) else mine.get("closings", [])))
    # Checklist envoyée aux deux parties
    assert last_email(seller["email"], "Offre acceptée : les prochaines étapes")
    assert last_email(buyer["email"], "Offre acceptée : les prochaines étapes")


# ---------- Onglet « À faire », digest quotidien ----------

def test_admin_todo_et_digest(api, client, emails):
    seller, c = _published(api, client, "todo", "11122244400011")
    buyer = api.register(uid("todo-acq"), "buyer")
    # Demande de dossier sans réponse depuis 9 jours
    db_call(client, server.db.dataroom_access.insert_one,
            {"id": str(uuid.uuid4()), "property_id": c["id"], "buyer_id": buyer["id"], "buyer_email": buyer["email"],
             "status": "pending", "requested_at": (NOW - timedelta(days=9)).isoformat()})
    db_call(client, server.db.job_failures.insert_one, {"job": "test_job", "error": "boom", "at": NOW.isoformat()})
    assert client.get("/api/admin/todo", headers=api.h(seller)).status_code == 403
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    keys = {s["key"]: s for s in todo["sections"]}
    assert {"listings_review", "dataroom_unanswered", "closings_declared", "closings_stale", "todos", "mandates_expiring",
            "ownership_proofs", "job_failures", "kyc_manual"} <= set(keys) and "incidents" not in keys
    assert any(r["ref"].get("property_id") == c["id"] for r in keys["dataroom_unanswered"]["rows"])
    # Justificatif de propriété déposé (publication) et pas encore contrôlé
    proof = next(r for r in keys["ownership_proofs"]["rows"] if r["ref"]["property_id"] == c["id"])
    assert proof["ref"]["doc_type"] == "titre-propriete" and proof["ref"]["uploaded_at"] and proof["ref"]["owner_type"] == "sci"
    assert [a["label"] for a in proof["actions"]] == ["Voir le justificatif", "Valider", "Refuser avec motif"]
    assert any("test_job" in r["title"] for r in keys["job_failures"]["rows"])
    assert todo["total"] >= 3
    # Digest : un seul e-mail admin, sections non vides seulement
    emails.clear()
    client.post("/api/admin/jobs/run", headers=api.h(api.admin()))
    digest = [e for e in emails if e["to"] == "admin@test.fr" and "À faire" in e["subject"]]
    assert len(digest) == 1 and "Justificatifs de propriété" in digest[0]["html"] and "Demandes de dossier" in digest[0]["html"]
    assert "BODACC" not in digest[0]["html"]


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
