"""Parcours complet de mise en relation : contact → demande de dossier → identité → NDA → data room → offre indicative"""
import base64
import io
import uuid

from conftest import listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def make_pdf(text="Bilan 2025"):
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(100, 750, text)
    c.save()
    return buf.getvalue()


def test_full_matching_flow(api, client, emails):
    seller = api.register(uid("vendeur"), "seller")
    buyer = api.register(uid("acheteur"), "buyer")
    for u in (seller, buyer):
        api.verify_kyc(u)
    c = client.post("/api/companies", headers=api.h(seller), json=listing()).json()
    api.publish(seller, c["id"])
    cid = c["id"]

    assert client.post(f"/api/companies/{cid}/contact", headers=api.h(buyer)).status_code == 200
    assert client.post("/api/messages", headers=api.h(buyer), json={"receiver_id": seller["id"], "company_id": cid, "content": "Bonjour"}).status_code == 200
    assert client.post("/api/messages", headers=api.h(seller), json={"receiver_id": buyer["id"], "company_id": cid, "content": "Bonjour à vous"}).status_code == 200

    # La lettre d'intention n'existe plus ; le NDA exige une demande de dossier acceptée par le cédant
    assert client.post("/api/contracts/generate-for-signature", headers=api.h(buyer), json={"company_id": cid, "doc_type": "loi"}).status_code == 422
    r = client.post("/api/contracts/generate-for-signature", headers=api.h(buyer), json={"company_id": cid, "doc_type": "nda"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "not_allowed"

    client.post(f"/api/dataroom/{cid}/request-access", headers=api.h(buyer))
    req = client.get(f"/api/dataroom/{cid}/access-requests", headers=api.h(seller)).json()[0]
    assert "kyc_documents" not in req["buyer"] and "password_hash" not in req["buyer"] and "email" not in str(req)
    assert req["status"] == "pending" and req["expires_at"] and req["buyer_card"]["profile_score"] >= 50
    assert client.put(f"/api/dataroom/{cid}/access/{req['id']}/validate", headers=api.h(seller)).status_code == 200

    nda = client.post("/api/contracts/generate-for-signature", headers=api.h(buyer), json={"company_id": cid, "doc_type": "nda"}).json()
    assert "SECRET ENERGIE" not in nda["content"] and "{{" not in nda["content"]
    assert "commission" not in nda["content"].lower().split("article 6")[0] or "charge de l'acquéreur" not in nda["content"].lower()
    signed = api.sign_contract(buyer, nda["contract_id"])
    assert signed.status_code == 200 and signed.json()["identity_revealed"] is True
    assert client.get(f"/api/companies/{cid}", headers=api.h(buyer)).json()["company_name"] == "SECRET ENERGIE SAS"
    # Repreneur présenté, identité révélée, PDF envoyé aux deux parties
    status = client.get(f"/api/seller/mandat/status/{cid}", headers=api.h(seller)).json()
    assert [b["buyer_id"] for b in status["presented_buyers"]] == [buyer["id"]] and status["presented_buyers"][0]["name"] == "Jean Test"
    assert client.portal.call(lambda: server_db().dataroom_access.find_one({"company_id": cid, "buyer_id": buyer["id"]}))["identity_revealed"] is True
    for who in (seller, buyer):
        mail = [e for e in emails if e["to"] == who["email"] and "accord de confidentialité" in e["subject"].lower()]
        assert mail and "/api/documents/" in mail[-1]["html"]

    doc = client.post(f"/api/dataroom/{cid}/documents", headers=api.h(seller),
                      files={"file": ("bilan.pdf", make_pdf(), "application/pdf")}, data={"category": "bilans"}).json()
    # Pas d'accès aux documents avant l'accès accordé (origine des fonds)
    assert client.post(f"/api/dataroom/{cid}/documents/{doc['id']}/view", headers=api.h(buyer)).status_code == 403
    offer_body = {"company_id": cid, "amount": 480000, "sale_object": "titres", "financing": {"equity": 150000, "loan": 330000},
                  "conditions": ["Audit comptable satisfaisant"], "target_date": "2027-03-31", "validity_days": 30}
    r = client.post("/api/offers", headers=api.h(buyer), json=offer_body)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "not_allowed"

    api.grant_dataroom(seller, buyer, cid)
    assert client.get(f"/api/dataroom/{cid}/access-status", headers=api.h(buyer)).json()["access_granted"] is True
    viewed = client.post(f"/api/dataroom/{cid}/documents/{doc['id']}/view", headers=api.h(buyer)).json()["document"]
    pdf = base64.b64decode(viewed["content"])
    from pypdf import PdfReader
    text = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
    assert buyer["email"] in text, "le filigrane doit être incrusté dans le PDF"

    # Offre indicative : création → signature par code → contre-signature du cédant → étape de vente
    created = client.post("/api/offers", headers=api.h(buyer), json=offer_body).json()
    offer, contract_id = created["offer"], created["contract_id"]
    assert offer["status"] == "pending_signature" and "480 000 €" in created["content"]
    assert api.sign_contract(buyer, contract_id).status_code == 200
    code = api.request_code(seller, contract_id)
    assert client.put(f"/api/offers/{offer['id']}/respond", headers=api.h(seller), json={"action": "accept", "otp_code": code}).status_code == 200
    pdf_offer = client.get(f"/api/offers/{offer['id']}/pdf", headers=api.h(buyer)).json()
    assert base64.b64decode(pdf_offer["content"])[:4] == b"%PDF"
    mine = client.get("/api/offers/my", headers=api.h(buyer)).json()["offers"]
    assert mine[0]["status"] == "accepted" and mine[0]["closing_id"]

    subjects = [(e["to"], e["subject"]) for e in emails]
    assert any(to == seller["email"] and s.startswith("Un repreneur vous présente son projet") for to, s in subjects)
    assert any(to == seller["email"] and s.startswith("Offre indicative reçue") for to, s in subjects)
    assert any(to == buyer["email"] and "acceptée" in s for to, s in subjects)
    for e in emails:
        assert "{" not in e["html"] and "Accéder à mon espace" in e["html"]


def server_db():
    import server
    return server.db
