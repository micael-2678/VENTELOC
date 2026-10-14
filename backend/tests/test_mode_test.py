"""Mode test (docs/refonte-2026-10/MODE-TEST-ET-APP.md, partie B) : routes /test/* fermées hors mode test, GET /config,
capture des e-mails (et non-envoi), codes et liens renvoyés en clair seulement en mode test, identité et e-mail simulés,
contrôles de publication assouplis, registre des mandats et factures de test séparés, mention « DOCUMENT DE TEST » dans les
textes et les PDF, données de démonstration idempotentes, connexion rapide, boîte mail de test, sitemap sans annonce de
test, purge des données de test (dry-run puis suppression, données réelles intactes)."""
import base64
import io
import re

import pytest
from pypdf import PdfReader

import business_model
import closing
import opendata
import server
import testmode
from conftest import listing, sent_emails
from migrations import purge_test_data as purge_cli
from test_closing import _declare, _setup
from test_parcours_v2 import db_call, published_listing, uid, unique_siret

BANNER = business_model.TEST_DOCUMENT_BANNER
DEMO_EMAILS = {"vendeur": "vendeur.demo@test.local", "repreneur": "repreneur.demo@test.local", "admin": "admin.demo@test.local"}
TEST_ROUTES = [("post", "/api/test/identity/simulate"), ("post", "/api/test/confirm-email"), ("post", "/api/test/seed"),
               ("post", "/api/test/login-as"), ("get", "/api/test/emails"), ("get", "/api/test/emails/inconnu"),
               ("delete", "/api/test/emails")]


def pdf_text(content: bytes) -> str:
    assert content.startswith(b"%PDF")
    return "".join(page.extract_text() for page in PdfReader(io.BytesIO(content)).pages).replace("\xa0", " ")


def h(user):
    return {"Authorization": f"Bearer {user['token']}"}


@pytest.fixture
def admin(api):
    """Jeton administrateur obtenu hors mode test (code lu dans les e-mails envoyés), réutilisé ensuite"""
    return api.admin()


@pytest.fixture
def test_mode(monkeypatch, admin):
    monkeypatch.setenv("TEST_MODE", "true")
    monkeypatch.delenv("TEST_MODE_SEND_EMAILS", raising=False)
    monkeypatch.delenv("TEST_DEMO_PASSWORD", raising=False)
    return admin


def register(client, role, verify=True, **extra):
    """Inscription pendant le mode test ; adresse confirmée par POST /test/confirm-email"""
    email = uid(f"essai-{role}")
    body = {"email": email, "password": "Password1!", "role": role, "first_name": "Jean", "last_name": "Essai",
            "company_name": "Essai SAS", **extra}
    if role == "buyer":
        body.setdefault("buyer_profile", {"project_type": "reprise-individuelle", "budget_max": 600000, "apport": 150000,
                                          "financing": "mixte", "zones": ["Bretagne"], "trades": ["pac-clim-cvc"], "horizon": "6-12"})
        body.setdefault("phone", "06 12 34 56 78")
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 200, r.text
    user = {"token": r.json()["token"], "id": r.json()["user"]["id"], "email": email}
    if verify:
        r = client.post("/api/test/confirm-email", headers=h(user))
        assert r.status_code == 200 and r.json()["verified"] is True, r.text
    return user


def relogin(client, user, password="Password1!"):
    """Nouvelle connexion par mot de passe (jeton sans `tm` une fois le mode test désactivé)"""
    r = client.post("/api/auth/login", json={"email": user["email"], "password": password})
    assert r.status_code == 200, r.text
    return {**user, "token": r.json()["token"]}


def stored(client, coll, query):
    return db_call(client, getattr(server.db, coll).find_one, query, {"_id": 0})


def captured(client, to, subject_part=""):
    docs = db_call(client, lambda: server.db.test_emails.find({"to": to}, {"_id": 0}).sort("created_at", 1).to_list(500))
    return [d for d in docs if subject_part.lower() in d["subject"].lower()]


def counter(client, name):
    return (stored(client, "counters", {"_id": name}) or {}).get("value", 0)


def simulate(client, user, **body):
    r = client.post("/api/test/identity/simulate", headers=h(user), json=body or None)
    assert r.status_code == 200, r.text
    return r.json()


