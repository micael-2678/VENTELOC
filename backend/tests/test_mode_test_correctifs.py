"""Mode test, correctifs de la revue finale (non-régression) : jetons du mode test invalidés hors mode test (D1), jamais
d'annonce, de mandat réel ou d'étape de vente réelle effacés par la purge (D2), contrôles assouplis réservés aux données de
test (D3), journaux d'identité révélée purgés (D4), vraie confirmation d'e-mail possible après une confirmation simulée
(D5), boîte de test jamais servie au nouveau titulaire d'une adresse (D6), clé du panneau de test (UX-01), annonces de
démonstration aux contrôles passés sauf une « à relire » (UX-07)."""
import re
import uuid

import closing
import server
from conftest import listing
from migrations import purge_test_data as purge_cli
from test_closing import _declare, _setup
from test_mode_test import DEMO_EMAILS, admin, h, make_test_listing, relogin, stored, test_mode  # noqa: F401 (fixtures)
from test_parcours_v2 import db_call, published_listing, uid, unique_siret

KEY = "cle-du-panneau-2026"


# ---------- D1 : jetons émis en mode test ----------

def test_demo_admin_token_revoked_when_test_mode_off(api, client, test_mode, monkeypatch):
    assert client.post("/api/test/seed").status_code == 200
    tok = client.post("/api/test/login-as", json={"persona": "admin"}).json()
    assert client.get("/api/admin/todo", headers=h(tok)).status_code == 200
    monkeypatch.delenv("TEST_MODE")
    # Hors mode test : ni connexion par mot de passe, ni jeton déjà émis
    assert client.post("/api/auth/login", json={"email": DEMO_EMAILS["admin"], "password": "Demo-2026!"}).status_code == 403
    assert client.get("/api/admin/todo", headers=h(tok)).status_code == 401
    assert client.post("/api/admin/test/purge", headers=h(tok)).status_code == 401
    # Route à authentification facultative : le jeton est ignoré (visiteur anonyme)
    assert client.get("/api/companies", headers=h(tok)).status_code == 200
    # Le vrai admin garde l'accès
    assert client.get("/api/admin/todo", headers=api.h(test_mode)).status_code == 200


def test_trial_account_token_carries_test_claim(api, client, admin, monkeypatch):
    """Compte créé pendant l'essai : jeton `tm` refusé hors mode test, nouvelle connexion possible ; un vrai compte connecté
    pendant l'essai garde sa session"""
    real = api.register(uid("reel-tm"), "seller")
    monkeypatch.setenv("TEST_MODE", "true")
    r = client.post("/api/auth/register", json={"email": uid("essai-tm"), "password": "Password1!", "role": "seller",
                                                "first_name": "Jean", "last_name": "Essai"})
    trial = {"token": r.json()["token"], "email": r.json()["user"]["email"]}
    assert server.decode_token(trial["token"]).get("tm") is True
    r = client.post("/api/auth/login", json={"email": real["email"], "password": "Password1!"})
    real_trial_token = {"token": r.json()["token"]}
    assert "tm" not in server.decode_token(real_trial_token["token"])
    monkeypatch.delenv("TEST_MODE")
    assert client.get("/api/auth/profile", headers=h(trial)).status_code == 401
    assert client.get("/api/auth/profile", headers=h(relogin(client, trial))).status_code == 200
    assert client.get("/api/auth/profile", headers=h(real_trial_token)).status_code == 200


# ---------- D2 : données réelles jamais repassées en test ni purgées ----------

def test_real_listing_resigned_in_test_mode_is_never_purged(api, client, admin, monkeypatch):
    seller, company = published_listing(api, client)
    c = stored(client, "companies", {"id": company["id"]})
    real_mandate = stored(client, "generated_contracts", {"id": c["mandate_id"]})
    assert not real_mandate.get("is_test") and isinstance(real_mandate["registry_number"], int)
    r = client.post(f"/api/seller/mandat/{real_mandate['id']}/denounce", headers=api.h(seller), json={})
    assert r.status_code == 200, r.text
    monkeypatch.setenv("TEST_MODE", "true")
    m = client.post("/api/seller/mandat/generate", params={"company_id": company["id"]}, headers=api.h(seller)).json()
    code = client.post("/api/signatures/request-code", headers=api.h(seller), json={"contract_id": m["contract_id"]}).json()["test_code"]
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller), json={"otp_code": code})
    assert r.status_code == 200 and r.json()["registry_number"].startswith("TEST-"), r.text
    after = stored(client, "companies", {"id": company["id"]})
    assert not after.get("is_test") and after["mandate_is_test"] is True
    monkeypatch.delenv("TEST_MODE")
    # Annonce réelle sous mandat de test : masquée au public hors mode test (le mandat de test ne vaut rien)
    public = {x["id"] for x in client.get("/api/companies", params={"limit": 200}).json()}
    assert company["id"] not in public
    assert client.get(f"/api/companies/{company['id']}").status_code in (403, 404)
    client.post("/api/admin/test/purge", params={"dry_run": "false"}, headers=api.h(admin))
    assert stored(client, "generated_contracts", {"id": real_mandate["id"]})["registry_number"] == real_mandate["registry_number"]
    assert stored(client, "companies", {"id": company["id"]}) and stored(client, "users", {"id": seller["id"]})
    assert stored(client, "documents", {"contract_id": real_mandate["id"]})
    assert not stored(client, "generated_contracts", {"id": m["contract_id"]})


