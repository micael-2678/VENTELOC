"""
Tests de bout en bout de l'API, sans services externes :
- MongoDB remplacé par mongomock (en mémoire)
- emails Brevo interceptés (liste `sent_emails`)
- open data (recherche-entreprises) et Stripe simulés
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
    "MONGO_URL": "mongodb://mock", "DB_NAME": "venteloc_test", "JWT_SECRET": "x" * 32,
    "SITE_URL": "https://venteloc.test", "FRONTEND_URL": "https://venteloc.test", "SITE_NAME": "VenteLoc",
    "ADMIN_EMAIL": "admin@test.fr", "ADMIN_PASSWORD": "AdminTest123!",
    "JOBS_ENABLED": "false", "RATE_LIMIT_ENABLED": "false", "ENV": "test",
    # Plafond journalier d'e-mails désactivé (la suite en envoie plusieurs centaines) ; test dédié dans test_integration_vague3.py
    "EMAIL_DAILY_SOFT_LIMIT": "0",
})
for var in ("S3_BUCKET", "SENTRY_DSN", "COMMISSION_MIN_HT", "COMMISSION_RATE_PERCENT"):
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
from fastapi.testclient import TestClient  # noqa: E402

# Open data (recherche-entreprises) simulé : « Paul DUPONT » est le gérant de toutes les sociétés (SCI active, siège à
# Lyon). Les tests qui ont besoin d'un autre résultat remplacent opendata.fetch_json par monkeypatch (et clear_cache()).
_FAKE_ENTREPRISE = {
    "siren": "", "nom_complet": "SCI DES TILLEULS", "nom_raison_sociale": "SCI DES TILLEULS", "etat_administratif": "A",
    "nature_juridique": "6540", "activite_principale": "68.20B", "date_creation": "2010-01-01", "tranche_effectif_salarie": "NN",
    "siege": {"siret": "", "departement": "69", "region": "84", "code_postal": "69007", "libelle_commune": "LYON",
              "adresse": "1 RUE DE LA RADE 69007 LYON", "activite_principale": "68.20B", "etat_administratif": "A"},
    "matching_etablissements": [],
    "dirigeants": [{"nom": "DUPONT", "prenoms": "Paul", "qualite": "Gérant", "type_dirigeant": "personne physique"}],
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

    # Profil de projet complet (90 points, 100 avec un téléphone valide) — SPEC §4, API.md §1
    BUYER_PROFILE = {"project_type": "particulier", "budget_max": 600000, "apport": 150000, "financing": "mixte",
                     "zones": ["Île-de-France", "Auvergne-Rhône-Alpes"], "property_types": ["appartement", "maison"],
                     "min_yield": 4, "horizon": "6-12"}

    def register(self, email, role, first="Jean", last="Test", verify_email=True, profile=True, **extra):
        """Inscription ; l'adresse e-mail est confirmée automatiquement (lien lu dans l'e-mail) sauf verify_email=False.
        Un acquéreur reçoit par défaut un profil de projet complet et un téléphone (score 100) ; profile=False pour un
        compte sans profil (score 0)."""
        body = {"email": email, "password": "Password1!", "role": role, "first_name": first, "last_name": last}
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
        """Renseigne (ou complète) le profil de projet de l'acquéreur via PUT /auth/profile ; renvoie le compte avec son score"""
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
    PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF"

    def prepare_mandate(self, seller, property_id, address=None, capacity=None):
        """Renseigne l'adresse postale et la qualité du mandant (et l'objet de la vente s'il manque) : préalables au mandat"""
        address = address or self.MANDANT_ADDRESS
        property = self.c.get(f"/api/properties/{property_id}", headers=self.h(seller)).json()
        body = {"mandant_address": address,
                "mandant_capacity": capacity or ("gerant" if property.get("owner_type") in ("sci", "societe") else "proprietaire")}
        if not property.get("sale_object"):
            body["sale_object"] = "bien"
        r = self.c.put(f"/api/properties/{property_id}", headers=self.h(seller), json=body)
        assert r.status_code == 200, r.text
        return r.json()

    def ownership(self, seller, property_id, doc_type="titre-propriete", verify=False):
        """Dépose le justificatif de propriété (PDF) ; `verify=True` : validé ensuite par l'admin"""
        r = self.c.post(f"/api/properties/{property_id}/ownership-proof", headers=self.h(seller), data={"doc_type": doc_type},
                        files={"file": ("titre.pdf", self.PDF, "application/pdf")})
        assert r.status_code == 200, r.text
        if verify:
            r = self.c.put(f"/api/admin/properties/{property_id}/ownership", headers=self.h(self.admin()), json={"status": "verified"})
            assert r.status_code == 200, r.text
        return r.json()

    def mandate(self, seller, property_id, address=None, expect=200):
        """Adresse et objet renseignés, puis POST /seller/mandat/generate (réponse JSON)"""
        self.prepare_mandate(seller, property_id, address)
        r = self.c.post("/api/seller/mandat/generate", params={"property_id": property_id}, headers=self.h(seller))
        assert r.status_code == expect, r.text
        return r.json()

    def publish(self, seller, property_id):
        """Justificatif déposé, adresse et qualité du mandant renseignées, mandat signé (code par e-mail) : publication
        automatique ; puis validation par l'admin (relecture close)"""
        stored = self.c.get(f"/api/properties/{property_id}/ownership-proof", headers=self.h(seller))
        if stored.status_code != 200 or stored.json()["ownership"]["status"] not in ("pending", "verified"):
            self.ownership(seller, property_id)
        m = self.mandate(seller, property_id)
        if not m.get("already_signed"):
            r = self.sign_mandate(seller, m["contract_id"])
            assert r.status_code == 200, r.text
        r = self.c.put(f"/api/properties/{property_id}/status", params={"status": "published"}, headers=self.h(self.admin()))
        assert r.status_code == 200, r.text

    def accept_dataroom(self, seller, buyer, property_id):
        """Demande de dossier de l'acquéreur acceptée par le vendeur ; renvoie l'identifiant de la demande"""
        r = self.c.post(f"/api/dataroom/{property_id}/request-access", headers=self.h(buyer))
        assert r.status_code == 200, r.text
        reqs = self.c.get(f"/api/dataroom/{property_id}/access-requests", headers=self.h(seller)).json()
        reqs = reqs["requests"] if isinstance(reqs, dict) else reqs
        req = next(x for x in reqs if x["buyer_id"] == buyer["id"])
        if req["status"] == "pending":
            r = self.c.put(f"/api/dataroom/{property_id}/access/{req['id']}/validate", headers=self.h(seller))
            assert r.status_code == 200, r.text
        return req["id"]

    def sign_nda(self, buyer, property_id):
        """Génère et signe l'engagement de confidentialité (identité vérifiée et demande acceptée requises)"""
        nda = self.c.post("/api/contracts/generate-for-signature", headers=self.h(buyer), json={"property_id": property_id, "doc_type": "nda"})
        assert nda.status_code == 200, nda.text
        nda = nda.json()
        if nda.get("already_signed"):
            return nda["contract"]["id"]
        r = self.sign_contract(buyer, nda["contract_id"])
        assert r.status_code == 200, r.text
        return nda["contract_id"]

    def grant_dataroom(self, seller, buyer, property_id):
        """Parcours complet d'accès au dossier : demande → acceptation par le vendeur → identité → engagement → origine des
        fonds (POST /dataroom/{id}/funds-declaration ouvre l'accès automatiquement)."""
        self.accept_dataroom(seller, buyer, property_id)
        self.verify_kyc(buyer)
        contract_id = self.sign_nda(buyer, property_id)
        r = self.c.post(f"/api/dataroom/{property_id}/funds-declaration", headers=self.h(buyer),
                        json={"source": "mixte", "amount": 300000, "financing_partner": "Banque Test"})
        assert r.status_code == 200 and r.json()["access_granted"] is True, r.text
        return contract_id

    def verify_kyc(self, user):
        r = self.c.put(f"/api/admin/kyc/{user['id']}/validate", params={"status": "verified"}, headers=self.h(self.admin()))
        assert r.status_code == 200, r.text


