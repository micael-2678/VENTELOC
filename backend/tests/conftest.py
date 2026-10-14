"""
Tests de bout en bout de l'API, sans services externes :
- MongoDB remplacé par mongomock (en mémoire)
- emails Brevo interceptés (liste `sent_emails`)
- appels INPI / Stripe non utilisés ou simulés
- limitation de débit désactivée (réactivée ponctuellement par test_fondations.py)
Lancer : cd backend && pip install -r requirements.txt -r requirements-dev.txt && pytest
"""
import copy
import os
import re
import sys
from types import SimpleNamespace

import pytest

os.environ.update({
    "MONGO_URL": "mongodb://mock", "DB_NAME": "cessionrge_test", "JWT_SECRET": "x" * 32,
    "SITE_URL": "https://cessionrge.test", "FRONTEND_URL": "https://cessionrge.test", "SITE_NAME": "CessionBâtiment",
    "ADMIN_EMAIL": "admin@test.fr", "ADMIN_PASSWORD": "AdminTest123!",
    "JOBS_ENABLED": "false", "RATE_LIMIT_ENABLED": "false", "ENV": "test",
    # Plafond journalier d'e-mails désactivé (la suite en envoie plusieurs centaines) ; test dédié dans test_integration_vague3.py
    "EMAIL_DAILY_SOFT_LIMIT": "0",
})
for var in ("S3_BUCKET", "SENTRY_DSN", "COMMISSION_MIN_HT"):
    os.environ.pop(var, None)

import motor.motor_asyncio  # noqa: E402
import mongomock_motor  # noqa: E402
motor.motor_asyncio.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import business_model  # noqa: E402

sent_emails = []


def _fake_send(to_email, to_name, subject, html_content, unsubscribe_url=""):
    sent_emails.append({"to": to_email, "subject": subject,
                        "html": business_model.wrap_email_html(html_content, unsubscribe_url)})
    return SimpleNamespace(message_id="test")


business_model._send_brevo_email_sync = _fake_send

import server  # noqa: E402
import opendata  # noqa: E402
import veille  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Open data (recherche-entreprises) simulé : « Paul DUPONT » est le président de tous les SIREN, entreprise active,
# NAF 43.22A (bâtiment), département 29. Les tests qui ont besoin d'un autre résultat remplacent opendata.fetch_json
# par monkeypatch (et clear_cache()).
_FAKE_ENTREPRISE = {
    "siren": "", "nom_complet": "SECRET ENERGIE", "nom_raison_sociale": "SECRET ENERGIE", "etat_administratif": "A",
    "nature_juridique": "5710", "activite_principale": "43.22A", "date_creation": "2010-01-01", "tranche_effectif_salarie": "11",
    "siege": {"siret": "", "departement": "29", "region": "53", "code_postal": "29200", "libelle_commune": "BREST",
              "adresse": "1 RUE DE LA RADE 29200 BREST", "activite_principale": "43.22A", "etat_administratif": "A"},
    "matching_etablissements": [],
    "dirigeants": [{"nom": "DUPONT", "prenoms": "Paul", "qualite": "Président", "type_dirigeant": "personne physique"}],
    "complements": {"est_rge": True},
}


def _fake_fetch(url):
    m = re.search(r"q=(\d{9})", url)
    if not m:
        return {"results": [], "total_results": 0}
    siren = m.group(1)
    data = copy.deepcopy(_FAKE_ENTREPRISE)
    data["siren"] = siren
    data["siege"]["siret"] = siren + "00011"
    data["matching_etablissements"] = [dict(data["siege"])]
    return {"results": [data], "total_results": 1, "page": 1, "per_page": 10}


opendata.fetch_json = _fake_fetch
opendata.clear_cache()
# Veille BODACC : aucun appel réseau pendant les tests (run_scheduled_jobs(force=True) lance veille.monthly_job)
veille.fetch_json = lambda url: {"total_count": 0, "results": []}