def sign_mandate(client, seller, property_id):
    """Adresse du mandant, mandat généré puis signé avec le code renvoyé en clair (`test_code`)"""
    r = client.put(f"/api/properties/{property_id}", headers=h(seller),
                   json={"mandant_address": {"line1": "3 quai de la Douane", "postal_code": "29200", "city": "Brest"}})
    assert r.status_code == 200, r.text
    m = client.post("/api/seller/mandat/generate", params={"property_id": property_id}, headers=h(seller))
    assert m.status_code == 200, m.text
    m = m.json()
    code = client.post("/api/signatures/request-code", headers=h(seller), json={"contract_id": m["contract_id"]})
    assert code.status_code == 200, code.text
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=h(seller), json={"otp_code": code.json()["test_code"]})
    assert r.status_code == 200, r.text
    return m, r.json()


def make_test_listing(client, siret=None, **extra):
    """Vendeur de test vérifié (simulation) avec une annonce publiée par le parcours réel"""
    seller = register(client, "seller")
    simulate(client, seller)
    c = client.post("/api/properties", headers=h(seller), json=listing(siret=siret or unique_siret(), **extra))
    assert c.status_code == 200, c.text
    c = c.json()
    assert c["status"] == "mandat_en_attente" and c.get("is_test") is True
    mandate, signed = sign_mandate(client, seller, c["id"])
    assert signed["listing_status"] == "published", signed
    return seller, c, mandate, signed



# ---------- Activation ----------

def test_routes_closed_outside_test_mode(api, client, admin, monkeypatch):
    monkeypatch.delenv("TEST_MODE", raising=False)
    assert client.get("/api/config").json()["test_mode"] is False
    for method, path in TEST_ROUTES:
        r = getattr(client, method)(path, headers=api.h(admin))
        assert r.status_code == 404 and r.json()["detail"] == "Introuvable", (method, path, r.text)
        # Sans authentification non plus : la route n'existe pas (404 avant 401/403)
        assert getattr(client, method)(path).status_code == 404, (method, path)
    # La purge reste disponible pour l'admin (nettoyage avant l'ouverture réelle), et seulement pour lui
    assert client.post("/api/admin/test/purge", headers=api.h(admin)).status_code == 200
    seller = api.register(uid("purge-refus"), "seller")
    assert client.post("/api/admin/test/purge", headers=api.h(seller)).status_code == 403
    assert testmode.test_mode_enabled() is False


def test_config_and_email_capture(api, client, test_mode, monkeypatch):
    assert client.get("/api/config").json()["test_mode"] is True
    sent_emails.clear()
    user = register(client, "seller", verify=False)
    # L'e-mail de confirmation est capturé dans la boîte de test, jamais envoyé
    mails = captured(client, user["email"], "Confirmez votre adresse")
    assert len(mails) == 1 and "/confirmer-email/" in mails[0]["html"] and "Accéder à mon espace" in mails[0]["html"]
    assert not [e for e in sent_emails if e["to"] == user["email"]]
    assert stored(client, "users", {"id": user["id"]})["is_test"] is True
    # Lien de confirmation renvoyé en clair (mode test) ; il fonctionne
    db_call(client, server.db.email_verifications.update_many, {"user_id": user["id"]}, {"$set": {"created_at": "2026-01-01T00:00:00+00:00"}})
    r = client.post("/api/auth/resend-verification", headers=h(user))
    assert r.status_code == 200 and "/confirmer-email/" in r.json()["test_link"]
    token = r.json()["test_link"].rsplit("/", 1)[1]
    assert client.post("/api/auth/verify-email", json={"token": token}).json()["verified"] is True
    # TEST_MODE_SEND_EMAILS=true avec une clé Brevo : capturé et envoyé ; jamais aux comptes de démonstration
    monkeypatch.setenv("TEST_MODE_SEND_EMAILS", "true")
    monkeypatch.setenv("BREVO_API_KEY", "cle-de-test")
    result = client.portal.call(business_model.send_brevo_email, user["email"], "", "Essai d'envoi", "<p>Bonjour</p>")
    assert result["success"] is True and "test_email_id" not in result
    assert [e for e in sent_emails if e["to"] == user["email"] and e["subject"] == "Essai d'envoi"]
    assert captured(client, user["email"], "Essai d'envoi")
    result = client.portal.call(business_model.send_brevo_email, DEMO_EMAILS["vendeur"], "", "Démo", "<p>Bonjour</p>")
    assert result["sent"] is False and not [e for e in sent_emails if e["to"] == DEMO_EMAILS["vendeur"]]
    # Sans clé Brevo : capturé seulement
    monkeypatch.delenv("BREVO_API_KEY")
    result = client.portal.call(business_model.send_brevo_email, user["email"], "", "Sans clé", "<p>Bonjour</p>")
    assert result == {"success": True, "captured": True, "sent": False, "test_email_id": result["test_email_id"]}
    assert not [e for e in sent_emails if e["subject"] == "Sans clé"]


