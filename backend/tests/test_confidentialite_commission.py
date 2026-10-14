"""Verrous du référentiel v2 : aucune coordonnée entre membres, masquage avant NDA, barème de commission"""
import uuid

import server
from business_model import calculate_commission
from conftest import listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def setup_deal(api, client):
    seller, buyer = api.register(uid("vendeur"), "seller"), api.register(uid("acheteur"), "buyer")
    for u in (seller, buyer):
        api.verify_kyc(u)
    c = client.post("/api/companies", headers=api.h(seller), json=listing()).json()
    api.publish(seller, c["id"])
    client.post(f"/api/companies/{c['id']}/contact", headers=api.h(buyer))
    return seller, buyer, c["id"]


def all_text(obj):
    return str(obj)


def test_no_member_email_in_messages_requests_offers(api, client):
    seller, buyer, cid = setup_deal(api, client)
    client.post("/api/messages", headers=api.h(buyer), json={"receiver_id": seller["id"], "company_id": cid, "content": "Bonjour"})
    client.post("/api/messages", headers=api.h(seller), json={"receiver_id": buyer["id"], "company_id": cid, "content": "Bonjour"})
    conv_seller = client.get("/api/messages/conversations", headers=api.h(seller)).json()
    conv_buyer = client.get("/api/messages", headers=api.h(buyer)).json()
    assert buyer["email"] not in all_text(conv_seller)
    assert seller["email"] not in all_text(conv_buyer)
    conv = next(x for x in conv_seller if x["company_id"] == cid)
    assert conv["other_party_label"].startswith("Acquéreur n°") and "name" not in conv["buyer_card"]
    thread = client.get("/api/messages", params={"conversation_id": conv["id"]}, headers=api.h(seller)).json()
    labels = {m["sender_label"] for m in thread}
    assert "Vous" in labels and any(l.startswith("Acquéreur n°") for l in labels)

    client.post(f"/api/dataroom/{cid}/request-access", headers=api.h(buyer))
    reqs = client.get(f"/api/dataroom/{cid}/access-requests", headers=api.h(seller)).json()
    assert buyer["email"] not in all_text(reqs)
    assert reqs[0]["buyer_label"].startswith("Acquéreur n°") and "name" not in reqs[0]["buyer_card"]


def test_contacts_masked_before_nda_visible_to_admin(api, client):
    seller, buyer, cid = setup_deal(api, client)
    r = client.post("/api/messages", headers=api.h(buyer), json={
        "receiver_id": seller["id"], "company_id": cid, "content": "Appelez-moi au 06 12 34 56 78 ou jean@exemple.fr"})
    assert "06 12 34 56 78" not in r.text and "jean@exemple.fr" not in r.text
    seen = client.get("/api/messages", headers=api.h(seller)).json()
    assert all("06 12 34 56 78" not in m["content"] for m in seen)
    # Le texte d'origine est conservé en base pour les incidents (plus de lecture en clair par une route admin)
    stored = client.portal.call(lambda: server.db.messages.find_one({"id": r.json()["id"]}))
    assert "06 12 34 56 78" in stored["content_original"] and stored["contacts_masked"] is True
    assert client.get("/api/admin/messages", headers=api.h(api.admin())).status_code == 404


def test_commission_scale_ht_ttc():
    mid = calculate_commission(600000)
    assert mid["final_commission_ht"] == 36000 and mid["final_commission_ttc"] == 43200 and mid["payer"] == "cedant"
    assert calculate_commission(800000)["final_commission_ttc"] == 57600


def test_no_buyer_payment_route_and_public_config(api, client):
    cfg = client.get("/api/config").json()
    assert cfg["seller_commission"] is True and cfg["commission_payer"] == "cedant"
    assert cfg["commission_scale"]["rate_percent"] == 6 and cfg["commission_scale"]["minimum_ht"] == 4000
    assert "buyer_credits" not in cfg
    buyer = api.register(uid("a"), "buyer")
    for path in ("/api/payments/create-checkout", "/api/credits/balance", "/api/credits/packs"):
        assert client.post(path, headers=api.h(buyer), json={"pack_type": "starter"}).status_code in (404, 405)
        assert client.get(path, headers=api.h(buyer)).status_code in (404, 405)


def test_export_rgpd_sans_coordonnees_de_l_autre_partie(api, client):
    """GET /auth/export : les e-mails de l'autre partie (messages.sender_email, offres, NDA signed_by) ne sont pas exportés"""
    seller, buyer, cid = setup_deal(api, client)
    client.post("/api/messages", headers=api.h(buyer), json={"receiver_id": seller["id"], "company_id": cid, "content": "Bonjour"})
    client.post("/api/messages", headers=api.h(seller), json={"receiver_id": buyer["id"], "company_id": cid, "content": "Bonjour"})
    api.grant_dataroom(seller, buyer, cid)
    export_buyer = client.get("/api/auth/export", headers=api.h(buyer)).json()
    export_seller = client.get("/api/auth/export", headers=api.h(seller)).json()
    assert export_buyer["messages"] and export_seller["messages"] and export_buyer["contracts"]
    # Le texte intégral des contrats signés (identité du repreneur dans le NDA, consultable en PDF par les parties) reste exporté
    for export in (export_buyer, export_seller):
        for contract in export["contracts"]:
            contract.pop("content", None)
            contract.pop("content_after_signature", None)
    assert seller["email"] not in all_text(export_buyer)
    assert buyer["email"] not in all_text(export_seller)
    # Les coordonnées du titulaire restent exportées
    assert export_buyer["account"]["email"] == buyer["email"]
    assert any(m.get("sender_email") == buyer["email"] for m in export_buyer["messages"])
