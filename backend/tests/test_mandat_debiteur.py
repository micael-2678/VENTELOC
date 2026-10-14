"""Barème v2 (6 % HT, 3 % HT au-delà d'un million, minimum 4 000 € HT) et cédant toujours débiteur de la commission"""
import base64
import io
import uuid
from datetime import datetime, timezone

import pytest

import server
from business_model import calculate_commission, commission_scale_text
from conftest import listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


# ---------- Barème ----------

@pytest.mark.parametrize("prix, commission_ht, minimum", [
    (1, 4000, True),              # tout petit prix : minimum
    (30000, 4000, True),          # 6 % = 1 800 € < minimum
    (66666, 4000, True),          # 6 % = 3 999,96 € : encore le minimum
    (66667, 4000.02, False),      # 6 % = 4 000,02 € : le barème dépasse le minimum
    (500000, 30000, False),
    (1000000, 60000, False),      # borne du million : 6 % sur la totalité
    (1000001, 60000.03, False),   # 1 € au-delà : +3 centimes, aucun effet de seuil
    (1500000, 75000, False),      # 60 000 + 3 % × 500 000
    (3000000, 120000, False),
])
def test_bareme_6_3_minimum_4000(prix, commission_ht, minimum):
    c = calculate_commission(prix)
    assert c["mode"] == "simple" and c["payer"] == "cedant" and c["terms_version"] == "v2"
    assert c["final_commission_ht"] == commission_ht
    assert c["final_commission_ttc"] == round(commission_ht * 1.2, 2)
    assert c["applied_minimum"] is minimum


def test_commission_croissante_avec_le_prix():
    prices = [1, 66666, 66667, 999999, 1000000, 1000001, 2000000]
    values = [calculate_commission(p)["final_commission_ht"] for p in prices]
    assert values == sorted(values)


def test_minimum_configurable(monkeypatch):
    monkeypatch.setenv("COMMISSION_MIN_HT", "5000")
    assert calculate_commission(50000)["final_commission_ht"] == 5000
    assert "5\u00a0000\u00a0€ HT" in commission_scale_text()


def test_texte_du_bareme():
    text = commission_scale_text()
    assert text.startswith("6 % HT du prix de cession (3 % HT sur la part au-delà d'un million d'euros)")
    assert "minimum 4" in text and "à la charge du cédant" in text and "Rien pour le repreneur" in text
    for banned in ("Lehman", "12 % TTC", "tranches successives"):
        assert banned not in text


# ---------- Mandat : le cédant est toujours le débiteur ----------

def seller_with_mandate(api, client, asking_price=500000):
    seller = api.register(uid("cedant"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(asking_price=asking_price)).json()
    m = api.mandate(seller, c["id"])
    return seller, c, m


def test_mandat_sans_choix_du_debiteur(api, client):
    seller, c, m = seller_with_mandate(api, client)
    assert "[choix du Mandant lors de la signature]" not in m["content"]
    assert "à la charge de le Mandant (cédant)" in m["content"] or "à la charge du Mandant" in m["content"] or "le Mandant (cédant)" in m["content"]
    assert "6 % HT du prix de cession" in m["content"] and "tranches successives" not in m["content"]
    # Un « commission_payer » envoyé par le client est ignoré : le débiteur est toujours le cédant
    code = api.request_code(seller, m["contract_id"])
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller),
                    json={"commission_payer": "repreneur", "otp_code": code})
    assert r.status_code == 200 and r.json()["commission_payer"] == "cedant" and r.json()["registry_number"] >= 1
    assert client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller), json={"otp_code": code}).status_code == 409
    status = client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()
    assert status["mandat"]["commission_payer"] == "cedant" and status["mandat"]["commission_terms_version"] == "v2"
    pdf = base64.b64decode(client.get(f"/api/seller/mandat/{m['contract_id']}/pdf", headers=api.h(seller)).json()["content"])
    from pypdf import PdfReader
    text = " ".join(" ".join(p.extract_text().split()) for p in PdfReader(io.BytesIO(pdf)).pages)
    assert "à la charge du Mandant" in text and "Rien pour le repreneur" in text
    assert "à la charge de l'acquéreur" not in text and "à la charge du repreneur" not in text


def test_registre_sequentiel(api, client):
    numbers = []
    for _ in range(3):
        seller, _, m = seller_with_mandate(api, client)
        numbers.append(api.sign_mandate(seller, m['contract_id']).json()["registry_number"])
    assert numbers == list(range(numbers[0], numbers[0] + 3))


def test_fiche_et_nda_sans_commission_acquereur(api, client):
    seller, c, m = seller_with_mandate(api, client, asking_price=500000)
    api.sign_mandate(seller, m['contract_id'])
    client.put(f"/api/properties/{c['id']}/status", params={"status": "published"}, headers=api.h(api.admin()))
    info = client.get(f"/api/properties/{c['id']}").json()["commission_info"]
    assert info["payer"] == "cedant" and info["rate_percent_ht"] == "6 %" and info["minimum_ht"] == 4000
    assert info["estimate_ht"] == 30000.0 and info["estimate_ttc"] == 36000.0 and info["terms_version"] == "v2"
    listed = [x for x in client.post("/api/properties/search", json={}).json() if x["id"] == c["id"]][0]
    assert listed["commission_info"]["payer"] == "cedant"

    buyer = api.register(uid("repreneur"), "buyer")
    api.verify_kyc(buyer)
    api.accept_dataroom(seller, buyer, c["id"])
    nda = client.post("/api/contracts/generate-for-signature", headers=api.h(buyer), json={"property_id": c["id"], "doc_type": "nda"}).json()
    assert "Commission à la charge de l'Acheteur" not in nda["content"] and "charge de l'acquéreur" not in nda["content"].lower()


def test_ancienne_annonce_repreneur_debiteur_garde_son_bandeau(api, client):
    """Héritage : un mandat v1 signé avec le repreneur débiteur reste affiché tel quel ; impossible pour une nouvelle annonce"""
    seller = api.register(uid("ancien"), "seller")
    legacy_id = str(uuid.uuid4())
    db_call(client, server.db.properties.insert_one, {**listing(), "id": legacy_id, "seller_id": seller["id"],
                                                     "status": "published", "commission_payer": "repreneur",
                                                     "created_at": datetime.now(timezone.utc).isoformat()})
    info = client.get(f"/api/properties/{legacy_id}").json()["commission_info"]
    assert info["payer"] == "repreneur" and info["terms_version"] == "v1" and info["estimate_ht"] == 30000.0
