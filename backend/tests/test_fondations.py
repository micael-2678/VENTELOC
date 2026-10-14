"""Fondations de la refonte : double opt-in e-mail, second facteur admin, erreurs Stripe, limitation de débit,
/health réel, suppression et export de compte, révocation des jetons, routes supprimées, sauvegarde S3"""
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import stripe

import server
from conftest import listing, sent_emails, last_email, CODE_RE


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


# ---------- Double opt-in ----------

def test_inscription_envoie_un_lien_de_confirmation(api, client, emails):
    email = uid("optin")
    user = api.register(email, "buyer", verify_email=False)
    assert client.get("/api/auth/profile", headers=api.h(user)).json()["email_verified"] is False
    e = last_email(email, "Confirmez votre adresse")
    assert e and "/confirmer-email/" in e["html"] and "AlterEgo SAS déclare ne recevoir ni détenir" in e["html"]
    assert [x for x in emails if x["to"] == email] == [e], "un seul e-mail à l'inscription"
    # Lien invalide
    assert client.post("/api/auth/verify-email", json={"token": "x" * 40}).status_code == 400
    # Lien valide, puis idempotent
    assert api.verify_email(user)["verified"] is True
    assert client.get("/api/auth/profile", headers=api.h(user)).json()["email_verified"] is True
    r = client.post("/api/auth/verify-email", json={"token": api.verification_token(email)})
    assert r.status_code == 200 and r.json()["already_verified"] is True