def test_capture_never_breaks_caller(client, test_mode, monkeypatch):
    class Broken:
        def __getattr__(self, name):
            raise RuntimeError("base indisponible")
    monkeypatch.setattr(business_model, "email_db", Broken())
    result = client.portal.call(business_model.send_brevo_email, "quelquun@test.fr", "", "Objet", "<p>x</p>")
    assert result["success"] is True and result["test_email_id"] is None


def test_codes_returned_only_in_test_mode(api, client, admin, monkeypatch):
    # Hors mode test : jamais de code ni de lien en clair
    seller = api.register(uid("codes"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(siret=unique_siret())).json()
    m = api.mandate(seller, c["id"])
    r = client.post("/api/signatures/request-code", headers=api.h(seller), json={"contract_id": m["contract_id"]})
    assert r.status_code == 200 and "test_code" not in r.json()
    unverified = api.register(uid("codes-lien"), "buyer", verify_email=False)
    db_call(client, server.db.email_verifications.update_many, {"user_id": unverified["id"]}, {"$set": {"created_at": "2026-01-01T00:00:00+00:00"}})
    r = client.post("/api/auth/resend-verification", headers=api.h(unverified))
    assert r.status_code == 200 and "test_link" not in r.json()
    r = client.post("/api/auth/login", json={"email": "admin@test.fr", "password": "AdminTest123!"})
    assert r.json()["otp_required"] is True and "test_code" not in r.json()
    # Mode test : code de signature et code administrateur renvoyés, et valides
    monkeypatch.setenv("TEST_MODE", "true")
    db_call(client, server.db.signature_otps.update_many, {"user_id": seller["id"]}, {"$set": {"created_at": "2026-01-01T00:00:00+00:00"}})
    r = client.post("/api/signatures/request-code", headers=api.h(seller), json={"contract_id": m["contract_id"]})
    code = r.json()["test_code"]
    assert re.fullmatch(r"\d{6}", code)
    assert client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller), json={"otp_code": code}).status_code == 200
    r = client.post("/api/auth/login", json={"email": "admin@test.fr", "password": "AdminTest123!"})
    assert r.json()["otp_required"] is True and re.fullmatch(r"\d{6}", r.json()["test_code"])
    r = client.post("/api/auth/login/verify", json={"email": "admin@test.fr", "code": r.json()["test_code"]})
    assert r.status_code == 200 and r.json()["token"]


# ---------- Identité et e-mail simulés ----------