def test_purge_protects_real_registry_mandate_even_on_test_listing(api, client, admin):
    """Défense en profondeur : une annonce marquée de test qui porte un mandat du registre réel n'est pas purgée ; le
    mandat est signalé dans `protected`"""
    seller, company = published_listing(api, client)
    mandate_id = stored(client, "companies", {"id": company["id"]})["mandate_id"]
    db_call(client, server.db.companies.update_one, {"id": company["id"]}, {"$set": {"is_test": True}})
    plan, _, company_ids = client.portal.call(purge_cli.purge_plan, server.db)
    assert company["id"] not in company_ids
    done = client.post("/api/admin/test/purge", params={"dry_run": "false"}, headers=api.h(admin)).json()
    assert mandate_id in [p["id"] for p in done["protected"]["generated_contracts"]]
    assert stored(client, "generated_contracts", {"id": mandate_id}) and stored(client, "companies", {"id": company["id"]})
    # Base partagée entre les tests : l'annonce redevient réelle (aucune donnée de test résiduelle)
    db_call(client, server.db.companies.update_one, {"id": company["id"]}, {"$unset": {"is_test": ""}})


def test_real_closing_billed_in_test_mode_stays_real(api, client, admin, monkeypatch):
    ctx = _setup(api, client, "vente-reelle-essai")
    monkeypatch.setenv("TEST_MODE", "true")
    _declare(client, api, ctx, "buyer", price=500000)
    r = client.post(f"/api/closing/{ctx['closing']['id']}/confirm", headers=api.h(ctx["seller"]))
    assert r.status_code == 200, r.text
    number = r.json()["invoice"]["number"]
    assert number.startswith("TEST-FAC-")
    assert not stored(client, "closings", {"id": ctx["closing"]["id"]}).get("is_test")
    monkeypatch.delenv("TEST_MODE")
    done = client.post("/api/admin/test/purge", params={"dry_run": "false"}, headers=api.h(admin)).json()
    assert done["counts"].get("invoices") == 1 and done["counts"].get("closings.invoice_id") == 1
    clo = stored(client, "closings", {"id": ctx["closing"]["id"]})
    assert clo and "invoice_id" not in clo and "invoice_number" not in clo
    assert stored(client, "companies", {"id": ctx["company"]["id"]})
    # Une facture réelle peut ensuite être émise pour cette vente
    invoice = client.portal.call(closing.issue_invoice, clo)
    assert re.fullmatch(r"FAC-\d{4}-\d{5}", invoice["number"]) and not invoice.get("is_test")


# ---------- D3 : contrôles assouplis réservés aux données de test ----------

