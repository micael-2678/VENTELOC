"""Correctifs de sécurité (revue vague 3) : vue de l'annonce après l'engagement de confidentialité, masquage des
coordonnées dans les textes libres, suppression de compte, routes publiques limitées, filigrane, liens GET sans effet de
bord."""
import uuid

import server
from conftest import listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


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
    bm._send_brevo_email_sync("a@test.fr", "A", "Sujet", "<p>x</p>", "https://venteloc.test/api/alerts/unsubscribe/tok")
    assert captured[-1].headers == {"List-Unsubscribe": "<https://venteloc.test/api/alerts/unsubscribe/tok>",
                                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
    bm._send_brevo_email_sync("a@test.fr", "A", "Sujet", "<p>x</p>")
    assert captured[-1].headers is None


# ---------- Vue de l'annonce après l'engagement de confidentialité ----------

def _deal(api, client, prefix, **extra):
    seller, buyer = api.register(uid(f"{prefix}-vend"), "seller"), api.register(uid(f"{prefix}-acq"), "buyer")
    api.verify_kyc(seller)
    cid = client.post("/api/properties", headers=api.h(seller), json=listing(**extra)).json()["id"]
    api.publish(seller, cid)
    client.post(f"/api/properties/{cid}/contact", headers=api.h(buyer))
    return seller, buyer, cid


def test_vue_apres_engagement_sans_coordonnees_du_vendeur(api, client):
    seller, buyer, cid = _deal(api, client, "ndavend", siret="73282932000074")
    before = client.get(f"/api/properties/{cid}", headers=api.h(buyer)).json()
    for field in ("address", "company_name", "siret", "address_key"):
        assert field not in before, field
    api.grant_dataroom(seller, buyer, cid)
    view = client.get(f"/api/properties/{cid}", headers=api.h(buyer)).json()
    assert view["company_name"] == "SCI des Tilleuls" and view["siret"] == "73282932000074" and view["address"].endswith("rue des Lilas")
    for field in ("seller_email", "mandant_address", "mandant_capacity", "seller_id", "presented_buyers", "address_key",
                  "company_lookup", "flags", "moderation", "blocking"):
        assert field not in view, field
    assert view["ownership"] == {"status": "pending"}, "jamais le fichier ni la note du justificatif"
    stored = db_call(client, server.db.users.find_one, {"id": seller["id"]})
    assert stored["email"] not in str(view)


# ---------- Textes libres : coordonnées masquées ----------

def test_description_et_experience_sans_coordonnees(api, client):
    seller = api.register(uid("desc"), "seller")
    description = ("Appartement lumineux au deuxième étage d'une copropriété bien tenue, loué depuis trois ans à un locataire "
                   "sérieux qui paie à date. Cuisine refaite en 2022, double vitrage. Appelez le "
                   "06 12 34 56 78 ou écrivez à proprio@monmail.fr pour en savoir plus.")
    r = client.post("/api/properties", headers=api.h(seller), json=listing(description=description, equipment="Contact : 0612345678"))
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    stored = db_call(client, server.db.properties.find_one, {"id": cid})
    assert "06 12 34 56 78" not in stored["description"] and "proprio@monmail.fr" not in stored["description"]
    assert "[coordonnées masquées]" in stored["description"] and "0612345678" not in stored["equipment"]
    r = client.put(f"/api/properties/{cid}", headers=api.h(seller), json={"description": description.replace("06 12", "07 12")})
    assert r.status_code == 200, r.text
    assert "07 12 34 56 78" not in db_call(client, server.db.properties.find_one, {"id": cid})["description"]

    buyer = api.register(uid("exp"), "buyer")
    r = client.put("/api/auth/profile", headers=api.h(buyer),
                   json={"buyer_profile": {**api.BUYER_PROFILE, "experience": "Deux studios loués à Lille, joignable au 06 11 22 33 44"}})
    assert r.status_code == 200, r.text
    user = db_call(client, server.db.users.find_one, {"id": buyer["id"]})
    assert "06 11 22 33 44" not in user["buyer_profile"]["experience"] and "Deux studios loués à Lille" in user["buyer_profile"]["experience"]


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
    client.post("/api/messages", headers=api.h(buyer), json={"receiver_id": seller["id"], "property_id": cid, "content": "Bonjour"})
    api.grant_dataroom(seller, buyer, cid)
    # L'acquéreur est aussi abonné à la lettre d'information et a demandé une estimation
    client.post("/api/estimates", json={"property_type": "appartement", "lease_type": "habitation-vide", "department": "69",
                                        "rent_monthly": 700, "email": buyer["email"], "consent": True})
    db_call(client, server.db.newsletter_subscribers.insert_one, {"id": "nl-1", "email": buyer["email"]})
    db_call(client, server.db.dataroom_access_logs.insert_one, {"id": str(uuid.uuid4()), "property_id": cid, "viewer_id": buyer["id"],
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


# ---------- Routes publiques : format validé, limite par IP ----------

def test_routes_publiques_limitees(client, monkeypatch):
    import bail
    import estimator
    assert client.get("/api/rge/verify/12345678900011").status_code == 404, "proxys de l'ancienne plateforme retirés"
    r = client.get("/api/lease-transfer/rules", params={"lease_type": "bail-inconnu"})
    assert r.status_code == 400 and r.json()["detail"]["field"] == "lease_type"
    assert client.get("/api/lease-transfer/rules", params={"lease_type": "commercial", "property_type": "chateau"}).status_code == 400
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
    monkeypatch.setattr(bail, "public_limiter", bail.SlidingWindowLimiter(60, 60))
    monkeypatch.setattr(estimator, "limiter", estimator.SlidingWindowLimiter(5, 60))
    codes = [client.get("/api/lease-transfer/rules", params={"lease_type": "habitation-vide"}).status_code for _ in range(61)]
    assert codes[:60] == [200] * 60 and codes[60] == 429
    body = {"property_type": "appartement", "lease_type": "habitation-vide", "department": "69", "rent_monthly": 700}
    codes = [client.post("/api/estimates", json=body).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


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
                        files={"file": ("bail.pdf", data, "application/pdf")}, data={"category": "bail"})
        assert r.status_code == 400 and "filigran" in str(r.json()["detail"])
    r = client.post(f"/api/dataroom/{cid}/documents", headers=api.h(seller),
                    files={"file": ("bail.pdf", _pdf_bytes(), "application/pdf")}, data={"category": "bail"})
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
    # Le vendeur consulte toujours son propre document (sans filigrane)
    assert client.post(f"/api/dataroom/{cid}/documents/{doc_id}/view", headers=api.h(seller)).status_code == 200