async def _fake_verify_rge(siret):
    # ADEME simulée : jamais de réseau ; tous les SIRET sont « non trouvés » (drapeau rge_absent_ademe, non bloquant)
    return {"verified": False, "message": "SIRET non trouvé dans la base RGE (simulation)", "siret_recherche": siret}


server.verify_rge = _fake_verify_rge


@pytest.fixture(scope="session")
def client():
    with TestClient(server.app) as c:
        yield c


class _PeerApp:
    """Application ASGI vue depuis un pair donné (ex. nginx sur le réseau Docker) : TestClient pose toujours « testclient »"""
    def __init__(self, app, peer):
        self.app, self.peer = app, peer

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            scope = dict(scope, client=(self.peer, 40000))
        await self.app(scope, receive, send)


@pytest.fixture(scope="session")
def proxied_client(client):
    """Client dont les requêtes arrivent d'un proxy de confiance (172.18.0.3, réseau Docker) ; à utiliser après `client`
    (démarrage de l'application déjà fait)."""
    return TestClient(_PeerApp(server.app, "172.18.0.3"))


@pytest.fixture
def emails():
    sent_emails.clear()
    return sent_emails


@pytest.fixture(scope="session")
def db():
    return server.db


CODE_RE = re.compile(r'letter-spacing:6px">(\d{6})<')
VERIFY_LINK_RE = re.compile(r"/confirmer-email/([A-Za-z0-9_\-]+)")


def last_email(to, subject_prefix):
    for e in reversed(sent_emails):
        if e["to"] == to and e["subject"].startswith(subject_prefix):
            return e
    return None


