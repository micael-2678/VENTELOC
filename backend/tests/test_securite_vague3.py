"""Correctifs de sécurité (revue vague 3) : invitation du président, vue NDA, masquage des coordonnées dans les textes
libres, suppression de compte, proxys open data, filigrane, liens GET sans effet de bord."""
import uuid

import server
from conftest import listing, last_email


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


# ---------- Invitation du président ----------

def _invite(client, api, seller, cid, **overrides):
    body = {"company_id": cid, "president_firstname": "Paul", "president_lastname": "Dupont",
            "president_email": overrides.pop("email", uid("president"))}
    body.update(overrides)
    return client.post(f"/api/listings/{cid}/invite-president", headers=api.h(seller), json=body)


def test_invitation_president_echappe_le_html(api, client, emails):
    seller = api.register(uid("inv"), "seller")
    cid = client.post("/api/companies", headers=api.h(seller), json=listing()).json()["id"]
    victim = uid("victime")
    r = _invite(client, api, seller, cid, email=victim,
                president_firstname='<a href="https://evil.example/login">Cliquez ici</a>')
    assert r.status_code == 200, r.text
    mail = last_email(victim, "Validation requise")
    assert mail and "evil.example/login\">" not in mail["html"] and "&lt;a href=" in mail["html"]


def test_invitation_president_email_confirme_et_volume_borne(api, client):
    unverified = api.register(uid("inv-nv"), "seller", verify_email=False)
    cid = client.post("/api/companies", headers=api.h(unverified), json=listing()).json()["id"]
    assert _invite(client, api, unverified, cid).status_code == 403
    seller = api.register(uid("inv-v"), "seller")
    cid = client.post("/api/companies", headers=api.h(seller), json=listing()).json()["id"]
    codes = [_invite(client, api, seller, cid).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    # Une seule invitation en attente par annonce
    pending = db_call(client, server.db.president_invitations.count_documents, {"company_id": cid, "status": "pending"})
    assert pending == 1
    assert _invite(client, api, seller, cid, president_firstname="x" * 101).status_code == 422


# ---------- Liens d'e-mail sans effet en GET : désinscription en un clic (RFC 8058) ----------

def test_en_tetes_list_unsubscribe(monkeypatch):
    import importlib.util
    import os
    spec = importlib.util.spec_from_file_location(
        "business_model_copie", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "business_model.py"))
    bm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bm)
    captured = []

    class FakeApi:
        def __init__(self, *_):
            pass

        def send_transac_email(self, email):
            captured.append(email)
            return type("R", (), {"message_id": "x"})()

    monkeypatch.setattr(bm.sib_api_v3_sdk, "TransactionalEmailsApi", FakeApi)
    bm._send_brevo_email_sync("a@test.fr", "A", "Sujet", "<p>x</p>", "https://cessionrge.test/api/alerts/unsubscribe/tok")
    assert captured[-1].headers == {"List-Unsubscribe": "<https://cessionrge.test/api/alerts/unsubscribe/tok>",
                                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
    bm._send_brevo_email_sync("a@test.fr", "A", "Sujet", "<p>x</p>")
    assert captured[-1].headers is None


# ---------- Vue de l'annonce après NDA ----------

def _deal(api, client, prefix, **extra):
    seller, buyer = api.register(uid(f"{prefix}-ced"), "seller"), api.register(uid(f"{prefix}-rep"), "buyer")
    api.verify_kyc(seller)
    cid = client.post("/api/companies", headers=api.h(seller), json=listing(**extra)).json()["id"]
    api.publish(seller, cid)
    client.post(f"/api/companies/{cid}/contact", headers=api.h(buyer))
    return seller, buyer, cid


def test_vue_nda_sans_coordonnees_du_president(api, client):
    seller, buyer, cid = _deal(api, client, "ndapres")
    db_call(client, server.db.companies.update_one, {"id": cid}, {"$set": {
        "president_email": "president@secret.fr", "president_firstname": "Pierre", "president_lastname": "Secret",
        "president_invitation_id": "inv-1", "president_invitation_pending": True}})
    api.grant_dataroom(seller, buyer, cid)
    view = client.get(f"/api/companies/{cid}", headers=api.h(buyer)).json()
    assert view["company_name"] == "SECRET ENERGIE SAS" and view.get("siret")
    for field in ("president_email", "president_firstname", "president_lastname", "president_invitation_id",
                  "president_invitation_pending", "seller_email", "mandant_address", "seller_id"):
        assert field not in view, field
    assert "president@secret.fr" not in str(view)


# ---------- Textes libres : coordonnées masquées ----------

def test_description_et_experience_sans_coordonnees(api, client):
    seller = api.register(uid("desc"), "seller")
    description = ("Entreprise reconnue depuis vingt ans dans l'installation de pompes à chaleur, clientèle fidèle de particuliers "
                   "et de bailleurs sociaux, équipe autonome et carnet de commandes rempli pour six mois. Appelez le "
                   "06 12 34 56 78 ou écrivez à patron@maboite.fr pour en savoir plus.")
    r = client.post("/api/companies", headers=api.h(seller), json=listing(description=description, equipment="Contact : 0612345678"))
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    stored = db_call(client, server.db.companies.find_one, {"id": cid})
    assert "06 12 34 56 78" not in stored["description"] and "patron@maboite.fr" not in stored["description"]
    assert "[coordonnées masquées]" in stored["description"] and "0612345678" not in stored["equipment"]
    r = client.put(f"/api/companies/{cid}", headers=api.h(seller), json={"description": description.replace("06 12", "07 12")})
    assert r.status_code == 200, r.text
    assert "07 12 34 56 78" not in db_call(client, server.db.companies.find_one, {"id": cid})["description"]

    buyer = api.register(uid("exp"), "buyer")
    r = client.put("/api/auth/profile", headers=api.h(buyer),
                   json={"buyer_profile": {**api.BUYER_PROFILE, "experience": "Ancien chef d'agence, joignable au 06 11 22 33 44"}})
    assert r.status_code == 200, r.text
    user = db_call(client, server.db.users.find_one, {"id": buyer["id"]})
    assert "06 11 22 33 44" not in user["buyer_profile"]["experience"] and "Ancien chef d'agence" in user["buyer_profile"]["experience"]


# ---------- Suppression de compte : aucune adresse e-mail résiduelle ----------

def _find_value(obj, needle, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _find_value(v, needle, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _find_value(v, needle, f"{path}[{i}]")
    elif isinstance(obj, str) and needle in obj.lower():
        yield path


def test_suppression_de_compte_sans_email_residuel(api, client):
    seller, buyer, cid = _deal(api, client, "rgpd2")
    client.post("/api/messages", headers=api.h(buyer), json={"receiver_id": seller["id"], "company_id": cid, "content": "Bonjour"})
    api.grant_dataroom(seller, buyer, cid)
    # Le repreneur est aussi président invité d'une autre annonce, et abonné à la lettre d'information
    other = client.post("/api/companies", headers=api.h(seller), json=listing(siret="98765432100019")).json()["id"]
    r = client.post(f"/api/listings/{other}/invite-president", headers=api.h(seller),
                    json={"company_id": other, "president_firstname": "Jean", "president_lastname": "Test", "president_email": buyer["email"]})
    assert r.status_code == 200, r.text
    db_call(client, server.db.newsletter_subscribers.insert_one, {"id": "nl-1", "email": buyer["email"]})
    db_call(client, server.db.dataroom_access_logs.insert_one, {"id": str(uuid.uuid4()), "company_id": cid, "viewer_id": buyer["id"],
                                                                "viewer_email": buyer["email"]})
    db_call(client, server.create_audit_log, "test", cid, buyer["id"], buyer["email"], target_id=seller["id"], target_email=buyer["email"])

    r = client.request("DELETE", "/api/auth/account", headers=api.h(buyer), json={"password": "Password1!"})
    assert r.status_code == 200, r.text
    needle = buyer["email"].lower()
    leftovers = []
    for name in db_call(client, server.db.list_collection_names):
        for doc in db_call(client, lambda n=name: server.db[n].find({}, {"_id": 0}).to_list(100000)):
            if name == "generated_contracts":
                # Texte intégral des contrats signés conservé (preuve, obligation légale)
                doc = {k: v for k, v in doc.items() if k not in ("content", "content_after_signature")}
            leftovers += [f"{name}{p}" for p in _find_value(doc, needle)]
    assert leftovers == []


# ---------- Proxys open data : format validé, limite par IP, cache ----------

def test_proxys_open_data_limites(client, monkeypatch):
    assert client.get("/api/rge/verify/123").status_code == 400
    assert client.get("/api/rge/company/abc/qualifications").status_code == 400
    assert client.get("/api/rge/search", params={"q": "ab"}).status_code == 400
    calls = []

    async def fake_verify(siret):
        calls.append(siret)
        return {"verified": False, "siret_recherche": siret}

    monkeypatch.setattr(server, "verify_rge", fake_verify)
    server._rge_verify_cache.clear()
    server.limiter.reset()
    server.limiter.enabled = True
    try:
        codes = [client.get("/api/rge/verify/12345678900011").status_code for _ in range(31)]
        assert codes[:30] == [200] * 30 and codes[30] == 429
        assert calls == ["12345678900011"], "réponse gardée en cache : un seul appel à l'ADEME"
        server.limiter.reset()
        codes = [client.get("/api/company/123456789/dirigeants").status_code for _ in range(31)]
        assert codes[30] == 429
    finally:
        server.limiter.enabled = False
        server.limiter.reset()
        server._rge_verify_cache.clear()


# ---------- Filigrane de la data room : jamais de document servi en clair ----------

def _pdf_bytes(encrypt_with=None):
    import io
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    if encrypt_with:
        writer.encrypt(user_password=encrypt_with, owner_password="proprietaire")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_filigrane_fail_closed(api, client):
    import base64
    import pytest
    from watermark import WatermarkError, apply_watermark
    with pytest.raises(WatermarkError):
        apply_watermark(b"%PDF-1.4 illisible", "application/pdf", "x", strict=True)
    with pytest.raises(WatermarkError):
        apply_watermark(b"texte", "text/plain", "x", strict=True)
    assert apply_watermark(b"texte", "text/plain", "x") == (b"texte", "text/plain")

    seller, buyer, cid = _deal(api, client, "filig")
    # Dépôt : PDF protégé par mot de passe ou illisible refusé
    for data in (_pdf_bytes(encrypt_with="secret"), b"%PDF-1.4 illisible"):
        r = client.post(f"/api/dataroom/{cid}/documents", headers=api.h(seller),
                        files={"file": ("bilan.pdf", data, "application/pdf")}, data={"category": "bilans"})
        assert r.status_code == 400 and "filigran" in r.json()["detail"]
    r = client.post(f"/api/dataroom/{cid}/documents", headers=api.h(seller),
                    files={"file": ("bilan.pdf", _pdf_bytes(), "application/pdf")}, data={"category": "bilans"})
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]
    api.grant_dataroom(seller, buyer, cid)
    assert client.post(f"/api/dataroom/{cid}/documents/{doc_id}/view", headers=api.h(buyer)).status_code == 200
    # Document devenu illisible (ancien dépôt) : consultation refusée, journal « watermark_applied: False »
    db_call(client, server.db.dataroom.update_one, {"id": doc_id},
            {"$set": {"content": base64.b64encode(b"%PDF-1.4 illisible").decode()}})
    r = client.post(f"/api/dataroom/{cid}/documents/{doc_id}/view", headers=api.h(buyer))
    assert r.status_code == 409 and "content" not in r.text
    log = db_call(client, lambda: server.db.dataroom_access_logs.find({"document_id": doc_id}).sort("timestamp", -1).to_list(10))
    assert any(entry["watermark_applied"] is False for entry in log)
    # Le cédant consulte toujours son propre document (sans filigrane)
    assert client.post(f"/api/dataroom/{cid}/documents/{doc_id}/view", headers=api.h(seller)).status_code == 200