def test_simulate_identity_submits_draft_then_publishes(api, client, test_mode, monkeypatch):
    seller = register(client, "seller")
    c = client.post("/api/properties", headers=h(seller), json=listing(siret=unique_siret())).json()
    assert c["status"] == "draft" and c["is_test"] is True
    # Validation : date de naissance au bon format, personne majeure
    r = client.post("/api/test/identity/simulate", headers=h(seller), json={"birth_date": "12/04/1961"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "validation"
    data = simulate(client, seller, first_name="Paul", last_name="Dupont", birth_date="1961-04-12")
    user = data["user"]
    assert user["identity_verified"] is True and user["kyc_status"] == "verified" and user["kyc_provider"] == "test"
    assert user["verified_first_name"] == "Paul" and user["verified_last_name"] == "Dupont" and user["verified_birth_date"] == "1961-04-12"
    # Mêmes effets que Stripe Identity : le brouillon est soumis (mandat à signer), puis publié à la signature
    assert [x["status"] for x in data["listings"] if x["id"] == c["id"]] == ["mandat_en_attente"]
    assert captured(client, seller["email"], "Dernière étape : signez votre mandat")
    _, signed = sign_mandate(client, seller, c["id"])
    assert signed["listing_status"] == "published"
    property = stored(client, "properties", {"id": c["id"]})
    assert property["status"] == "published" and property["is_test"] is True and property["title"] and property["trades"]
    # Hors mode test, une identité simulée ne vaut plus rien
    account = stored(client, "users", {"id": seller["id"]})
    assert server.is_user_verified(account) is True
    monkeypatch.delenv("TEST_MODE")
    assert server.is_user_verified(account) is False and server.is_email_verified(account) is False
    # Le jeton émis pendant l'essai (`tm`) n'est plus valable : nouvelle connexion par mot de passe
    assert client.get("/api/auth/profile", headers=h(seller)).status_code == 401
    seller = relogin(client, seller)
    me = client.get("/api/auth/profile", headers=h(seller)).json()
    assert me["identity_verified"] is False and me["email_verified"] is False and me["kyc_status"] == "pending"
    assert client.get("/api/kyc/status", headers=h(seller)).json()["verified"] is False


def test_confirm_email(client, test_mode):
    buyer = register(client, "buyer", verify=False)
    assert stored(client, "users", {"id": buyer["id"]})["email_verified"] is False
    r = client.post("/api/test/confirm-email", headers=h(buyer))
    assert r.status_code == 200 and r.json() == {"verified": True, "already_verified": False, "email": buyer["email"]}
    account = stored(client, "users", {"id": buyer["id"]})
    assert account["email_verified"] is True and account["email_verified_via"] == "test"
    # Le lien reçu reste valable : il servira à la vraie confirmation une fois le mode test désactivé
    assert stored(client, "email_verifications", {"user_id": buyer["id"], "used": False})
    assert client.post("/api/test/confirm-email").status_code in (401, 403)


# ---------- Contrôles de publication assouplis ----------

def _ceased(monkeypatch):
    async def lookup(siren_or_siret):
        siren = re.sub(r"\D", "", str(siren_or_siret))[:9]
        return {"available": True, "found": True, "siren": siren, "siret": siren + "00011", "siren_active": False, "etat": "cessé",
                "naf": "43.22A", "naf_status": "batiment", "naf_in_building": True, "departement": "29", "region": "Bretagne",
                "nom_complet": "ENTREPRISE CESSÉE", "dirigeants": []}
    monkeypatch.setattr(opendata, "lookup_siren", lookup)


def test_relaxed_publication_checks_in_test_mode(api, client, test_mode, monkeypatch):
    # SIRET fictif (clé de contrôle fausse) accepté, doublon publié avec un drapeau
    siret = "99912345600019"
    assert opendata.validate_siret(siret) is None
    _, first, _, _ = make_test_listing(client, siret=siret)
    _, second, _, _ = make_test_listing(client, siret=siret)
    property = stored(client, "properties", {"id": second["id"]})
    assert property["status"] == "published" and "doublon_siren" in property["moderation"]["flags"] and not property["blocking"]
    # Entreprise cessée : drapeau, pas de blocage
    _ceased(monkeypatch)
    _, ceased, _, _ = make_test_listing(client)
    property = stored(client, "properties", {"id": ceased["id"]})
    assert property["status"] == "published" and "siren_inactif" in property["moderation"]["flags"]
    todo = client.get("/api/admin/todo", headers=api.h(test_mode)).json()
    review = next(s for s in todo["sections"] if s["key"] == "listings_review")
    assert any("mode test : non bloquant" in r["detail"] for r in review["rows"] if r["id"] == ceased["id"])
    # Les autres motifs restent bloquants : prix manquant
    seller = register(client, "seller")
    simulate(client, seller)
    c = client.post("/api/properties", headers=h(seller), json=listing(siret=unique_siret(), asking_price=0, sale_object="titres")).json()
    sign_mandate(client, seller, c["id"])
    property = stored(client, "properties", {"id": c["id"]})
    assert property["status"] == "draft" and property["blocking"] == ["prix_manquant"]


def test_strict_publication_checks_outside_test_mode(api, client, admin, monkeypatch):
    seller, c = published_listing(api, client)
    other = api.register(uid("doublon-reel"), "seller")
    api.verify_kyc(other)
    dup = client.post("/api/properties", headers=api.h(other), json=listing(siret=stored(client, "properties", {"id": c["id"]})["siret"])).json()
    m = api.mandate(other, dup["id"])
    assert api.sign_mandate(other, m["contract_id"]).status_code == 200
    property = stored(client, "properties", {"id": dup["id"]})
    assert property["status"] == "draft" and "doublon_siren" in property["blocking"] and "is_test" not in property
    _ceased(monkeypatch)
    seller2 = api.register(uid("cessee-reelle"), "seller")
    api.verify_kyc(seller2)
    c2 = client.post("/api/properties", headers=api.h(seller2), json=listing(siret=unique_siret())).json()
    m2 = api.mandate(seller2, c2["id"])
    assert api.sign_mandate(seller2, m2["contract_id"]).status_code == 200
    assert "siren_inactif" in stored(client, "properties", {"id": c2["id"]})["blocking"]


# ---------- Pas de vrais engagements ----------

def test_test_mandate_registry_and_documents(api, client, test_mode):
    real_before = counter(client, "mandate_registry")
    test_before = counter(client, server.MANDATE_REGISTRY_TEST_COUNTER)
    seller, c, mandate, signed = make_test_listing(client)
    assert mandate["content"].startswith(BANNER)
    assert signed["registry_number"] == f"TEST-{test_before + 1:04d}"
    assert counter(client, "mandate_registry") == real_before, "le registre réel n'avance pas"
    contract = stored(client, "generated_contracts", {"id": mandate["contract_id"]})
    assert contract["is_test"] is True and contract["content"].startswith(BANNER)
    assert f"n° TEST-{test_before + 1:04d}" in contract["content"]
    # PDF du mandat : bandeau et filigrane
    pdf = client.get(f"/api/seller/mandat/{mandate['contract_id']}/pdf", headers=h(seller)).json()
    text = pdf_text(base64.b64decode(pdf["content"]))
    assert BANNER in text and "DOCUMENT DE TEST" in text
    # Registre admin et CSV : exclus par défaut, inclus sur demande avec la colonne « test »
    rows = client.get("/api/admin/mandates", headers=api.h(test_mode)).json()["mandates"]
    assert not any(r["id"] == mandate["contract_id"] for r in rows) and all(r["test"] is False for r in rows)
    rows = client.get("/api/admin/mandates", params={"include_test": "true"}, headers=api.h(test_mode)).json()["mandates"]
    row = next(r for r in rows if r["id"] == mandate["contract_id"])
    assert row["test"] is True and row["registry_number"] == signed["registry_number"]
    numbers = [r["registry_number"] for r in rows]
    assert numbers.index(signed["registry_number"]) > max((i for i, n in enumerate(numbers) if isinstance(n, int)), default=-1)
    csv = client.get("/api/admin/mandates/export.csv", headers=api.h(test_mode)).text
    assert signed["registry_number"] not in csv and csv.splitlines()[0].endswith(";Test")
    csv = client.get("/api/admin/mandates/export.csv", params={"include_test": "true"}, headers=api.h(test_mode)).text
    assert any(line.startswith(signed["registry_number"] + ";") and line.endswith(";oui") for line in csv.splitlines())
    # « À faire » : ligne « Mode test actif »
    todo = client.get("/api/admin/todo", headers=api.h(test_mode)).json()
    assert todo["sections"][0]["key"] == "test_mode" and todo["sections"][0]["rows"][0]["title"] == "Mode test actif"


def test_test_offer_and_nda_carry_banner(api, client, test_mode):
    seller, c, _, _ = make_test_listing(client)
    buyer = register(client, "buyer")
    r = client.post(f"/api/dataroom/{c['id']}/request-access", headers=h(buyer))
    assert r.status_code == 200, r.text
    req = stored(client, "dataroom_access", {"property_id": c["id"], "buyer_id": buyer["id"]})
    assert req["is_test"] is True
    if req["status"] == "pending":
        assert client.put(f"/api/dataroom/{c['id']}/access/{req['id']}/validate", headers=h(seller)).status_code == 200
    simulate(client, buyer)
    nda = client.post("/api/contracts/generate-for-signature", headers=h(buyer), json={"property_id": c["id"], "doc_type": "nda"}).json()
    assert nda["content"].startswith(BANNER)
    code = client.post("/api/signatures/request-code", headers=h(buyer), json={"contract_id": nda["contract_id"]}).json()["test_code"]
    assert client.post(f"/api/contracts/{nda['contract_id']}/sign", headers=h(buyer), json={"otp_code": code}).status_code == 200
    r = client.post(f"/api/dataroom/{c['id']}/funds-declaration", headers=h(buyer), json={"source": "mixte", "amount": 300000})
    assert r.status_code == 200 and r.json()["access_granted"] is True
    r = client.post("/api/offers", headers=h(buyer), json={"property_id": c["id"], "amount": 450000, "sale_object": "titres",
                                                            "financing": {"equity": 100000, "loan": 350000}, "target_date": "2027-06-30",
                                                            "validity_days": 15})
    assert r.status_code == 200, r.text
    assert r.json()["content"].startswith(BANNER)
    offer = stored(client, "offers", {"id": r.json()["offer"]["id"]})
    assert offer["is_test"] is True and stored(client, "generated_contracts", {"id": offer["contract_id"]})["is_test"] is True
    conv = stored(client, "conversations", {"property_id": c["id"], "buyer_id": buyer["id"]})
    assert conv["is_test"] is True
    signature = stored(client, "documents", {"contract_id": nda["contract_id"]})
    assert signature["is_test"] is True


def test_test_invoice_numbering_and_pdfs(api, client, admin, monkeypatch):
    ctx = _setup(api, client, "facture-test")
    monkeypatch.setenv("TEST_MODE", "true")
    real_before = counter(client, "invoice")
    test_before = counter(client, closing.INVOICE_TEST_COUNTER)
    _declare(client, api, ctx, "buyer", price=500000)
    r = client.post(f"/api/closing/{ctx['closing']['id']}/confirm", headers=api.h(ctx["seller"]))
    assert r.status_code == 200, r.text
    number = r.json()["invoice"]["number"]
    assert re.fullmatch(r"TEST-FAC-\d{4}-\d{5}", number) and number.endswith(f"{test_before + 1:05d}")
    assert counter(client, "invoice") == real_before, "le compteur réel des factures n'avance pas"
    invoice = stored(client, "invoices", {"number": number})
    assert invoice["is_test"] is True
    text = pdf_text(client.get(f"/api/invoices/{invoice['id']}/pdf", headers=api.h(ctx["seller"])).content)
    assert BANNER in text and number in text
    clo = stored(client, "closings", {"id": ctx["closing"]["id"]})
    seller = stored(client, "users", {"id": ctx["seller"]["id"]})
    assert BANNER in pdf_text(closing.payment_order_pdf(clo, invoice, seller))
    assert BANNER in pdf_text(closing.formal_notice_pdf(invoice))
    # Une facture réelle n'a jamais la mention
    monkeypatch.delenv("TEST_MODE")
    assert BANNER not in pdf_text(closing.invoice_pdf({**invoice, "is_test": False}))


# ---------- Données de démonstration et connexion rapide ----------

def test_seed_is_idempotent_and_realistic(api, client, test_mode, monkeypatch):
    r = client.post("/api/test/seed")
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["password"] == "Demo-2026!" and first["listings_total"] == 8 and first["listings_published"] == 8
    assert {a["email"] for a in first["accounts"]} == set(DEMO_EMAILS.values())
    second = client.post("/api/test/seed").json()
    assert second["accounts_created"] == 0 and second["listings_created"] == 0 and second["listings_published"] == 8
    users = {p: stored(client, "users", {"email": e}) for p, e in DEMO_EMAILS.items()}
    assert db_call(client, server.db.users.count_documents, {"email": {"$in": list(DEMO_EMAILS.values())}}) == 3
    assert users["admin"]["role"] == "admin" and users["vendeur"]["role"] == "seller" and users["repreneur"]["role"] == "buyer"
    for user in users.values():
        assert user["is_test"] and user["email_verified"] and user["identity_verified"] and user["kyc_provider"] == "test"
    assert server.buyer_profile_score(users["repreneur"]) >= 50
    properties = db_call(client, lambda: server.db.properties.find({"seller_id": users["vendeur"]["id"]}, {"_id": 0}).to_list(50))
    assert len(properties) == 8 and all(c["status"] == "published" and c["is_test"] for c in properties)
    prices = sorted(c["asking_price"] for c in properties)
    assert prices[0] == 90000 and prices[-1] == 1400000
    assert len({c["region"] for c in properties}) == 8 and len({t for c in properties for t in c["trades"]}) >= 8
    assert any(c["rge_types"] for c in properties) and any(not c["rge_types"] and c["other_qualifications"] for c in properties)
    for c in properties:
        assert c["region"] == server.taxonomy.region_for_departement(c["department"])
        assert 300 <= len(c["description"]) <= 600 and not server.mask_contacts(c["description"])[1]
        assert c["title"] and c["property_checks"] and c["moderation"]["status"] in ("pending", "ok")
        mandate = stored(client, "generated_contracts", {"id": c["mandate_id"]})
        assert mandate["status"] == "signed" and mandate["is_test"] and str(mandate["registry_number"]).startswith("TEST-")
        assert c["is_rge"] is bool(c["rge_types"])
    # Visibles du public en mode test ; masquées dès que le mode test est désactivé
    listed = {c["id"] for c in client.get("/api/properties", params={"limit": 100}).json()}
    assert {c["id"] for c in properties} <= listed
    monkeypatch.delenv("TEST_MODE")
    listed = {c["id"] for c in client.get("/api/properties", params={"limit": 100}).json()}
    assert not ({c["id"] for c in properties} & listed)
    assert client.get(f"/api/properties/{properties[0]['id']}").status_code == 404
    # Compte de démonstration : connexion refusée hors mode test
    r = client.post("/api/auth/login", json={"email": DEMO_EMAILS["vendeur"], "password": "Demo-2026!"})
    assert r.status_code == 403


def test_login_as_and_demo_login(api, client, test_mode):
    client.post("/api/test/seed")
    r = client.post("/api/test/login-as", json={"persona": "vendeur"})
    assert r.status_code == 200 and r.json()["user"]["email"] == DEMO_EMAILS["vendeur"] and "password_hash" not in r.json()["user"]
    assert client.get("/api/auth/profile", headers=h(r.json())).json()["role"] == "seller"
    admin_demo = client.post("/api/test/login-as", json={"persona": "admin"}).json()
    assert client.get("/api/admin/todo", headers=h(admin_demo)).status_code == 200
    # Persona inexistant
    assert client.post("/api/test/login-as", json={"persona": "notaire"}).status_code == 422
    # Jamais un vrai compte : l'adresse de démonstration portée par un compte réel est refusée
    db_call(client, server.db.users.update_one, {"email": DEMO_EMAILS["repreneur"]}, {"$set": {"is_test": False}})
    r = client.post("/api/test/login-as", json={"persona": "repreneur"})
    assert r.status_code == 403
    assert client.post("/api/test/seed").status_code == 409
    db_call(client, server.db.users.update_one, {"email": DEMO_EMAILS["repreneur"]}, {"$set": {"is_test": True}})
    # Connexion normale avec le mot de passe affiché (adresse @test.local acceptée à la connexion, refusée à l'inscription)
    r = client.post("/api/auth/login", json={"email": DEMO_EMAILS["repreneur"], "password": "Demo-2026!"})
    assert r.status_code == 200 and r.json()["token"]
    r = client.post("/api/auth/login", json={"email": DEMO_EMAILS["admin"], "password": "Demo-2026!"})
    assert r.json()["otp_required"] is True and r.json()["test_code"]
    assert client.post("/api/auth/login/verify", json={"email": DEMO_EMAILS["admin"], "code": r.json()["test_code"]}).status_code == 200
    r = client.post("/api/auth/register", json={"email": "autre.demo@test.local", "password": "Password1!", "role": "buyer"})
    assert r.status_code == 422
    assert client.post("/api/auth/login", json={"email": "pas-une-adresse", "password": "x"}).status_code == 422


def test_mailbox_visibility(api, client, test_mode):
    alice = register(client, "buyer")
    bob = register(client, "buyer")
    for user in (alice, bob):
        client.portal.call(business_model.send_brevo_email, user["email"], "", f"Bonjour {user['id'][:6]}", "<p>Contenu</p>")
    mine = client.get("/api/test/emails", headers=h(alice))
    assert mine.status_code == 200 and int(mine.headers["X-Total-Count"]) == len(mine.json()) >= 2
    assert {m["to"] for m in mine.json()} == {alice["email"]} and "html" not in mine.json()[0]
    assert mine.json()[0]["created_at"] >= mine.json()[-1]["created_at"] and mine.json()[0]["from"]
    own = client.get(f"/api/test/emails/{mine.json()[0]['id']}", headers=h(alice)).json()
    assert set(own) >= {"id", "to", "subject", "html", "created_at"} and own["to"] == alice["email"]
    bob_mail = client.get("/api/test/emails", headers=h(bob)).json()[0]
    assert client.get(f"/api/test/emails/{bob_mail['id']}", headers=h(alice)).status_code == 404
    # L'admin voit tout, filtre par destinataire, et peut seul vider la boîte
    everything = client.get("/api/test/emails", params={"limit": 200}, headers=api.h(test_mode)).json()
    assert {alice["email"], bob["email"]} <= {m["to"] for m in everything}
    filtered = client.get("/api/test/emails", params={"to": bob["email"].upper()}, headers=api.h(test_mode)).json()
    assert filtered and {m["to"] for m in filtered} == {bob["email"]}
    assert client.get(f"/api/test/emails/{bob_mail['id']}", headers=api.h(test_mode)).status_code == 200
    assert client.get("/api/test/emails", params={"limit": 0}, headers=h(alice)).status_code == 422
    assert client.delete("/api/test/emails", headers=h(alice)).status_code == 403
    r = client.delete("/api/test/emails", headers=api.h(test_mode))
    assert r.status_code == 200 and r.json()["deleted"] >= 4
    assert client.get("/api/test/emails", headers=h(alice)).json() == []


# ---------- Sitemap et purge ----------

def test_sitemap_never_lists_test_listings(api, client, admin, monkeypatch):
    _, real = published_listing(api, client)
    monkeypatch.setenv("TEST_MODE", "true")
    _, test_property, _, _ = make_test_listing(client)
    xml = client.get("/api/sitemap.xml").text
    assert f"/property/{real['id']}</loc>" in xml
    assert f"/property/{test_property['id']}" not in xml


def test_purge_removes_test_data_only(api, client, admin, monkeypatch):
    # Données réelles (hors mode test) : vendeur, annonce publiée, mandat, repreneur
    real_seller, real_property = published_listing(api, client)
    real_buyer = api.register(uid("reel-rep"), "buyer")
    real_mandate_id = stored(client, "properties", {"id": real_property["id"]})["mandate_id"]
    # Données de test : annonce avec photo, repreneur de test qui contacte une annonce réelle, alerte sans compte
    monkeypatch.setenv("TEST_MODE", "true")
    seller, c, mandate, _ = make_test_listing(client)
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
    r = client.post(f"/api/properties/{c['id']}/photos", headers=h(seller), files={"file": ("photo.png", png, "image/png")})
    assert r.status_code == 200, r.text
    test_buyer = register(client, "buyer")
    r = client.post(f"/api/properties/{real_property['id']}/contact", headers=h(test_buyer), json={"message": "Bonjour, je suis intéressée"})
    assert r.status_code == 200, r.text
    assert client.post("/api/alerts/public", json={"email": uid("alerte-essai"), "trades": ["isolation"]}).status_code == 200
    client.post("/api/test/seed")
    monkeypatch.delenv("TEST_MODE")

    todo = client.get("/api/admin/todo", headers=api.h(admin)).json()
    assert todo["sections"][0]["key"] == "test_mode" and todo["sections"][0]["rows"][0]["title"] == "Données de test à supprimer"
    # Simulation : comptes par collection, rien n'est supprimé
    dry = client.post("/api/admin/test/purge", headers=api.h(admin)).json()
    assert dry["dry_run"] is True and dry["total"] > 0
    for coll in ("users", "properties", "generated_contracts", "property_photos", "conversations", "messages", "test_emails", "counters",
                 "public_alerts", "documents"):
        assert dry["counts"].get(coll, 0) > 0, coll
    assert stored(client, "users", {"id": test_buyer["id"]})
    assert client.portal.call(purge_cli.purge_test_data, server.db, True)["counts"] == dry["counts"]
    # Suppression
    done = client.post("/api/admin/test/purge", params={"dry_run": "false"}, headers=api.h(admin)).json()
    assert done["dry_run"] is False and done["counts"] == dry["counts"]
    for coll in ("users", "properties", "generated_contracts", "offers", "closings", "invoices", "alerts", "public_alerts",
                 "dataroom_access", "conversations", "property_photos", "documents", "events", "estimates"):
        assert db_call(client, getattr(server.db, coll).count_documents, {"is_test": True}) == 0, coll
    assert db_call(client, server.db.test_emails.count_documents, {}) == 0
    assert not db_call(client, server.db.counters.find_one, {"_id": {"$regex": "_test$"}})
    assert not stored(client, "users", {"id": test_buyer["id"]}) and not stored(client, "properties", {"id": c["id"]})
    assert not stored(client, "generated_contracts", {"id": mandate["contract_id"]})
    assert not stored(client, "conversations", {"buyer_id": test_buyer["id"]})
    assert not stored(client, "messages", {"sender_id": test_buyer["id"]})
    assert not stored(client, "users", {"email": DEMO_EMAILS["vendeur"]})
    # Les données réelles restent intactes
    assert stored(client, "users", {"id": real_seller["id"]}) and stored(client, "users", {"id": real_buyer["id"]})
    assert stored(client, "properties", {"id": real_property["id"]})["status"] == "published"
    assert stored(client, "generated_contracts", {"id": real_mandate_id})["status"] == "signed"
    assert counter(client, "mandate_registry") > 0 and stored(client, "users", {"email": "admin@test.fr"})
    assert client.post("/api/admin/test/purge", headers=api.h(admin)).json() == {
        "dry_run": True, "counts": {}, "total": 0, "files": 0, "protected": {"generated_contracts": [], "invoices": []}}
    todo = client.get("/api/admin/todo", headers=api.h(admin)).json()
    assert all(s["key"] != "test_mode" for s in todo["sections"])