class Api:
    def __init__(self, client):
        self.c = client
        self._admin_token = None

    # Profil de projet complet (score 90 sans SIREN : 100 avec un SIREN vérifié) — SPEC §4.1, API.md §1
    BUYER_PROFILE = {"project_type": "reprise-individuelle", "budget_max": 600000, "apport": 150000, "financing": "mixte",
                     "zones": ["Île-de-France", "Bretagne"], "trades": ["plomberie-chauffage", "pac-clim-cvc"], "horizon": "6-12"}

    def register(self, email, role, first="Jean", last="Test", verify_email=True, profile=True, **extra):
        """Inscription ; l'adresse e-mail est confirmée automatiquement (lien lu dans l'e-mail) sauf verify_email=False.
        Un repreneur reçoit par défaut un profil de projet complet et un téléphone (score ≥ 50) ; profile=False pour un
        compte sans profil (score 0)."""
        body = {"email": email, "password": "Password1!", "role": role, "first_name": first, "last_name": last,
                "company_name": f"{last} SAS"}
        if role == "buyer" and profile:
            body["buyer_profile"] = dict(self.BUYER_PROFILE)
            body["phone"] = "06 12 34 56 78"
        body.update(extra)
        r = self.c.post("/api/auth/register", json=body)
        assert r.status_code == 200, r.text
        data = r.json()
        user = {"token": data["token"], "id": data["user"]["id"], "email": email.lower(), "profile_score": data["user"].get("profile_score")}
        if verify_email:
            self.verify_email(user)
        return user

    def buyer_profile(self, user, score_min=50, **overrides):
        """Renseigne (ou complète) le profil de projet du repreneur via PUT /auth/profile ; renvoie le compte avec son score"""
        body = {"buyer_profile": {**self.BUYER_PROFILE, **overrides}, "phone": "06 12 34 56 78"}
        r = self.c.put("/api/auth/profile", headers=self.h(user), json=body)
        assert r.status_code == 200, r.text
        account = r.json().get("user") or r.json()
        assert account["profile_score"] >= score_min, account
        user["profile_score"] = account["profile_score"]
        return account

    def verification_token(self, email):
        e = last_email(email.lower(), "Confirmez votre adresse")
        assert e, f"aucun e-mail de confirmation envoyé à {email}"
        return VERIFY_LINK_RE.search(e["html"]).group(1)

    def verify_email(self, user):
        r = self.c.post("/api/auth/verify-email", json={"token": self.verification_token(user["email"])})
        assert r.status_code == 200, r.text
        return r.json()

    def admin(self):
        """Connexion administrateur avec second facteur (code lu dans l'e-mail) ; jeton réutilisé ensuite"""
        if self._admin_token:
            return {"token": self._admin_token}
        r = self.c.post("/api/auth/login", json={"email": "admin@test.fr", "password": "AdminTest123!"})
        assert r.status_code == 200, r.text
        assert r.json().get("otp_required") is True
        e = last_email("admin@test.fr", "Votre code de connexion")
        assert e, "aucun code de connexion envoyé à l'admin"
        code = CODE_RE.search(e["html"]).group(1)
        r = self.c.post("/api/auth/login/verify", json={"email": "admin@test.fr", "code": code})
        assert r.status_code == 200, r.text
        self._admin_token = r.json()["token"]
        return {"token": self._admin_token}

    @staticmethod
    def h(user):
        return {"Authorization": f"Bearer {user['token']}"}

    def otp(self, email):
        """Dernier code de signature envoyé par e-mail à cette adresse (dans le corps, jamais dans l'objet)"""
        e = last_email(email, "Votre code de signature")
        assert e, f"aucun code envoyé à {email}"
        assert not re.search(r"\d{6}", e["subject"]), "le code ne doit jamais figurer dans l'objet"
        return CODE_RE.search(e["html"]).group(1)

    def request_code(self, user, contract_id):
        r = self.c.post("/api/signatures/request-code", headers=self.h(user), json={"contract_id": contract_id})
        if r.status_code == 429:
            # Un code vient d'être envoyé pour ce document (délai d'une minute) : on antidate le précédent pour enchaîner
            self.c.portal.call(lambda: server.db.signature_otps.update_many(
                {"user_id": user["id"], "contract_id": contract_id}, {"$set": {"created_at": "2026-01-01T00:00:00+00:00"}}))
            r = self.c.post("/api/signatures/request-code", headers=self.h(user), json={"contract_id": contract_id})
        assert r.status_code == 200, r.text
        return self.otp(user["email"])

    def sign_contract(self, user, contract_id):
        code = self.request_code(user, contract_id)
        return self.c.post(f"/api/contracts/{contract_id}/sign", headers=self.h(user), json={"otp_code": code})

    def sign_mandate(self, user, contract_id):
        code = self.request_code(user, contract_id)
        return self.c.post(f"/api/seller/mandat/{contract_id}/sign", headers=self.h(user), json={"otp_code": code})

    MANDANT_ADDRESS = {"line1": "12 rue de la Mer", "postal_code": "29200", "city": "Brest"}

    def prepare_mandate(self, seller, company_id, address=None):
        """Renseigne l'adresse postale du mandant et l'objet de la cession sur l'annonce (préalable au mandat v2).
        L'adresse est envoyée sous forme d'objet {line1, postal_code, city} (API.md §2) ; repli en chaîne tant que
        PUT /companies/{id} n'accepte qu'un texte."""
        address = address or self.MANDANT_ADDRESS
        company = self.c.get(f"/api/companies/{company_id}", headers=self.h(seller)).json()
        body = {"mandant_address": address}
        if not company.get("sale_object"):
            body["sale_object"] = "titres"
        r = self.c.put(f"/api/companies/{company_id}", headers=self.h(seller), json=body)
        if r.status_code == 422 and isinstance(address, dict):
            body["mandant_address"] = f"{address['line1']}, {address['postal_code']} {address['city']}"
            r = self.c.put(f"/api/companies/{company_id}", headers=self.h(seller), json=body)
        assert r.status_code == 200, r.text
        return r.json()

    def mandate(self, seller, company_id, address=None, expect=200):
        """Adresse et objet renseignés, puis POST /seller/mandat/generate (réponse JSON)"""
        self.prepare_mandate(seller, company_id, address)
        r = self.c.post("/api/seller/mandat/generate", params={"company_id": company_id}, headers=self.h(seller))
        assert r.status_code == expect, r.text
        return r.json()

    def publish(self, seller, company_id):
        """Adresse et objet renseignés, mandat signé (code par e-mail) puis publication par l'admin si l'annonce est en validation"""
        m = self.mandate(seller, company_id)
        if not m.get("already_signed"):
            r = self.sign_mandate(seller, m["contract_id"])
            assert r.status_code == 200, r.text
        r = self.c.put(f"/api/companies/{company_id}/status", params={"status": "published"}, headers=self.h(self.admin()))
        assert r.status_code == 200, r.text

    def accept_dataroom(self, seller, buyer, company_id):
        """Demande de dossier du repreneur acceptée par le cédant ; renvoie l'identifiant de la demande"""
        r = self.c.post(f"/api/dataroom/{company_id}/request-access", headers=self.h(buyer))
        assert r.status_code == 200, r.text
        reqs = self.c.get(f"/api/dataroom/{company_id}/access-requests", headers=self.h(seller)).json()
        reqs = reqs["requests"] if isinstance(reqs, dict) else reqs
        req = next(x for x in reqs if x["buyer_id"] == buyer["id"])
        if req["status"] == "pending":
            r = self.c.put(f"/api/dataroom/{company_id}/access/{req['id']}/validate", headers=self.h(seller))
            assert r.status_code == 200, r.text
        return req["id"]

    def sign_nda(self, buyer, company_id):
        """Génère et signe l'accord de confidentialité (identité vérifiée et demande acceptée requises)"""
        nda = self.c.post("/api/contracts/generate-for-signature", headers=self.h(buyer), json={"company_id": company_id, "doc_type": "nda"})
        assert nda.status_code == 200, nda.text
        nda = nda.json()
        if nda.get("already_signed"):
            return nda["contract"]["id"]
        r = self.sign_contract(buyer, nda["contract_id"])
        assert r.status_code == 200, r.text
        return nda["contract_id"]

    def grant_dataroom(self, seller, buyer, company_id):
        """Parcours complet d'accès au dossier : demande → acceptation par le cédant → identité → NDA → origine des fonds
        (POST /dataroom/{id}/funds-declaration ouvre l'accès automatiquement)."""
        self.accept_dataroom(seller, buyer, company_id)
        self.verify_kyc(buyer)
        contract_id = self.sign_nda(buyer, company_id)
        r = self.c.post(f"/api/dataroom/{company_id}/funds-declaration", headers=self.h(buyer),
                        json={"source": "mixte", "amount": 300000, "financing_partner": "Banque Test"})
        assert r.status_code == 200 and r.json()["access_granted"] is True, r.text
        return contract_id

    def verify_kyc(self, user):
        r = self.c.put(f"/api/admin/kyc/{user['id']}/validate", params={"status": "verified"}, headers=self.h(self.admin()))
        assert r.status_code == 200, r.text


@pytest.fixture(scope="session")
def api(client):
    return Api(client)


def listing(siret="12345678900011", name="SECRET ENERGIE SAS", **extra):
    base = {"rge_types": ["Pompes à chaleur air/eau"], "rge_validity": "2027-12-31", "ca_n": 900000, "ca_n1": 800000,
            "ca_n2": 700000, "margin": 20, "ebitda": 150000, "creation_date": "2010-01-01", "staff_count": 10,
            "legal_structure": "SAS", "pipeline": 100000, "fixed_charges": {}, "debt": 0, "asking_price": 500000,
            "sale_type": "totale", "sale_object": "titres", "region": "Île-de-France", "siret": siret, "company_name": name}
    base.update(extra)
    return base
