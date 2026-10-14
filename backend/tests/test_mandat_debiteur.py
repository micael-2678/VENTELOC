"""Barème des honoraires (3 % HT soit 3,6 % TTC, minimum 3 000 € HT soit 3 600 € TTC, configurables) et vendeur toujours débiteur"""
import base64
import io
import uuid

import pytest

import server
from business_model import calculate_commission, commission_scale_text
from conftest import listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


# ---------- Barème (SPEC §0.4, §7.1) ----------

@pytest.mark.parametrize("prix, commission_ht, minimum", [
    (1, 3000, True),              # tout petit prix : minimum
    (32000, 3000, True),          # 3 % = 960 € < minimum (parking)
    (99999, 3000, True),          # 3 % = 2 999,97 € : encore le minimum
    (100001, 3000.03, False),     # 3 % = 3 000,03 € : le taux dépasse le minimum
    (200000, 6000, False),
    (1000000, 30000, False),      # un seul taux, aucune tranche
    (2500000, 75000, False),
])
def test_bareme_3_pourcent_minimum_3000(prix, commission_ht, minimum):
    c = calculate_commission(prix)
    assert c["mode"] == "simple" and c["payer"] == "vendeur" and c["terms_version"] == "v1"
    assert c["rate_percent"] == 3 and c["rate_percent_ttc"] == 3.6
    assert c["final_commission_ht"] == commission_ht
    assert c["vat"] == round(commission_ht * 0.2, 2) and c["final_commission_ttc"] == round(commission_ht * 1.2, 2)
    assert c["applied_minimum"] is minimum


def test_commission_croissante_avec_le_prix():
    prices = [1, 99999, 100001, 999999, 1000000, 2000000]
    values = [calculate_commission(p)["final_commission_ht"] for p in prices]
    assert values == sorted(values)


def test_taux_et_minimum_configurables(monkeypatch, client):
    monkeypatch.setenv("COMMISSION_MIN_HT", "5000")
    monkeypatch.setenv("COMMISSION_RATE_PERCENT", "4")
    assert calculate_commission(50000)["final_commission_ht"] == 5000
    assert calculate_commission(500000)["final_commission_ht"] == 20000
    text = commission_scale_text()
    assert "4,8\u00a0% TTC du prix de vente (4\u00a0% HT)" in text and "6\u00a0000\u00a0€ TTC (5\u00a0000\u00a0€ HT)" in text
    cfg = client.get("/api/config").json()["commission"]
    assert cfg == {"rate_percent_ht": 4.0, "rate_percent_ttc": 4.8, "minimum_ht": 5000.0, "minimum_ttc": 6000.0, "vat_rate": 0.2}
    monkeypatch.setenv("COMMISSION_RATE_PERCENT", "pas-un-nombre")
    assert calculate_commission(500000)["rate_percent"] == 3.0


def test_texte_du_bareme_ttc_d_abord():
    text = commission_scale_text()
    assert text == ("3,6\u00a0% TTC du prix de vente (3\u00a0% HT), minimum 3\u00a0600\u00a0€ TTC (3\u00a0000\u00a0€ HT), à la "
                    "charge du vendeur, dus uniquement à la signature de l'acte authentique et réglés par le notaire sur le prix. "
                    "Rien avant. Rien pour l'acquéreur.")


def test_config_publique_bloc_commission(client):
    cfg = client.get("/api/config").json()
    assert cfg["commission"] == {"rate_percent_ht": 3.0, "rate_percent_ttc": 3.6, "minimum_ht": 3000.0, "minimum_ttc": 3600.0,
                                 "vat_rate": 0.2}
    assert cfg["commission_payer"] == "vendeur" and cfg["commission_terms_version"] == "v1" and cfg["site_name"] == "VenteLoc"


# ---------- Mandat : le vendeur est toujours le débiteur ----------

def seller_with_mandate(api, client, asking_price=200000):
    seller = api.register(uid("vendeur"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(asking_price=asking_price)).json()
    m = api.mandate(seller, c["id"])
    return seller, c, m


def test_mandat_sans_choix_du_debiteur(api, client):
    seller, c, m = seller_with_mandate(api, client)
    assert "à la charge du Mandant" in m["content"] and "3,6\u00a0% TTC du prix de vente" in m["content"]
    assert "tranche" not in m["content"]
    # Un « commission_payer » envoyé par le client est ignoré : le débiteur est toujours le vendeur
    code = api.request_code(seller, m["contract_id"])
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller),
                    json={"commission_payer": "acquereur", "otp_code": code})
    assert r.status_code == 200 and r.json()["commission_payer"] == "vendeur" and r.json()["registry_number"] >= 1
    assert client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller), json={"otp_code": code}).status_code == 409
    status = client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()
    assert status["mandat"]["commission_payer"] == "vendeur" and status["mandat"]["terms_version"] == "v1"
    pdf = base64.b64decode(client.get(f"/api/seller/mandat/{m['contract_id']}/pdf", headers=api.h(seller)).json()["content"])
    from pypdf import PdfReader
    text = " ".join(" ".join(p.extract_text().split()) for p in PdfReader(io.BytesIO(pdf)).pages)
    assert "à la charge du Mandant" in text and "Rien pour l'acquéreur" in text
    assert "à la charge de l'acquéreur" not in text


def test_registre_sequentiel(api, client):
    numbers = []
    for _ in range(3):
        seller, _, m = seller_with_mandate(api, client)
        numbers.append(api.sign_mandate(seller, m['contract_id']).json()["registry_number"])
    assert numbers == list(range(numbers[0], numbers[0] + 3))


def test_fiche_et_engagement_sans_commission_acquereur(api, client):
    seller = api.register(uid("vendeur"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(asking_price=200000)).json()
    api.publish(seller, c["id"])
    info = client.get(f"/api/properties/{c['id']}").json()["commission_info"]
    assert info == {"payer": "vendeur", "rate_percent_ttc": 3.6, "rate_percent_ht": 3.0, "minimum_ht": 3000.0, "minimum_ttc": 3600.0,
                    "terms_version": "v1", "estimate_ht": 6000.0, "estimate_ttc": 7200.0, "base": "prix demandé"}
    listed = [x for x in client.post("/api/properties/search", json={}).json() if x["id"] == c["id"]][0]
    assert listed["commission_info"]["payer"] == "vendeur"

    buyer = api.register(uid("acquereur"), "buyer")
    api.verify_kyc(buyer)
    api.accept_dataroom(seller, buyer, c["id"])
    nda = client.post("/api/contracts/generate-for-signature", headers=api.h(buyer), json={"property_id": c["id"], "doc_type": "nda"}).json()
    assert "Aucune somme n'est due par l'Acquéreur" in nda["content"] and "charge de l'acquéreur" not in nda["content"].lower()