def test_relaxed_checks_do_not_apply_to_real_listing(api, client, admin, monkeypatch):
    siret = unique_siret()
    _, first = published_listing(api, client, siret=siret)
    seller = api.register(uid("doublon"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/companies", headers=api.h(seller), json=listing(siret=siret)).json()
    m = api.mandate(seller, c["id"])
    assert api.sign_mandate(seller, m["contract_id"]).status_code == 200
    blocked = stored(client, "companies", {"id": c["id"]})
    assert blocked["status"] == "draft" and "doublon_siren" in blocked["blocking"]
    monkeypatch.setenv("TEST_MODE", "true")
    r = client.put(f"/api/companies/{c['id']}", headers=api.h(seller), json={"description": "Description mise à jour " * 10})
    assert r.status_code == 200, r.text
    after = stored(client, "companies", {"id": c["id"]})
    assert after["status"] == "draft" and "doublon_siren" in after["blocking"]
    monkeypatch.delenv("TEST_MODE")
    public = {x["id"] for x in client.get("/api/companies", params={"limit": 200}).json()}
    assert c["id"] not in public and first["id"] in public


# ---------- D4 : journaux d'identité révélée ----------

def test_purge_removes_contact_reveal_logs(api, client, admin, monkeypatch):
    monkeypatch.setenv("TEST_MODE", "true")
    seller, c, _, _ = make_test_listing(client)
    monkeypatch.delenv("TEST_MODE")
    real_seller, real_company = published_listing(api, client)
    test_log, real_log = str(uuid.uuid4()), str(uuid.uuid4())
    db_call(client, server.db.contact_reveal_logs.insert_many, [
        {"id": test_log, "who": seller["id"], "what": "identite_acquereur", "subject_id": seller["id"], "company_id": c["id"]},
        {"id": real_log, "who": real_seller["id"], "what": "identite_acquereur", "subject_id": real_seller["id"],
         "company_id": real_company["id"]}])
    plan, _, _ = client.portal.call(purge_cli.purge_plan, server.db)
    assert "contact_reveal_logs" in {name for name, _ in plan}
    client.post("/api/admin/test/purge", params={"dry_run": "false"}, headers=api.h(admin))
    assert not stored(client, "contact_reveal_logs", {"id": test_log})
    assert stored(client, "contact_reveal_logs", {"id": real_log})


# ---------- D5 : vraie confirmation après une confirmation simulée ----------

def test_real_user_can_confirm_email_after_simulated_confirmation(api, client, admin, monkeypatch):
    user = api.register(uid("reel-noconf"), "seller", verify_email=False)
    token = api.verification_token(user["email"])
    monkeypatch.setenv("TEST_MODE", "true")
    assert client.post("/api/test/confirm-email", headers=api.h(user)).status_code == 200
    monkeypatch.delenv("TEST_MODE")
    assert client.get("/api/auth/profile", headers=api.h(user)).json()["email_verified"] is False
    r = client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 200 and not r.json().get("already_verified"), r.text
    account = stored(client, "users", {"id": user["id"]})
    assert account["email_verified"] is True and "email_verified_via" not in account
    assert client.get("/api/auth/profile", headers=api.h(user)).json()["email_verified"] is True


def test_resend_verification_after_simulated_confirmation(api, client, admin, monkeypatch):
    user = api.register(uid("reel-renvoi"), "seller", verify_email=False)
    monkeypatch.setenv("TEST_MODE", "true")
    assert client.post("/api/test/confirm-email", headers=api.h(user)).status_code == 200
    monkeypatch.delenv("TEST_MODE")
    db_call(client, server.db.email_verifications.delete_many, {"user_id": user["id"]})  # délai d'une minute écoulé
    r = client.post("/api/auth/resend-verification", headers=api.h(user))
    assert r.status_code == 200 and r.json().get("sent") is not False and not r.json().get("already_verified"), r.text


# ---------- D6 : boîte de test et suppression de compte ----------

def test_mailbox_not_inherited_after_account_deletion(client, test_mode):
    seller, _, _, _ = make_test_listing(client)
    assert client.get("/api/test/emails", headers=h(seller)).json()
    assert client.request("DELETE", "/api/auth/account", headers=h(seller), json={"password": "Password1!"}).status_code == 200
    assert not db_call(client, server.db.test_emails.find_one, {"to": seller["email"], "subject": {"$regex": "mandat"}})
    r = client.post("/api/auth/register", json={"email": seller["email"], "password": "Password1!", "role": "buyer",
                                                "first_name": "Tiers", "last_name": "Inconnu"})
    assert r.status_code == 200, r.text
    other = {"token": r.json()["token"]}
    inbox = client.get("/api/test/emails", params={"limit": 200}, headers=h(other)).json()
    assert all("mandat" not in m["subject"].lower() for m in inbox)


def test_mailbox_ignores_emails_older_than_account(client, test_mode):
    """Un e-mail antérieur à la création du compte (ancien titulaire de l'adresse) n'est jamais servi"""
    r = client.post("/api/auth/register", json={"email": uid("boite"), "password": "Password1!", "role": "buyer",
                                                "first_name": "Anne", "last_name": "Nouvelle"})
    user = {"token": r.json()["token"], "email": r.json()["user"]["email"]}
    old_id = str(uuid.uuid4())
    db_call(client, server.db.test_emails.insert_one, {"id": old_id, "to": user["email"], "subject": "Ancien e-mail",
                                                        "html": "<p>ancien</p>", "created_at": "2020-01-01T00:00:00+00:00"})
    assert old_id not in {m["id"] for m in client.get("/api/test/emails", headers=h(user)).json()}
    assert client.get(f"/api/test/emails/{old_id}", headers=h(user)).status_code == 404


# ---------- UX-01 : clé du panneau de test ----------

def test_test_panel_key(api, client, test_mode, monkeypatch):
    monkeypatch.setenv("TEST_PANEL_KEY", KEY)
    cfg = client.get("/api/config").json()
    assert cfg["test_panel_protected"] is True and cfg["test_panel_access"] is False and cfg["test_panel_admin"] is False
    cfg = client.get("/api/config", headers={"X-Test-Key": KEY}).json()
    assert cfg["test_panel_access"] is True and cfg["test_panel_admin"] is True
    assert client.post("/api/test/seed").status_code == 403
    assert client.post("/api/test/seed", headers={"X-Test-Key": KEY}).status_code == 200
    for persona in ("vendeur", "repreneur", "admin"):
        r = client.post("/api/test/login-as", json={"persona": persona})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "test_key_required", persona
        r = client.post("/api/test/login-as", json={"persona": persona}, headers={"X-Test-Key": "mauvaise-cle"})
        assert r.status_code == 403, persona
        assert client.post("/api/test/login-as", json={"persona": persona}, headers={"X-Test-Key": KEY}).status_code == 200
    # Le mot de passe démo étant public, l'admin démo exige aussi la clé par la connexion classique
    creds = {"email": DEMO_EMAILS["admin"], "password": "Demo-2026!"}
    assert client.post("/api/auth/login", json=creds).status_code == 403
    r = client.post("/api/auth/login", json=creds, headers={"X-Test-Key": KEY})
    assert r.status_code == 200 and r.json()["test_code"]
    # Vendeur démo : connexion classique ouverte (aucun droit d'administration)
    assert client.post("/api/auth/login", json={"email": DEMO_EMAILS["vendeur"], "password": "Demo-2026!"}).status_code == 200
    # Code de connexion du vrai admin : renvoyé en clair seulement avec la clé
    r = client.post("/api/auth/login", json={"email": "admin@test.fr", "password": "AdminTest123!"})
    assert r.status_code == 200 and r.json()["otp_required"] and "test_code" not in r.json()


def test_test_panel_without_key_in_production(client, test_mode, monkeypatch):
    monkeypatch.delenv("TEST_PANEL_KEY", raising=False)
    cfg = client.get("/api/config").json()
    assert cfg["test_panel_protected"] is False and cfg["test_panel_access"] is True and cfg["test_panel_admin"] is True
    monkeypatch.setenv("ENV", "production")
    cfg = client.get("/api/config").json()
    assert cfg["test_panel_protected"] is False and cfg["test_panel_access"] is True and cfg["test_panel_admin"] is False
    assert client.post("/api/test/seed").status_code == 200
    assert client.post("/api/test/login-as", json={"persona": "admin"}).status_code == 403
    assert client.post("/api/auth/login", json={"email": DEMO_EMAILS["admin"], "password": "Demo-2026!"}).status_code == 403
    assert client.post("/api/test/login-as", json={"persona": "vendeur"}).status_code == 200
    # Le vrai admin reçoit toujours son code à l'écran (les e-mails sont capturés en mode test)
    r = client.post("/api/auth/login", json={"email": "admin@test.fr", "password": "AdminTest123!"})
    assert r.status_code == 200 and r.json()["test_code"]


def test_config_without_test_mode_has_no_panel_fields(client, monkeypatch):
    monkeypatch.delenv("TEST_MODE", raising=False)
    cfg = client.get("/api/config").json()
    assert cfg["test_mode"] is False and "test_panel_protected" not in cfg and "test_panel_access" not in cfg and "test_panel_admin" not in cfg


# ---------- UX-07 : annonces de démonstration ----------

def test_demo_listings_checks_passed_except_one_to_review(api, client, test_mode):
    assert client.post("/api/test/seed").status_code == 200
    seller = stored(client, "users", {"email": DEMO_EMAILS["vendeur"]})
    demo = db_call(client, lambda: server.db.companies.find({"seller_id": seller["id"]}, {"_id": 0}).to_list(50))
    assert len(demo) == 8 and all(c["status"] == "published" for c in demo)
    to_review = [c for c in demo if c["moderation"]["status"] == "pending"]
    assert [c["demo_key"] for c in to_review] == ["couverture-gironde"]
    verified = [c for c in demo if c["company_checks"].get("in_ademe_list") is True]
    assert len(verified) == 5 and all(c["rge_types"] for c in verified)
    for c in demo:
        if c["demo_key"] != "couverture-gironde":
            assert c["moderation"]["flags"] == [] and c["company_checks"]["dirigeant_match"] == "match_exact", c["demo_key"]
    admin_tok = client.post("/api/test/login-as", json={"persona": "admin"}).json()
    todo = client.get("/api/admin/todo", headers=h(admin_tok)).json()
    review = next(s for s in todo["sections"] if s["key"] == "listings_review")
    demo_ids = {c["id"] for c in demo}
    assert [r["id"] for r in review["rows"] if r["id"] in demo_ids] == [to_review[0]["id"]]


# ---------- UX-11 : total des listes lisible par un front sur un autre domaine ----------

def test_total_count_header_exposed_to_cross_origin_front(client):
    origin = server.cors_origins()[0] if server.cors_origins() else "http://localhost:3000"
    r = client.get("/api/companies", params={"limit": 1}, headers={"Origin": origin})
    assert r.status_code == 200 and "x-total-count" in r.headers
    assert "x-total-count" in r.headers.get("access-control-expose-headers", "").lower()