@pytest.fixture(scope="session")
def api(client):
    return Api(client)


_ADDRESS_COUNTER = [0]


def listing(siret=None, name=None, **extra):
    """Annonce complète d'un appartement loué (SPEC §3) ; chaque appel a sa propre adresse (pas de doublon). `siret` :
    bien détenu par une SCI (dénomination `name`)."""
    _ADDRESS_COUNTER[0] += 1
    base = {"property_type": "appartement", "owner_type": "personne-physique", "address": f"{_ADDRESS_COUNTER[0]} rue des Lilas",
            "postal_code": "69007", "city": "Lyon", "district": "Jean Macé", "surface": 42, "rooms": 2, "floor": 2,
            "elevator": True, "is_copro": True, "copro_lots": 20, "copro_charges_annual": 900, "copro_procedure": False,
            "dpe_class": "C", "ges_class": "C", "lease_type": "habitation-vide", "rent_monthly": 800, "charges_monthly": 60,
            "lease_start": "2023-01-01", "deposit": 800, "indexation": "irl", "tenant_payment_status": "a-jour",
            "property_tax": 900, "non_recoverable_charges": 400, "asking_price": 200000, "sale_object": "bien",
            "sale_reason": "arbitrage"}
    if siret:
        base.update({"owner_type": "sci", "siret": siret, "company_name": name or "SCI des Tilleuls"})
    base.update(extra)
    return base