def test_renvoi_du_lien_limite_a_un_par_minute(api, client, emails):
    user = api.register(uid("renvoi"), "buyer", verify_email=False)
    assert client.post("/api/auth/resend-verification", headers=api.h(user)).status_code == 429
    db_call(client, server.db.email_verifications.update_many, {"user_id": user["id"]},
            {"$set": {"created_at": (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()}})
    assert client.post("/api/auth/resend-verification", headers=api.h(user)).status_code == 200
    assert len([e for e in emails if e["to"] == user["email"] and e["subject"].startswith("Confirmez")]) == 2
    # Le premier lien est remplacé par le second
    api.verify_email(user)
    assert client.post("/api/auth/resend-verification", headers=api.h(user)).json()["already_verified"] is True


def test_lien_expire(api, client):
    user = api.register(uid("expire"), "buyer", verify_email=False)
    db_call(client, server.db.email_verifications.update_many, {"user_id": user["id"]},
            {"$set": {"expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}})
    r = client.post("/api/auth/verify-email", json={"token": api.verification_token(user["email"])})
    assert r.status_code == 400 and "expiré" in r.json()["detail"]


def test_interdictions_tant_que_l_email_n_est_pas_confirme(api, client):
    seller = api.register(uid("vendeur"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing()).json()
    api.publish(seller, c["id"])

    buyer = api.register(uid("acheteur"), "buyer", verify_email=False)
    api.verify_kyc(buyer)
    h = api.h(buyer)
    assert client.post(f"/api/properties/{c['id']}/contact", headers=h).status_code == 403
    assert client.post("/api/messages", headers=h, json={"receiver_id": seller["id"], "property_id": c["id"], "content": "Bonjour"}).status_code == 403
    assert client.post("/api/alerts", headers=h, json={"name": "PAC", "region": "Île-de-France"}).status_code == 403
    assert client.post(f"/api/dataroom/{c['id']}/request-access", headers=h).status_code == 403
    r = client.post("/api/contracts/generate-for-signature", headers=h, json={"property_id": c["id"], "doc_type": "nda"})
    assert r.status_code == 403 and r.json()["detail"].startswith("Confirmez")
    # Navigation libre
    assert client.get(f"/api/properties/{c['id']}", headers=h).status_code == 200

    # Une fois l'adresse confirmée, tout est ouvert (sans KYC pour le premier contact)
    api.verify_email(buyer)
    unverified_kyc = api.register(uid("sanskyc"), "buyer")
    assert client.post(f"/api/properties/{c['id']}/contact", headers=api.h(unverified_kyc)).status_code == 200
    assert client.post("/api/alerts", headers=api.h(buyer), json={"name": "PAC", "region": "Île-de-France"}).status_code == 200
    api.accept_dataroom(seller, buyer, c["id"])
    nda = client.post("/api/contracts/generate-for-signature", headers=h, json={"property_id": c["id"], "doc_type": "nda"}).json()
    # Le code de signature n'est envoyé qu'à une adresse confirmée (double opt-in)
    db_call(client, server.db.users.update_one, {"id": buyer["id"]}, {"$set": {"email_verified": False}})
    r = client.post("/api/signatures/request-code", headers=h, json={"contract_id": nda["contract_id"]})
    assert r.status_code == 403 and "Confirmez" in r.json()["detail"]
    db_call(client, server.db.users.update_one, {"id": buyer["id"]}, {"$set": {"email_verified": True}})
    assert client.post("/api/signatures/request-code", headers=h, json={"contract_id": nda["contract_id"]}).status_code == 200


def test_publication_impossible_sans_email_confirme(api, client, emails):
    seller = api.register(uid("cedant"), "seller", verify_email=False)
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing()).json()
    assert c["status"] == "draft" and c["blocked_reason"] == "email_not_verified"
    # Le mandat lui-même n'est pas généré tant que l'adresse n'est pas confirmée (403 email_not_verified)
    assert api.mandate(seller, c["id"], expect=403)["detail"]["code"] == "email_not_verified"
    api.verify_email(seller)
    m = api.mandate(seller, c["id"])
    assert api.sign_mandate(seller, m["contract_id"]).status_code == 200


# ---------- Second facteur administrateur ----------

def test_admin_otp(api, client, emails):
    r = client.post("/api/auth/login", json={"email": "admin@test.fr", "password": "AdminTest123!"})
    assert r.status_code == 200 and r.json() == {"otp_required": True, "email": "admin@test.fr", "expires_in": 600, "resent": True}
    assert "token" not in r.json()
    e = last_email("admin@test.fr", "Votre code de connexion")
    code = CODE_RE.search(e["html"]).group(1)
    assert code not in e["subject"], "le code ne figure jamais dans l'objet"
    # Reconnexion dans la minute : pas de nouveau code envoyé
    r2 = client.post("/api/auth/login", json={"email": "admin@test.fr", "password": "AdminTest123!"})
    assert r2.json()["resent"] is False
    bad = "000000" if code != "000000" else "111111"
    assert client.post("/api/auth/login/verify", json={"email": "admin@test.fr", "code": bad}).status_code == 401
    r = client.post("/api/auth/login/verify", json={"email": "admin@test.fr", "code": code})
    assert r.status_code == 200 and r.json()["user"]["role"] == "admin" and "password_hash" not in r.text
    token = r.json()["token"]
    assert client.get("/api/admin/stats", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    # Usage unique
    assert client.post("/api/auth/login/verify", json={"email": "admin@test.fr", "code": code}).status_code == 401


def test_admin_otp_blocage_apres_5_erreurs(api, client, emails):
    db_call(client, server.db.login_otps.delete_many, {})
    client.post("/api/auth/login", json={"email": "admin@test.fr", "password": "AdminTest123!"})
    code = CODE_RE.search(last_email("admin@test.fr", "Votre code de connexion")["html"]).group(1)
    bad = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert client.post("/api/auth/login/verify", json={"email": "admin@test.fr", "code": bad}).status_code == 401
    assert client.post("/api/auth/login/verify", json={"email": "admin@test.fr", "code": code}).status_code == 429


def test_non_admin_ne_passe_pas_par_le_second_facteur(api, client):
    user = api.register(uid("u"), "buyer")
    assert client.post("/api/auth/login/verify", json={"email": user["email"], "code": "123456"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": user["email"], "password": "Password1!"})
    assert r.status_code == 200 and "token" in r.json() and r.json()["user"]["email_verified"] is True


# ---------- Stripe ----------

def test_stripe_error_devient_une_400(api, client, monkeypatch):
    user = api.register(uid("kyc"), "buyer")
    # Identité ouverte au repreneur seulement après acceptation d'une demande de dossier (ops-05)
    db_call(client, server.db.dataroom_access.insert_one, {"id": str(uuid.uuid4()), "buyer_id": user["id"],
                                                            "property_id": "c-kyc", "status": "accepted"})

    def boom(**kwargs):
        raise stripe.StripeError("Stripe indisponible")

    monkeypatch.setattr(stripe.identity.VerificationSession, "create", staticmethod(boom))
    r = client.post("/api/kyc/create-verification-session", headers=api.h(user))
    assert r.status_code == 400 and "Erreur Stripe" in r.json()["detail"]


def test_webhook_signature_invalide(client, monkeypatch):
    monkeypatch.setenv("STRIPE_IDENTITY_WEBHOOK_SECRET", "whsec_test")
    r = client.post("/api/kyc/webhook", content=b'{"type":"identity.verification_session.verified"}',
                    headers={"stripe-signature": "t=1,v1=deadbeef"})
    assert r.status_code == 400 and r.json()["detail"] == "Invalid signature"


# ---------- Limitation de débit ----------

def test_rate_limit_login(api, client):
    server.limiter.reset()
    server.limiter.enabled = True
    try:
        codes = [client.post("/api/auth/login", json={"email": "inconnu@test.fr", "password": "mauvais"}).status_code for _ in range(6)]
        assert codes[:5] == [401] * 5 and codes[5] == 429
        # Les autres routes ne sont pas affectées
        assert client.get("/api/health").status_code == 200
    finally:
        server.limiter.enabled = False
        server.limiter.reset()


def test_rate_limit_login_x_forwarded_for_forge(api, client, proxied_client):
    """Un X-Forwarded-For fourni par le client ne contourne pas la limite (accès direct comme derrière les proxys)"""
    server.limiter.reset()
    server.limiter.enabled = True
    body = {"email": "inconnu@test.fr", "password": "mauvais"}
    try:
        codes = [client.post("/api/auth/login", json=body, headers={"x-forwarded-for": f"10.0.0.{i}"}).status_code for i in range(6)]
        assert codes[:5] == [401] * 5 and codes[5] == 429
        server.limiter.reset()
        # Derrière Traefik + nginx : seule l'avant-dernière entrée (posée par Traefik) compte
        codes = [proxied_client.post("/api/auth/login", json=body,
                                     headers={"x-forwarded-for": f"10.0.0.{i}, 198.51.100.9, 172.18.0.2"}).status_code for i in range(6)]
        assert codes[:5] == [401] * 5 and codes[5] == 429
        assert proxied_client.post("/api/auth/login", json=body,
                                   headers={"x-forwarded-for": "198.51.100.10, 172.18.0.2"}).status_code == 401
    finally:
        server.limiter.enabled = False
        server.limiter.reset()


def test_client_ip_proxys_de_confiance(monkeypatch):
    from starlette.requests import Request

    def req(peer, xff=None):
        headers = [(b"x-forwarded-for", xff.encode())] if xff else []
        return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "client": (peer, 1234)})

    assert server.client_ip(req("93.184.216.34", "1.2.3.4")) == "93.184.216.34", "pair public : en-tête ignoré"
    assert server.client_ip(req("172.18.0.3", "1.2.3.4, 198.51.100.9, 172.18.0.2")) == "198.51.100.9"
    assert server.client_ip(req("172.18.0.3", "198.51.100.9")) == "198.51.100.9"
    assert server.client_ip(req("172.18.0.3")) == "172.18.0.3"
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    assert server.client_ip(req("172.18.0.3", "1.2.3.4, 198.51.100.9")) == "198.51.100.9"
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "0")
    assert server.client_ip(req("172.18.0.3", "1.2.3.4")) == "172.18.0.3"
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    monkeypatch.setenv("TRUSTED_PROXY_NETWORKS", "10.1.0.0/16")
    assert server.client_ip(req("172.18.0.3", "1.2.3.4, 5.6.7.8")) == "172.18.0.3"


def test_rate_limit_request_code_et_register(api, client):
    server.limiter.reset()
    server.limiter.enabled = True
    try:
        codes = [client.post("/api/auth/register", json={"email": uid("rl"), "password": "Password1!", "role": "buyer"}).status_code
                 for _ in range(6)]
        assert codes[:5] == [200] * 5 and codes[5] == 429
    finally:
        server.limiter.enabled = False
        server.limiter.reset()


# ---------- Health ----------

def test_health_reel(client, monkeypatch):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["db"] == "ok" and body["version"] and isinstance(body["disk_free_mb"], int)
    assert "jobs_age_seconds" in body

    async def dead(*args, **kwargs):
        raise RuntimeError("connexion refusée")

    monkeypatch.setattr(server.db, "command", dead)
    r = client.get("/api/health")
    assert r.status_code == 503 and r.json()["db"] == "ko"


def test_health_expose_l_age_des_taches(api, client):
    client.post("/api/admin/jobs/run", headers=api.h(api.admin()))
    age = client.get("/api/health").json()["jobs_age_seconds"]
    assert isinstance(age, int) and age < 60


# ---------- Jetons ----------

def test_changement_de_mot_de_passe_revoque_les_anciens_jetons(api, client):
    user = api.register(uid("jwt"), "buyer")
    old = api.h(user)
    r = client.post("/api/auth/change-password", headers=old, json={"current_password": "Password1!", "new_password": "Password2!"})
    assert r.status_code == 200 and r.json()["token"]
    assert client.get("/api/auth/profile", headers=old).status_code == 401
    assert client.get("/api/auth/profile", headers={"Authorization": f"Bearer {r.json()['token']}"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": user["email"], "password": "Password1!"}).status_code == 401


def test_jeton_valable_24h():
    import jwt
    payload = jwt.decode(server.create_access_token({"sub": "x@test.fr", "role": "buyer"}), server.JWT_SECRET, algorithms=["HS256"])
    assert 23 * 3600 < payload["exp"] - payload["iat"] <= 24 * 3600


# ---------- Suppression et export de compte ----------

def test_suppression_de_compte_anonymise_et_conserve_le_mandat(api, client, emails):
    seller = api.register(uid("rgpd"), "seller", first="Paul", last="Rgpd", phone="0601020304")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing()).json()
    api.publish(seller, c["id"])
    client.post("/api/alerts", headers=api.h(seller), json={"name": "x"})
    export = client.get("/api/auth/export", headers=api.h(seller)).json()
    assert export["account"]["email"] == seller["email"] and len(export["properties"]) == 1 and len(export["contracts"]) == 1

    assert client.request("DELETE", "/api/auth/account", headers=api.h(seller), json={"password": "faux"}).status_code == 400
    r = client.request("DELETE", "/api/auth/account", headers=api.h(seller), json={"password": "Password1!"})
    assert r.status_code == 200 and r.json()["deleted"] is True
    assert last_email(seller["email"], "Votre compte a été supprimé")

    user = db_call(client, server.db.users.find_one, {"id": seller["id"]})
    assert user["email"].endswith("@anonyme.invalid") and user.get("deleted_at")
    for field in ("first_name", "last_name", "phone", "verified_last_name", "siret"):
        assert field not in user
    assert client.get("/api/auth/profile", headers=api.h(seller)).status_code == 401
    assert client.post("/api/auth/login", json={"email": seller["email"], "password": "Password1!"}).status_code == 401
    # Mandat et preuve conservés, rattachés au même user_id ; annonce retirée
    mandat = db_call(client, server.db.generated_contracts.find_one, {"property_id": c["id"], "type": "mandat"})
    assert mandat["status"] == "signed" and mandat["seller_id"] == seller["id"] and mandat["signature_evidence"]
    assert db_call(client, server.db.properties.find_one, {"id": c["id"]})["status"] == "archived"
    assert client.get(f"/api/properties/{c['id']}").status_code == 404
    assert db_call(client, server.db.alerts.count_documents, {"user_id": seller["id"]}) == 0
    # Le compte admin ne se supprime pas en ligne
    assert client.request("DELETE", "/api/auth/account", headers=api.h(api.admin()), json={"password": "AdminTest123!"}).status_code == 403


# ---------- Routes supprimées, documentation, marque ----------

@pytest.mark.parametrize("method, path", [
    ("post", "/api/auth/upload-kyc"), ("get", "/api/credits/balance"), ("post", "/api/payments/webhook"),
    ("get", "/api/admin/stripe/payments"), ("post", "/api/lawyer/request"), ("get", "/api/valorization/barometre"),
    ("get", "/api/admin/messages"), ("get", "/api/admin/dataroom/x"), ("post", "/api/admin/users/x/reset-password"),
    ("get", "/api/admin/contracts/templates"), ("post", "/api/admin/contracts/generate"),
    ("post", "/api/admin/migrations/mandate-backfill"), ("post", "/api/loi/countersign/x"),
    ("post", "/api/closing/declare"), ("get", "/api/closing/commission-calculator"), ("get", "/api/admin/transactions"),
])
def test_routes_supprimees(api, client, method, path):
    r = client.request(method.upper(), path, headers=api.h(api.admin()), json={})
    assert r.status_code in (404, 405), path


def test_docs_desactives_en_production():
    from fastapi.testclient import TestClient
    assert TestClient(server.app).get("/openapi.json").status_code == 200, "ouvert hors production"
    assert server.cors_origins() == ["https://cessionrge.test"] or "https://cessionrge.test" in server.cors_origins()
    assert "*" not in server.cors_origins()


def test_marque_dans_les_emails_et_pdf(api, client, emails):
    user = api.register(uid("marque"), "buyer")
    e = last_email(user["email"], "Confirmez")
    assert "CessionBâtiment" in e["html"] and "CessionRGE" not in e["html"]
    assert client.get("/api/config").json()["site_name"] == "CessionBâtiment"
    assert client.get("/api/public/legal-info").json()["marque"] == "CessionBâtiment"


# ---------- Sauvegarde vers S3 ----------

def test_backup_envoye_vers_s3(client, monkeypatch, tmp_path):
    moto = pytest.importorskip("moto")
    import boto3
    archive = tmp_path / "cessionrge-2026-10-10T02-00.archive.gz"
    archive.write_bytes(b"\x1f\x8b" + b"x" * 100)
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    monkeypatch.setenv("S3_BUCKET", "cessionrge-backups")
    monkeypatch.setenv("S3_REGION", "eu-west-3")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    with moto.mock_aws():
        boto3.client("s3", region_name="eu-west-3").create_bucket(
            Bucket="cessionrge-backups", CreateBucketConfiguration={"LocationConstraint": "eu-west-3"})
        now = datetime.now(timezone.utc)
        assert db_call(client, server.job_backup_to_s3, now) == 1
        assert db_call(client, server.job_backup_to_s3, now) == 0, "chaque archive n'est envoyée qu'une fois"
        keys = [o["Key"] for o in boto3.client("s3", region_name="eu-west-3").list_objects_v2(Bucket="cessionrge-backups")["Contents"]]
        assert keys == ["backups/cessionrge-2026-10-10T02-00.archive.gz"]
    monkeypatch.delenv("S3_BUCKET")
    assert db_call(client, server.job_backup_to_s3, datetime.now(timezone.utc)) == 0
