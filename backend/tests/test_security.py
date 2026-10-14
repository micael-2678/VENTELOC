"""Failles corrigées lors de l'audit : elles ne doivent jamais revenir"""
import uuid
from conftest import listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def published_listing(api, client):
    seller = api.register(uid("vendeur"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/companies", headers=api.h(seller), json=listing()).json()
    api.publish(seller, c["id"])
    return seller, c


def test_admin_role_cannot_be_self_assigned(client):
    r = client.post("/api/auth/register", json={"email": uid("x"), "password": "Password1!", "role": "admin"})
    assert r.status_code == 422


def test_short_password_rejected(client):
    r = client.post("/api/auth/register", json={"email": uid("x"), "password": "abc", "role": "buyer"})
    assert r.status_code == 422


def test_login_case_insensitive_and_no_hash(api, client):
    email = uid("Case")
    api.register(email, "buyer")
    r = client.post("/api/auth/login", json={"email": email.upper(), "password": "Password1!"})
    assert r.status_code == 200 and "password_hash" not in r.text


def test_listing_anonymous_until_nda(api, client):
    seller, c = published_listing(api, client)
    public = client.get("/api/companies").json()
    assert all("siret" not in x and "company_name" not in x and "seller_email" not in x for x in public)
    buyer = api.register(uid("acheteur"), "buyer")
    detail = client.get(f"/api/companies/{c['id']}", headers=api.h(buyer)).json()
    assert "company_name" not in detail and "siret" not in detail
    assert client.get(f"/api/companies/{c['id']}", headers=api.h(seller)).json()["company_name"] == "SECRET ENERGIE SAS"


def test_unpublished_listing_hidden(api, client):
    seller = api.register(uid("vendeur"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/companies", headers=api.h(seller), json=listing()).json()
    assert c["status"] == "mandat_en_attente"
    assert client.get(f"/api/companies/{c['id']}").status_code == 404


def test_legacy_forgery_routes_removed(api, client):
    _, c = published_listing(api, client)
    buyer = api.register(uid("acheteur"), "buyer")
    assert client.post("/api/documents/sign", headers=api.h(buyer),
                       json={"company_id": c["id"], "doc_type": "loi", "data": {}}).status_code in (404, 405)
    assert client.get(f"/api/dataroom/{c['id']}/files", headers=api.h(buyer)).status_code in (404, 405)


def test_message_to_third_party_rejected(api, client):
    _, c = published_listing(api, client)
    buyer, other = api.register(uid("a"), "buyer"), api.register(uid("b"), "buyer")
    api.verify_kyc(buyer)
    r = client.post("/api/messages", headers=api.h(buyer), json={"receiver_id": other["id"], "company_id": c["id"], "content": "spam"})
    assert r.status_code == 400


def test_kyc_webhook_requires_signature(client):
    r = client.post("/api/kyc/webhook", content=b'{"type":"identity.verification_session.verified"}')
    assert r.status_code in (400, 503)


def test_refund_route_removed_and_metrics_are_admin_only(api, client):
    buyer = api.register(uid("a"), "buyer")
    assert client.get("/api/credits/check-refunds", headers=api.h(api.admin())).status_code == 404
    assert client.get("/api/admin/metrics", headers=api.h(buyer)).status_code == 403
    assert client.post("/api/admin/jobs/run", headers=api.h(buyer)).status_code == 403


def test_upload_type_and_size_limits(api, client):
    seller, c = published_listing(api, client)
    r = client.post(f"/api/dataroom/{c['id']}/documents", headers=api.h(seller),
                    files={"file": ("x.exe", b"MZ", "application/x-msdownload")}, data={"category": "autres"})
    assert r.status_code == 400
