"""Signature par code à usage unique, mandat obligatoire avant publication, rattrapage et registre"""
import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import server
from conftest import listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


def seller_and_mandate(api, client):
    seller = api.register(uid("cedant"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/companies", headers=api.h(seller), json=listing()).json()
    m = api.mandate(seller, c["id"])
    return seller, c, m


# ---------- Code de signature ----------

def test_signature_sans_code_refusee(api, client):
    seller, _, m = seller_and_mandate(api, client)
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller), json={})
    assert r.status_code == 400 and "code" in r.json()["detail"].lower()


def test_mauvais_code_puis_blocage_et_code_a_usage_unique(api, client):
    seller, _, m = seller_and_mandate(api, client)
    good = api.request_code(seller, m["contract_id"])
    bad = "000000" if good != "000000" else "111111"
    for _ in range(5):
        r = client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller),
                        json={"otp_code": bad})
        assert r.status_code == 400
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller),
                    json={"otp_code": good})
    assert r.status_code == 429, "après 5 erreurs, même le bon code est refusé"


def test_renvoi_limite_et_expiration(api, client):
    seller, _, m = seller_and_mandate(api, client)
    code = api.request_code(seller, m["contract_id"])
    r = client.post("/api/signatures/request-code", headers=api.h(seller), json={"contract_id": m["contract_id"]})
    assert r.status_code == 429
    db_call(client, server.db.signature_otps.update_many, {"contract_id": m["contract_id"]},
            {"$set": {"expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}})
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller),
                    json={"otp_code": code})
    assert r.status_code == 400 and "expiré" in r.json()["detail"]


def test_code_reserve_au_signataire_verifie(api, client):
    seller, _, m = seller_and_mandate(api, client)
    other = api.register(uid("intrus"), "seller")
    api.verify_kyc(other)
    assert client.post("/api/signatures/request-code", headers=api.h(other), json={"contract_id": m["contract_id"]}).status_code == 404
    unverified = api.register(uid("nonverifie"), "seller")
    c2 = client.post("/api/companies", headers=api.h(unverified), json=listing()).json()
    # Sans identité vérifiée, le mandat n'est même pas généré (403 identity_required) ; a fortiori aucun code
    assert api.mandate(unverified, c2["id"], expect=403)["detail"]["code"] == "identity_required"


def test_preuve_de_signature_conservee(api, client):
    seller, c, m = seller_and_mandate(api, client)
    assert api.sign_mandate(seller, m["contract_id"]).status_code == 200
    mandat = client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()["mandat"]
    ev = mandat["signature_evidence"]
    assert ev["method"] == "otp_email" and ev["otp"]["destination"].startswith(seller["email"][0])
    assert ev["document_sha256"] == hashlib.sha256(mandat["content"].encode()).hexdigest()
    assert ev["identity"]["kyc_status"] == "verified"


# ---------- Mandat obligatoire / rattrapage / registre ----------

def test_rattrapage_des_annonces_sans_mandat(api, client, emails):
    seller = api.register(uid("ancien"), "seller")
    legacy_id = str(uuid.uuid4())
    db_call(client, server.db.companies.insert_one, {**listing(), "id": legacy_id, "seller_id": seller["id"],
                                                     "status": "published", "created_at": datetime.now(timezone.utc).isoformat()})
    # La route admin a disparu : la migration s'exécute en ligne de commande (python -m migrations.mandate_backfill)
    assert client.post("/api/admin/migrations/mandate-backfill", headers=api.h(api.admin())).status_code == 404
    from migrations.mandate_backfill import run_backfill
    notify = lambda seller_id, company_id: server.email_user(seller_id, "listing_mandate_backfill",  # noqa: E731
                                                            link=server.site_url(f"/seller/mandat/{company_id}"))
    dry = db_call(client, run_backfill, server.db, dry_run=True)
    assert legacy_id in [r["id"] for r in dry["listings"]]
    assert client.get(f"/api/companies/{legacy_id}").status_code == 200, "le dry-run n'écrit rien"

    applied = db_call(client, run_backfill, server.db, dry_run=False, notify=notify)
    assert legacy_id in [r["id"] for r in applied["listings"]]
    assert client.get(f"/api/companies/{legacy_id}").status_code == 404, "retirée des résultats publics, pas supprimée"
    assert db_call(client, server.db.companies.find_one, {"id": legacy_id})["status"] == "mandat_en_attente"
    assert any(e["to"] == seller["email"] and "mandat" in e["subject"].lower() for e in emails)

    again = db_call(client, run_backfill, server.db, dry_run=False)
    assert legacy_id not in [r["id"] for r in again["listings"]], "idempotent"

    back = db_call(client, run_backfill, server.db, dry_run=False, rollback=True)
    assert legacy_id in [r["id"] for r in back["listings"]]
    assert client.get(f"/api/companies/{legacy_id}").status_code == 200


def test_registre_des_mandats_et_export(api, client):
    seller, c, m = seller_and_mandate(api, client)
    api.sign_mandate(seller, m["contract_id"])
    buyer = api.register(uid("a"), "buyer")
    assert client.get("/api/admin/mandates", headers=api.h(buyer)).status_code == 403
    rows = client.get("/api/admin/mandates", headers=api.h(api.admin())).json()["mandates"]
    numbers = [r["registry_number"] for r in rows]
    assert numbers == sorted(numbers) and numbers == list(range(numbers[0], numbers[0] + len(numbers)))
    csv = client.get("/api/admin/mandates/export.csv", headers=api.h(api.admin()))
    assert csv.status_code == 200 and "N° registre" in csv.text and m["contract_number"] in csv.text


def test_relance_mandat_non_signe(api, client, emails):
    seller, c, _ = seller_and_mandate(api, client)
    old = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    db_call(client, server.db.companies.update_one, {"id": c["id"]}, {"$set": {"updated_at": old, "mandate_pending_since": old}})
    db_call(client, server.db.users.update_one, {"id": seller["id"]}, {"$set": {"created_at": old}})
    emails.clear()
    client.post("/api/admin/jobs/run", headers=api.h(api.admin()))
    reminders = [e for e in emails if e["to"] == seller["email"] and "mandat" in e["subject"].lower()]
    assert len(reminders) == 1 and "Combien ça coûte" in reminders[0]["html"], "relance J+4 avec l'objection du jour"
    emails.clear()
    client.post("/api/admin/jobs/run", headers=api.h(api.admin()))
    assert not [e for e in emails if e["to"] == seller["email"]], "une seule relance par annonce"
