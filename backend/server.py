from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Form, Request, BackgroundTasks
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
import os
import logging
import json
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator
from typing import List, Optional, Dict, Any, Literal, Union
import uuid
from datetime import datetime, timezone, timedelta
from passlib.context import CryptContext
import jwt
import stripe
import requests
import io
import base64
import hashlib
import re
import asyncio
from html import escape as html_escape
import secrets
import shutil
import importlib
import ipaddress

ROOT_DIR = Path(__file__).parent
# Le .env est chargé avant les modules métier : SITE_NAME, SENDER_EMAIL… sont lus à l'appel mais certains
# modules initialisent des clients (Stripe) à l'import.
load_dotenv(ROOT_DIR / '.env')

# Import business model
from storage import save_file, load_file, delete_file, max_upload_bytes, s3_enabled, s3_extra_args
from watermark import WatermarkError, apply_watermark
import business_model
from business_model import (
    seller_commission_enabled, commission_scale, commission_config, commission_scale_text, commission_minimum_ht, fmt_eur_fr,
    fmt_percent_fr, COMMISSION_TERMS_VERSION, COMMISSION_PAYER,
    calculate_commission, add_business_days, send_brevo_email, render_email,
    EMAIL_TEMPLATES, site_url, site_name, sender_email,
    TEST_DOCUMENT_BANNER, DEMO_EMAIL_DOMAIN, test_mode_enabled, mark_test, is_test_related, is_demo_email
)
import emails_contrats  # noqa: F401 — enregistre les gabarits e-mail des contrats (mandat, NDA, offre) dans EMAIL_TEMPLATES
import emails_parcours  # noqa: F401 — gabarits du parcours (contact, dossier, alertes, relances, NPS)
import opendata
import taxonomy
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from fastapi.responses import JSONResponse

ENV = os.environ.get("ENV", "development").strip().lower()
IS_PRODUCTION = ENV == "production"
APP_VERSION = os.environ.get("APP_VERSION", "").strip() or "dev"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Suivi des erreurs optionnel : actif seulement si SENTRY_DSN est défini (plan gratuit suffisant)
SENTRY_DSN = os.environ.get("SENTRY_DSN", "").strip()
if SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=SENTRY_DSN, environment=ENV, release=APP_VERSION, traces_sample_rate=0.0, send_default_pii=False)
        logger.info("Sentry activé")
    except Exception as e:  # jamais bloquant
        logger.warning(f"Sentry non initialisé : {e}")

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
# Compteur journalier des e-mails et journal des échecs d'envoi (business_model.send_brevo_email)
business_model.email_db = db

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
JWT_SECRET = os.environ.get('JWT_SECRET', '')
if len(JWT_SECRET) < 16:
    # Jamais de secret par défaut connu : sans JWT_SECRET, un secret aléatoire est généré
    # (les sessions sont alors invalidées à chaque redémarrage).
    JWT_SECRET = secrets.token_hex(32)
    logging.warning("JWT_SECRET absent ou trop court : secret aléatoire généré. Définissez JWT_SECRET en production.")
JWT_ALGORITHM = "HS256"
JWT_TTL = timedelta(hours=24)

# Stripe
stripe.api_key = os.environ.get('STRIPE_SECRET_KEY', '')

# Create the main app (documentation interactive désactivée en production)
app = FastAPI(docs_url=None if IS_PRODUCTION else "/docs",
              redoc_url=None if IS_PRODUCTION else "/redoc",
              openapi_url=None if IS_PRODUCTION else "/openapi.json")
api_router = APIRouter(prefix="/api")

# ---- Limitation de débit (mémoire : un seul processus) ----
def trusted_proxy_hops() -> int:
    """Nombre de proxys de confiance devant le backend (TRUSTED_PROXY_HOPS, défaut 2 : Traefik puis nginx).
    0 = ne jamais lire X-Forwarded-For (backend exposé directement)."""
    try:
        return max(0, min(int(os.environ.get("TRUSTED_PROXY_HOPS", "2")), 10))
    except ValueError:
        return 2

def _is_trusted_proxy(host: str) -> bool:
    """Le pair direct est-il un proxy de confiance ? TRUSTED_PROXY_NETWORKS (CIDR séparés par des virgules),
    sinon tout réseau privé ou local (réseau Docker)."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    networks = [n.strip() for n in os.environ.get("TRUSTED_PROXY_NETWORKS", "").split(",") if n.strip()]
    if networks:
        for network in networks:
            try:
                if ip in ipaddress.ip_network(network, strict=False):
                    return True
            except ValueError:
                continue
        return False
    return ip.is_private or ip.is_loopback

def client_ip(request: Request) -> str:
    """Adresse réelle du client (limitation de débit, preuves de signature).
    Chaque proxy de confiance AJOUTE à droite de X-Forwarded-For l'adresse de son pair : seule l'entrée posée par le
    premier proxy de confiance (la TRUSTED_PROXY_HOPS-ième en partant de la droite) est fiable ; tout ce qui la précède
    est fourni par le client et ignoré. X-Forwarded-For n'est lu que si le pair direct est un proxy de confiance."""
    peer = request.client.host if request.client and request.client.host else "127.0.0.1"
    hops = trusted_proxy_hops()
    if hops == 0 or not _is_trusted_proxy(peer):
        return peer
    chain = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    if not chain:
        return peer
    return chain[-hops] if len(chain) >= hops else chain[0]

def rate_limit_enabled() -> bool:
    return os.environ.get("RATE_LIMIT_ENABLED", "true").strip().lower() not in ("false", "0", "no")

limiter = Limiter(key_func=client_ip, enabled=rate_limit_enabled())
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Trop de tentatives. Réessayez dans quelques minutes."})

# Password utilities (bcrypt est lent par construction : toujours hors de la boucle d'événements)
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except (ValueError, TypeError):
        return False

async def hash_password_async(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)

async def verify_password_async(plain_password: str, hashed_password: str) -> bool:
    return await asyncio.to_thread(verify_password, plain_password, hashed_password or "")

# JWT utilities
def create_access_token(data: dict, expires_delta: timedelta = JWT_TTL):
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    to_encode.update({"exp": now + expires_delta, "iat": now})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def is_demo_account(user: Optional[dict]) -> bool:
    """Compte de démonstration du mode test (adresse @test.local ou persona du panneau de test)"""
    return bool(user) and (is_demo_email(user.get("email")) or bool(user.get("demo_persona")))

TEST_PANEL_KEY_HEADER = "X-Test-Key"

def test_panel_key() -> str:
    """Clé du panneau de test (TEST_PANEL_KEY) : le fondateur ouvre l'application avec ?cle=… ; le front la renvoie dans
    l'en-tête X-Test-Key. Lue à chaque appel."""
    return os.environ.get("TEST_PANEL_KEY", "").strip()

def test_panel_protected() -> bool:
    """Panneau de test réservé à la clé TEST_PANEL_KEY (définie)"""
    return bool(test_panel_key())

def test_panel_access(request: Optional[Request], admin: bool = False) -> bool:
    """Accès aux fonctions du panneau de test (données de démonstration, connexion rapide, code de connexion admin en
    clair) : clé TEST_PANEL_KEY exacte dans l'en-tête X-Test-Key quand elle est définie ; sans clé, ouvert, sauf en
    production pour l'admin démo (`admin=True`) : son mot de passe est affiché dans le panneau."""
    key = test_panel_key()
    if key:
        sent = (request.headers.get(TEST_PANEL_KEY_HEADER) if request is not None else None) or ""
        return secrets.compare_digest(sent.strip().encode(), key.encode())
    return not (admin and os.environ.get("ENV", "development").strip().lower() == "production")

def issue_token(user: dict) -> str:
    """Jeton de session : porte la version du mot de passe (`pv`) pour être révoqué dès qu'il change. Un jeton émis en
    mode test pour une donnée de test (compte de démonstration, compte créé pendant l'essai) porte `tm` : il cesse d'être
    valable dès que le mode test est désactivé."""
    claims = {"sub": user["email"], "role": user.get("role"), "pv": user.get("password_changed_at") or ""}
    if test_mode_enabled() and (user.get("is_test") or is_demo_account(user)):
        claims["tm"] = True
    return create_access_token(claims)

def token_revoked(payload: dict, user: dict) -> bool:
    """Un jeton émis avant le dernier changement de mot de passe (ou la suppression du compte) n'est plus valable ; hors
    mode test, aucun jeton d'un compte de démonstration ni aucun jeton émis pour une donnée de test (`tm`) n'est valable"""
    if user.get("deleted_at"):
        return True
    if (payload.get("tm") or is_demo_account(user)) and not test_mode_enabled():
        return True
    return (payload.get("pv") or "") != (user.get("password_changed_at") or "")

# Champs utilisateur jamais renvoyés par l'API (hash du mot de passe, codes, jetons)
USER_SAFE_PROJECTION = {"_id": 0, "password_hash": 0, "kyc_documents": 0}
# Informations minimales d'un utilisateur partagées avec une autre partie
USER_PUBLIC_PROJECTION = {"_id": 0, "id": 1, "email": 1, "company_name": 1, "first_name": 1, "last_name": 1,
                          "identity_verified": 1, "kyc_status": 1, "created_at": 1}

def is_user_verified(user: dict) -> bool:
    """Identité vérifiée (Stripe Identity ou admin). Une vérification simulée en mode test (`kyc_provider: 'test'`) ne
    vaut plus rien une fois le mode test désactivé : la vraie vérification est alors redemandée."""
    if user.get("kyc_provider") == "test" and not test_mode_enabled():
        return False
    return bool(user.get("identity_verified") or user.get("kyc_status") == "verified")

def is_email_verified(user: Optional[dict]) -> bool:
    """Adresse confirmée par le lien reçu (une confirmation simulée en mode test ne vaut qu'en mode test)"""
    if not user or (user.get("email_verified_via") == "test" and not test_mode_enabled()):
        return False
    return bool(user.get("email_verified"))

EMAIL_NOT_VERIFIED_DETAIL = ("Confirmez d'abord votre adresse e-mail : un lien vous a été envoyé à l'inscription "
                             "(vous pouvez le renvoyer depuis votre espace).")

def require_verified_email(user: dict):
    """Tant que l'e-mail n'est pas confirmé : navigation libre mais ni contact, ni alerte, ni code de signature, ni publication"""
    if user.get("role") == "admin":
        return
    if not is_email_verified(user):
        raise HTTPException(status_code=403, detail=EMAIL_NOT_VERIFIED_DETAIL)

async def identity_verified_effects(user_id: str) -> None:
    """Effets d'une identité devenue vérifiée (Stripe Identity, admin ou simulation du mode test) : les brouillons du
    vendeur sont soumis, les accès au dossier de l'acquéreur dont toutes les étapes sont faites sont ouverts."""
    await submit_drafts(user_id)
    async for access in db.dataroom_access.find({"buyer_id": user_id, "status": {"$in": list(DATAROOM_ACCEPTED_STATUSES)}}, {"_id": 0}):
        try:
            await grant_dataroom_access(access)
        except Exception as e:
            logging.error(f"Ouverture du dossier {access.get('id')} impossible : {e}")

async def store_verified_identity(user_id: str, session_id: str):
    """Marque l'utilisateur vérifié et enregistre nom/prénom certifiés par Stripe Identity"""
    update = {
        "identity_verified": True,
        "kyc_status": "verified",
        "kyc_provider": "stripe",
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "verification_session_id": session_id,
    }
    try:
        vs = stripe.identity.VerificationSession.retrieve(session_id, expand=["verified_outputs"])
        outputs = vs.get("verified_outputs") or {}
        if outputs.get("first_name"):
            update["first_name"] = outputs["first_name"]
            update["verified_first_name"] = outputs["first_name"]
        if outputs.get("last_name"):
            update["last_name"] = outputs["last_name"]
            update["verified_last_name"] = outputs["last_name"]
        # Date de naissance du rapport Stripe : reprise dans l'identité du signataire du NDA (buyer_identity_text)
        dob = outputs.get("dob") or {}
        if dob.get("year"):
            update["verified_birth_date"] = f"{int(dob['year']):04d}-{int(dob.get('month') or 1):02d}-{int(dob.get('day') or 1):02d}"
    except Exception as e:
        logging.warning(f"Impossible de récupérer l'identité vérifiée Stripe: {e}")
    await db.users.update_one({"id": user_id}, {"$set": update})
    await identity_verified_effects(user_id)

ALLOWED_DOCUMENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

async def read_upload(file: UploadFile, allowed_types: set, max_bytes: Optional[int] = None) -> bytes:
    max_bytes = max_bytes or max_upload_bytes()
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Format de fichier non accepté (PDF, JPEG, PNG uniquement)")
    content = await file.read()
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Fichier trop volumineux ({max_bytes // (1024 * 1024)} Mo maximum)")
    return content

# Make get_current_user optional for some routes
async def get_current_user_optional(authorization: Optional[str] = Header(None)):
    if not authorization:
        return None
    try:
        token = authorization.replace("Bearer ", "")
        payload = decode_token(token)
        user = await db.users.find_one({"email": payload.get("sub")}, USER_SAFE_PROJECTION)
        if not user or token_revoked(payload, user):
            return None
        return user
    except Exception:
        return None

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    payload = decode_token(token)
    user = await db.users.find_one({"email": payload.get("sub")}, USER_SAFE_PROJECTION)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if token_revoked(payload, user):
        raise HTTPException(status_code=401, detail="Session expirée : reconnectez-vous")
    return user

async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Dépendance réutilisable par les modules : utilisateur administrateur"""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return current_user

# ============ BLOCKCHAIN-LIKE AUDIT LOG ============
async def create_audit_log(
    action: str,
    property_id: str,
    actor_id: str,
    actor_email: str,
    target_id: Optional[str] = None,
    target_email: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None
):
    """
    Crée un enregistrement d'audit immuable avec hash cryptographique
    pour la traçabilité juridique des actions sur la Data Room.
    """
    # Récupérer le dernier hash pour créer la chaîne
    last_log = await db.audit_logs.find_one(
        {"property_id": property_id},
        sort=[("sequence", -1)]
    )
    previous_hash = last_log.get("current_hash", "GENESIS") if last_log else "GENESIS"
    sequence = (last_log.get("sequence", 0) + 1) if last_log else 1
    
    timestamp = datetime.now(timezone.utc).isoformat()
    
    # Créer les données à hasher
    data_to_hash = f"{previous_hash}|{action}|{property_id}|{actor_id}|{timestamp}|{sequence}"
    current_hash = hashlib.sha256(data_to_hash.encode()).hexdigest()
    
    audit_entry = {
        "id": str(uuid.uuid4()),
        "sequence": sequence,
        "property_id": property_id,
        "action": action,
        "actor_id": actor_id,
        "actor_email": actor_email,
        "target_id": target_id,
        "target_email": target_email,
        "details": details or {},
        "timestamp": timestamp,
        "previous_hash": previous_hash,
        "current_hash": current_hash,
        "data_hash": hashlib.sha256(str(details).encode()).hexdigest() if details else None
    }
    
    await db.audit_logs.insert_one(audit_entry)
    return audit_entry

# Models
class BuyerProfile(BaseModel):
    """Profil de projet de l'acquéreur (SPEC §4, API.md §1) : toutes les clés sont facultatives, le score dit ce qui manque"""
    project_type: Optional[Literal["particulier", "sci", "societe", "professionnel"]] = None
    budget_max: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    apport: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    financing: Optional[Literal["comptant", "emprunt", "mixte", "a-definir"]] = None
    zones: Optional[List[str]] = None
    property_types: Optional[List[str]] = None
    min_yield: Optional[float] = Field(None, ge=0, le=20)
    horizon: Optional[Literal["0-6", "6-12", "12+"]] = None
    siren: Optional[str] = Field(None, max_length=20)
    company_name: Optional[str] = Field(None, max_length=200)
    experience: Optional[str] = Field(None, max_length=600)

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: Literal["seller", "buyer"]  # le rôle admin ne peut jamais être choisi à l'inscription
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    buyer_profile: Optional[BuyerProfile] = None
    source: Optional[str] = Field(None, max_length=50)
    acquisition_source: Optional[str] = Field(None, max_length=50)

class ProfileUpdate(BaseModel):
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=30)
    company_name: Optional[str] = Field(None, max_length=200)
    buyer_profile: Optional[BuyerProfile] = None
    notifications_opt_out: Optional[bool] = None

# ---- Profil acquéreur et score de complétude (SPEC §4, API.md §1) ----
PROFILE_SCORE_WEIGHTS = (("project_type", 15), ("budget_max", 15), ("apport", 10), ("financing", 10), ("zones", 10),
                         ("property_types", 10), ("min_yield", 10), ("horizon", 10), ("phone", 10))
SCORE_CONTACT_MIN = 40       # contacter un vendeur, demander un dossier
SCORE_AUTO_ACCEPT_MIN = 50   # acceptation automatique d'une demande de dossier (option de l'annonce)
PHONE_DIGITS_RE = re.compile(r"\d")

def phone_is_valid(phone: Optional[str]) -> bool:
    """Format validé, sans OTP SMS : au moins 9 chiffres et seulement des caractères de numéro"""
    if not phone:
        return False
    text = str(phone).strip()
    return bool(re.fullmatch(r"\+?[\d\s().\-]{8,25}", text)) and len(PHONE_DIGITS_RE.findall(text)) >= 9

def _profile_key_filled(user: dict, key: str) -> bool:
    if key == "phone":
        return phone_is_valid(user.get("phone"))
    value = (user.get("buyer_profile") or {}).get(key)
    if isinstance(value, list):
        return len(value) > 0
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value > 0
    return bool(str(value or "").strip())

def buyer_profile_score(user: dict) -> int:
    """0-100 : project_type 15, budget_max 15, apport 10, financing 10, zones 10, property_types 10, min_yield 10,
    horizon 10, téléphone valide 10 (même barème que frontend/src/components/account/profileScore.js). `siren_verified`
    reste un badge, sans points."""
    score = sum(points for key, points in PROFILE_SCORE_WEIGHTS if _profile_key_filled(user, key))
    return max(0, min(100, score))

def profile_missing(user: dict) -> list:
    """Clés du profil qui ne rapportent pas encore de points (affichage « ce qui manque », `phone` inclus)"""
    return [key for key, _ in PROFILE_SCORE_WEIGHTS if not _profile_key_filled(user, key)]

async def normalize_buyer_profile(profile: Optional[BuyerProfile], previous: Optional[dict] = None) -> Optional[dict]:
    """Profil validé (zones = régions connues, types de biens du référentiel) ; le SIREN d'une société acquéreuse est
    vérifié par l'open data (`siren_verified`, jamais bloquant : indisponible → non vérifié, revérifiable plus tard)"""
    if profile is None:
        return previous
    data = profile.model_dump()
    if data.get("zones") is not None:
        zones = []
        for z in data["zones"]:
            name = (taxonomy.region_by_slug(z) or z.strip()) if isinstance(z, str) else None
            if name in taxonomy.REGIONS and name not in zones:
                zones.append(name)
        data["zones"] = zones[:20]
    if data.get("property_types") is not None:
        data["property_types"] = [t for t in dict.fromkeys(data["property_types"]) if taxonomy.property_type_by_id(t)]
    if data.get("min_yield") is not None:
        data["min_yield"] = round(float(data["min_yield"]), 2)
    for key in ("siren", "company_name", "experience"):
        if data.get(key) is not None:
            data[key] = str(data[key]).strip() or None
    if data.get("experience"):
        # Présentée au vendeur avant l'engagement de confidentialité (carte acquéreur) : coordonnées masquées
        data["experience"] = mask_contacts(data["experience"])[0]
    siren = (opendata.split_identifier(data.get("siren"))[0] or None) if data.get("siren") else None
    data["siren"] = siren
    data["siren_verified"] = False
    data["siren_check"] = None
    if siren:
        if previous and previous.get("siren") == siren and previous.get("siren_verified"):
            data["siren_verified"] = True
            data["siren_check"] = previous.get("siren_check")
            data["company_name"] = data.get("company_name") or previous.get("company_name")
        else:
            try:
                info = await opendata.lookup_siren(siren)
            except Exception as e:  # jamais bloquant
                logging.warning(f"Open data indisponible pour le SIREN de l'acquéreur: {e}")
                info = {"available": False, "found": False}
            if info.get("available") and info.get("found"):
                data["siren_verified"] = bool(info.get("siren_active", True))
                data["siren_check"] = {"status": "verified" if data["siren_verified"] else "inactive",
                                       "nom_complet": info.get("nom_complet"), "checked_at": datetime.now(timezone.utc).isoformat()}
                data["company_name"] = data.get("company_name") or info.get("nom_complet")
            elif info.get("available"):
                data["siren_check"] = {"status": "not_found", "checked_at": datetime.now(timezone.utc).isoformat()}
            else:
                data["siren_check"] = {"status": "deferred", "checked_at": datetime.now(timezone.utc).isoformat()}
    return data

def with_profile_score(user: dict) -> dict:
    """Vue d'un compte avec `profile_score` et `profile_missing` (acquéreur). Une adresse ou une identité simulée en mode
    test apparaît non vérifiée une fois le mode test désactivé."""
    user = public_user(user)
    if user.get("email_verified") and not is_email_verified(user):
        user["email_verified"] = False
    if user.get("kyc_provider") == "test" and not is_user_verified(user):
        user["identity_verified"] = False
        user["kyc_status"] = "pending"
    if user.get("role") == "buyer":
        user["buyer_profile"] = user.get("buyer_profile") or {}
        user["profile_score"] = buyer_profile_score(user)
        user["profile_missing"] = profile_missing(user)
    return user

def login_email(value: Any) -> str:
    """Adresse de connexion : format e-mail vérifié, sauf pour les comptes de démonstration du mode test
    (`…@test.local`, domaine réservé refusé par la validation standard et donc impossible à l'inscription)."""
    text = str(value or "").strip()
    if is_demo_email(text) and re.fullmatch(r"[a-z0-9._+\-]+@" + re.escape(DEMO_EMAIL_DOMAIN), text.lower()):
        return text.lower()
    from pydantic import TypeAdapter
    return TypeAdapter(EmailStr).validate_python(text)

class UserLogin(BaseModel):
    email: str = Field(..., max_length=254)
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, value):
        return login_email(value)

# ---- Le bien loué (SPEC §3) : champs saisis par le vendeur, tous facultatifs au brouillon ----
class PropertyCreate(BaseModel):
    """Brouillon créé dès l'écran 1 de CreateListing (SPEC §5.2) : tout est facultatif, les écrans suivants complètent
    par `PUT /properties/{id}` ; l'annonce est soumise (mandat, contrôles, publication) une fois le prix renseigné.
    Les identifiants inconnus, les montants négatifs et les textes hors limites sont refusés en 400 `validation`."""
    # Le bien
    property_type: Optional[str] = Field(None, max_length=40)
    owner_type: Optional[str] = Field(None, max_length=40)
    company_name: Optional[str] = Field(None, max_length=200)
    siret: Optional[str] = Field(None, max_length=20)
    address: Optional[str] = Field(None, max_length=300)
    postal_code: Optional[str] = Field(None, max_length=10)
    city: Optional[str] = Field(None, max_length=120)
    department: Optional[str] = Field(None, max_length=60)
    district: Optional[str] = Field(None, max_length=120)
    surface: Optional[float] = None
    rooms: Optional[int] = None
    floor: Optional[int] = None
    elevator: Optional[bool] = None
    construction_year: Optional[int] = None
    units_count: Optional[int] = None
    units_rented: Optional[int] = None
    is_copro: Optional[bool] = None
    copro_lots: Optional[int] = None
    copro_charges_annual: Optional[float] = None
    copro_procedure: Optional[bool] = None
    dpe_class: Optional[str] = Field(None, max_length=20)
    ges_class: Optional[str] = Field(None, max_length=20)
    energy_cost_min: Optional[float] = None
    energy_cost_max: Optional[float] = None
    dpe_date: Optional[str] = Field(None, max_length=10)
    equipment: Optional[str] = Field(None, max_length=600)
    recent_works: Optional[str] = Field(None, max_length=1000)
    description: Optional[str] = Field(None, max_length=3000)
    # La location
    lease_type: Optional[str] = Field(None, max_length=40)
    rent_monthly: Optional[float] = None
    charges_monthly: Optional[float] = None
    lease_start: Optional[str] = Field(None, max_length=10)
    lease_end: Optional[str] = Field(None, max_length=10)
    tenant_since: Optional[str] = Field(None, max_length=10)
    deposit: Optional[float] = None
    indexation: Optional[str] = Field(None, max_length=20)
    last_revision: Optional[str] = Field(None, max_length=10)
    tenant_payment_status: Optional[str] = Field(None, max_length=20)
    has_gli: Optional[bool] = None
    has_guarantor: Optional[bool] = None
    property_tax: Optional[float] = None
    non_recoverable_charges: Optional[float] = None
    management: Optional[str] = Field(None, max_length=20)
    operator_lease_end: Optional[str] = Field(None, max_length=10)
    # La vente
    asking_price: Optional[float] = None
    sale_object: Optional[str] = Field(None, max_length=20)
    sale_reason: Optional[str] = Field(None, max_length=20)
    availability_note: Optional[str] = Field(None, max_length=300)
    auto_accept_dataroom: Optional[bool] = None

INDEXATION_IDS = ("irl", "ilc", "ilat", "aucune")
MANAGEMENT_IDS = ("direct", "agence", "exploitant")
MANDANT_CAPACITY_IDS = ("proprietaire", "coindivisaire", "gerant", "mandataire")
GES_CLASS_IDS = ("A", "B", "C", "D", "E", "F", "G")
COMPANY_OWNER_TYPES = ("sci", "societe")
LISTING_ENUM_FIELDS = {
    "property_type": (taxonomy.PROPERTY_TYPE_IDS, "Type de bien inconnu"),
    "owner_type": (taxonomy.OWNER_TYPE_IDS, "Type de propriétaire inconnu"),
    "lease_type": (taxonomy.LEASE_TYPE_IDS, "Type de bail inconnu"),
    "dpe_class": (taxonomy.DPE_CLASS_IDS, "Classe DPE inconnue"),
    "ges_class": (GES_CLASS_IDS, "Classe GES inconnue (A à G)"),
    "tenant_payment_status": (taxonomy.TENANT_PAYMENT_STATUS_IDS, "Situation du locataire inconnue"),
    "sale_object": (taxonomy.SALE_OBJECT_IDS, "Objet de la vente inconnu"),
    "sale_reason": (taxonomy.SALE_REASON_IDS, "Motif de vente inconnu"),
    "indexation": (INDEXATION_IDS, "Indice de révision inconnu (irl, ilc, ilat ou aucune)"),
    "management": (MANAGEMENT_IDS, "Mode de gestion inconnu (direct, agence ou exploitant)"),
    "mandant_capacity": (MANDANT_CAPACITY_IDS, "Qualité du signataire inconnue"),
}
LISTING_AMOUNT_FIELDS = ("surface", "copro_charges_annual", "energy_cost_min", "energy_cost_max", "rent_monthly",
                         "charges_monthly", "deposit", "property_tax", "non_recoverable_charges", "asking_price")
LISTING_COUNT_FIELDS = ("rooms", "units_count", "units_rented", "copro_lots")
LISTING_DATE_FIELDS = ("dpe_date", "lease_start", "lease_end", "tenant_since", "last_revision", "operator_lease_end")
# Textes libres publiés sur l'annonce : téléphones et e-mails masqués (contrôle anti-coordonnées)
LISTING_FREE_TEXT_FIELDS = ("description", "equipment", "recent_works", "availability_note", "district")
FIELD_LABELS_FR = {"surface": "la surface", "copro_charges_annual": "les charges de copropriété", "energy_cost_min": "le coût énergétique",
                   "energy_cost_max": "le coût énergétique", "rent_monthly": "le loyer", "charges_monthly": "les charges",
                   "deposit": "le dépôt de garantie", "property_tax": "la taxe foncière",
                   "non_recoverable_charges": "les charges non récupérables", "asking_price": "le prix",
                   "rooms": "le nombre de pièces", "units_count": "le nombre de lots", "units_rented": "le nombre de lots loués",
                   "copro_lots": "le nombre de lots de la copropriété"}

def _validation(message: str, field: str) -> HTTPException:
    return api_error(400, "validation", message, field=field)

def validate_listing_fields(data: dict, current: Optional[dict] = None) -> dict:
    """Validation des champs envoyés (référentiels de taxonomy, montants, dates, textes) : 400 `validation` en français.
    `current` : annonce existante (mise à jour), pour les contrôles croisés (parts ↔ société)."""
    out = {k: v for k, v in dict(data).items()}
    for key, (allowed, message) in LISTING_ENUM_FIELDS.items():
        value = out.get(key)
        if value is None or value == "":
            if key in out and value == "":
                out[key] = None
            continue
        value = str(value).strip()
        if key in ("dpe_class", "ges_class") and value.upper() in GES_CLASS_IDS:
            value = value.upper()
        if value not in allowed:
            raise _validation(message, key)
        out[key] = value
    for key in LISTING_AMOUNT_FIELDS + LISTING_COUNT_FIELDS:
        value = out.get(key)
        if value is not None and value < 0:
            raise _validation(f"Montant ou nombre négatif refusé : {FIELD_LABELS_FR.get(key, key)}", key)
    if out.get("floor") is not None and not (-5 <= out["floor"] <= 200):
        raise _validation("Étage invalide", "floor")
    if out.get("construction_year") is not None and not (1000 <= out["construction_year"] <= datetime.now(timezone.utc).year + 5):
        raise _validation("Année de construction invalide", "construction_year")
    for key in LISTING_DATE_FIELDS:
        value = out.get(key)
        if value is None or value == "":
            if value == "":
                out[key] = None
            continue
        try:
            out[key] = datetime.strptime(str(value)[:10], "%Y-%m-%d").date().isoformat()
        except ValueError:
            raise _validation("Date invalide (format AAAA-MM-JJ)", key)
    merged = {**(current or {}), **{k: v for k, v in out.items() if v is not None}}
    if merged.get("units_count") is not None and merged.get("units_rented") is not None and merged["units_rented"] > merged["units_count"]:
        raise _validation("Le nombre de lots loués dépasse le nombre de lots", "units_rented")
    if merged.get("energy_cost_min") is not None and merged.get("energy_cost_max") is not None \
            and merged["energy_cost_min"] > merged["energy_cost_max"]:
        raise _validation("Le coût énergétique minimum dépasse le maximum", "energy_cost_min")
    if out.get("sale_object") == "parts" or (out.get("owner_type") and merged.get("sale_object") == "parts"):
        if merged.get("owner_type") not in COMPANY_OWNER_TYPES:
            raise _validation("La cession des parts n'est possible que pour un bien détenu par une SCI ou une société", "sale_object")
    if out.get("siret"):
        siret = re.sub(r"\D", "", str(out["siret"]))
        if len(siret) != 14:
            raise _validation("SIRET invalide (14 chiffres attendus)", "siret")
        out["siret"] = siret
    if out.get("postal_code"):
        cp = re.sub(r"\s", "", str(out["postal_code"]))
        if not re.fullmatch(r"\d{5}", cp) or not taxonomy.departement_from_postal_code(cp):
            raise _validation("Code postal invalide (5 chiffres)", "postal_code")
        out["postal_code"] = cp
        out["department"] = taxonomy.departement_from_postal_code(cp)
    elif out.get("department"):
        code = taxonomy.normalize_departement(out["department"])
        if not code:
            # Nom de département (« Rhône », « rhone ») toléré
            wanted = taxonomy.slugify(out["department"])
            code = next((c for c, name in taxonomy.DEPARTEMENTS.items() if taxonomy.slugify(name) == wanted), "")
        if not code:
            raise _validation("Département inconnu", "department")
        out["department"] = code
    for key in ("company_name", "address", "city", "district", "equipment", "recent_works", "availability_note"):
        if isinstance(out.get(key), str):
            out[key] = out[key].strip() or None
    for key in LISTING_FREE_TEXT_FIELDS:
        if isinstance(out.get(key), str):
            out[key] = mask_contacts(out[key])[0]
    if out.get("description") is not None:
        text = out["description"].strip()
        if text and not (200 <= len(text) <= 1500):
            raise _validation("La description doit faire entre 200 et 1 500 caractères", "description")
        out["description"] = text or None
    return out

def computed_property_fields(doc: dict) -> dict:
    """Champs calculés par le serveur à chaque écriture (SPEC §3.4) : titre, rendements, décence énergétique, région"""
    department = doc.get("department") or taxonomy.departement_from_postal_code(doc.get("postal_code"))
    fields = {
        "department": department or None,
        "region": taxonomy.region_for_departement(department) or doc.get("region") or None,
        "title": taxonomy.property_title(doc.get("property_type"), doc.get("city"), department, doc.get("surface"),
                                         doc.get("rooms"), doc.get("units_count")) if doc.get("property_type") else (doc.get("title") or None),
        "gross_yield": taxonomy.gross_yield(doc.get("rent_monthly"), doc.get("asking_price")),
        "net_yield": taxonomy.net_yield(doc.get("rent_monthly"), doc.get("asking_price"), doc.get("property_tax"),
                                        doc.get("non_recoverable_charges")),
        "dpe_rental": taxonomy.dpe_rental_status(doc.get("dpe_class"), doc.get("lease_type")),
    }
    ownership = doc.get("ownership") or {}
    fields["ownership"] = {"status": "missing", **ownership} if not ownership.get("status") else ownership
    return fields

class MessageCreate(BaseModel):
    conversation_id: Optional[str] = None
    content: str = Field(..., max_length=5000)
    # Forme historique : destinataire + annonce (la conversation du couple est retrouvée ou créée)
    receiver_id: Optional[str] = None
    property_id: Optional[str] = None

class PropertySearch(BaseModel):
    property_types: Optional[Union[List[str], str]] = None
    lease_types: Optional[Union[List[str], str]] = None
    region: Optional[str] = None
    department: Optional[str] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    min_yield: Optional[float] = None
    min_surface: Optional[float] = None
    sort: Optional[str] = None
    limit: Optional[int] = None
    page: Optional[int] = None

# ============ STRIPE IDENTITY KYC VERIFICATION ============
KYC_BUYER_STATUSES = ("accepted", "granted")

async def identity_needed_now(user: dict) -> bool:
    """Stripe Identity est facturé à l'usage (SPEC §0.2, §0.6) : la vérification n'est ouverte qu'au moment où elle est
    exigée. Vendeur : dès qu'il a une annonce (brouillon compris), pour signer le mandat. Acquéreur : quand une demande de
    dossier a été acceptée par le vendeur (identité exigée à l'engagement de confidentialité)."""
    role = user.get("role")
    if role == "seller":
        return bool(await db.properties.find_one({"seller_id": user["id"], "status": {"$nin": ["sold", "sold_elsewhere", "removed"]}},
                                                 {"_id": 0, "id": 1}))
    if role == "buyer":
        return bool(await db.dataroom_access.find_one({"buyer_id": user["id"], "status": {"$in": list(KYC_BUYER_STATUSES)}},
                                                      {"_id": 0, "id": 1}))
    return False

@api_router.post("/kyc/create-verification-session")
@limiter.limit("3/hour")
async def create_verification_session(request: Request, current_user: dict = Depends(get_current_user)):
    """
    Crée une session de vérification d'identité Stripe Identity (facturée à l'usage).
    409 `already_verified` si l'identité est déjà vérifiée ; 403 `identity_not_needed_yet` hors des étapes qui l'exigent
    (vendeur : mandat ; acquéreur : engagement de confidentialité, après acceptation d'une demande de dossier). 3 sessions par
    heure et par adresse IP.
    """
    if is_user_verified(current_user):
        raise api_error(409, "already_verified", "Votre identité est déjà vérifiée")
    if not await identity_needed_now(current_user):
        raise api_error(403, "identity_not_needed_yet",
                        "La vérification d'identité est demandée à la signature du mandat (vendeur) ou de l'engagement de "
                        "confidentialité (acquéreur, après acceptation de votre demande de dossier)")
    try:
        # Vérifier si une session active existe déjà
        existing_session = await db.kyc_sessions.find_one({
            "user_id": current_user["id"],
            "status": {"$in": ["requires_input", "processing"]}
        }, sort=[("created_at", -1)])
        
        if existing_session:
            # Vérifier si la session n'a pas expiré (48h)
            created_at = datetime.fromisoformat(existing_session["created_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - created_at < timedelta(hours=48):
                return {
                    "session_id": existing_session["verification_session_id"],
                    "url": existing_session.get("url"),
                    "status": existing_session["status"],
                    "message": "Session de vérification existante"
                }
        
        # Créer une nouvelle session Stripe Identity
        verification_session = stripe.identity.VerificationSession.create(
            type="document",
            provided_details={
                "email": current_user.get("email"),
            },
            metadata={
                "user_id": current_user["id"],
                "user_email": current_user.get("email"),
                "user_role": current_user.get("role"),
            },
            options={
                "document": {
                    "allowed_types": ["driving_license", "passport", "id_card"],
                    "require_matching_selfie": True,
                }
            },
            return_url=site_url("/kyc/callback")
        )
        
        # Sauvegarder la session dans MongoDB
        session_record = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "verification_session_id": verification_session.id,
            "url": verification_session.url,
            "status": verification_session.status,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.kyc_sessions.insert_one(session_record)
        
        return {
            "session_id": verification_session.id,
            "url": verification_session.url,
            "status": verification_session.status
        }
        
    except stripe.StripeError as e:
        raise HTTPException(status_code=400, detail=f"Erreur Stripe: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la création de la session: {str(e)}")

@api_router.get("/kyc/status")
async def get_kyc_status(current_user: dict = Depends(get_current_user)):
    """
    Récupère le statut de vérification KYC de l'utilisateur
    """
    try:
        # Vérifier si l'utilisateur est déjà vérifié (une identité simulée ne vaut qu'en mode test)
        if is_user_verified(current_user):
            return {
                "verified": True,
                "status": "verified",
                "provider": current_user.get("kyc_provider"),
                "verified_at": current_user.get("kyc_verified_at") or current_user.get("verified_at")
            }
        
        # Récupérer la dernière session de vérification
        session_record = await db.kyc_sessions.find_one(
            {"user_id": current_user["id"]},
            sort=[("created_at", -1)]
        )
        
        if not session_record:
            return {
                "verified": False,
                "status": "not_started",
                "message": "Aucune vérification d'identité initiée"
            }
        
        # Récupérer le statut depuis Stripe
        try:
            verification_session = stripe.identity.VerificationSession.retrieve(
                session_record["verification_session_id"]
            )
            
            # Mettre à jour le statut en base
            await db.kyc_sessions.update_one(
                {"verification_session_id": session_record["verification_session_id"]},
                {"$set": {"status": verification_session.status}}
            )
            
            # Si vérifié, mettre à jour l'utilisateur
            if verification_session.status == "verified":
                await store_verified_identity(current_user["id"], verification_session.id)
                return {
                    "verified": True,
                    "status": "verified",
                    "message": "Identité vérifiée avec succès"
                }
            
            return {
                "verified": False,
                "status": verification_session.status,
                "session_id": verification_session.id,
                "url": session_record.get("url")
            }
            
        except stripe.StripeError:
            return {
                "verified": False,
                "status": session_record.get("status", "unknown"),
                "message": "Impossible de récupérer le statut depuis Stripe"
            }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

@api_router.post("/kyc/webhook")
async def handle_kyc_webhook(request: Request):
    """
    Webhook pour recevoir les événements Stripe Identity
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    # Secret propre au webhook Identity (Stripe donne un secret par endpoint)
    webhook_secret = os.environ.get("STRIPE_IDENTITY_WEBHOOK_SECRET") or os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not webhook_secret:
        # Sans signature vérifiable, n'importe qui pourrait se déclarer « vérifié »
        raise HTTPException(status_code=503, detail="Webhook non configuré")
    
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    # Traiter les événements de vérification d'identité
    if event["type"] == "identity.verification_session.verified":
        session = event["data"]["object"]
        user_id = session.get("metadata", {}).get("user_id")
        
        if user_id:
            await store_verified_identity(user_id, session["id"])
            
            await db.kyc_sessions.update_one(
                {"verification_session_id": session["id"]},
                {
                    "$set": {
                        "status": "verified",
                        "completed_at": datetime.now(timezone.utc).isoformat()
                    }
                }
            )
    
    elif event["type"] == "identity.verification_session.requires_input":
        session = event["data"]["object"]
        await db.kyc_sessions.update_one(
            {"verification_session_id": session["id"]},
            {
                "$set": {
                    "status": "requires_input",
                    "last_error": session.get("last_error")
                }
            }
        )
    
    return {"received": True}

@api_router.get("/kyc/check-required")
async def check_kyc_required(action: str, current_user: dict = Depends(get_current_user)):
    """
    Vérifie si la vérification KYC est requise pour une action donnée
    action: 'publish_listing' ou 'contact_seller'
    """
    is_verified = is_user_verified(current_user)
    
    if action == "publish_listing" and current_user.get("role") == "seller":
        return {
            "required": True,
            "verified": is_verified,
            "can_proceed": is_verified,
            "message": "La vérification d'identité est obligatoire pour publier une annonce" if not is_verified else "Vous pouvez publier votre annonce"
        }
    
    if action == "contact_seller" and current_user.get("role") == "buyer":
        return {
            "required": True,
            "verified": is_verified,
            "can_proceed": is_verified,
            "message": "La vérification d'identité est obligatoire pour contacter un vendeur" if not is_verified else "Vous pouvez contacter le vendeur"
        }
    
    return {
        "required": False,
        "verified": is_verified,
        "can_proceed": True
    }

# ============ AUTH ROUTES ============
EMAIL_VERIFICATION_TTL = timedelta(hours=48)
EMAIL_VERIFICATION_RESEND_SECONDS = 60
LOGIN_OTP_TTL_SECONDS = 600
LOGIN_OTP_MAX_ATTEMPTS = 5

async def send_verification_email(user: dict, background_tasks: Optional[BackgroundTasks] = None) -> dict:
    """Crée un lien de confirmation (48 h, usage unique) et envoie l'e-mail « Confirmez votre adresse »"""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await db.email_verifications.update_many({"user_id": user["id"], "used": False}, {"$set": {"used": True, "superseded": True}})
    await db.email_verifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": user["id"], "email": user["email"],
        "token_hash": hashlib.sha256(token.encode()).hexdigest(), "used": False,
        "created_at": now.isoformat(), "expires_at": (now + EMAIL_VERIFICATION_TTL).isoformat(),
        "expire_at": now + timedelta(days=7),
    })
    link = site_url(f"/confirmer-email/{token}")
    subject, html = render_email("verify_email", name=display_name(user) or user["email"], link=link)
    if background_tasks is not None:
        background_tasks.add_task(send_brevo_email, user["email"], display_name(user), subject, html)
    else:
        await send_brevo_email(user["email"], display_name(user), subject, html)
    result = {"sent": True, "expires_in": int(EMAIL_VERIFICATION_TTL.total_seconds())}
    if test_mode_enabled():
        result["test_link"] = link  # mode test : lien de confirmation renvoyé en clair (jamais hors mode test)
    return result

@api_router.post("/auth/register")
@limiter.limit("5/minute")
async def register(request: Request, user: UserRegister, background_tasks: BackgroundTasks):
    email = user.email.strip().lower()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Un compte existe déjà avec cet email")

    phone = (user.phone or "").strip() or None
    if phone and not phone_is_valid(phone):
        raise api_error(400, "validation", "Numéro de téléphone invalide : indiquez un numéro à 10 chiffres (format français)", field="phone")
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "email_verified": False,
        "password_hash": await hash_password_async(user.password),
        "role": user.role,
        "first_name": (user.first_name or "").strip() or None,
        "last_name": (user.last_name or "").strip() or None,
        "company_name": (user.company_name or "").strip() or None,
        "phone": phone,
        "kyc_status": "pending",
        "notifications_opt_out": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_activity_at": datetime.now(timezone.utc).isoformat(),
        "score": 0,
        "acquisition_source": (user.source or user.acquisition_source or "").strip() or None
    }
    mark_test(user_doc)  # compte créé pendant le mode test : supprimé par la purge des données de test
    if user.role == "buyer":
        # Profil de projet en un seul écran (facultatif à l'inscription, complétable depuis le profil)
        user_doc["buyer_profile"] = await normalize_buyer_profile(user.buyer_profile) or {}
        if user_doc["buyer_profile"].get("company_name") and not user_doc["company_name"]:
            user_doc["company_name"] = user_doc["buyer_profile"]["company_name"]
        user_doc["profile_score"] = buyer_profile_score(user_doc)
    await db.users.insert_one(user_doc)
    token = issue_token(user_doc)
    user_response = with_profile_score(user_doc)
    # Double opt-in : un seul e-mail à l'inscription, celui qui confirme l'adresse
    await send_verification_email(user_doc, background_tasks)
    return {"token": token, "user": user_response, "email_verification_required": True}

class EmailVerification(BaseModel):
    token: str = Field(min_length=10, max_length=200)

@api_router.post("/auth/verify-email")
async def verify_email(data: EmailVerification):
    """Confirme l'adresse e-mail à partir du lien reçu (lien /confirmer-email/:token côté front)"""
    token_hash = hashlib.sha256(data.token.strip().encode()).hexdigest()
    record = await db.email_verifications.find_one({"token_hash": token_hash}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=400, detail="Lien de confirmation invalide : demandez un nouvel e-mail de confirmation")
    user = await db.users.find_one({"id": record["user_id"]}, USER_SAFE_PROJECTION)
    if not user or user.get("deleted_at"):
        raise HTTPException(status_code=400, detail="Lien de confirmation invalide")
    if is_email_verified(user):
        return {"verified": True, "already_verified": True, "email": user["email"]}
    expired = (_parse_dt(record.get("expires_at")) or datetime.min.replace(tzinfo=timezone.utc)) < datetime.now(timezone.utc)
    if record.get("used") or expired:
        raise HTTPException(status_code=400, detail="Lien de confirmation expiré : demandez un nouvel e-mail de confirmation")
    now = datetime.now(timezone.utc).isoformat()
    await db.email_verifications.update_one({"token_hash": token_hash}, {"$set": {"used": True, "verified_at": now}})
    # Une vraie confirmation remplace une confirmation simulée pendant le mode test
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True, "email_verified_at": now},
                                                   "$unset": {"email_verified_via": ""}})
    return {"verified": True, "email": user["email"], "role": user.get("role")}

@api_router.post("/auth/resend-verification")
@limiter.limit("5/minute")
async def resend_verification(request: Request, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Renvoie l'e-mail de confirmation (au plus une fois par minute)"""
    if is_email_verified(current_user):
        return {"sent": False, "already_verified": True}
    last = await db.email_verifications.find_one({"user_id": current_user["id"]}, sort=[("created_at", -1)])
    if last and (datetime.now(timezone.utc) - (_parse_dt(last.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc))).total_seconds() < EMAIL_VERIFICATION_RESEND_SECONDS:
        raise HTTPException(status_code=429, detail="Un e-mail de confirmation vient d'être envoyé. Patientez une minute avant d'en demander un nouveau.")
    return await send_verification_email(current_user, background_tasks)

def public_user(user: dict) -> dict:
    user = dict(user)
    for k in ("_id", "password_hash", "kyc_documents"):
        user.pop(k, None)
    return user

async def find_user_by_email(email: str) -> Optional[dict]:
    user = await db.users.find_one({"email": email})
    if not user:
        # Comptes historiques enregistrés avec des majuscules
        user = await db.users.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
    return user

@api_router.post("/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, credentials: UserLogin, background_tasks: BackgroundTasks):
    email = credentials.email.strip().lower()
    user = await find_user_by_email(email)
    if not user or user.get("deleted_at") or not await verify_password_async(credentials.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    if is_demo_email(user.get("email")) and not test_mode_enabled():
        raise HTTPException(status_code=403, detail="Compte de démonstration : disponible uniquement quand le mode test est actif")
    if is_demo_account(user) and user.get("role") == "admin" and not test_panel_access(request, admin=True):
        # Le mot de passe des comptes de démonstration est public (panneau de test) : l'admin démo exige la clé du panneau
        raise HTTPException(status_code=403, detail="Admin démo réservé : ouvrez l'application avec le lien du panneau de test (?cle=…)")

    if user.get("role") == "admin":
        # Second facteur : code à usage unique envoyé par e-mail, puis POST /auth/login/verify
        now = datetime.now(timezone.utc)
        last = await db.login_otps.find_one({"user_id": user["id"], "used": False}, sort=[("created_at", -1)])
        # Mode test : un nouveau code est toujours émis pour pouvoir le renvoyer en clair (`test_code`)
        if not test_mode_enabled() and last and (now - (_parse_dt(last.get("created_at")) or now)).total_seconds() < OTP_RESEND_SECONDS:
            return {"otp_required": True, "email": user["email"], "expires_in": LOGIN_OTP_TTL_SECONDS, "resent": False}
        code = f"{secrets.randbelow(1_000_000):06d}"
        await db.login_otps.update_many({"user_id": user["id"], "used": False}, {"$set": {"used": True, "superseded": True}})
        await db.login_otps.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"], "code_hash": otp_hash(code, f"login:{user['id']}"),
            "attempts": 0, "used": False, "ip": client_ip(request), "created_at": now.isoformat(),
            "expires_at": (now + timedelta(seconds=LOGIN_OTP_TTL_SECONDS)).isoformat(),
            "expire_at": now + timedelta(days=1),
        })
        subject, html = render_email("admin_otp", code=code)  # le code n'apparaît jamais dans l'objet
        background_tasks.add_task(send_brevo_email, user["email"], display_name(user), subject, html)
        result = {"otp_required": True, "email": user["email"], "expires_in": LOGIN_OTP_TTL_SECONDS, "resent": True}
        if test_mode_enabled() and test_panel_access(request):
            result["test_code"] = code
        return result

    await db.users.update_one({"id": user["id"]}, {"$set": {"last_activity_at": datetime.now(timezone.utc).isoformat()}})
    return {"token": issue_token(user), "user": with_profile_score(user)}

class LoginVerify(BaseModel):
    email: str = Field(..., max_length=254)
    code: str = Field(min_length=4, max_length=12)

    @field_validator("email")
    @classmethod
    def _email(cls, value):
        return login_email(value)

@api_router.post("/auth/login/verify")
@limiter.limit("5/minute")
async def login_verify(request: Request, data: LoginVerify):
    """Deuxième étape de la connexion administrateur : vérification du code reçu par e-mail"""
    email = data.email.strip().lower()
    user = await find_user_by_email(email)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=401, detail="Code invalide ou expiré")
    otp = await db.login_otps.find_one({"user_id": user["id"], "used": False}, sort=[("created_at", -1)])
    if not otp or (_parse_dt(otp.get("expires_at")) or datetime.min.replace(tzinfo=timezone.utc)) < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Code invalide ou expiré : reconnectez-vous pour recevoir un nouveau code")
    if otp.get("attempts", 0) >= LOGIN_OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Trop d'essais : reconnectez-vous pour recevoir un nouveau code")
    import hmac
    if not hmac.compare_digest(otp["code_hash"], otp_hash(data.code.strip(), f"login:{user['id']}")):
        await db.login_otps.update_one({"id": otp["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="Code invalide ou expiré")
    consumed = await db.login_otps.update_one({"id": otp["id"], "used": False},
                                              {"$set": {"used": True, "verified_at": datetime.now(timezone.utc).isoformat()}})
    if consumed.modified_count == 0:
        raise HTTPException(status_code=401, detail="Code déjà utilisé")
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_activity_at": datetime.now(timezone.utc).isoformat()}})
    return {"token": issue_token(user), "user": with_profile_score(user)}

class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)

class ForgotPassword(BaseModel):
    email: EmailStr

class ResetPassword(BaseModel):
    token: str
    new_password: str = Field(min_length=8)

@api_router.post("/auth/change-password")
async def change_password(data: PasswordChange, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["id"]})
    if not user or not await verify_password_async(data.current_password, user.get("password_hash")):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect")
    now = datetime.now(timezone.utc)
    await db.users.update_one({"id": current_user["id"]},
                              {"$set": {"password_hash": await hash_password_async(data.new_password), "password_changed_at": now.isoformat()}})
    # Les anciens jetons sont révoqués : on en renvoie un nouveau pour la session courante
    return {"message": "Mot de passe modifié", "token": issue_token({**user, "password_changed_at": now.isoformat()})}

@api_router.post("/auth/forgot-password")
@limiter.limit("5/minute")
async def forgot_password(request: Request, data: ForgotPassword, background_tasks: BackgroundTasks):
    """Envoie un lien de réinitialisation valable 1 heure (réponse identique que le compte existe ou non)"""
    email = data.email.strip().lower()
    user = await db.users.find_one({"email": email, "deleted_at": {"$exists": False}}, {"_id": 0, "id": 1, "email": 1})
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_resets.insert_one({
            "token_hash": hashlib.sha256(token.encode()).hexdigest(),
            "user_id": user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "expire_at": datetime.now(timezone.utc) + timedelta(days=1),
            "used": False
        })
        link = site_url(f"/reset-password?token={token}")
        # Envoi en arrière-plan : la réponse ne dépend pas de la latence de Brevo (et ne révèle pas l'existence du compte)
        background_tasks.add_task(
            send_brevo_email,
            email, "", f"Réinitialisation de votre mot de passe {site_name()}",
            f"""
            <h2>Réinitialisation du mot de passe</h2>
            <p>Pour choisir un nouveau mot de passe, cliquez sur le lien ci-dessous (valable 1 heure) :</p>
            <p><a href="{link}">{link}</a></p>
            <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>
            """
        )
    return {"message": "Si un compte existe pour cet email, un lien de réinitialisation a été envoyé."}

@api_router.post("/auth/reset-password")
async def reset_password(data: ResetPassword):
    token_hash = hashlib.sha256(data.token.encode()).hexdigest()
    reset = await db.password_resets.find_one({"token_hash": token_hash, "used": False})
    if not reset or datetime.fromisoformat(reset["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Lien invalide ou expiré")
    await db.users.update_one({"id": reset["user_id"]}, {"$set": {
        "password_hash": await hash_password_async(data.new_password),
        "password_changed_at": datetime.now(timezone.utc).isoformat()}})
    await db.password_resets.update_one({"token_hash": token_hash}, {"$set": {"used": True}})
    return {"message": "Mot de passe réinitialisé"}

@api_router.get("/auth/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    return with_profile_score(current_user)

@api_router.put("/auth/profile")
async def update_profile(data: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    """Coordonnées, profil de projet (acquéreur, score recalculé) et préférence de notifications"""
    update = {}
    for key in ("first_name", "last_name", "company_name"):
        value = getattr(data, key)
        if value is not None:
            update[key] = value.strip() or None
    if data.phone is not None:
        phone = data.phone.strip() or None
        if phone and not phone_is_valid(phone):
            raise api_error(400, "validation", "Numéro de téléphone invalide : indiquez un numéro à 10 chiffres (format français)", field="phone")
        update["phone"] = phone
    if data.notifications_opt_out is not None:
        update["notifications_opt_out"] = bool(data.notifications_opt_out)
    if data.buyer_profile is not None and current_user.get("role") == "buyer":
        update["buyer_profile"] = await normalize_buyer_profile(data.buyer_profile, current_user.get("buyer_profile"))
    merged = {**current_user, **update}
    if merged.get("role") == "buyer":
        update["profile_score"] = buyer_profile_score(merged)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": current_user["id"]}, {"$set": update})
    user = await db.users.find_one({"id": current_user["id"]}, USER_SAFE_PROJECTION)
    return {"user": with_profile_score(user)}

class AccountDeletion(BaseModel):
    password: str

IDENTITY_REPORT_FIELDS = ("stripe_identity_report", "verified_birth_date", "verified_first_name", "verified_last_name",
                          "verification_session_id")

async def anonymize_user(user: dict, now: str, reason: str = "compte supprimé", keep_identity_report: bool = False) -> str:
    """Anonymise un compte (suppression demandée ou inactivité de 3 ans) : données personnelles retirées ;
    mandats, factures et preuves de signature conservés (obligations légales) avec le même user_id ; annonces retirées.
    `keep_identity_report` : le rapport de vérification d'identité reste jusqu'à 5 ans après la fin de la relation
    (purge quotidienne job_rgpd_purge). Renvoie l'adresse anonyme substituée."""
    original_email = user["email"]
    uid = user["id"]
    anonymous_email = f"deleted-{uuid.uuid4().hex[:12]}@anonyme.invalid"
    personal_fields = ["first_name", "last_name", "phone", "company_name", "siret", "siren", "address", "company_address",
                       "verified_first_name", "verified_last_name", "verification_session_id", "birth_date", "acquisition_source",
                       "stripe_identity_report", "buyer_profile", "experience", "kyc_documents", "verified_birth_date",
                       "siret_check", "company_lookup", "siret_verification", "profile_score"]
    if keep_identity_report:
        personal_fields = [f for f in personal_fields if f not in IDENTITY_REPORT_FIELDS]
    await db.users.update_one({"id": uid}, {
        "$set": {"email": anonymous_email, "email_verified": False, "password_hash": secrets.token_hex(32),
                 "password_changed_at": now, "deleted_at": now, "notifications_opt_out": True,
                 "kyc_status": "deleted", "identity_verified": False},
        "$unset": {f: "" for f in personal_fields},
    })
    # Annonces du vendeur retirées (jamais supprimées : le mandat y est rattaché)
    await db.properties.update_many({"seller_id": uid, "status": {"$nin": ["sold", "archived", "removed"]}},
                                   {"$set": {"status": "archived", "archived_reason": reason, "updated_at": now}})
    await db.properties.update_many({"seller_id": uid}, {"$set": {"seller_email": anonymous_email}})
    # Coordonnées répliquées dans les autres collections
    await db.messages.update_many({"sender_id": uid}, {"$set": {"sender_email": anonymous_email}, "$unset": {"content_original": ""}})
    await db.offers.update_many({"buyer_id": uid}, {"$set": {"buyer_email": anonymous_email}})
    await db.dataroom_access.update_many({"buyer_id": uid}, {"$set": {"buyer_email": anonymous_email}})
    await db.documents.update_many({"signer_id": uid}, {"$set": {"signer_email": anonymous_email}})
    await db.generated_contracts.update_many({"signed_by": original_email}, {"$set": {"signed_by": anonymous_email}})
    # Journaux (la chaîne d'empreintes d'audit ne porte pas l'adresse e-mail : elle reste vérifiable)
    await db.audit_logs.update_many({"actor_email": original_email}, {"$set": {"actor_email": anonymous_email}})
    await db.audit_logs.update_many({"target_email": original_email}, {"$set": {"target_email": anonymous_email}})
    await db.dataroom_access_logs.update_many({"viewer_email": original_email}, {"$set": {"viewer_email": anonymous_email}})
    # Factures conservées (obligation comptable : nom et adresse du débiteur) ; l'e-mail n'y est pas nécessaire
    await db.invoices.update_many({"debtor.user_id": uid}, {"$set": {"debtor.email": anonymous_email}})
    await db.newsletter_subscribers.delete_many({"email": original_email})
    # Boîte mail de test (mode test) : jamais servie au futur titulaire de l'adresse
    await db.test_emails.delete_many({"to": original_email.lower()})
    # Données sans valeur contractuelle : supprimées
    for coll in (db.alerts, db.favorites, *(() if keep_identity_report else (db.kyc_sessions,)), db.signature_otps, db.login_otps,
                 db.email_verifications, db.password_resets):
        await coll.delete_many({"user_id": uid})
    await db.password_resets.delete_many({"user_id": uid})
    await db.followups.delete_many({"buyer_id": uid})
    await db.public_alerts.update_many({"email": original_email}, {"$set": {"status": "unsubscribed", "email": anonymous_email}})
    # Estimations : données de prospect liées à l'adresse e-mail
    await db.estimates.delete_many({"email": original_email})
    return anonymous_email

@api_router.delete("/auth/account")
async def delete_account(data: AccountDeletion, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Suppression du compte : données personnelles anonymisées ; mandats, factures et preuves de signature conservés
    (obligations légales) avec le même user_id. Les annonces du vendeur sont retirées."""
    if current_user.get("role") == "admin":
        raise HTTPException(status_code=403, detail="Le compte administrateur ne peut pas être supprimé depuis l'espace en ligne")
    user = await db.users.find_one({"id": current_user["id"]})
    if not user or not await verify_password_async(data.password, user.get("password_hash")):
        raise HTTPException(status_code=400, detail="Mot de passe incorrect")
    now = datetime.now(timezone.utc).isoformat()
    original_email, original_name = user["email"], display_name(user)

    # E-mail de confirmation envoyé à l'adresse d'origine, avant l'anonymisation
    subject, html = render_email("account_deleted", name=original_name or original_email)
    background_tasks.add_task(send_brevo_email, original_email, original_name, subject, html)

    await anonymize_user(user, now)
    return {"deleted": True, "message": "Votre compte a été supprimé et vos données personnelles anonymisées."}

@api_router.get("/auth/export")
async def export_account(current_user: dict = Depends(get_current_user)):
    """Portabilité : toutes les données liées au compte, en JSON"""
    uid = current_user["id"]
    async def rows(coll, query, limit=1000, projection=None):
        return await coll.find(query, projection or {"_id": 0}).to_list(limit)
    # Seules les coordonnées du titulaire sont exportées : celles de l'autre partie (sender_email, buyer_email, adresse
    # du mandant…) répliquées dans les messages, offres et contrats restent confidentielles (aucune coordonnée entre membres)
    own = {v.strip().lower() for v in (current_user.get("email"), current_user.get("phone")) if isinstance(v, str) and v.strip()}
    properties = []
    for property in await rows(db.properties, {"seller_id": uid}):
        own_property = own | {str(property.get("address")).strip().lower()} if property.get("address") else own
        properties.append(strip_foreign_contacts(property, own_property))
    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": {k: v for k, v in current_user.items() if k not in ("password_hash",)},
        "properties": properties,
        "messages": strip_foreign_contacts(await rows(db.messages, {"$or": [{"sender_id": uid}, {"receiver_id": uid}]}, 5000,
                                                      {"_id": 0, "content_original": 0}), own),
        "contacts": strip_foreign_contacts(await rows(db.contacts, {"$or": [{"buyer_id": uid}, {"seller_id": uid}]}), own),
        "contracts": strip_foreign_contacts(await rows(db.generated_contracts, {"$or": [{"buyer_id": uid}, {"seller_id": uid}]}), own),
        "signatures": strip_foreign_contacts(await rows(db.documents, {"signer_id": uid}), own),
        "offers": strip_foreign_contacts(await rows(db.offers, {"$or": [{"buyer_id": uid}, {"seller_id": uid}]}), own),
        "dataroom_access": strip_foreign_contacts(await rows(db.dataroom_access, {"buyer_id": uid}), own),
        "alerts": await rows(db.alerts, {"user_id": uid}),
        "favorites": await rows(db.favorites, {"user_id": uid}),
        "invoices": await rows(db.invoices, {"debtor.user_id": uid}),
        "kyc_sessions": await rows(db.kyc_sessions, {"user_id": uid}),
    }
    return data

def strip_foreign_contacts(obj, own: set):
    """Retire récursivement les coordonnées (clés *_email, *_phone, email, phone, address, signed_by) dont la valeur
    n'appartient pas au titulaire (`own` : ses e-mail et téléphone en minuscules)"""
    if isinstance(obj, list):
        return [strip_foreign_contacts(x, own) for x in obj]
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if (is_contact_key(key) or key == "signed_by") and not (isinstance(value, str) and value.strip().lower() in own):
                continue
            out[key] = strip_foreign_contacts(value, own)
        return out
    return obj

# ============ PROPERTIES ROUTES ============
def mandate_required() -> bool:
    return os.environ.get("FF_MANDATE_REQUIRED", "true").strip().lower() not in ("false", "0", "no")

async def has_signed_mandate(property: dict) -> bool:
    """Mandat signé en cours ; hors mode test, un mandat de test (signé pendant l'essai) ne compte pas"""
    if not property.get("mandate_id"):
        return False
    query = {"id": property["mandate_id"], "type": "mandat", "status": "signed"}
    if not test_mode_enabled():
        query["is_test"] = {"$ne": True}
    return bool(await db.generated_contracts.find_one(query))

# Motifs de blocage (publication impossible) et drapeaux (publiée, à relire par l'admin sous 48 h) — SPEC §5.4, API.md §2
LISTING_BLOCKING_LABELS = {
    "email_not_verified": "votre adresse e-mail n'est pas confirmée",
    "identity": "votre identité n'est pas vérifiée",
    "mandate": "le mandat de vente n'est pas signé",
    "property_type": "le type de bien n'est pas renseigné",
    "location": "la ville et le code postal du bien ne sont pas renseignés",
    "lease": "le type de bail et la date de prise d'effet du bail en cours ne sont pas renseignés",
    "rent": "le loyer mensuel hors charges n'est pas renseigné",
    "price": "le prix de vente n'est pas renseigné",
    "dpe": "la classe énergie (DPE) n'est pas renseignée (« non soumis » n'est possible que pour un local, des bureaux, un parking ou un autre bien non habitable)",
    "surface": "la surface du bien n'est pas renseignée",
    "ownership_proof": "le justificatif de propriété n'est pas déposé ou a été refusé",
    "siret": "le SIRET de la société propriétaire n'est pas renseigné",
    "societe_cessee": "la société propriétaire est signalée comme cessée au registre national",
}
LISTING_FLAG_LABELS = {
    "ownership_pending": "justificatif de propriété à contrôler",
    "gerant_mismatch": "le vendeur n'apparaît pas comme gérant de la société au registre",
    "dpe_rental_ban": "logement dont la classe énergie interdit déjà tout nouveau bail ou renouvellement",
    "tenant_unpaid": "impayés en cours déclarés par le vendeur",
    "duplicate_address": "doublon probable : même adresse publiée par un autre compte",
    "opendata_unavailable": "open data indisponible au moment de la publication",
    # Mode test (MODE-TEST.md §2.5) : motif bloquant rétrogradé en drapeau pour les données de test
    "societe_cessee": "société signalée comme cessée au registre national (mode test : non bloquant)",
}
MODERATION_REVIEW_HOURS = 48
# Types de biens pour lesquels « non soumis au DPE » est accepté (SPEC §5.4) ; un logement exige A-G ou « vierge »
DPE_EXEMPT_PROPERTY_TYPES = ("local-commercial", "bureaux", "parking", "autre")
# Statuts d'une annonce qui « occupent » une adresse (détection de doublon)
DUPLICATE_LISTING_STATUSES = ("published", "paused")
ACCOUNT_BLOCKING_CODES = ("email_not_verified", "identity", "mandate")

def labeled(codes: list, labels: dict) -> list:
    return [{"code": c, "label": labels.get(c, c)} for c in codes]

def address_key(address: Optional[str], postal_code: Optional[str]) -> Optional[str]:
    """Adresse normalisée (sans accents, ponctuation ni casse) + code postal : détection des doublons probables"""
    if not address or not postal_code:
        return None
    text = taxonomy.slugify(address)
    return f"{postal_code}:{text}" if text else None

async def duplicate_address_for(property_doc: dict) -> Optional[dict]:
    """Annonce en ligne (ou en pause) d'un autre compte à la même adresse normalisée"""
    key = address_key(property_doc.get("address"), property_doc.get("postal_code"))
    if not key:
        return None
    return await db.properties.find_one({"id": {"$ne": property_doc.get("id")}, "seller_id": {"$ne": property_doc.get("seller_id")},
                                         "address_key": key, "status": {"$in": list(DUPLICATE_LISTING_STATUSES)}},
                                        {"_id": 0, "id": 1, "status": 1})

def content_blocking(doc: dict) -> list:
    """Motifs bloquants liés au contenu de l'annonce (sans les étapes du compte ni l'open data)"""
    blocking = []
    if not doc.get("property_type"):
        blocking.append("property_type")
    if not (doc.get("city") and doc.get("postal_code")):
        blocking.append("location")
    if not (doc.get("lease_type") and doc.get("lease_start")):
        blocking.append("lease")
    if not (doc.get("rent_monthly") or 0) > 0:
        blocking.append("rent")
    if not (doc.get("asking_price") or 0) > 0:
        blocking.append("price")
    dpe = doc.get("dpe_class")
    if not dpe or (dpe == "non-soumis" and doc.get("property_type") not in DPE_EXEMPT_PROPERTY_TYPES):
        blocking.append("dpe")
    if doc.get("property_type") != "parking" and not (doc.get("surface") or 0) > 0:
        blocking.append("surface")
    if (doc.get("ownership") or {}).get("status") not in ("pending", "verified"):
        blocking.append("ownership_proof")
    if doc.get("owner_type") in COMPANY_OWNER_TYPES and not doc.get("siret"):
        blocking.append("siret")
    return blocking

async def listing_checks(property_doc: dict, user: dict, mandate_signed: Optional[bool] = None) -> dict:
    """Contrôles d'une annonce (SPEC §5.4) → {checks, blocking: [codes], flags: [codes], company}. Étapes du compte
    (e-mail, identité, mandat), contenu, justificatif de propriété, société (open data : active, gérant), drapeaux."""
    doc = {**property_doc, **computed_property_fields(property_doc)}
    blocking, flags = [], []
    if not is_email_verified(user):
        blocking.append("email_not_verified")
    if not is_user_verified(user):
        blocking.append("identity")
    if mandate_signed is None:
        mandate_signed = (not mandate_required()) or await has_signed_mandate(doc)
    if not mandate_signed:
        blocking.append("mandate")
    blocking += content_blocking(doc)
    # Mode test : société cessée devient un drapeau pour les seules données de test (annonce ou vendeur `is_test`) ;
    # une annonce réelle garde tous ses contrôles pendant l'essai
    relaxed = test_mode_enabled() and is_test_related(property_doc, user)
    company = {"available": None, "found": False}
    gerant = None
    if doc.get("owner_type") in COMPANY_OWNER_TYPES and doc.get("siret"):
        try:
            company = await opendata.lookup_siren(doc["siret"])
        except Exception as e:  # jamais bloquant
            logging.warning(f"Open data indisponible pour le SIRET {doc.get('siret')}: {e}")
            company = {"available": False, "found": False}
        if not company.get("available"):
            flags.append("opendata_unavailable")
        elif company.get("found"):
            if company.get("siren_active") is False:
                (flags if relaxed else blocking).append("societe_cessee")
            first = user.get("verified_first_name") or user.get("first_name") or ""
            last = user.get("verified_last_name") or user.get("last_name") or ""
            gerant = await opendata.match_dirigeant(doc["siret"][:9], first, last)
            if gerant.get("status") not in ("match_exact", "match_partial"):
                flags.append("gerant_mismatch")
    ownership_status = (doc.get("ownership") or {}).get("status")
    if ownership_status == "pending":
        flags.append("ownership_pending")
    if (doc.get("dpe_rental") or {}).get("status") == "interdit":
        flags.append("dpe_rental_ban")
    if doc.get("tenant_payment_status") == "impayes":
        flags.append("tenant_unpaid")
    duplicate = await duplicate_address_for(doc)
    if duplicate:
        flags.append("duplicate_address")
    checks = {
        "email_verified": is_email_verified(user),
        "siren_active": company.get("siren_active") if company.get("found") else None,
        "gerant_match": (gerant or {}).get("status") if gerant else None,
        "ownership_verified": ownership_status == "verified",
        "dpe_rental_status": (doc.get("dpe_rental") or {}).get("status"),
        "opendata_available": company.get("available"),
        "duplicate_address": bool(duplicate),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"checks": checks, "blocking": blocking, "flags": flags, "company": company}

async def attach_checks(property_doc: dict, user: dict) -> dict:
    """Réponse de création, de mise à jour ou de soumission : `blocking` et `flags` à jour [{code, label}]"""
    result = await listing_checks(property_doc, user)
    property_doc["blocking"] = labeled(result["blocking"], LISTING_BLOCKING_LABELS)
    property_doc["flags"] = labeled(result["flags"], LISTING_FLAG_LABELS)
    return property_doc

async def submit_listing(property_doc: dict, user: dict) -> dict:
    """Soumet une annonce : e-mail confirmé et mandat signé obligatoires (loi Hoguet), puis publication automatique
    sans humain si les contrôles passent (SPEC §5.4) ; sinon brouillon avec la liste des motifs. Les drapeaux non
    bloquants sont listés dans « À faire » admin pendant 48 h (post-modération)."""
    now = datetime.now(timezone.utc).isoformat()
    if not is_email_verified(user):
        # Double opt-in : rien n'est publié ni signé tant que l'adresse n'est pas confirmée ; l'annonce reste en brouillon
        await db.properties.update_one({"id": property_doc["id"]}, {"$set": {"status": "draft", "updated_at": now}})
        property_doc["status"] = "draft"
        property_doc["auto_published"] = False
        property_doc["blocked_reason"] = "email_not_verified"
        return await attach_checks(property_doc, user)
    mandate_signed = (not mandate_required()) or await has_signed_mandate(property_doc)
    if not mandate_signed:
        await db.properties.update_one({"id": property_doc["id"]}, {"$set": {"status": "mandat_en_attente", "updated_at": now}})
        # Point de départ des relances « mandat à signer » (J+1/J+4/J+10), posé une seule fois
        await db.properties.update_one({"id": property_doc["id"], "mandate_pending_since": {"$exists": False}},
                                      {"$set": {"mandate_pending_since": now}})
        property_doc["status"] = "mandat_en_attente"
        property_doc["auto_published"] = False
        await email_user(user["id"], "listing_mandate_required", link=site_url(f"/seller/mandat/{property_doc['id']}"))
        return await attach_checks(property_doc, user)
    result = await listing_checks(property_doc, user, mandate_signed=True)
    blocking, flags, company = result["blocking"], result["flags"], result["company"]
    update = {
        **computed_property_fields(property_doc),
        "property_checks": result["checks"],
        "can_be_published": not blocking,
        "blocking": labeled(blocking, LISTING_BLOCKING_LABELS),
        "flags": labeled(flags, LISTING_FLAG_LABELS),
        "submitted_at": now,
        "updated_at": now,
    }
    if company.get("found"):
        update["company_lookup"] = {k: company.get(k) for k in ("nom_complet", "forme_juridique", "adresse", "etat", "siren_active")}
    if blocking:
        update["status"] = "draft"
        update["blocked_reason"] = blocking[0]
        update["moderation"] = property_doc.get("moderation") or {"status": "pending", "flags": [], "reviewed_at": None, "reason": None}
        await db.properties.update_one({"id": property_doc["id"]}, {"$set": update})
        property_doc.update(update)
        reasons = "".join(f"<li>{html_escape(LISTING_BLOCKING_LABELS.get(b, b))}</li>" for b in blocking)
        await email_user(user["id"], "listing_blocked", reasons=reasons, link=site_url("/seller/dashboard"))
        property_doc["auto_published"] = False
        return property_doc
    update["moderation"] = {"status": "pending", "flags": flags,
                            "review_until": (datetime.now(timezone.utc) + timedelta(hours=MODERATION_REVIEW_HOURS)).isoformat(),
                            "reviewed_at": None, "reason": None}
    update["blocked_reason"] = None
    update["auto_published"] = True
    await db.properties.update_one({"id": property_doc["id"]}, {"$set": update})
    property_doc.update(update)
    # Publication immédiate, sans file d'attente admin : les drapeaux alimentent l'onglet « À faire » (digest quotidien)
    await publish_property(property_doc)
    property_doc["status"] = "published"
    property_doc["auto_published"] = True
    return property_doc

async def submit_drafts(user_id: str):
    """Appelé quand l'identité d'un vendeur devient vérifiée : ses brouillons complets sont soumis"""
    user = await db.users.find_one({"id": user_id}, USER_SAFE_PROJECTION)
    if not user or user.get("role") != "seller":
        return
    drafts = await db.properties.find({"seller_id": user_id, "status": "draft"}, {"_id": 0}).to_list(50)
    for draft in drafts:
        if not listing_complete(draft):
            continue
        try:
            await submit_listing(draft, user)
        except Exception as e:
            logging.error(f"Soumission du brouillon {draft.get('id')} impossible: {e}")

async def resubmit_if_ready(property_doc: dict, user: dict) -> dict:
    """Brouillon complet d'un vendeur à l'identité vérifiée : soumis s'il ne l'a jamais été, re-soumis s'il était bloqué
    et que son mandat est signé (après correction, dépôt du justificatif…)"""
    if property_doc.get("status") != "draft" or not listing_complete(property_doc) or not is_user_verified(user):
        return property_doc
    if not property_doc.get("submitted_at") and not property_doc.get("blocking"):
        return await submit_listing(property_doc, user)
    if property_doc.get("blocking") and await has_signed_mandate(property_doc):
        return await submit_listing(property_doc, user)
    return property_doc

@api_router.post("/properties")
async def create_property(property: PropertyCreate, current_user: dict = Depends(get_current_user)):
    """Brouillon d'annonce (champs SPEC §3 tous facultatifs) → annonce avec `blocking` et `flags` [{code, label}]"""
    if current_user["role"] != "seller":
        raise api_error(403, "not_allowed", "Seuls les vendeurs peuvent déposer une annonce")
    now = datetime.now(timezone.utc).isoformat()
    fields = validate_listing_fields(property.model_dump())
    property_doc = {
        "id": str(uuid.uuid4()),
        "seller_id": current_user["id"],
        "seller_email": current_user["email"],
        **fields,
        "commission_terms_version": COMMISSION_TERMS_VERSION,
        "ownership": {"status": "missing"},
        "status": "draft",
        "views": 0,
        "contacts_count": 0,
        "favorites_count": 0,
        "can_be_published": False,
        "created_at": now,
        "updated_at": now
    }
    property_doc.update(computed_property_fields(property_doc))
    property_doc["address_key"] = address_key(property_doc.get("address"), property_doc.get("postal_code"))
    mark_test(property_doc, current_user)
    await db.properties.insert_one(property_doc)
    property_doc.pop("_id", None)

    # Écran 1 seul (pas de prix) : simple brouillon, soumis au PUT de l'écran 3
    if not listing_complete(property_doc):
        property_doc["auto_published"] = False
        return await attach_checks(property_doc, current_user)
    # Sans identité vérifiée, l'annonce reste en brouillon : elle sera soumise dès la vérification
    if not is_user_verified(current_user):
        await email_user(current_user["id"], "listing_draft")
        property_doc["auto_published"] = False
        return await attach_checks(property_doc, current_user)
    return await attach_checks(await submit_listing(property_doc, current_user), current_user)

def listing_complete(doc: dict) -> bool:
    """Une annonce est soumise (mandat, contrôles, publication) dès que l'écran 3 de CreateListing est renseigné
    (prix de vente) ; un champ manquant est alors un motif de blocage, pas un brouillon muet."""
    try:
        return float(doc.get("asking_price") or 0) > 0
    except (TypeError, ValueError):
        return False

# Informations qui lèvent l'anonymat d'une annonce : jamais exposées avant la signature de l'engagement de confidentialité
CONFIDENTIAL_PROPERTY_FIELDS = ["seller_email", "address", "address_key", "company_name", "siret", "company_lookup",
                               "mandant_address", "mandant_capacity", "presented_buyers"]
PUBLIC_PROPERTY_PROJECTION = {"_id": 0, **{f: 0 for f in CONFIDENTIAL_PROPERTY_FIELDS}}
# Vue de l'acquéreur après l'engagement : seuls ces champs confidentiels sont révélés (SPEC §3.5)
NDA_REVEALED_PROPERTY_FIELDS = ("address", "company_name", "siret")
# Champs internes jamais montrés hors du vendeur et de l'admin
INTERNAL_PROPERTY_FIELDS = ["seller_id", "blocking", "blocked_reason", "can_be_published", "auto_accept_dataroom", "alerts_sent",
                            "alerts_sent_count", "flags", "moderation", "demo_key", "weekly_snapshot", "draft_notified",
                            "mandate_pending_since", "submitted_at", "auto_published"]

def property_sort_criteria(sort: Optional[str]):
    if sort == "popular":
        return [("views", -1), ("created_at", -1)]
    if sort == "price_asc":
        return [("asking_price", 1), ("created_at", -1)]
    if sort == "price_desc":
        return [("asking_price", -1), ("created_at", -1)]
    if sort == "yield_desc":
        return [("gross_yield", -1), ("published_at", -1)]
    # `recent` / `latest` / défaut : les plus récentes d'abord (date de publication, puis de création)
    return [("published_at", -1), ("created_at", -1)]

def _id_list(value: Optional[Any], allowed: list) -> list:
    if isinstance(value, str):
        value = [v.strip() for v in value.split(",")]
    return [v for v in dict.fromkeys(value or []) if v in allowed]

def listing_filters(property_types: Optional[Any] = None, lease_types: Optional[Any] = None, region: Optional[str] = None,
                    department: Optional[str] = None, min_price: Optional[float] = None, max_price: Optional[float] = None,
                    min_yield: Optional[float] = None, min_surface: Optional[float] = None) -> dict:
    """Filtres publics d'API.md §2 (types de biens et de baux en OU logique, région, département, prix, rendement brut
    minimum, surface minimum) → requête Mongo"""
    query = {}
    types = _id_list(property_types, taxonomy.PROPERTY_TYPE_IDS)
    if types:
        query["property_type"] = {"$in": types}
    leases = _id_list(lease_types, taxonomy.LEASE_TYPE_IDS)
    if leases:
        query["lease_type"] = {"$in": leases}
    if region:
        query["region"] = taxonomy.region_by_slug(region) or region
    if department:
        code = taxonomy.normalize_departement(department)
        if code:
            query["department"] = code
    price = {}
    if min_price is not None and min_price > 0:
        price["$gte"] = float(min_price)
    if max_price is not None and max_price > 0:
        price["$lte"] = float(max_price)
    if price:
        query["asking_price"] = price
    if min_yield is not None and min_yield > 0:
        query["gross_yield"] = {"$gte": float(min_yield)}
    if min_surface is not None and min_surface > 0:
        query["surface"] = {"$gte": float(min_surface)}
    return query

def hide_test_listings(query: dict) -> dict:
    """Hors mode test, les annonces de test (créées pendant un essai et pas encore purgées) et les annonces réelles dont le
    mandat en cours a été signé pendant l'essai (mandat de test, sans valeur) ne sont jamais montrées au public"""
    if not test_mode_enabled():
        query["is_test"] = {"$ne": True}
        query["mandate_is_test"] = {"$ne": True}
    return query

def listing_hidden_outside_test(property: dict) -> bool:
    """Annonce masquée au public hors mode test (voir hide_test_listings)"""
    return bool(property.get("is_test") or property.get("mandate_is_test")) and not test_mode_enabled()

def _public_shape(property: dict) -> dict:
    """Forme publique des blocs calculés : statut seul du justificatif, contrôles affichables, honoraires"""
    property["commission_info"] = commission_info_for(property)
    property["ownership"] = {"status": (property.get("ownership") or {}).get("status") or "missing"}
    checks = property.get("property_checks") or {}
    dpe_rental = property.get("dpe_rental") or taxonomy.dpe_rental_status(property.get("dpe_class"), property.get("lease_type"))
    property["dpe_rental"] = dpe_rental
    property["property_checks"] = {"ownership_verified": property["ownership"]["status"] == "verified",
                                   "dpe_rental_status": checks.get("dpe_rental_status") or dpe_rental.get("status")}
    return property

def public_listing(property: dict) -> dict:
    """Annonce publique : champs confidentiels et internes retirés (jamais address, company_name, siret, seller_id…)"""
    for field in CONFIDENTIAL_PROPERTY_FIELDS + INTERNAL_PROPERTY_FIELDS:
        property.pop(field, None)
    return _public_shape(property)

def owner_listing(property: dict) -> dict:
    """Annonce vue par son vendeur ou l'admin : tout, avec les honoraires calculés"""
    property["commission_info"] = commission_info_for(property)
    property.setdefault("ownership", {"status": "missing"})
    property.pop("_id", None)
    return property

async def has_signed_nda(property_id: str, user_id: str) -> bool:
    nda = await db.generated_contracts.find_one({
        "type": "nda", "property_id": property_id, "buyer_id": user_id,
        "status": {"$in": ["signed", "buyer_signed", "fully_signed"]}
    })
    return nda is not None

def is_property_owner(property: dict, user: Optional[dict]) -> bool:
    return bool(user) and user["id"] == property.get("seller_id")

async def sanitize_property(property: dict, user: Optional[dict]) -> dict:
    """Retire les informations identifiantes sauf pour le vendeur, l'admin ou un acquéreur ayant signé l'engagement"""
    if user and (user.get("role") == "admin" or is_property_owner(property, user)):
        return owner_listing(property)
    if user and user.get("role") == "buyer" and await has_signed_nda(property["id"], user["id"]):
        # Adresse, dénomination et SIRET révélés après l'engagement ; mandant, acquéreurs présentés et données internes
        # restent au vendeur
        for field in [f for f in CONFIDENTIAL_PROPERTY_FIELDS if f not in NDA_REVEALED_PROPERTY_FIELDS] + INTERNAL_PROPERTY_FIELDS:
            property.pop(field, None)
        property["identity_revealed"] = True
        return _public_shape(property)
    return public_listing(property)

def fmt_eur(amount) -> str:
    """Montant au format français : 480 000 €"""
    return f"{(amount or 0):,.0f}".replace(",", "\u202f") + " €"

# ---- Confidentialité des coordonnées (référentiel v2, règle 6.2) ----
CONTACT_KEYS = {"email", "phone", "telephone", "address", "adresse"}

def is_contact_key(key: str) -> bool:
    return key in CONTACT_KEYS or key.endswith("_email") or key.endswith("_phone")

def scrub_contacts(obj, viewer: Optional[dict]):
    """Retire récursivement e-mails, téléphones et adresses des réponses destinées à un non-admin"""
    if viewer and viewer.get("role") == "admin":
        return obj
    if isinstance(obj, list):
        return [scrub_contacts(x, viewer) for x in obj]
    if isinstance(obj, dict):
        return {k: scrub_contacts(v, viewer) for k, v in obj.items()
                if not is_contact_key(k) and k != "content_original"}
    return obj

def buyer_pseudonym(user_id: str) -> str:
    return f"Acquéreur n°{(user_id or '')[:6].upper()}"

class PartyLabels:
    """Libellés affichables des parties d'une annonce, sans coordonnées (nom révélé seulement après l'engagement)"""
    def __init__(self, viewer: dict):
        self.viewer = viewer
        self.cache = {}

    async def label(self, user_id: Optional[str], property: Optional[dict]) -> str:
        if not user_id or user_id == "system":
            return site_name()
        if user_id == self.viewer.get("id"):
            return "Vous"
        key = (user_id, (property or {}).get("id"))
        if key in self.cache:
            return self.cache[key]
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "role": 1, "first_name": 1, "last_name": 1, "company_name": 1})
        if not user:
            value = "Utilisateur"
        elif user.get("role") == "admin":
            value = site_name()
        elif property and user_id == property.get("seller_id"):
            value = "Vendeur"
        elif property and await has_signed_nda(property["id"], user_id):
            value = display_name(user) or buyer_pseudonym(user_id)
        else:
            value = buyer_pseudonym(user_id)
        self.cache[key] = value
        return value

# Détection de coordonnées dans les messages (contournement de la plateforme avant l'engagement de confidentialité)
PHONE_RE = re.compile(r"(?:(?:\+|00)\s*33\s*[\s.\-]?|\b0)[1-9](?:[\s.\-]?\d{2}){4}\b")
EMAIL_RE = re.compile(r"[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+")

def mask_contacts(text: str):
    masked = PHONE_RE.sub("[coordonnées masquées]", text)
    masked = EMAIL_RE.sub("[coordonnées masquées]", masked)
    return masked, masked != text

def display_name(user: Optional[dict]) -> str:
    if not user:
        return ""
    full = f"{user.get('first_name') or ''} {user.get('last_name') or ''}".strip()
    return full or user.get("company_name") or ""

async def email_user(user_id: Optional[str], template: str, unsubscribe_url: str = "", **values):
    """Envoie un modèle d'email à un utilisateur (les valeurs saisies par les utilisateurs sont échappées ;
    `site_name` est toujours disponible dans le gabarit). Comptes supprimés : rien n'est envoyé."""
    if not user_id:
        return
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "email": 1, "first_name": 1, "last_name": 1,
                                                     "company_name": 1, "deleted_at": 1, "notifications_opt_out": 1})
    if not user or user.get("deleted_at"):
        return
    if unsubscribe_url and user.get("notifications_opt_out"):
        return  # e-mail non transactionnel refusé par l'utilisateur
    values.setdefault("name", display_name(user))
    subject, html = render_email(template, **values)
    await send_brevo_email(user["email"], display_name(user), subject, html, unsubscribe_url=unsubscribe_url)

def admin_notification_email() -> str:
    """Seule boîte qui reçoit les notifications admin (repli : l'adresse du compte administrateur)"""
    return (os.environ.get("ADMIN_NOTIFICATION_EMAIL") or os.environ.get("ADMIN_EMAIL") or "").strip().lower()

async def email_admin(template: str, **values):
    admin_email = admin_notification_email()
    if not admin_email:
        return
    subject, html = render_email(template, **values)
    await send_brevo_email(admin_email, f"Admin {site_name()}", subject, html)

async def publish_property(property: dict):
    """Met une annonce en ligne : statut, alertes acquéreurs (une seule fois) et email au vendeur"""
    now = datetime.now(timezone.utc).isoformat()
    update = {"status": "published", "updated_at": now}
    if not property.get("published_at"):
        update["published_at"] = now
    await db.properties.update_one({"id": property["id"]}, {"$set": update})
    if property.get("status") == "published":
        return
    sent = 0
    if not property.get("alerts_sent"):
        await db.properties.update_one({"id": property["id"]}, {"$set": {"alerts_sent": True}})
        try:
            sent = await trigger_alerts_for_property({**property, **update})
        except Exception as e:
            logging.error(f"Erreur envoi alertes: {e}")
        await db.properties.update_one({"id": property["id"]}, {"$set": {"alerts_sent_count": sent}})
    sent_line = (f"Elle a été envoyée à {sent} acquéreur{'s' if sent > 1 else ''} dont les critères d'alerte correspondent."
                 if sent else "Elle sera envoyée aux acquéreurs dont les critères d'alerte correspondent.")
    await email_user(property.get("seller_id"), "listing_published", sent_line=sent_line, property_title=update.get("title") or property.get("title") or "",
                     link=site_url("/seller/dashboard"))

@api_router.get("/properties")
async def get_properties(
    response: Response,
    status: Optional[str] = None,
    sort: Optional[str] = None,
    limit: Optional[int] = None,
    page: Optional[int] = None,
    property_types: Optional[str] = None,
    lease_types: Optional[str] = None,
    region: Optional[str] = None,
    department: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    min_yield: Optional[float] = None,
    min_surface: Optional[float] = None,
    authorization: Optional[str] = Header(None)
):
    """Annonces en ligne (publiques, API.md §2) : filtres `property_types`, `lease_types` (ids séparés par des virgules,
    OU logique), `region`, `department`, `min_price`, `max_price`, `min_yield` (rendement brut minimum), `min_surface`,
    `sort` (recent | price_asc | price_desc | yield_desc), `limit` (≤ 100), `page` (1…) ; en-tête `X-Total-Count`.
    Un vendeur connecté voit ses propres annonces (tous statuts), l'admin peut filtrer par statut."""
    current_user = await get_current_user_optional(authorization)
    query = listing_filters(property_types, lease_types, region, department, min_price, max_price, min_yield, min_surface)
    owner_view = False
    if current_user and current_user["role"] == "seller":
        query["seller_id"] = current_user["id"]
        owner_view = True
    elif current_user and current_user["role"] == "admin" and status:
        query["status"] = status
        owner_view = True
    else:
        query["status"] = "published"
        hide_test_listings(query)
    return await _list_properties(response, query, owner_view, sort, limit, page)

def photo_ref(photo: dict) -> dict:
    """Référence d'une photo dans une annonce : {id, visibility, url} ; le contenu se lit par GET /properties/{id}/photos/{photo_id}"""
    return {"id": photo["id"], "visibility": photo.get("visibility") or "public",
            "url": f"/api/properties/{photo['property_id']}/photos/{photo['id']}"}

async def attach_photos(properties: list, include_private: bool = False) -> list:
    """`photos` de chaque annonce (une seule requête) : photos publiques, plus les privées pour le vendeur, l'admin ou
    l'acquéreur qui a signé l'engagement de confidentialité"""
    ids = [p["id"] for p in properties if p.get("id")]
    if not ids:
        return properties
    query = {"property_id": {"$in": ids}}
    if not include_private:
        query["visibility"] = "public"
    by_property = {}
    async for photo in db.property_photos.find(query, {"_id": 0, "id": 1, "property_id": 1, "visibility": 1, "uploaded_at": 1}).sort("uploaded_at", 1):
        by_property.setdefault(photo["property_id"], []).append(photo_ref(photo))
    for p in properties:
        p["photos"] = by_property.get(p.get("id"), [])
    return properties

async def _list_properties(response: Response, query: dict, owner_view: bool, sort: Optional[str], limit: Optional[int],
                           page: Optional[int]) -> list:
    limit = max(1, min(limit or 100, 100))
    skip = (max(1, page or 1) - 1) * limit
    total = await db.properties.count_documents(query)
    response.headers["X-Total-Count"] = str(total)
    projection = {"_id": 0} if owner_view else PUBLIC_PROPERTY_PROJECTION
    cursor = db.properties.find(query, projection).sort(property_sort_criteria(sort)).skip(skip).limit(limit)
    properties = await cursor.to_list(limit)
    await attach_photos(properties, include_private=owner_view)
    if owner_view:
        return [owner_listing(c) for c in properties]
    return [public_listing(c) for c in properties]

@api_router.get("/properties/seller/mine")
async def get_my_properties(response: Response, sort: Optional[str] = None, limit: Optional[int] = None, page: Optional[int] = None,
                            current_user: dict = Depends(get_current_user)):
    """Vendeur : ses annonces, tous statuts (équivalent de GET /properties avec un jeton de vendeur)"""
    if current_user["role"] != "seller":
        raise api_error(403, "not_allowed", "Réservé aux vendeurs")
    return await _list_properties(response, {"seller_id": current_user["id"]}, True, sort, limit, page)

@api_router.get("/properties/{property_id}")
async def get_property(property_id: str, authorization: Optional[str] = Header(None)):
    current_user = await get_current_user_optional(authorization)
    
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found")
    
    is_privileged = bool(current_user) and (current_user.get("role") == "admin" or is_property_owner(property, current_user))
    hidden_test = listing_hidden_outside_test(property)
    if (property.get("status") != "published" or hidden_test) and not is_privileged:
        # Un acquéreur en relation (dossier accepté, engagement signé, offre, vente) garde l'accès à la fiche d'une annonce
        # vendue, en pause ou retirée : son dossier et son étape de vente y renvoient
        related = bool(current_user) and current_user.get("role") == "buyer" and (
            await db.dataroom_access.find_one({"property_id": property_id, "buyer_id": current_user["id"],
                                               "status": {"$in": list(DATAROOM_ACCEPTED_STATUSES) + ["pending"]}}, {"_id": 0, "id": 1}) is not None
            or await has_signed_nda(property_id, current_user["id"]))
        if not related:
            raise HTTPException(status_code=404, detail="Property not found")
        is_privileged = True  # pas de vue comptée
    
    # Les consultations du vendeur ou de l'admin ne comptent pas comme des vues
    if not is_privileged:
        await db.properties.update_one({"id": property_id}, {"$inc": {"views": 1}})
        property["views"] = property.get("views", 0) + 1
    
    can_see_private = bool(current_user) and (current_user.get("role") == "admin" or is_property_owner(property, current_user)
                                              or await has_signed_nda(property_id, current_user.get("id")))
    await attach_photos([property], include_private=can_see_private)
    return await sanitize_property(property, current_user)

@api_router.post("/properties/search")
async def search_properties(search: PropertySearch, response: Response, authorization: Optional[str] = Header(None)):
    """Recherche (alertes) : mêmes filtres que GET /properties, en corps JSON"""
    query = hide_test_listings({"status": "published", **listing_filters(search.property_types, search.lease_types, search.region,
                                                                         search.department, search.min_price, search.max_price,
                                                                         search.min_yield, search.min_surface)})
    return await _list_properties(response, query, False, search.sort, search.limit, search.page)

class ContactCreate(BaseModel):
    message: Optional[str] = Field(None, max_length=5000)

def require_buyer_profile(user: dict, minimum: int = SCORE_CONTACT_MIN):
    """Contact et demande de dossier : profil de projet suffisant (403 `profile_incomplete` avec le score et ce qui manque)"""
    if user.get("role") != "buyer":
        return
    score = buyer_profile_score(user)
    if score < minimum:
        raise api_error(403, "profile_incomplete",
                        f"Complétez votre profil de projet avant de contacter un vendeur (profil complet à {score} %, {minimum} % requis)",
                        profile_score=score, required=minimum, missing=profile_missing(user))

@api_router.post("/properties/{property_id}/contact")
async def contact_property(property_id: str, background_tasks: BackgroundTasks, data: Optional[ContactCreate] = None,
                          current_user: dict = Depends(get_current_user)):
    """Premier contact de l'acquéreur (SPEC §5.3, API.md §3) : adresse e-mail confirmée et profil ≥ 40 obligatoires ;
    crée (ou retrouve) la conversation du couple annonce / acquéreur, enregistre le message et envoie au vendeur
    l'e-mail « premier contact » avec la carte acquéreur pseudonymisée. → {conversation_id}"""
    if current_user["role"] != "buyer":
        raise api_error(403, "not_allowed", "Seuls les acquéreurs peuvent contacter un vendeur")
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property or property.get("status") != "published":
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    # Premier contact : e-mail confirmé et profil de projet suffisant ; l'identité n'est vérifiée qu'à l'engagement
    require_verified_email(current_user)
    require_buyer_profile(current_user)
    now = datetime.now(timezone.utc)
    conversation, created = await get_or_create_conversation(property, current_user["id"], now)
    content = (data.message if data else None) or ""
    content = content.strip()
    message_doc = None
    if content:
        message_doc = await store_message(conversation, current_user, content, now)
    if created:
        await register_contact(property, current_user["id"], now)
        extract = (message_doc or {}).get("content") or "L'acquéreur n'a pas laissé de message : répondez-lui depuis la messagerie."
        background_tasks.add_task(notify_first_contact, conversation, current_user, extract)
        background_tasks.add_task(email_user, current_user["id"], "contact_sent_buyer",
                                  property_title=property.get("title") or "l'annonce", link=site_url(f"/messages?conversation={conversation['id']}"))
    elif message_doc:
        background_tasks.add_task(notify_new_message, conversation, current_user, message_doc)
    return {"conversation_id": conversation["id"], "property_id": property_id, "already_contacted": not created,
            "message": ("Votre message a été transmis au vendeur." if created else "Contact déjà établi : retrouvez votre conversation dans la messagerie."),
            "message_id": (message_doc or {}).get("id")}

# ---- Actions du vendeur sur son annonce (SPEC §5.2.5) ----
SELLER_STATUSES = {"paused", "published", "withdrawn", "sold_elsewhere"}
SELLER_STATUS_LABELS = {"paused": "mise en pause", "published": "remise en ligne", "withdrawn": "retirée", "sold_elsewhere": "vendue autrement"}

async def seller_status_change(property: dict, status: str, current_user: dict, now: str) -> dict:
    current = property.get("status")
    property_id = property["id"]
    if status == "published":
        if current != "paused":
            raise api_error(400, "validation", "Seule une annonce en pause peut être remise en ligne")
        if mandate_required() and not await has_signed_mandate(property):
            raise api_error(400, "mandate_required", "Signez un mandat avant de remettre l'annonce en ligne")
        await db.properties.update_one({"id": property_id}, {"$set": {"status": "published", "updated_at": now, "resumed_at": now},
                                                           "$unset": {"paused_at": "", "paused_reason": ""}})
    elif current not in ("published", "paused", "withdrawn", "mandat_en_attente", "draft", "pending"):
        raise api_error(400, "validation", "Cette annonce ne peut pas changer de statut")
    elif status == "paused":
        if current != "published":
            raise api_error(400, "validation", "Seule une annonce en ligne peut être mise en pause")
        await db.properties.update_one({"id": property_id}, {"$set": {"status": "paused", "paused_at": now, "paused_reason": "vendeur", "updated_at": now}})
    elif status == "withdrawn":
        await db.properties.update_one({"id": property_id}, {"$set": {"status": "withdrawn", "withdrawn_at": now, "withdrawn_reason": "vendeur",
                                                                    "updated_at": now}})
    elif status == "sold_elsewhere":
        await db.properties.update_one({"id": property_id}, {"$set": {"status": "sold_elsewhere", "sold_elsewhere_at": now, "updated_at": now}})
        mandate = await db.generated_contracts.find_one({"id": property.get("mandate_id"), "type": "mandat"}, {"_id": 0}) if property.get("mandate_id") else None
        presented = await presented_buyers_view(property)
        buyers_list = " ; ".join(f"{b.get('name') or b['label']}" + (f" ({b['company_name']})" if b.get("company_name") else "") for b in presented) \
            or "aucun acquéreur ne vous a été nommément présenté"
        tail = fmt_date_fr(property.get("mandate_tail_ends_at") or (mandate or {}).get("tail_ends_at")) or "la fin de la clause de suite"
        await email_user(property.get("seller_id"), "sold_elsewhere_tail_clause", tail_ends_at=tail, buyers_list=buyers_list,
                         registry_number=(mandate or {}).get("registry_number") or "", link=site_url("/seller/dashboard"))
        await email_admin("sold_elsewhere_admin", property_id=property_id, property_title=property.get("title") or "",
                          buyers_list=buyers_list, tail_ends_at=tail)
    if status in ("withdrawn", "sold_elsewhere"):
        await close_pending_dataroom_requests(property_id, status, now)
    await create_audit_log(action=f"LISTING_{status.upper()}", property_id=property_id, actor_id=current_user["id"],
                           actor_email=current_user["email"], details={"from": current, "to": status})
    return {"message": "Status updated", "status": status, "label": SELLER_STATUS_LABELS[status]}

REMOVAL_REASONS = {
    "justificatif": "Le justificatif de propriété ne permet pas d'établir que le vendeur a qualité pour vendre le bien",
    "informations-inexactes": "Les informations de l'annonce sont inexactes ou invérifiables",
    "doublon": "Une annonce existe déjà pour ce bien",
    "bien-non-loue": "Le bien n'est pas loué : la plateforme est réservée aux biens vendus avec un locataire en place",
    "contenu-interdit": "L'annonce contient des coordonnées, des données personnelles du locataire ou un contenu interdit",
    "autre": "Autre motif",
}

@api_router.put("/properties/{property_id}/status")
async def update_property_status(property_id: str, status: str, reason: Optional[str] = None, reason_text: Optional[str] = None,
                                current_user: dict = Depends(get_current_user)):
    """Changement de statut (API.md §2).
    Vendeur : `paused` (mise en pause), `published` (reprise d'une annonce en pause), `withdrawn` (retrait),
    `sold_elsewhere` (vendue autrement : rappel de la clause de suite par e-mail).
    Admin : `published` = mise en ligne (mandat signé obligatoire, relecture close) ; `removed` = retrait motivé
    (motif obligatoire, e-mail au vendeur, mandat caduc, le vendeur peut corriger et re-soumettre)."""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    now = datetime.now(timezone.utc).isoformat()
    
    if current_user["role"] != "admin":
        if status not in SELLER_STATUSES or not is_property_owner(property, current_user):
            raise api_error(403, "not_allowed", "Action réservée au vendeur de l'annonce")
        return await seller_status_change(property, status, current_user, now)
    if status not in {"pending", "published", "rejected", "removed", "sold", "archived", "paused", "withdrawn", "sold_elsewhere"}:
        raise HTTPException(status_code=400, detail="Statut invalide")
    
    if status == "published":
        if mandate_required() and not await has_signed_mandate(property):
            raise HTTPException(status_code=400, detail="Publication impossible : le mandat de vente n'est pas signé")
        await publish_property(property)
        moderation = {**(property.get("moderation") or {}), "status": "ok", "reviewed_at": now, "reviewed_by": current_user["id"]}
        await db.properties.update_one({"id": property_id}, {"$set": {"moderation": moderation}})
        return {"message": "Status updated"}
    
    if status == "removed":
        if not reason or reason not in REMOVAL_REASONS:
            raise HTTPException(status_code=400, detail="Motif de retrait obligatoire : " + ", ".join(REMOVAL_REASONS))
        reason_label = REMOVAL_REASONS[reason] + (f" — {reason_text.strip()}" if reason_text and reason_text.strip() else "")
        moderation = {**(property.get("moderation") or {}), "status": "removed", "reviewed_at": now,
                      "reviewed_by": current_user["id"], "reason": reason, "reason_text": reason_label}
        await db.properties.update_one({"id": property_id}, {"$set": {"status": "removed", "removed_at": now, "updated_at": now,
                                                                     "moderation": moderation, "can_be_published": False}})
        if property.get("mandate_id"):
            # Caducité du mandat : l'annonce retirée met fin au mandat (art. 5), le vendeur pourra en signer un nouveau
            # Clause de suite : 12 mois à compter de la caducité (fin du mandat, art. 10)
            tail_ends_at = add_months(datetime.fromisoformat(now), MANDATE_TAIL_MONTHS).isoformat()
            voided = await db.generated_contracts.update_one({"id": property["mandate_id"], "type": "mandat", "status": "signed"},
                                                             {"$set": {"status": "void", "void_at": now, "void_reason": "annonce retirée : " + reason_label,
                                                                       "tail_ends_at": tail_ends_at}})
            update = {"mandat_signed": False}
            if voided.modified_count:
                update["mandate_tail_ends_at"] = tail_ends_at
            await db.properties.update_one({"id": property_id}, {"$set": update, "$unset": {"mandate_id": ""}})
        await close_pending_dataroom_requests(property_id, "removed", now)
        await create_audit_log(action="LISTING_REMOVED", property_id=property_id, actor_id=current_user["id"],
                               actor_email=current_user["email"], details={"reason": reason, "text": reason_label})
        await email_user(property.get("seller_id"), "listing_removed", reason=reason_label, link=site_url("/seller/dashboard"))
        return {"message": "Status updated", "reason": reason_label}
    
    await db.properties.update_one({"id": property_id}, {"$set": {"status": status, "updated_at": now}})
    if status not in DATAROOM_OPEN_LISTING_STATUSES:
        await close_pending_dataroom_requests(property_id, status, now)
    if status == "rejected" and property.get("status") != "rejected":
        await email_user(property.get("seller_id"), "listing_rejected")
    return {"message": "Status updated"}

# ============ PROPERTY UPDATE (SELLER) ============
class MandantAddress(BaseModel):
    """Adresse postale du mandant (API.md §2) ; `fmt_address` accepte aussi la chaîne historique"""
    line1: str = Field(..., min_length=3, max_length=200)
    line2: Optional[str] = Field(None, max_length=200)
    postal_code: str = Field(..., pattern=r"^\d{5}$")
    city: str = Field(..., min_length=1, max_length=120)

class PropertyUpdate(PropertyCreate):
    """Mêmes champs que la création (SPEC §3), plus l'adresse postale et la qualité du mandant (préalables au mandat)"""
    mandant_address: Optional[Union[MandantAddress, str]] = None
    mandant_capacity: Optional[str] = Field(None, max_length=20)

# Champs figés une fois l'annonce publiée ou le mandat signé (le bien et son propriétaire sont désignés par le mandat)
LOCKED_AFTER_MANDATE_FIELDS = ("property_type", "owner_type", "company_name", "siret", "address", "postal_code", "city")
LOCKED_FIELD_LABELS = {"property_type": "type de bien", "owner_type": "propriétaire", "company_name": "dénomination de la société",
                       "siret": "SIRET", "address": "adresse", "postal_code": "code postal", "city": "ville"}

@api_router.put("/properties/{property_id}")
async def update_property(property_id: str, update_data: PropertyUpdate, current_user: dict = Depends(get_current_user)):
    """
    Mise à jour d'une annonce par le vendeur (brouillon sauvegardé à chaque écran). Titre, rendements et décence
    énergétique sont recalculés ; un brouillon bloqué dont le mandat est signé est re-soumis automatiquement après
    correction (publication immédiate si les contrôles passent). → annonce avec `blocking` et `flags`.
    """
    if current_user["role"] != "seller":
        raise api_error(403, "not_allowed", "Seuls les vendeurs peuvent modifier une annonce")
    property = await db.properties.find_one({"id": property_id, "seller_id": current_user["id"]}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    sent = {k: v for k, v in update_data.model_dump().items() if v is not None}
    if isinstance(sent.get("mandant_address"), dict):
        sent["mandant_address"] = {k: v for k, v in sent["mandant_address"].items() if v is not None}
    update_dict = validate_listing_fields(sent, property)
    if property.get("mandat_signed") or property.get("status") == "published":
        for f in LOCKED_AFTER_MANDATE_FIELDS:
            if f in update_dict and update_dict[f] != property.get(f):
                raise api_error(400, "validation", f"Le champ « {LOCKED_FIELD_LABELS[f]} » ne peut plus être modifié après la "
                                                   "signature du mandat", field=f)
    if update_dict:
        merged = {**property, **update_dict}
        update_dict.update(computed_property_fields(merged))
        update_dict["address_key"] = address_key(merged.get("address"), merged.get("postal_code"))
        update_dict["updated_at"] = datetime.now(timezone.utc).isoformat()
        if property.get("status") == "removed":
            update_dict["status"] = "draft"
        await db.properties.update_one({"id": property_id}, {"$set": update_dict})

    updated = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if updated.get("status") == "draft" and listing_complete(updated) and is_user_verified(current_user):
        updated = await resubmit_if_ready(updated, current_user)
    elif updated.get("status") == "draft" and listing_complete(updated) and not updated.get("submitted_at") \
            and not property.get("draft_notified"):
        # Identité non vérifiée : brouillon complet, e-mail « enregistré en brouillon » une seule fois ; soumis à la vérification
        await db.properties.update_one({"id": property_id}, {"$set": {"draft_notified": True}})
        await email_user(current_user["id"], "listing_draft")
    # Baisse de prix sur une annonce en ligne : les acquéreurs intéressés (favoris, contacts) sont prévenus
    old_price, new_price = float(property.get("asking_price") or 0), float(updated.get("asking_price") or 0)
    if updated.get("status") == "published" and old_price > 0 and 0 < new_price < old_price:
        try:
            await notify_price_drop(updated, old_price, new_price)
        except Exception as e:
            logging.error(f"Notification de baisse de prix impossible: {e}")
    return await attach_checks(owner_listing(updated), current_user)

# ============ JUSTIFICATIF DE PROPRIÉTÉ (SPEC §5.2.3, API.md §2) ============
# Stocké hors dossier du bien, visible du vendeur et de l'admin seulement ; contrôlé par l'admin (badge « Propriétaire
# vérifié »). Statuts : missing → pending (dépôt) → verified | rejected (motif) ; un nouveau dépôt repasse en `pending`.
OWNERSHIP_DOC_TYPES = {
    "titre-propriete": "Titre de propriété (acte de vente)",
    "attestation-notariee": "Attestation notariée de propriété",
    "taxe-fonciere": "Avis de taxe foncière",
    "statuts-kbis": "Statuts et extrait Kbis de la société propriétaire",
}
OWNERSHIP_STATUS_LABELS = {"missing": "non déposé", "pending": "à contrôler", "verified": "vérifié", "rejected": "refusé"}

def ownership_view(property: dict) -> dict:
    """Métadonnées du justificatif (vendeur, admin) ; le public ne voit que le statut"""
    o = property.get("ownership") or {}
    return {"status": o.get("status") or "missing", "status_label": OWNERSHIP_STATUS_LABELS.get(o.get("status") or "missing"),
            "doc_type": o.get("doc_type"), "doc_type_label": OWNERSHIP_DOC_TYPES.get(o.get("doc_type") or ""),
            "filename": o.get("filename"), "content_type": o.get("content_type"), "uploaded_at": o.get("uploaded_at"),
            "reviewed_at": o.get("reviewed_at"), "note": o.get("note")}

async def _owned_or_admin(property_id: str, user: dict) -> dict:
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property or (user.get("role") != "admin" and not is_property_owner(property, user)):
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    return property

@api_router.post("/properties/{property_id}/ownership-proof")
async def upload_ownership_proof(property_id: str, file: UploadFile = File(...), doc_type: str = Form(...),
                                 current_user: dict = Depends(get_current_user)):
    """Vendeur : dépose le justificatif de propriété (PDF, JPEG, PNG, WebP) → {ownership: {status:'pending', doc_type,
    uploaded_at, filename}} ; un brouillon bloqué par le justificatif est re-soumis (publication si tout est en ordre)"""
    if current_user["role"] != "seller":
        raise api_error(403, "not_allowed", "Seul le vendeur dépose le justificatif de propriété")
    property = await db.properties.find_one({"id": property_id, "seller_id": current_user["id"]}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    if doc_type not in OWNERSHIP_DOC_TYPES:
        raise api_error(400, "validation", "Type de justificatif inconnu : " + ", ".join(OWNERSHIP_DOC_TYPES), field="doc_type")
    content = await read_upload(file, ALLOWED_DOCUMENT_TYPES)
    stored = await save_file(content, file.content_type, f"ownership/{property_id}")
    now = datetime.now(timezone.utc).isoformat()
    previous = await db.ownership_proofs.find({"property_id": property_id}, {"_id": 0}).to_list(20)
    for old in previous:
        try:
            await delete_file(old)
        except Exception as e:  # fichier déjà absent : la référence est retirée quand même
            logging.warning(f"Justificatif {old.get('id')} non supprimé du stockage ({e})")
    await db.ownership_proofs.delete_many({"property_id": property_id})
    proof = {"id": str(uuid.uuid4()), "property_id": property_id, "doc_type": doc_type, "filename": file.filename,
             "content_type": file.content_type, **stored, "uploaded_at": now, "uploaded_by": current_user["id"]}
    mark_test(proof, property, current_user)
    await db.ownership_proofs.insert_one(proof)
    ownership = {"status": "pending", "doc_type": doc_type, "filename": file.filename, "content_type": file.content_type,
                 "uploaded_at": now, "proof_id": proof["id"], "reviewed_at": None, "reviewed_by": None, "note": None,
                 "previous_status": (property.get("ownership") or {}).get("status")}
    await db.properties.update_one({"id": property_id}, {"$set": {"ownership": ownership, "property_checks.ownership_verified": False,
                                                                 "updated_at": now}})
    await create_audit_log(action="OWNERSHIP_PROOF_UPLOADED", property_id=property_id, actor_id=current_user["id"],
                           actor_email=current_user["email"], details={"doc_type": doc_type})
    await email_user(current_user["id"], "ownership_received", property_title=property.get("title") or "votre annonce",
                     doc_label=OWNERSHIP_DOC_TYPES[doc_type], link=site_url("/seller/dashboard"))
    updated = await db.properties.find_one({"id": property_id}, {"_id": 0})
    updated = await resubmit_if_ready(updated, current_user)
    if updated.get("status") == "published" and property.get("status") == "published":
        # Annonce déjà en ligne : nouveau justificatif à contrôler (ligne « À faire »)
        await db.properties.update_one({"id": property_id}, {"$set": {"moderation.status": "pending", "moderation.review_until":
                                                                     (datetime.now(timezone.utc) + timedelta(hours=MODERATION_REVIEW_HOURS)).isoformat()}})
    return {"ownership": ownership_view({"ownership": ownership}), "listing_status": updated.get("status")}

@api_router.get("/properties/{property_id}/ownership-proof")
async def get_ownership_proof(property_id: str, current_user: dict = Depends(get_current_user)):
    """Vendeur, admin : métadonnées du justificatif → {ownership: {status, doc_type, filename, uploaded_at, reviewed_at, note}}"""
    property = await _owned_or_admin(property_id, current_user)
    return {"ownership": ownership_view(property)}

@api_router.get("/properties/{property_id}/ownership-proof/file")
async def get_ownership_proof_file(property_id: str, current_user: dict = Depends(get_current_user)):
    """Vendeur, admin : le fichier du justificatif (jamais servi à un acquéreur)"""
    await _owned_or_admin(property_id, current_user)
    proof = await db.ownership_proofs.find_one({"property_id": property_id}, {"_id": 0}, sort=[("uploaded_at", -1)])
    if not proof:
        raise HTTPException(status_code=404, detail="Aucun justificatif déposé")
    data = await load_file(proof)
    filename = re.sub(r'[^\w.\- ]', "_", proof.get("filename") or "justificatif")
    return Response(content=data, media_type=proof.get("content_type") or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "private, no-store"})

class OwnershipReview(BaseModel):
    status: Literal["verified", "rejected"]
    note: Optional[str] = Field(None, max_length=1000)

@api_router.put("/admin/properties/{property_id}/ownership")
async def admin_review_ownership(property_id: str, data: OwnershipReview, current_user: dict = Depends(require_admin)):
    """Admin : valide ou refuse (motif obligatoire) le justificatif → {ownership} + e-mail au vendeur. Un refus retire
    l'annonce du site (brouillon bloqué) jusqu'au dépôt d'un nouveau justificatif."""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    ownership = property.get("ownership") or {}
    if ownership.get("status") not in ("pending", "verified", "rejected"):
        raise api_error(400, "validation", "Aucun justificatif déposé pour cette annonce")
    note = (data.note or "").strip() or None
    if data.status == "rejected" and not note:
        raise api_error(400, "validation", "Indiquez le motif du refus", field="note")
    now = datetime.now(timezone.utc).isoformat()
    ownership = {**ownership, "status": data.status, "reviewed_at": now, "reviewed_by": current_user["id"], "note": note}
    update = {"ownership": ownership, "property_checks.ownership_verified": data.status == "verified", "updated_at": now}
    if data.status == "rejected" and property.get("status") in ("published", "paused"):
        update.update({"status": "draft", "blocking": labeled(["ownership_proof"], LISTING_BLOCKING_LABELS),
                       "blocked_reason": "ownership_proof", "can_be_published": False, "unpublished_at": now})
    await db.properties.update_one({"id": property_id}, {"$set": update})
    if update.get("status") == "draft":
        await close_pending_dataroom_requests(property_id, "draft", now)
    await create_audit_log(action=f"OWNERSHIP_{data.status.upper()}", property_id=property_id, actor_id=current_user["id"],
                           actor_email=current_user["email"], details={"note": note})
    title = property.get("title") or "votre annonce"
    if data.status == "verified":
        await email_user(property.get("seller_id"), "ownership_verified", property_title=title, link=site_url("/seller/dashboard"))
    else:
        await email_user(property.get("seller_id"), "ownership_rejected", property_title=title, note=note,
                         unpublished_line=("Votre annonce est retirée du site jusqu'au dépôt d'un nouveau justificatif."
                                           if update.get("status") == "draft" else
                                           "Votre annonce ne pourra pas être publiée sans un justificatif valable."),
                         link=site_url("/seller/dashboard"))
    return {"ownership": ownership_view({"ownership": ownership}), "listing_status": update.get("status") or property.get("status")}

# ============ PHOTOS MANAGEMENT ============
@api_router.post("/properties/{property_id}/photos")
async def upload_photo(
    property_id: str, 
    file: UploadFile = File(...), 
    visibility: Literal["public", "private"] = Form("public"),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload d'une photo pour une annonce
    - public: visible par tous
    - private: visible après l'engagement de confidentialité
    """
    if current_user["role"] != "seller":
        raise HTTPException(status_code=403, detail="Only sellers can upload photos")
    
    property = await db.properties.find_one({"id": property_id, "seller_id": current_user["id"]})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found or not authorized")
    
    # Check photo limit (max 5)
    existing_photos = await db.property_photos.count_documents({"property_id": property_id})
    if existing_photos >= 5:
        raise HTTPException(status_code=400, detail="Maximum 5 photos per listing")
    
    # Read and encode file
    content = await read_upload(file, ALLOWED_IMAGE_TYPES, 5 * 1024 * 1024)
    stored = await save_file(content, file.content_type, f"photos/{property_id}")
    
    photo_doc = {
        "id": str(uuid.uuid4()),
        "property_id": property_id,
        "filename": file.filename,
        "content_type": file.content_type,
        **stored,
        "visibility": visibility,  # public or private
        "uploaded_at": datetime.now(timezone.utc).isoformat()
    }
    mark_test(photo_doc, property, current_user)
    await db.property_photos.insert_one(photo_doc)
    photo_doc.pop("_id", None)
    photo_doc.pop("content", None)  # Don't return content in response
    return photo_doc

@api_router.get("/properties/{property_id}/photos")
async def get_property_photos(property_id: str, authorization: Optional[str] = Header(None)):
    """
    Récupère les photos d'une annonce
    - Photos publiques: visibles par tous
    - Photos privées: visibles après l'engagement de confidentialité
    """
    current_user = await get_current_user_optional(authorization)
    
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found")
    
    # Check if user has signed NDA for private photos
    can_see_private = False
    if current_user:
        if is_property_owner(property, current_user) or current_user.get("role") == "admin":
            can_see_private = True
        elif await has_signed_nda(property_id, current_user.get("id")):
            can_see_private = True
    
    query = {"property_id": property_id}
    if not can_see_private:
        query["visibility"] = "public"
    
    photos = await db.property_photos.find(query, {"_id": 0, "content": 0}).to_list(10)
    return photos

@api_router.get("/properties/{property_id}/photos/{photo_id}")
async def get_photo_content(property_id: str, photo_id: str, authorization: Optional[str] = Header(None)):
    """
    Récupère le contenu d'une photo
    """
    current_user = await get_current_user_optional(authorization)
    
    photo = await db.property_photos.find_one({"id": photo_id, "property_id": property_id})
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Check visibility
    if photo["visibility"] == "private":
        if not current_user:
            raise HTTPException(status_code=403, detail="Authentication required")
        
        property = await db.properties.find_one({"id": property_id}, {"_id": 0})
        if not property:
            raise HTTPException(status_code=404, detail="Property not found")
        if not is_property_owner(property, current_user) and current_user.get("role") != "admin":
            nda = await has_signed_nda(property_id, current_user.get("id"))
            if not nda:
                raise api_error(403, "nda_required", "Photo visible après la signature de l'engagement de confidentialité")
    
    data = await load_file(photo)
    return {"filename": photo["filename"], "content": base64.b64encode(data).decode("utf-8"), "content_type": photo.get("content_type")}

@api_router.delete("/properties/{property_id}/photos/{photo_id}")
async def delete_photo(property_id: str, photo_id: str, current_user: dict = Depends(get_current_user)):
    """
    Supprime une photo
    """
    if current_user["role"] != "seller":
        raise HTTPException(status_code=403, detail="Only sellers can delete photos")
    
    property = await db.properties.find_one({"id": property_id, "seller_id": current_user["id"]})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found or not authorized")
    
    photo = await db.property_photos.find_one({"id": photo_id, "property_id": property_id}, {"_id": 0})
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    await delete_file(photo)
    await db.property_photos.delete_one({"id": photo_id, "property_id": property_id})
    
    return {"message": "Photo deleted"}

# ============ DATA ROOM MANAGEMENT ============
# Catégories du dossier du bien (SPEC §6.3) ; avertissement affiché à chaque dépôt
DATAROOM_CATEGORIES = [
    {"id": "bail", "label": "Bail et avenants", "hint": "Bail en cours signé, avenants, éventuel acte de cautionnement."},
    {"id": "etats-des-lieux", "label": "États des lieux", "hint": "État des lieux d'entrée (et de sortie du précédent locataire, le cas échéant)."},
    {"id": "loyers", "label": "Loyers et quittances", "hint": "Relevé des loyers encaissés sur les 12 derniers mois, quittances, dernière révision."},
    {"id": "diagnostics", "label": "Diagnostics", "hint": "DPE et dossier de diagnostic technique (amiante, plomb, électricité, gaz, ERP…)."},
    {"id": "taxe-fonciere", "label": "Taxe foncière", "hint": "Dernier avis de taxe foncière."},
    {"id": "copropriete", "label": "Copropriété", "hint": "Règlement, procès-verbaux des 3 dernières assemblées générales, fiche synthétique, appels de charges, carnet d'entretien."},
    {"id": "titre-propriete", "label": "Titre de propriété", "hint": "Acte d'acquisition ou attestation notariée."},
    {"id": "assurances", "label": "Assurances", "hint": "Assurance propriétaire non occupant (PNO), garantie loyers impayés (GLI)."},
    {"id": "travaux", "label": "Travaux", "hint": "Factures et garanties des travaux réalisés."},
    {"id": "societe", "label": "Société propriétaire", "hint": "Statuts, derniers bilans, procès-verbaux (vente des parts d'une SCI ou d'une société)."},
    {"id": "autres", "label": "Autres documents", "hint": "Tout autre document utile à l'acquéreur."},
]
DATAROOM_CATEGORY_IDS = [c["id"] for c in DATAROOM_CATEGORIES]
DATAROOM_CATEGORY_LABELS = {c["id"]: c["label"] for c in DATAROOM_CATEGORIES}

def with_category_labels(docs: list) -> list:
    for d in docs:
        d["category_label"] = DATAROOM_CATEGORY_LABELS.get(d.get("category"), d.get("custom_category") or "Autres documents")
    return docs
DATAROOM_TENANT_WARNING = ("Masquez le nom, les coordonnées et les pièces d'identité du locataire : l'acquéreur n'en a pas besoin "
                           "avant l'acte.")

@api_router.get("/dataroom/categories")
async def get_dataroom_categories():
    """Catégories du dossier du bien [{id, label, hint}] (API.md §5) ; l'avertissement sur les données du locataire est
    renvoyé avec chaque dépôt de document (`warning`)"""
    return [dict(c) for c in DATAROOM_CATEGORIES]

@api_router.post("/dataroom/{property_id}/documents")
async def upload_dataroom_document(
    property_id: str,
    file: UploadFile = File(...),
    category: str = Form(...),
    custom_category: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Dépôt d'un document dans le dossier du bien par le vendeur (catégories SPEC §6.3)
    """
    if current_user["role"] != "seller":
        raise api_error(403, "not_allowed", "Seul le vendeur dépose des documents dans le dossier du bien")
    
    property = await db.properties.find_one({"id": property_id, "seller_id": current_user["id"]})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    if category not in DATAROOM_CATEGORY_IDS:
        raise api_error(400, "validation", "Catégorie de document inconnue", field="category")
    
    content = await read_upload(file, ALLOWED_DOCUMENT_TYPES)
    # Chaque consultation par un acquéreur est filigranée : un fichier non filigranable (PDF protégé par mot de passe,
    # illisible) est refusé dès le dépôt plutôt que servi en clair
    try:
        await asyncio.to_thread(apply_watermark, content, file.content_type, "CONFIDENTIEL - contrôle", True)
    except WatermarkError:
        raise HTTPException(status_code=400, detail="Ce document est protégé ou illisible : déposez un PDF non protégé par mot de passe "
                                                    "(ou une image JPEG, PNG, WebP) pour qu'il puisse être filigrané.")
    stored = await save_file(content, file.content_type, f"dataroom/{property_id}")
    
    doc = {
        "id": str(uuid.uuid4()),
        "property_id": property_id,
        "category": category,
        "custom_category": custom_category,
        "description": description,
        "filename": file.filename,
        "content_type": file.content_type,
        **stored,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": current_user["id"]
    }
    mark_test(doc, property, current_user)
    await db.dataroom.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("content", None)
    doc["warning"] = DATAROOM_TENANT_WARNING
    doc["category_label"] = DATAROOM_CATEGORY_LABELS.get(category)
    return doc

@api_router.get("/dataroom/{property_id}/documents")
async def list_dataroom_documents(property_id: str, current_user: dict = Depends(get_current_user)):
    """
    Liste les documents du dossier du bien
    - Vendeur: voit tout
    - Acheteur: voit uniquement si accès accordé (identité, engagement de confidentialité, origine des fonds)
    """
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found")
    
    # Seller can always see
    if current_user["id"] == property.get("seller_id"):
        docs = await db.dataroom.find({"property_id": property_id}, {"_id": 0, "content": 0}).to_list(100)
        return {"documents": with_category_labels(docs), "access_granted": True, "warning": DATAROOM_TENANT_WARNING}
    
    # Accès de l'acquéreur : demande acceptée, identité vérifiée, NDA signé, origine des fonds déclarée
    access = await db.dataroom_access.find_one({
        "property_id": property_id,
        "buyer_id": current_user["id"],
        "status": "granted"
    })
    
    if not access:
        return {"documents": [], "access_granted": False, "message": "L'accès au dossier s'ouvre après l'engagement de confidentialité et la déclaration d'origine des fonds."}
    
    docs = await db.dataroom.find({"property_id": property_id}, {"_id": 0, "content": 0}).to_list(100)
    
    # Log access
    await db.dataroom_access_logs.insert_one({
        "id": str(uuid.uuid4()),
        "property_id": property_id,
        "user_id": current_user["id"],
        "accessed_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"documents": with_category_labels(docs), "access_granted": True}

@api_router.post("/dataroom/{property_id}/documents/{doc_id}/view")
async def view_dataroom_document(property_id: str, doc_id: str, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """
    Visualise un document du dossier du bien (avec filigrane et log d'accès)
    Retourne le document en base64 pour affichage avec filigrane
    """
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found")
    
    # Check access
    can_access = False
    is_seller = current_user["id"] == property.get("seller_id")
    is_admin = current_user.get("role") == "admin"
    
    if is_seller or is_admin:
        can_access = True
    else:
        access = await db.dataroom_access.find_one({
            "property_id": property_id,
            "buyer_id": current_user["id"],
            "status": "granted"
        })
        if access:
            can_access = True
    
    if not can_access:
        raise api_error(403, "not_allowed", "L'accès au dossier s'ouvre après l'engagement de confidentialité et la déclaration d'origine des fonds")
    
    doc = await db.dataroom.find_one({"id": doc_id, "property_id": property_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Filigrane incrusté dans le fichier lui-même (email du lecteur + horodatage) ; jamais servi sans filigrane
    watermark_text = f"{current_user['email']} | {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M')} UTC"
    raw = await load_file(doc)
    content_type = doc.get("content_type") or "application/pdf"
    watermark_failed = False
    if not is_seller:
        try:
            raw, content_type = await asyncio.to_thread(apply_watermark, raw, content_type, f"CONFIDENTIEL - {watermark_text}", True)
        except WatermarkError as e:
            watermark_failed = True
            logging.error(f"Dossier du bien {property_id} : document {doc_id} non filigranable, consultation refusée ({e})")
    
    # Log access (only for buyers, not sellers viewing their own docs)
    if not is_seller and not is_admin:
        access_log = {
            "id": str(uuid.uuid4()),
            "property_id": property_id,
            "document_id": doc_id,
            "document_name": doc.get("filename", "Unknown"),
            "viewer_id": current_user["id"],
            "viewer_email": current_user["email"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "watermark_applied": not watermark_failed,
            **({"refused": "watermark_failed"} if watermark_failed else {}),
        }
        await db.dataroom_access_logs.insert_one(access_log)
        
        # Log to audit trail
        await create_audit_log(
            action="DOCUMENT_VIEW_REFUSED" if watermark_failed else "DOCUMENT_VIEWED",
            property_id=property_id,
            actor_id=current_user["id"],
            actor_email=current_user["email"],
            details={"document_id": doc_id, "document_name": doc.get("filename")}
        )
    
    if watermark_failed:
        raise api_error(409, "watermark_failed", "Ce document ne peut pas être filigrané (fichier protégé ou illisible) : "
                                                 "il n'est pas consultable. Demandez au vendeur de déposer une version PDF non protégée.")
    
    # Return document content in base64 for viewing
    return {
        "document": {
            "id": doc["id"],
            "filename": doc.get("filename"),
            "category": doc.get("category"),
            "content_type": content_type,
            "content": base64.b64encode(raw).decode("utf-8")
        },
        "access_granted": True,
        "watermark": watermark_text,
        "message": "Document consultable avec filigrane. Téléchargement non autorisé."
    }

@api_router.get("/dataroom/{property_id}/access-log")
async def get_dataroom_access_log(property_id: str, current_user: dict = Depends(get_current_user)):
    """
    Récupère le journal d'accès au dossier du bien (pour vendeur et admin)
    """
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found")
    
    # Only seller or admin can view access log
    if current_user["id"] != property.get("seller_id") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    
    logs = await db.dataroom_access_logs.find(
        {"property_id": property_id},
        {"_id": 0}
    ).sort("timestamp", -1).to_list(500)
    
    labels = PartyLabels(current_user)
    for log in logs:
        log["viewer_label"] = await labels.label(log.get("viewer_id") or log.get("user_id"), property)
    return {"logs": scrub_contacts(logs, current_user)}

@api_router.get("/dataroom/{property_id}/audit-trail")
async def get_dataroom_audit_trail(property_id: str, current_user: dict = Depends(get_current_user)):
    """
    Récupère le journal d'audit blockchain-like pour un bien (vendeur et admin)
    Ce journal est immuable et peut servir de preuve juridique.
    """
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found")
    
    # Only seller or admin can view audit trail
    if current_user["id"] != property.get("seller_id") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    
    logs = await db.audit_logs.find(
        {"property_id": property_id},
        {"_id": 0}
    ).sort("sequence", 1).to_list(1000)
    labels = PartyLabels(current_user)
    for log in logs:
        log["actor_label"] = await labels.label(log.get("actor_id"), property)
        log["target_label"] = await labels.label(log.get("target_id"), property) if log.get("target_id") else None
    
    # Verify chain integrity
    chain_valid = True
    for i, log in enumerate(logs):
        if i == 0:
            if log.get("previous_hash") != "GENESIS":
                chain_valid = False
                break
        else:
            if log.get("previous_hash") != logs[i-1].get("current_hash"):
                chain_valid = False
                break
    
    return {
        "logs": scrub_contacts(logs, current_user),
        "chain_valid": chain_valid,
        "total_events": len(logs),
        "message": "Journal d'audit immuable pour traçabilité juridique"
    }

@api_router.get("/dataroom/{property_id}/documents/{doc_id}/download")
async def download_dataroom_document(property_id: str, doc_id: str, current_user: dict = Depends(get_current_user)):
    """
    DÉSACTIVÉ - Téléchargement non autorisé pour le dossier du bien sécurisé
    Les documents sont consultables uniquement via l'endpoint /view
    """
    raise HTTPException(
        status_code=403, 
        detail="Téléchargement non autorisé. Les documents du dossier du bien sont consultables uniquement en ligne avec filigrane."
    )

@api_router.delete("/dataroom/{property_id}/documents/{doc_id}")
async def delete_dataroom_document(property_id: str, doc_id: str, current_user: dict = Depends(get_current_user)):
    """
    Supprime un document du dossier du bien (vendeur uniquement)
    """
    if current_user["role"] != "seller":
        raise HTTPException(status_code=403, detail="Only sellers can delete documents")
    
    property = await db.properties.find_one({"id": property_id, "seller_id": current_user["id"]})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found or not authorized")
    
    doc = await db.dataroom.find_one({"id": doc_id, "property_id": property_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await delete_file(doc)
    await db.dataroom.delete_one({"id": doc_id, "property_id": property_id})
    
    return {"message": "Document deleted"}

# ============ DEMANDE DE DOSSIER (DATA ROOM) : demande → acceptation → identité → NDA → origine des fonds → accès ============
# API.md §4. Statuts d'une demande : pending → accepted (vendeur ou acceptation automatique) → granted (les trois étapes
# faites) ; rejected ; expired (J+10 sans réponse). Les statuts `validated` / `loi_pending` de la vague 1 valent `accepted`.
DATAROOM_REQUEST_EXPIRY_DAYS = 10
DATAROOM_REMINDER_DAYS = (2, 5)
FUNDS_SOURCE_LABELS = {"fonds-propres": "fonds propres", "emprunt": "emprunt bancaire", "mixte": "apport personnel et emprunt",
                       "investisseurs": "investisseurs ou associés"}
DATAROOM_STEP_LABELS = {"identity": "vérifier votre identité", "nda": "signer l'engagement de confidentialité",
                        "funds": "déclarer l'origine des fonds"}

class AccessRequestCreate(BaseModel):
    message: Optional[str] = Field(None, max_length=2000)

class FundsDeclaration(BaseModel):
    source: Literal["fonds-propres", "emprunt", "mixte", "investisseurs"]
    amount: float = Field(..., gt=0, le=100_000_000)
    financing_partner: Optional[str] = Field(None, max_length=200)

class AccessRejectInput(BaseModel):
    reason: Optional[str] = Field(None, max_length=1000)

def access_request_status(access: Optional[dict]) -> Optional[str]:
    """Statut normalisé d'une demande (valeurs de la vague 1 ramenées à `accepted`)"""
    if not access:
        return None
    status = access.get("status")
    return "accepted" if status in ("validated", "loi_pending") else status

async def dataroom_steps(property_id: str, buyer: dict, access: Optional[dict] = None) -> dict:
    """Étapes obligatoires après acceptation : identité vérifiée, NDA signé, origine des fonds déclarée"""
    nda = bool((access or {}).get("nda_signed_at")) or await has_signed_nda(property_id, buyer["id"])
    return {"identity": is_user_verified(buyer), "nda": nda, "funds": bool((access or {}).get("funds_declaration"))}

def next_dataroom_step(steps: dict) -> Optional[str]:
    for key in ("identity", "nda", "funds"):
        if not steps.get(key):
            return key
    return None

async def grant_dataroom_access(access: dict, now: Optional[datetime] = None) -> bool:
    """Accès accordé automatiquement dès que les trois étapes sont faites (vérifié à chaque étape)"""
    now = now or datetime.now(timezone.utc)
    if access_request_status(access) != "accepted":
        return False
    buyer = await db.users.find_one({"id": access["buyer_id"]}, USER_SAFE_PROJECTION)
    if not buyer:
        return False
    steps = await dataroom_steps(access["property_id"], buyer, access)
    if next_dataroom_step(steps):
        return False
    res = await db.dataroom_access.update_one({"id": access["id"], "status": {"$ne": "granted"}},
                                              {"$set": {"status": "granted", "granted_at": now.isoformat(), "steps": steps}})
    if res.modified_count == 0:
        return False
    property = await db.properties.find_one({"id": access["property_id"]}, {"_id": 0, "seller_id": 1, "title": 1, "company_name": 1})
    await system_message(access["property_id"], access["buyer_id"],
                         "Identité vérifiée, engagement de confidentialité signé et origine des fonds déclarée : l'accès au dossier est ouvert.",
                         "dataroom_granted")
    await create_audit_log(action="DATAROOM_GRANTED", property_id=access["property_id"], actor_id="system", actor_email="",
                           target_id=access["buyer_id"], details={"request_id": access["id"]})
    await email_user(access["buyer_id"], "dataroom_granted", property_title=(property or {}).get("title") or "le bien",
                     link=site_url(f"/dataroom/{access['property_id']}"))
    if property:
        await email_user(property.get("seller_id"), "dataroom_granted_seller",
                         buyer_name=display_name(buyer) or buyer_pseudonym(buyer["id"]), link=site_url("/seller/dashboard"))
    return True

async def accept_access_request(access: dict, property: dict, by: Optional[dict], now: datetime, auto: bool = False) -> None:
    """Acceptation (vendeur ou automatique) : étapes communiquées à l'acquéreur, e-mail « dossier accepté » avec la checklist"""
    await db.dataroom_access.update_one({"id": access["id"]}, {"$set": {
        "status": "accepted", "accepted_at": now.isoformat(), "validated_at": now.isoformat(), "auto_accepted": auto,
        "accepted_by": by["id"] if by else "auto"}, "$unset": {"expires_at": ""}})
    buyer = await db.users.find_one({"id": access["buyer_id"]}, USER_SAFE_PROJECTION) or {"id": access["buyer_id"]}
    steps = await dataroom_steps(property["id"], buyer, access)
    pending = [k for k in ("identity", "nda", "funds") if not steps.get(k)]
    checklist = " ; ".join(DATAROOM_STEP_LABELS[k] for k in pending) if pending else "toutes les étapes sont faites"
    content = ("Votre demande de dossier est acceptée automatiquement." if auto else "Le vendeur a accepté votre demande de dossier.") \
        + " Prochaines étapes : " + checklist + "."
    await system_message(property["id"], access["buyer_id"], content, "access_accepted", receiver_id=access["buyer_id"])
    await create_audit_log(action="ACCESS_ACCEPTED", property_id=property["id"], actor_id=by["id"] if by else "auto",
                           actor_email=(by or {}).get("email") or "", target_id=access["buyer_id"], details={"request_id": access["id"], "auto": auto})
    checklist_html = "".join(f"<li>{html_escape(DATAROOM_STEP_LABELS[k])}</li>" for k in pending) \
        or "<li>toutes les étapes sont déjà faites : l'accès s'ouvre automatiquement</li>"
    await email_user(access["buyer_id"], "dataroom_accepted", property_title=property.get("title") or "le bien",
                     checklist=checklist_html, link=site_url(f"/dataroom/{property['id']}"))
    if auto:
        card = await buyer_card(access["buyer_id"])
        await email_user(property.get("seller_id"), "dataroom_auto_accepted", buyer_label=card["label"], card_rows=buyer_card_html(card),
                         property_title=property.get("title") or "votre annonce", link=site_url("/seller/dashboard"))
    if not pending:
        await grant_dataroom_access({**access, "status": "accepted"}, now)

@api_router.post("/dataroom/{property_id}/request-access")
async def request_dataroom_access(property_id: str, background_tasks: BackgroundTasks, data: Optional[AccessRequestCreate] = None,
                                  current_user: dict = Depends(get_current_user)):
    """Demande de dossier de l'acquéreur (adresse confirmée, profil ≥ 40) → {request_id, status: 'pending'|'accepted'}.
    Acceptation immédiate si l'annonce a l'option `auto_accept_dataroom` et que le profil est ≥ 50 ; sinon le vendeur
    est relancé à J+2 et J+5 et la demande expire à J+10."""
    if current_user["role"] != "buyer":
        raise api_error(403, "not_allowed", "Seuls les acquéreurs demandent l'accès au dossier")
    require_verified_email(current_user)
    require_buyer_profile(current_user)

    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property or property.get("status") != "published":
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    now = datetime.now(timezone.utc)
    message = ((data.message if data else None) or "").strip()

    existing = await db.dataroom_access.find_one({"property_id": property_id, "buyer_id": current_user["id"]}, {"_id": 0})
    if existing and existing.get("status") not in ("expired", "closed"):
        return {"request_id": existing["id"], "status": access_request_status(existing), "already_requested": True,
                "message": "Demande déjà enregistrée"}

    conversation, _ = await get_or_create_conversation(property, current_user["id"], now)
    access_request = {
        "id": existing["id"] if existing else str(uuid.uuid4()),
        "property_id": property_id, "buyer_id": current_user["id"], "buyer_email": current_user["email"],
        "conversation_id": conversation["id"], "status": "pending", "message": message or None,
        "requested_at": now.isoformat(), "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=DATAROOM_REQUEST_EXPIRY_DAYS)).isoformat(),
        "reminders_sent": [], "profile_score": buyer_profile_score(current_user),
    }
    mark_test(access_request, current_user, property, existing)
    if existing:
        await db.dataroom_access.replace_one({"id": existing["id"]}, access_request)
    else:
        await db.dataroom_access.insert_one(access_request)
    access_request.pop("_id", None)

    # L'acquéreur demande le dossier ; le vendeur reçoit la carte acquéreur
    await store_message(conversation, current_user,
                        message or "Je souhaite consulter le dossier de ce bien. Pouvez-vous accepter ma demande ?",
                        now, message_type="access_request")
    await create_audit_log(action="ACCESS_REQUEST", property_id=property_id, actor_id=current_user["id"],
                           actor_email=current_user["email"], target_id=property.get("seller_id"), details={"request_id": access_request["id"]})
    if property.get("auto_accept_dataroom") and buyer_profile_score(current_user) >= SCORE_AUTO_ACCEPT_MIN:
        await accept_access_request(access_request, property, None, now, auto=True)
        return {"request_id": access_request["id"], "status": "accepted", "auto_accepted": True, "message": "Demande acceptée automatiquement"}
    card = await buyer_card(current_user["id"])
    background_tasks.add_task(email_user, property.get("seller_id"), "access_request", buyer_label=card["label"],
                              card_rows=buyer_card_html(card), message=message or "(sans message)",
                              property_title=property.get("title") or "votre annonce", link=site_url("/seller/dashboard"))
    return {"request_id": access_request["id"], "status": "pending", "message": "Demande transmise au vendeur"}

async def access_request_view(req: dict, property: dict) -> dict:
    buyer = await db.users.find_one({"id": req["buyer_id"]}, USER_SAFE_PROJECTION)
    revealed = bool(req.get("identity_revealed")) or await has_signed_nda(property["id"], req["buyer_id"])
    card = await buyer_card(req["buyer_id"], revealed=revealed)
    steps = await dataroom_steps(property["id"], buyer or {"id": req["buyer_id"]}, req)
    status = access_request_status(req)
    return {
        "id": req["id"], "buyer_id": req["buyer_id"], "buyer_card": card, "buyer_label": card["label"],
        "buyer": {"id": req["buyer_id"], "label": card["label"], "verified": steps["identity"], "identity_verified": steps["identity"],
                  "created_at": (buyer or {}).get("created_at")},
        "message": req.get("message"), "status": status, "raw_status": req.get("status"),
        "created_at": req.get("created_at") or req.get("requested_at"), "requested_at": req.get("requested_at"),
        "expires_at": req.get("expires_at") if status == "pending" else None,
        "accepted_at": req.get("accepted_at") or req.get("validated_at"), "granted_at": req.get("granted_at"),
        "rejected_at": req.get("rejected_at"), "rejection_reason": req.get("rejection_reason"),
        "auto_accepted": bool(req.get("auto_accepted")), "steps": steps, "next_step": next_dataroom_step(steps) if status == "accepted" else None,
        "conversation_id": req.get("conversation_id"), "identity_revealed": revealed,
        "funds_declaration": req.get("funds_declaration") if status == "granted" else None,
    }

@api_router.get("/dataroom/{property_id}/access-requests")
async def get_access_requests(property_id: str, current_user: dict = Depends(get_current_user)):
    """Vendeur : demandes de dossier avec carte acquéreur et étapes → [{id, buyer_id, buyer_card, message, status, created_at, expires_at, steps}]"""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property or (current_user.get("role") != "admin" and not is_property_owner(property, current_user)):
        raise HTTPException(status_code=404, detail="Property not found or not authorized")
    requests = await db.dataroom_access.find({"property_id": property_id, "buyer_id": {"$exists": True, "$ne": None},
                                              "status": {"$exists": True, "$ne": None}}, {"_id": 0}).sort("requested_at", -1).to_list(200)
    for req in requests:
        if not req.get("conversation_id"):
            conversation, _ = await get_or_create_conversation(property, req["buyer_id"])
            req["conversation_id"] = conversation["id"]
            await db.dataroom_access.update_one({"id": req["id"]}, {"$set": {"conversation_id": conversation["id"]}})
    rows = [await access_request_view(r, property) for r in requests]
    return scrub_contacts(rows, current_user)

async def _owned_request(property_id: str, request_id: str, current_user: dict) -> tuple:
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property or (current_user.get("role") != "admin" and not is_property_owner(property, current_user)):
        raise HTTPException(status_code=404, detail="Property not found or not authorized")
    access_request = await db.dataroom_access.find_one({"id": request_id, "property_id": property_id}, {"_id": 0})
    if not access_request:
        raise HTTPException(status_code=404, detail="Access request not found")
    return property, access_request

@api_router.put("/dataroom/{property_id}/access/{request_id}/validate")
async def validate_access_request(property_id: str, request_id: str, current_user: dict = Depends(get_current_user)):
    """Vendeur : accepte la demande en un geste → {status:'accepted'} ; l'acquéreur passe aux étapes identité → NDA → fonds"""
    property, access_request = await _owned_request(property_id, request_id, current_user)
    status = access_request_status(access_request)
    if status == "accepted":
        return {"status": "accepted", "message": "Demande déjà acceptée"}
    if status not in ("pending", "expired"):
        raise api_error(400, "validation", "Cette demande a déjà été traitée")
    await accept_access_request(access_request, property, current_user, datetime.now(timezone.utc))
    return {"status": "accepted", "message": "Demande acceptée : l'acquéreur doit vérifier son identité, signer l'engagement de confidentialité et déclarer l'origine des fonds"}

@api_router.put("/dataroom/{property_id}/access/{request_id}/reject")
async def reject_access_request(property_id: str, request_id: str, reason: Optional[str] = None, data: Optional[AccessRejectInput] = None,
                                current_user: dict = Depends(get_current_user)):
    """Vendeur : refuse la demande (motif facultatif, en corps `{reason}` ou en paramètre)"""
    property, access_request = await _owned_request(property_id, request_id, current_user)
    reason = ((data.reason if data else None) or reason or "").strip() or None
    now = datetime.now(timezone.utc).isoformat()
    await db.dataroom_access.update_one({"id": request_id, "property_id": property_id},
                                        {"$set": {"status": "rejected", "rejected_at": now, "rejection_reason": reason}})
    await create_audit_log(action="ACCESS_REJECTED", property_id=property_id, actor_id=current_user["id"], actor_email=current_user["email"],
                           target_id=access_request.get("buyer_id"), details={"request_id": request_id, "reason": reason})
    if access_request.get("status") != "rejected":
        await system_message(property_id, access_request["buyer_id"], "Le vendeur n'a pas donné suite à votre demande de dossier."
                             + (f" Motif : {reason}" if reason else ""), "access_rejected", receiver_id=access_request["buyer_id"])
        await email_user(access_request.get("buyer_id"), "access_rejected", reason=reason or "non précisé", link=site_url("/"))
    return {"status": "rejected", "message": "Demande refusée"}

@api_router.post("/dataroom/{property_id}/funds-declaration")
async def declare_funds(property_id: str, data: FundsDeclaration, current_user: dict = Depends(get_current_user)):
    """Déclaration d'origine des fonds (après identité et NDA) → accès accordé automatiquement {access_granted:true}"""
    if current_user["role"] != "buyer":
        raise api_error(403, "not_allowed", "Seuls les acquéreurs déclarent l'origine des fonds")
    access = await dataroom_request_for(property_id, current_user["id"])
    status = access_request_status(access)
    if status not in ("accepted", "granted"):
        raise api_error(403, "not_allowed", "Le vendeur doit d'abord accepter votre demande de dossier")
    if not is_user_verified(current_user):
        raise api_error(403, "identity_required", "Vérifiez votre identité avant de déclarer l'origine des fonds")
    if not (access.get("nda_signed_at") or await has_signed_nda(property_id, current_user["id"])):
        raise api_error(403, "nda_required", "Signez l'engagement de confidentialité avant de déclarer l'origine des fonds")
    now = datetime.now(timezone.utc)
    declaration = {"source": data.source, "source_label": FUNDS_SOURCE_LABELS[data.source], "amount": float(data.amount),
                   "financing_partner": (data.financing_partner or "").strip() or None, "declared_at": now.isoformat(),
                   "declared_by": current_user["id"]}
    await db.dataroom_access.update_one({"id": access["id"]}, {"$set": {"funds_declaration": declaration, "funds_declared_at": now.isoformat()}})
    await create_audit_log(action="FUNDS_DECLARED", property_id=property_id, actor_id=current_user["id"], actor_email=current_user["email"],
                           details={"request_id": access["id"], "source": data.source, "amount": float(data.amount)})
    granted = await grant_dataroom_access({**access, "funds_declaration": declaration}, now)
    refreshed = await dataroom_request_for(property_id, current_user["id"])
    return {"access_granted": refreshed.get("status") == "granted", "granted_now": granted, "access_status": access_request_status(refreshed),
            "funds_declaration": declaration}

DATAROOM_OPEN_LISTING_STATUSES = ("published", "paused")

async def close_pending_dataroom_requests(property_id: str, listing_status: Optional[str], now) -> int:
    """Clôt les demandes de dossier en attente d'une annonce qui n'est plus en ligne (retirée, vendue autrement,
    retirée par l'administrateur) : message système à l'acquéreur, aucune relance ni expiration ensuite."""
    at = now.isoformat() if isinstance(now, datetime) else str(now)
    closed = 0
    async for req in db.dataroom_access.find({"property_id": property_id, "status": "pending"}, {"_id": 0, "id": 1, "buyer_id": 1}):
        res = await db.dataroom_access.update_one({"id": req["id"], "status": "pending"}, {"$set": {
            "status": "closed", "closed_at": at, "closed_reason": f"listing_{listing_status or 'unknown'}"}})
        if res.modified_count:
            closed += 1
            await system_message(property_id, req["buyer_id"], "Cette annonce n'est plus en ligne : votre demande de dossier est close.",
                                 "access_closed", receiver_id=req["buyer_id"])
    return closed

async def job_dataroom_requests(now: datetime) -> int:
    """Demandes de dossier sans réponse : relances du vendeur à J+2 et J+5 (carte acquéreur), expiration à J+10 avec e-mail à l'acquéreur"""
    count = 0
    async for req in db.dataroom_access.find({"status": "pending"}, {"_id": 0}):
        requested = _parse_dt(req.get("requested_at") or req.get("created_at"))
        if not requested:
            continue
        property = await db.properties.find_one({"id": req["property_id"]}, {"_id": 0, "id": 1, "seller_id": 1, "title": 1, "status": 1})
        if not property:
            continue
        if property.get("status") not in DATAROOM_OPEN_LISTING_STATUSES:
            # Annonce retirée, vendue ou supprimée : la demande est close, sans relance au vendeur ni e-mail d'expiration
            await close_pending_dataroom_requests(property["id"], property.get("status"), now)
            continue
        # Une demande renouvelée après expiration garde son id : les clés de relance portent la date de la demande
        cycle = f"{req['id']}:{req.get('requested_at') or req.get('created_at')}"
        elapsed = (now - requested).days
        expires = _parse_dt(req.get("expires_at")) or (requested + timedelta(days=DATAROOM_REQUEST_EXPIRY_DAYS))
        if now >= expires:
            if not await claim_once("dataroom_request_expired", cycle):
                continue
            await db.dataroom_access.update_one({"id": req["id"]}, {"$set": {"status": "expired", "expired_at": now.isoformat()}})
            await system_message(req["property_id"], req["buyer_id"],
                                 "Le vendeur n'a pas répondu à votre demande de dossier dans les 10 jours. Nous l'avons relancé ; vous pouvez renouveler votre demande.",
                                 "access_expired", receiver_id=req["buyer_id"])
            await email_user(req["buyer_id"], "dataroom_request_expired", property_title=property.get("title") or "le bien",
                             link=site_url(f"/dataroom/{req['property_id']}"))
            count += 1
            continue
        due = [d for d in DATAROOM_REMINDER_DAYS if elapsed >= d]
        if not due:
            continue
        day = due[-1]
        # Relance d'une démarche engagée par un acquéreur : transactionnelle (la page de désinscription promet que les
        # demandes de dossier continuent de parvenir), toujours limitée à une relance par jour et par personne
        if not await send_reminder(property.get("seller_id"), "dataroom_request_reminder", f"{cycle}:{day}", now,
                                   template="dataroom_request_reminder", transactional=True, days=str(day),
                                   buyer_label=buyer_pseudonym(req["buyer_id"]), property_title=property.get("title") or "votre annonce",
                                   expires_at=fmt_date_fr(expires), link=site_url("/seller/dashboard")):
            continue
        await db.dataroom_access.update_one({"id": req["id"]}, {"$push": {"reminders_sent": {"day": day, "at": now.isoformat()}}})
        count += 1
    return count

@api_router.post("/admin/dataroom/{request_id}/remind")
async def admin_remind_dataroom_request(request_id: str, current_user: dict = Depends(require_admin)):
    """Admin (todo « Demandes de dossier sans réponse ») : relance humaine du vendeur pour une demande en attente,
    au plus une fois par jour et par demande (e-mail transactionnel, indépendant des relances J+2/J+5) → {sent, reminded_at}"""
    req = await db.dataroom_access.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise api_error(404, "not_found", "Demande introuvable")
    if req.get("status") != "pending":
        raise api_error(400, "validation", "Cette demande n'est plus en attente de réponse")
    property = await db.properties.find_one({"id": req["property_id"]}, {"_id": 0, "id": 1, "seller_id": 1, "title": 1, "status": 1})
    if not property or property.get("status") not in DATAROOM_OPEN_LISTING_STATUSES:
        raise api_error(400, "validation", "L'annonce n'est plus en ligne")
    now = datetime.now(timezone.utc)
    if not await claim_once("dataroom_request_admin_reminder", f"{request_id}:{now.strftime('%Y-%m-%d')}"):
        raise api_error(409, "already_reminded", "Le vendeur a déjà été relancé aujourd'hui pour cette demande")
    requested = _parse_dt(req.get("requested_at") or req.get("created_at")) or now
    expires = _parse_dt(req.get("expires_at")) or (requested + timedelta(days=DATAROOM_REQUEST_EXPIRY_DAYS))
    await email_user(property.get("seller_id"), "dataroom_request_reminder", days=str(max((now - requested).days, 1)),
                     buyer_label=buyer_pseudonym(req["buyer_id"]), property_title=property.get("title") or "votre annonce",
                     expires_at=fmt_date_fr(expires), link=site_url("/seller/dashboard"))
    await db.dataroom_access.update_one({"id": request_id}, {"$push": {"reminders_sent": {"day": "admin", "at": now.isoformat(),
                                                                                         "by": current_user["id"]}}})
    await create_audit_log(action="ACCESS_REQUEST_REMINDED", property_id=property["id"], actor_id=current_user["id"],
                           actor_email=current_user["email"], target_id=property.get("seller_id"), details={"request_id": request_id})
    return {"sent": True, "reminded_at": now.isoformat()}

def commission_info_for(property: dict) -> dict:
    """Honoraires affichés sur la fiche (SPEC §7.1) : toujours à la charge du vendeur, TTC d'abord, estimation sur le prix
    demandé → {payer:'vendeur', rate_percent_ttc, rate_percent_ht, estimate_ht, estimate_ttc, minimum_ht, minimum_ttc,
    terms_version}"""
    config = commission_config()
    info = {
        "payer": COMMISSION_PAYER,
        "rate_percent_ttc": config["rate_percent_ttc"],
        "rate_percent_ht": config["rate_percent_ht"],
        "minimum_ht": config["minimum_ht"],
        "minimum_ttc": config["minimum_ttc"],
        "terms_version": property.get("commission_terms_version") or COMMISSION_TERMS_VERSION,
        "estimate_ht": None,
        "estimate_ttc": None,
    }
    if property.get("asking_price"):
        c = calculate_commission(float(property["asking_price"]))
        info.update({"estimate_ht": c["final_commission_ht"], "estimate_ttc": c["final_commission_ttc"], "base": "prix demandé"})
    return info

# ============ CONTRATS v2 : variables, chaîne de preuve, PDF (SPEC §3.2 à §3.5) ============
from zoneinfo import ZoneInfo
from xml.sax.saxutils import escape as _xml_escape
from reportlab.lib import colors

PARIS_TZ = ZoneInfo("Europe/Paris")

def api_error(status_code: int, code: str, message: str, **extra) -> HTTPException:
    """Erreur au format de l'API v2 : detail = {code, message, ...}"""
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})

def add_months(dt: datetime, months: int) -> datetime:
    """Même jour du mois, n mois plus tard (31 janvier + 1 mois = 28/29 février)"""
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    import calendar
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)

def fmt_date_fr(value) -> str:
    dt = value if isinstance(value, datetime) else _parse_dt(value)
    return dt.astimezone(PARIS_TZ).strftime("%d/%m/%Y") if dt else ""

def fmt_datetime_paris(value) -> str:
    dt = value if isinstance(value, datetime) else _parse_dt(value)
    return dt.astimezone(PARIS_TZ).strftime("%d/%m/%Y à %H:%M:%S (heure de Paris)") if dt else ""

def fmt_datetime_utc(value) -> str:
    dt = value if isinstance(value, datetime) else _parse_dt(value)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC") if dt else ""

def fmt_siren_fr(value) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return f"{digits[:3]} {digits[3:6]} {digits[6:9]}" if len(digits) >= 9 else digits

def fmt_address(value) -> str:
    """Adresse postale en une ligne, à partir d'une chaîne ou d'un objet {line1, line2?, postal_code, city}"""
    if isinstance(value, dict):
        parts = [str(value.get(k) or "").strip() for k in ("line1", "line2")]
        locality = " ".join(str(value.get(k) or "").strip() for k in ("postal_code", "city")).strip()
        return ", ".join(p for p in parts + [locality] if p)
    return " ".join(str(value or "").split())

# Objet de la vente dans les contrats (mandat, offre d'achat) et dans les e-mails
SALE_OBJECT_MANDATE = {
    "bien": "la vente du bien",
    "parts": "la cession des parts de la société propriétaire du bien{company}",
    "indifferent": "la vente du bien ou la cession des parts de la société propriétaire{company}, au choix des parties",
}
SALE_OBJECT_OFFER = {
    "bien": "le bien désigné ci-dessus, vendu occupé",
    "parts": "la totalité des parts de la société{company} propriétaire du bien désigné ci-dessus",
}
SALE_OBJECT_LABELS = {"bien": "achat du bien", "parts": "achat des parts de la société propriétaire",
                      "indifferent": "vente du bien ou des parts"}
MANDANT_CAPACITY_LABELS = {"proprietaire": "propriétaire du bien", "coindivisaire": "co-indivisaire du bien",
                           "gerant": "gérant de la société propriétaire", "mandataire": "mandataire du propriétaire"}

def property_address_text(property: dict) -> str:
    """Adresse complète du bien (confidentielle) : « 12 rue X, 69007 Lyon »"""
    locality = " ".join(str(property.get(k) or "").strip() for k in ("postal_code", "city")).strip()
    return ", ".join(p for p in [str(property.get("address") or "").strip(), locality] if p)

def property_location_text(property: dict) -> str:
    """Localisation publique : « Lyon (69) »"""
    city = str(property.get("city") or "").strip()
    dep = property.get("department")
    if city and dep:
        return f"{city} ({dep})"
    return city or (taxonomy.departement_label(dep) if dep else "") or "France"

def company_text(property: dict, with_siege: bool = True) -> str:
    """« SCI des Tilleuls (SIREN 123 456 789, siège : …) » ; '' sans société"""
    name = (property.get("company_name") or "").strip()
    if not name:
        return ""
    siren = re.sub(r"\D", "", str(property.get("siret") or ""))[:9]
    details = [f"SIREN {fmt_siren_fr(siren)}"] if len(siren) == 9 else []
    siege = ((property.get("company_lookup") or {}).get("adresse") or "").strip()
    if with_siege and siege:
        details.append(f"siège : {siege}")
    return name + (f" ({', '.join(details)})" if details else "")

def mandant_capacity(property: dict, user: dict) -> str:
    """Qualité du signataire du mandat (SPEC §7.2 art. 1), en toutes lettres"""
    capacity = property.get("mandant_capacity") or ("gerant" if property.get("owner_type") in COMPANY_OWNER_TYPES else "proprietaire")
    if capacity == "coindivisaire":
        return "co-indivisaire du bien, déclarant agir avec l'accord de tous les indivisaires"
    if capacity == "gerant":
        return f"gérant de la société {company_text(property)}, propriétaire du bien"
    if capacity == "mandataire":
        return ("mandataire du propriétaire du bien, en vertu d'un pouvoir écrit qu'il s'engage à présenter au Mandataire et au "
                "notaire à première demande")
    return "propriétaire du bien"

def lease_summary(property: dict) -> dict:
    """Variables du bail en cours (mandat, offre d'achat)"""
    deposit = property.get("deposit")
    return {
        "BAIL_TYPE": taxonomy.lease_type_label(property.get("lease_type")).lower() or "bail en cours",
        "LOYER": fmt_eur_fr(property["rent_monthly"]) if property.get("rent_monthly") else "",
        "BAIL_DEBUT": fmt_date_fr(property.get("lease_start")) if property.get("lease_start") else "",
        "DEPOT": (f"dépôt de garantie versé par le locataire : {fmt_eur_fr(deposit)}" if isinstance(deposit, (int, float)) and deposit > 0
                  else "aucun dépôt de garantie n'a été versé par le locataire"),
    }

def copro_text(property: dict) -> str:
    if property.get("is_copro"):
        lots = property.get("copro_lots")
        text = f"Le bien dépend d'une copropriété de {lots} lots" if lots else "Le bien dépend d'une copropriété"
        if property.get("copro_procedure"):
            text += " qui fait l'objet d'une procédure en cours (articles 29-1 A et 29-1 de la loi du 10 juillet 1965)"
        return text + "."
    if property.get("is_copro") is False:
        return "Le bien ne dépend pas d'une copropriété."
    return "Le Mandant précise sur l'annonce si le bien dépend d'une copropriété."

def property_contract_variables(property: dict) -> dict:
    """Variables communes aux contrats décrivant le bien et la plateforme (jamais de blanc)"""
    ref = f"VL-{(property.get('id') or '')[:8].upper()}"
    return {
        "BIEN_TITRE": property.get("title") or taxonomy.property_title(property.get("property_type"), property.get("city"),
                                                                       property.get("department"), property.get("surface"),
                                                                       property.get("rooms"), property.get("units_count")),
        "BIEN_ADRESSE": property_address_text(property),
        "BIEN_LOCALISATION": property_location_text(property),
        "BIEN_COPROPRIETE": copro_text(property),
        **lease_summary(property),
        "PRIX_DEMANDE": fmt_eur_fr(property["asking_price"]) if property.get("asking_price") else "",
        "BAREME_COMMISSION": commission_scale_text(),
        "MARQUE": site_name(),
        "CARTE_T": LEGAL_ENTITY["carte_t"],
        "CARTE_T_CCI": LEGAL_ENTITY["carte_t_issuer"],
        "CARTE_T_VALIDITE": LEGAL_ENTITY["carte_t_valid_until"],
        "RC_PRO": ("RC professionnelle : " + LEGAL_ENTITY["rc_pro"] + ".") if LEGAL_ENTITY.get("rc_pro")
                  else "RC professionnelle souscrite conformément à la loi n° 70-9 du 2 janvier 1970.",
        "PLATEFORME_CAPITAL": fmt_eur_fr(LEGAL_ENTITY.get("capital") or 0),
        "PLATEFORME_SIREN": fmt_siren_fr(LEGAL_ENTITY["siren"]),
        "ANNONCE_REF": ref,
        "LISTING_ID": property.get("id", ""),
    }

def seller_identity_text(seller: Optional[dict], property: dict) -> str:
    """Identité du vendeur (engagement après signature, offre d'achat) : nom vérifié et, le cas échéant, la société"""
    seller = seller or {}
    name = f"{seller.get('verified_first_name') or seller.get('first_name') or ''} {seller.get('verified_last_name') or seller.get('last_name') or ''}".strip()
    name = name or "le vendeur de l'annonce"
    company = company_text(property, with_siege=False)
    if property.get("owner_type") in COMPANY_OWNER_TYPES and company:
        return f"{name}, agissant pour la société {company}, propriétaire du bien"
    return name

def buyer_identity_text(user: dict) -> str:
    """Identité de l'acquéreur telle que vérifiée (rapport Stripe : nom, prénom, date de naissance si disponible),
    adresse e-mail confirmée, société et SIREN s'ils existent. Aucune mention vide."""
    first = user.get("verified_first_name") or user.get("first_name") or ""
    last = user.get("verified_last_name") or user.get("last_name") or ""
    text = f"{first} {last}".strip() or "Acquéreur"
    birth = user.get("verified_birth_date") or user.get("birth_date")
    if birth:
        text += f", né(e) le {fmt_date_fr(birth) or birth}"
    text += f", adresse électronique confirmée : {user.get('email', '')}"
    profile = user.get("buyer_profile") or {}
    company = profile.get("company_name") if profile.get("project_type") in ("sci", "societe", "professionnel") else None
    company = company or (user.get("company_name") if profile.get("siren") else None)
    siren = user.get("siren") or profile.get("siren")
    if company:
        text += f", agissant pour le compte de la société {company}"
        if siren:
            text += f" (SIREN {fmt_siren_fr(siren)})"
    if user.get("verified_at"):
        text += f". Identité vérifiée le {fmt_date_fr(user['verified_at'])}"
    return text + "."

def render_template(template: str, values: dict) -> str:
    content = template
    for key, value in values.items():
        content = content.replace(f"{{{{{key}}}}}", str(value) if value not in (None, "") else "")
    return content

def is_test_context(*related) -> bool:
    """Document de test : mode test actif, ou rattaché à une donnée de test (utilisateur, annonce, contrat…)"""
    return test_mode_enabled() or is_test_related(*related)

def with_test_banner(content: str, test: bool) -> str:
    """Mention « DOCUMENT DE TEST — SANS VALEUR JURIDIQUE » en tête du texte d'un contrat de test (mandat, NDA, offre)"""
    if not test or (content or "").startswith(TEST_DOCUMENT_BANNER):
        return content
    return f"{TEST_DOCUMENT_BANNER}\n\n{content}"

def missing_template_variables(content: str) -> list:
    return sorted(set(re.findall(r"\{\{([A-Z_0-9]+)\}\}", content)))

# ---- Chaîne de preuve (SPEC §3.5) : chaque preuve inclut l'empreinte de la précédente du même utilisateur ----
def evidence_sha256(evidence: dict) -> str:
    return hashlib.sha256(json.dumps(evidence, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()

async def previous_evidence_hash(user_id: str) -> Optional[str]:
    last = await db.documents.find_one({"signer_id": user_id, "evidence_sha256": {"$exists": True}},
                                       {"_id": 0, "evidence_sha256": 1}, sort=[("signed_at", -1)])
    return last["evidence_sha256"] if last else None

async def record_signature(contract: dict, signer: dict, evidence: dict, doc_type: str, role: str,
                           now: datetime, document_sha256: str, extra: Optional[dict] = None) -> dict:
    """Enregistre une signature dans db.documents avec son dossier de preuve chaîné et un jeton d'accès au PDF"""
    evidence = dict(evidence)
    evidence["document_sha256"] = document_sha256
    evidence["signed_at"] = now.isoformat()
    evidence["signed_at_paris"] = fmt_datetime_paris(now)
    evidence["previous_evidence_sha256"] = await previous_evidence_hash(signer["id"])
    record = {
        "id": str(uuid.uuid4()),
        "contract_id": contract["id"],
        "contract_number": contract.get("contract_number"),
        "property_id": contract.get("property_id"),
        "doc_type": doc_type,
        "signer_id": signer["id"],
        "signer_email": signer.get("email"),
        "signer_role": role,
        "signed_at": now.isoformat(),
        "signature_hash": hashlib.sha256(f"{contract['id']}{signer['id']}{now.isoformat()}{document_sha256}".encode()).hexdigest(),
        "ip_address": evidence.get("ip"),
        "evidence": evidence,
        "evidence_sha256": evidence_sha256(evidence),
        "access_token": secrets.token_urlsafe(24),
        **(extra or {}),
    }
    mark_test(record, contract, signer)
    await db.documents.insert_one(record)
    record.pop("_id", None)
    return record

def document_pdf_path(record: dict) -> str:
    return f"/api/documents/{record.get('property_id')}/{record['id']}/pdf"

def document_pdf_link(record: dict) -> str:
    """Lien authentifié par jeton (e-mails) vers l'exemplaire PDF"""
    return site_url(f"{document_pdf_path(record)}?token={record.get('access_token', '')}")

def public_evidence(evidence: Optional[dict]) -> dict:
    ev = evidence or {}
    return {
        "document_sha256": ev.get("document_sha256"),
        "previous_evidence_sha256": ev.get("previous_evidence_sha256"),
        "ip": ev.get("ip"),
        "user_agent": ev.get("user_agent"),
        "identity": ev.get("identity") or {},
        "method": ev.get("method"),
        "signed_at": ev.get("signed_at"),
        "signed_at_paris": ev.get("signed_at_paris"),
        "otp": {k: v for k, v in (ev.get("otp") or {}).items() if k in ("channel", "destination", "sent_at", "verified_at")},
    }

async def presented_buyers_view(property: dict) -> list:
    """Acquéreurs présentés (engagement de confidentialité signé) : pseudonyme, nom et société révélés après l'engagement"""
    rows = []
    for p in property.get("presented_buyers") or []:
        user = await db.users.find_one({"id": p.get("buyer_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company_name": 1,
                                                                   "verified_first_name": 1, "verified_last_name": 1, "buyer_profile": 1})
        name = ""
        company_name = None
        if user:
            name = f"{user.get('verified_first_name') or user.get('first_name') or ''} {user.get('verified_last_name') or user.get('last_name') or ''}".strip()
            company_name = user.get("company_name") or (user.get("buyer_profile") or {}).get("company_name")
        rows.append({"buyer_id": p.get("buyer_id"), "label": buyer_pseudonym(p.get("buyer_id")), "name": name or None,
                     "company_name": company_name or None, "at": p.get("at"), "nda_contract_id": p.get("nda_contract_id")})
    return rows

async def add_presented_buyer(property_id: str, buyer_id: str, contract_id: str, now: datetime) -> bool:
    """Inscrit l'acquéreur sur la liste nominative des présentés (une seule fois)"""
    res = await db.properties.update_one(
        {"id": property_id, "presented_buyers.buyer_id": {"$ne": buyer_id}},
        {"$push": {"presented_buyers": {"buyer_id": buyer_id, "at": now.isoformat(), "nda_contract_id": contract_id}}})
    return res.modified_count > 0

# ---- PDF d'un document signé avec page de preuve ----
CONTRACT_TITLES = {"mandat": "Mandat de vente simple", "nda": "Engagement de confidentialité et de non-contournement",
                   "offer": "Offre d'achat"}

def contract_title(contract: dict) -> str:
    base = CONTRACT_TITLES.get(contract.get("type"), "Document")
    if contract.get("type") == "mandat" and contract.get("registry_number"):
        return f"{base} n° {contract['registry_number']} ({contract.get('contract_number', '')})"
    return f"{base} n° {contract.get('contract_number', '')}"

def _pdf_styles() -> dict:
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    ss = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("CTitle", parent=ss["Title"], fontSize=15, leading=19, spaceAfter=6, textColor=colors.HexColor("#0b1220")),
        "sub": ParagraphStyle("CSub", parent=ss["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#6b7280"), spaceAfter=12),
        "h": ParagraphStyle("CH", parent=ss["Heading2"], fontSize=12, leading=15, spaceBefore=10, spaceAfter=6, textColor=colors.HexColor("#0b1220")),
        "body": ParagraphStyle("CBody", parent=ss["Normal"], fontSize=9.5, leading=13.5, spaceAfter=6),
        "cell": ParagraphStyle("CCell", parent=ss["Normal"], fontSize=8.5, leading=11),
        "mono": ParagraphStyle("CMono", parent=ss["Normal"], fontName="Courier", fontSize=7.5, leading=10),
    }

def _proof_rows(proof: dict, st: dict) -> list:
    from reportlab.platypus import Paragraph
    ev = proof.get("evidence") or {}
    identity = ev.get("identity") or {}
    otp = ev.get("otp") or {}
    rows = [
        ("Signataire", f"{proof.get('signer_label', '')} ({proof.get('role_label', '')})"),
        ("Procédé", {"otp_email": "code à usage unique envoyé par e-mail", "click": "validation dans l'espace authentifié",
                     "automatic": "contre-signature automatique de la plateforme"}.get(ev.get("method"), ev.get("method") or "")),
        ("Date (UTC)", fmt_datetime_utc(ev.get("signed_at") or proof.get("signed_at"))),
        ("Date (Paris)", ev.get("signed_at_paris") or fmt_datetime_paris(proof.get("signed_at"))),
        ("Adresse IP", ev.get("ip") or "non applicable"),
        ("Navigateur", (ev.get("user_agent") or "non applicable")[:160]),
        ("Identité", (f"vérifiée : {identity.get('verified_name')}" if identity.get("verified_name") else
                      ("vérifiée" if identity.get("identity_verified") else "non vérifiée")) if identity else "non applicable"),
    ]
    if otp:
        rows.append(("Code de signature", f"envoyé à {otp.get('destination', '')} le {fmt_datetime_utc(otp.get('sent_at'))}, "
                                          f"vérifié le {fmt_datetime_utc(otp.get('verified_at'))}"))
    if proof.get("registry_number"):
        rows.append(("Registre des mandats", f"n° {proof['registry_number']}"))
    rows += [
        ("Empreinte SHA-256 du document", ev.get("document_sha256") or ""),
        ("Empreinte de la preuve", proof.get("evidence_sha256") or ""),
        ("Empreinte de la preuve précédente du signataire", ev.get("previous_evidence_sha256") or "aucune (première signature)"),
        ("Empreinte de signature", proof.get("signature_hash") or ""),
    ]
    return [(Paragraph(_xml_escape(k), st["cell"]), Paragraph(_xml_escape(str(v)), st["mono"] if "Empreinte" in k else st["cell"]))
            for k, v in rows]

def pdf_test_banner(width: float) -> list:
    """Bandeau rouge « DOCUMENT DE TEST — SANS VALEUR JURIDIQUE » placé en tête d'un PDF de test"""
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
    style = ParagraphStyle("TestBanner", fontName="Helvetica-Bold", fontSize=12, leading=15, alignment=1, textColor=colors.HexColor("#b42318"))
    banner = Table([[Paragraph(_xml_escape(TEST_DOCUMENT_BANNER), style)]], colWidths=[width])
    banner.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1.2, colors.HexColor("#b42318")),
                                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fef3f2")),
                                ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return [banner, Spacer(1, 10)]

def draw_test_watermark(canvas, doc) -> None:
    """Filigrane diagonal et mention en pied de chaque page d'un PDF de test"""
    from reportlab.lib.pagesizes import A4
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(colors.Color(0.71, 0.14, 0.09, alpha=0.12))
    canvas.setFont("Helvetica-Bold", 54)
    canvas.translate(width / 2, height / 2)
    canvas.rotate(45)
    canvas.drawCentredString(0, 0, "DOCUMENT DE TEST")
    canvas.restoreState()
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#b42318"))
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawCentredString(width / 2, 22, TEST_DOCUMENT_BANNER)
    canvas.restoreState()

def signed_document_pdf(title: str, subtitle: str, content: str, proofs: list, addenda: Optional[list] = None,
                        test: bool = False) -> bytes:
    """PDF : texte intégral du document, addenda (prolongations, contre-proposition), puis page de preuve (SPEC §3.5).
    `test` : bandeau et filigrane « DOCUMENT DE TEST — SANS VALEUR JURIDIQUE » (mode test)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    st = _pdf_styles()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                            title=(f"{TEST_DOCUMENT_BANNER} — {title}" if test else title), author=f"{LEGAL_ENTITY['denomination']} SAS")
    elements = pdf_test_banner(doc.width) if test else []
    if test and (content or "").startswith(TEST_DOCUMENT_BANNER):
        content = content[len(TEST_DOCUMENT_BANNER):].lstrip("\n")  # la mention figure déjà dans le bandeau
    elements += [Paragraph(_xml_escape(title), st["title"]), Paragraph(_xml_escape(subtitle), st["sub"])]
    for block in (content or "").split("\n\n"):
        if block.strip():
            elements.append(Paragraph(_xml_escape(block.strip()).replace("\n", "<br/>"), st["body"]))
    for addendum in addenda or []:
        elements.append(Paragraph(_xml_escape(addendum.get("title", "")), st["h"]))
        elements.append(Paragraph(_xml_escape(addendum.get("text", "")).replace("\n", "<br/>"), st["body"]))
    elements.append(PageBreak())
    elements.append(Paragraph("Dossier de preuve", st["title"]))
    elements.append(Paragraph(_xml_escape(
        f"Signatures électroniques par code à usage unique (articles 1366 et 1367 du code civil). Dossier conservé dix ans par "
        f"{LEGAL_ENTITY['denomination']} SAS, carte professionnelle n° {LEGAL_ENTITY['carte_t']} ({LEGAL_ENTITY['carte_t_issuer']}). "
        "Chaque preuve contient l'empreinte de la preuve précédente du même signataire, ce qui rend l'historique vérifiable."), st["sub"]))
    if not proofs:
        elements.append(Paragraph("Document non signé : aucune preuve enregistrée.", st["body"]))
    for i, proof in enumerate(proofs, 1):
        elements.append(Paragraph(_xml_escape(f"Signature {i} — {proof.get('label', '')}"), st["h"]))
        table = Table(_proof_rows(proof, st), colWidths=[5.2 * cm, 11.8 * cm])
        table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e3e7ee")),
                                   ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f5f7fa")),
                                   ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
        elements.append(table)
        elements.append(Spacer(1, 6))
    if test:
        doc.build(elements, onFirstPage=draw_test_watermark, onLaterPages=draw_test_watermark)
    else:
        doc.build(elements)
    return buffer.getvalue()

def role_label(role: Optional[str]) -> str:
    return {"seller": "le Mandant (vendeur)", "buyer": "l'Acquéreur", "platform": f"{LEGAL_ENTITY['denomination']} SAS"}.get(role or "", role or "")

async def contract_proofs(contract: dict) -> list:
    """Toutes les signatures d'un contrat (db.documents) puis la contre-signature de la plateforme, dans l'ordre"""
    proofs = []
    records = await db.documents.find({"contract_id": contract["id"]}, {"_id": 0}).sort("signed_at", 1).to_list(50)
    if not records and contract.get("signature_evidence"):
        # Mandats et NDA signés avant la chaîne de preuve : la preuve est portée par le contrat lui-même
        records = [{"signer_id": contract.get("seller_id") if contract.get("type") == "mandat" else contract.get("buyer_id"),
                    "signer_role": "seller" if contract.get("type") == "mandat" else "buyer", "signed_at": contract.get("signed_at"),
                    "evidence": contract.get("signature_evidence"), "signature_hash": contract.get("seller_signature_hash") or contract.get("signature_hash")}]
    for r in records:
        user = await db.users.find_one({"id": r.get("signer_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company_name": 1,
                                                                    "verified_first_name": 1, "verified_last_name": 1})
        name = (f"{user.get('verified_first_name') or user.get('first_name') or ''} {user.get('verified_last_name') or user.get('last_name') or ''}".strip()
                if user else "") or buyer_pseudonym(r.get("signer_id"))
        proofs.append({"label": r.get("label") or {"mandat": "mandat", "mandat_renewal": "prolongation du mandat", "nda": "engagement de confidentialité",
                                                    "offer": "offre d'achat", "offer_counter_proposal": "contre-proposition du vendeur",
                                                    "offer_counter": "acceptation de la contre-proposition"}.get(r.get("doc_type"), "document"),
                       "signer_label": name, "role_label": role_label(r.get("signer_role")),
                       "signed_at": r.get("signed_at"), "evidence": r.get("evidence"), "evidence_sha256": r.get("evidence_sha256"),
                       "signature_hash": r.get("signature_hash"),
                       "registry_number": contract.get("registry_number") if r.get("doc_type", "").startswith("mandat") else None})
    counter = contract.get("countersignature")
    if counter:
        proofs.append({"label": "contre-signature", "signer_label": counter.get("by", ""), "role_label": role_label("platform"),
                       "signed_at": counter.get("at"), "evidence": counter.get("evidence") or {}, "evidence_sha256": counter.get("evidence_sha256"),
                       "signature_hash": counter.get("signature_hash"), "registry_number": contract.get("registry_number")})
    return proofs

async def contract_pdf_bytes(contract: dict) -> bytes:
    """Exemplaire PDF complet d'un contrat généré (texte signé, addenda, page de preuve)"""
    addenda = []
    for r in contract.get("renewals") or []:
        addenda.append({"title": f"Prolongation du mandat signée le {fmt_date_fr(r.get('at'))}",
                        "text": f"Par signature électronique du {fmt_datetime_paris(r.get('at'))}, le Mandant a prolongé le mandat de "
                                f"{MANDATE_DURATION_MONTHS} mois : nouvelle échéance le {fmt_date_fr(r.get('new_ends_at'))}, clause de suite "
                                f"jusqu'au {fmt_date_fr(r.get('new_tail_ends_at'))}."})
    for a in contract.get("addenda") or []:
        addenda.append({"title": a.get("title", ""), "text": a.get("text", "")})
    if contract.get("type") == "mandat" and contract.get("status") in ("denounced", "expired", "void", "withdrawn_retractation"):
        label = {"denounced": f"Mandat dénoncé le {fmt_date_fr(contract.get('denounced_at'))}, effet le {fmt_date_fr(contract.get('effective_at'))}",
                 "expired": f"Mandat arrivé à échéance le {fmt_date_fr(contract.get('ends_at'))}",
                 "void": f"Mandat caduc depuis le {fmt_date_fr(contract.get('void_at'))} ({contract.get('void_reason') or 'annonce retirée'})",
                 "withdrawn_retractation": f"Rétractation du Mandant le {fmt_date_fr(contract.get('denounced_at'))}, avec effet immédiat : "
                                           "aucune somme n'est due"}[contract["status"]]
        addenda.append({"title": "Fin du mandat", "text": label + f". Clause de suite jusqu'au {fmt_date_fr(contract.get('tail_ends_at'))}."
                        if contract.get("tail_ends_at") else label + "."})
    content = contract.get("content") or ""
    if contract.get("type") == "nda" and contract.get("status") not in ("signed", "buyer_signed", "fully_signed"):
        content = contract.get("content") or ""
    subtitle = (f"Conditions du {contract.get('terms_date') or CONTRACT_TERMS_DATE} — généré par {site_name()} ({LEGAL_ENTITY['denomination']} SAS) — "
                f"statut : {CONTRACT_STATUS_LABELS.get(contract.get('status'), contract.get('status') or '')}")
    proofs = await contract_proofs(contract)
    return await asyncio.to_thread(signed_document_pdf, contract_title(contract), subtitle, content, proofs, addenda,
                                   bool(contract.get("is_test")))

CONTRACT_STATUS_LABELS = {"pending_signature": "en attente de signature", "signed": "signé", "fully_signed": "signé par les deux parties",
                          "countersigned": "signé par les deux parties", "denounced": "dénoncé", "expired": "expiré", "void": "caduc",
                          "withdrawn_retractation": "rétractation", "rejected": "refusé", "cancelled": "annulé"}

def pdf_response(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "private, no-store"})

# ============ ENGAGEMENT DE CONFIDENTIALITÉ ET DE NON-CONTOURNEMENT (SPEC §7.3) ============
class GetContractForSignatureRequest(BaseModel):
    property_id: str
    doc_type: Literal["nda"]  # identifiant technique conservé : engagement de confidentialité et de non-contournement

# Variables qui lèvent l'anonymat (adresse du bien, identité du vendeur) : masquées tant que l'engagement n'est pas signé
NDA_REVEALED_VARIABLES = ["BIEN_ADRESSE", "VENDEUR_IDENTITE"]
NDA_HIDDEN_PLACEHOLDER = "[communiqué après signature]"
# Statuts d'une demande de dossier acceptée par le vendeur (`accepted` ; `validated` / `loi_pending` : anciennes valeurs,
# équivalentes à `accepted`)
DATAROOM_ACCEPTED_STATUSES = ("accepted", "granted", "validated", "loi_pending")

async def dataroom_request_for(property_id: str, buyer_id: str) -> Optional[dict]:
    return await db.dataroom_access.find_one({"property_id": property_id, "buyer_id": buyer_id}, {"_id": 0})

@api_router.post("/contracts/generate-for-signature")
async def generate_contract_for_signature(data: GetContractForSignatureRequest, current_user: dict = Depends(get_current_user)):
    """Génère l'engagement de confidentialité et de non-contournement de l'acquéreur pour une annonce (adresse et identité
    du vendeur masquées jusqu'à la signature). Exige : rôle acquéreur, adresse e-mail confirmée, identité vérifiée
    (403 `identity_required`) et demande de dossier acceptée par le vendeur (403 `not_allowed`)."""
    if current_user.get("role") != "buyer":
        raise api_error(403, "not_allowed", "Seuls les acquéreurs signent l'engagement de confidentialité")
    property = await db.properties.find_one({"id": data.property_id}, {"_id": 0})
    if not property or property.get("status") != "published":
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    require_verified_email(current_user)
    if not is_user_verified(current_user):
        raise api_error(403, "identity_required", "Vérifiez votre identité avant de signer l'engagement de confidentialité")
    access = await dataroom_request_for(data.property_id, current_user["id"])
    if not access or access.get("status") not in DATAROOM_ACCEPTED_STATUSES:
        raise api_error(403, "not_allowed", "Le vendeur doit d'abord accepter votre demande de dossier")

    existing_signature = await db.documents.find_one({"property_id": data.property_id, "doc_type": "nda", "signer_id": current_user["id"]})
    if existing_signature:
        existing_contract = await db.generated_contracts.find_one(
            {"property_id": data.property_id, "buyer_id": current_user["id"], "type": "nda", "status": "signed"}, {"_id": 0})
        return {"already_signed": True, "contract": existing_contract, "message": "Engagement de confidentialité déjà signé"}

    seller = await db.users.find_one({"id": property.get("seller_id")}, {"_id": 0, "password_hash": 0})
    template_doc = await db.contract_templates.find_one({"type": "nda"}, {"_id": 0})
    template = template_doc["content"] if template_doc else DEFAULT_NDA_TEMPLATE
    settings_doc = await db.platform_settings.find_one({"type": "contracts"}, {"_id": 0})
    settings = {**DEFAULT_PLATFORM_SETTINGS, **(settings_doc["settings"] if settings_doc else {})}
    now = datetime.now(timezone.utc)

    existing_contract = await db.generated_contracts.find_one(
        {"property_id": data.property_id, "buyer_id": current_user["id"], "type": "nda", "status": {"$in": ["draft", "pending_signature"]}}, {"_id": 0})
    contract_number = existing_contract["contract_number"] if existing_contract else f"ENG-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    variables = {
        **settings,
        "ACQUEREUR_IDENTITE": buyer_identity_text(current_user),
        "VENDEUR_IDENTITE": seller_identity_text(seller, property),
        **property_contract_variables(property),
        "NDA_NUMERO": contract_number,
        "DATE_SIGNATURE": SIGNATURE_DATE_PENDING,
    }
    if not variables["BIEN_ADRESSE"]:
        variables["BIEN_ADRESSE"] = property_location_text(property)
    full_content = render_template(template, variables)
    missing = missing_template_variables(full_content)
    if missing:
        raise api_error(400, "validation", "Le texte de l'engagement ne peut pas être complété", missing=missing)
    # L'adresse du bien et l'identité du vendeur ne sont révélées qu'une fois l'engagement signé (Annexe A)
    generated_content = render_template(template, {**variables, **{k: NDA_HIDDEN_PLACEHOLDER for k in NDA_REVEALED_VARIABLES}})
    nda_test = is_test_context(current_user, property, existing_contract)
    full_content = with_test_banner(full_content, nda_test)
    generated_content = with_test_banner(generated_content, nda_test)

    if existing_contract:
        # Le projet non signé est régénéré avec les données à jour (le code en cours reste lié au même identifiant)
        regenerated = {"content": generated_content, "content_after_signature": full_content, "updated_at": now.isoformat()}
        if nda_test:
            regenerated["is_test"] = True
        await db.generated_contracts.update_one({"id": existing_contract["id"]}, {"$set": regenerated})
        return {"already_signed": False, "contract_id": existing_contract["id"], "contract_number": contract_number,
                "content": generated_content, "type": "nda", "title": CONTRACT_TITLES["nda"], "terms_version": NDA_TERMS_VERSION,
                "terms_date": CONTRACT_TERMS_DATE}

    contract_doc = {
        "id": str(uuid.uuid4()),
        "contract_number": contract_number,
        "type": "nda",
        "property_id": data.property_id,
        "buyer_id": current_user["id"],
        "seller_id": property.get("seller_id"),
        "content": generated_content,
        "content_after_signature": full_content,
        "status": "pending_signature",
        "signers_pending": [current_user["id"]],
        "terms_version": NDA_TERMS_VERSION,
        "terms_date": CONTRACT_TERMS_DATE,
        "created_at": now.isoformat(),
        "auto_generated": True,
    }
    if nda_test:
        contract_doc["is_test"] = True
    await db.generated_contracts.insert_one(contract_doc)
    return {"already_signed": False, "contract_id": contract_doc["id"], "contract_number": contract_number,
            "content": generated_content, "type": "nda", "title": CONTRACT_TITLES["nda"], "terms_version": NDA_TERMS_VERSION,
            "terms_date": CONTRACT_TERMS_DATE}

# ============ SIGNATURE ÉLECTRONIQUE PAR CODE À USAGE UNIQUE ============
OTP_TTL_SECONDS = 600
OTP_RESEND_SECONDS = 60
OTP_MAX_ATTEMPTS = 5

def otp_signature_enabled() -> bool:
    return os.environ.get("FF_OTP_SIGNATURE", "true").strip().lower() not in ("false", "0", "no")

def mask_email(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    return (local[:1] + "***@" + domain) if domain else "***"

def otp_hash(code: str, contract_id: str) -> str:
    return hashlib.sha256(f"{code}:{contract_id}:{JWT_SECRET}".encode()).hexdigest()

def contract_parties(contract: dict) -> set:
    return {x for x in (contract.get("seller_id"), contract.get("buyer_id")) if x}

def signature_pending_for(contract: dict, user_id: str) -> bool:
    """L'utilisateur a-t-il encore une signature à apposer sur ce document ? (`signers_pending` tenu à jour par les routes ;
    repli pour les contrats antérieurs : signataire attendu et statut non signé)"""
    pending = contract.get("signers_pending")
    if pending is not None:
        return user_id in pending
    expected = contract.get("seller_id") if contract.get("type") == "mandat" else contract.get("buyer_id")
    return expected == user_id and contract.get("status") not in ("signed", "buyer_signed", "fully_signed")

class SignatureCodeRequest(BaseModel):
    contract_id: str

class ContractSignature(BaseModel):
    otp_code: Optional[str] = None

DOC_LABELS = {"mandat": "mandat de vente simple", "nda": "engagement de confidentialité et de non-contournement", "offer": "offre d'achat"}

@api_router.post("/signatures/request-code")
@limiter.limit("10/minute")
async def request_signature_code(request: Request, data: SignatureCodeRequest, background_tasks: BackgroundTasks,
                                 current_user: dict = Depends(get_current_user)):
    """Envoie par e-mail un code à 6 chiffres permettant de signer ce document (10 minutes, 5 essais).
    Exige une adresse e-mail confirmée (double opt-in) et une identité vérifiée. Sert aussi à la contre-signature
    d'une offre par le vendeur et à la prolongation d'un mandat."""
    contract = await db.generated_contracts.find_one({"id": data.contract_id}, {"_id": 0})
    if not contract or current_user["id"] not in contract_parties(contract):
        raise HTTPException(status_code=404, detail="Document introuvable")
    if not signature_pending_for(contract, current_user["id"]):
        raise HTTPException(status_code=400, detail="Ce document est déjà signé")
    require_verified_email(current_user)
    if not is_user_verified(current_user):
        raise api_error(403, "identity_required", "Vérifiez votre identité avant de signer")
    now = datetime.now(timezone.utc)
    last = await db.signature_otps.find_one({"user_id": current_user["id"], "contract_id": data.contract_id},
                                            sort=[("created_at", -1)])
    if last and (now - _parse_dt(last["created_at"])).total_seconds() < OTP_RESEND_SECONDS:
        raise HTTPException(status_code=429, detail="Un code vient d'être envoyé. Patientez une minute avant d'en demander un nouveau.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.signature_otps.update_many({"user_id": current_user["id"], "contract_id": data.contract_id, "used": False},
                                        {"$set": {"used": True, "superseded": True}})
    await db.signature_otps.insert_one({
        "id": str(uuid.uuid4()), "user_id": current_user["id"], "contract_id": data.contract_id,
        "code_hash": otp_hash(code, data.contract_id), "attempts": 0, "used": False, "channel": "email",
        "destination": mask_email(current_user["email"]), "created_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=OTP_TTL_SECONDS)).isoformat(),
        "expire_at": now + timedelta(days=1),
    })
    doc_label = DOC_LABELS.get(contract.get("type"), "document")
    background_tasks.add_task(
        send_brevo_email, current_user["email"], display_name(current_user),
        "Votre code de signature",  # le code n'apparaît jamais dans l'objet (aperçus, notifications, journaux)
        f"""<h2>Code de signature</h2>
        <p>Voici votre code pour signer le {doc_label} n° {html_escape(contract.get('contract_number', ''))} :</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{code}</p>
        <p>Il est valable 10 minutes. Ne le communiquez à personne : il vaut signature.</p>
        <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>"""
    )
    result = {"sent": True, "channel": "email", "destination": mask_email(current_user["email"]),
              "expires_in": OTP_TTL_SECONDS, "resend_after": OTP_RESEND_SECONDS}
    if test_mode_enabled():
        result["test_code"] = code  # mode test : le code est aussi renvoyé en clair (jamais hors mode test)
    return result

def session_evidence(user: dict, contract: dict, request: Optional[Request], method: str) -> dict:
    """Éléments de preuve d'un acte accompli depuis l'espace authentifié (sans code) : IP, navigateur, identité vérifiée"""
    evidence = {
        "method": method,
        "document_sha256": hashlib.sha256((contract.get("content") or "").encode()).hexdigest(),
        "ip": client_ip(request) if request else None,
        "user_agent": request.headers.get("user-agent") if request else None,
        "identity": {
            "kyc_status": user.get("kyc_status"),
            "identity_verified": is_user_verified(user),
            "verification_session_id": user.get("verification_session_id"),
            # « test » : identité simulée en mode test (MODE-TEST.md §2.3), sans valeur probante
            "provider": user.get("kyc_provider"),
            "verified_name": " ".join(x for x in [user.get("verified_first_name"), user.get("verified_last_name")] if x) or None,
        },
    }
    return evidence

async def verify_signature_code(user: dict, contract: dict, code: Optional[str], request: Optional[Request]) -> dict:
    """Vérifie le code et renvoie les éléments de preuve de la signature"""
    evidence = session_evidence(user, contract, request, "otp_email" if otp_signature_enabled() else "click")
    if not otp_signature_enabled():
        return evidence
    if not code:
        raise HTTPException(status_code=400, detail="Code de signature requis : demandez un code par e-mail")
    otp = await db.signature_otps.find_one({"user_id": user["id"], "contract_id": contract["id"], "used": False},
                                           sort=[("created_at", -1)])
    if not otp or _parse_dt(otp["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code invalide ou expiré : demandez un nouveau code")
    if otp.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Trop d'essais : demandez un nouveau code")
    import hmac
    if not hmac.compare_digest(otp["code_hash"], otp_hash(code.strip(), contract["id"])):
        await db.signature_otps.update_one({"id": otp["id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Code invalide ou expiré : vérifiez le code reçu par e-mail")
    # Consommation atomique : un code ne sert qu'une fois
    consumed = await db.signature_otps.update_one({"id": otp["id"], "used": False},
                                                  {"$set": {"used": True, "verified_at": datetime.now(timezone.utc).isoformat()}})
    if consumed.modified_count == 0:
        raise HTTPException(status_code=400, detail="Code déjà utilisé : demandez un nouveau code")
    evidence["otp"] = {"id": otp["id"], "channel": otp["channel"], "destination": otp["destination"],
                       "sent_at": otp["created_at"], "verified_at": datetime.now(timezone.utc).isoformat()}
    return evidence

def finalize_signed_text(content: str, now: datetime) -> str:
    """Remplace l'horodatage en attente par la date de signature effective (le texte signé est ensuite figé)"""
    return (content or "").replace(SIGNATURE_DATE_PENDING, f"le {fmt_datetime_paris(now)}")

@api_router.post("/contracts/{contract_id}/sign")
async def sign_contract(contract_id: str, request: Request, signature: Optional[ContractSignature] = None,
                        current_user: dict = Depends(get_current_user)):
    """Signature par l'acquéreur d'un engagement de confidentialité ou d'une offre d'achat (code reçu par e-mail).
    Engagement signé : adresse du bien et identité du vendeur révélées, acquéreur inscrit sur la liste des présentés, PDF
    envoyé aux deux parties. Offre signée : passe à `pending`, le vendeur est prévenu. Le mandat se signe par
    POST /seller/mandat/{id}/sign."""
    contract = await db.generated_contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contrat non trouvé")
    if contract.get("type") not in ("nda", "offer"):
        raise HTTPException(status_code=400, detail="Ce document ne se signe pas par cette route")
    if contract.get("buyer_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Vous n'êtes pas autorisé à signer ce contrat")
    if contract.get("status") in ("signed", "buyer_signed", "fully_signed"):
        return {"message": "Contrat déjà signé", "contract": contract}
    if contract.get("status") not in ("pending_signature", "sent"):
        raise HTTPException(status_code=400, detail="Ce contrat n'est pas encore prêt à être signé")
    evidence = await verify_signature_code(current_user, contract, (signature or ContractSignature()).otp_code, request)
    property = await db.properties.find_one({"id": contract.get("property_id")}, {"_id": 0})
    now = datetime.now(timezone.utc)

    if contract.get("type") == "offer":
        return await _offer_after_buyer_signature(contract, property, current_user, evidence, now)

    # ---- Engagement de confidentialité et de non-contournement ----
    presented_content = finalize_signed_text(contract.get("content"), now)
    signed_content = finalize_signed_text(contract.get("content_after_signature") or contract.get("content"), now)
    evidence["document_presented_sha256"] = hashlib.sha256(presented_content.encode()).hexdigest()
    document_sha256 = hashlib.sha256(signed_content.encode()).hexdigest()
    record = await record_signature(contract, current_user, evidence, "nda", "buyer", now, document_sha256)
    await db.generated_contracts.update_one(
        {"id": contract_id},
        {"$set": {"status": "signed", "signed_at": now.isoformat(), "signed_by": current_user["email"],
                  "signature_hash": record["signature_hash"], "signature_evidence": record["evidence"],
                  "signature_record_id": record["id"], "signers_pending": [],
                  # L'engagement signé révèle l'adresse du bien et l'identité du vendeur (Annexe A)
                  "content": signed_content, "content_after_signature": signed_content}})

    # Liste nominative des présentés, identité révélée dans la conversation et la demande de dossier
    await add_presented_buyer(contract["property_id"], current_user["id"], contract_id, now)
    await db.dataroom_access.update_many({"property_id": contract["property_id"], "buyer_id": current_user["id"]},
                                         {"$set": {"nda_signed_at": now.isoformat(), "identity_revealed": True, "identity_revealed_at": now.isoformat()}})
    await db.conversations.update_many({"property_id": contract["property_id"], "buyer_id": current_user["id"]},
                                       {"$set": {"nda_signed": True, "identity_revealed": True, "identity_revealed_at": now.isoformat()}})
    # Origine des fonds déjà déclarée : l'accès au dossier s'ouvre dès maintenant (parcours §4.3.5)
    nda_access = await dataroom_request_for(contract["property_id"], current_user["id"])
    if nda_access and nda_access.get("funds_declaration"):
        await grant_dataroom_access({**nda_access, "nda_signed_at": now.isoformat()}, now)
    await db.contact_reveal_logs.insert_many([
        {"id": str(uuid.uuid4()), "who": current_user["id"], "what": "adresse_et_vendeur", "subject_id": contract.get("property_id"),
         "property_id": contract.get("property_id"), "justification": {"nda_id": contract_id, "contract_number": contract.get("contract_number")},
         "when": now.isoformat()},
        {"id": str(uuid.uuid4()), "who": property.get("seller_id") if property else None, "what": "identite_acquereur",
         "subject_id": current_user["id"], "property_id": contract.get("property_id"),
         "justification": {"nda_id": contract_id, "contract_number": contract.get("contract_number")}, "when": now.isoformat()},
    ])
    await db.messages.insert_one({
        "id": str(uuid.uuid4()), "sender_id": current_user["id"], "sender_email": current_user["email"],
        "receiver_id": property.get("seller_id") if property else None, "property_id": contract.get("property_id"),
        "content": f"J'ai signé l'engagement de confidentialité et de non-contournement n° {contract.get('contract_number')}. Mon identité vous est communiquée.",
        "message_type": "nda_signed", "kind": "system", "contract_number": contract.get("contract_number"), "read": False, "created_at": now.isoformat()})
    await create_audit_log(action="NDA_SIGNED", property_id=contract.get("property_id"), actor_id=current_user["id"],
                           actor_email=current_user["email"], details={"contract_id": contract_id, "contract_number": contract.get("contract_number")})
    # Exemplaire PDF (lien authentifié) aux deux parties
    pdf_link = document_pdf_link(record)
    buyer_name = (record["evidence"].get("identity") or {}).get("verified_name") or display_name(current_user) or buyer_pseudonym(current_user["id"])
    if property:
        await email_user(property.get("seller_id"), "nda_signed_seller", buyer_name=buyer_name,
                         contract_number=contract.get("contract_number", ""), pdf_link=pdf_link)
    await email_user(current_user["id"], "nda_signed_buyer", contract_number=contract.get("contract_number", ""), pdf_link=pdf_link,
                     next_step="déclarez l'origine des fonds envisagés depuis votre espace ; l'accès au dossier du bien s'ouvre ensuite automatiquement.")
    return {"message": "Engagement de confidentialité signé avec succès", "contract_number": contract.get("contract_number"),
            "signature_hash": record["signature_hash"], "signed_at": now.isoformat(), "document_id": record["id"],
            "pdf_url": document_pdf_path(record), "identity_revealed": True}

# ============ DOCUMENTS SIGNÉS (API.md §4) ============
async def signed_documents_query(property_id: str, current_user: dict) -> dict:
    """Le vendeur de l'annonce et l'admin voient toutes les signatures, les autres uniquement les leurs"""
    query = {"property_id": property_id}
    if current_user.get("role") != "admin":
        property = await db.properties.find_one({"id": property_id}, {"_id": 0, "seller_id": 1})
        if not property or not is_property_owner(property, current_user):
            query["signer_id"] = current_user["id"]
    return query

def signed_document_view(record: dict) -> dict:
    return {
        "id": record["id"], "doc_type": record.get("doc_type"), "contract_id": record.get("contract_id"),
        "contract_number": record.get("contract_number"), "signer_id": record.get("signer_id"), "signer_role": record.get("signer_role"),
        "signed_at": record.get("signed_at"), "signature_hash": record.get("signature_hash"), "evidence_sha256": record.get("evidence_sha256"),
        "evidence": public_evidence(record.get("evidence")), "pdf_url": document_pdf_path(record),
    }

@api_router.get("/documents/{property_id}/signed")
async def get_signed_documents(property_id: str, current_user: dict = Depends(get_current_user)):
    """Documents signés pour une annonce avec leurs métadonnées de preuve :
    [{id, doc_type, signed_at, evidence: {document_sha256, previous_evidence_sha256, ip, user_agent, identity}, pdf_url}]"""
    query = await signed_documents_query(property_id, current_user)
    docs = await db.documents.find(query, {"_id": 0}).sort("signed_at", 1).to_list(200)
    property = await db.properties.find_one({"id": property_id}, {"_id": 0, "id": 1, "seller_id": 1})
    labels = PartyLabels(current_user)
    rows = []
    for d in docs:
        view = signed_document_view(d)
        view["signer_label"] = await labels.label(d.get("signer_id"), property)
        rows.append(view)
    return scrub_contacts(rows, current_user)

async def _document_access_allowed(record: dict, contract: Optional[dict], user: Optional[dict], token: Optional[str]) -> bool:
    if token and record.get("access_token") and secrets.compare_digest(token, record["access_token"]):
        return True
    if not user:
        return False
    if user.get("role") == "admin" or user["id"] == record.get("signer_id"):
        return True
    if contract and user["id"] in contract_parties(contract):
        return True
    property = await db.properties.find_one({"id": record.get("property_id")}, {"_id": 0, "seller_id": 1})
    return bool(property) and is_property_owner(property, user)

@api_router.get("/documents/{property_id}/{doc_id}/pdf")
async def get_signed_document_pdf(property_id: str, doc_id: str, token: Optional[str] = None,
                                  current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Exemplaire PDF d'un document signé (texte intégral + page de preuve). Accès : signataire, parties au contrat,
    propriétaire de l'annonce, admin, ou lien authentifié par jeton (e-mails)."""
    record = await db.documents.find_one({"id": doc_id, "property_id": property_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Document introuvable")
    contract = await db.generated_contracts.find_one({"id": record.get("contract_id")}, {"_id": 0})
    if not await _document_access_allowed(record, contract, current_user, token):
        raise HTTPException(status_code=403, detail="Non autorisé")
    if not contract:
        raise HTTPException(status_code=404, detail="Contrat introuvable")
    pdf = await contract_pdf_bytes(contract)
    return pdf_response(pdf, f"{contract.get('type', 'document')}_{contract.get('contract_number', doc_id)}.pdf")
@api_router.get("/dataroom/{property_id}/access-status")
async def get_access_status(property_id: str, current_user: dict = Depends(get_current_user)):
    """Statut du parcours d'accès au dossier (API.md §4) : {access_granted, access_status, steps: {identity, nda, funds},
    next_step, request: {id, created_at, expires_at}}"""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Property not found")
    if is_property_owner(property, current_user) or current_user.get("role") == "admin":
        return {"access_granted": True, "is_seller": True, "access_status": "granted", "steps": {"identity": True, "nda": True, "funds": True},
                "next_step": None, "request": None}
    access = await db.dataroom_access.find_one({"property_id": property_id, "buyer_id": current_user["id"]}, {"_id": 0})
    status = access_request_status(access)
    steps = await dataroom_steps(property_id, current_user, access)
    if status == "accepted" and not next_dataroom_step(steps):
        # Les trois étapes sont faites (par exemple identité vérifiée après la déclaration) : accès ouvert
        if await grant_dataroom_access(access):
            status = "granted"
    conversation = await db.conversations.find_one({"property_id": property_id, "buyer_id": current_user["id"]}, {"_id": 0, "id": 1})
    return {
        "access_granted": status == "granted",
        "access_status": status,
        "steps": steps,
        "next_step": next_dataroom_step(steps) if status in ("accepted", "granted") else None,
        "nda_signed": steps["nda"],
        "identity_verified": steps["identity"],
        "request": ({"id": access["id"], "status": status, "created_at": access.get("created_at") or access.get("requested_at"),
                     "expires_at": access.get("expires_at") if status == "pending" else None,
                     "accepted_at": access.get("accepted_at") or access.get("validated_at"), "granted_at": access.get("granted_at"),
                     "rejection_reason": access.get("rejection_reason"), "auto_accepted": bool(access.get("auto_accepted"))} if access else None),
        "conversation_id": (conversation or {}).get("id"),
    }

# ============ CONVERSATIONS ET MESSAGES (API.md §3) ============
# Une conversation par couple (annonce, acquéreur) dans `db.conversations` ; les messages antérieurs (sans
# `conversation_id`) sont rattachés à la volée par `migrate_legacy_conversations` en les regroupant par (property_id, acquéreur).
async def get_or_create_conversation(property: dict, buyer_id: str, now: Optional[datetime] = None) -> tuple:
    """(conversation, créée ?) du couple annonce / acquéreur"""
    now = now or datetime.now(timezone.utc)
    existing = await db.conversations.find_one({"property_id": property["id"], "buyer_id": buyer_id}, {"_id": 0})
    if existing:
        return existing, False
    nda = await has_signed_nda(property["id"], buyer_id)
    doc = {
        "id": str(uuid.uuid4()), "property_id": property["id"], "buyer_id": buyer_id,
        "seller_id": property.get("seller_id"),
        "created_at": now.isoformat(), "last_at": now.isoformat(), "last_message": "", "last_sender_id": None,
        "nda_signed": nda, "identity_revealed": nda,
    }
    mark_test(doc, property, await db.users.find_one({"id": buyer_id}, {"_id": 0, "is_test": 1}))
    await db.conversations.insert_one(doc)
    doc.pop("_id", None)
    return doc, True

async def migrate_legacy_conversations(user: dict) -> None:
    """Rattache les messages historiques de l'utilisateur (sans conversation_id) à une conversation par (annonce, acquéreur)"""
    query = {"conversation_id": {"$exists": False}, "$or": [{"sender_id": user["id"]}, {"receiver_id": user["id"]}]}
    legacy = await db.messages.find(query, {"_id": 0, "id": 1, "property_id": 1, "sender_id": 1, "receiver_id": 1, "created_at": 1, "content": 1}).to_list(5000)
    if not legacy:
        return
    properties = {}
    for m in legacy:
        cid = m.get("property_id")
        if not cid:
            continue
        if cid not in properties:
            properties[cid] = await db.properties.find_one({"id": cid}, {"_id": 0, "id": 1, "seller_id": 1})
        property = properties[cid]
        if not property:
            continue
        owners = {property.get("seller_id")} - {None}
        buyer_id = m.get("receiver_id") if m.get("sender_id") in owners else m.get("sender_id")
        if not buyer_id or buyer_id in owners:
            continue
        conversation, _ = await get_or_create_conversation(property, buyer_id, _parse_dt(m.get("created_at")) or datetime.now(timezone.utc))
        await db.messages.update_one({"id": m["id"]}, {"$set": {"conversation_id": conversation["id"]}})
        if (m.get("created_at") or "") >= (conversation.get("last_at") or "") or not conversation.get("last_message"):
            await db.conversations.update_one({"id": conversation["id"]}, {"$set": {
                "last_at": m.get("created_at") or conversation.get("last_at"), "last_message": (m.get("content") or "")[:200],
                "last_sender_id": m.get("sender_id")}})

async def conversation_for_user(conversation_id: str, user: dict) -> dict:
    conversation = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    if user.get("role") != "admin" and user["id"] not in (conversation.get("buyer_id"), conversation.get("seller_id")):
        property = await db.properties.find_one({"id": conversation["property_id"]}, {"_id": 0, "seller_id": 1})
        if not property or not is_property_owner(property, user):
            raise api_error(403, "not_allowed", "Vous n'êtes pas partie à cette conversation")
    return conversation

def conversation_receiver(conversation: dict, sender: dict) -> Optional[str]:
    return conversation.get("seller_id") if sender["id"] == conversation.get("buyer_id") else conversation.get("buyer_id")

async def buyer_card(buyer_id: str, revealed: bool = False) -> dict:
    """Carte acquéreur (SPEC §4) : pseudonymisée avant l'engagement (projet, budget, apport, financement, zones, types de
    biens, rendement minimum, horizon, société vérifiée, score), nom et société après l'engagement. Jamais de coordonnées."""
    user = await db.users.find_one({"id": buyer_id}, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "company_name": 1,
                                                       "verified_first_name": 1, "verified_last_name": 1, "phone": 1,
                                                       "buyer_profile": 1, "identity_verified": 1, "kyc_status": 1, "created_at": 1})
    profile = (user or {}).get("buyer_profile") or {}
    card = {
        "buyer_id": buyer_id, "label": buyer_pseudonym(buyer_id),
        "project_type": profile.get("project_type"), "budget_max": profile.get("budget_max"), "apport": profile.get("apport"),
        "financing": profile.get("financing"), "zones": profile.get("zones") or [], "property_types": profile.get("property_types") or [],
        "min_yield": profile.get("min_yield"), "horizon": profile.get("horizon"), "experience": profile.get("experience"),
        "siren_verified": profile.get("siren_verified") is True, "profile_score": buyer_profile_score(user or {}),
        "identity_verified": is_user_verified(user or {}), "member_since": (user or {}).get("created_at"),
    }
    if revealed and user:
        name = f"{user.get('verified_first_name') or user.get('first_name') or ''} {user.get('verified_last_name') or user.get('last_name') or ''}".strip()
        card["name"] = name or None
        card["company_name"] = user.get("company_name") or profile.get("company_name")
    return card

def buyer_card_html(card: dict) -> str:
    """Carte acquéreur en HTML pour les e-mails (valeurs échappées)"""
    labels = {**{p["id"]: p["label"] for p in taxonomy.BUYER_PROJECT_TYPES}, **{f["id"]: f["label"] for f in taxonomy.FINANCING_TYPES},
              "0-6": "Dans les 6 mois", "6-12": "Dans 6 à 12 mois", "12+": "Dans plus d'un an"}
    rows = []
    if card.get("name"):
        rows.append(("Acquéreur", card["name"] + (f" — {card['company_name']}" if card.get("company_name") else "")))
    if card.get("project_type"):
        rows.append(("Projet", labels.get(card["project_type"], card["project_type"])))
    if card.get("budget_max"):
        rows.append(("Budget maximum", fmt_eur_fr(card["budget_max"])))
    if card.get("apport"):
        rows.append(("Apport", fmt_eur_fr(card["apport"])))
    if card.get("financing"):
        rows.append(("Financement", labels.get(card["financing"], card["financing"])))
    if card.get("zones"):
        rows.append(("Zones", ", ".join(card["zones"])))
    if card.get("property_types"):
        rows.append(("Types de biens", ", ".join(taxonomy.property_type_label(t, short=True) for t in card["property_types"])))
    if card.get("min_yield"):
        rows.append(("Rendement brut visé", f"au moins {fmt_percent_fr(card['min_yield'])}"))
    if card.get("horizon"):
        rows.append(("Horizon", labels.get(card["horizon"], card["horizon"])))
    rows.append(("Société vérifiée", "oui (SIREN contrôlé au registre national)" if card.get("siren_verified") else "non"))
    rows.append(("Profil", f"complet à {card.get('profile_score', 0)} %"))
    return "".join(f"<li><strong>{html_escape(k)} :</strong> {html_escape(str(v))}</li>" for k, v in rows)

async def register_contact(property: dict, buyer_id: str, now: datetime) -> None:
    """Enregistrement du premier contact (statistiques, suivi à 30 jours) et compteur de l'annonce"""
    existing = await db.contacts.find_one({"buyer_id": buyer_id, "property_id": property["id"]})
    if existing:
        return
    await db.contacts.insert_one({"id": str(uuid.uuid4()), "buyer_id": buyer_id, "property_id": property["id"],
                                  "seller_id": property.get("seller_id"), "created_at": now.isoformat()})
    await db.properties.update_one({"id": property["id"]}, {"$inc": {"contacts_count": 1}})

async def store_message(conversation: dict, sender: dict, content: str, now: Optional[datetime] = None,
                        kind: str = "message", message_type: Optional[str] = None, **extra) -> dict:
    """Enregistre un message dans la conversation : coordonnées masquées tant que l'engagement n'est pas signé (contournement),
    dernier message mémorisé sur la conversation. `kind: 'system'` pour les messages automatiques."""
    now = now or datetime.now(timezone.utc)
    receiver_id = conversation_receiver(conversation, sender) if sender.get("id") != "system" else None
    content_original = None
    if kind == "message" and sender.get("role") in ("buyer", "seller"):
        nda_signed = conversation.get("nda_signed") or await has_signed_nda(conversation["property_id"], conversation["buyer_id"])
        if not nda_signed:
            masked, changed = mask_contacts(content)
            if changed:
                content_original, content = content, masked
                await db.contact_attempts.insert_one({"id": str(uuid.uuid4()), "property_id": conversation["property_id"],
                                                      "sender_id": sender["id"], "receiver_id": receiver_id, "created_at": now.isoformat()})
    message_doc = {
        "id": str(uuid.uuid4()), "conversation_id": conversation["id"], "sender_id": sender.get("id"),
        "sender_email": sender.get("email"), "receiver_id": receiver_id, "property_id": conversation["property_id"],
        "content": content, "content_original": content_original, "contacts_masked": content_original is not None,
        "kind": kind, "message_type": message_type, "read": False, "created_at": now.isoformat(), **extra,
    }
    await db.messages.insert_one(message_doc)
    message_doc.pop("_id", None)
    await db.conversations.update_one({"id": conversation["id"]}, {"$set": {
        "last_at": now.isoformat(), "last_message": content[:200], "last_sender_id": sender.get("id"), "updated_at": now.isoformat()}})
    return message_doc

async def system_message(property_id: str, buyer_id: str, content: str, message_type: str, receiver_id: Optional[str] = None) -> Optional[dict]:
    """Message automatique (kind:'system') dans la conversation du couple ; la conversation est créée si besoin"""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0, "id": 1, "seller_id": 1})
    if not property or not buyer_id:
        return None
    conversation, _ = await get_or_create_conversation(property, buyer_id)
    doc = await store_message(conversation, {"id": "system", "email": None}, content, kind="system", message_type=message_type)
    if receiver_id:
        await db.messages.update_one({"id": doc["id"]}, {"$set": {"receiver_id": receiver_id}})
    return doc

async def notify_first_contact(conversation: dict, buyer: dict, extract: str) -> None:
    """E-mail « premier contact » au vendeur : extrait du message + carte acquéreur pseudonymisée"""
    property = await db.properties.find_one({"id": conversation["property_id"]}, {"_id": 0, "title": 1})
    card = await buyer_card(buyer["id"], revealed=bool(conversation.get("identity_revealed")))
    await email_user(conversation.get("seller_id"), "first_contact", property_title=(property or {}).get("title") or "votre annonce",
                     buyer_label=card["label"], extract=extract[:600], card_rows=buyer_card_html(card),
                     link=site_url(f"/messages?conversation={conversation['id']}"))

async def notify_new_message(conversation: dict, sender: dict, message_doc: dict) -> None:
    """Notification du destinataire sans spammer : rien si un message non lu l'attend déjà"""
    receiver_id = message_doc.get("receiver_id")
    if not receiver_id:
        return
    already_unread = await db.messages.count_documents({"conversation_id": conversation["id"], "receiver_id": receiver_id,
                                                        "read": False, "kind": {"$ne": "system"}, "id": {"$ne": message_doc["id"]}})
    if already_unread:
        return
    template = "seller_reply" if sender.get("role") == "seller" else "new_message"
    await email_user(receiver_id, template, link=site_url(f"/messages?conversation={conversation['id']}"))

@api_router.post("/messages")
async def send_message(message: MessageCreate, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Envoi d'un message dans une conversation (`conversation_id`, API.md §3). Forme historique tolérée :
    `receiver_id` + `property_id` (la conversation du couple est retrouvée ou créée)."""
    content = (message.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message vide")
    if len(content) > 5000:
        raise HTTPException(status_code=400, detail="Message trop long (5000 caractères maximum)")
    role = current_user.get("role")
    if role == "buyer":
        # Un acquéreur n'écrit qu'avec une adresse e-mail confirmée (aucun paiement : loi Hoguet)
        require_verified_email(current_user)
    
    if message.conversation_id:
        conversation = await conversation_for_user(message.conversation_id, current_user)
        property = await db.properties.find_one({"id": conversation["property_id"]}, {"_id": 0})
        if not property:
            raise HTTPException(status_code=404, detail="Annonce introuvable")
        if role == "buyer" and property.get("status") not in ("published", "paused", "sold", "sold_elsewhere", "withdrawn"):
            raise HTTPException(status_code=404, detail="Annonce introuvable")
    else:
        if not message.property_id or not message.receiver_id:
            raise api_error(400, "validation", "Indiquez la conversation (conversation_id) ou l'annonce et le destinataire")
        property = await db.properties.find_one({"id": message.property_id}, {"_id": 0})
        if not property:
            raise HTTPException(status_code=404, detail="Annonce introuvable")
        if role == "buyer":
            if property.get("status") != "published":
                raise HTTPException(status_code=404, detail="Annonce introuvable")
            if message.receiver_id != property.get("seller_id"):
                raise HTTPException(status_code=400, detail="Destinataire invalide pour cette annonce")
            existing = await db.conversations.find_one({"property_id": property["id"], "buyer_id": current_user["id"]}, {"_id": 0})
            if not existing:
                await migrate_legacy_conversations(current_user)
                existing = await db.conversations.find_one({"property_id": property["id"], "buyer_id": current_user["id"]}, {"_id": 0})
            if not existing:
                require_buyer_profile(current_user)  # premier contact par la messagerie : mêmes règles que /contact
            conversation, _ = await get_or_create_conversation(property, current_user["id"])
        elif role == "seller":
            if not is_property_owner(property, current_user):
                raise HTTPException(status_code=403, detail="Cette annonce ne vous appartient pas")
            await migrate_legacy_conversations(current_user)
            conversation = await db.conversations.find_one({"property_id": property["id"], "buyer_id": message.receiver_id}, {"_id": 0})
            if not conversation:
                raise HTTPException(status_code=400, detail="Cet utilisateur ne vous a pas contacté pour cette annonce")
        elif role == "admin":
            conversation, _ = await get_or_create_conversation(property, message.receiver_id)
        else:
            raise HTTPException(status_code=403, detail="Non autorisé")
    
    now = datetime.now(timezone.utc)
    created = False
    if role == "buyer":
        before = await db.messages.count_documents({"conversation_id": conversation["id"], "sender_id": current_user["id"], "kind": {"$ne": "system"}})
        created = before == 0
    message_doc = await store_message(conversation, current_user, content, now)
    if role == "buyer" and created:
        await register_contact(property, current_user["id"], now)
        background_tasks.add_task(notify_first_contact, conversation, current_user, message_doc["content"])
    else:
        background_tasks.add_task(notify_new_message, conversation, current_user, message_doc)
    view = {**scrub_contacts(message_doc, current_user), "is_mine": True, "sender_label": "Vous"}
    return view

async def label_messages(messages: list, viewer: dict) -> list:
    """Ajoute sender_label / receiver_label / is_mine / kind et retire les coordonnées (non-admin)"""
    labels = PartyLabels(viewer)
    properties = {}
    for m in messages:
        cid = m.get("property_id")
        if cid not in properties:
            properties[cid] = await db.properties.find_one({"id": cid}, {"_id": 0, "id": 1, "seller_id": 1})
        m["sender_label"] = await labels.label(m.get("sender_id"), properties[cid])
        m["receiver_label"] = await labels.label(m.get("receiver_id"), properties[cid])
        m["is_mine"] = m.get("sender_id") == viewer.get("id")
        m["kind"] = m.get("kind") or ("system" if m.get("sender_id") == "system" else "message")
    return scrub_contacts(messages, viewer)

@api_router.get("/messages")
async def get_messages(conversation_id: Optional[str] = None, property_id: Optional[str] = None,
                       current_user: dict = Depends(get_current_user)):
    """Messages d'une conversation (`conversation_id`, ordre chronologique) ; `property_id` : forme historique"""
    if conversation_id:
        conversation = await conversation_for_user(conversation_id, current_user)
        await migrate_legacy_conversations(current_user)
        messages = await db.messages.find({"conversation_id": conversation["id"]}, {"_id": 0}).sort("created_at", 1).to_list(2000)
        return await label_messages(messages, current_user)
    query = {"$or": [{"sender_id": current_user["id"]}, {"receiver_id": current_user["id"]}]}
    if property_id:
        query["property_id"] = property_id
    messages = await db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return await label_messages(messages, current_user)

async def conversation_view(conversation: dict, viewer: dict, labels: PartyLabels, properties: dict) -> dict:
    cid = conversation.get("property_id")
    if cid not in properties:
        properties[cid] = await db.properties.find_one({"id": cid}, {"_id": 0, "id": 1, "title": 1, "seller_id": 1, "status": 1,
                                                                   "property_type": 1, "city": 1, "department": 1})
    property = properties[cid] or {"id": cid}
    is_seller_side = viewer["id"] != conversation.get("buyer_id")
    other_id = conversation.get("buyer_id") if is_seller_side else conversation.get("seller_id")
    unread = await db.messages.count_documents({"conversation_id": conversation["id"], "receiver_id": viewer["id"], "read": False})
    access = await db.dataroom_access.find_one({"property_id": cid, "buyer_id": conversation.get("buyer_id")}, {"_id": 0, "status": 1, "id": 1})
    nda_signed = bool(conversation.get("nda_signed")) or await has_signed_nda(cid, conversation.get("buyer_id"))
    title = property.get("title") or (taxonomy.property_title(property.get("property_type"), property.get("city"), property.get("department"))
                                     if property.get("property_type") else "Annonce")
    view = {
        "id": conversation["id"], "property_id": cid, "property_title": title, "property_status": property.get("status"),
        "buyer_id": conversation.get("buyer_id"), "seller_id": conversation.get("seller_id"),
        "other_party_label": await labels.label(other_id, property),
        "last_message": conversation.get("last_message") or "", "last_at": conversation.get("last_at") or conversation.get("created_at"),
        "last_sender_id": conversation.get("last_sender_id"), "unread_count": unread,
        "nda_signed": nda_signed, "identity_revealed": bool(conversation.get("identity_revealed")) or nda_signed,
        "access_status": (access or {}).get("status"), "access_request_id": (access or {}).get("id"),
        "created_at": conversation.get("created_at"),
    }
    if is_seller_side:
        view["buyer_card"] = await buyer_card(conversation.get("buyer_id"), revealed=view["identity_revealed"])
    return view

@api_router.get("/messages/conversations")
async def get_conversations(current_user: dict = Depends(get_current_user)):
    """Conversations de l'utilisateur (API.md §3), triées par dernier message : [{id, property_id, property_title, buyer_id,
    seller_id, other_party_label, buyer_card? (côté vendeur), last_message, last_at, unread_count, nda_signed,
    identity_revealed, access_status}]"""
    await migrate_legacy_conversations(current_user)
    if current_user.get("role") == "admin":
        query = {}
    else:
        owned = [c["id"] async for c in db.properties.find({"seller_id": current_user["id"]}, {"_id": 0, "id": 1})]
        query = {"$or": [{"buyer_id": current_user["id"]}, {"seller_id": current_user["id"]}, {"property_id": {"$in": owned}}]}
    conversations = await db.conversations.find(query, {"_id": 0}).sort("last_at", -1).to_list(500)
    labels = PartyLabels(current_user)
    properties = {}
    rows = [await conversation_view(c, current_user, labels, properties) for c in conversations]
    rows.sort(key=lambda r: r.get("last_at") or "", reverse=True)
    return scrub_contacts(rows, current_user)

@api_router.put("/messages/conversations/{conversation_id}/read")
async def mark_conversation_read(conversation_id: str, current_user: dict = Depends(get_current_user)):
    """Marque comme lus tous les messages reçus dans la conversation (ou, forme historique, pour une annonce)"""
    conversation = await db.conversations.find_one({"id": conversation_id}, {"_id": 0, "id": 1})
    if conversation:
        query = {"conversation_id": conversation_id, "receiver_id": current_user["id"], "read": False}
    else:
        query = {"property_id": conversation_id, "receiver_id": current_user["id"], "read": False}
    result = await db.messages.update_many(query, {"$set": {"read": True}})
    return {"ok": True, "marked": result.modified_count}

@api_router.put("/messages/{message_id}/read")
async def mark_read(message_id: str, current_user: dict = Depends(get_current_user)):
    await db.messages.update_one(
        {"id": message_id, "receiver_id": current_user["id"]},
        {"$set": {"read": True}}
    )
    return {"ok": True, "message": "Marked as read"}

# ============ DOCUMENTS & SIGNATURES ============
@api_router.get("/documents/{property_id}")
async def get_documents(property_id: str, current_user: dict = Depends(get_current_user)):
    query = await signed_documents_query(property_id, current_user)
    docs = await db.documents.find(query, {"_id": 0}).to_list(1000)
    return scrub_contacts(docs, current_user)

async def health_status() -> dict:
    """État réel du service : base joignable, âge de la dernière tâche planifiée, disque, version"""
    db_ok = True
    try:
        await asyncio.wait_for(db.command("ping"), timeout=2.0)
    except Exception as e:
        logger.error(f"Health : MongoDB injoignable ({e})")
        db_ok = False
    jobs_age = None
    if db_ok:
        try:
            run = await db.job_runs.find_one({"_id": "scheduler"})
            last_ok = _parse_dt((run or {}).get("last_ok"))
            if last_ok:
                jobs_age = int((datetime.now(timezone.utc) - last_ok).total_seconds())
        except Exception:
            jobs_age = None
    try:
        disk_free_mb = int(shutil.disk_usage(str(ROOT_DIR)).free / (1024 * 1024))
    except OSError:
        disk_free_mb = None
    return {
        "status": "ok" if db_ok else "degraded",
        "db": "ok" if db_ok else "ko",
        "jobs_age_seconds": jobs_age,
        "backup_age_hours": backup_age_hours(),
        "disk_free_mb": disk_free_mb,
        "s3": s3_enabled(),
        "version": APP_VERSION,
    }

@api_router.get("/health")
async def health_check():
    """Healthcheck utilisé par docker-compose / Dokploy / UptimeRobot : 503 si la base est injoignable"""
    status = await health_status()
    if status["db"] != "ok":
        return JSONResponse(status_code=503, content=status)
    return status

@api_router.get("/config")
async def get_public_config(request: Request):
    """Configuration publique : marque, barème des honoraires (vendeur débiteur, bloc `commission`), version des
    conditions, mode test.
    En mode test : `test_panel_protected` (panneau réservé à la clé TEST_PANEL_KEY), `test_panel_access` (panneau
    accessible : bonne clé dans X-Test-Key, ou pas de clé) et `test_panel_admin` (connexion à l'admin démo permise)."""
    test_mode = test_mode_enabled()
    return {
        "site_name": site_name(),
        "site_url": site_url(),
        "seller_commission": seller_commission_enabled(),
        "commission_mode": "simple",
        "commission_payer": COMMISSION_PAYER,
        "commission_scale": commission_scale(),
        "commission_scale_text": commission_scale_text(),
        "commission_terms_version": COMMISSION_TERMS_VERSION,
        "commission": {k: v for k, v in commission_config().items() if k in ("rate_percent_ht", "rate_percent_ttc", "minimum_ht",
                                                                          "minimum_ttc", "vat_rate")},
        "test_mode": test_mode,
        **({"test_panel_protected": test_panel_protected(), "test_panel_access": test_panel_access(request),
            "test_panel_admin": test_panel_access(request, admin=True)} if test_mode else {}),
    }

# ============ OFFRE D'ACHAT (SPEC §7.3, API.md §5) ============
# Formulaire structuré → document généré (gabarit DEFAULT_OFFER_TEMPLATE) signé par code par l'acquéreur
# (POST /contracts/{id}/sign), contresigné par le vendeur à l'acceptation (PUT /offers/{id}/respond {action:'accept', otp_code}),
# refus motivé, contre-proposition acceptée par code (PUT /offers/{id}/accept-counter), expiration par tâche quotidienne.
# L'offre, même acceptée, n'emporte pas vente : elle engage à négocier de bonne foi l'avant-contrat chez le notaire.
class OfferFinancing(BaseModel):
    equity: float = Field(0, ge=0, description="Apport personnel")
    loan: float = Field(0, ge=0, description="Emprunt")

class LoanCondition(BaseModel):
    """Condition suspensive d'obtention de prêt (art. L313-40 C. conso.)"""
    required: bool = False
    amount: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    max_rate: Optional[float] = Field(None, ge=0, le=20, description="Taux maximum hors assurance, en %")
    duration_years: Optional[int] = Field(None, ge=1, le=40)

class OfferCreate(BaseModel):
    property_id: str
    amount: float = Field(gt=0)
    sale_object: Literal["bien", "parts"] = "bien"
    financing: OfferFinancing = Field(default_factory=OfferFinancing)
    loan_condition: LoanCondition = Field(default_factory=LoanCondition)
    conditions: List[str] = Field(default_factory=list, max_length=20)
    target_date: str = Field(..., description="Date souhaitée pour l'avant-contrat (AAAA-MM-JJ)")
    validity_days: int = Field(10, ge=5, le=30)
    message: Optional[str] = Field(None, max_length=2000)

class OfferRespond(BaseModel):
    action: Literal["accept", "reject", "counter"]
    otp_code: Optional[str] = None
    reason: Optional[str] = Field(None, max_length=2000)
    counter_amount: Optional[float] = Field(None, gt=0)
    message: Optional[str] = Field(None, max_length=2000)

class OfferCounterAccept(BaseModel):
    otp_code: Optional[str] = None

OFFER_STATUSES = ("pending_signature", "pending", "accepted", "rejected", "countered", "expired")
OFFER_OPEN_STATUSES = ("pending_signature", "pending", "countered")

def offer_view(offer: dict) -> dict:
    return {k: v for k, v in offer.items() if k not in ("_id",)}

def _parse_date_iso(value: str) -> Optional[datetime]:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None

async def dataroom_access_granted(property_id: str, buyer_id: str) -> bool:
    access = await dataroom_request_for(property_id, buyer_id)
    return bool(access) and access.get("status") == "granted"

async def _offer_contract(offer: dict) -> Optional[dict]:
    if not offer.get("contract_id"):
        return None
    return await db.generated_contracts.find_one({"id": offer["contract_id"], "type": "offer"}, {"_id": 0})

def _offer_pdf_link(records_or_contract) -> str:
    """Lien PDF authentifié : dernier enregistrement de signature de l'offre"""
    return document_pdf_link(records_or_contract) if records_or_contract else ""

async def _latest_offer_record(contract_id: str) -> Optional[dict]:
    return await db.documents.find_one({"contract_id": contract_id}, {"_id": 0}, sort=[("signed_at", -1)])

async def _offer_message(sender: dict, receiver_id: Optional[str], offer: dict, content: str, message_type: str, now: datetime):
    await db.messages.insert_one({
        "id": str(uuid.uuid4()), "sender_id": sender["id"], "sender_email": sender.get("email"), "receiver_id": receiver_id,
        "property_id": offer["property_id"], "content": content, "message_type": message_type, "kind": "system",
        "offer_id": offer["id"], "read": False, "created_at": now.isoformat()})

@api_router.post("/offers")
async def create_offer(offer: OfferCreate, current_user: dict = Depends(get_current_user)):
    """Acquéreur : dépose une offre d'achat (accès au dossier accordé obligatoire). Crée le document à signer et renvoie
    {offer, contract_id} ; l'offre reste `pending_signature` jusqu'à la signature par code."""
    if current_user.get("role") != "buyer":
        raise api_error(403, "not_allowed", "Seuls les acquéreurs peuvent faire une offre d'achat")
    require_verified_email(current_user)
    property = await db.properties.find_one({"id": offer.property_id}, {"_id": 0})
    if not property or property.get("status") != "published":
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    if not await dataroom_access_granted(offer.property_id, current_user["id"]):
        raise api_error(403, "not_allowed", "L'accès au dossier du bien doit être ouvert avant de faire une offre d'achat")
    target = _parse_date_iso(offer.target_date)
    if not target:
        raise api_error(400, "validation", "Date souhaitée pour l'avant-contrat invalide (format AAAA-MM-JJ)", missing=["target_date"])
    if offer.sale_object == "parts" and property.get("owner_type") not in COMPANY_OWNER_TYPES:
        raise api_error(400, "validation", "Ce bien n'appartient pas à une société : l'offre porte sur le bien lui-même", field="sale_object")
    if property.get("sale_object") in ("bien", "parts") and offer.sale_object != property["sale_object"]:
        raise api_error(400, "validation", "L'objet de l'offre doit correspondre à celui de l'annonce", field="sale_object")
    existing = await db.offers.find_one({"property_id": offer.property_id, "buyer_id": current_user["id"], "status": {"$in": list(OFFER_OPEN_STATUSES)}}, {"_id": 0})
    if existing:
        raise api_error(400, "validation", "Vous avez déjà une offre en cours pour ce bien", offer_id=existing["id"])

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=offer.validity_days)
    seller = await db.users.find_one({"id": property.get("seller_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company_name": 1,
                                                                         "verified_first_name": 1, "verified_last_name": 1}) or {}
    settings_doc = await db.platform_settings.find_one({"type": "contracts"}, {"_id": 0})
    settings = {**DEFAULT_PLATFORM_SETTINGS, **(settings_doc["settings"] if settings_doc else {})}
    contract_number = f"OFFRE-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    conditions = [c.strip() for c in offer.conditions if c and c.strip()]
    financing = offer.financing.model_dump()
    loan_condition = offer.loan_condition.model_dump()
    if loan_condition["required"] and not loan_condition.get("amount"):
        loan_condition["amount"] = financing["loan"] or None
    if not loan_condition["required"]:
        loan_condition = {"required": False, "amount": None, "max_rate": None, "duration_years": None}
    company = company_text(property, with_siege=False)
    variables = {
        **settings,
        **property_contract_variables(property),
        "ACQUEREUR_IDENTITE": buyer_identity_text(current_user),
        "VENDEUR_IDENTITE": seller_identity_text(seller, property),
        "OBJET": SALE_OBJECT_OFFER[offer.sale_object].format(company=f" {company}" if company else ""),
        "MONTANT": fmt_eur_fr(offer.amount),
        "FIN_APPORT": fmt_eur_fr(financing["equity"]),
        "FIN_EMPRUNT": fmt_eur_fr(financing["loan"]),
        "CONDITION_PRET": loan_condition_text(loan_condition),
        "RETRACTATION_ACQUEREUR": buyer_withdrawal_text(property, offer.sale_object),
        "CONDITIONS": "\n".join(f"{i}. {c}" for i, c in enumerate(conditions, 1)) if conditions else "Aucune autre condition particulière.",
        "DATE_CIBLE": fmt_date_fr(target),
        "VALIDITE_JOURS": str(offer.validity_days),
        "DATE_EXPIRATION": fmt_date_fr(expires_at),
        "MESSAGE": (offer.message or "").strip() or "Aucun message particulier.",
        "OFFRE_NUMERO": contract_number,
        "DATE_SIGNATURE": SIGNATURE_DATE_PENDING,
    }
    content = render_template(DEFAULT_OFFER_TEMPLATE, variables)
    missing = missing_template_variables(content)
    if missing:
        raise api_error(400, "validation", "Le texte de l'offre ne peut pas être complété", missing=missing)
    offer_test = is_test_context(current_user, property)
    content = with_test_banner(content, offer_test)
    offer_doc = {
        "id": str(uuid.uuid4()), "property_id": offer.property_id, "buyer_id": current_user["id"], "buyer_email": current_user["email"],
        "seller_id": property.get("seller_id"), "amount": float(offer.amount), "sale_object": offer.sale_object, "financing": financing,
        "loan_condition": loan_condition, "conditions": conditions, "target_date": target.date().isoformat(),
        "validity_days": offer.validity_days, "expires_at": expires_at.isoformat(), "message": (offer.message or "").strip() or None,
        "status": "pending_signature", "counter_amount": None, "contract_id": None, "contract_number": contract_number,
        "signed_at": None, "countersigned_at": None, "closing_id": None, "created_at": now.isoformat(), "terms_version": OFFER_TERMS_VERSION,
    }
    contract_doc = {
        "id": str(uuid.uuid4()), "contract_number": contract_number, "type": "offer", "offer_id": offer_doc["id"],
        "property_id": offer.property_id, "buyer_id": current_user["id"], "seller_id": property.get("seller_id"),
        "content": content, "status": "pending_signature", "signers_pending": [current_user["id"]], "terms_version": OFFER_TERMS_VERSION,
        "terms_date": CONTRACT_TERMS_DATE, "created_at": now.isoformat(), "auto_generated": True, "addenda": [],
    }
    offer_doc["contract_id"] = contract_doc["id"]
    if offer_test:
        offer_doc["is_test"] = contract_doc["is_test"] = True
    await db.generated_contracts.insert_one(contract_doc)
    await db.offers.insert_one(offer_doc)
    return {"offer": offer_view(offer_doc), "contract_id": contract_doc["id"], "content": content, "contract_number": contract_number,
            "title": CONTRACT_TITLES["offer"]}

def loan_condition_text(loan: dict) -> str:
    """Clause de l'offre sur le financement par emprunt (condition suspensive, art. L313-40 et L313-42 C. conso.)"""
    if not loan.get("required"):
        return ("L'Acquéreur déclare financer l'acquisition sans recourir à un prêt ; l'avant-contrat comportera la mention "
                "prévue à l'article L313-42 du code de la consommation.")
    parts = []
    parts.append(f"d'un montant de {fmt_eur_fr(loan['amount'])}" if loan.get("amount") else "d'un montant à préciser dans l'avant-contrat")
    parts.append(f"sur {loan['duration_years']} ans" if loan.get("duration_years") else "sur une durée à préciser dans l'avant-contrat")
    rate = loan.get("max_rate")
    parts.append(f"au taux maximum de {fmt_percent_fr(rate)} hors assurance" if rate else "au taux du marché")
    return ("Condition suspensive d'obtention de prêt : l'Acquéreur entend financer l'acquisition au moyen d'un prêt "
            + " ".join(parts) + ". L'avant-contrat sera conclu sous la condition suspensive de son obtention, conformément "
            "aux articles L313-40 et suivants du code de la consommation.")

def buyer_withdrawal_text(property: dict, sale_object: str) -> str:
    """Rappel du délai de rétractation de l'acquéreur non professionnel d'un logement (art. L271-1 CCH)"""
    if sale_object == "parts":
        return ("La cession de parts sociales n'ouvre pas le délai de rétractation de dix jours prévu par l'article L271-1 du "
                "code de la construction et de l'habitation.")
    ptype = taxonomy.property_type_by_id(property.get("property_type")) or {}
    if ptype.get("category") == "habitation" or property.get("property_type") == "residence-geree":
        return ("L'Acquéreur non professionnel d'un bien à usage d'habitation dispose d'un délai de rétractation de dix jours à "
                "compter du lendemain de la première présentation ou de la remise de l'avant-contrat (article L271-1 du code de "
                "la construction et de l'habitation).")
    return ("Le délai de rétractation de dix jours de l'article L271-1 du code de la construction et de l'habitation ne "
            "s'applique qu'à l'acquisition d'un bien à usage d'habitation par un acquéreur non professionnel.")

async def _offer_after_buyer_signature(contract: dict, property: Optional[dict], user: dict, evidence: dict, now: datetime) -> dict:
    """Appelée par POST /contracts/{id}/sign pour un document `offer` : l'offre passe à `pending`, le vendeur est prévenu"""
    offer = await db.offers.find_one({"id": contract.get("offer_id")}, {"_id": 0})
    if not offer:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    if offer.get("status") != "pending_signature":
        raise HTTPException(status_code=400, detail="Cette offre n'attend plus de signature")
    if _parse_dt(offer.get("expires_at")) and _parse_dt(offer["expires_at"]) < now:
        raise HTTPException(status_code=400, detail="Cette offre a expiré : déposez une nouvelle offre")
    content = finalize_signed_text(contract.get("content"), now)
    # Validité « à compter de sa signature » : l'échéance est recalculée à la signature et reportée dans le texte signé
    expires_at = now + timedelta(days=int(offer.get("validity_days") or 0)) if offer.get("validity_days") else _parse_dt(offer.get("expires_at"))
    if expires_at and offer.get("expires_at"):
        content = content.replace(f"soit jusqu'au {fmt_date_fr(offer['expires_at'])}", f"soit jusqu'au {fmt_date_fr(expires_at)}")
    offer["expires_at"] = expires_at.isoformat() if expires_at else offer.get("expires_at")
    document_sha256 = hashlib.sha256(content.encode()).hexdigest()
    record = await record_signature(contract, user, evidence, "offer", "buyer", now, document_sha256)
    await db.generated_contracts.update_one({"id": contract["id"]}, {"$set": {
        "status": "signed", "content": content, "signed_at": now.isoformat(), "signed_by": user["email"],
        "signature_hash": record["signature_hash"], "signature_evidence": record["evidence"], "signature_record_id": record["id"],
        "signers_pending": [contract.get("seller_id")]}})
    await db.offers.update_one({"id": offer["id"]}, {"$set": {"status": "pending", "signed_at": now.isoformat(), "signature_record_id": record["id"],
                                                              "expires_at": offer["expires_at"]}})
    buyer_name = (record["evidence"].get("identity") or {}).get("verified_name") or display_name(user) or buyer_pseudonym(user["id"])
    await email_user(offer.get("seller_id"), "offer_received", buyer_name=buyer_name, amount=fmt_eur_fr(offer["amount"]),
                     sale_object=SALE_OBJECT_LABELS.get(offer.get("sale_object"), ""), expires_at=fmt_date_fr(offer.get("expires_at")))
    await _offer_message(user, offer.get("seller_id"), offer,
                         f"Offre d'achat n° {contract.get('contract_number')} signée : {fmt_eur_fr(offer['amount'])} "
                         f"({SALE_OBJECT_LABELS.get(offer.get('sale_object'), '')}), valable jusqu'au {fmt_date_fr(offer.get('expires_at'))}.",
                         "offer", now)
    await create_audit_log(action="OFFER_SIGNED", property_id=offer["property_id"], actor_id=user["id"], actor_email=user["email"],
                           details={"offer_id": offer["id"], "contract_id": contract["id"], "amount": offer["amount"]})
    return {"message": "Offre signée avec succès", "contract_number": contract.get("contract_number"), "signature_hash": record["signature_hash"],
            "signed_at": now.isoformat(), "document_id": record["id"], "pdf_url": document_pdf_path(record), "offer_id": offer["id"], "status": "pending"}

@api_router.get("/offers/my")
async def get_my_offers(current_user: dict = Depends(get_current_user)):
    """Offres de l'acquéreur, les plus récentes d'abord ; chaque offre porte `property` (titre, type, ville, prix)"""
    if current_user.get("role") != "buyer":
        raise api_error(403, "not_allowed", "Réservé aux acquéreurs")
    offers = await db.offers.find({"buyer_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for offer in offers:
        if offer.get("status") == "pending_signature" and offer.get("contract_id"):
            # « Signer mon offre » depuis le tableau de bord : texte intégral du contrat à signer
            contract = await db.generated_contracts.find_one({"id": offer["contract_id"]}, {"_id": 0, "content": 1, "contract_number": 1, "terms_date": 1})
            if contract:
                offer["content"] = contract.get("content")
                offer["contract_number"] = contract.get("contract_number")
                offer["terms_date"] = contract.get("terms_date")
        property = await db.properties.find_one({"id": offer["property_id"]}, {"_id": 0, "title": 1, "property_type": 1, "city": 1,
                                                                               "department": 1, "region": 1, "asking_price": 1})
        if property:
            offer["property"] = {"title": property.get("title"), "property_type": property.get("property_type"), "city": property.get("city"),
                                 "department": property.get("department"), "region": property.get("region"),
                                 "asking_price": property.get("asking_price")}
    return {"offers": offers}

@api_router.get("/offers/property/{property_id}")
async def get_property_offers(property_id: str, current_user: dict = Depends(get_current_user)):
    """Offres reçues pour une annonce (vendeur, admin) ; un acquéreur ne voit que les siennes"""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    if is_property_owner(property, current_user) or current_user.get("role") == "admin":
        offers = await db.offers.find({"property_id": property_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    else:
        offers = await db.offers.find({"property_id": property_id, "buyer_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    labels = PartyLabels(current_user)
    for offer in offers:
        offer["buyer_label"] = await labels.label(offer.get("buyer_id"), property)
    return {"offers": scrub_contacts(offers, current_user)}

async def _accept_offer(offer: dict, contract: Optional[dict], seller: dict, evidence: Optional[dict], now: datetime, amount: float,
                        buyer_signed_counter: Optional[dict] = None) -> dict:
    """Offre acceptée : contre-signature du vendeur (ou signature de l'acquéreur sur la contre-proposition), étape de vente"""
    record = None
    if contract and evidence is not None:
        document_sha256 = hashlib.sha256((contract.get("content") or "").encode()).hexdigest()
        record = await record_signature(contract, seller, evidence, "offer", "seller", now, document_sha256)
        await db.generated_contracts.update_one({"id": contract["id"]}, {"$set": {
            "status": "fully_signed", "countersigned_at": now.isoformat(), "countersignature_record_id": record["id"],
            "countersignature_evidence": record["evidence"], "signers_pending": []}})
    elif contract:
        # Contre-proposition acceptée : l'engagement du vendeur est la contre-proposition enregistrée avec son dossier de preuve
        seller_record_id = (offer.get("counter") or {}).get("record_id")
        await db.generated_contracts.update_one({"id": contract["id"]}, {"$set": {
            "status": "fully_signed", "countersigned_at": now.isoformat(), "signers_pending": [],
            **({"countersignature_record_id": seller_record_id} if seller_record_id else {})}})
    update = {"status": "accepted", "responded_at": now.isoformat(), "countersigned_at": now.isoformat(), "accepted_at": now.isoformat(), "amount": float(amount)}
    if record:
        update["countersignature_record_id"] = record["id"]
    if buyer_signed_counter:
        update.update(buyer_signed_counter)
    await db.offers.update_one({"id": offer["id"]}, {"$set": update})
    offer_doc = await db.offers.find_one({"id": offer["id"]}, {"_id": 0}) or {**offer, **update}
    property = await db.properties.find_one({"id": offer["property_id"]}, {"_id": 0}) or {}
    # Étape de vente (closing.py, SPEC §7.4) : créée une seule fois, checklist envoyée aux deux parties
    closing_module = LOADED_MODULES.get("closing")
    if closing_module and property:
        try:
            closing = await closing_module.create_closing_for_offer(offer_doc, property)
            offer_doc["closing_id"] = closing.get("id")
        except Exception as e:
            logging.error(f"Création de l'étape de vente impossible pour l'offre {offer['id']}: {e}")
    return offer_doc

@api_router.put("/offers/{offer_id}/respond")
async def respond_to_offer(offer_id: str, response: OfferRespond, request: Request, current_user: dict = Depends(get_current_user)):
    """Vendeur : accepte (contre-signature par code → `accepted` + étape de vente), refuse avec motif ou fait une
    contre-proposition (`countered`, acceptée ensuite par l'acquéreur avec un code)."""
    offer = await db.offers.find_one({"id": offer_id}, {"_id": 0})
    if not offer:
        raise HTTPException(status_code=404, detail="Offre non trouvée")
    if current_user["id"] != offer.get("seller_id") and current_user.get("role") != "admin":
        raise api_error(403, "not_allowed", "Seul le vendeur peut répondre à cette offre")
    if offer.get("status") != "pending":
        raise api_error(400, "validation", "Cette offre n'est pas en attente de votre réponse" if offer.get("status") != "pending_signature"
                        else "L'acquéreur n'a pas encore signé cette offre")
    now = datetime.now(timezone.utc)
    expires = _parse_dt(offer.get("expires_at"))
    if response.action != "reject" and expires and expires < now:
        await db.offers.update_one({"id": offer_id}, {"$set": {"status": "expired", "expired_at": now.isoformat()}})
        raise api_error(400, "validation", "Cette offre a expiré")
    contract = await _offer_contract(offer)
    amount_text = fmt_eur_fr(offer["amount"])

    if response.action == "accept":
        evidence = None
        if contract:
            evidence = await verify_signature_code(current_user, contract, response.otp_code, request)
        offer_doc = await _accept_offer(offer, contract, current_user, evidence, now, offer["amount"])
        record = await _latest_offer_record(contract["id"]) if contract else None
        await email_user(offer["buyer_id"], "offer_accepted", amount=amount_text, pdf_link=_offer_pdf_link(record))
        await _offer_message(current_user, offer["buyer_id"], offer, f"Offre de {amount_text} acceptée et contresignée. L'étape de vente est "
                             "ouverte : l'avant-contrat se prépare maintenant chez le notaire.", "offer_response", now)
        await create_audit_log(action="OFFER_ACCEPTED", property_id=offer["property_id"], actor_id=current_user["id"], actor_email=current_user["email"],
                               details={"offer_id": offer_id, "amount": offer["amount"]})
        return {"message": "Offre acceptée", "status": "accepted", "offer": offer_view(offer_doc), "closing_id": offer_doc.get("closing_id")}

    if response.action == "reject":
        reason = (response.reason or response.message or "").strip()
        if len(reason) < 3:
            raise api_error(400, "validation", "Indiquez le motif du refus", missing=["reason"])
        await db.offers.update_one({"id": offer_id}, {"$set": {"status": "rejected", "responded_at": now.isoformat(), "rejection_reason": reason, "response_message": reason}})
        if contract:
            await db.generated_contracts.update_one({"id": contract["id"]}, {"$set": {"status": "rejected", "signers_pending": []}})
        await email_user(offer["buyer_id"], "offer_rejected", amount=amount_text, reason=reason)
        await _offer_message(current_user, offer["buyer_id"], offer, f"Offre de {amount_text} refusée. Motif : {reason}", "offer_response", now)
        return {"message": "Offre refusée", "status": "rejected"}

    # Contre-proposition : nouvelle proposition de prix du vendeur, horodatée depuis son espace, à accepter par l'acquéreur (code)
    if not response.counter_amount:
        raise api_error(400, "validation", "Indiquez le montant de la contre-proposition", missing=["counter_amount"])
    counter = {"amount": float(response.counter_amount), "message": (response.message or "").strip() or None, "at": now.isoformat(),
               "by": current_user["id"], "ip": client_ip(request),
               "user_agent": request.headers.get("user-agent")}
    await db.offers.update_one({"id": offer_id}, {"$set": {"status": "countered", "responded_at": now.isoformat(), "counter_amount": counter["amount"],
                                                        "counter": counter, "response_message": counter["message"]}})
    if contract:
        text = (f"Le Vendeur propose un prix de {fmt_eur_fr(counter['amount'])} en lieu et place de {amount_text}, "
                f"depuis son espace authentifié le {fmt_datetime_paris(now)}." + (f" Message : {counter['message']}" if counter["message"] else ""))
        # Dossier de preuve de la contre-proposition (horodatage, IP, navigateur, identité), chaîné aux actes du vendeur
        is_seller = current_user["id"] == offer.get("seller_id")
        record = await record_signature(contract, current_user, session_evidence(current_user, contract, request, "authenticated_session"),
                                        "offer_counter_proposal", "seller" if is_seller else "platform", now,
                                        hashlib.sha256(text.encode()).hexdigest(), extra={"addendum": text})
        counter["record_id"] = record["id"]
        await db.offers.update_one({"id": offer_id}, {"$set": {"counter.record_id": record["id"]}})
        addendum = {"title": f"Contre-proposition du vendeur du {fmt_date_fr(now)}", "text": text, "at": now.isoformat(), "kind": "counter",
                    "record_id": record["id"]}
        await db.generated_contracts.update_one({"id": contract["id"]}, {"$push": {"addenda": addendum}, "$set": {"signers_pending": [offer["buyer_id"]]}})
    await email_user(offer["buyer_id"], "offer_countered", amount=amount_text, counter_amount=fmt_eur_fr(counter["amount"]),
                     message=counter["message"] or "aucun message", expires_at=fmt_date_fr(offer.get("expires_at")))
    await _offer_message(current_user, offer["buyer_id"], offer, f"Contre-proposition : {fmt_eur_fr(counter['amount'])}." + (f" {counter['message']}" if counter["message"] else ""),
                         "offer_response", now)
    return {"message": "Contre-proposition envoyée", "status": "countered", "counter_amount": counter["amount"]}

@api_router.put("/offers/{offer_id}/accept-counter")
async def accept_counter_offer(offer_id: str, data: OfferCounterAccept, request: Request, current_user: dict = Depends(get_current_user)):
    """Acquéreur : accepte la contre-proposition du vendeur par code → `accepted` + étape de vente"""
    offer = await db.offers.find_one({"id": offer_id}, {"_id": 0})
    if not offer:
        raise HTTPException(status_code=404, detail="Offre non trouvée")
    if current_user["id"] != offer.get("buyer_id"):
        raise api_error(403, "not_allowed", "Seul l'acquéreur peut accepter cette contre-proposition")
    if offer.get("status") != "countered" or not offer.get("counter_amount"):
        raise api_error(400, "validation", "Aucune contre-proposition en attente sur cette offre")
    now = datetime.now(timezone.utc)
    expires = _parse_dt(offer.get("expires_at"))
    if expires and expires < now:
        await db.offers.update_one({"id": offer_id}, {"$set": {"status": "expired", "expired_at": now.isoformat()}})
        raise api_error(400, "validation", "Cette offre a expiré")
    contract = await _offer_contract(offer)
    if not contract:
        raise api_error(400, "validation", "Cette offre n'a pas de document à signer")
    evidence = await verify_signature_code(current_user, contract, data.otp_code, request)
    counter_amount = float(offer["counter_amount"])
    text = (f"L'Acquéreur accepte la contre-proposition du Vendeur : prix de {fmt_eur_fr(counter_amount)} en lieu et place de "
            f"{fmt_eur_fr(offer['amount'])}, les autres conditions de l'offre n° {contract.get('contract_number')} demeurant inchangées. "
            f"Signé électroniquement par code le {fmt_datetime_paris(now)}.")
    document_sha256 = hashlib.sha256(text.encode()).hexdigest()
    record = await record_signature(contract, current_user, evidence, "offer_counter", "buyer", now, document_sha256, extra={"addendum": text})
    addendum = {"title": f"Acceptation de la contre-proposition le {fmt_date_fr(now)}", "text": text, "at": now.isoformat(), "kind": "counter_accepted",
                "record_id": record["id"]}
    await db.generated_contracts.update_one({"id": contract["id"]}, {"$push": {"addenda": addendum}})
    offer_doc = await _accept_offer(offer, contract, current_user, None, now, counter_amount,
                                    buyer_signed_counter={"initial_amount": offer["amount"], "counter_accepted_at": now.isoformat(),
                                                          "counter_signature_record_id": record["id"]})
    buyer_name = (record["evidence"].get("identity") or {}).get("verified_name") or display_name(current_user) or buyer_pseudonym(current_user["id"])
    await email_user(offer.get("seller_id"), "offer_counter_accepted", buyer_name=buyer_name, amount=fmt_eur_fr(counter_amount), pdf_link=document_pdf_link(record))
    await _offer_message(current_user, offer.get("seller_id"), offer, f"Contre-proposition de {fmt_eur_fr(counter_amount)} acceptée et signée. L'étape de vente est ouverte.",
                         "offer_response", now)
    return {"message": "Contre-proposition acceptée", "status": "accepted", "offer": offer_view(offer_doc), "closing_id": offer_doc.get("closing_id"),
            "pdf_url": document_pdf_path(record)}

@api_router.get("/offers/{offer_id}/pdf")
async def download_offer_pdf(offer_id: str, current_user: dict = Depends(get_current_user)):
    """PDF de l'offre (texte signé, contre-proposition éventuelle, page de preuve avec les signatures des deux parties)"""
    offer = await db.offers.find_one({"id": offer_id}, {"_id": 0})
    if not offer:
        raise HTTPException(status_code=404, detail="Offre non trouvée")
    if current_user["id"] not in (offer.get("seller_id"), offer.get("buyer_id")) and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Non autorisé")
    if offer.get("status") == "pending_signature":
        raise api_error(400, "validation", "Le PDF est disponible une fois l'offre signée")
    contract = await _offer_contract(offer)
    if not contract:
        raise HTTPException(status_code=404, detail="PDF non trouvé")
    pdf = await contract_pdf_bytes(contract)
    return {"filename": f"offre_{contract.get('contract_number', offer_id[:8])}.pdf", "content": base64.b64encode(pdf).decode("utf-8")}

async def job_offers_expiry(now: datetime) -> int:
    """Offres arrivées au terme de leur validité sans acceptation : `expired`, e-mail à l'acquéreur (et au vendeur si elle était signée)"""
    count = 0
    async for offer in db.offers.find({"status": {"$in": list(OFFER_OPEN_STATUSES)}}, {"_id": 0}):
        expires = _parse_dt(offer.get("expires_at"))
        if not expires or expires > now or not await claim_once("offer_expiry", offer["id"]):
            continue
        previous = offer.get("status")
        await db.offers.update_one({"id": offer["id"]}, {"$set": {"status": "expired", "expired_at": now.isoformat()}})
        if offer.get("contract_id"):
            await db.generated_contracts.update_one({"id": offer["contract_id"]}, {"$set": {"status": "expired", "signers_pending": []}})
        amount = fmt_eur_fr(offer.get("amount"))
        await email_user(offer.get("buyer_id"), "offer_expired", amount=amount, role_text="que vous avez adressée", expires_at=fmt_date_fr(expires),
                         next_step="Vous pouvez formuler une nouvelle offre depuis votre espace si votre projet se poursuit.")
        if previous in ("pending", "countered"):
            await email_user(offer.get("seller_id"), "offer_expired", amount=amount, role_text="reçue pour votre bien", expires_at=fmt_date_fr(expires),
                             next_step="L'acquéreur peut vous adresser une nouvelle offre depuis son espace.")
        count += 1
    return count
# ============ ADMIN ROUTES ============
@api_router.get("/admin/stats")
async def get_admin_stats(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    total_properties = await db.properties.count_documents({})
    published_properties = await db.properties.count_documents({"status": "published"})
    ownership_pending = await db.properties.count_documents({"ownership.status": "pending", "status": {"$nin": ["removed", "archived"]}})
    total_users = await db.users.count_documents({"deleted_at": {"$exists": False}})
    
    # Revenu : factures d'honoraires émises et encaissées (montants HT)
    invoices = await db.invoices.find({"status": {"$nin": ["cancelled", "draft"]}}, {"_id": 0, "status": 1, "total_ht": 1}).to_list(10000)
    invoiced = round(sum(float(i.get("total_ht") or 0) for i in invoices), 2)
    paid = round(sum(float(i.get("total_ht") or 0) for i in invoices if i.get("status") == "paid"), 2)
    
    return {
        "total_properties": total_properties,
        "published_properties": published_properties,
        "ownership_pending": ownership_pending,
        "total_users": total_users,
        "invoices_count": len(invoices),
        "total_revenue": invoiced,
        "paid_revenue": paid,
    }


# ---- Onglet « À faire » (SPEC §6.3) : une ligne = une action ; digest quotidien par e-mail si non vide (§6.1) ----
def _todo_row(kind: str, key: str, title: str, detail: str = "", since: str = "", ref: Optional[dict] = None,
              actions: Optional[list] = None) -> dict:
    return {"type": kind, "id": key, "title": title, "detail": detail, "since": since, "ref": ref or {}, "actions": actions or []}

async def build_admin_todo(now: Optional[datetime] = None) -> dict:
    """Agrège tout ce qui attend l'administrateur : annonces publiées < 48 h à relire (drapeaux), justificatifs de propriété
    à contrôler, demandes de dossier sans réponse > 7 j, offres acceptées > 60 j sans vente, ventes déclarées / contestées,
    factures en retard, mandats < 30 j, échecs de jobs, identités en repli."""
    now = now or datetime.now(timezone.utc)
    now_iso = now.isoformat()
    sections = []

    # 0. Mode test (MODE-TEST.md §2.12) : actif, ou désactivé avec des données de test restantes à purger
    rows = []
    if test_mode_enabled():
        rows.append(_todo_row("test_mode", "test_mode", "Mode test actif",
                              detail="Identité simulée, e-mails capturés dans la boîte de test, documents sans valeur juridique. "
                                     "Avant l'ouverture : supprimer les données de test, puis TEST_MODE=false.",
                              actions=[{"label": "Simuler la purge", "method": "POST", "url": "/api/admin/test/purge?dry_run=true"}]))
    elif await db.users.find_one({"is_test": True}, {"_id": 0, "id": 1}) or await db.properties.find_one({"is_test": True}, {"_id": 0, "id": 1}):
        rows.append(_todo_row("test_data", "test_data", "Données de test à supprimer",
                              detail="Le mode test est désactivé mais des comptes ou annonces de test restent en base.",
                              actions=[{"label": "Simuler la purge", "method": "POST", "url": "/api/admin/test/purge?dry_run=true"},
                                       {"label": "Supprimer", "method": "POST", "url": "/api/admin/test/purge?dry_run=false"}]))
    if rows:
        sections.append({"key": "test_mode", "title": "Mode test", "rows": rows})

    # 1. Annonces publiées depuis moins de 48 h, à relire (post-modération)
    rows = []
    for c in await db.properties.find({"status": "published", "moderation.status": "pending", "moderation.review_until": {"$gte": now_iso}},
                                     {"_id": 0, "id": 1, "title": 1, "moderation": 1, "siret": 1, "company_name": 1, "region": 1,
                                      "published_at": 1, "asking_price": 1, "gross_yield": 1, "ownership": 1}).sort("published_at", -1).to_list(200):
        flags = [LISTING_FLAG_LABELS.get(f, f) for f in (c.get("moderation") or {}).get("flags") or []]
        rows.append(_todo_row("listing_review", c["id"], c.get("title") or "Annonce à relire",
                              detail=("Drapeaux : " + " · ".join(flags)) if flags else "Aucun drapeau", since=c.get("published_at") or "",
                              ref={"property_id": c["id"], "company_name": c.get("company_name"), "siret": c.get("siret"),
                                   "flags": (c.get("moderation") or {}).get("flags") or [], "asking_price": c.get("asking_price"),
                                   "gross_yield": c.get("gross_yield"), "ownership_status": (c.get("ownership") or {}).get("status")},
                              actions=[{"label": "Valider", "method": "PUT", "url": f"/api/properties/{c['id']}/status?status=published"},
                                       {"label": "Retirer avec motif", "method": "PUT",
                                        "url": f"/api/properties/{c['id']}/status?status=removed&reason=<motif>&reason_text=<texte>",
                                        "reasons": REMOVAL_REASONS}]))
    sections.append({"key": "listings_review", "title": "Annonces publiées à relire (48 h)", "rows": rows})

    # 1 bis. Justificatifs de propriété à contrôler (SPEC §9) : aperçu du fichier, valider ou refuser avec motif
    rows = []
    for c in await db.properties.find({"ownership.status": "pending", "status": {"$nin": ["removed", "archived"]}},
                                     {"_id": 0, "id": 1, "title": 1, "ownership": 1, "status": 1, "seller_id": 1, "owner_type": 1}).sort("ownership.uploaded_at", 1).to_list(200):
        o = c.get("ownership") or {}
        rows.append(_todo_row("ownership_proof", c["id"], f"Justificatif de propriété à contrôler — {c.get('title') or 'annonce'}",
                              detail=f"{OWNERSHIP_DOC_TYPES.get(o.get('doc_type'), o.get('doc_type') or '')} · {o.get('filename') or ''} · annonce {c.get('status')}",
                              since=o.get("uploaded_at") or "",
                              ref={"property_id": c["id"], "doc_type": o.get("doc_type"), "uploaded_at": o.get("uploaded_at"),
                                   "owner_type": c.get("owner_type"), "filename": o.get("filename"),
                                   "file_url": f"/api/properties/{c['id']}/ownership-proof/file"},
                              actions=[{"label": "Voir le justificatif", "method": "GET", "url": f"/api/properties/{c['id']}/ownership-proof/file"},
                                       {"label": "Valider", "method": "PUT", "url": f"/api/admin/properties/{c['id']}/ownership",
                                        "body": {"status": "verified"}},
                                       {"label": "Refuser avec motif", "method": "PUT", "url": f"/api/admin/properties/{c['id']}/ownership",
                                        "body": {"status": "rejected", "note": "<motif>"}}]))
    sections.append({"key": "ownership_proofs", "title": "Justificatifs de propriété à contrôler", "rows": rows})

    # 2. Demandes de dossier sans réponse depuis plus de 7 jours
    rows = []
    limit = (now - timedelta(days=7)).isoformat()
    for a in await db.dataroom_access.find({"status": "pending", "requested_at": {"$lte": limit}}, {"_id": 0}).sort("requested_at", 1).to_list(200):
        rows.append(_todo_row("dataroom_unanswered", a["id"], "Demande de dossier sans réponse du vendeur",
                              detail=f"Annonce {a.get('property_id', '')[:8]} · acquéreur {a.get('buyer_email') or a.get('buyer_id', '')}",
                              since=a.get("requested_at") or "", ref={"property_id": a.get("property_id"), "buyer_id": a.get("buyer_id")},
                              actions=[{"label": "Relancer le vendeur", "method": "POST", "url": f"/api/admin/dataroom/{a['id']}/remind"}]))
    sections.append({"key": "dataroom_unanswered", "title": "Demandes de dossier sans réponse (> 7 j)", "rows": rows})

    # 3. Offres acceptées depuis plus de 60 jours sans vente déclarée ; ventes déclarées / contestées (closing.py)
    stale, declared = [], []
    limit60 = (now - timedelta(days=60)).isoformat()
    for cl in await db.closings.find({"status": {"$in": ["in_progress", "declared", "disputed"]}}, {"_id": 0}).sort("updated_at", -1).to_list(500):
        label = cl.get("property_label") or cl.get("property_id", "")[:8]
        if cl["status"] == "in_progress" and (cl.get("accepted_at") or "") <= limit60:
            stale.append(_todo_row("closing_stale", cl["id"], f"Offre acceptée sans vente depuis plus de 60 jours — {label}",
                                   since=cl.get("accepted_at") or "", ref={"closing_id": cl["id"], "property_id": cl.get("property_id")},
                                   actions=[{"label": "Voir", "method": "GET", "url": "/api/admin/closings?status=in_progress"}]))
        elif cl["status"] in ("declared", "disputed"):
            title = ("Vente contestée" if cl["status"] == "disputed" else "Vente déclarée, en attente de confirmation") + f" — {label}"
            declared.append(_todo_row("closing_" + cl["status"], cl["id"], title,
                                      detail=((cl.get("dispute") or {}).get("reason") or ""),
                                      since=((cl.get("declaration") or {}).get("declared_at") or cl.get("updated_at") or ""),
                                      ref={"closing_id": cl["id"], "property_id": cl.get("property_id")},
                                      actions=[{"label": "Confirmer", "method": "PUT", "url": f"/api/admin/closings/{cl['id']}/resolve", "body": {"action": "confirm"}},
                                               {"label": "Annuler la déclaration", "method": "PUT", "url": f"/api/admin/closings/{cl['id']}/resolve", "body": {"action": "cancel"}}]))
    sections.append({"key": "closings_declared", "title": "Ventes déclarées ou contestées", "rows": declared})
    sections.append({"key": "closings_stale", "title": "Offres acceptées > 60 j sans vente", "rows": stale})

    # 4. Lignes « À faire » des modules (factures en retard + mise en demeure, contestations, adresse du débiteur manquante)
    rows = []
    for t in await db.todos.find({"status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(200):
        actions = [{"label": "Clore", "method": "PUT", "url": f"/api/admin/todos/{t['id']}/done"}]
        if t.get("action"):
            actions.insert(0, {"label": "Ouvrir", "method": "GET", "url": t["action"]})
        ref = t.get("ref") or {}
        if t.get("type") == "invoice_overdue" and ref.get("invoice_id"):
            actions.insert(0, {"label": "Marquer payée", "method": "PUT", "url": f"/api/admin/invoices/{ref['invoice_id']}/paid"})
        rows.append(_todo_row(t.get("type") or "todo", t["id"], t.get("title") or "", since=t.get("created_at") or "", ref=ref, actions=actions))
    sections.append({"key": "todos", "title": "Factures en retard, contestations, données manquantes", "rows": rows})

    # 5. Mandats qui expirent dans moins de 30 jours
    rows = []
    limit30 = (now + timedelta(days=30)).isoformat()
    for m in await db.generated_contracts.find({"type": "mandat", "status": "signed", "ends_at": {"$lte": limit30, "$gte": now_iso}},
                                               {"_id": 0, "id": 1, "property_id": 1, "ends_at": 1, "registry_number": 1, "seller_id": 1}).to_list(200):
        rows.append(_todo_row("mandate_expiring", m["id"], f"Mandat n° {m.get('registry_number', '')} expire le {(m.get('ends_at') or '')[:10]}",
                              since=m.get("ends_at") or "", ref={"mandate_id": m["id"], "property_id": m.get("property_id"), "seller_id": m.get("seller_id")},
                              actions=[{"label": "Voir le registre", "method": "GET", "url": "/api/admin/mandates"}]))
    sections.append({"key": "mandates_expiring", "title": "Mandats à moins de 30 jours", "rows": rows})

    # 7. Échecs de tâches planifiées (7 derniers jours)
    rows = []
    limit7 = (now - timedelta(days=7)).isoformat()
    for f in await db.job_failures.find({"at": {"$gte": limit7}}, {"_id": 0}).sort("at", -1).to_list(50):
        title = "E-mail non envoyé" if f.get("kind") == "email" else f"Tâche « {f.get('job')} » en erreur"
        rows.append(_todo_row("job_failure", f"{f.get('job')}:{f.get('at')}", title, detail=(f.get("error") or "")[:300],
                              since=f.get("at") or "", actions=[{"label": "Relancer les tâches", "method": "POST", "url": "/api/admin/jobs/run"}]))
    age = backup_age_hours(now)
    if age is not None and age > BACKUP_MAX_AGE_HOURS:
        rows.insert(0, _todo_row("backup_stale", now.strftime("%Y-%m-%d"), f"Sauvegarde : aucune réussite depuis {int(age)} h",
                                 detail="Vérifier le service backup (ops/backup.sh, fichier last_failure du volume) puis lancer BACKUP_ONCE=1.",
                                 since=(now - timedelta(hours=age)).isoformat()))
    sections.append({"key": "job_failures", "title": "Échecs de tâches et sauvegarde", "rows": rows})

    # 8. Identités en repli (vérification Stripe impossible : « Nous vous recontactons »)
    rows = []
    for u in await db.users.find({"kyc_status": "manual_review", "deleted_at": {"$exists": False}},
                                 {"_id": 0, "id": 1, "email": 1, "role": 1, "kyc_fallback_at": 1, "updated_at": 1}).to_list(100):
        rows.append(_todo_row("kyc_manual", u["id"], f"Identité à vérifier manuellement — {u.get('email')} ({u.get('role')})",
                              since=u.get("kyc_fallback_at") or u.get("updated_at") or "", ref={"user_id": u["id"]},
                              actions=[{"label": "Marquer vérifiée", "method": "PUT", "url": f"/api/admin/kyc/{u['id']}/validate?status=verified"}]))
    sections.append({"key": "kyc_manual", "title": "Identités en repli", "rows": rows})

    # 9. Demandes de dossier expirées sans réponse (vendeurs muets, 30 derniers jours) : relance humaine possible
    rows = []
    limit30d = (now - timedelta(days=30)).isoformat()
    for a in await db.dataroom_access.find({"status": "expired", "expired_at": {"$gte": limit30d}}, {"_id": 0}).sort("expired_at", -1).to_list(100):
        rows.append(_todo_row("dataroom_expired", a["id"], "Demande de dossier expirée sans réponse du vendeur",
                              detail=f"Annonce {a.get('property_id', '')[:8]} · {buyer_pseudonym(a.get('buyer_id'))}",
                              since=a.get("expired_at") or "", ref={"property_id": a.get("property_id"), "buyer_id": a.get("buyer_id")},
                              actions=[{"label": "Voir l'annonce", "method": "GET", "url": f"/api/properties/{a.get('property_id')}"}]))
    sections.append({"key": "dataroom_expired", "title": "Demandes de dossier expirées (30 j)", "rows": rows})

    # 10. Signalements (page /signaler → événement `report`, 30 derniers jours)
    rows = []
    for ev in await db.events.find({"name": "report", "created_at": {"$gte": limit30d}}, {"_id": 0}).sort("created_at", -1).to_list(100):
        props = ev.get("props") or {}
        rows.append(_todo_row("report", ev.get("id") or ev.get("created_at", ""), f"Signalement : {props.get('reason') or 'motif non précisé'}",
                              detail=" · ".join(str(props.get(k)) for k in ("reference", "description") if props.get(k))[:300],
                              since=ev.get("created_at") or "", ref={"reference": props.get("reference"), "email": props.get("email")},
                              actions=[{"label": "Retirer avec motif", "method": "PUT",
                                        "url": "/api/properties/<property_id>/status?status=removed&reason=<motif>&reason_text=<texte>",
                                        "reasons": REMOVAL_REASONS}]))
    sections.append({"key": "reports", "title": "Signalements", "rows": rows})

    total = sum(len(sec["rows"]) for sec in sections)
    return {"generated_at": now_iso, "total": total, "sections": sections}

@api_router.get("/admin/todo")
async def admin_todo(current_user: dict = Depends(require_admin)):
    """Onglet par défaut de l'admin : tout ce qui attend une action, avec l'action à faire sur chaque ligne"""
    return await build_admin_todo()

async def job_admin_digest(now: datetime) -> int:
    """Un seul e-mail quotidien « À faire » à l'administrateur ; rien n'est envoyé quand la liste est vide (SPEC §6.1)"""
    todo = await build_admin_todo(now)
    if not todo["total"]:
        return 0
    parts = []
    for sec in todo["sections"]:
        if not sec["rows"]:
            continue
        items = "".join(f"<li>{html_escape(r['title'])}" + (f" <small>({html_escape(r['detail'])})</small>" if r.get("detail") else "") + "</li>"
                        for r in sec["rows"][:20])
        more = f"<li>… et {len(sec['rows']) - 20} de plus</li>" if len(sec["rows"]) > 20 else ""
        parts.append(f"<h3>{html_escape(sec['title'])} ({len(sec['rows'])})</h3><ul>{items}{more}</ul>")
    await email_admin("admin_todo_digest", count=todo["total"], sections="".join(parts), link=site_url("/admin/dashboard"))
    return todo["total"]

# ---- Écran du lundi (SPEC §6.3, rapport §7.6) : KPI par semaine, cibles, coûts du mois ----
KPI_TARGETS = {
    "listings_published": 1, "listings_blocked": 0, "estimates_completed": 3, "estimate_to_listing_pct": 30, "listing_to_mandate_pct": 65,
    "publish_delay_median_h": 1, "auto_publish_pct": 90, "contacts": 5, "contacts_per_listing_30d": 5, "nda_signed": 2,
    "nda_per_listing_30d": 2, "offers": 1, "seller_response_48h_pct": 80, "requests_expired": 0, "offers_accepted": 1,
    "sales_declared": 1, "invoices_issued": 1, "invoices_paid": 1, "invoices_overdue": 0, "ownership_pending": 0, "costs": 600,
    "blocking_actions": 3,
}

def _week_start(dt: datetime) -> datetime:
    return (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)

def _median(values: list) -> Optional[float]:
    if not values:
        return None
    values = sorted(values)
    mid = len(values) // 2
    return round(values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2, 1)

def _pct(part: int, whole: int) -> Optional[float]:
    return round(100.0 * part / whole, 1) if whole else None

async def compute_kpis(weeks: int, now: Optional[datetime] = None) -> dict:
    """{weeks: [{start, end, kpis}] (semaines terminées, croissantes), targets, current: {start, end, kpis} (semaine en cours),
    previous} — chaque KPI est calculé sur la semaine (lundi → dimanche)"""
    now = now or datetime.now(timezone.utc)
    weeks = max(1, min(weeks, 52))
    this_week = _week_start(now)
    first = this_week - timedelta(weeks=weeks)
    since_iso = (first - timedelta(days=60)).isoformat()
    dt = _parse_dt
    properties = await db.properties.find({}, {"_id": 0, "id": 1, "status": 1, "created_at": 1, "published_at": 1, "submitted_at": 1,
                                             "blocking": 1, "auto_published": 1, "seller_id": 1, "mandate_id": 1,
                                             "ownership": 1}).to_list(100000)
    mandates = await db.generated_contracts.find({"type": "mandat", "status": {"$in": ["signed", "denounced", "expired", "void"]}},
                                                 {"_id": 0, "property_id": 1, "signed_at": 1}).to_list(100000)
    estimates = await db.estimates.find({"created_at": {"$gte": since_iso}}, {"_id": 0, "created_at": 1, "email": 1, "siret": 1}).to_list(100000)
    contacts = await db.contacts.find({}, {"_id": 0, "property_id": 1, "buyer_id": 1, "seller_id": 1, "created_at": 1}).to_list(100000)
    ndas = await db.documents.find({"doc_type": "nda"}, {"_id": 0, "property_id": 1, "signed_at": 1}).to_list(100000)
    offers = await db.offers.find({}, {"_id": 0, "status": 1, "created_at": 1, "accepted_at": 1, "signed_at": 1}).to_list(100000)
    requests = await db.dataroom_access.find({}, {"_id": 0, "status": 1, "expired_at": 1}).to_list(100000)
    closings = await db.closings.find({}, {"_id": 0, "status": 1, "declaration": 1, "confirmed_at": 1}).to_list(100000)
    invoices = await db.invoices.find({}, {"_id": 0, "status": 1, "issued_on": 1, "paid_on": 1, "due_on": 1, "total_ht": 1}).to_list(100000)
    audits = await db.audit_logs.find({"action": {"$in": ["LISTING_REMOVED"]}}, {"_id": 0, "timestamp": 1}).to_list(100000)
    todos_done = await db.todos.find({"status": "done"}, {"_id": 0, "done_at": 1, "updated_at": 1}).to_list(100000)
    costs = {c["month"]: c async for c in db.costs.find({}, {"_id": 0})}
    seller_msgs = await db.messages.find({"kind": {"$ne": "system"}}, {"_id": 0, "property_id": 1, "sender_id": 1, "receiver_id": 1, "created_at": 1}).to_list(200000)
    first_reply = {}
    for m in seller_msgs:
        key = (m.get("property_id"), m.get("receiver_id"), m.get("sender_id"))
        t = dt(m.get("created_at"))
        if t and (key not in first_reply or t < first_reply[key]):
            first_reply[key] = t
    mandate_by_property = {}
    for m in mandates:
        t = dt(m.get("signed_at"))
        if t and (m.get("property_id") not in mandate_by_property or t < mandate_by_property[m["property_id"]]):
            mandate_by_property[m["property_id"]] = t
    estimate_emails = {e.get("email") for e in estimates if e.get("email")}
    sellers_by_id = {}
    async for u in db.users.find({"role": "seller"}, {"_id": 0, "id": 1, "email": 1}):
        sellers_by_id[u["id"]] = u.get("email")

    def in_week(value, start, end) -> bool:
        t = dt(value)
        return bool(t) and start <= t < end

    rows = []
    for i in range(weeks + 1):
        start = first + timedelta(weeks=i)
        end = start + timedelta(weeks=1)
        month = start.strftime("%Y-%m")
        published = [c for c in properties if in_week(c.get("published_at"), start, end)]
        created = [c for c in properties if in_week(c.get("created_at"), start, end)]
        blocked = [c for c in properties if c.get("blocking") and in_week(c.get("submitted_at"), start, end)]
        week_estimates = [e for e in estimates if in_week(e.get("created_at"), start, end)]
        delays = []
        for c in published:
            a, b = dt(c.get("created_at")), dt(c.get("published_at"))
            if a and b and b >= a:
                delays.append((b - a).total_seconds() / 3600)
        from_estimate = [c for c in created if sellers_by_id.get(c.get("seller_id")) in estimate_emails]
        with_mandate = [c for c in created if c["id"] in mandate_by_property]
        week_contacts = [c for c in contacts if in_week(c.get("created_at"), start, end)]
        replied_48h = 0
        for c in week_contacts:
            reply = first_reply.get((c.get("property_id"), c.get("buyer_id"), c.get("seller_id")))
            t0 = dt(c.get("created_at"))
            if reply and t0 and reply >= t0 and (reply - t0).total_seconds() <= 48 * 3600:
                replied_48h += 1
        live_30d = [c for c in properties if c.get("published_at") and (dt(c["published_at"]) or now) >= end - timedelta(days=30)
                    and (dt(c["published_at"]) or now) < end]
        contacts_30d = [c for c in contacts if in_week(c.get("created_at"), end - timedelta(days=30), end)]
        ndas_30d = [n for n in ndas if in_week(n.get("signed_at"), end - timedelta(days=30), end)]
        week_invoices = [inv for inv in invoices if in_week(inv.get("issued_on"), start, end)]
        overdue = [inv for inv in invoices if inv.get("status") == "issued" and inv.get("due_on") and (inv["due_on"] + "T00:00:00+00:00") < end.isoformat()]
        kpis = {
            "listings_published": len(published),
            "listings_blocked": len(blocked),
            "estimates_completed": len(week_estimates),
            "estimate_to_listing_pct": _pct(len(from_estimate), len(week_estimates)),
            "listing_to_mandate_pct": _pct(len(with_mandate), len(created)),
            "publish_delay_median_h": _median(delays),
            "auto_publish_pct": _pct(sum(1 for c in published if c.get("auto_published")), len(published)),
            "contacts": len(week_contacts),
            "contacts_per_listing_30d": round(len(contacts_30d) / len(live_30d), 1) if live_30d else None,
            "nda_signed": sum(1 for n in ndas if in_week(n.get("signed_at"), start, end)),
            "nda_per_listing_30d": round(len(ndas_30d) / len(live_30d), 1) if live_30d else None,
            "offers": sum(1 for o in offers if in_week(o.get("created_at"), start, end)),
            "seller_response_48h_pct": _pct(replied_48h, len(week_contacts)),
            "requests_expired": sum(1 for r in requests if r.get("status") == "expired" and in_week(r.get("expired_at"), start, end)),
            "offers_accepted": sum(1 for o in offers if o.get("status") == "accepted" and in_week(o.get("accepted_at") or o.get("created_at"), start, end)),
            "sales_declared": sum(1 for cl in closings if in_week((cl.get("declaration") or {}).get("declared_at"), start, end)),
            "invoices_issued": len(week_invoices),
            "invoices_paid": sum(1 for inv in invoices if inv.get("status") == "paid" and in_week(inv.get("paid_on"), start, end)),
            "invoices_overdue": len(overdue),
            # Justificatifs déposés pendant la semaine et toujours en attente de contrôle
            "ownership_pending": sum(1 for c in properties if (c.get("ownership") or {}).get("status") == "pending"
                                     and in_week((c.get("ownership") or {}).get("uploaded_at"), start, end)),
            "costs": float((costs.get(month) or {}).get("amount") or 0),
            "blocking_actions": sum(1 for a in audits if in_week(a.get("timestamp"), start, end))
            + sum(1 for t in todos_done if in_week(t.get("done_at") or t.get("updated_at"), start, end)),
            "revenue_invoiced_ht": round(sum(float(inv.get("total_ht") or 0) for inv in week_invoices), 2),
            "revenue_paid_ht": round(sum(float(inv.get("total_ht") or 0) for inv in invoices if inv.get("status") == "paid" and in_week(inv.get("paid_on"), start, end)), 2),
        }
        rows.append({"start": start.date().isoformat(), "end": (end - timedelta(days=1)).date().isoformat(), "month": month, "kpis": kpis})
    current = rows[-1]
    finished = rows[:-1]
    return {"weeks": finished, "targets": KPI_TARGETS, "current": current,
            "previous": finished[-1] if finished else None, "generated_at": now.isoformat()}

@api_router.get("/admin/kpis")
async def admin_kpis(weeks: int = 8, current_user: dict = Depends(require_admin)):
    """Écran du lundi : les KPI du rapport §7.6 par semaine (semaine en cours en dernier), cibles et semaine courante"""
    return await compute_kpis(weeks)

class CostInput(BaseModel):
    month: str = Field(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    amount: float = Field(..., ge=0, le=1_000_000)
    note: Optional[str] = Field(None, max_length=500)

@api_router.put("/admin/costs")
async def admin_set_costs(data: CostInput, current_user: dict = Depends(require_admin)):
    """Coûts du mois saisis par le fondateur (hébergement, domaine, publicité…) : une ligne par mois"""
    now = datetime.now(timezone.utc).isoformat()
    doc = {"month": data.month, "amount": float(data.amount), "note": (data.note or "").strip() or None, "updated_at": now, "updated_by": current_user["id"]}
    await db.costs.update_one({"month": data.month}, {"$set": doc, "$setOnInsert": {"created_at": now}}, upsert=True)
    return {"cost": doc}

@api_router.get("/admin/costs")
async def admin_get_costs(current_user: dict = Depends(require_admin)):
    costs = await db.costs.find({}, {"_id": 0}).sort("month", -1).to_list(120)
    return {"costs": costs, "total": round(sum(float(c.get("amount") or 0) for c in costs), 2)}

@api_router.get("/admin/users")
async def get_all_users(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    users = await db.users.find({}, USER_SAFE_PROJECTION).to_list(1000)
    return users

@api_router.put("/admin/kyc/{user_id}/validate")
async def validate_kyc(user_id: str, status: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    if status not in {"pending", "under_review", "verified", "rejected"}:
        raise HTTPException(status_code=400, detail="Statut KYC invalide")
    update = {"kyc_status": status, "identity_verified": status == "verified"}
    if status == "verified":
        update["kyc_provider"] = "admin"
    await db.users.update_one({"id": user_id}, {"$set": update})
    if status == "verified":
        await identity_verified_effects(user_id)
    return {"message": "KYC status updated"}

# ============ PAGES PUBLIQUES (SEO) ============

def slugify(value: str) -> str:
    """Identique à slugify() de frontend/src/lib/referentiels.js"""
    import unicodedata
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn").lower()
    text = re.sub(r"['’]", "-", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")

@api_router.get("/public/legal-info")
async def public_legal_info():
    """Informations de l'entité exploitante pour les mentions légales (configuration centrale)"""
    return LEGAL_ENTITY

@api_router.get("/public/listing-stats")
async def public_listing_stats():
    """Nombre d'annonces en ligne par type de bien, type de bail, département et région (page des annonces, pré-rendu).
    Seules les valeurs > 0 sont renvoyées : le front décide de l'affichage et n'écrit jamais « 0 »."""
    by_type, by_lease, by_region, by_department, total = {}, {}, {}, {}, 0
    async for c in db.properties.find(hide_test_listings({"status": "published"}),
                                     {"_id": 0, "property_type": 1, "lease_type": 1, "region": 1, "department": 1}):
        total += 1
        for value, bucket in ((c.get("property_type"), by_type), (c.get("lease_type"), by_lease), (c.get("region"), by_region),
                              (c.get("department"), by_department)):
            if value:
                bucket[value] = bucket.get(value, 0) + 1
    rows = lambda d: [{"value": k, "count": v} for k, v in sorted(d.items(), key=lambda x: -x[1]) if v > 0]
    return {
        "total": total,
        "by_property_type": [{**r, "label": taxonomy.property_type_label(r["value"])} for r in rows(by_type)],
        "by_lease_type": [{**r, "label": taxonomy.lease_type_label(r["value"])} for r in rows(by_lease)],
        "by_department": [{**r, "label": taxonomy.departement_name(r["value"]), "region": taxonomy.region_for_departement(r["value"])} for r in rows(by_department)],
        "by_region": [{**r, "slug": slugify(r["value"])} for r in rows(by_region)],
    }

def load_seo_routes() -> list:
    """Routes publiques statiques de l'application (copie de frontend/scripts/seo-routes.json, régénérée au build)"""
    try:
        with open(ROOT_DIR / "seo_routes.json", encoding="utf-8") as f:
            return json.load(f).get("routes", [])
    except (OSError, ValueError):
        return [{"path": "/", "changefreq": "daily"}]

# Pages techniques ou privées, jamais dans le plan du site
SITEMAP_EXCLUDED_PREFIXES = ("/annonce/", "/embed/", "/test/", "/seller/", "/buyer/", "/admin/", "/dataroom/", "/vente/",
                             "/messages", "/profile", "/suivi/", "/reset-password/", "/confirmer-email/")
SITEMAP_EXCLUDED_PATHS = ("/test", "/login", "/register", "/mot-de-passe-oublie")

def sitemap_static_path(path: Optional[str]) -> bool:
    """Route statique publiable dans le plan du site : ni fiche d'annonce (ajoutée à part), ni page privée ou technique"""
    if not path or not path.startswith("/"):
        return False
    if path in SITEMAP_EXCLUDED_PATHS:
        return False
    return not path.startswith(SITEMAP_EXCLUDED_PREFIXES)

@api_router.get("/sitemap.xml")
async def sitemap():
    """Plan du site : routes statiques de seo_routes.json (page des annonces, page vendeur, estimateur, pages légales) puis
    fiches des annonces publiées (/annonce/{id}, date de dernière modification). Les annonces de test n'y figurent jamais,
    même en mode test."""
    from xml.sax.saxutils import escape as xml_escape
    urls = []
    seen = set()
    for route in load_seo_routes():
        path = route.get("path")
        if not sitemap_static_path(path) or path in seen:
            continue
        seen.add(path)
        lastmod = f"<lastmod>{route['lastmod']}</lastmod>" if route.get("lastmod") else ""
        urls.append(f"<url><loc>{xml_escape(site_url(path))}</loc>{lastmod}"
                    f"<changefreq>{route.get('changefreq', 'weekly')}</changefreq></url>")
    async for c in db.properties.find({"status": "published", "is_test": {"$ne": True}, "mandate_is_test": {"$ne": True}},
                                     {"_id": 0, "id": 1, "updated_at": 1, "published_at": 1}).sort("published_at", -1):
        lastmod = str(c.get("updated_at") or c.get("published_at") or "")[:10]
        lastmod = f"<lastmod>{lastmod}</lastmod>" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", lastmod) else ""
        urls.append(f"<url><loc>{xml_escape(site_url('/annonce/' + c['id']))}</loc>{lastmod}<changefreq>weekly</changefreq></url>")
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(urls) + "</urlset>"
    return Response(content=xml, media_type="application/xml")

# ============ SUIVI DU TEST DE MARCHÉ ============

FOLLOWUP_ANSWERS = {
    "en_discussion": "Toujours en discussion",
    "rencontre": "Visite prévue ou faite",
    "accord": "Accord ou offre d'achat en cours",
    "pas_de_suite": "Pas de suite",
}

def _parse_dt(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None

@api_router.get("/admin/metrics")
async def get_admin_metrics(days: int = 30, current_user: dict = Depends(get_current_user)):
    """Indicateurs du test de marché : inscriptions, entonnoir de mise en relation, sources, tendance hebdomadaire"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    in_period = lambda v: (_parse_dt(v) or datetime.min.replace(tzinfo=timezone.utc)) >= since
    
    users = await db.users.find({"role": {"$in": ["buyer", "seller"]}},
                                {"_id": 0, "id": 1, "role": 1, "created_at": 1, "acquisition_source": 1,
                                 "identity_verified": 1, "kyc_status": 1}).to_list(100000)
    properties = await db.properties.find({}, {"_id": 0, "id": 1, "status": 1, "created_at": 1, "seller_id": 1}).to_list(100000)
    contacts = await db.contacts.find({}, {"_id": 0}).to_list(100000)
    contracts = await db.generated_contracts.find(
        {"type": {"$in": ["nda", "offer"]}, "status": {"$in": ["signed", "buyer_signed", "fully_signed"]}},
        {"_id": 0, "type": 1, "buyer_id": 1, "signed_at": 1, "created_at": 1}).to_list(100000)
    offers = await db.offers.find({}, {"_id": 0, "buyer_id": 1, "status": 1, "created_at": 1}).to_list(100000)
    seller_msgs = await db.messages.find({}, {"_id": 0, "property_id": 1, "sender_id": 1, "receiver_id": 1, "created_at": 1}).to_list(200000)
    
    buyers = [u for u in users if u["role"] == "buyer" and in_period(u.get("created_at"))]
    sellers = [u for u in users if u["role"] == "seller" and in_period(u.get("created_at"))]
    period_contacts = [c for c in contacts if in_period(c.get("created_at"))]
    
    # Réponse du vendeur : premier message du vendeur vers l'acquéreur après le contact
    first_reply = {}
    for m in seller_msgs:
        key = (m.get("property_id"), m.get("receiver_id"), m.get("sender_id"))
        dt = _parse_dt(m.get("created_at"))
        if dt and (key not in first_reply or dt < first_reply[key]):
            first_reply[key] = dt
    reply_hours, replied_buyers = [], set()
    for c in period_contacts:
        reply = first_reply.get((c.get("property_id"), c.get("buyer_id"), c.get("seller_id")))
        start = _parse_dt(c.get("created_at"))
        if reply and start and reply >= start:
            reply_hours.append((reply - start).total_seconds() / 3600)
            replied_buyers.add(c.get("buyer_id"))
    reply_hours.sort()
    median = None
    if reply_hours:
        mid = len(reply_hours) // 2
        median = reply_hours[mid] if len(reply_hours) % 2 else (reply_hours[mid - 1] + reply_hours[mid]) / 2
    
    period_contracts = [c for c in contracts if in_period(c.get("signed_at") or c.get("created_at"))]
    period_offers = [o for o in offers if in_period(o.get("created_at"))]
    
    # Entonnoir des acquéreurs inscrits sur la période
    buyer_ids = {u["id"] for u in buyers}
    verified_ids = {u["id"] for u in buyers if is_user_verified(u)}
    contacted_ids = {c["buyer_id"] for c in contacts if c.get("buyer_id") in buyer_ids}
    funnel = [
        {"step": "Acquéreurs inscrits", "count": len(buyer_ids)},
        {"step": "Identité vérifiée", "count": len(verified_ids)},
        {"step": "Premier contact", "count": len(contacted_ids)},
        {"step": "Réponse du vendeur", "count": len(contacted_ids & replied_buyers)},
        {"step": "Engagement de confidentialité signé", "count": len(buyer_ids & {c["buyer_id"] for c in contracts if c["type"] == "nda"})},
        {"step": "Offre d'achat signée", "count": len(buyer_ids & {c["buyer_id"] for c in contracts if c["type"] == "offer"})},
        {"step": "Offre d'achat", "count": len(buyer_ids & {o["buyer_id"] for o in offers})},
    ]
    
    sources = {}
    for u in buyers + sellers:
        key = u.get("acquisition_source") or "non renseigné"
        sources[key] = sources.get(key, 0) + 1
    
    # 12 dernières semaines (lundi)
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    weeks = [monday - timedelta(weeks=i) for i in range(11, -1, -1)]
    def week_of(value):
        dt = _parse_dt(value)
        if not dt:
            return None
        return (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    weekly = []
    for w in weeks:
        weekly.append({
            "week": w.date().isoformat(),
            "buyers": sum(1 for u in users if u["role"] == "buyer" and week_of(u.get("created_at")) == w),
            "sellers": sum(1 for u in users if u["role"] == "seller" and week_of(u.get("created_at")) == w),
            "listings": sum(1 for c in properties if week_of(c.get("created_at")) == w),
            "contacts": sum(1 for c in contacts if week_of(c.get("created_at")) == w),
        })
    
    followup_counts = {}
    async for f in db.followups.find({"answer": {"$ne": None}}, {"_id": 0, "answer": 1}):
        followup_counts[f["answer"]] = followup_counts.get(f["answer"], 0) + 1
    
    statuses = [c.get("status") for c in properties]
    # Statistiques maison (events.py) : par jour et par nom d'événement, visiteurs uniques, pages
    events_module = LOADED_MODULES.get("events")
    events_metrics = await events_module.metrics_by_day(days) if events_module else None
    return {
        "period_days": days,
        "events": events_metrics,
        "totals": {
            "buyers": len(buyers),
            "sellers": len(sellers),
            "listings_published": statuses.count("published"),
            "listings_pending": statuses.count("pending"),
            "listings_draft": statuses.count("draft"),
            "contacts": len(period_contacts),
            "conversations_replied": len(reply_hours),
            "reply_rate": (len(reply_hours) / len(period_contacts)) if period_contacts else 0,
            "median_reply_hours": round(median, 1) if median is not None else None,
            "nda_signed": sum(1 for c in period_contracts if c["type"] == "nda"),
            "offers_signed": sum(1 for c in period_contracts if c["type"] == "offer"),
            "offers": len(period_offers),
            "offers_accepted": sum(1 for o in period_offers if o.get("status") == "accepted"),
        },
        "funnel": funnel,
        "sources": sorted([{"source": k, "count": v} for k, v in sources.items()], key=lambda x: -x["count"]),
        "weekly": weekly,
        "followups": [{"answer": k, "label": FOLLOWUP_ANSWERS.get(k, k), "count": followup_counts.get(k, 0)} for k in FOLLOWUP_ANSWERS],
    }

class FollowupAnswer(BaseModel):
    answer: str
    comment: Optional[str] = Field(None, max_length=2000)

@api_router.post("/followup/{token}")
async def answer_followup(token: str, data: FollowupAnswer):
    """Réponse au questionnaire envoyé 30 jours après un premier contact (lien email, sans connexion)"""
    if data.answer not in FOLLOWUP_ANSWERS:
        raise HTTPException(status_code=400, detail="Réponse invalide")
    followup = await db.followups.find_one({"token": token}, {"_id": 0})
    if not followup:
        raise HTTPException(status_code=404, detail="Lien de suivi invalide")
    update = {"answer": data.answer, "answered_at": datetime.now(timezone.utc).isoformat()}
    if data.comment is not None:
        update["comment"] = data.comment.strip()
    await db.followups.update_one({"token": token}, {"$set": update})
    return {"ok": True, "label": FOLLOWUP_ANSWERS[data.answer]}

# ============ FAVORITES SYSTEM ============

class FavoriteCreate(BaseModel):
    property_id: str

@api_router.post("/favorites")
async def add_favorite(favorite: FavoriteCreate, current_user: dict = Depends(get_current_user)):
    """Ajouter une annonce aux favoris"""
    # Check if property exists
    property = await db.properties.find_one({"id": favorite.property_id}, {"_id": 0})
    if not property or property.get("status") != "published":
        raise HTTPException(status_code=404, detail="Annonce non trouvée")
    
    # Check if already favorited
    existing = await db.favorites.find_one({
        "user_id": current_user["id"],
        "property_id": favorite.property_id
    })
    if existing:
        return {"message": "Déjà en favoris", "favorited": True}
    
    # Add to favorites
    fav_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "property_id": favorite.property_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    try:
        await db.favorites.insert_one(fav_doc)
    except Exception:
        # Double clic : l'index unique (user_id, property_id) a déjà la ligne
        return {"message": "Déjà en favoris", "favorited": True}
    
    # Increment favorites count on property
    await db.properties.update_one(
        {"id": favorite.property_id},
        {"$inc": {"favorites_count": 1}}
    )
    
    return {"message": "Ajouté aux favoris", "favorited": True, "favorite_id": fav_doc["id"]}

@api_router.delete("/favorites/{property_id}")
async def remove_favorite(property_id: str, current_user: dict = Depends(get_current_user)):
    """Retirer une annonce des favoris"""
    result = await db.favorites.delete_one({
        "user_id": current_user["id"],
        "property_id": property_id
    })
    
    if result.deleted_count > 0:
        # Decrement favorites count on property
        await db.properties.update_one(
            {"id": property_id},
            {"$inc": {"favorites_count": -1}}
        )
        return {"message": "Retiré des favoris", "favorited": False}
    
    return {"message": "Non trouvé dans les favoris", "favorited": False}

@api_router.get("/favorites")
async def get_favorites(current_user: dict = Depends(get_current_user)):
    """Récupérer la liste des favoris de l'utilisateur"""
    favorites = await db.favorites.find(
        {"user_id": current_user["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    # Annonce associée (vue publique, ou révélée après l'engagement)
    for fav in favorites:
        property = await db.properties.find_one({"id": fav["property_id"]}, {"_id": 0})
        if property:
            fav["property"] = await sanitize_property(property, current_user)
    
    return {"favorites": favorites}

@api_router.get("/favorites/check/{property_id}")
async def check_favorite(property_id: str, current_user: dict = Depends(get_current_user)):
    """Vérifier si une annonce est en favoris"""
    existing = await db.favorites.find_one({
        "user_id": current_user["id"],
        "property_id": property_id
    })
    return {"favorited": existing is not None}

# ============ ALERTES (avec compte et sans compte, SPEC §5.3, API.md §8) ============
# Alertes avec compte : db.alerts {user_id, property_types, regions, max_price, min_yield, active}.
# Alertes sans compte : db.public_alerts {email, property_types, regions, max_price, min_yield, status: pending|active|unsubscribed} ;
# confirmation et désinscription par lien signé (JWT_SECRET), pages HTML minimales en français.
ALERT_CONFIRM_TTL = timedelta(days=7)
MAX_ALERTS_PER_USER = 5

class AlertCreate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    property_types: Optional[List[str]] = None
    regions: Optional[List[str]] = None
    max_price: Optional[float] = Field(None, ge=0)
    min_yield: Optional[float] = Field(None, ge=0, le=20)

class AlertUpdate(AlertCreate):
    active: Optional[bool] = None

class PublicAlertCreate(BaseModel):
    email: EmailStr
    property_types: Optional[List[str]] = None
    regions: Optional[List[str]] = None
    max_price: Optional[float] = Field(None, ge=0)
    min_yield: Optional[float] = Field(None, ge=0, le=20)

def normalize_alert_fields(data: dict) -> dict:
    """Types de biens du référentiel, régions connues (nom ou slug), prix maximum et rendement minimum > 0"""
    out = {}
    if "property_types" in data and data["property_types"] is not None:
        out["property_types"] = [t for t in dict.fromkeys(data["property_types"]) if taxonomy.property_type_by_id(t)]
    if "regions" in data and data["regions"] is not None:
        regions = []
        for r in data["regions"]:
            name = taxonomy.region_by_slug(r) or (r if r in taxonomy.REGIONS else None)
            if name and name not in regions:
                regions.append(name)
        out["regions"] = regions
    for key in ("max_price", "min_yield"):
        if key in data and data[key] is not None:
            out[key] = float(data[key]) if data[key] and data[key] > 0 else None
    return out

def alert_name_for(alert: dict) -> str:
    parts = [", ".join(taxonomy.property_type_label(t, short=True) for t in alert.get("property_types") or []) or "Tous les biens",
             ", ".join(alert.get("regions") or []) or "Toute la France"]
    if alert.get("max_price"):
        parts.append(f"≤ {fmt_eur_fr(alert['max_price'])}")
    if alert.get("min_yield"):
        parts.append(f"rendement brut ≥ {fmt_percent_fr(alert['min_yield'])}")
    return " · ".join(parts)

def alert_matches(alert: dict, property: dict) -> bool:
    """Une annonce correspond à une alerte : types de biens (OU), régions (OU), prix maximum, rendement brut minimum"""
    types = alert.get("property_types") or []
    if types and property.get("property_type") not in types:
        return False
    regions = alert.get("regions") or []
    if regions and property.get("region") not in regions:
        return False
    price = float(property.get("asking_price") or 0)
    if alert.get("max_price") and price > float(alert["max_price"]):
        return False
    if alert.get("min_yield"):
        gross = property.get("gross_yield")
        if gross is None:
            gross = taxonomy.gross_yield(property.get("rent_monthly"), property.get("asking_price"))
        if gross is None or gross < float(alert["min_yield"]):
            return False
    return True

def alert_token(payload: dict, ttl: Optional[timedelta] = None) -> str:
    data = dict(payload)
    if ttl:
        data["exp"] = datetime.now(timezone.utc) + ttl
    return jwt.encode(data, JWT_SECRET, algorithm=JWT_ALGORITHM)

def read_alert_token(token: str, action: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    return payload if payload.get("action") == action else None

def unsubscribe_link_for_user(user_id: str) -> str:
    """Lien de désinscription des e-mails non transactionnels d'un compte (préférence notifications_opt_out)"""
    return site_url(f"/api/alerts/unsubscribe/{alert_token({'action': 'unsubscribe', 'user': user_id})}")

def unsubscribe_link_for_public_alert(alert_id: str) -> str:
    return site_url(f"/api/alerts/unsubscribe/{alert_token({'action': 'unsubscribe', 'alert': alert_id})}")

def listing_card_html(property: dict) -> str:
    """Résumé d'une annonce dans un e-mail (titre généré, bail, loyer, rendement brut, prix) ; jamais l'adresse"""
    title = property.get("title") or taxonomy.property_title(property.get("property_type"), property.get("city"), property.get("department"),
                                                             property.get("surface"), property.get("rooms"), property.get("units_count"))
    lease = taxonomy.lease_type_label(property.get("lease_type"), short=True)
    gross = property.get("gross_yield")
    if gross is None:
        gross = taxonomy.gross_yield(property.get("rent_monthly"), property.get("asking_price"))
    details = [lease,
               f"Loyer {fmt_eur_fr(property['rent_monthly'])} HC par mois" if property.get("rent_monthly") else "",
               f"Rendement brut {fmt_percent_fr(gross)}" if gross is not None else "",
               f"Prix {fmt_eur_fr(property['asking_price'])}" if property.get("asking_price") else "",
               "Propriétaire vérifié" if (property.get("ownership") or {}).get("status") == "verified" else ""]
    lines = [f"<strong>{html_escape(title)}</strong>", " · ".join(html_escape(d) for d in details if d)]
    link = site_url("/annonce/" + property["id"])
    return "<p>" + "<br>".join(line for line in lines if line) + f'<br><a href="{link}">Voir l\'annonce</a></p>'

@api_router.post("/alerts")
async def create_alert(alert: AlertCreate, current_user: dict = Depends(get_current_user)):
    """Alerte avec compte (adresse e-mail confirmée obligatoire) : types de biens, régions, prix maximum, rendement minimum"""
    require_verified_email(current_user)
    count = await db.alerts.count_documents({"user_id": current_user["id"]})
    if count >= MAX_ALERTS_PER_USER:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_ALERTS_PER_USER} alertes autorisées")
    fields = normalize_alert_fields(alert.model_dump())
    alert_doc = {
        "id": str(uuid.uuid4()), "user_id": current_user["id"], "user_email": current_user["email"],
        "property_types": [], "regions": [], "max_price": None, "min_yield": None, **fields,
        "active": True, "created_at": datetime.now(timezone.utc).isoformat(), "last_triggered": None,
    }
    alert_doc["name"] = (alert.name or "").strip() or alert_name_for(alert_doc)
    mark_test(alert_doc, current_user)
    await db.alerts.insert_one(alert_doc)
    alert_doc.pop("_id", None)
    return {"message": "Alerte créée", "alert": alert_doc}

@api_router.get("/alerts")
async def get_alerts(current_user: dict = Depends(get_current_user)):
    alerts = await db.alerts.find({"user_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(10)
    return {"alerts": alerts}

@api_router.put("/alerts/{alert_id}")
async def update_alert(alert_id: str, alert: AlertUpdate, current_user: dict = Depends(get_current_user)):
    existing = await db.alerts.find_one({"id": alert_id, "user_id": current_user["id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Alerte non trouvée")
    data = alert.model_dump(exclude_unset=True)
    update_data = normalize_alert_fields(data)
    if data.get("name") is not None:
        update_data["name"] = data["name"].strip() or alert_name_for({**existing, **update_data})
    if data.get("active") is not None:
        update_data["active"] = bool(data["active"])
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.alerts.update_one({"id": alert_id}, {"$set": update_data})
    updated = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    return {"message": "Alerte mise à jour", "alert": updated}

@api_router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.alerts.delete_one({"id": alert_id, "user_id": current_user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Alerte non trouvée")
    return {"message": "Alerte supprimée"}

# ---- Alertes sans compte ----
@api_router.post("/alerts/public")
@limiter.limit("5/minute")
async def create_public_alert(request: Request, data: PublicAlertCreate, background_tasks: BackgroundTasks):
    """Alerte sans compte : e-mail de confirmation (double opt-in), puis envoi immédiat à chaque annonce correspondante et
    digest hebdomadaire ; désinscription par lien signé dans chaque e-mail. → {status:'confirmation_sent'}"""
    email = data.email.strip().lower()
    fields = normalize_alert_fields(data.model_dump())
    now = datetime.now(timezone.utc)
    alert_doc = {
        "id": str(uuid.uuid4()), "email": email, "property_types": fields.get("property_types") or [], "regions": fields.get("regions") or [],
        "max_price": fields.get("max_price"), "min_yield": fields.get("min_yield"), "status": "pending",
        "created_at": now.isoformat(), "confirmed_at": None, "last_triggered": None, "ip": client_ip(request),
    }
    existing = await db.public_alerts.find_one({"email": email, "status": {"$in": ["pending", "active"]}}, {"_id": 0})
    if existing:
        # Une alerte par adresse : les critères sont remplacés, le statut conservé (déjà confirmée → reste active)
        keep = {"status": existing["status"], "confirmed_at": existing.get("confirmed_at"), "id": existing["id"], "created_at": existing["created_at"]}
        alert_doc.update(keep)
        if existing.get("is_test"):
            alert_doc["is_test"] = True  # une alerte existante garde sa nature (réelle ou de test)
        await db.public_alerts.replace_one({"id": existing["id"]}, alert_doc)
    else:
        mark_test(alert_doc)
        await db.public_alerts.insert_one(alert_doc)
    alert_doc.pop("_id", None)
    if alert_doc["status"] == "active":
        return {"status": "already_active", "message": "Votre alerte est déjà active : ses critères ont été mis à jour."}
    token = alert_token({"action": "confirm", "alert": alert_doc["id"]}, ALERT_CONFIRM_TTL)
    subject, html = render_email("alert_confirm", criteria=alert_name_for(alert_doc), link=site_url(f"/api/alerts/confirm/{token}"))
    background_tasks.add_task(send_brevo_email, email, "", subject, html)
    return {"status": "confirmation_sent", "message": "Un e-mail de confirmation vient de vous être envoyé."}

def _alert_page(title: str, text: str, cta_label: str = "Voir les annonces", cta_path: str = "/",
                form_action: str = "", form_label: str = "", form_fields: Optional[dict] = None) -> Response:
    """Page HTML minimale en français (pas de route front). Avec `form_action` : bouton qui envoie l'action en POST
    (un lien d'e-mail ouvert en GET, par exemple par une passerelle de sécurité, n'a jamais d'effet)."""
    if form_action:
        hidden = "".join(f'<input type="hidden" name="{html_escape(k)}" value="{html_escape(str(v))}">' for k, v in (form_fields or {}).items())
        action_html = (f'<form method="post" action="{html_escape(form_action)}">{hidden}'
                       f'<button type="submit" class="btn">{html_escape(form_label)}</button></form>')
    else:
        action_html = f'<a class="btn" href="{site_url(cta_path)}">{html_escape(cta_label)}</a>'
    html = f"""<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{html_escape(title)} — {html_escape(site_name())}</title>
<style>body{{font-family:Inter,Arial,sans-serif;background:#f5f7fa;color:#0b1220;margin:0;padding:24px 16px}}
main{{max-width:560px;margin:40px auto;background:#fff;border:1px solid #e3e7ee;border-radius:12px;padding:32px 24px}}
h1{{font-size:22px;margin:0 0 12px}}p{{font-size:16px;line-height:1.5}}.btn{{display:inline-block;margin-top:16px;padding:12px 20px;background:#0b1220;color:#fff;border:0;border-radius:8px;text-decoration:none;font:inherit;font-weight:600;cursor:pointer}}
.btn:focus{{outline:3px solid #1d4ed8;outline-offset:2px}}small{{display:block;margin-top:24px;color:#6b7280;font-size:13px}}</style></head>
<body><main><h1>{html_escape(title)}</h1><p>{html_escape(text)}</p>{action_html}
<small>{html_escape(site_name())} est opéré par AlterEgo SAS, carte professionnelle T. Aucune somme n'est due avant la signature de l'acte authentique.</small></main></body></html>"""
    return Response(content=html, media_type="text/html; charset=utf-8")

@api_router.get("/alerts/confirm/{token}")
async def confirm_public_alert(token: str):
    payload = read_alert_token(token, "confirm")
    alert = await db.public_alerts.find_one({"id": payload["alert"]}, {"_id": 0}) if payload else None
    if not alert:
        return _alert_page("Lien de confirmation invalide ou expiré",
                           "Ce lien n'est plus valable. Créez une nouvelle alerte depuis la page des annonces : vous recevrez un nouvel e-mail de confirmation.",
                           "Créer une alerte", "/#alerte")
    if alert["status"] == "unsubscribed":
        return _alert_page("Alerte désactivée", "Cette alerte a été désactivée. Vous pouvez en créer une nouvelle à tout moment.",
                           "Créer une alerte", "/#alerte")
    now = datetime.now(timezone.utc)
    if alert["status"] != "active":
        await db.public_alerts.update_one({"id": alert["id"]}, {"$set": {"status": "active", "confirmed_at": now.isoformat()}})
        subject, html = render_email("alert_confirmed", criteria=alert_name_for(alert), link=site_url("/"))
        await send_brevo_email(alert["email"], "", subject, html, unsubscribe_url=unsubscribe_link_for_public_alert(alert["id"]))
    return _alert_page("Votre alerte est active", f"Vous recevrez les prochaines annonces correspondant à vos critères ({alert_name_for(alert)}) "
                       "dès leur publication, et un récapitulatif chaque semaine. Chaque e-mail contient un lien de désinscription.")

@api_router.get("/alerts/unsubscribe/{token}")
async def unsubscribe_alert_page(token: str):
    """Lien « Ne plus recevoir ces e-mails » : page de confirmation SANS effet (les passerelles de sécurité des
    messageries ouvrent tous les liens) ; la désinscription se fait par le bouton (POST) ou en un clic depuis le client
    de messagerie (en-têtes List-Unsubscribe / List-Unsubscribe-Post, RFC 8058)."""
    payload = read_alert_token(token, "unsubscribe")
    if not payload or not (payload.get("alert") or payload.get("user")):
        return _alert_page("Lien invalide", "Ce lien de désinscription n'est pas valable. Vous pouvez gérer vos alertes depuis votre espace.",
                           "Accéder à mon espace", "/login")
    text = ("Vous ne recevrez plus d'alertes à cette adresse." if payload.get("alert") else
            "Vous ne recevrez plus les e-mails d'information (alertes, rappels, récapitulatifs). Les e-mails liés à vos "
            "démarches en cours (signatures, demandes de dossier, offres) continuent de vous parvenir.")
    return _alert_page("Confirmer la désinscription", text, form_action=f"/api/alerts/unsubscribe/{token}",
                       form_label="Me désinscrire")

@api_router.post("/alerts/unsubscribe/{token}")
async def unsubscribe_alert(token: str):
    """Désinscription (bouton de la page ou « List-Unsubscribe=One-Click ») : alerte sans compte (désactivée) ou compte
    (préférence notifications_opt_out)"""
    payload = read_alert_token(token, "unsubscribe")
    if not payload:
        return _alert_page("Lien invalide", "Ce lien de désinscription n'est pas valable. Vous pouvez gérer vos alertes depuis votre espace.",
                           "Accéder à mon espace", "/login")
    if payload.get("alert"):
        await db.public_alerts.update_one({"id": payload["alert"]}, {"$set": {"status": "unsubscribed", "unsubscribed_at": datetime.now(timezone.utc).isoformat()}})
        return _alert_page("Vous êtes désinscrit", "Vous ne recevrez plus d'alertes à cette adresse. Vous pouvez en créer une nouvelle à tout moment.")
    if payload.get("user"):
        await db.users.update_one({"id": payload["user"]}, {"$set": {"notifications_opt_out": True}})
        await db.alerts.update_many({"user_id": payload["user"]}, {"$set": {"active": False}})
        return _alert_page("Vous êtes désinscrit", "Vous ne recevrez plus les e-mails d'information (alertes, rappels, récapitulatifs). "
                           "Les e-mails liés à vos démarches en cours (signatures, demandes de dossier, offres) continuent de vous parvenir. "
                           "Vous pouvez réactiver les notifications depuis votre profil.", "Accéder à mon espace", "/login")
    return _alert_page("Lien invalide", "Ce lien de désinscription n'est pas valable.", "Accéder à mon espace", "/login")

# ---- Envoi immédiat à la publication, digest hebdomadaire, baisse de prix ----
async def alert_recipients_for(property: dict) -> list:
    """[(email, nom, lien de désinscription, alert_doc, kind)] des alertes actives qui correspondent à l'annonce"""
    recipients = []
    seen = set()
    # Une annonce de test n'est signalée qu'aux alertes de test (jamais aux abonnés réels)
    alert_query = {"is_test": True} if property.get("is_test") else {}
    async for alert in db.alerts.find({"active": True, **alert_query}, {"_id": 0}):
        if not alert_matches(alert, property):
            continue
        user = await db.users.find_one({"id": alert.get("user_id")}, {"_id": 0, "id": 1, "email": 1, "first_name": 1, "last_name": 1,
                                                                        "deleted_at": 1, "notifications_opt_out": 1})
        if not user or user.get("deleted_at") or user.get("notifications_opt_out") or user["email"] in seen:
            continue
        seen.add(user["email"])
        recipients.append((user["email"], display_name(user), unsubscribe_link_for_user(user["id"]), alert, "account"))
    async for alert in db.public_alerts.find({"status": "active", **alert_query}, {"_id": 0}):
        if alert["email"] in seen or not alert_matches(alert, property):
            continue
        seen.add(alert["email"])
        recipients.append((alert["email"], "", unsubscribe_link_for_public_alert(alert["id"]), alert, "public"))
    return recipients

async def trigger_alerts_for_property(property: dict) -> int:
    """Envoi immédiat aux alertes (compte et sans compte) qui correspondent à une annonce publiée ; renvoie le nombre d'envois"""
    sent = 0
    now = datetime.now(timezone.utc).isoformat()
    for email, name, unsubscribe, alert, kind in await alert_recipients_for(property):
        if not await claim_once("alert_listing", f"{alert['id']}:{property['id']}"):
            continue
        subject, html = render_email("alert_new_listing", criteria=alert_name_for(alert), card=listing_card_html(property))
        await send_brevo_email(email, name, subject, html, unsubscribe_url=unsubscribe)
        coll = db.alerts if kind == "account" else db.public_alerts
        await coll.update_one({"id": alert["id"]}, {"$set": {"last_triggered": now}})
        sent += 1
    return sent

async def count_matching_alerts(property: dict) -> int:
    return len(await alert_recipients_for(property))

async def job_alerts_weekly_digest(now: datetime) -> int:
    """Digest hebdomadaire : annonces publiées depuis 7 jours qui correspondent à chaque alerte active (une fois par semaine)"""
    since = (now - timedelta(days=7)).isoformat()
    properties = await db.properties.find({"status": "published", "published_at": {"$gte": since}}, PUBLIC_PROPERTY_PROJECTION).to_list(500)
    if not properties:
        return 0
    week = _period_keys(now)["weekly"]
    sent = 0
    async def send_digest(alert: dict, email: str, name: str, unsubscribe: str) -> bool:
        # Les annonces de test ne figurent que dans le digest des alertes de test
        matching = [c for c in properties if alert_matches(alert, c) and (alert.get("is_test") or not c.get("is_test"))]
        key = f"{alert['id']}:{week}"
        if not matching or not await claim_once("alert_digest", key):
            return False
        cards = "".join(listing_card_html(c) for c in matching[:10])
        subject, html = render_email("alert_digest", count=str(len(matching)), plural="s" if len(matching) > 1 else "",
                                     criteria=alert_name_for(alert), cards=cards, link=site_url("/"))
        result = await send_brevo_email(email, name, subject, html, unsubscribe_url=unsubscribe)
        if not (result or {}).get("success"):
            # Envoi échoué (Brevo, plafond journalier) : la marque est libérée pour que le prochain passage réessaie
            await db.job_marks.delete_one({"kind": "alert_digest", "key": key})
            return False
        return True
    async for alert in db.alerts.find({"active": True}, {"_id": 0}):
        user = await db.users.find_one({"id": alert.get("user_id")}, {"_id": 0, "id": 1, "email": 1, "first_name": 1, "last_name": 1,
                                                                        "deleted_at": 1, "notifications_opt_out": 1})
        if not user or user.get("deleted_at") or user.get("notifications_opt_out"):
            continue
        if await send_digest(alert, user["email"], display_name(user), unsubscribe_link_for_user(user["id"])):
            sent += 1
    async for alert in db.public_alerts.find({"status": "active"}, {"_id": 0}):
        if await send_digest(alert, alert["email"], "", unsubscribe_link_for_public_alert(alert["id"])):
            sent += 1
    return sent

async def notify_price_drop(property: dict, old_price: float, new_price: float) -> int:
    """Baisse de prix d'une annonce en ligne : acquéreurs qui l'ont mise en favori ou contactée (une fois par prix)"""
    buyer_ids = {f["user_id"] async for f in db.favorites.find({"property_id": property["id"]}, {"_id": 0, "user_id": 1})}
    buyer_ids |= {c["buyer_id"] async for c in db.conversations.find({"property_id": property["id"]}, {"_id": 0, "buyer_id": 1})}
    sent = 0
    for buyer_id in buyer_ids:
        if not buyer_id or not await claim_once("price_drop", f"{buyer_id}:{property['id']}:{int(new_price)}"):
            continue
        await email_user(buyer_id, "price_drop", unsubscribe_url=unsubscribe_link_for_user(buyer_id),
                         old_price=fmt_eur_fr(old_price), new_price=fmt_eur_fr(new_price), card=listing_card_html(dict(property)))
        sent += 1
    return sent

# ============ SELLER STATS ============

@api_router.get("/properties/{property_id}/stats")
async def get_property_stats(property_id: str, current_user: dict = Depends(get_current_user)):
    """Récupérer les statistiques d'une annonce (vendeur uniquement)"""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce non trouvée")
    
    # Only seller can see full stats
    if current_user["id"] != property.get("seller_id") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Non autorisé")
    
    # Get stats
    views = property.get("views", 0)
    favorites_count = await db.favorites.count_documents({"property_id": property_id})
    messages_count = await db.messages.count_documents({"property_id": property_id})
    unique_contacts = len(set([
        msg["sender_id"] async for msg in db.messages.find(
            {"property_id": property_id, "receiver_id": property.get("seller_id")},
            {"sender_id": 1}
        )
    ]))
    offers_count = await db.offers.count_documents({"property_id": property_id})
    
    return {
        "property_id": property_id,
        "views": views,
        "favorites_count": favorites_count,
        "messages_count": messages_count,
        "unique_contacts": unique_contacts,
        "offers_count": offers_count
    }

# ============ ENHANCED ADMIN ROUTES ============

@api_router.get("/admin/properties")
async def get_all_properties_admin(current_user: dict = Depends(get_current_user)):
    """Admin: Récupérer toutes les annonces avec détails complets"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    properties = await db.properties.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    # Enrich with seller info
    for property in properties:
        seller = await db.users.find_one({"id": property.get("seller_id")}, USER_SAFE_PROJECTION)
        if seller:
            property["seller"] = seller
        
        # Add stats
        property["favorites_count"] = await db.favorites.count_documents({"property_id": property["id"]})
        property["messages_count"] = await db.messages.count_documents({"property_id": property["id"]})
    
    return {"properties": properties}

@api_router.get("/admin/documents")
async def get_admin_documents(current_user: dict = Depends(get_current_user)):
    """Admin: tous les documents signés (mandats, accords de confidentialité, offres)"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    documents = await db.documents.find({}, {"_id": 0}).sort("signed_at", -1).to_list(1000)
    
    # Enrich with user info
    for doc in documents:
        signer = await db.users.find_one({"id": doc.get("signer_id")}, USER_SAFE_PROJECTION)
        if signer:
            doc["signer"] = signer
    
    return {"documents": documents}

# ============ NEWSLETTER ============

class NewsletterSubscribe(BaseModel):
    email: EmailStr
    first_name: Optional[str] = None

@api_router.post("/newsletter/subscribe")
async def subscribe_newsletter(data: NewsletterSubscribe):
    """Inscription à la lettre d'information (Brevo)"""
    email = data.email.lower().strip()
    first_name = (data.first_name or "").strip()[:100]
    
    if not email:
        raise HTTPException(status_code=400, detail="Email requis")
    
    # Check if already subscribed
    existing = await db.newsletter_subscribers.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email déjà inscrit")
    
    # Save to DB
    subscriber = {
        "id": str(uuid.uuid4()),
        "email": email,
        "first_name": first_name,
        "subscribed_at": datetime.now(timezone.utc).isoformat(),
        "source": "landing_page",
        "active": True
    }
    await db.newsletter_subscribers.insert_one(subscriber)
    
    # Add to Brevo list
    try:
        import sib_api_v3_sdk
        brevo_config = sib_api_v3_sdk.Configuration()
        brevo_config.api_key['api-key'] = os.environ.get("BREVO_API_KEY", "")
        api_instance = sib_api_v3_sdk.ContactsApi(sib_api_v3_sdk.ApiClient(brevo_config))
        
        # Create or update contact
        create_contact = sib_api_v3_sdk.CreateContact(
            email=email,
            attributes={"PRENOM": first_name} if first_name else {},
            list_ids=[3],  # Newsletter list ID in Brevo
            update_enabled=True
        )
        await asyncio.to_thread(api_instance.create_contact, create_contact)
    except Exception as e:
        print(f"Brevo error: {e}")
        # Continue even if Brevo fails - we have the email in DB
    
    return {"message": "Inscription réussie", "subscriber_id": subscriber["id"]}

# ============ GABARITS CONTRACTUELS (SPEC §7.2, §7.3) ============
# Textes complets en français, sans case à cocher ni blanc : toutes les variables {{...}} sont renseignées à la
# génération, sinon la génération échoue en nommant le champ manquant. Version des conditions : CONTRACT_TERMS_DATE.
CONTRACT_TERMS_DATE = "14/10/2026"
MANDATE_TERMS_VERSION = "v1"
NDA_TERMS_VERSION = "v1"
OFFER_TERMS_VERSION = "v1"
MANDATE_DURATION_MONTHS = 12
MANDATE_TAIL_MONTHS = 12
MANDATE_NOTICE_DAYS = 15
MANDATE_WITHDRAWAL_DAYS = 14
NDA_DURATION_MONTHS = 24
# Phrases remplacées à la signature (numéro de registre, horodatage et fin du délai de rétractation ne sont connus qu'à ce moment-là)
MANDATE_REGISTRY_PENDING = "attribué automatiquement lors de la signature électronique et reporté sur l'exemplaire signé"
SIGNATURE_DATE_PENDING = "à la date et à l'heure de l'horodatage du code de signature, qui font foi entre les parties"
WITHDRAWAL_END_PENDING = "quatorze jours après la date de signature, la date exacte étant reportée sur l'exemplaire signé"

# Mandat de vente simple (non exclusif) d'un bien loué : aucune clause d'exclusivité, de pénalité ni de garantie de
# rémunération (rien qui relève de l'art. 78 du décret n° 72-678).
DEFAULT_MANDAT_TEMPLATE = """MANDAT DE VENTE SIMPLE (NON EXCLUSIF) — BIEN LOUÉ

Mandat n° {{MANDAT_NUMERO}} — Annonce {{ANNONCE_REF}} — Conditions du {{VERSION_CONDITIONS}} (version {{VERSION_MANDAT}})
Numéro d'inscription au registre des mandats : {{REGISTRE}}

Article 1 – Les parties
1.1. Le Mandataire
{{PLATEFORME_DENOMINATION}} SAS, {{PLATEFORME_FORME_JURIDIQUE}} au capital de {{PLATEFORME_CAPITAL}}, immatriculée au RCS de {{PLATEFORME_RCS_VILLE}} sous le numéro {{PLATEFORME_SIREN}}, dont le siège est {{PLATEFORME_ADRESSE_COMPLETE}}, exploitant la plateforme {{MARQUE}}, titulaire de la carte professionnelle n° {{CARTE_T}} portant la mention « Transactions sur immeubles et fonds de commerce », délivrée par la {{CARTE_T_CCI}}, valable jusqu'au {{CARTE_T_VALIDITE}}, représentée par sa Présidente, {{PLATEFORME_REPR_NOM}}. {{RC_PRO}}
{{PLATEFORME_DENOMINATION}} SAS déclare ne recevoir ni détenir d'autres fonds, effets ou valeurs que ceux représentatifs de sa rémunération.
Ci-après « le Mandataire ».
1.2. Le Mandant
{{MANDANT_PRENOM}} {{MANDANT_NOM}}, adresse électronique confirmée : {{MANDANT_EMAIL}}, demeurant {{MANDANT_ADRESSE}}, agissant en qualité de {{MANDANT_QUALITE}}.
Le Mandant déclare avoir la qualité et les pouvoirs nécessaires pour vendre le bien désigné à l'article 2{{POUVOIR_PARTS}} et pour conclure le présent mandat.
Ci-après « le Mandant ».

IL A ÉTÉ CONVENU CE QUI SUIT

Article 2 – Le bien
2.1. Désignation : {{BIEN_TITRE}}, situé {{BIEN_ADRESSE}}. {{BIEN_COPROPRIETE}}
2.2. Bien vendu occupé : le bien est loué ({{BAIL_TYPE}}) moyennant un loyer mensuel de {{LOYER}} hors charges, en vertu d'un bail ayant pris effet le {{BAIL_DEBUT}} ; {{DEPOT}}. Le bail en cours se poursuit avec l'acquéreur.
2.3. Le Mandant déclare qu'aucun congé n'a été délivré ni reçu à ce jour, qu'il n'a connaissance d'aucun litige avec le locataire autre que ceux déclarés sur l'annonce, et que le locataire sera informé des visites, organisées par le Mandant avec l'accord du locataire.

Article 3 – Objet du mandat
Le Mandant confie au Mandataire, qui l'accepte, la mission de rechercher un acquéreur en vue de {{OBJET}}, au prix demandé de {{PRIX_DEMANDE}}, honoraires inclus, à la charge du Mandant. Le Mandant reste libre d'accepter ou de refuser toute offre, quel qu'en soit le montant.

Article 4 – Mandat simple, non exclusif
Le présent mandat est un mandat simple. Le Mandant conserve la faculté de vendre lui-même le bien ou de confier des mandats à d'autres intermédiaires. Aucune indemnité, pénalité ni rémunération n'est due au Mandataire si la vente est conclue avec un acquéreur qui ne lui a pas été présenté par le Mandataire.

Article 5 – Durée, prolongation, dénonciation
5.1. Le mandat est conclu pour une durée de {{DUREE_MOIS}} mois à compter de sa signature. Il n'est pas reconduit tacitement.
5.2. Il peut être prolongé par périodes de {{DUREE_MOIS}} mois par accord exprès du Mandant, donné dans son espace en ligne par une nouvelle signature par code à usage unique ; chaque prolongation est horodatée et jointe au dossier de preuve.
5.3. Chacune des parties peut dénoncer le mandat à tout moment, dans l'espace en ligne ou par courrier électronique adressé à l'autre partie, avec un préavis de {{PREAVIS_JOURS}} jours. L'horodatage de la plateforme fait foi entre les parties. À la date d'effet, l'annonce est retirée.
5.4. Le mandat prend fin de plein droit, sans préavis, si l'annonce est retirée par la modération de la plateforme ; le Mandant en est informé par courrier électronique avec le motif du retrait.

Article 6 – Droit de rétractation
6.1. Le présent mandat est conclu à distance, par voie électronique. Lorsque le Mandant agit en qualité de consommateur, il dispose d'un délai de {{RETRACTATION_JOURS}} jours à compter de la signature pour se rétracter, sans avoir à motiver sa décision (article L221-18 du code de la consommation). Le Mandataire accorde la même faculté, dans les mêmes conditions, au Mandant qui n'agit pas en qualité de consommateur.
6.2. Le Mandant exerce ce droit par le bouton « Résilier » de son espace en ligne, qui prend effet immédiatement pendant ce délai, ou par une déclaration dénuée d'ambiguïté adressée par courrier électronique à {{CONTACT_EMAIL}}, par exemple au moyen du formulaire type reproduit en annexe. Le délai expire {{FIN_RETRACTATION}}.
6.3. Le Mandant demande expressément que la diffusion de l'annonce commence dès la signature, avant la fin du délai de rétractation (article L221-25 du code de la consommation). En cas de rétractation, l'annonce est retirée immédiatement et aucune somme n'est due au Mandataire.

Article 7 – Mission du Mandataire
Le Mandataire s'engage à :
a) diffuser sur la plateforme {{MARQUE}} une annonce qui ne révèle ni l'adresse exacte du bien ni l'identité du Mandant ;
b) contrôler le justificatif de propriété déposé par le Mandant ;
c) qualifier les acquéreurs (profil de projet, adresse électronique confirmée, identité vérifiée, origine des fonds déclarée) avant toute révélation de l'adresse du bien et de l'identité du Mandant ;
d) faire signer à chaque acquéreur un engagement de confidentialité et de non-contournement avant toute révélation ;
e) mettre à la disposition du Mandant et des acquéreurs une messagerie, un dossier du bien sécurisé et des offres d'achat signées électroniquement ;
f) informer le Mandant de tout contact, de toute demande d'accès au dossier et de toute offre d'achat ;
g) tenir la liste nominative des acquéreurs présentés au Mandant, c'est-à-dire des acquéreurs ayant signé l'engagement de confidentialité relatif au bien ;
h) transmettre au notaire chargé de la vente les éléments utiles à l'établissement de l'avant-contrat et de l'acte.
Le Mandataire ne négocie pas, ne rédige ni l'avant-contrat ni l'acte de vente et ne donne aucun conseil juridique, fiscal ou financier ; il ne fait pas visiter le bien. Le Mandant et l'acquéreur conduisent la négociation et la rédaction des actes avec le notaire et leurs propres conseils.

Article 8 – Obligations du Mandant
Le Mandant s'engage à :
a) fournir des informations exactes sur le bien, le bail, les loyers, les charges, le diagnostic de performance énergétique, la copropriété et la situation du locataire, et à les tenir à jour pendant toute la durée du mandat ;
b) tenir à disposition un dossier de diagnostic technique à jour au plus tard à la signature de l'avant-contrat ;
c) informer le Mandataire, sans délai, de toute vente ou promesse de vente du bien, quel que soit l'acquéreur ;
d) informer le Mandataire de toute négociation directe avec un acquéreur présenté ;
e) organiser les visites avec l'accord du locataire et dans le respect de ses droits ;
f) ne communiquer aux acquéreurs aucune donnée personnelle du locataire qui ne soit pas nécessaire à l'étude de l'acquisition.

Article 9 – Rémunération du Mandataire
9.1. Barème : {{BAREME_COMMISSION}} {{ESTIMATION_COMMISSION}}
9.2. La rémunération est à la charge du Mandant. Elle est due uniquement si la vente du bien, ou la cession des parts de la société qui en est propriétaire, est conclue avec un acquéreur nommément présenté par le Mandataire, c'est-à-dire inscrit sur la liste visée à l'article 7 g), y compris lorsque l'acquisition est réalisée par une personne ou une société interposée.
9.3. Elle est exigible à la signature de l'acte authentique de vente. Aucune somme n'est versée au Mandataire avant cette signature (article 6 de la loi n° 70-9 du 2 janvier 1970).
9.4. Le Mandant donne ordre irrévocable au notaire chargé de la vente de prélever la rémunération du Mandataire sur le prix de vente et de la lui verser. Il s'engage à faire mentionner le Mandataire et le montant de sa rémunération dans l'avant-contrat et dans l'acte authentique, et à communiquer au Mandataire l'identité du notaire ainsi que la date de signature.

Article 10 – Clause de suite
La rémunération prévue à l'article 9 reste due si la vente est conclue, dans les {{SUITE_MOIS}} mois suivant la fin du mandat, quelle qu'en soit la cause, avec un acquéreur nommément présenté par le Mandataire. La liste nominative des acquéreurs présentés est communiquée au Mandant à la fin du mandat. La présente clause ne s'applique pas en cas de rétractation (article 6).

Article 11 – Registre, signature électronique, données personnelles, litiges
11.1. Registre : le présent mandat est inscrit par ordre chronologique au registre des mandats du Mandataire sous le numéro {{REGISTRE}}. Ce numéro est reporté sur l'exemplaire remis au Mandant.
11.2. Signature électronique : le mandat est signé par un code à usage unique envoyé à l'adresse électronique confirmée du Mandant. Le dossier de preuve (empreinte SHA-256 du document, horodatage, adresse IP, navigateur, identité vérifiée du signataire, référence du code) est conservé dix ans et annexé à l'exemplaire PDF. Les parties conviennent que ce procédé identifie le signataire et garantit l'intégrité de l'acte, conformément aux articles 1366 et 1367 du code civil. Le Mandataire contresigne le mandat par voie électronique dès la signature du Mandant.
11.3. Données personnelles : le Mandataire traite les données du Mandant pour l'exécution du mandat, la tenue du registre et le respect de ses obligations légales, notamment en matière de lutte contre le blanchiment des capitaux ; elles sont conservées dix ans pour le mandat et les preuves de signature. Le Mandant dispose des droits d'accès, de rectification, d'effacement et d'opposition, qu'il exerce à l'adresse {{CONTACT_EMAIL}}. Politique de confidentialité : {{URL_POLITIQUE_CONFIDENTIALITE}}.
11.4. Médiation : {{MEDIATEUR}}
11.5. Le présent mandat est soumis au droit français. Tout litige relatif à sa validité, son interprétation ou son exécution relève, à défaut d'accord amiable, des tribunaux de {{TRIBUNAL_COMPETENT}}, sous réserve des règles d'ordre public qui permettent au Mandant consommateur de saisir la juridiction du lieu où il demeurait au moment de la conclusion du mandat.

SIGNATURES
Fait par voie électronique, en un exemplaire conservé par le Mandataire et remis au Mandant au format PDF, {{DATE_SIGNATURE}}.
Référence : mandat n° {{MANDAT_NUMERO}} — registre n° {{REGISTRE}} — annonce {{ANNONCE_REF}}.

ANNEXE — Formulaire type de rétractation
À utiliser uniquement si le Mandant souhaite se rétracter par courrier électronique ; le bouton « Résilier » de l'espace en ligne produit le même effet pendant le délai de rétractation.
À l'attention de {{PLATEFORME_DENOMINATION}} SAS, {{PLATEFORME_ADRESSE_COMPLETE}}, {{CONTACT_EMAIL}} :
« Je vous notifie par la présente ma rétractation du mandat de vente simple n° {{MANDAT_NUMERO}}, conclu à la date de sa signature électronique indiquée ci-dessus. »
Nom du Mandant : {{MANDANT_PRENOM}} {{MANDANT_NOM}}.
Adresse du Mandant : {{MANDANT_ADRESSE}}.
Date et signature : celles de l'envoi du courrier électronique depuis l'adresse confirmée du Mandant."""

# Engagement de confidentialité et de non-contournement (v1) : signé par l'acquéreur (identité vérifiée) avec AlterEgo
# pour le compte du vendeur, désigné par le titre de l'annonce jusqu'à la révélation (Annexe A, jointe après signature).
DEFAULT_NDA_TEMPLATE = """ENGAGEMENT DE CONFIDENTIALITÉ ET DE NON-CONTOURNEMENT

Engagement n° {{NDA_NUMERO}} — Annonce {{ANNONCE_REF}} — Conditions du {{VERSION_CONDITIONS}}

ENTRE LES SOUSSIGNÉS

1. L'Opérateur
{{PLATEFORME_DENOMINATION}} SAS, {{PLATEFORME_FORME_JURIDIQUE}} au capital de {{PLATEFORME_CAPITAL}}, RCS {{PLATEFORME_RCS_VILLE}} {{PLATEFORME_SIREN}}, siège {{PLATEFORME_ADRESSE_COMPLETE}}, exploitant la plateforme {{MARQUE}}, titulaire de la carte professionnelle n° {{CARTE_T}} (Transactions sur immeubles et fonds de commerce) délivrée par la {{CARTE_T_CCI}}, agissant pour le compte du vendeur du bien présenté sous l'annonce {{ANNONCE_REF}}, en vertu du mandat de vente qui lui a été confié.
Ci-après « l'Opérateur ».

2. L'Acquéreur
{{ACQUEREUR_IDENTITE}}
Ci-après « l'Acquéreur ».

3. Le Vendeur bénéficiaire
Le vendeur est désigné par la référence de l'annonce {{ANNONCE_REF}} jusqu'à la signature du présent engagement. Son identité et l'adresse du bien sont communiquées à l'Acquéreur immédiatement après la signature, en Annexe A, qui fait partie intégrante de l'engagement. L'Opérateur stipule le présent engagement au bénéfice du vendeur, qui peut s'en prévaloir directement.

IL A ÉTÉ CONVENU CE QUI SUIT

Article 1 – Objet
Le présent engagement encadre la communication à l'Acquéreur d'informations confidentielles relatives au bien présenté sous l'annonce {{ANNONCE_REF}} ({{BIEN_TITRE}}, prix demandé : {{PRIX_DEMANDE}}), dans le seul but d'étudier son acquisition.

Article 2 – Informations couvertes
Sont confidentielles toutes les informations communiquées à l'Acquéreur, par quelque moyen que ce soit, par l'Opérateur ou par le vendeur, et notamment : l'adresse exacte du bien ; l'identité du vendeur et, le cas échéant, de la société propriétaire ; les documents du dossier du bien (bail, quittances, diagnostics, documents de copropriété, titre de propriété) ; les données relatives au locataire ; l'existence même des discussions.
Ne sont pas confidentielles les informations dont l'Acquéreur démontre qu'elles sont publiques sans faute de sa part, qu'il les détenait avant leur communication ou qu'il les a reçues licitement d'un tiers non tenu au secret.

Article 3 – Engagements de confidentialité
Pendant {{NDA_DUREE_MOIS}} mois à compter de la signature, l'Acquéreur s'engage à :
a) garder strictement confidentielles les informations couvertes et ne les communiquer qu'à ses conseils (notaire, avocat, expert-comptable, banque, courtier) tenus à une obligation de confidentialité équivalente, pour les seuls besoins de l'étude ;
b) n'utiliser les informations couvertes que pour étudier l'acquisition du bien, à l'exclusion de toute autre finalité ;
c) ne pas contacter le locataire, le syndic de copropriété ou l'exploitant de la résidence, et ne pas se rendre dans le bien, sans l'accord préalable du vendeur ; les visites sont organisées par le vendeur avec l'accord du locataire ;
d) restituer ou détruire, à première demande ou à la fin des discussions, les documents reçus et leurs copies, sous réserve des obligations légales de conservation de ses conseils.

Article 4 – Non-contournement
Pendant la même durée, l'Acquéreur s'engage à ne pas acquérir le bien, ni les parts de la société qui en est propriétaire, directement ou par une personne ou une société interposée, en dehors de la plateforme {{MARQUE}} sans en informer préalablement le vendeur et l'Opérateur. La présentation de l'Acquéreur au vendeur est faite par l'Opérateur en exécution du mandat du vendeur et inscrite sur la liste des acquéreurs présentés. Le présent article ne prévoit aucune pénalité forfaitaire : tout manquement engage la responsabilité de l'Acquéreur dans les conditions du droit commun.

Article 5 – Données personnelles du locataire
Les données personnelles du locataire éventuellement contenues dans les documents du dossier ne sont traitées par l'Acquéreur que pour l'étude de l'acquisition. Il s'interdit de les utiliser à d'autres fins et les supprime s'il ne donne pas suite à l'acquisition.

Article 6 – Accès au dossier du bien
L'accès aux documents du dossier est ouvert après la signature du présent engagement et la déclaration par l'Acquéreur de l'origine des fonds envisagés pour l'acquisition (apport, emprunt, investisseurs), demandée dans son espace au titre des obligations de lutte contre le blanchiment des capitaux. Les documents consultés portent un filigrane nominatif ; l'Opérateur tient un journal horodaté des consultations, qui fait foi entre les parties.

Article 7 – Absence d'engagement de conclure
Le présent engagement ne constitue ni promesse de vente ni promesse d'achat. Chaque partie reste libre de mettre fin aux discussions à tout moment. Aucune somme n'est due par l'Acquéreur à l'Opérateur : la rémunération de l'Opérateur est à la charge du vendeur.

Article 8 – Responsabilité
Tout manquement de l'Acquéreur ou de ses conseils engage sa responsabilité envers le vendeur et l'Opérateur, qui pourront demander réparation du préjudice subi devant la juridiction compétente. L'Acquéreur informe immédiatement l'Opérateur de toute divulgation imposée par la loi ou une autorité et la limite au strict nécessaire.

Article 9 – Signature électronique et preuve
L'engagement est signé par un code à usage unique envoyé à l'adresse électronique confirmée de l'Acquéreur, dont l'identité a été vérifiée. Le dossier de preuve (empreinte SHA-256 du document, horodatage, adresse IP, navigateur, identité vérifiée, référence du code) est conservé dix ans et annexé à l'exemplaire PDF remis aux deux parties. Les parties conviennent que ce procédé identifie le signataire et garantit l'intégrité de l'acte (articles 1366 et 1367 du code civil).

Article 10 – Données personnelles de l'Acquéreur
L'Opérateur traite les données d'identité et de contact de l'Acquéreur pour l'exécution du présent engagement, la sécurité du dossier du bien et le respect de ses obligations légales (lutte contre le blanchiment des capitaux). Les images des pièces d'identité ne sont jamais conservées. Droits d'accès, de rectification, d'effacement et d'opposition : {{CONTACT_EMAIL}}. Politique de confidentialité : {{URL_POLITIQUE_CONFIDENTIALITE}}.

Article 11 – Droit applicable
Le présent engagement est soumis au droit français. Tout litige relève, à défaut d'accord amiable, des tribunaux de {{TRIBUNAL_COMPETENT}}, sous réserve des règles d'ordre public protectrices du consommateur.

SIGNATURE
Fait par voie électronique, {{DATE_SIGNATURE}}.
Référence : engagement n° {{NDA_NUMERO}} — annonce {{ANNONCE_REF}}.

ANNEXE A — Le bien et le vendeur (communiqués après signature)
Adresse du bien : {{BIEN_ADRESSE}}.
Vendeur : {{VENDEUR_IDENTITE}}.
L'Acquéreur reconnaît que ces informations constituent des informations couvertes au sens de l'article 2."""

# Offre d'achat (remplace l'offre indicative de l'ancienne plateforme) : signée par l'acquéreur, contresignée par le vendeur à l'acceptation ;
# même acceptée, elle n'emporte pas vente (avant-contrat et acte chez le notaire)
DEFAULT_OFFER_TEMPLATE = """OFFRE D'ACHAT

Offre n° {{OFFRE_NUMERO}} — Annonce {{ANNONCE_REF}} — Conditions du {{VERSION_CONDITIONS}}

1. L'Acquéreur
{{ACQUEREUR_IDENTITE}}

2. Le Vendeur
{{VENDEUR_IDENTITE}}.

3. Le bien
{{BIEN_TITRE}}, situé {{BIEN_ADRESSE}}, vendu occupé ({{BAIL_TYPE}}, loyer mensuel de {{LOYER}} hors charges).

4. La plateforme
L'offre est transmise par {{PLATEFORME_DENOMINATION}} SAS, exploitant la plateforme {{MARQUE}}, carte professionnelle n° {{CARTE_T}} délivrée par la {{CARTE_T_CCI}}, en exécution du mandat de vente simple confié par le Vendeur. {{PLATEFORME_DENOMINATION}} SAS ne négocie pas, ne rédige ni l'avant-contrat ni l'acte de vente et ne fournit aucun conseil juridique, fiscal ou financier.

Article 1 – Objet
L'Acquéreur propose au Vendeur d'acquérir {{OBJET}}.

Article 2 – Prix proposé et financement
Prix proposé : {{MONTANT}}, honoraires de négociation compris, à la charge du Vendeur.
Financement envisagé : apport personnel {{FIN_APPORT}} ; emprunt {{FIN_EMPRUNT}}.
{{CONDITION_PRET}}

Article 3 – Autres conditions
{{CONDITIONS}}

Article 4 – Calendrier et validité
Date souhaitée pour la signature de l'avant-contrat (promesse ou compromis de vente) : {{DATE_CIBLE}}.
Validité de l'offre : {{VALIDITE_JOURS}} jours à compter de sa signature, soit jusqu'au {{DATE_EXPIRATION}}. Passé ce délai sans acceptation, l'offre est caduque.

Article 5 – Message de l'Acquéreur
{{MESSAGE}}

Article 6 – Portée de l'offre
La présente offre, même acceptée, n'emporte pas vente : elle engage les parties à négocier de bonne foi un avant-contrat (promesse unilatérale ou compromis de vente) chez le notaire, qui en fixera toutes les conditions (prix, conditions suspensives, date de l'acte authentique, transfert du dépôt de garantie, prorata des loyers, des charges et de la taxe foncière). {{RETRACTATION_ACQUEREUR}} Aucune somme n'est versée à {{PLATEFORME_DENOMINATION}} SAS ni au Vendeur à ce stade. Restent applicables l'engagement de confidentialité et de non-contournement signé par l'Acquéreur et le mandat de vente simple du Vendeur : la rémunération de {{PLATEFORME_DENOMINATION}} SAS est à la charge du Vendeur, due uniquement à la signature de l'acte authentique ; rien n'est dû par l'Acquéreur.

Article 7 – Signature électronique et preuve
L'offre est signée par l'Acquéreur, puis acceptée et contresignée par le Vendeur, par un code à usage unique envoyé à l'adresse électronique confirmée de chaque signataire. Le dossier de preuve de chaque signature (empreinte SHA-256, horodatage, adresse IP, navigateur, identité vérifiée, référence du code) est conservé dix ans et annexé à l'exemplaire PDF remis aux deux parties (articles 1366 et 1367 du code civil). Une contre-proposition du Vendeur est horodatée depuis son espace et prend effet à son acceptation par l'Acquéreur, signée par code.

SIGNATURE DE L'ACQUÉREUR
Fait par voie électronique, {{DATE_SIGNATURE}}.
Référence : offre n° {{OFFRE_NUMERO}} — annonce {{ANNONCE_REF}}."""
# Default Platform Settings
# Entité exploitante (AlterEgo). Surchargeable par variables d'environnement LEGAL_*.
def _legal_env(name: str, default: str = "") -> str:
    """Variable LEGAL_* : une valeur vide (ligne `LEGAL_X=` du .env, ou `${LEGAL_X:-}` du compose) garde la valeur par
    défaut au lieu d'effacer une mention obligatoire (capital, représentant, siège…)"""
    return (os.environ.get(name) or "").strip() or default

def _legal_vat_number(siren: str) -> str:
    """N° de TVA intracommunautaire : LEGAL_TVA, sinon calculé depuis le SIREN (FR + clé + SIREN), comme les factures"""
    env = _legal_env("LEGAL_TVA")
    if env:
        return env
    digits = re.sub(r"\D", "", siren or "")
    if len(digits) != 9:
        return ""
    return f"FR{(12 + 3 * (int(digits) % 97)) % 97:02d}{digits}"

LEGAL_ENTITY = {
    "denomination": _legal_env("LEGAL_DENOMINATION", "AlterEgo"),
    "forme_juridique": _legal_env("LEGAL_FORME_JURIDIQUE", "Société par actions simplifiée"),
    "capital": _legal_env("LEGAL_CAPITAL", "2000"),
    "adresse": _legal_env("LEGAL_ADRESSE", "43 rue Massenet, 78500 Sartrouville"),
    "rcs_ville": _legal_env("LEGAL_RCS_VILLE", "Versailles"),
    "siren": _legal_env("LEGAL_SIREN", "952180230"),
    # Carte professionnelle (loi Hoguet)
    "carte_t": _legal_env("LEGAL_CARTE_T", "CPI 7801 2025 000 000 049"),
    "carte_t_valid_until": _legal_env("LEGAL_CARTE_T_VALIDITE", "28/07/2028"),
    "carte_t_issuer": _legal_env("LEGAL_CARTE_T_CCI", "CCI Paris Île-de-France"),
    # Activités portées par la carte (séparées par « ; ») : n'ajouter « Gestion immobilière » que si la carte la mentionne
    "carte_t_activities": [a.strip() for a in _legal_env("LEGAL_CARTE_T_ACTIVITES", "Transactions sur immeubles et fonds de commerce").split(";")
                           if a.strip()],
    "representant": _legal_env("LEGAL_REPRESENTANT", "Romane DA SILVA RIBEIRO"),
    # Adresse de contact des contrats (exercice des droits RGPD) et des mentions : par défaut, celle du site et des e-mails
    "email": _legal_env("LEGAL_EMAIL") or sender_email(),
    # Téléphone (facultatif, affiché dans les mentions légales s'il est renseigné) et n° de TVA intracommunautaire
    "telephone": _legal_env("LEGAL_PHONE"),
    "tva": _legal_vat_number(_legal_env("LEGAL_SIREN", "952180230")),
    "hebergeur": _legal_env("LEGAL_HEBERGEUR"),
    # RC professionnelle (assureur + n° de police ; vide = « souscrite conformément à la loi Hoguet ») et médiateur
    "rc_pro": _legal_env("LEGAL_RC_PRO"),
    "mediateur": _legal_env("LEGAL_MEDIATEUR"),
    "fonds_mention": "AlterEgo SAS déclare ne recevoir ni détenir d'autres fonds, effets ou valeurs que ceux représentatifs de sa rémunération",
    "marque": site_name(),
}

DEFAULT_PLATFORM_SETTINGS = {
    "PLATEFORME_DENOMINATION": LEGAL_ENTITY["denomination"],
    "PLATEFORME_FORME_JURIDIQUE": LEGAL_ENTITY["forme_juridique"],
    "PLATEFORME_CAPITAL": LEGAL_ENTITY["capital"],
    "PLATEFORME_ADRESSE_COMPLETE": LEGAL_ENTITY["adresse"],
    "PLATEFORME_RCS_VILLE": LEGAL_ENTITY["rcs_ville"],
    "PLATEFORME_SIREN": LEGAL_ENTITY["siren"],
    "PLATEFORME_REPR_PRENOM": "",
    "PLATEFORME_REPR_NOM": LEGAL_ENTITY["representant"],
    "PLATEFORME_REPR_FONCTION": "Présidente",
    "CONTACT_EMAIL": LEGAL_ENTITY["email"],
    "URL_POLITIQUE_CONFIDENTIALITE": site_url("/confidentialite"),
    "TRIBUNAL_COMPETENT": "Versailles",
    "VERSION_CONDITIONS": CONTRACT_TERMS_DATE,
    # Mandat simple (SPEC §7.2) et engagement de confidentialité (SPEC §7.3)
    "DUREE_MOIS": str(MANDATE_DURATION_MONTHS),
    "PREAVIS_JOURS": str(MANDATE_NOTICE_DAYS),
    "SUITE_MOIS": str(MANDATE_TAIL_MONTHS),
    "RETRACTATION_JOURS": str(MANDATE_WITHDRAWAL_DAYS),
    "VERSION_MANDAT": MANDATE_TERMS_VERSION,
    "NDA_DUREE_MOIS": str(NDA_DURATION_MONTHS),
}

# ============ MANDAT DE VENTE SIMPLE v1 (SPEC §7.2, API.md §6) ============
MANDATE_REQUIRED_FIELDS = {
    "mandant_address": "adresse postale du mandant", "mandant_capacity": "qualité du signataire",
    "sale_object": "objet de la vente (bien ou parts)", "property_type": "type de bien", "address": "adresse du bien",
    "postal_code": "code postal du bien", "city": "ville du bien", "lease_type": "type de bail", "rent_monthly": "loyer mensuel",
    "lease_start": "date de prise d'effet du bail", "asking_price": "prix de vente",
    "company_name": "dénomination de la société propriétaire", "siret": "SIRET de la société propriétaire",
}

def mandate_missing_fields(property: dict) -> list:
    """Champs à compléter avant de générer le mandat (texte sans blanc) ; la société n'est exigée que pour une SCI ou
    une société, une cession de parts ou un signataire gérant"""
    company_needed = (property.get("owner_type") in COMPANY_OWNER_TYPES or property.get("sale_object") == "parts"
                      or property.get("mandant_capacity") == "gerant")
    missing = []
    for field in MANDATE_REQUIRED_FIELDS:
        if field in ("company_name", "siret") and not company_needed:
            continue
        value = property.get(field)
        if field == "mandant_address":
            value = fmt_address(value) if value else ""
        if value in (None, "", 0) or (field in ("rent_monthly", "asking_price") and not (value or 0) > 0):
            missing.append(field)
    return missing

def mandate_pdf_path(contract_id: str) -> str:
    return f"/api/seller/mandat/{contract_id}/pdf"

def mandate_pdf_link(contract: dict) -> str:
    """Lien de téléchargement authentifié par jeton (e-mail envoyé au mandant à la signature)"""
    return site_url(f"{mandate_pdf_path(contract['id'])}?token={contract.get('pdf_token', '')}")

def mandate_object_text(property: dict) -> str:
    company = (property.get("company_name") or "").strip()
    return SALE_OBJECT_MANDATE.get(property.get("sale_object") or "bien", SALE_OBJECT_MANDATE["bien"]).format(
        company=f" ({company})" if company else "")

def mandate_summary(property: dict) -> list:
    """Résumé en 5 lignes affiché avant le texte dépliable (SPEC §5.2.4)"""
    prix = fmt_eur_fr(property["asking_price"]) if property.get("asking_price") else "à fixer sur l'annonce"
    return [
        "Mandat simple, sans exclusivité : vous restez libre de vendre vous-même ou par un autre intermédiaire, sans indemnité ni pénalité.",
        f"Objet : {mandate_object_text(property)} ; prix demandé {prix}, honoraires inclus : vous restez libre d'accepter ou de refuser toute offre.",
        f"Durée {MANDATE_DURATION_MONTHS} mois, prolongeable, résiliable à tout moment avec un préavis de {MANDATE_NOTICE_DAYS} jours ; "
        f"rétractation possible pendant {MANDATE_WITHDRAWAL_DAYS} jours, avec effet immédiat.",
        f"Honoraires à votre charge, dus uniquement si la vente se fait avec un acquéreur que nous vous avons nommément présenté : "
        f"{commission_scale_text()}",
        f"Clause de suite de {MANDATE_TAIL_MONTHS} mois sur les acquéreurs présentés ; signature par code reçu par e-mail, contresignée par "
        f"{LEGAL_ENTITY['denomination']} SAS, dossier de preuve conservé dix ans, numéro de registre attribué à la signature.",
    ]

async def mandate_variables(property: dict, user: dict, contract_number: str) -> dict:
    settings_doc = await db.platform_settings.find_one({"type": "contracts"}, {"_id": 0})
    settings = {**DEFAULT_PLATFORM_SETTINGS, **(settings_doc["settings"] if settings_doc else {})}
    if property.get("asking_price"):
        c = calculate_commission(float(property["asking_price"]))
        estimation = (f"À titre indicatif, sur la base du prix demandé, la rémunération s'élèverait à {fmt_eur_fr(c['final_commission_ttc'])} TTC "
                      f"({fmt_eur_fr(c['final_commission_ht'])} HT) ; son montant définitif est calculé sur le prix de vente figurant dans l'acte authentique.")
    else:
        estimation = "Son montant définitif est calculé sur le prix de vente figurant dans l'acte authentique."
    mediateur = LEGAL_ENTITY.get("mediateur")
    return {
        **settings,
        "MANDANT_PRENOM": user.get("verified_first_name") or user.get("first_name") or "",
        "MANDANT_NOM": user.get("verified_last_name") or user.get("last_name") or "",
        "MANDANT_EMAIL": user.get("email", ""),
        "MANDANT_ADRESSE": fmt_address(property.get("mandant_address")),
        "MANDANT_QUALITE": mandant_capacity(property, user),
        **property_contract_variables(property),
        "OBJET": mandate_object_text(property),
        "POUVOIR_PARTS": (" ou pour céder les parts de la société qui en est propriétaire"
                          if property.get("sale_object") in ("parts", "indifferent") and property.get("owner_type") in COMPANY_OWNER_TYPES else ""),
        "ESTIMATION_COMMISSION": estimation,
        "MEDIATEUR": (f"le Mandant consommateur peut recourir gratuitement au médiateur de la consommation {mediateur} en cas de litige "
                      "non résolu à l'amiable." if mediateur else
                      "en cas de difficulté, les parties recherchent d'abord une solution amiable par échange dans l'espace en ligne ou "
                      "par courrier électronique ; le Mandant consommateur peut en outre recourir gratuitement à un médiateur de la "
                      "consommation, dont les coordonnées lui sont communiquées sur simple demande."),
        "MANDAT_NUMERO": contract_number,
        "REGISTRE": MANDATE_REGISTRY_PENDING,
        "FIN_RETRACTATION": WITHDRAWAL_END_PENDING,
        "DATE_SIGNATURE": SIGNATURE_DATE_PENDING,
    }

async def latest_mandate(property_id: str, seller_id: Optional[str] = None) -> Optional[dict]:
    query = {"property_id": property_id, "type": "mandat"}
    if seller_id:
        query["seller_id"] = seller_id
    return await db.generated_contracts.find_one(query, {"_id": 0}, sort=[("created_at", -1)])

@api_router.post("/seller/mandat/generate")
async def generate_seller_mandat(property_id: str, current_user: dict = Depends(get_current_user)):
    """Vendeur : génère le mandat de vente simple à signer. Exige l'e-mail confirmé (403 `email_not_verified`), l'identité
    vérifiée (403 `identity_required`) et les champs du mandat sur l'annonce (400 `validation`, `missing`)."""
    if current_user.get("role") != "seller":
        raise api_error(403, "not_allowed", "Réservé aux vendeurs")
    property = await db.properties.find_one({"id": property_id, "seller_id": current_user["id"]}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    if not is_email_verified(current_user):
        raise api_error(403, "email_not_verified", EMAIL_NOT_VERIFIED_DETAIL)
    if not is_user_verified(current_user):
        raise api_error(403, "identity_required", "Vérifiez votre identité avant de signer le mandat")

    existing = await latest_mandate(property_id, current_user["id"])
    if existing and existing.get("status") == "signed":
        return {"already_signed": True, "contract": {k: v for k, v in existing.items() if k != "pdf_token"},
                "summary": mandate_summary(property), "pdf_url": mandate_pdf_path(existing["id"])}

    missing = mandate_missing_fields(property)
    if missing:
        labels = ", ".join(MANDATE_REQUIRED_FIELDS[f] for f in missing)
        raise api_error(400, "validation", f"Complétez votre annonce avant de générer le mandat : {labels}", missing=missing)

    template_doc = await db.contract_templates.find_one({"type": "mandat"}, {"_id": 0})
    template = template_doc["content"] if template_doc else DEFAULT_MANDAT_TEMPLATE
    now = datetime.now(timezone.utc)
    pending = existing if existing and existing.get("status") == "pending_signature" else None
    contract_number = pending["contract_number"] if pending else f"MANDAT-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    content = render_template(template, await mandate_variables(property, current_user, contract_number))
    unresolved = missing_template_variables(content)
    if unresolved:
        raise api_error(400, "validation", "Le texte du mandat ne peut pas être complété", missing=unresolved)
    # Mandat de test : mention en tête, numéro pris dans le registre de test à la signature (jamais dans le registre réel)
    mandate_test = is_test_context(current_user, property, pending)
    content = with_test_banner(content, mandate_test)
    summary = mandate_summary(property)
    if pending:
        # Projet non signé régénéré avec les données à jour de l'annonce (adresse, objet, prix)
        regenerated = {
            "content": content, "updated_at": now.isoformat(), "terms_version": MANDATE_TERMS_VERSION, "terms_date": CONTRACT_TERMS_DATE,
            "mandant_address": fmt_address(property.get("mandant_address")), "sale_object": property.get("sale_object"), "signers_pending": [current_user["id"]]}
        if mandate_test:
            regenerated["is_test"] = True
        await db.generated_contracts.update_one({"id": pending["id"]}, {"$set": regenerated})
        return {"already_signed": False, "contract_id": pending["id"], "contract_number": contract_number, "content": content,
                "summary": summary, "terms_version": MANDATE_TERMS_VERSION, "terms_date": CONTRACT_TERMS_DATE, "type": "mandat"}
    contract_doc = {
        "id": str(uuid.uuid4()), "contract_number": contract_number, "type": "mandat", "property_id": property_id,
        "seller_id": current_user["id"], "content": content, "status": "pending_signature", "signers_pending": [current_user["id"]],
        "terms_version": MANDATE_TERMS_VERSION, "terms_date": CONTRACT_TERMS_DATE, "mandant_address": fmt_address(property.get("mandant_address")),
        "sale_object": property.get("sale_object"), "created_at": now.isoformat(), "auto_generated": True, "renewals": [],
    }
    if mandate_test:
        contract_doc["is_test"] = True
    await db.generated_contracts.insert_one(contract_doc)
    return {"already_signed": False, "contract_id": contract_doc["id"], "contract_number": contract_number, "content": content,
            "summary": summary, "terms_version": MANDATE_TERMS_VERSION, "terms_date": CONTRACT_TERMS_DATE, "type": "mandat"}

COMMISSION_PAYER_TEXT = {"vendeur": "le Mandant (vendeur)"}

class MandatSignature(BaseModel):
    otp_code: Optional[str] = None  # le débiteur des honoraires n'est pas un choix : toujours le vendeur

MANDATE_REGISTRY_TEST_COUNTER = "mandate_registry_test"

def mandate_test_number(sequence: int) -> str:
    """Numéro affiché d'un mandat de test : TEST-0001, TEST-0002…"""
    return f"TEST-{int(sequence):04d}"

async def next_sequence(name: str) -> int:
    """Compteur atomique sans trou (registre des mandats, numérotation des factures)"""
    doc = await db.counters.find_one_and_update(
        {"_id": name}, {"$inc": {"value": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return int(doc["value"])

def mandate_view(contract: Optional[dict]) -> Optional[dict]:
    if not contract:
        return None
    view = {k: v for k, v in contract.items() if k not in ("_id", "pdf_token")}
    view["pdf_url"] = mandate_pdf_path(contract["id"])
    view.setdefault("ends_at", None)
    view.setdefault("tail_ends_at", None)
    view.setdefault("withdrawal_ends_at", None)
    view.setdefault("effective_at", None)
    view.setdefault("registry_number", None)
    view.setdefault("terms_version", contract.get("commission_terms_version"))
    return view

async def _mandate_for_owner(contract_id: str, user: dict, allow_admin: bool = True) -> dict:
    contract = await db.generated_contracts.find_one({"id": contract_id, "type": "mandat"}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Mandat non trouvé")
    if contract.get("seller_id") != user["id"] and not (allow_admin and user.get("role") == "admin"):
        raise HTTPException(status_code=403, detail="Non autorisé")
    return contract

@api_router.post("/seller/mandat/{contract_id}/sign")
async def sign_seller_mandat(contract_id: str, signature: MandatSignature, request: Request,
                             current_user: dict = Depends(get_current_user)):
    """Vendeur : signe le mandat par code. Numéro de registre, dates (12 mois, clause de suite 12 mois, rétractation 14 jours),
    contre-signature automatique d'AlterEgo SAS, dossier de preuve chaîné, e-mail avec lien PDF. Requis avant publication."""
    contract = await db.generated_contracts.find_one({"id": contract_id, "type": "mandat"}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Mandat non trouvé")
    if contract.get("seller_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Non autorisé")
    if contract.get("status") == "signed":
        raise HTTPException(status_code=409, detail="Mandat déjà signé")
    if contract.get("status") != "pending_signature":
        raise api_error(400, "validation", "Ce mandat n'est plus signable : générez un nouveau mandat")
    require_verified_email(current_user)
    if not is_user_verified(current_user):
        raise api_error(403, "identity_required", "Vérifiez votre identité avant de signer le mandat")
    property = await db.properties.find_one({"id": contract.get("property_id")}, {"_id": 0})
    evidence = await verify_signature_code(current_user, contract, signature.otp_code, request)

    now = datetime.now(timezone.utc)
    payer = COMMISSION_PAYER  # toujours le vendeur
    content = contract.get("content") or ""
    withdrawal_ends_at = now + timedelta(days=MANDATE_WITHDRAWAL_DAYS)
    mandate_test = is_test_context(contract, property, current_user)
    if mandate_test:
        # Registre de test séparé (compteur `mandate_registry_test`, numéro TEST-0001) : le registre réel n'avance jamais
        registry_number = mandate_test_number(await next_sequence(MANDATE_REGISTRY_TEST_COUNTER))
        content = with_test_banner(content, True)
    else:
        registry_number = await next_sequence("mandate_registry")
    signer_name = f"{current_user.get('verified_first_name') or current_user.get('first_name') or ''} {current_user.get('verified_last_name') or current_user.get('last_name') or ''}".strip()
    # Le gabarit porte déjà « numéro » / « n° » devant {{REGISTRE}} : seul le nombre est inséré (jamais « n° n° 12 »)
    content = (content.replace(MANDATE_REGISTRY_PENDING, str(registry_number)).replace(SIGNATURE_DATE_PENDING, f"le {fmt_datetime_paris(now)}")
               .replace(WITHDRAWAL_END_PENDING, f"le {fmt_datetime_paris(withdrawal_ends_at)}"))
    content += (f"\n\nSigné électroniquement par le Mandant, {signer_name}, le {fmt_datetime_paris(now)}, par code à usage unique envoyé à "
                f"{mask_email(current_user.get('email', ''))}.\nSigné électroniquement par {LEGAL_ENTITY['denomination']} SAS, le {fmt_datetime_paris(now)} "
                "(contre-signature automatique, dossier de preuve commun).")
    # La preuve porte sur le texte définitivement signé
    document_sha256 = hashlib.sha256(content.encode()).hexdigest()
    record = await record_signature(contract, current_user, evidence, "mandat", "seller", now, document_sha256, extra={"registry_number": registry_number})
    signature_hash = record["signature_hash"]
    counter_evidence = {"method": "automatic", "document_sha256": document_sha256, "signed_at": now.isoformat(), "signed_at_paris": fmt_datetime_paris(now),
                        "previous_evidence_sha256": record["evidence_sha256"], "ip": None, "user_agent": None,
                        "identity": {"legal_entity": f"{LEGAL_ENTITY['denomination']} SAS", "siren": LEGAL_ENTITY["siren"], "carte_t": LEGAL_ENTITY["carte_t"]}}
    countersignature = {"by": f"{LEGAL_ENTITY['denomination']} SAS", "at": now.isoformat(), "method": "automatic", "evidence": counter_evidence,
                        "evidence_sha256": evidence_sha256(counter_evidence),
                        "signature_hash": hashlib.sha256(f"{contract_id}alterego{now.isoformat()}{document_sha256}".encode()).hexdigest()}
    ends_at = add_months(now, MANDATE_DURATION_MONTHS)
    tail_ends_at = add_months(ends_at, MANDATE_TAIL_MONTHS)
    pdf_token = secrets.token_urlsafe(24)

    # Signature conditionnelle au statut : impossible de signer deux fois (même en concurrence)
    result = await db.generated_contracts.update_one(
        {"id": contract_id, "status": "pending_signature"},
        {"$set": {
            "status": "signed", "signed_at": now.isoformat(), "ends_at": ends_at.isoformat(), "tail_ends_at": tail_ends_at.isoformat(),
            "withdrawal_ends_at": withdrawal_ends_at.isoformat(),
            "terms_version": MANDATE_TERMS_VERSION, "terms_date": contract.get("terms_date") or CONTRACT_TERMS_DATE,
            "seller_signature_hash": signature_hash, "commission_payer": payer, "commission_terms_version": COMMISSION_TERMS_VERSION,
            "registry_number": registry_number, "content": content, "signature_evidence": record["evidence"], "signature_record_id": record["id"],
            "countersignature": countersignature, "mandant_address": fmt_address((property or {}).get("mandant_address")) or contract.get("mandant_address"),
            "sale_object": (property or {}).get("sale_object") or contract.get("sale_object"), "renewals": contract.get("renewals") or [],
            "signers_pending": [current_user["id"]],  # une prolongation reste possible tant que le mandat est en cours
            "pdf_token": pdf_token, **({"is_test": True} if mandate_test else {}),
        }}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Mandat déjà signé")
    listing_update = {"mandat_signed": True, "mandat_signed_at": now.isoformat(), "mandate_id": contract_id, "commission_payer": payer,
                      "commission_terms_version": COMMISSION_TERMS_VERSION, "mandate_ends_at": ends_at.isoformat(),
                      "mandate_tail_ends_at": tail_ends_at.isoformat()}
    # Mandat de test sur une annonce réelle (créée hors essai, vendeur réel) : l'annonce n'est jamais repassée en donnée de
    # test (la purge l'effacerait avec son mandat réel du registre) ; elle porte `mandate_is_test` et reste masquée au
    # public hors mode test tant qu'un vrai mandat n'est pas signé
    listing_update["mandate_is_test"] = mandate_test
    if mandate_test and is_test_related(property, current_user):
        listing_update["is_test"] = True  # annonce de test publiée sous un mandat de test (supprimée par la purge)
    await db.properties.update_one({"id": contract.get("property_id")}, {"$set": listing_update})
    await create_audit_log(action="MANDAT_SIGNED", property_id=contract.get("property_id"), actor_id=current_user["id"],
                           actor_email=current_user["email"], details={"contract_id": contract_id, "contract_number": contract.get("contract_number"),
                                                                       "registry_number": registry_number})
    # Mandat précédent dénoncé et encore en préavis : remplacé par le nouveau mandat, la date d'effet de la dénonciation
    # ne dépublie plus l'annonce (tâche `mandate_denounce_effective`)
    await db.generated_contracts.update_many(
        {"type": "mandat", "property_id": contract.get("property_id"), "id": {"$ne": contract_id}, "status": "denounced",
         "effective_applied": {"$ne": True}},
        {"$set": {"effective_applied": True, "superseded_by": contract_id, "superseded_at": now.isoformat()}})
    # L'annonce en attente de mandat, ou retirée à la fin du mandat précédent, poursuit son circuit (publication automatique)
    property = await db.properties.find_one({"id": contract.get("property_id")}, {"_id": 0})
    listing_status = property.get("status") if property else None
    if property and (property.get("status") == "mandat_en_attente" or (property.get("status") == "draft" and listing_complete(property))
                    or (property.get("status") == "withdrawn" and property.get("withdrawn_reason") == "mandate_ended")):
        listing_status = (await submit_listing(property, current_user)).get("status")
    signed = await db.generated_contracts.find_one({"id": contract_id}, {"_id": 0})
    await email_user(current_user["id"], "mandate_signed_pdf", registry_number=registry_number, contract_number=contract.get("contract_number", ""),
                     ends_at=fmt_date_fr(ends_at), pdf_link=mandate_pdf_link(signed), bareme=commission_scale_text())
    return {
        "status": "signed", "message": "Mandat signé avec succès", "contract_number": contract.get("contract_number"),
        "registry_number": registry_number, "signed_at": now.isoformat(), "ends_at": ends_at.isoformat(), "tail_ends_at": tail_ends_at.isoformat(),
        "withdrawal_ends_at": withdrawal_ends_at.isoformat(), "terms_version": MANDATE_TERMS_VERSION, "commission_payer": payer, "signature_hash": signature_hash,
        "listing_status": listing_status, "pdf_url": mandate_pdf_path(contract_id),
    }

class MandateDenounce(BaseModel):
    reason: Optional[str] = Field(None, max_length=1000)

@api_router.post("/seller/mandat/{contract_id}/denounce")
async def denounce_seller_mandat(contract_id: str, data: Optional[MandateDenounce] = None, current_user: dict = Depends(get_current_user)):
    """Dénonciation du mandat par le mandant (ou par AlterEgo via l'admin) : préavis de 15 jours, e-mail aux deux parties,
    annonce dépubliée à la date d'effet par la tâche `mandate_denounce_effective`. Par le mandant dans les 14 jours suivant
    la signature : rétractation (`withdrawn_retractation`), effet immédiat, annonce retirée, aucune somme due."""
    contract = await _mandate_for_owner(contract_id, current_user)
    if contract.get("status") != "signed":
        raise api_error(400, "validation", "Seul un mandat en cours peut être dénoncé")
    now = datetime.now(timezone.utc)
    withdrawal_end = _parse_dt(contract.get("withdrawal_ends_at"))
    if current_user["id"] == contract.get("seller_id") and withdrawal_end and now <= withdrawal_end:
        return await withdraw_mandate(contract, current_user, now, (data.reason.strip() if data and data.reason else None))
    effective_at = now + timedelta(days=MANDATE_NOTICE_DAYS)
    # Clause de suite (art. 10) : 12 mois à compter de la fin du mandat, « quelle qu'en soit la cause » → date d'effet + 12 mois
    tail_ends_at = add_months(effective_at, MANDATE_TAIL_MONTHS)
    by_role = "seller" if current_user["id"] == contract.get("seller_id") else "platform"
    by_text = "le Mandant" if by_role == "seller" else f"{LEGAL_ENTITY['denomination']} SAS"
    await db.generated_contracts.update_one({"id": contract_id, "status": "signed"}, {"$set": {
        "status": "denounced", "denounced_at": now.isoformat(), "denounced_by": current_user["id"], "denounced_by_role": by_role,
        "denounce_reason": (data.reason.strip() if data and data.reason else None), "effective_at": effective_at.isoformat(),
        "tail_ends_at": tail_ends_at.isoformat(), "signers_pending": []}})
    await db.properties.update_one({"id": contract.get("property_id"), "mandate_id": {"$in": [contract_id, None]}}, {"$set": {
        "mandate_denounced_at": now.isoformat(), "mandate_effective_at": effective_at.isoformat(), "mandate_tail_ends_at": tail_ends_at.isoformat()}})
    await create_audit_log(action="MANDAT_DENOUNCED", property_id=contract.get("property_id"), actor_id=current_user["id"], actor_email=current_user["email"],
                           details={"contract_id": contract_id, "effective_at": effective_at.isoformat(), "by": by_role})
    values = {"registry_number": contract.get("registry_number", ""), "contract_number": contract.get("contract_number", ""),
              "denounced_at": fmt_datetime_paris(now), "denounced_by": by_text, "effective_at": fmt_date_fr(effective_at), "property_id": contract.get("property_id", "")}
    await email_user(contract.get("seller_id"), "mandate_denounced", **values)
    await email_admin("mandate_denounced_admin", **values)
    return {"status": "denounced", "effective_at": effective_at.isoformat(), "denounced_at": now.isoformat(), "tail_ends_at": tail_ends_at.isoformat()}

async def withdraw_mandate(contract: dict, user: dict, now: datetime, reason: Optional[str]) -> dict:
    """Rétractation du mandant (art. 6 du mandat, L221-18 C. conso.) : effet immédiat, annonce retirée, demandes de dossier
    en attente closes, pas de clause de suite, e-mails au vendeur et à l'admin"""
    contract_id = contract["id"]
    res = await db.generated_contracts.update_one({"id": contract_id, "status": "signed"}, {"$set": {
        "status": "withdrawn_retractation", "denounced_at": now.isoformat(), "denounced_by": user["id"], "denounced_by_role": "seller",
        "denounce_reason": reason, "effective_at": now.isoformat(), "effective_applied": True, "tail_ends_at": None,
        "signers_pending": []}})
    if res.modified_count == 0:
        raise api_error(400, "validation", "Seul un mandat en cours peut être dénoncé")
    property = await db.properties.find_one({"id": contract.get("property_id")}, {"_id": 0})
    listing_status = (property or {}).get("status")
    if property and property.get("mandate_id") in (contract_id, None):
        update = {"mandat_signed": False, "mandate_withdrawn_at": now.isoformat(), "updated_at": now.isoformat(),
                  "mandate_tail_ends_at": None}
        if property.get("status") in ("published", "paused", "mandat_en_attente"):
            update.update({"status": "withdrawn", "withdrawn_at": now.isoformat(), "withdrawn_reason": "retractation"})
            listing_status = "withdrawn"
        await db.properties.update_one({"id": property["id"]}, {"$set": update, "$unset": {"mandate_id": ""}})
        await close_pending_dataroom_requests(property["id"], "withdrawn", now)
    await create_audit_log(action="MANDAT_WITHDRAWN", property_id=contract.get("property_id"), actor_id=user["id"],
                           actor_email=user["email"], details={"contract_id": contract_id, "reason": reason})
    values = {"registry_number": contract.get("registry_number", ""), "contract_number": contract.get("contract_number", ""),
              "withdrawn_at": fmt_datetime_paris(now), "property_id": contract.get("property_id", ""),
              "property_title": (property or {}).get("title") or ""}
    await email_user(contract.get("seller_id"), "mandate_withdrawn", **values)
    await email_admin("mandate_withdrawn_admin", **values)
    return {"status": "withdrawn_retractation", "effective_at": now.isoformat(), "denounced_at": now.isoformat(),
            "tail_ends_at": None, "listing_status": listing_status, "label": "rétractation"}

class MandateRenew(BaseModel):
    otp_code: Optional[str] = None

@api_router.post("/seller/mandat/{contract_id}/renew")
async def renew_seller_mandat(contract_id: str, data: MandateRenew, request: Request, current_user: dict = Depends(get_current_user)):
    """Prolongation de 12 mois par accord exprès du mandant (nouvelle signature par code), ajoutée à `renewals[]`"""
    contract = await _mandate_for_owner(contract_id, current_user, allow_admin=False)
    if contract.get("status") != "signed":
        raise api_error(400, "validation", "Seul un mandat en cours peut être prolongé")
    now = datetime.now(timezone.utc)
    evidence = await verify_signature_code(current_user, contract, data.otp_code, request)
    current_end = _parse_dt(contract.get("ends_at")) or now
    new_ends_at = add_months(max(current_end, now), MANDATE_DURATION_MONTHS)
    new_tail = add_months(new_ends_at, MANDATE_TAIL_MONTHS)
    text = (f"Prolongation du mandat n° {contract.get('registry_number')} ({contract.get('contract_number')}) de {MANDATE_DURATION_MONTHS} mois : "
            f"nouvelle échéance le {fmt_date_fr(new_ends_at)}, clause de suite jusqu'au {fmt_date_fr(new_tail)}. "
            f"Accord exprès du Mandant signé électroniquement le {fmt_datetime_paris(now)}.")
    document_sha256 = hashlib.sha256(text.encode()).hexdigest()
    record = await record_signature(contract, current_user, evidence, "mandat_renewal", "seller", now, document_sha256, extra={"addendum": text})
    renewal = {"at": now.isoformat(), "new_ends_at": new_ends_at.isoformat(), "new_tail_ends_at": new_tail.isoformat(), "text": text,
               "evidence": record["evidence"], "evidence_sha256": record["evidence_sha256"], "record_id": record["id"]}
    await db.generated_contracts.update_one({"id": contract_id, "status": "signed"}, {
        "$set": {"ends_at": new_ends_at.isoformat(), "tail_ends_at": new_tail.isoformat(), "renewed_at": now.isoformat()}, "$push": {"renewals": renewal}})
    await db.properties.update_one({"id": contract.get("property_id")}, {"$set": {"mandate_ends_at": new_ends_at.isoformat(), "mandate_tail_ends_at": new_tail.isoformat()}})
    await create_audit_log(action="MANDAT_RENEWED", property_id=contract.get("property_id"), actor_id=current_user["id"], actor_email=current_user["email"],
                           details={"contract_id": contract_id, "ends_at": new_ends_at.isoformat()})
    return {"status": "signed", "ends_at": new_ends_at.isoformat(), "tail_ends_at": new_tail.isoformat(),
            "renewals": len(contract.get("renewals") or []) + 1, "signed_at": now.isoformat()}

def _registry_sort_key(mandate: dict) -> tuple:
    """Registre réel d'abord (numéros entiers), puis registre de test (TEST-0001…), chacun par numéro d'ordre"""
    number = mandate.get("registry_number")
    if isinstance(number, str):
        digits = re.sub(r"\D", "", number)
        return (1, int(digits) if digits else 0)
    return (1 if mandate.get("is_test") else 0, int(number or 0))

@api_router.get("/admin/mandates")
async def admin_mandate_registry(include_test: bool = False, current_user: dict = Depends(get_current_user)):
    """Registre des mandats (lecture seule), par numéro d'ordre : signés, puis dénoncés, expirés ou caducs.
    Les mandats de test (registre TEST-0001…) sont exclus sauf `?include_test=true` ; colonne `test`."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    rows = []
    query = {"type": "mandat", "status": {"$in": ["signed", "denounced", "expired", "void", "withdrawn_retractation"]},
             "registry_number": {"$exists": True}}
    if not include_test:
        query["is_test"] = {"$ne": True}
    mandates = sorted(await db.generated_contracts.find(query, {"_id": 0}).to_list(None), key=_registry_sort_key)
    for m in mandates:
        property = await db.properties.find_one({"id": m.get("property_id")}, {"_id": 0, "title": 1, "id": 1, "status": 1})
        seller = await db.users.find_one({"id": m.get("seller_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company_name": 1})
        rows.append({
            "id": m["id"], "registry_number": m.get("registry_number"), "contract_number": m.get("contract_number"),
            "property_id": m.get("property_id"),
            "property_label": (property or {}).get("title") or f"VL-{(m.get('property_id') or '')[:8].upper()}",
            "listing_status": (property or {}).get("status"),
            "seller_name": display_name(seller), "commission_payer": m.get("commission_payer"),
            "signed_at": m.get("signed_at"), "ends_at": m.get("ends_at"), "tail_ends_at": m.get("tail_ends_at"), "effective_at": m.get("effective_at"),
            "withdrawal_ends_at": m.get("withdrawal_ends_at"),
            "status": m.get("status"), "terms_version": m.get("terms_version") or m.get("commission_terms_version"),
            "signature_method": (m.get("signature_evidence") or {}).get("method"),
            "renewals": len(m.get("renewals") or []),
            "test": bool(m.get("is_test")),
        })
    return {"mandates": rows}

@api_router.get("/admin/mandates/export.csv")
async def admin_mandate_registry_csv(include_test: bool = False, current_user: dict = Depends(get_current_user)):
    import csv
    data = (await admin_mandate_registry(include_test=include_test, current_user=current_user))["mandates"]
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["N° registre", "N° mandat", "Date de signature", "Échéance", "Clause de suite", "Statut", "Annonce", "Vendeur",
                     "Débiteur de la commission", "Version", "Statut annonce", "Méthode de signature", "Test"])
    for r in data:
        writer.writerow([r["registry_number"], r["contract_number"], (r["signed_at"] or "")[:19], (r["ends_at"] or "")[:10], (r["tail_ends_at"] or "")[:10],
                         r["status"], r["property_label"], r["seller_name"], COMMISSION_PAYER_TEXT.get(r["commission_payer"], ""), r["terms_version"],
                         r["listing_status"], r["signature_method"], "oui" if r["test"] else "non"])
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=registre-des-mandats.csv"})

@api_router.get("/seller/mandat/{contract_id}/pdf")
async def download_mandat_pdf(contract_id: str, token: Optional[str] = None, current_user: Optional[dict] = Depends(get_current_user_optional)):
    """PDF du mandat avec page de preuve. Connecté (vendeur, admin) : JSON {filename, content base64} ;
    lien authentifié par jeton (e-mail) : le fichier PDF directement."""
    contract = await db.generated_contracts.find_one({"id": contract_id, "type": "mandat"}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Mandat non trouvé")
    by_token = bool(token and contract.get("pdf_token") and secrets.compare_digest(token, contract["pdf_token"]))
    if not by_token:
        if not current_user:
            raise HTTPException(status_code=401, detail="Connexion requise")
        if current_user.get("role") != "admin" and contract.get("seller_id") != current_user["id"]:
            raise HTTPException(status_code=403, detail="Non autorisé")
    pdf = await contract_pdf_bytes(contract)
    filename = f"mandat_{contract.get('contract_number')}.pdf"
    if by_token:
        return pdf_response(pdf, filename)
    return {"filename": filename, "content": base64.b64encode(pdf).decode("utf-8")}

@api_router.get("/seller/mandat/status/{property_id}")
async def get_mandat_status(property_id: str, current_user: dict = Depends(get_current_user)):
    """État du mandat de l'annonce (dernier mandat : signé, dénoncé, rétracté, expiré, caduc ou en attente) et acquéreurs présentés"""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    if current_user.get("role") != "admin" and not is_property_owner(property, current_user):
        raise HTTPException(status_code=403, detail="Non autorisé")
    mandat = None
    if property.get("mandate_id"):
        mandat = await db.generated_contracts.find_one({"id": property["mandate_id"], "type": "mandat"}, {"_id": 0})
    if not mandat:
        mandat = await latest_mandate(property_id)
    return {"mandat_signed": bool(mandat) and mandat.get("status") == "signed", "mandat": mandate_view(mandat),
            "presented_buyers": await presented_buyers_view(property)}

# ---- Fin de mandat (expiration, dénonciation effective) ----
async def end_mandate(contract: dict, reason: str, listing_status: str, now: datetime, ended_at: Optional[datetime] = None) -> None:
    """Dépublie l'annonce et envoie au mandant la liste nominative des acquéreurs présentés (clause de suite).
    L'annonce n'est modifiée que si ce mandat est celui qui la couvre (`property.mandate_id`) : un nouveau mandat signé
    entre-temps la laisse en ligne, et aucun e-mail de fin de mandat n'est alors envoyé."""
    property = await db.properties.find_one({"id": contract.get("property_id")}, {"_id": 0})
    if property and property.get("mandate_id") and property["mandate_id"] != contract.get("id"):
        if await has_signed_mandate(property):
            return
        property = None  # annonce couverte par un autre mandat (caduc, expiré…) : seule la liste des présentés est envoyée
    if property:
        update = {"mandat_signed": False, "updated_at": now.isoformat(), "mandate_ended_at": now.isoformat()}
        if property.get("status") == "published":
            update["status"] = listing_status
            if listing_status == "withdrawn":
                # Retrait lié à la fin du mandat : un nouveau mandat signé remet l'annonce en ligne (sign_seller_mandat)
                update.update({"withdrawn_reason": "mandate_ended", "withdrawn_at": now.isoformat()})
        await db.properties.update_one({"id": property["id"]}, {"$set": update})
    else:
        property = await db.properties.find_one({"id": contract.get("property_id")}, {"_id": 0})
    buyers = await presented_buyers_view(property or {})
    if buyers:
        lines = [f"{b.get('name') or b['label']}" + (f" ({b['company_name']})" if b.get("company_name") else "") + f", engagement signé le {fmt_date_fr(b.get('at'))}"
                 for b in buyers]
        buyers_list = " ; ".join(lines)
    else:
        buyers_list = "aucun acquéreur ne vous a été nommément présenté pendant ce mandat"
    await email_user(contract.get("seller_id"), "mandate_ended", title="Fin de votre mandat", registry_number=contract.get("registry_number", ""),
                     ended_at=fmt_date_fr(ended_at or now), reason=reason, tail_ends_at=fmt_date_fr(contract.get("tail_ends_at")), buyers_list=buyers_list)

async def job_mandate_expiry(now: datetime) -> int:
    """E-mail à J-30 avant l'échéance, puis expiration à `ends_at` : mandat `expired`, annonce retirée, liste des présentés"""
    count = 0
    async for m in db.generated_contracts.find({"type": "mandat", "status": "signed", "ends_at": {"$exists": True}}, {"_id": 0}):
        ends_at = _parse_dt(m.get("ends_at"))
        if not ends_at:
            continue
        if ends_at <= now:
            if not await claim_once("mandate_expired", m["id"]):
                continue
            await db.generated_contracts.update_one({"id": m["id"], "status": "signed"}, {"$set": {"status": "expired", "expired_at": now.isoformat(), "signers_pending": []}})
            await end_mandate(m, "arrivé à échéance sans prolongation", "mandat_en_attente", now, ends_at)
            count += 1
        elif ends_at - timedelta(days=30) <= now and await claim_once("mandate_j30", f"{m['id']}:{m['ends_at']}"):
            await email_user(m.get("seller_id"), "mandate_j30", registry_number=m.get("registry_number", ""), ends_at=fmt_date_fr(ends_at),
                             link=site_url(f"/seller/mandat/{m.get('property_id')}"))
            count += 1
    return count

async def job_mandate_denounce_effective(now: datetime) -> int:
    """Dénonciations arrivées à leur date d'effet (préavis de 15 jours) : annonce retirée, liste des présentés envoyée"""
    count = 0
    async for m in db.generated_contracts.find({"type": "mandat", "status": "denounced", "effective_applied": {"$ne": True}}, {"_id": 0}):
        effective = _parse_dt(m.get("effective_at"))
        if not effective or effective > now or not await claim_once("mandate_denounce_effective", m["id"]):
            continue
        await db.generated_contracts.update_one({"id": m["id"]}, {"$set": {"effective_applied": True, "effective_applied_at": now.isoformat()}})
        who = "par vous-même" if m.get("denounced_by_role") == "seller" else f"par {LEGAL_ENTITY['denomination']} SAS"
        await end_mandate(m, f"dénoncé le {fmt_date_fr(m.get('denounced_at'))} {who}, préavis de {MANDATE_NOTICE_DAYS} jours", "withdrawn", now, effective)
        count += 1
    return count

# ============ CREATE ADMIN ACCOUNT ON STARTUP ============

async def create_admin_account():
    """Créer le compte admin s'il n'existe pas (identifiants lus dans l'environnement)"""
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_email or not admin_password:
        logger.warning("ADMIN_EMAIL / ADMIN_PASSWORD non définis : aucun compte admin créé automatiquement")
        return
    existing = await db.users.find_one({"email": admin_email})
    
    if not existing:
        admin_user = {
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": await hash_password_async(admin_password),
            "role": "admin",
            "company_name": f"{site_name()} Admin",
            "identity_verified": True,
            "email_verified": True,
            "email_verified_at": datetime.now(timezone.utc).isoformat(),
            "kyc_status": "verified",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.users.insert_one(admin_user)
        logger.info(f"Compte administrateur créé : {admin_email}")
    else:
        # Update role to admin if exists
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"role": "admin", "identity_verified": True, "kyc_status": "verified", "email_verified": True}}
        )
        logger.info(f"Compte administrateur mis à jour : {admin_email}")


def cors_origins() -> list:
    """Origines autorisées : CORS_ORIGINS explicite, sinon l'URL du site. Jamais « * » avec les identifiants."""
    origins = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
    origins = [o for o in origins if o != "*"]
    if not origins:
        origins = [site_url()]
        if not IS_PRODUCTION:
            origins += ["http://localhost:3000", "http://127.0.0.1:3000"]
    return sorted(set(origins))

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
    # Front sur un autre domaine que l'API (REACT_APP_BACKEND_URL) : le total des listes (pagination, nombre d'annonces
    # du panneau de filtres mobile) doit rester lisible par le navigateur
    expose_headers=["X-Total-Count"],
)

# ============ TÂCHES AUTOMATIQUES (relances et suivi) ============

async def claim_once(kind: str, key: str) -> bool:
    """Réserve une action unique (un email de relance par clé) ; False si déjà faite"""
    res = await db.job_marks.update_one(
        {"kind": kind, "key": key},
        {"$setOnInsert": {"kind": kind, "key": key, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return res.upserted_id is not None

async def job_seller_reminders(now: datetime) -> int:
    """Vendeur sans réponse depuis 3 jours au dernier message d'un acquéreur (annonces en ligne ou en pause) : un seul
    e-mail récapitulatif par vendeur (« N conversations attendent votre réponse »), via send_reminder (une relance par
    jour et par personne, lien de désinscription, notifications_opt_out respecté). Chaque dernier message n'est rappelé
    qu'une fois (clé conversation:last_at)."""
    sent = 0
    limit = (now - timedelta(days=3)).isoformat()
    # Fenêtre de 30 jours : en régime normal le rappel part entre J+3 et J+4 ; les conversations plus anciennes
    # (antérieures à ce job) ne déclenchent pas de rattrapage massif
    floor = (now - timedelta(days=30)).isoformat()
    waiting = {}
    statuses = {}
    async for conv in db.conversations.find({"last_at": {"$lte": limit, "$gte": floor}, "last_sender_id": {"$ne": None}},
                                            {"_id": 0, "id": 1, "property_id": 1, "buyer_id": 1, "seller_id": 1, "last_at": 1, "last_sender_id": 1}):
        if conv.get("last_sender_id") != conv.get("buyer_id") or not conv.get("seller_id"):
            continue
        if conv["property_id"] not in statuses:
            property = await db.properties.find_one({"id": conv["property_id"]}, {"_id": 0, "status": 1})
            statuses[conv["property_id"]] = (property or {}).get("status")
        if statuses[conv["property_id"]] not in DATAROOM_OPEN_LISTING_STATUSES:
            continue
        key = f"{conv['id']}:{conv['last_at']}"
        if await db.job_marks.find_one({"kind": "seller_reminder", "key": key}):
            continue
        waiting.setdefault(conv["seller_id"], []).append(key)
    for seller_id, keys in waiting.items():
        count = len(keys)
        if not await send_reminder(seller_id, "seller_reminder_batch", f"{seller_id}:{now.strftime('%Y-%m-%d')}", now, "seller_reminder",
                                   count=str(count), subject_text="Un acquéreur attend votre réponse" if count == 1 else f"{count} acquéreurs attendent votre réponse",
                                   intro=("Un acquéreur potentiel vous a écrit il y a plus de 3 jours et n'a pas encore reçu de réponse."
                                          if count == 1 else f"{count} acquéreurs potentiels vous ont écrit il y a plus de 3 jours et attendent votre réponse."),
                                   link=site_url("/messages")):
            continue
        for key in keys:
            await claim_once("seller_reminder", key)
        sent += 1
    return sent

async def job_followups(now: datetime) -> int:
    """30 jours après un premier contact : questionnaire « où en êtes-vous ? » à l'acquéreur"""
    import secrets
    sent = 0
    limit = now - timedelta(days=30)
    async for contact in db.contacts.find({}, {"_id": 0}):
        created = _parse_dt(contact.get("created_at"))
        if not created or created > limit or await db.job_marks.find_one({"kind": "followup_30d", "key": contact["id"]}):
            continue
        property = await db.properties.find_one({"id": contact.get("property_id")}, {"_id": 0, "title": 1})
        token = secrets.token_urlsafe(24)
        label = (property or {}).get("title") or ""
        # Questionnaire non transactionnel : lien de désinscription, notifications_opt_out, une relance par jour
        if not await send_reminder(contact.get("buyer_id"), "followup_30d", contact["id"], now, "followup_30d",
                                   property_label=label or f"annonce {site_name()}", link_base=site_url(f"/suivi?token={token}")):
            continue
        await db.followups.insert_one({
            "token": token, "contact_id": contact["id"], "buyer_id": contact.get("buyer_id"),
            "property_id": contact.get("property_id"), "sent_at": now.isoformat(), "answer": None
        })
        sent += 1
    return sent

async def job_seller_relaunch(now: datetime) -> int:
    """Vendeurs inscrits depuis 3 jours sans annonce, ou avec un brouillon non soumis : une relance chacun"""
    sent = 0
    limit = now - timedelta(days=3)
    async for seller in db.users.find({"role": "seller"}, {"_id": 0, "id": 1, "created_at": 1, "identity_verified": 1, "kyc_status": 1}):
        created = _parse_dt(seller.get("created_at"))
        if not created or created > limit:
            continue
        listings = await db.properties.find({"seller_id": seller["id"]},
                                           {"_id": 0, "id": 1, "status": 1, "created_at": 1, "updated_at": 1}).to_list(50)
        if not listings:
            # Prospection : lien de désinscription et notifications_opt_out, une relance par jour
            if await send_reminder(seller["id"], "seller_no_listing", seller["id"], now, "seller_no_listing",
                                   link=site_url("/seller/create")):
                sent += 1
        elif any(l.get("status") == "draft" and (_parse_dt(l.get("created_at")) or now) <= limit for l in listings) \
                and not is_user_verified(seller) \
                and await send_reminder(seller["id"], "seller_draft_reminder", seller["id"], now, "seller_draft_reminder",
                                        link=site_url("/seller/dashboard")):
            sent += 1
    return sent

# ---- Relances §6.1 : un seul e-mail de relance par jour et par personne, préférence notifications_opt_out respectée ----
async def send_reminder(user_id: Optional[str], kind: str, key: str, now: datetime, template: str, transactional: bool = False, **values) -> bool:
    """Envoie une relance au plus une fois par clé (claim_once) et au plus une par jour et par personne.
    Les relances non transactionnelles portent un lien de désinscription et respectent notifications_opt_out."""
    if not user_id:
        return False
    day_key = f"{user_id}:{now.strftime('%Y-%m-%d')}"
    if await db.job_marks.find_one({"kind": "reminder_day", "key": day_key}):
        return False
    if not await claim_once(kind, key):
        return False
    await claim_once("reminder_day", day_key)
    await email_user(user_id, template, unsubscribe_url="" if transactional else unsubscribe_link_for_user(user_id), **values)
    return True

MANDATE_REMINDER_DAYS = (1, 4, 10)
def mandate_objections() -> dict:
    """Une objection traitée à chaque relance « mandat à signer » (J+1, J+4, J+10) ; chiffres issus de la configuration"""
    return {
        1: ("« Je ne veux pas d'exclusivité. »", "Le mandat est simple, non exclusif : vous restez libre de vendre vous-même ou avec "
            "d'autres intermédiaires, sans pénalité. Rien n'est dû si l'acquéreur ne vous a pas été présenté par la plateforme."),
        4: ("« Combien ça coûte ? »", "Rien avant la vente. Les honoraires (" + commission_scale_text().split(", à la charge")[0]
            + ") ne sont dus qu'à la signature de l'acte authentique, réglés par le notaire sur le prix, et seulement si "
            "l'acquéreur vous a été présenté par la plateforme."),
        10: ("« Je peux résilier ? »", f"À tout moment, depuis votre espace, avec un préavis de {MANDATE_NOTICE_DAYS} jours, et sans "
             f"délai pendant les {MANDATE_WITHDRAWAL_DAYS} jours qui suivent la signature (rétractation). Le mandat dure "
             f"{MANDATE_DURATION_MONTHS} mois et ne se prolonge qu'avec votre accord exprès."),
    }

async def job_mandate_reminders(now: datetime) -> int:
    """Annonce prête, mandat non signé : relances J+1, J+4, J+10 (une objection traitée à chaque envoi)"""
    sent = 0
    async for c in db.properties.find({"status": "mandat_en_attente"}, {"_id": 0, "id": 1, "seller_id": 1, "updated_at": 1, "mandate_pending_since": 1, "created_at": 1}):
        since = _parse_dt(c.get("mandate_pending_since") or c.get("updated_at") or c.get("created_at"))
        if not since:
            continue
        elapsed = (now - since).days
        due = [d for d in MANDATE_REMINDER_DAYS if elapsed >= d]
        if not due:
            continue
        day = due[-1]
        title, text = mandate_objections()[day]
        # Signature en cours : relance transactionnelle (la page de désinscription promet que les signatures continuent)
        if await send_reminder(c.get("seller_id"), "mandate_reminder", f"{c['id']}:{day}", now, "mandate_reminder", transactional=True,
                               days=str(elapsed), plural="s" if elapsed > 1 else "", objection_title=title, objection_text=text,
                               link=site_url(f"/seller/mandat/{c['id']}")):
            sent += 1
    return sent

# ---- Durées de conservation de la politique de confidentialité (SPEC §1, §4.1, §6.4) : purge quotidienne ----
RETENTION_ACCOUNT_DAYS = 3 * 365          # compte et profil : 3 ans après la dernière connexion, puis anonymisation
RETENTION_IDENTITY_REPORT_DAYS = 5 * 365  # rapport de vérification d'identité : 5 ans après la fin de la relation (LCB-FT)
RETENTION_MESSAGES_DAYS = 3 * 365         # messages
RETENTION_DATAROOM_LOGS_DAYS = 3 * 365    # journal d'accès de l'espace sécurisé
RETENTION_SECURITY_LOGS_DAYS = 365        # journaux techniques de sécurité (tentatives de contournement)
RETENTION_DATAROOM_DOCS_DAYS = 3 * 365    # documents de l'espace sécurisé : 3 ans après le retrait ou la vente de l'annonce
# Annonces encore actives (documents conservés tant que l'annonce vit, quelle que soit leur ancienneté)
LISTING_ACTIVE_STATUSES = ("draft", "mandat_en_attente", "pending", "published", "paused")
# Estimations sans compte (7 jours sans confirmation, 3 ans après) : estimator.daily_job

async def _has_open_obligations(uid: str) -> bool:
    """Mandat signé en cours, vente en cours ou facture non soldée : le compte reste actif (relation non terminée)"""
    if await db.generated_contracts.find_one({"$or": [{"seller_id": uid}, {"buyer_id": uid}], "status": {"$in": ["signed", "pending_signature"]},
                                              "type": "mandat"}, {"_id": 1}):
        return True
    if await db.closings.find_one({"$or": [{"seller_id": uid}, {"buyer_id": uid}], "status": {"$in": ["in_progress", "declared", "disputed"]}},
                                  {"_id": 1}):
        return True
    return bool(await db.invoices.find_one({"debtor.user_id": uid, "status": {"$in": ["draft", "issued"]}}, {"_id": 1}))

async def job_rgpd_purge(now: datetime) -> int:
    """Applique les durées annoncées par la politique de confidentialité : messages et journal d'accès de l'espace
    sécurisé (3 ans), documents de l'espace sécurisé (3 ans après le retrait ou la vente), journaux techniques (12 mois), comptes inactifs depuis 3 ans anonymisés (sauf mandat, vente ou
    facture en cours), rapport de vérification d'identité retiré 5 ans après la dernière activité. Mandats, factures,
    preuves de signature et chaîne d'audit sont conservés (10 ans, obligation légale)."""
    days = lambda n: (now - timedelta(days=n)).isoformat()
    result = {}
    res = await db.messages.delete_many({"created_at": {"$lt": days(RETENTION_MESSAGES_DAYS)}})
    result["messages"] = res.deleted_count
    await db.conversations.update_many({"last_at": {"$lt": days(RETENTION_MESSAGES_DAYS)}, "last_message": {"$ne": ""}},
                                       {"$set": {"last_message": ""}})
    limit = days(RETENTION_DATAROOM_LOGS_DAYS)
    res = await db.dataroom_access_logs.delete_many({"$or": [{"timestamp": {"$lt": limit}}, {"accessed_at": {"$lt": limit}}]})
    result["dataroom_access_logs"] = res.deleted_count
    res = await db.contact_attempts.delete_many({"created_at": {"$lt": days(RETENTION_SECURITY_LOGS_DAYS)}})
    result["contact_attempts"] = res.deleted_count
    # Documents de l'espace sécurisé d'une annonce retirée, vendue ou caduque depuis 3 ans (fin du mandat)
    docs_deleted = 0
    docs_limit = days(RETENTION_DATAROOM_DOCS_DAYS)
    async for c in db.properties.find({"status": {"$nin": list(LISTING_ACTIVE_STATUSES)}},
                                     {"_id": 0, "id": 1, "updated_at": 1, "withdrawn_at": 1, "sold_at": 1, "removed_at": 1}):
        ended = max([v for v in (c.get("updated_at"), c.get("withdrawn_at"), c.get("sold_at"), c.get("removed_at")) if v] or [""])
        if not ended or ended >= docs_limit:
            continue
        async for doc in db.dataroom.find({"property_id": c["id"]}, {"_id": 0, "id": 1, "storage": 1, "storage_key": 1}):
            try:
                await delete_file(doc)
            except Exception as e:  # fichier S3 déjà absent : la référence est retirée quand même
                logger.warning(f"Purge RGPD : fichier {doc.get('id')} non supprimé du stockage ({e})")
            await db.dataroom.delete_one({"id": doc["id"]})
            docs_deleted += 1
    result["dataroom_documents"] = docs_deleted
    # Comptes inactifs depuis 3 ans
    anonymized = 0
    account_limit = days(RETENTION_ACCOUNT_DAYS)
    async for u in db.users.find({"deleted_at": {"$exists": False}, "role": {"$ne": "admin"}},
                                 {"_id": 0, "id": 1, "email": 1, "last_activity_at": 1, "created_at": 1}):
        last = u.get("last_activity_at") or u.get("created_at")
        if not last or last >= account_limit or await _has_open_obligations(u["id"]):
            continue
        await anonymize_user(u, now.isoformat(), reason="compte inactif depuis 3 ans", keep_identity_report=True)
        await db.users.update_one({"id": u["id"]}, {"$set": {"anonymized_reason": "inactivite"}})
        anonymized += 1
    result["accounts_anonymized"] = anonymized
    # Rapport de vérification d'identité : 5 ans après la fin de la relation (dernière activité)
    reports = 0
    report_limit = days(RETENTION_IDENTITY_REPORT_DAYS)
    async for u in db.users.find({"$or": [{f: {"$exists": True}} for f in IDENTITY_REPORT_FIELDS]},
                                 {"_id": 0, "id": 1, "last_activity_at": 1, "created_at": 1, "deleted_at": 1}):
        last = u.get("last_activity_at") or u.get("created_at")
        if not last or last >= report_limit or (not u.get("deleted_at") and await _has_open_obligations(u["id"])):
            continue
        await db.users.update_one({"id": u["id"]}, {"$unset": {f: "" for f in IDENTITY_REPORT_FIELDS}})
        await db.kyc_sessions.delete_many({"user_id": u["id"]})
        reports += 1
    result["identity_reports"] = reports
    if any(result.values()):
        logger.info(f"Purge RGPD : {result}")
    return sum(result.values())

SELLER_INACTIVITY_DAYS = 60
SELLER_INACTIVITY_WARNING_DAYS = 53

def price_range_for(property: dict) -> Optional[dict]:
    """Fourchette indicative par le rendement (estimator.compute_estimate) à partir des chiffres de l'annonce ; None si
    incalculable"""
    estimator = LOADED_MODULES.get("estimator")
    if not estimator:
        return None
    try:
        return estimator.compute_estimate(property.get("property_type"), property.get("lease_type"), property.get("department"),
                                          property.get("rent_monthly"), property.get("property_tax"),
                                          property.get("non_recoverable_charges"), property.get("dpe_class"))
    except (ValueError, TypeError):
        return None

async def job_seller_lifecycle(now: datetime) -> int:
    """Annonces en ligne : 14 jours sans contact (leviers), 30 jours (prix face à la fourchette), 60 jours sans connexion
    du vendeur (avertissement à J-7 puis mise en pause)"""
    sent = 0
    sellers = {}
    async for c in db.properties.find({"status": "published"}, {"_id": 0}):
        published = _parse_dt(c.get("published_at"))
        seller_id = c.get("seller_id")
        if not published or not seller_id:
            continue
        title = c.get("title") or "votre annonce"
        elapsed = (now - published).days
        contacts = await db.contacts.count_documents({"property_id": c["id"]})
        if elapsed >= 14 and contacts == 0:
            if await send_reminder(seller_id, "seller_no_contact_14d", c["id"], now, "seller_no_contact_14d", property_title=title,
                                   link=site_url("/seller/dashboard")):
                sent += 1
                continue
        if elapsed >= 30:
            estimate = price_range_for(c)
            if estimate:
                asking = float(c.get("asking_price") or 0)
                if asking > estimate["high"]:
                    advice = ("Votre prix est au-dessus de la fourchette : les acquéreurs comparent les rendements avant d'écrire. "
                              "Un prix ramené dans la fourchette, ou un argument concret dans la description (bail récent, travaux faits, locataire stable), relance les contacts.")
                elif asking < estimate["low"]:
                    advice = "Votre prix est en dessous de la fourchette : vérifiez que le loyer et les charges saisis sont à jour avant de le laisser ainsi."
                else:
                    advice = "Votre prix est dans la fourchette : les contacts dépendent maintenant de la qualité de la description et de votre réactivité."
                activity = (f"Elle a reçu {contacts} contact{'s' if contacts > 1 else ''}." if contacts
                            else "Elle n'a pas encore reçu de contact.")
                if await send_reminder(seller_id, "seller_price_30d", c["id"], now, "seller_price_30d", property_title=title,
                                       activity_line=activity, asking_price=fmt_eur_fr(asking), low=fmt_eur_fr(estimate["low"]),
                                       high=fmt_eur_fr(estimate["high"]), method="méthode du rendement",
                                       advice=advice, link=site_url("/seller/dashboard")):
                    sent += 1
                    continue
        if seller_id not in sellers:
            sellers[seller_id] = await db.users.find_one({"id": seller_id}, {"_id": 0, "id": 1, "last_activity_at": 1, "created_at": 1})
        seller = sellers[seller_id]
        last = _parse_dt((seller or {}).get("last_activity_at") or (seller or {}).get("created_at"))
        if not last:
            continue
        idle = (now - last).days
        key = f"{c['id']}:{last.date().isoformat()}"
        if idle >= SELLER_INACTIVITY_DAYS:
            if await claim_once("seller_listing_paused", key):
                await db.properties.update_one({"id": c["id"]}, {"$set": {"status": "paused", "paused_at": now.isoformat(),
                                                                         "paused_reason": "inactivite", "updated_at": now.isoformat()}})
                await email_user(seller_id, "seller_listing_paused", property_title=title, link=site_url("/seller/dashboard"))
                sent += 1
        elif idle >= SELLER_INACTIVITY_WARNING_DAYS:
            pause_on = fmt_date_fr(last + timedelta(days=SELLER_INACTIVITY_DAYS))
            if await send_reminder(seller_id, "seller_inactive_warning", key, now, "seller_inactive_warning", property_title=title,
                                   days=str(idle), pause_on=pause_on, link=site_url("/login")):
                sent += 1
    return sent

BUYER_IDENTITY_REMINDER_DAYS = (1, 3, 10)
BUYER_NDA_REMINDER_DAYS = (2, 7)

async def job_buyer_reminders(now: datetime) -> int:
    """Demande acceptée : identité à vérifier J+1/J+3/J+10, engagement à signer J+2/J+7 ; accès ouvert sans consultation à J+3"""
    sent = 0
    async for a in db.dataroom_access.find({"status": {"$in": ["accepted", "validated", "loi_pending", "granted"]}}, {"_id": 0}):
        buyer = await db.users.find_one({"id": a.get("buyer_id")}, USER_SAFE_PROJECTION)
        property = await db.properties.find_one({"id": a.get("property_id")}, {"_id": 0, "id": 1, "title": 1, "status": 1})
        if not buyer or not property or property.get("status") not in ("published", "paused"):
            continue
        title = property.get("title") or "le bien"
        link = site_url(f"/dataroom/{property['id']}")
        if a.get("status") == "granted":
            granted = _parse_dt(a.get("granted_at"))
            if granted and (now - granted).days >= 3:
                visited = await db.dataroom_access_logs.find_one({"property_id": property["id"], "$or": [{"user_id": buyer["id"]}, {"viewer_id": buyer["id"]}]})
                if not visited and await send_reminder(buyer["id"], "buyer_dataroom_unvisited", a["id"], now, "buyer_dataroom_unvisited",
                                                       property_title=title, link=link):
                    sent += 1
            continue
        accepted = _parse_dt(a.get("accepted_at") or a.get("validated_at"))
        if not accepted:
            continue
        elapsed = (now - accepted).days
        steps = await dataroom_steps(property["id"], buyer, a)
        if not steps["identity"]:
            due = [d for d in BUYER_IDENTITY_REMINDER_DAYS if elapsed >= d]
            if due and await send_reminder(buyer["id"], "buyer_identity_reminder", f"{a['id']}:{due[-1]}", now, "buyer_identity_reminder",
                                           property_title=title, days=str(elapsed), plural="s" if elapsed > 1 else "", link=link):
                sent += 1
        elif not steps["nda"]:
            due = [d for d in BUYER_NDA_REMINDER_DAYS if elapsed >= d]
            if due and await send_reminder(buyer["id"], "buyer_nda_reminder", f"{a['id']}:{due[-1]}", now, "buyer_nda_reminder",
                                           property_title=title, link=link):
                sent += 1
    return sent

async def job_seller_weekly(now: datetime) -> int:
    """Hebdo vendeur : vues, favoris et contacts de la semaine sur ses annonces en ligne (jamais de compteur à zéro)"""
    sent = 0
    week = _period_keys(now)["weekly"]
    since = (now - timedelta(days=7)).isoformat()
    by_seller = {}
    async for c in db.properties.find({"status": "published"}, {"_id": 0, "id": 1, "seller_id": 1, "title": 1, "views": 1, "weekly_snapshot": 1}):
        by_seller.setdefault(c.get("seller_id"), []).append(c)
    for seller_id, listings in by_seller.items():
        if not seller_id or not await claim_once("seller_weekly", f"{seller_id}:{week}"):
            continue
        lines, pending = [], 0
        for c in listings:
            snapshot = c.get("weekly_snapshot") or {}
            views_delta = max(0, int(c.get("views") or 0) - int(snapshot.get("views") or 0))
            favorites = await db.favorites.count_documents({"property_id": c["id"], "created_at": {"$gte": since}})
            contacts = await db.contacts.count_documents({"property_id": c["id"], "created_at": {"$gte": since}})
            pending += await db.dataroom_access.count_documents({"property_id": c["id"], "status": "pending"})
            pending += await db.messages.count_documents({"property_id": c["id"], "receiver_id": seller_id, "read": False, "kind": {"$ne": "system"}})
            parts = [f"{views_delta} vue{'s' if views_delta > 1 else ''}" if views_delta else "",
                     f"{favorites} favori{'s' if favorites > 1 else ''}" if favorites else "",
                     f"{contacts} contact{'s' if contacts > 1 else ''}" if contacts else ""]
            parts = [p for p in parts if p]
            label = html_escape(c.get("title") or "Votre annonce")
            lines.append(f"<li><strong>{label}</strong> : {', '.join(parts) if parts else 'pas encore de nouvelle activité cette semaine'}</li>")
            await db.properties.update_one({"id": c["id"]}, {"$set": {"weekly_snapshot": {"views": int(c.get("views") or 0), "at": now.isoformat()}}})
        intro = "Voici l'activité de la semaine sur vos annonces."
        todo = (f"{pending} action{'s' if pending > 1 else ''} vous attend{'ent' if pending > 1 else ''} (messages non lus, demandes de dossier)."
                if pending else "Pour attirer plus d'acquéreurs : une description complète, un dossier du bien déjà rempli (bail, quittances, diagnostics) et un prix cohérent avec le rendement du marché.")
        await email_user(seller_id, "seller_weekly", unsubscribe_url=unsubscribe_link_for_user(seller_id), intro=intro, lines="".join(lines),
                         todo_line=todo, link=site_url("/seller/dashboard"))
        sent += 1
    return sent

NPS_DELAY_DAYS = 7

async def job_nps(now: datetime) -> int:
    """Sept jours après une vente confirmée : question NPS en un clic aux deux parties (une seule fois)"""
    sent = 0
    async for cl in db.closings.find({"status": "confirmed"}, {"_id": 0, "id": 1, "buyer_id": 1, "seller_id": 1, "confirmed_at": 1, "property_label": 1}):
        confirmed = _parse_dt(cl.get("confirmed_at"))
        if not confirmed or (now - confirmed).days < NPS_DELAY_DAYS:
            continue
        for role in ("seller", "buyer"):
            user_id = cl.get(f"{role}_id")
            if not user_id:
                continue
            token = alert_token({"action": "nps", "closing": cl["id"], "user": user_id, "role": role})
            scores = " ".join(f'<a href="{site_url(f"/api/nps/{token}?score={n}")}" style="display:inline-block;margin:2px;padding:8px 10px;'
                              f'border:1px solid #e3e7ee;border-radius:6px;text-decoration:none;color:#0b1220">{n}</a>' for n in range(11))
            if await send_reminder(user_id, "nps_after_sale", f"{cl['id']}:{role}", now, "nps_after_sale",
                                   property_label=cl.get("property_label") or "votre bien", scores=scores):
                sent += 1
    return sent

@api_router.get("/nps/{token}")
async def nps_confirmation_page(token: str, score: int = 0):
    """Lien de note dans l'e-mail : page de confirmation SANS effet (les passerelles de sécurité ouvrent tous les liens) ;
    la note est enregistrée par le bouton (POST)"""
    payload = read_alert_token(token, "nps")
    if not payload or not (0 <= score <= 10):
        return _alert_page("Lien invalide", "Ce lien de réponse n'est pas valable.", "Accéder à mon espace", "/login")
    return _alert_page("Confirmer votre note", f"Vous avez choisi la note {score}/10. Confirmez-la pour l'enregistrer.",
                       form_action=f"/api/nps/{token}", form_label=f"Enregistrer ma note ({score}/10)", form_fields={"score": score})

@api_router.post("/nps/{token}")
async def answer_nps(token: str, score: int = Form(...)):
    """Réponse NPS (bouton de la page de confirmation) → page HTML minimale"""
    payload = read_alert_token(token, "nps")
    if not payload or not (0 <= score <= 10):
        return _alert_page("Lien invalide", "Ce lien de réponse n'est pas valable.", "Accéder à mon espace", "/login")
    now = datetime.now(timezone.utc).isoformat()
    await db.nps.update_one({"closing_id": payload["closing"], "user_id": payload["user"]},
                            {"$set": {"score": score, "role": payload.get("role"), "answered_at": now},
                             "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}}, upsert=True)
    return _alert_page("Merci pour votre réponse", f"Votre note ({score}/10) est enregistrée. Elle sert uniquement à améliorer la plateforme.",
                       "Accéder à mon espace", "/login")

# ---- Sauvegarde : envoi quotidien de la dernière archive mongodump vers S3 (si configuré) ----
def backup_dir() -> Path:
    return Path(os.environ.get("BACKUP_DIR", "/backups"))

def latest_backup_file() -> Optional[Path]:
    """Dernière archive produite par le service `backup` (ops/backup.sh) dans le volume partagé"""
    d = backup_dir()
    if not d.is_dir():
        return None
    files = sorted((p for p in d.glob("*.archive.gz") if p.is_file()), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None

BACKUP_MAX_AGE_HOURS = 30

def backup_age_hours(now: Optional[datetime] = None) -> Optional[float]:
    """Âge (heures) de la dernière sauvegarde réussie : marque $BACKUP_DIR/last_success écrite par ops/backup.sh, à défaut
    la dernière archive. None si le volume de sauvegarde n'est pas monté (développement)."""
    d = backup_dir()
    if not d.is_dir():
        return None
    marker = d / "last_success"
    target = marker if marker.is_file() else latest_backup_file()
    if not target:
        return None
    now = now or datetime.now(timezone.utc)
    try:
        return round((now.timestamp() - target.stat().st_mtime) / 3600, 1)
    except OSError:
        return None

def _upload_backup_sync(path: Path) -> str:
    import boto3
    s3 = boto3.client("s3", endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
                      region_name=os.environ.get("S3_REGION") or None)
    key = f"{os.environ.get('S3_BACKUP_PREFIX', 'backups').strip('/')}/{path.name}"
    with open(path, "rb") as f:
        s3.upload_fileobj(f, os.environ["S3_BUCKET"], key, ExtraArgs=s3_extra_args())
    return key

async def job_backup_to_s3(now: datetime) -> int:
    """Pousse la dernière archive locale vers le bucket S3 (une fois par fichier). 0 si rien à faire."""
    if not s3_enabled():
        return 0
    latest = latest_backup_file()
    if not latest or not await claim_once("backup_s3", latest.name):
        return 0
    key = await asyncio.to_thread(_upload_backup_sync, latest)
    await db.backups.insert_one({"file": latest.name, "s3_key": key, "size": latest.stat().st_size, "uploaded_at": now.isoformat()})
    logger.info(f"Sauvegarde envoyée vers S3 : {key}")
    return 1

# ---- Orchestration : tâches horaires du noyau + tâches quotidiennes / hebdomadaires / mensuelles des modules ----
# backup_s3 est horaire (idempotent par nom d'archive) : l'archive de la nuit part dans l'heure qui suit sa création
HOURLY_JOBS = (("followups", job_followups), ("seller_relaunch", job_seller_relaunch), ("backup_s3", job_backup_to_s3))
DAILY_JOBS = [("admin_digest", job_admin_digest),
              # Messages sans réponse du vendeur depuis 3 jours : un récapitulatif par vendeur et par jour au plus
              ("seller_reminders", job_seller_reminders),
              # Contrats (SPEC §3.2, §3.4) : échéance des mandats (J-30 puis expiration), dénonciations effectives, offres expirées
              ("mandate_expiry", job_mandate_expiry), ("mandate_denounce_effective", job_mandate_denounce_effective),
              ("offers_expiry", job_offers_expiry),
              # Parcours : demandes de dossier (J+2/J+5, expiration J+10), mandat à signer (J+1/4/10),
              # vie de l'annonce (14 j, 30 j, 60 j sans connexion), acquéreur (identité, engagement, dossier), NPS après vente
              ("dataroom_requests", job_dataroom_requests), ("mandate_reminders", job_mandate_reminders),
              ("seller_lifecycle", job_seller_lifecycle), ("buyer_reminders", job_buyer_reminders), ("nps", job_nps),
              # Durées de conservation de la politique de confidentialité (purge TTL, SPEC §6.4)
              ("rgpd_purge", job_rgpd_purge)]
WEEKLY_JOBS = [("alerts_digest", job_alerts_weekly_digest), ("seller_weekly", job_seller_weekly)]
MONTHLY_JOBS = []

JOBS_TIMEZONE = PARIS_TZ
# Les tâches quotidiennes / hebdomadaires / mensuelles (e-mails aux utilisateurs) ne partent pas avant 8 h, heure de Paris
JOBS_LOCAL_START_HOUR = 8

def _local_now(now: datetime) -> datetime:
    return now.astimezone(JOBS_TIMEZONE)

def _period_keys(now: datetime) -> dict:
    """Clés de période en heure de Paris (un « jour » commence à minuit à Paris, pas en UTC)"""
    local = _local_now(now)
    iso = local.isocalendar()
    return {"daily": local.strftime("%Y-%m-%d"), "weekly": f"{iso[0]}-W{iso[1]:02d}", "monthly": local.strftime("%Y-%m")}

async def _run_job(name: str, job, now: datetime, result: dict):
    try:
        value = job(now) if _accepts_now(job) else job()
        result[name] = await value
    except Exception as e:
        logger.error(f"Tâche {name} en erreur: {e}")
        if SENTRY_DSN:
            try:
                import sentry_sdk
                sentry_sdk.capture_exception(e)
            except Exception:
                pass
        await db.job_failures.insert_one({"job": name, "error": str(e)[:1000], "at": now.isoformat(), "expire_at": now + timedelta(days=90)})
        result[name] = f"erreur: {e}"

def _accepts_now(job) -> bool:
    import inspect
    try:
        return len(inspect.signature(job).parameters) >= 1
    except (TypeError, ValueError):
        return False

async def run_scheduled_jobs(force: bool = False) -> dict:
    """Toutes les heures : relances du noyau ; une fois par jour / semaine / mois : tâches des modules
    (idempotentes via claim_once). `force=True` (lancement manuel par l'admin) exécute tout immédiatement."""
    now = datetime.now(timezone.utc)
    result = {}
    for name, job in HOURLY_JOBS:
        await _run_job(name, job, now, result)
    keys = _period_keys(now)
    periodic_due = force or _local_now(now).hour >= JOBS_LOCAL_START_HOUR
    for period, jobs in (("daily", DAILY_JOBS), ("weekly", WEEKLY_JOBS), ("monthly", MONTHLY_JOBS)):
        if not periodic_due:
            break
        for name, job in jobs:
            if force or await claim_once(f"{period}_job", f"{name}:{keys[period]}"):
                await _run_job(f"{period}:{name}", job, now, result)
    await db.job_runs.update_one({"_id": "scheduler"},
                                 {"$set": {"last_ok": now.isoformat(), "result": {k: str(v) for k, v in result.items()}}},
                                 upsert=True)
    return result

async def jobs_loop():
    interval = int(os.environ.get("JOBS_INTERVAL_SECONDS", "3600"))
    await asyncio.sleep(60)  # laisser le serveur démarrer
    while True:
        try:
            await run_scheduled_jobs()
        except Exception as e:
            logger.error(f"Boucle des tâches en erreur : {e}")
        await asyncio.sleep(interval)

@api_router.post("/admin/jobs/run")
async def run_jobs_now(current_user: dict = Depends(require_admin)):
    """Admin : lance immédiatement toutes les tâches (horaires, quotidiennes, hebdomadaires, mensuelles)"""
    return await run_scheduled_jobs(force=True)

# ============ MODULES (routeurs inclus après la définition de db / get_current_user / api_router) ============
# Chaque module expose `router = APIRouter()` (chemins relatifs à /api) et, facultatif, daily_job / weekly_job / monthly_job.
# Un module absent est ignoré ; toute autre erreur d'import est propagée (un module cassé ne doit pas passer inaperçu).
LOADED_MODULES = {}
for _module_name in ("events", "estimator", "closing", "bail", "testmode"):
    try:
        _module = importlib.import_module(_module_name)
    except ModuleNotFoundError as e:
        if e.name == _module_name:
            logger.info(f"Module {_module_name} absent : ignoré")
            continue
        raise
    LOADED_MODULES[_module_name] = _module
    if getattr(_module, "router", None) is not None:
        api_router.include_router(_module.router)
    for _period, _jobs in (("daily_job", DAILY_JOBS), ("weekly_job", WEEKLY_JOBS), ("monthly_job", MONTHLY_JOBS)):
        _job = getattr(_module, _period, None)
        if callable(_job):
            _jobs.append((_module_name, _job))

# Include router (après la déclaration de toutes les routes et des modules)
app.include_router(api_router)

@app.on_event("shutdown")
async def shutdown_db_client():
    task = getattr(app.state, "jobs_task", None)
    if task:
        task.cancel()
    client.close()

@app.on_event("startup")
async def startup():
    if os.environ.get("JOBS_ENABLED", "true").lower() != "false":
        app.state.jobs_task = asyncio.create_task(jobs_loop())
    if IS_PRODUCTION and not os.environ.get("SENDER_EMAIL", "").strip():
        logger.warning("SENDER_EMAIL non défini : les e-mails partent de l'adresse par défaut, dont le domaine n'est peut-être pas "
                       "authentifié chez Brevo (SPF/DKIM) — voir DOKPLOY_DEPLOYMENT.md, « Domaine d'envoi Brevo »")
    if IS_PRODUCTION and not s3_enabled():
        logger.warning("S3_BUCKET non défini : les fichiers sont stockés dans MongoDB (10 Mo max) et aucune sauvegarde n'est envoyée hors du serveur")
    if test_mode_enabled():
        logger.warning("MODE TEST ACTIF (TEST_MODE=true) : identité simulable, e-mails capturés dans la boîte de test, documents "
                       "sans valeur juridique, routes /api/test/* ouvertes. Désactiver avant l'ouverture réelle.")
        if IS_PRODUCTION:
            logger.warning("ATTENTION : mode test actif en PRODUCTION. Il affaiblit l'authentification administrateur (codes de "
                           "connexion renvoyés en clair, connexion rapide aux comptes de démonstration). À réserver à un essai "
                           "avant l'ouverture : supprimer ensuite les données de test (POST /api/admin/test/purge) puis TEST_MODE=false.")
    # Create indexes
    await db.job_marks.create_index([("kind", 1), ("key", 1)], unique=True)
    await db.followups.create_index("token", unique=True)
    await db.users.create_index("email", unique=True)
    await db.properties.create_index("seller_id")
    await db.messages.create_index("sender_id")
    await db.messages.create_index("receiver_id")
    await db.email_verifications.create_index("token_hash")
    await db.login_otps.create_index("user_id")
    await db.password_resets.create_index("token_hash")
    # Modules : statistiques, estimateur, étape de vente, factures, « À faire », justificatifs de propriété
    await db.events.create_index([("day", 1), ("name", 1)])
    await db.estimates.create_index("confirm_token_hash")
    await db.estimates.create_index("email")
    await db.ownership_proofs.create_index("property_id")
    await db.properties.create_index("address_key")
    await db.properties.create_index("ownership.status")
    await db.dataroom_access.create_index([("property_id", 1), ("buyer_id", 1)])
    await db.closings.create_index("offer_id", unique=True)
    await db.closings.create_index([("status", 1), ("updated_at", -1)])
    await db.closings.create_index("seller_id")
    await db.closings.create_index("buyer_id")
    await db.invoices.create_index("number", unique=True)
    await db.invoices.create_index("closing_id")
    await db.invoices.create_index([("status", 1), ("due_on", 1)])
    await db.invoices.create_index("debtor.user_id")
    await db.todos.create_index([("type", 1), ("key", 1), ("status", 1)])
    await db.properties.create_index([("moderation.status", 1), ("moderation.review_until", 1)])
    # Purge automatique (RGPD) : index TTL sur un champ date ; les documents sont datés en ISO 8601 (chaîne), on ajoute
    # donc un champ `expire_at` BSON là où c'est utile.
    for coll, seconds in ((db.email_verifications, 7 * 86400), (db.login_otps, 86400), (db.signature_otps, 86400),
                          (db.password_resets, 86400), (db.job_failures, 90 * 86400), (db.events, 0)):
        try:
            await coll.create_index("expire_at", expireAfterSeconds=seconds)
        except Exception as e:  # mongomock n'implémente pas tous les index
            logger.debug(f"Index TTL non créé : {e}")
    
    # Create admin account
    await create_admin_account()
    
    # Create indexes for new collections
    await db.favorites.create_index([("user_id", 1), ("property_id", 1)], unique=True)
    await db.alerts.create_index("user_id")
    await db.public_alerts.create_index("email")
    await db.conversations.create_index([("property_id", 1), ("buyer_id", 1)], unique=True)
    await db.conversations.create_index([("seller_id", 1), ("last_at", -1)])
    await db.conversations.create_index([("buyer_id", 1), ("last_at", -1)])
    await db.messages.create_index([("conversation_id", 1), ("created_at", 1)])
    await db.costs.create_index("month", unique=True)
    await db.nps.create_index([("closing_id", 1), ("user_id", 1)], unique=True)
    await db.dataroom_access_logs.create_index("property_id")
    # Mode test : boîte mail de test (purgée après 30 jours) et marquage des données de test
    await db.test_emails.create_index([("to", 1), ("created_at", -1)])
    for coll in (db.users, db.properties, db.generated_contracts):
        await coll.create_index("is_test", sparse=True)
    try:
        await db.test_emails.create_index("expire_at", expireAfterSeconds=0)
    except Exception as e:  # mongomock n'implémente pas tous les index
        logger.debug(f"Index TTL non créé : {e}")
