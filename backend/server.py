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
    seller_commission_enabled, commission_scale, commission_scale_text, commission_minimum_ht, fmt_eur_fr,
    COMMISSION_TERMS_VERSION, COMMISSION_PAYER,
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
    cédant sont soumis, les accès au dossier du repreneur dont toutes les étapes sont faites sont ouverts."""
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
    company_id: str,
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
        {"company_id": company_id},
        sort=[("sequence", -1)]
    )
    previous_hash = last_log.get("current_hash", "GENESIS") if last_log else "GENESIS"
    sequence = (last_log.get("sequence", 0) + 1) if last_log else 1
    
    timestamp = datetime.now(timezone.utc).isoformat()
    
    # Créer les données à hasher
    data_to_hash = f"{previous_hash}|{action}|{company_id}|{actor_id}|{timestamp}|{sequence}"
    current_hash = hashlib.sha256(data_to_hash.encode()).hexdigest()
    
    audit_entry = {
        "id": str(uuid.uuid4()),
        "sequence": sequence,
        "company_id": company_id,
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
    """Profil de projet du repreneur (SPEC §4.1, API.md §1) : toutes les clés sont facultatives, le score dit ce qui manque"""
    project_type: Optional[Literal["reprise-individuelle", "croissance-externe", "groupe-investisseur", "autre"]] = None
    budget_max: Optional[float] = Field(None, ge=0, le=100_000_000)
    apport: Optional[float] = Field(None, ge=0, le=100_000_000)
    financing: Optional[Literal["fonds-propres", "emprunt", "mixte", "a-definir"]] = None
    zones: Optional[List[str]] = None
    trades: Optional[List[str]] = None
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
    siret: Optional[str] = None
    phone: Optional[str] = None
    buyer_profile: Optional[BuyerProfile] = None
    source: Optional[str] = Field(None, max_length=50)
    acquisition_source: Optional[str] = Field(None, max_length=50)

class ProfileUpdate(BaseModel):
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=30)
    company_name: Optional[str] = Field(None, max_length=200)
    siret: Optional[str] = Field(None, max_length=20)
    buyer_profile: Optional[BuyerProfile] = None
    notifications_opt_out: Optional[bool] = None

# ---- Profil repreneur et score de complétude (SPEC §4.1, API.md §1) ----
PROFILE_SCORE_WEIGHTS = (("project_type", 15), ("budget_max", 15), ("apport", 10), ("financing", 10), ("zones", 10),
                         ("trades", 10), ("horizon", 10), ("phone", 10), ("siren_verified", 10))
SCORE_CONTACT_MIN = 40       # contacter un cédant, demander un dossier
SCORE_AUTO_ACCEPT_MIN = 50   # acceptation automatique d'une demande de dossier (option de l'annonce)
PHONE_DIGITS_RE = re.compile(r"\d")

def phone_is_valid(phone: Optional[str]) -> bool:
    """Format validé, sans OTP SMS : au moins 9 chiffres et seulement des caractères de numéro"""
    if not phone:
        return False
    text = str(phone).strip()
    return bool(re.fullmatch(r"\+?[\d\s().\-]{8,25}", text)) and len(PHONE_DIGITS_RE.findall(text)) >= 9

def buyer_profile_score(user: dict) -> int:
    """0-100 : project_type 15, budget_max 15, apport 10, financing 10, zones 10, trades 10, horizon 10, téléphone 10,
    SIREN vérifié par l'open data 10 (même barème que frontend/src/components/account/profileScore.js)"""
    profile = user.get("buyer_profile") or {}
    score = 0
    for key, points in PROFILE_SCORE_WEIGHTS:
        if key == "phone":
            filled = phone_is_valid(user.get("phone"))
        elif key == "siren_verified":
            filled = profile.get("siren_verified") is True
        else:
            value = profile.get(key)
            if isinstance(value, list):
                filled = len(value) > 0
            elif isinstance(value, (int, float)):
                filled = value > 0
            else:
                filled = bool(str(value or "").strip())
        if filled:
            score += points
    return max(0, min(100, score))

def profile_missing(user: dict) -> list:
    """Clés du profil qui ne rapportent pas encore de points (affichage « ce qui manque »)"""
    profile = user.get("buyer_profile") or {}
    missing = []
    for key, _ in PROFILE_SCORE_WEIGHTS:
        if key == "phone":
            ok = phone_is_valid(user.get("phone"))
        elif key == "siren_verified":
            ok = profile.get("siren_verified") is True
        else:
            v = profile.get(key)
            ok = (len(v) > 0) if isinstance(v, list) else (v > 0 if isinstance(v, (int, float)) else bool(str(v or "").strip()))
        if not ok:
            missing.append(key)
    return missing

async def normalize_buyer_profile(profile: Optional[BuyerProfile], previous: Optional[dict] = None) -> Optional[dict]:
    """Profil validé (zones = régions connues, métiers de la taxonomie) ; le SIREN est vérifié par l'open data
    (`siren_verified`, jamais bloquant : indisponible → non vérifié, revérifiable plus tard)"""
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
    if data.get("trades") is not None:
        data["trades"] = [t for t in dict.fromkeys(data["trades"]) if taxonomy.trade_by_id(t)][:len(taxonomy.TRADES)]
    for key in ("siren", "company_name", "experience"):
        if data.get(key) is not None:
            data[key] = str(data[key]).strip() or None
    if data.get("experience"):
        # Présentée au cédant avant NDA (carte repreneur, e-mail de premier contact) : coordonnées masquées
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
                logging.warning(f"Open data indisponible pour le SIREN du repreneur: {e}")
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

async def seller_siret_lookup(siret: Optional[str]) -> dict:
    """SIRET facultatif du vendeur : préremplissage par l'open data ; « vérification différée » si indisponible"""
    if not siret:
        return {}
    clean = re.sub(r"\D", "", str(siret))
    if not clean:
        return {}
    out = {"siret": clean, "siret_verification": "deferred", "siret_check": None}
    try:
        info = await opendata.lookup_siren(clean)
    except Exception as e:
        logging.warning(f"Open data indisponible pour le SIRET du vendeur: {e}")
        return out
    if not info.get("available"):
        out["siret_check"] = {"status": "deferred", "message": "Vérification différée : le registre national est momentanément indisponible"}
    elif not info.get("found"):
        out["siret_verification"] = "not_found"
        out["siret_check"] = {"status": "not_found", "message": "SIRET introuvable au registre national"}
    else:
        out["siret_verification"] = "verified" if info.get("siren_active", True) else "inactive"
        out["siret_check"] = {"status": out["siret_verification"], "nom_complet": info.get("nom_complet"), "naf": info.get("naf"),
                              "departement": info.get("departement"), "region": info.get("region"), "checked_at": datetime.now(timezone.utc).isoformat()}
        out["company_lookup"] = {k: info.get(k) for k in ("nom_complet", "naf", "naf_libelle", "date_creation", "tranche_effectif",
                                                           "departement", "region", "legal_structure", "etat", "siren_active")}
    return out

def with_profile_score(user: dict) -> dict:
    """Vue d'un compte avec `profile_score` (et `profile_missing` pour un repreneur). Une adresse ou une identité simulée
    en mode test apparaît non vérifiée une fois le mode test désactivé."""
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

class CompanyCreate(BaseModel):
    """Brouillon créé dès l'écran 1 de CreateListing (SPEC §4.2.2) : tout est facultatif, les écrans suivants complètent
    par `PUT /companies/{id}` ; l'annonce n'est soumise (mandat, contrôles, publication) qu'une fois le prix renseigné."""
    rge_types: Optional[List[str]] = Field(default_factory=list)
    rge_validity: Optional[str] = None
    ca_n: Optional[float] = 0
    ca_n1: Optional[float] = 0
    ca_n2: Optional[float] = 0
    margin: Optional[float] = 0
    ebitda: Optional[float] = 0
    mandataire_contracts: Optional[str] = None
    creation_date: Optional[str] = None
    staff_count: Optional[int] = 0
    legal_structure: Optional[str] = None
    pipeline: Optional[float] = 0
    fixed_charges: Optional[Dict[str, float]] = Field(default_factory=dict)
    debt: Optional[float] = 0
    asking_price: Optional[float] = 0
    sale_type: Optional[str] = None
    region: Optional[str] = None
    specialties: Optional[List[str]] = None
    equipment: Optional[str] = None
    premises: Optional[str] = None
    # Nouveaux champs pour la vérification dirigeant
    siret: Optional[str] = None
    company_name: Optional[str] = None
    dirigeant_verified: Optional[bool] = False
    dirigeant_status: Optional[str] = "not_checked"
    # Tout le bâtiment (SPEC §2.2) : métiers, qualifications déclarées, département, cession
    trades: Optional[List[str]] = None
    other_qualifications: Optional[List[str]] = None
    department: Optional[str] = None
    description: Optional[str] = None
    sale_reason: Optional[Literal["retraite", "reconversion", "sante", "autre"]] = None
    sale_object: Optional[Literal["titres", "fonds", "indifferent"]] = None
    handover_months: Optional[int] = Field(default=None, ge=0, le=24)
    has_maintenance_contracts: Optional[bool] = None
    technical_referent_stays: Optional[bool] = None
    key_staff_stays: Optional[bool] = None
    decennale_ok: Optional[bool] = None
    auto_accept_dataroom: Optional[bool] = None

def validate_listing_fields(data: dict) -> dict:
    """Validation des référentiels (taxonomy) sur les champs envoyés : ValueError → 400 en français.
    `rge_types` absent de `trades` → métiers déduits des domaines RGE (migration douce)."""
    out = dict(data)
    if out.get("trades") is not None:
        try:
            out["trades"] = taxonomy.validate_trades(out["trades"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if out.get("other_qualifications") is not None:
        try:
            out["other_qualifications"] = taxonomy.validate_other_qualifications(out["other_qualifications"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if out.get("department") is not None and out["department"] != "":
        code = taxonomy.normalize_departement(out["department"])
        if not code:
            # Nom de département (« Finistère », « finistere ») toléré
            wanted = taxonomy.slugify(out["department"])
            code = next((c for c, name in taxonomy.DEPARTEMENTS.items() if taxonomy.slugify(name) == wanted), "")
        if not code:
            raise HTTPException(status_code=400, detail="Département inconnu")
        out["department"] = code
    # Textes libres publiés sur l'annonce anonyme : téléphones et e-mails masqués (SPEC §4.2 « contrôle anti-coordonnées »)
    for key in LISTING_FREE_TEXT_FIELDS:
        if isinstance(out.get(key), str):
            out[key] = mask_contacts(out[key])[0]
    if out.get("description") is not None:
        text = out["description"].strip()
        if text and not (200 <= len(text) <= 1500):
            raise HTTPException(status_code=400, detail="La description doit faire entre 200 et 1 500 caractères")
        out["description"] = text
    return out

LISTING_FREE_TEXT_FIELDS = ("description", "equipment", "premises", "mandataire_contracts")

class MessageCreate(BaseModel):
    conversation_id: Optional[str] = None
    content: str = Field(..., max_length=5000)
    # Forme historique : destinataire + annonce (la conversation du couple est retrouvée ou créée)
    receiver_id: Optional[str] = None
    company_id: Optional[str] = None

class CompanySearch(BaseModel):
    rge_types: Optional[List[str]] = None
    trades: Optional[List[str]] = None
    region: Optional[str] = None
    department: Optional[str] = None
    rge: Optional[bool] = None
    min_ca: Optional[float] = None
    max_ca: Optional[float] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    min_staff: Optional[int] = None
    sort: Optional[str] = None
    limit: Optional[int] = None
    page: Optional[int] = None

# ============ STRIPE IDENTITY KYC VERIFICATION ============
KYC_BUYER_STATUSES = ("accepted", "granted")

async def identity_needed_now(user: dict) -> bool:
    """Stripe Identity est facturé à l'usage (SPEC §0.2, §0.6) : la vérification n'est ouverte qu'au moment où elle est
    exigée. Cédant : dès qu'il a une annonce (brouillon compris) ou une invitation de président en attente, pour signer
    le mandat. Repreneur : quand une demande de dossier a été acceptée par le cédant (identité exigée au NDA)."""
    role = user.get("role")
    if role == "seller":
        if await db.companies.find_one({"$or": [{"seller_id": user["id"]}, {"president_id": user["id"]}],
                                        "status": {"$nin": ["sold", "sold_elsewhere", "removed"]}}, {"_id": 0, "id": 1}):
            return True
        return bool(user.get("email") and await db.president_invitations.find_one(
            {"president_email": user["email"], "status": "pending"}, {"_id": 0, "id": 1}))
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
    (cédant : mandat ; repreneur : NDA, après acceptation d'une demande de dossier). 3 sessions par heure et par adresse IP.
    """
    if is_user_verified(current_user):
        raise api_error(409, "already_verified", "Votre identité est déjà vérifiée")
    if not await identity_needed_now(current_user):
        raise api_error(403, "identity_not_needed_yet",
                        "La vérification d'identité est demandée à la signature du mandat (cédant) ou de l'accord de "
                        "confidentialité (repreneur, après acceptation de votre demande de dossier)")
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
        "siret": None,
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
    elif user.siret:
        # SIRET facultatif : préremplissage par l'open data, « vérification différée » si indisponible (jamais bloquant)
        lookup = await seller_siret_lookup(user.siret)
        user_doc.update(lookup)
        if not user_doc.get("company_name") and (lookup.get("company_lookup") or {}).get("nom_complet"):
            user_doc["company_name"] = lookup["company_lookup"]["nom_complet"]
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
    """Coordonnées, SIRET (vendeur), profil de projet (repreneur, score recalculé) et préférence de notifications.
    `siret: ''` efface le SIRET."""
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
    if data.siret is not None:
        if data.siret.strip():
            update.update(await seller_siret_lookup(data.siret))
        else:
            update.update({"siret": None, "siret_verification": None, "siret_check": None, "company_lookup": None})
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
    # Annonces du cédant retirées (jamais supprimées : le mandat y est rattaché)
    await db.companies.update_many({"$or": [{"seller_id": uid}, {"president_id": uid}], "status": {"$nin": ["sold", "archived", "removed"]}},
                                   {"$set": {"status": "archived", "archived_reason": reason, "updated_at": now}})
    await db.companies.update_many({"seller_id": uid}, {"$set": {"seller_email": anonymous_email}})
    # Coordonnées répliquées dans les autres collections
    await db.messages.update_many({"sender_id": uid}, {"$set": {"sender_email": anonymous_email}, "$unset": {"content_original": ""}})
    await db.offers.update_many({"buyer_id": uid}, {"$set": {"buyer_email": anonymous_email}})
    await db.dataroom_access.update_many({"buyer_id": uid}, {"$set": {"buyer_email": anonymous_email}})
    await db.documents.update_many({"signer_id": uid}, {"$set": {"signer_email": anonymous_email}})
    await db.generated_contracts.update_many({"signed_by": original_email}, {"$set": {"signed_by": anonymous_email}})
    await db.companies.update_many({"$or": [{"president_id": uid}, {"president_email": original_email}]},
                                   {"$set": {"president_email": anonymous_email},
                                    "$unset": {"president_firstname": "", "president_lastname": "", "president_phone": ""}})
    await db.president_invitations.update_many({"president_email": original_email},
                                               {"$set": {"president_email": anonymous_email},
                                                "$unset": {"president_firstname": "", "president_lastname": "", "president_phone": ""}})
    await db.president_invitations.update_many({"invited_by_email": original_email}, {"$set": {"invited_by_email": anonymous_email}})
    # Journaux (la chaîne d'empreintes d'audit ne porte pas l'adresse e-mail : elle reste vérifiable)
    await db.audit_logs.update_many({"actor_email": original_email}, {"$set": {"actor_email": anonymous_email}})
    await db.audit_logs.update_many({"target_email": original_email}, {"$set": {"target_email": anonymous_email}})
    await db.dataroom_access_logs.update_many({"viewer_email": original_email}, {"$set": {"viewer_email": anonymous_email}})
    await db.commercial_info_requests.update_many({"buyer_id": uid}, {"$set": {"buyer_email": anonymous_email}})
    # Factures conservées (obligation comptable : nom et adresse du débiteur) ; l'e-mail n'y est pas nécessaire
    await db.invoices.update_many({"debtor.user_id": uid}, {"$set": {"debtor.email": anonymous_email}})
    await db.newsletter_subscribers.delete_many({"email": original_email})
    # Boîte mail de test (mode test) : jamais servie au futur titulaire de l'adresse
    await db.test_emails.delete_many({"to": original_email.lower()})
    # Données sans valeur contractuelle : supprimées
    for coll in (db.alerts, db.favorites, *(() if keep_identity_report else (db.kyc_sessions,)), db.signature_otps, db.login_otps,
                 db.email_verifications, db.password_resets, db.dirigeant_verifications):
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
    (obligations légales) avec le même user_id. Les annonces du cédant sont retirées."""
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
    companies = []
    for company in await rows(db.companies, {"$or": [{"seller_id": uid}, {"president_id": uid}]}):
        if company.get("seller_id") != uid:
            for field in ("mandant_address", "mandant_capacity"):
                company.pop(field, None)
        companies.append(strip_foreign_contacts(company, own))
    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": {k: v for k, v in current_user.items() if k not in ("password_hash",)},
        "companies": companies,
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

# ============ RGE VERIFICATION ============
# Proxys publics vers l'open data (ADEME, recherche-entreprises) : quotas tiers partagés par tous les utilisateurs
# (une IP qui boucle ferait répondre 429 aux vrais contrôles d'annonce) → limite par adresse IP et cache mémoire
OPENDATA_RATE_LIMIT = "30/minute"
RGE_VERIFY_CACHE_SECONDS = 24 * 3600
_rge_verify_cache: Dict[str, tuple] = {}

def clean_siret_param(siret: str) -> str:
    digits = re.sub(r"\D", "", siret or "")
    if len(digits) != 14:
        raise HTTPException(status_code=400, detail="SIRET invalide (14 chiffres requis)")
    return digits

@api_router.get("/rge/verify/{siret}")
@limiter.limit(OPENDATA_RATE_LIMIT)
async def verify_rge_route(request: Request, siret: str):
    """Vérifie si une entreprise possède la certification RGE par SIRET (réponse gardée 24 h en mémoire)"""
    siret = clean_siret_param(siret)
    now = datetime.now(timezone.utc).timestamp()
    cached = _rge_verify_cache.get(siret)
    if cached and cached[0] > now:
        return cached[1]
    result = await verify_rge(siret)
    if isinstance(result, dict) and not result.get("error"):
        if len(_rge_verify_cache) > 5000:
            _rge_verify_cache.clear()
        _rge_verify_cache[siret] = (now + RGE_VERIFY_CACHE_SECONDS, result)
    return result

async def verify_rge(siret: str):
    """
    Vérifie si une entreprise possède la certification RGE par SIRET
    """
    try:
        # Option 1 : API Data Fair ADEME (gratuite, publique)
        # Utilise 'q' pour la recherche full-text du SIRET
        response = await asyncio.to_thread(requests.get, 
            f"https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines",
            params={"q": siret, "size": 5},
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get("total", 0) > 0:
                # Filtrer les résultats pour trouver le SIRET exact
                for result in data.get("results", []):
                    if result.get("siret") == siret:
                        return {
                            "verified": True,
                            "siret": result.get("siret"),
                            "nom_entreprise": result.get("nom_entreprise", ""),
                            "code_postal": result.get("code_postal"),
                            "commune": result.get("commune"),
                            "adresse": result.get("adresse"),
                            "telephone": result.get("telephone"),
                            "email": result.get("email"),
                            "domaine": result.get("domaine", ""),
                            "meta_domaine": result.get("meta_domaine", ""),
                            "nom_qualification": result.get("nom_qualification", ""),
                            "organisme": result.get("organisme"),
                            "date_debut_validite": result.get("lien_date_debut"),
                            "date_fin_validite": result.get("lien_date_fin"),
                            "data_source": "ADEME Data Fair API"
                        }
        
        # Si pas trouvé dans le nouveau dataset, essayer l'ancien
        response_old = await asyncio.to_thread(requests.get, 
            f"https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-1/lines",
            params={"q": siret, "size": 5},
            timeout=10
        )
        
        if response_old.status_code == 200:
            data_old = response_old.json()
            if data_old.get("total", 0) > 0:
                for result in data_old.get("results", []):
                    if result.get("siret") == siret:
                        return {
                            "verified": True,
                            "siret": result.get("siret"),
                            "nom_entreprise": result.get("nom_entreprise", result.get("nom", "")),
                            "data": result,
                            "data_source": "ADEME Data Fair (legacy)"
                        }
        
        return {
            "verified": False, 
            "message": "SIRET non trouvé dans la base RGE",
            "siret_recherche": siret,
            "info": "Vérifiez que le SIRET est correct (14 chiffres) et que l'entreprise possède bien une certification RGE valide"
        }
        
    except requests.Timeout:
        return {
            "verified": False, 
            "message": "Timeout lors de la vérification RGE",
            "error": "API ADEME non disponible"
        }
    except Exception as e:
        return {
            "verified": False, 
            "message": f"Erreur lors de la vérification: {str(e)}",
            "error": str(e)
        }

@api_router.get("/rge/search")
@limiter.limit(OPENDATA_RATE_LIMIT)
async def search_rge(request: Request, q: str, limit: int = 10):
    """
    Recherche d'entreprises RGE par nom ou SIRET
    Utilise une recherche par nom exact puis full-text pour de meilleurs résultats
    """
    q = (q or "").strip()[:100]
    if len(q) < 3:
        raise HTTPException(status_code=400, detail="Saisissez au moins 3 caractères")
    limit = max(1, min(int(limit or 10), 20))
    try:
        all_results = []
        seen_sirets = set()
        
        # Recherche 1: Par nom exact (meilleurs résultats pour les noms d'entreprise)
        response_exact = await asyncio.to_thread(requests.get, 
            f"https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines",
            params={"nom_entreprise_in": q.upper(), "size": limit},
            timeout=10
        )
        
        if response_exact.status_code == 200:
            data_exact = response_exact.json()
            for result in data_exact.get("results", []):
                siret = result.get("siret")
                if siret and siret not in seen_sirets:
                    seen_sirets.add(siret)
                    all_results.append({
                        "siret": siret,
                        "nom_entreprise": result.get("nom_entreprise", ""),
                        "code_postal": result.get("code_postal"),
                        "commune": result.get("commune"),
                        "adresse": result.get("adresse"),
                        "telephone": result.get("telephone"),
                        "email": result.get("email"),
                        "domaine": result.get("domaine", ""),
                        "meta_domaine": result.get("meta_domaine", ""),
                        "nom_qualification": result.get("nom_qualification", ""),
                        "organisme": result.get("organisme"),
                        "date_debut_validite": result.get("lien_date_debut"),
                        "date_fin_validite": result.get("lien_date_fin"),
                    })
        
        # Recherche 2: Full-text si pas assez de résultats
        if len(all_results) < limit:
            response_ft = await asyncio.to_thread(requests.get, 
                f"https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines",
                params={"q": q, "size": limit},
                timeout=10
            )
            
            if response_ft.status_code == 200:
                data_ft = response_ft.json()
                for result in data_ft.get("results", []):
                    siret = result.get("siret")
                    if siret and siret not in seen_sirets:
                        seen_sirets.add(siret)
                        all_results.append({
                            "siret": siret,
                            "nom_entreprise": result.get("nom_entreprise", ""),
                            "code_postal": result.get("code_postal"),
                            "commune": result.get("commune"),
                            "adresse": result.get("adresse"),
                            "telephone": result.get("telephone"),
                            "email": result.get("email"),
                            "domaine": result.get("domaine", ""),
                            "meta_domaine": result.get("meta_domaine", ""),
                            "nom_qualification": result.get("nom_qualification", ""),
                            "organisme": result.get("organisme"),
                            "date_debut_validite": result.get("lien_date_debut"),
                            "date_fin_validite": result.get("lien_date_fin"),
                        })
        
        return {
            "total": len(all_results),
            "results": all_results[:limit],
            "query": q
        }
        
    except Exception as e:
        return {
            "total": 0,
            "results": [],
            "error": str(e)
        }

@api_router.get("/rge/categories")
async def get_rge_categories():
    """
    Retourne la liste des catégories/domaines RGE disponibles
    """
    return {
        "categories": [
            {"id": "isolation_interieur", "label": "Isolation par l'intérieur", "domaine": "Isolation par l'intérieur des murs ou rampants de toitures ou plafonds"},
            {"id": "isolation_exterieur", "label": "Isolation par l'extérieur", "domaine": "Isolation des murs par l'extérieur"},
            {"id": "isolation_toiture", "label": "Isolation toiture/terrasse", "domaine": "Isolation des toitures terrasses ou des toitures par l'extérieur"},
            {"id": "isolation_combles", "label": "Isolation combles perdus", "domaine": "Isolation des combles perdus ou des rampants de toiture"},
            {"id": "isolation_plancher", "label": "Isolation plancher bas", "domaine": "Isolation du plancher de combles perdus ou du plancher bas"},
            {"id": "menuiserie", "label": "Menuiseries extérieures", "domaine": "Fenêtres, volets, portes donnant sur l'extérieur"},
            {"id": "chauffage_bois", "label": "Chauffage au bois", "domaine": "Appareil indépendant de chauffage au bois"},
            {"id": "chauffage_gaz", "label": "Chaudière gaz/fioul", "domaine": "Chaudière condensation ou micro-cogénération gaz ou fioul"},
            {"id": "pac_chauffage", "label": "Pompe à chaleur chauffage", "domaine": "Pompe à chaleur air/eau ou eau/eau"},
            {"id": "pac_ecs", "label": "Chauffe-eau thermodynamique", "domaine": "Chauffe-eau thermodynamique"},
            {"id": "solaire_thermique", "label": "Solaire thermique", "domaine": "Capteurs solaires thermiques"},
            {"id": "photovoltaique", "label": "Photovoltaïque", "domaine": "Panneaux photovoltaïques"},
            {"id": "ventilation", "label": "Ventilation", "domaine": "Ventilation mécanique contrôlée"},
            {"id": "audit_energetique", "label": "Audit énergétique", "domaine": "Audit énergétique"},
        ]
    }

@api_router.get("/rge/company/{siret}/qualifications")
@limiter.limit(OPENDATA_RATE_LIMIT)
async def get_company_qualifications_route(request: Request, siret: str):
    """Qualifications RGE d'une entreprise (page publique « Vérifier une entreprise RGE »)"""
    return await get_company_qualifications(clean_siret_param(siret))

async def get_company_qualifications(siret: str):
    """
    Récupère toutes les qualifications RGE d'une entreprise par son SIRET
    """
    try:
        response = await asyncio.to_thread(requests.get, 
            f"https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines",
            params={"siret_eq": siret, "size": 50},
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get("total", 0) > 0:
                results = data.get("results", [])
                company_info = {
                    "siret": siret,
                    "nom_entreprise": results[0].get("nom_entreprise", "") if results else "",
                    "code_postal": results[0].get("code_postal") if results else None,
                    "commune": results[0].get("commune") if results else None,
                    "adresse": results[0].get("adresse") if results else None,
                    "telephone": results[0].get("telephone") if results else None,
                    "email": results[0].get("email") if results else None,
                }
                
                # Extraire tous les domaines uniques
                domaines = list(set(r.get("domaine", "") for r in results if r.get("domaine")))
                qualifications = list(set(r.get("nom_qualification", "") for r in results if r.get("nom_qualification")))
                organismes = list(set(r.get("organisme", "") for r in results if r.get("organisme")))
                # Détail par qualification (dates de validité, organisme exact) : lu par transmissibility.normalize_ademe
                details, seen = [], set()
                for r in results:
                    key = (r.get("nom_qualification"), r.get("organisme"), r.get("domaine"), r.get("lien_date_fin"))
                    if key in seen:
                        continue
                    seen.add(key)
                    details.append({"nom_qualification": r.get("nom_qualification", ""), "organisme": r.get("organisme", ""),
                                    "domaine": r.get("domaine", ""), "meta_domaine": r.get("meta_domaine", ""),
                                    "lien_date_debut": r.get("lien_date_debut"), "lien_date_fin": r.get("lien_date_fin"),
                                    "nom_certificat": r.get("nom_certificat", ""), "url_qualification": r.get("url_qualification", "")})

                return {
                    "found": True,
                    "company": company_info,
                    "domaines": domaines,
                    "qualifications": qualifications,
                    "organismes": organismes,
                    "details": details,
                    "total_certifications": data.get("total", 0)
                }
        
        return {
            "found": False,
            "message": "Entreprise non trouvée dans la base RGE"
        }
        
    except Exception as e:
        return {
            "found": False,
            "error": str(e)
        }

# ============ INPI/RNE - VÉRIFICATION DIRIGEANTS ============

# Cache pour le token INPI (évite de se reconnecter à chaque requête)
INPI_TOKEN_CACHE = {"token": None, "expires_at": None}

async def get_inpi_token():
    """
    Obtient un token JWT pour l'API INPI/RNE.
    Utilise les identifiants stockés en variables d'environnement.
    """
    # Vérifier si le token en cache est encore valide
    if INPI_TOKEN_CACHE["token"] and INPI_TOKEN_CACHE["expires_at"]:
        if datetime.now(timezone.utc) < INPI_TOKEN_CACHE["expires_at"]:
            return INPI_TOKEN_CACHE["token"]
    
    username = os.environ.get("INPI_USERNAME", "")
    password = os.environ.get("INPI_PASSWORD", "")
    
    if not username or not password:
        return None
    
    try:
        response = await asyncio.to_thread(requests.post, 
            "https://registre-national-entreprises.inpi.fr/api/sso/login",
            json={"username": username, "password": password},
            timeout=10
        )
        
        if response.status_code == 200:
            token = response.json().get("token")
            # Token valide pendant 1 heure (avec marge de sécurité de 50 minutes)
            INPI_TOKEN_CACHE["token"] = token
            INPI_TOKEN_CACHE["expires_at"] = datetime.now(timezone.utc) + timedelta(minutes=50)
            return token
    except Exception as e:
        logging.error(f"Erreur authentification INPI: {e}")
    
    return None

def _dirigeant_legacy(d: dict) -> dict:
    """Forme attendue par DirigeantVerification.jsx (nom_complet, prenom, nom, qualite) à partir d'un dirigeant opendata"""
    if not d:
        return None
    if d.get("type") == "personne morale" or d.get("type_personne") == "morale":
        denomination = d.get("denomination") or d.get("nom") or ""
        return {"nom": denomination, "prenom": "", "nom_complet": denomination, "qualite": d.get("qualite") or "Dirigeant",
                "siren_pm": d.get("siren") or d.get("siren_pm"), "type_personne": "morale"}
    prenoms = d.get("prenoms") or d.get("prenoms_complets") or d.get("prenom") or ""
    prenom = (prenoms.split() or [""])[0]
    nom = d.get("nom") or ""
    return {"nom": nom, "prenom": prenom, "prenoms_complets": prenoms, "nom_complet": f"{prenom} {nom}".strip(),
            "qualite": d.get("qualite") or "Dirigeant", "annee_naissance": d.get("annee_de_naissance") or d.get("annee_naissance"),
            "type_personne": "physique"}

async def _inpi_dirigeants(siren_clean: str) -> Optional[dict]:
    """Second choix : API INPI/RNE (uniquement si INPI_USERNAME est configuré). Même forme de réponse que
    get_company_dirigeants, `source` = INPI_RNE ; None si indisponible."""
    token = await get_inpi_token()
    if not token:
        return None
    try:
        response = await asyncio.to_thread(requests.get,
            f"https://registre-national-entreprises.inpi.fr/api/companies/{siren_clean}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15
        )
        if response.status_code != 200:
            return None
        data = response.json()
        company_info = {
            "siren": siren_clean,
            "denomination": data.get("companyName") or data.get("denomination"),
            "forme_juridique": data.get("legalForm") or data.get("formeJuridique"),
            "date_creation": data.get("creationDate") or data.get("dateCreation"),
        }
        dirigeants = []
        for rep in data.get("representatives", []) or data.get("dirigeants", []):
            first = rep.get("firstName") or rep.get("prenom", "")
            last = rep.get("lastName") or rep.get("nom", "")
            dirigeants.append({
                "type": "personne physique" if first else "personne morale",
                "nom": last, "prenoms": first, "denomination": last if not first else None,
                "qualite": rep.get("role") or rep.get("qualite") or rep.get("fonction", "Dirigeant"),
                "date_debut": rep.get("startDate") or rep.get("dateDebut"),
            })
        if not dirigeants:
            return None
        legacy = [_dirigeant_legacy(d) for d in dirigeants]
        return {"found": True, "available": True, "source": "INPI_RNE", "company": company_info, "dirigeants": dirigeants,
                "dirigeants_legacy": legacy,
                "president": next((d for d in legacy if "président" in d.get("qualite", "").lower()), legacy[0])}
    except Exception as e:
        logging.warning(f"Erreur API INPI: {e}")
        return None

@api_router.get("/company/{siren}/dirigeants")
@limiter.limit(OPENDATA_RATE_LIMIT)
async def get_company_dirigeants(request: Request, siren: str):
    """
    Dirigeants d'une entreprise d'après le registre national (recherche-entreprises, gratuit, sans clé).
    INPI/RNE en second choix uniquement si l'open data est indisponible et si INPI_USERNAME est configuré.
    """
    siren_clean = siren.replace(" ", "")[:9]
    if len(siren_clean) != 9 or not siren_clean.isdigit():
        raise HTTPException(status_code=400, detail="SIREN invalide (9 chiffres requis)")
    company = await opendata.lookup_siren(siren_clean)
    if company.get("found"):
        dirigeants = [_dirigeant_legacy(d) for d in company.get("dirigeants") or []]
        president = next((d for d in dirigeants if any(q in d["qualite"].lower() for q in ("président", "gérant", "directeur général"))),
                         dirigeants[0] if dirigeants else None)
        return {"found": True, "available": True, "source": "API_GOUV_ENTREPRISES",
                "company": {"siren": company["siren"], "denomination": company.get("nom_complet"),
                            "forme_juridique": company.get("forme_juridique"), "date_creation": company.get("date_creation"),
                            "siege": company.get("adresse"), "code_postal": company.get("code_postal"),
                            "commune": company.get("commune"), "departement": company.get("departement"),
                            "naf": company.get("naf"), "etat": company.get("etat")},
                "dirigeants": dirigeants, "president": president}
    if not company.get("available") and os.environ.get("INPI_USERNAME"):
        inpi = await _inpi_dirigeants(siren_clean)
        if inpi:
            return {**inpi, "dirigeants": inpi["dirigeants_legacy"]}
    return {"found": False, "available": company.get("available", False), "source": None,
            "message": company.get("message") or "Impossible de récupérer les informations de l'entreprise"}

@api_router.post("/company/{siren}/verify-dirigeant")
async def verify_user_is_dirigeant(
    siren: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Vérifie si l'utilisateur connecté correspond à un dirigeant de l'entreprise (registre national des entreprises).
    Compare le nom certifié (Stripe Identity) s'il existe, sinon le nom déclaré.
    """
    # Nom certifié par Stripe Identity en priorité, sinon nom déclaré à l'inscription
    identity_source = "verified_identity" if current_user.get("verified_last_name") else "declared"
    user_firstname = (current_user.get("verified_first_name") or current_user.get("first_name") or "").lower().strip()
    user_lastname = (current_user.get("verified_last_name") or current_user.get("last_name") or "").lower().strip()
    user_fullname = f"{user_firstname} {user_lastname}".strip()
    
    siren_clean = siren.replace(" ", "")[:9]
    if not siren_clean.isdigit() or len(siren_clean) != 9:
        raise HTTPException(status_code=400, detail="SIREN invalide")
    if not user_fullname:
        return {
            "verified": False,
            "status": "unavailable",
            "reason": "missing_identity",
            "message": "Votre nom n'est pas renseigné : complétez votre vérification d'identité",
            "can_invite_president": True
        }
    result = await _match_dirigeant(siren_clean, user_firstname, user_lastname, user_fullname)
    # Résultat conservé côté serveur : le client ne peut pas se déclarer « dirigeant vérifié »
    await db.dirigeant_verifications.update_one(
        {"user_id": current_user["id"], "siren": siren_clean},
        {"$set": {
            "user_id": current_user["id"],
            "siren": siren_clean,
            "verified": bool(result.get("verified")),
            "status": result.get("status"),
            "reason": result.get("reason"),
            "identity_source": identity_source,
            "checked_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    result["identity_source"] = identity_source
    return result

async def _match_dirigeant(siren_clean: str, user_firstname: str, user_lastname: str, user_fullname: str) -> dict:
    """Comparaison « prénom nom » avec les dirigeants du registre (opendata.match_dirigeant) ; INPI en second choix
    seulement si l'open data n'a rien donné d'exploitable et si INPI_USERNAME est défini."""
    r = await opendata.match_dirigeant(siren_clean, user_firstname, user_lastname)
    if (r["status"] == "unavailable" and r.get("reason") in ("api_unavailable", "no_dirigeants_data")
            and os.environ.get("INPI_USERNAME")):
        inpi = await _inpi_dirigeants(siren_clean)
        if inpi and inpi.get("dirigeants"):
            status, d = opendata.match_in_list(inpi["dirigeants"], user_firstname, user_lastname)
            r = {**r, "status": status, "verified": status != "no_match", "dirigeant": d, "source": "INPI_RNE",
                 "reason": None if status != "no_match" else "name_mismatch", "dirigeants": inpi["dirigeants"],
                 "matched_as": (d or {}).get("qualite") or "Dirigeant" if d else None,
                 "message": ("Dirigeant confirmé par le registre INPI" if status != "no_match"
                             else "Vous n'apparaissez pas comme dirigeant de cette société au registre national")}
    president = next((d for d in r.get("dirigeants") or [] if d.get("type") == "personne physique"), None)
    return {"verified": bool(r.get("verified")), "status": r["status"], "reason": r.get("reason"), "message": r.get("message"),
            "matched_as": r.get("matched_as"), "dirigeant": _dirigeant_legacy(r["dirigeant"]) if r.get("dirigeant") else None,
            "president": _dirigeant_legacy(president) if president else None, "company": r.get("company"),
            "has_personne_morale": r.get("has_personne_morale", False), "source": r.get("source"),
            "can_invite_president": r["status"] != "match_exact"}


# ============ INVITATION PRÉSIDENT ============

class PresidentInvitation(BaseModel):
    company_id: str
    president_firstname: str = Field(..., min_length=1, max_length=100)
    president_lastname: str = Field(..., min_length=1, max_length=100)
    president_email: EmailStr
    president_phone: Optional[str] = Field(None, max_length=30)
    message: Optional[str] = Field(None, max_length=1000)

# Invitations du président : au plus 3 par annonce et 10 par compte sur 24 h (en plus de la limite par adresse IP)
PRESIDENT_INVITES_PER_COMPANY_PER_DAY = 3
PRESIDENT_INVITES_PER_USER_PER_DAY = 10

@api_router.post("/listings/{company_id}/invite-president")
@limiter.limit("5/hour")
async def invite_president(
    request: Request,
    company_id: str,
    invitation: PresidentInvitation,
    current_user: dict = Depends(get_current_user)
):
    """
    Invite le président de l'entreprise à valider l'annonce.
    Envoie un email avec un lien d'authentification.
    """
    # E-mail envoyé à une adresse tierce depuis l'expéditeur de la plateforme : adresse confirmée et volume borné
    require_verified_email(current_user)
    # Vérifier que l'annonce existe et appartient à l'utilisateur
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Annonce non trouvée")
    
    if company["seller_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Vous n'êtes pas autorisé à modifier cette annonce")
    
    if invitation.president_email.strip().lower() == current_user["email"].strip().lower():
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous inviter vous-même comme président")

    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    if (await db.president_invitations.count_documents({"company_id": company_id, "created_at": {"$gte": since}})
            >= PRESIDENT_INVITES_PER_COMPANY_PER_DAY
            or await db.president_invitations.count_documents({"invited_by": current_user["id"], "created_at": {"$gte": since}})
            >= PRESIDENT_INVITES_PER_USER_PER_DAY):
        raise HTTPException(status_code=429, detail="Trop d'invitations envoyées aujourd'hui. Réessayez demain.")
    # Une seule invitation en attente par annonce : la précédente est remplacée
    await db.president_invitations.update_many({"company_id": company_id, "status": "pending"},
                                               {"$set": {"status": "replaced"}})
    
    # Générer un token d'invitation unique
    invitation_token = str(uuid.uuid4())
    invitation_expires = datetime.now(timezone.utc) + timedelta(days=30)
    
    # Sauvegarder l'invitation
    invitation_doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "invited_by": current_user["id"],
        "invited_by_email": current_user["email"],
        "president_firstname": invitation.president_firstname,
        "president_lastname": invitation.president_lastname,
        "president_email": invitation.president_email,
        "president_phone": invitation.president_phone,
        "token": invitation_token,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": invitation_expires.isoformat(),
        "message": invitation.message
    }
    
    await db.president_invitations.insert_one(invitation_doc)
    
    # Mettre à jour l'annonce avec le statut d'invitation
    await db.companies.update_one(
        {"id": company_id},
        {"$set": {
            "president_invitation_pending": True,
            "president_invitation_id": invitation_doc["id"],
            "president_email": invitation.president_email,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Envoyer l'email d'invitation
    invitation_link = site_url(f"/president/accept/{invitation_token}")
    
    # Toutes les valeurs saisies sont échappées (aucun HTML ni lien injecté dans un e-mail envoyé par la plateforme)
    sender_name = html_escape(current_user.get('first_name') or 'Expéditeur')
    message_part = ""
    if invitation.message:
        message_part = f'<p><strong>Message de {sender_name}:</strong> {html_escape(invitation.message)}</p>'
    president_name = html_escape(f"{invitation.president_firstname.strip()} {invitation.president_lastname.strip()}")
    inviter = html_escape(f"{current_user.get('first_name') or ''} {current_user.get('last_name') or ''}".strip())
    
    email_content = f"""
    <h2>Invitation à valider une annonce de cession</h2>
    <p>Bonjour {president_name},</p>
    <p>{inviter} ({html_escape(current_user['email'])}) souhaite publier une annonce de cession pour votre entreprise sur {html_escape(site_name())}.</p>
    <p>En tant que président/dirigeant de l'entreprise, votre validation est requise pour mettre l'annonce en ligne.</p>
    {message_part}
    <p><a href="{invitation_link}" style="display:inline-block;padding:12px 24px;background:#090e1c;color:white;text-decoration:none;border-radius:8px;">Voir et valider l'annonce</a></p>
    <p>Ce lien est valable 30 jours.</p>
    <p>Si vous n'êtes pas concerné par cette demande, vous pouvez ignorer cet email.</p>
    <p>Cordialement,<br>L'équipe {site_name()}</p>
    """
    
    try:
        await send_brevo_email(
            to_email=invitation.president_email,
            to_name=re.sub(r"[<>\"]", "", f"{invitation.president_firstname} {invitation.president_lastname}")[:120],
            subject="Validation requise - Annonce de cession d'entreprise RGE",
            html_content=email_content
        )
    except Exception as e:
        logging.error(f"Erreur envoi email invitation: {e}")
    
    return {
        "success": True,
        "message": f"Invitation envoyée à {invitation.president_email}",
        "invitation_id": invitation_doc["id"],
        "expires_at": invitation_expires.isoformat()
    }

@api_router.get("/president/invitation/{token}")
async def get_president_invitation(token: str):
    """
    Récupère les détails d'une invitation pour le président.
    """
    invitation = await db.president_invitations.find_one({"token": token})
    
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation non trouvée ou expirée")
    
    # Vérifier l'expiration
    expires_at = datetime.fromisoformat(invitation["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=410, detail="Cette invitation a expiré")
    
    # Récupérer l'annonce
    company = await db.companies.find_one({"id": invitation["company_id"]})
    
    return {
        "invitation": {
            "id": invitation["id"],
            "president_firstname": invitation["president_firstname"],
            "president_lastname": invitation["president_lastname"],
            "president_email": invitation["president_email"],
            "invited_by_email": invitation["invited_by_email"],
            "status": invitation["status"],
            "message": invitation.get("message"),
            "created_at": invitation["created_at"],
            "expires_at": invitation["expires_at"]
        },
        "company": {
            "id": company["id"] if company else None,
            "rge_types": company.get("rge_types", []) if company else [],
            "region": company.get("region") if company else None,
            "asking_price": company.get("asking_price") if company else None,
            "staff_count": company.get("staff_count") if company else None
        } if company else None
    }

@api_router.post("/president/accept/{token}")
async def accept_president_invitation(
    token: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Le président accepte l'invitation et devient co-propriétaire de l'annonce.
    Il doit d'abord créer un compte et vérifier son identité.
    """
    invitation = await db.president_invitations.find_one({"token": token})
    
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation non trouvée")
    
    if invitation["status"] == "accepted":
        raise HTTPException(status_code=400, detail="Cette invitation a déjà été acceptée")
    if invitation["status"] != "pending":
        raise HTTPException(status_code=400, detail="Cette invitation n'est plus valide")
    expires_at = invitation.get("expires_at")
    if expires_at and datetime.fromisoformat(expires_at.replace("Z", "+00:00")) < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Cette invitation a expiré")
    if current_user["id"] == invitation.get("invited_by"):
        raise HTTPException(status_code=403, detail="Le créateur de l'annonce ne peut pas valider sa propre invitation")
    
    # Vérifier que l'email correspond
    if current_user["email"].lower() != invitation["president_email"].lower():
        raise HTTPException(
            status_code=403, 
            detail=f"Cette invitation est destinée à {invitation['president_email']}"
        )
    
    # Vérifier que le président a vérifié son identité
    if not is_user_verified(current_user):
        raise HTTPException(
            status_code=403,
            detail="Vous devez vérifier votre identité avant d'accepter cette invitation"
        )
    
    # Mettre à jour l'invitation
    await db.president_invitations.update_one(
        {"token": token},
        {"$set": {
            "status": "accepted",
            "accepted_by": current_user["id"],
            "accepted_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Mettre à jour l'annonce - le président devient co-propriétaire
    await db.companies.update_one(
        {"id": invitation["company_id"]},
        {"$set": {
            "president_id": current_user["id"],
            "president_email": current_user["email"],
            "president_verified": True,
            "president_invitation_pending": False,
            "dirigeant_verified": True,
            "can_be_published": True,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Le président (identité vérifiée) a validé : l'annonce est mise en ligne automatiquement
    company = await db.companies.find_one({"id": invitation["company_id"]}, {"_id": 0})
    if company and company.get("status") == "pending" and (not mandate_required() or await has_signed_mandate(company)):
        await publish_company(company)
    
    # Notifier le créateur de l'annonce
    invitation_creator = await db.users.find_one({"id": invitation["invited_by"]})
    if invitation_creator:
        try:
            await send_brevo_email(
                to_email=invitation_creator["email"],
                to_name=f"{invitation_creator.get('first_name', '')} {invitation_creator.get('last_name', '')}",
                subject="Validation acceptée par le président",
                html_content=f"""
                <h2>Bonne nouvelle !</h2>
                <p>{html_escape(invitation['president_firstname'])} {html_escape(invitation['president_lastname'])} a validé votre annonce.</p>
                <p>Votre annonce est maintenant en ligne et visible par les acquéreurs.</p>
                """
            )
        except Exception as e:
            logging.error(f"Erreur notification créateur: {e}")
    
    return {
        "success": True,
        "message": "Invitation acceptée. L'annonce peut maintenant être publiée.",
        "company_id": invitation["company_id"]
    }

@api_router.post("/president/decline/{token}")
async def decline_president_invitation(token: str, reason: Optional[str] = None):
    """
    Le président refuse l'invitation.
    """
    invitation = await db.president_invitations.find_one({"token": token})
    
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation non trouvée")
    if invitation.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Cette invitation a déjà été traitée")
    reason = html_escape(reason) if reason else reason
    
    await db.president_invitations.update_one(
        {"token": token},
        {"$set": {
            "status": "declined",
            "declined_at": datetime.now(timezone.utc).isoformat(),
            "decline_reason": reason
        }}
    )
    
    # Mettre à jour l'annonce
    await db.companies.update_one(
        {"id": invitation["company_id"]},
        {"$set": {
            "president_invitation_pending": False,
            "president_invitation_declined": True,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Notifier le créateur
    invitation_creator = await db.users.find_one({"id": invitation["invited_by"]})
    if invitation_creator:
        try:
            await send_brevo_email(
                to_email=invitation_creator["email"],
                to_name=f"{invitation_creator.get('first_name', '')} {invitation_creator.get('last_name', '')}",
                subject="Invitation refusée - Annonce de cession",
                html_content=f"""
                <h2>Invitation refusée</h2>
                <p>{html_escape(invitation['president_firstname'])} {html_escape(invitation['president_lastname'])} a refusé de valider votre annonce.</p>
                {f'<p><strong>Raison:</strong> {reason}</p>' if reason else ''}
                <p>Vous pouvez contacter directement la personne pour plus d'informations.</p>
                """
            )
        except Exception as e:
            logging.error(f"Erreur notification refus: {e}")
    
    return {
        "success": True,
        "message": "Invitation refusée"
    }


# ============ COMPANIES ROUTES ============
async def dirigeant_check_for(user: dict, siren: str) -> Optional[dict]:
    """Vérification dirigeant de l'utilisateur pour ce SIREN ; refaite avec le nom certifié si disponible"""
    if not siren:
        return None
    check = await db.dirigeant_verifications.find_one({"user_id": user["id"], "siren": siren}, {"_id": 0})
    if user.get("verified_last_name") and (not check or check.get("identity_source") != "verified_identity"):
        # L'identité a été certifiée après la saisie de l'annonce : on refait la comparaison avec le vrai nom
        try:
            first = (user.get("verified_first_name") or "").lower().strip()
            last = user["verified_last_name"].lower().strip()
            result = await _match_dirigeant(siren, first, last, f"{first} {last}".strip())
            check = {"user_id": user["id"], "siren": siren, "verified": bool(result.get("verified")),
                     "status": result.get("status"), "reason": result.get("reason"), "identity_source": "verified_identity",
                     "checked_at": datetime.now(timezone.utc).isoformat()}
            await db.dirigeant_verifications.update_one({"user_id": user["id"], "siren": siren}, {"$set": check}, upsert=True)
        except Exception as e:
            logging.warning(f"Revérification dirigeant impossible: {e}")
    return check

def mandate_required() -> bool:
    return os.environ.get("FF_MANDATE_REQUIRED", "true").strip().lower() not in ("false", "0", "no")

async def has_signed_mandate(company: dict) -> bool:
    """Mandat signé en cours ; hors mode test, un mandat de test (signé pendant l'essai) ne compte pas"""
    if not company.get("mandate_id"):
        return False
    query = {"id": company["mandate_id"], "type": "mandat", "status": "signed"}
    if not test_mode_enabled():
        query["is_test"] = {"$ne": True}
    return bool(await db.generated_contracts.find_one(query))

# Motifs de blocage (publication impossible) et drapeaux (publiée, à relire par l'admin sous 48 h) — SPEC §4.4
LISTING_BLOCKING_LABELS = {
    "email_non_confirme": "votre adresse e-mail n'est pas confirmée",
    "identite_non_verifiee": "votre identité n'est pas vérifiée",
    "siret_manquant": "le SIRET de l'entreprise n'est pas renseigné",
    "siren_inactif": "l'entreprise est signalée comme cessée au registre national",
    "doublon_siren": "une annonce est déjà en ligne ou en pause pour cette entreprise",
    "metier_manquant": "aucun métier n'est renseigné",
    "prix_manquant": "le prix demandé n'est pas renseigné",
}
LISTING_FLAG_LABELS = {
    "dirigeant_non_confirme": "qualité de dirigeant non confirmée par le registre",
    "naf_hors_batiment": "code NAF hors bâtiment",
    "naf_connexe": "code NAF connexe au bâtiment",
    "rge_absent_ademe": "RGE déclaré mais absent de la liste ADEME",
    "open_data_indisponible": "open data indisponible au moment de la publication",
    "migration_sans_controles": "annonce reprise de l'ancienne file de validation, contrôles automatiques non rejoués",
    # Mode test (MODE-TEST-ET-APP.md §B.2.5) : motifs bloquants rétrogradés en drapeaux
    "siren_inactif": "entreprise signalée comme cessée au registre national (mode test : non bloquant)",
    "doublon_siren": "autre annonce en ligne ou en pause pour ce SIREN (mode test : non bloquant)",
}
MODERATION_REVIEW_HOURS = 48

# Une annonce en pause (volontaire ou après 60 jours sans connexion) occupe toujours son SIREN : elle peut être remise
# en ligne à tout moment, sans nouveau contrôle (SPEC §4.4, un seul mandat et une seule annonce par entreprise)
DUPLICATE_LISTING_STATUSES = ("published", "paused", "pending")

async def duplicate_listing_for(company_id: str, siren: str, statuses=DUPLICATE_LISTING_STATUSES) -> Optional[dict]:
    """Autre annonce du même SIREN dans l'un des `statuts` (None si aucune ou SIREN invalide)"""
    siren = re.sub(r"\D", "", siren or "")[:9]
    if len(siren) != 9:
        return None
    return await db.companies.find_one({"id": {"$ne": company_id}, "siret": {"$regex": f"^{siren}"}, "status": {"$in": list(statuses)}},
                                       {"_id": 0, "id": 1, "status": 1})

async def listing_checks(company_doc: dict, user: dict) -> dict:
    """Contrôles automatiques d'une annonce (open data, dirigeant, ADEME, doublon) → {checks, trades, blocking, flags, company}"""
    siret = (company_doc.get("siret") or "").replace(" ", "")
    siren = siret[:9]
    company = await opendata.lookup_siren(siret or siren) if siren else {"available": False, "found": False}
    first = (user.get("verified_first_name") or user.get("first_name") or "")
    last = (user.get("verified_last_name") or user.get("last_name") or "")
    dirigeant = await opendata.match_dirigeant(siren, first, last) if siren else None
    if dirigeant and dirigeant.get("status") != "match_exact" and company_doc.get("president_verified"):
        # Le président de la société a validé l'annonce lui-même (flux d'invitation) : qualité de dirigeant acquise
        dirigeant = {**dirigeant, "status": "match_exact", "verified": True}
    rge_declared = bool(company_doc.get("rge_types"))
    in_ademe = None
    if rge_declared and siret:
        try:
            ademe = await verify_rge(siret)
            in_ademe = bool(ademe.get("verified")) if not ademe.get("error") else None
        except Exception as e:  # jamais bloquant
            logging.warning(f"ADEME indisponible pour {siret}: {e}")
    duplicate = await duplicate_listing_for(company_doc["id"], siren)
    checks = opendata.company_checks_from(company, dirigeant, in_ademe, bool(duplicate))
    checks["email_verified"] = is_email_verified(user)
    try:
        trades = taxonomy.validate_trades(company_doc.get("trades") or taxonomy.trades_for_rge(company_doc.get("rge_types")))
    except ValueError:
        trades = []
    blocking = []
    if not checks["email_verified"]:
        blocking.append("email_non_confirme")
    if not is_user_verified(user):
        blocking.append("identite_non_verifiee")
    if not siret:
        blocking.append("siret_manquant")
    # Mode test : entreprise cessée et doublon deviennent des drapeaux (un SIRET fictif de 14 chiffres est accepté) pour
    # les seules données de test (annonce ou cédant `is_test`) : une annonce réelle garde ses contrôles pendant l'essai ;
    # e-mail, identité, mandat, métier et prix restent bloquants
    relaxed = test_mode_enabled() and is_test_related(company_doc, user)
    soft_flags = []
    if checks["siren_active"] is False:
        (soft_flags if relaxed else blocking).append("siren_inactif")
    if checks["duplicate_siren"]:
        (soft_flags if relaxed else blocking).append("doublon_siren")
    if not trades:
        blocking.append("metier_manquant")
    if not (company_doc.get("asking_price") or 0) > 0:
        blocking.append("prix_manquant")
    flags = []
    if checks["dirigeant_match"] != "match_exact":
        flags.append("dirigeant_non_confirme")
    if checks["naf_in_building"] is False:
        flags.append("naf_hors_batiment")
    if checks["naf_status"] == "connexe":
        flags.append("naf_connexe")
    if rge_declared and in_ademe is False:
        flags.append("rge_absent_ademe")
    if not checks["opendata_available"]:
        flags.append("open_data_indisponible")
    flags += soft_flags
    return {"checks": checks, "trades": trades, "blocking": blocking, "flags": flags, "company": company,
            "rge_declared": rge_declared, "siret": siret}

async def submit_listing(company_doc: dict, user: dict) -> dict:
    """Soumet une annonce : e-mail confirmé et mandat signé obligatoires (loi Hoguet), puis publication automatique
    sans humain si les contrôles passent (SPEC §4.4) ; sinon brouillon avec la liste des motifs. Les drapeaux non
    bloquants sont listés dans « À faire » admin pendant 48 h (post-modération)."""
    now = datetime.now(timezone.utc).isoformat()
    if not is_email_verified(user):
        # Double opt-in : rien n'est publié ni signé tant que l'adresse n'est pas confirmée ; l'annonce reste en brouillon
        await db.companies.update_one({"id": company_doc["id"]}, {"$set": {"status": "draft", "updated_at": now}})
        company_doc["status"] = "draft"
        company_doc["auto_published"] = False
        company_doc["blocked_reason"] = "email_not_verified"
        return company_doc
    if mandate_required() and not await has_signed_mandate(company_doc):
        await db.companies.update_one({"id": company_doc["id"]}, {"$set": {"status": "mandat_en_attente", "updated_at": now}})
        # Point de départ des relances « mandat à signer » (J+1/J+4/J+10), posé une seule fois
        await db.companies.update_one({"id": company_doc["id"], "mandate_pending_since": {"$exists": False}},
                                      {"$set": {"mandate_pending_since": now}})
        company_doc["status"] = "mandat_en_attente"
        company_doc["auto_published"] = False
        await email_user(user["id"], "listing_mandate_required",
                         link=site_url(f"/seller/mandat/{company_doc['id']}"))
        return company_doc
    result = await listing_checks(company_doc, user)
    checks, trades, blocking, flags, company = (result["checks"], result["trades"], result["blocking"],
                                                result["flags"], result["company"])
    found = bool(company.get("found"))
    region = company_doc.get("region") or (company.get("region") if found else None)
    update = {
        "company_checks": checks,
        "trades": trades,
        "is_rge": result["rge_declared"],
        "naf_code": company.get("naf") if found else company_doc.get("naf_code"),
        "naf_in_building": checks["naf_in_building"],
        "department": company_doc.get("department") or (company.get("departement") if found else None),
        "region": region,
        "title": taxonomy.listing_title(trades, region, company_doc.get("staff_count")) if trades else company_doc.get("title"),
        "dirigeant_status": checks["dirigeant_match"],
        "dirigeant_verified": checks["dirigeant_match"] in ("match_exact", "match_partial"),
        "can_be_published": not blocking,
        "blocking": blocking,
        "submitted_at": now,
        "updated_at": now,
    }
    if company_doc.get("qualifications_verified_at") is None and checks.get("in_ademe_list") is not None:
        update["qualifications_verified_at"] = now
    if blocking:
        update["status"] = "draft"
        update["blocked_reason"] = blocking[0]
        update["moderation"] = company_doc.get("moderation") or {"status": "pending", "flags": [], "reviewed_at": None, "reason": None}
        await db.companies.update_one({"id": company_doc["id"]}, {"$set": update})
        company_doc.update(update)
        reasons = "".join(f"<li>{html_escape(LISTING_BLOCKING_LABELS.get(b, b))}</li>" for b in blocking)
        await email_user(user["id"], "listing_blocked", reasons=reasons, link=site_url("/seller/dashboard"))
        company_doc["auto_published"] = False
        return company_doc
    update["moderation"] = {"status": "pending", "flags": flags,
                            "review_until": (datetime.now(timezone.utc) + timedelta(hours=MODERATION_REVIEW_HOURS)).isoformat(),
                            "reviewed_at": None, "reason": None}
    update["blocked_reason"] = None
    update["auto_published"] = True
    await db.companies.update_one({"id": company_doc["id"]}, {"$set": update})
    company_doc.update(update)
    # Publication immédiate, sans file d'attente admin : les drapeaux alimentent l'onglet « À faire » (digest quotidien)
    await publish_company(company_doc)
    company_doc["status"] = "published"
    company_doc["auto_published"] = True
    return company_doc

async def submit_drafts(user_id: str):
    """Appelé quand l'identité d'un vendeur devient vérifiée : ses brouillons sont soumis"""
    user = await db.users.find_one({"id": user_id}, USER_SAFE_PROJECTION)
    if not user or user.get("role") != "seller":
        return
    drafts = await db.companies.find({"seller_id": user_id, "status": "draft"}, {"_id": 0}).to_list(50)
    for draft in drafts:
        try:
            await submit_listing(draft, user)
        except Exception as e:
            logging.error(f"Soumission du brouillon {draft.get('id')} impossible: {e}")

@api_router.post("/companies")
async def create_company(company: CompanyCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "seller":
        raise HTTPException(status_code=403, detail="Only sellers can create listings")
    
    now = datetime.now(timezone.utc).isoformat()
    fields = validate_listing_fields(company.model_dump())
    if fields.get("trades") is None:
        fields["trades"] = taxonomy.trades_for_rge(fields.get("rge_types")) or None
    fields["is_rge"] = bool(fields.get("rge_types"))
    fields["commission_terms_version"] = COMMISSION_TERMS_VERSION
    company_doc = {
        "id": str(uuid.uuid4()),
        "seller_id": current_user["id"],
        "seller_email": current_user["email"],
        **fields,
        # Le statut « dirigeant vérifié » est calculé côté serveur (jamais pris du client)
        "dirigeant_verified": False,
        "dirigeant_status": company.dirigeant_status or "not_checked",
        "status": "draft",
        "views": 0,
        "contacts_count": 0,
        "can_be_published": False,
        "president_invitation_pending": False,
        "created_at": now,
        "updated_at": now
    }
    mark_test(company_doc, current_user)
    await db.companies.insert_one(company_doc)
    company_doc.pop("_id", None)
    
    # Écran 1 seul (pas de prix) : simple brouillon, soumis au PUT de l'écran 3
    if not listing_complete(company_doc):
        company_doc["auto_published"] = False
        return company_doc
    # Sans identité vérifiée, l'annonce reste en brouillon : elle sera soumise dès la vérification
    if not is_user_verified(current_user):
        await email_user(current_user["id"], "listing_draft")
        company_doc["auto_published"] = False
        return company_doc
    
    return await submit_listing(company_doc, current_user)

def listing_complete(doc: dict) -> bool:
    """Une annonce est soumise (mandat, contrôles, publication) dès que l'écran 3 de CreateListing est renseigné
    (objet de la cession ou prix demandé) ; un prix manquant est alors un motif de blocage, pas un brouillon muet."""
    if doc.get("sale_object"):
        return True
    try:
        return float(doc.get("asking_price") or 0) > 0
    except (TypeError, ValueError):
        return False

# Informations qui lèvent l'anonymat d'une annonce : jamais exposées avant signature d'un NDA
CONFIDENTIAL_COMPANY_FIELDS = ["seller_email", "siret", "company_name", "president_email", "president_id",
                               "president_invitation_id", "president_firstname", "president_lastname",
                               "mandant_address", "mandant_capacity", "presented_buyers"]
PUBLIC_COMPANY_PROJECTION = {"_id": 0, **{f: 0 for f in CONFIDENTIAL_COMPANY_FIELDS}}
# Vue du repreneur après NDA : seuls ces champs confidentiels sont révélés ; les champs internes ci-dessous restent cachés
NDA_REVEALED_COMPANY_FIELDS = ("company_name", "siret")
NDA_HIDDEN_COMPANY_FIELDS = ["seller_id", "blocking", "blocked_reason", "can_be_published", "auto_accept_dataroom", "veille_flag",
                             "president_invitation_pending", "president_invitation_declined", "president_phone", "alerts_sent"]

def company_sort_criteria(sort: Optional[str]):
    if sort == "popular":
        return [("views", -1), ("created_at", -1)]
    if sort == "price_asc":
        return [("asking_price", 1), ("created_at", -1)]
    if sort == "price_desc":
        return [("asking_price", -1), ("created_at", -1)]
    # `recent` / `latest` / défaut : les plus récentes d'abord (date de publication, puis de création)
    return [("published_at", -1), ("created_at", -1)]

def listing_filters(trades: Optional[Any] = None, region: Optional[str] = None, department: Optional[str] = None,
                    rge: Optional[Any] = None, min_price: Optional[float] = None, max_price: Optional[float] = None,
                    rge_types: Optional[List[str]] = None, min_ca: Optional[float] = None, max_ca: Optional[float] = None,
                    min_staff: Optional[int] = None) -> dict:
    """Filtres publics d'API.md §2 (métiers en OU logique, région, département, RGE oui/non, prix, chiffre d'affaires,
    effectif minimum) → requête Mongo"""
    query = {}
    if isinstance(trades, str):
        trades = [t.strip() for t in trades.split(",")]
    ids = [t for t in (trades or []) if taxonomy.trade_by_id(t)]
    if ids:
        query["trades"] = {"$in": ids}
    if rge_types:
        query["rge_types"] = {"$in": rge_types}
    if region:
        query["region"] = taxonomy.region_by_slug(region) or region
    if department:
        code = taxonomy.normalize_departement(department)
        if code:
            query["department"] = code
    if rge in (True, "true", "1", "oui"):
        query["is_rge"] = True
    elif rge in (False, "false", "0", "non"):
        query["is_rge"] = {"$ne": True}
    price = {}
    if min_price is not None and min_price > 0:
        price["$gte"] = float(min_price)
    if max_price is not None and max_price > 0:
        price["$lte"] = float(max_price)
    if price:
        query["asking_price"] = price
    ca = {}
    if min_ca:
        ca["$gte"] = float(min_ca)
    if max_ca:
        ca["$lte"] = float(max_ca)
    if ca:
        query["ca_n"] = ca
    if min_staff is not None and min_staff > 0:
        query["staff_count"] = {"$gte": int(min_staff)}
    return query

def hide_test_listings(query: dict) -> dict:
    """Hors mode test, les annonces de test (créées pendant un essai et pas encore purgées) et les annonces réelles dont le
    mandat en cours a été signé pendant l'essai (mandat de test, sans valeur) ne sont jamais montrées au public"""
    if not test_mode_enabled():
        query["is_test"] = {"$ne": True}
        query["mandate_is_test"] = {"$ne": True}
    return query

def listing_hidden_outside_test(company: dict) -> bool:
    """Annonce masquée au public hors mode test (voir hide_test_listings)"""
    return bool(company.get("is_test") or company.get("mandate_is_test")) and not test_mode_enabled()

def public_listing(company: dict) -> dict:
    """Annonce publique : champs confidentiels retirés (jamais company_name, siret, seller_id, mandant_address…)"""
    for field in CONFIDENTIAL_COMPANY_FIELDS + ["seller_id", "blocking", "blocked_reason", "can_be_published",
                                               "president_verified", "alerts_sent", "auto_accept_dataroom", "veille_flag"]:
        company.pop(field, None)
    company["commission_info"] = commission_info_for(company)
    company.setdefault("is_rge", bool(company.get("rge_types")))
    company.setdefault("trades", taxonomy.trades_for_rge(company.get("rge_types")))
    checks = company.get("company_checks") or {}
    company["company_checks"] = {"in_ademe_list": checks.get("in_ademe_list"), "dirigeant_match": checks.get("dirigeant_match")}
    return company

async def has_signed_nda(company_id: str, user_id: str) -> bool:
    nda = await db.generated_contracts.find_one({
        "type": "nda", "company_id": company_id, "buyer_id": user_id,
        "status": {"$in": ["signed", "buyer_signed", "fully_signed"]}
    })
    return nda is not None

def is_company_owner(company: dict, user: Optional[dict]) -> bool:
    return bool(user) and user["id"] in (company.get("seller_id"), company.get("president_id"))

async def sanitize_company(company: dict, user: Optional[dict]) -> dict:
    """Retire les informations identifiantes sauf pour le propriétaire, l'admin ou un acheteur ayant signé le NDA"""
    company["commission_info"] = commission_info_for(company)
    if user and (user.get("role") == "admin" or is_company_owner(company, user)):
        return company
    if user and user.get("role") == "buyer" and await has_signed_nda(company["id"], user["id"]):
        # Nom et SIRET de la société révélés après NDA (annexe A) ; toutes les autres données confidentielles (coordonnées
        # et identité du président invité, adresse et qualité du mandant, repreneurs présentés) restent au cédant
        for field in [f for f in CONFIDENTIAL_COMPANY_FIELDS if f not in NDA_REVEALED_COMPANY_FIELDS] + NDA_HIDDEN_COMPANY_FIELDS:
            company.pop(field, None)
        return company
    return public_listing(company)

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
    """Libellés affichables des parties d'une annonce, sans coordonnées (nom révélé seulement après NDA)"""
    def __init__(self, viewer: dict):
        self.viewer = viewer
        self.cache = {}

    async def label(self, user_id: Optional[str], company: Optional[dict]) -> str:
        if not user_id or user_id == "system":
            return site_name()
        if user_id == self.viewer.get("id"):
            return "Vous"
        key = (user_id, (company or {}).get("id"))
        if key in self.cache:
            return self.cache[key]
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "role": 1, "first_name": 1, "last_name": 1, "company_name": 1})
        if not user:
            value = "Utilisateur"
        elif user.get("role") == "admin":
            value = site_name()
        elif company and user_id in (company.get("seller_id"), company.get("president_id")):
            value = "Vendeur"
        elif company and await has_signed_nda(company["id"], user_id):
            value = display_name(user) or buyer_pseudonym(user_id)
        else:
            value = buyer_pseudonym(user_id)
        self.cache[key] = value
        return value

# Détection de coordonnées dans les messages (contournement de la plateforme avant NDA)
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

async def publish_company(company: dict):
    """Met une annonce en ligne : statut, alertes acquéreurs (une seule fois) et email au vendeur"""
    now = datetime.now(timezone.utc).isoformat()
    update = {"status": "published", "updated_at": now}
    if not company.get("published_at"):
        update["published_at"] = now
    await db.companies.update_one({"id": company["id"]}, {"$set": update})
    if company.get("status") == "published":
        return
    sent = 0
    if not company.get("alerts_sent"):
        await db.companies.update_one({"id": company["id"]}, {"$set": {"alerts_sent": True}})
        try:
            sent = await trigger_alerts_for_company({**company, **update})
        except Exception as e:
            logging.error(f"Erreur envoi alertes: {e}")
        await db.companies.update_one({"id": company["id"]}, {"$set": {"alerts_sent_count": sent}})
    sent_line = (f"Elle a été envoyée à {sent} repreneur{'s' if sent > 1 else ''} dont les critères d'alerte correspondent."
                 if sent else "Elle sera envoyée aux repreneurs dont les critères d'alerte correspondent.")
    await email_user(company.get("seller_id"), "listing_published", sent_line=sent_line, company_title=update.get("title") or company.get("title") or "",
                     link=site_url("/seller/dashboard"))

@api_router.get("/companies")
async def get_companies(
    response: Response,
    status: Optional[str] = None,
    sort: Optional[str] = None,
    limit: Optional[int] = None,
    page: Optional[int] = None,
    trades: Optional[str] = None,
    region: Optional[str] = None,
    department: Optional[str] = None,
    rge: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    min_ca: Optional[float] = None,
    min_staff: Optional[int] = None,
    authorization: Optional[str] = Header(None)
):
    """Annonces en ligne (publiques, API.md §2) : filtres `trades` (ids séparés par des virgules, OU logique), `region`,
    `department`, `rge` (true/false), `min_price`, `max_price`, `min_ca` (chiffre d'affaires N minimum), `min_staff` (effectif
    minimum), `sort` (recent | price_asc | price_desc), `limit` (≤ 100),
    `page` (1…) ; en-tête `X-Total-Count`. Un cédant connecté voit ses propres annonces (tous statuts), l'admin peut filtrer par statut."""
    current_user = await get_current_user_optional(authorization)
    query = listing_filters(trades, region, department, rge, min_price, max_price, min_ca=min_ca, min_staff=min_staff)
    owner_view = False
    if current_user and current_user["role"] == "seller":
        query["$or"] = [{"seller_id": current_user["id"]}, {"president_id": current_user["id"]}]
        owner_view = True
    elif current_user and current_user["role"] == "admin" and status:
        query["status"] = status
        owner_view = True
    else:
        query["status"] = "published"
        hide_test_listings(query)
    
    limit = max(1, min(limit or 100, 100))
    skip = (max(1, page or 1) - 1) * limit
    total = await db.companies.count_documents(query)
    response.headers["X-Total-Count"] = str(total)
    projection = {"_id": 0} if owner_view else PUBLIC_COMPANY_PROJECTION
    cursor = db.companies.find(query, projection).sort(company_sort_criteria(sort)).skip(skip).limit(limit)
    companies = await cursor.to_list(limit)
    if owner_view:
        for c in companies:
            c["commission_info"] = commission_info_for(c)
        return companies
    return [public_listing(c) for c in companies]

@api_router.get("/companies/{company_id}")
async def get_company(company_id: str, authorization: Optional[str] = Header(None)):
    current_user = await get_current_user_optional(authorization)
    
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    is_privileged = bool(current_user) and (current_user.get("role") == "admin" or is_company_owner(company, current_user))
    hidden_test = listing_hidden_outside_test(company)
    if (company.get("status") != "published" or hidden_test) and not is_privileged:
        # Un repreneur en relation (dossier accepté, NDA signé, offre, vente) garde l'accès à la fiche d'une annonce
        # vendue, en pause ou retirée : son dossier et son étape de vente y renvoient
        related = bool(current_user) and current_user.get("role") == "buyer" and (
            await db.dataroom_access.find_one({"company_id": company_id, "buyer_id": current_user["id"],
                                               "status": {"$in": list(DATAROOM_ACCEPTED_STATUSES) + ["pending"]}}, {"_id": 0, "id": 1}) is not None
            or await has_signed_nda(company_id, current_user["id"]))
        if not related:
            raise HTTPException(status_code=404, detail="Company not found")
        is_privileged = True  # pas de vue comptée
    
    # Les consultations du vendeur ou de l'admin ne comptent pas comme des vues
    if not is_privileged:
        await db.companies.update_one({"id": company_id}, {"$inc": {"views": 1}})
        company["views"] = company.get("views", 0) + 1
    
    return await sanitize_company(company, current_user)

@api_router.post("/companies/search")
async def search_companies(search: CompanySearch, response: Response, authorization: Optional[str] = Header(None)):
    """Recherche (alertes, pages d'activité RGE) : mêmes filtres que GET /companies, plus `rge_types`, `min_ca`, `max_ca`"""
    query = hide_test_listings({"status": "published", **listing_filters(search.trades, search.region, search.department, search.rge,
                                                                         search.min_price, search.max_price, search.rge_types,
                                                                         search.min_ca, search.max_ca, search.min_staff)})
    limit = max(1, min(search.limit or 100, 100))
    skip = (max(1, search.page or 1) - 1) * limit
    total = await db.companies.count_documents(query)
    response.headers["X-Total-Count"] = str(total)
    cursor = db.companies.find(query, PUBLIC_COMPANY_PROJECTION).sort(company_sort_criteria(search.sort)).skip(skip).limit(limit)
    return [public_listing(c) for c in await cursor.to_list(limit)]

class ContactCreate(BaseModel):
    message: Optional[str] = Field(None, max_length=5000)

def require_buyer_profile(user: dict, minimum: int = SCORE_CONTACT_MIN):
    """Contact et demande de dossier : profil de projet suffisant (403 `profile_incomplete` avec le score et ce qui manque)"""
    if user.get("role") != "buyer":
        return
    score = buyer_profile_score(user)
    if score < minimum:
        raise api_error(403, "profile_incomplete",
                        f"Complétez votre profil de projet avant de contacter un cédant (profil complet à {score} %, {minimum} % requis)",
                        profile_score=score, required=minimum, missing=profile_missing(user))

@api_router.post("/companies/{company_id}/contact")
async def contact_company(company_id: str, background_tasks: BackgroundTasks, data: Optional[ContactCreate] = None,
                          current_user: dict = Depends(get_current_user)):
    """Premier contact du repreneur (SPEC §4.3.4, API.md §3) : adresse e-mail confirmée et profil ≥ 40 obligatoires ;
    crée (ou retrouve) la conversation du couple annonce / repreneur, enregistre le message et envoie au cédant
    l'e-mail « premier contact » avec la carte repreneur pseudonymisée. → {conversation_id}"""
    if current_user["role"] != "buyer":
        raise api_error(403, "not_allowed", "Seuls les repreneurs peuvent contacter un cédant")
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company or company.get("status") != "published":
        raise HTTPException(status_code=404, detail="Entreprise introuvable")
    # Premier contact : e-mail confirmé et profil de projet suffisant ; l'identité n'est vérifiée qu'au moment du NDA
    require_verified_email(current_user)
    require_buyer_profile(current_user)
    now = datetime.now(timezone.utc)
    conversation, created = await get_or_create_conversation(company, current_user["id"], now)
    content = (data.message if data else None) or ""
    content = content.strip()
    message_doc = None
    if content:
        message_doc = await store_message(conversation, current_user, content, now)
    if created:
        await register_contact(company, current_user["id"], now)
        extract = (message_doc or {}).get("content") or "Le repreneur n'a pas laissé de message : répondez-lui depuis la messagerie."
        background_tasks.add_task(notify_first_contact, conversation, current_user, extract)
        background_tasks.add_task(email_user, current_user["id"], "contact_sent_buyer",
                                  company_title=company.get("title") or "l'annonce", link=site_url(f"/messages?conversation={conversation['id']}"))
    elif message_doc:
        background_tasks.add_task(notify_new_message, conversation, current_user, message_doc)
    return {"conversation_id": conversation["id"], "company_id": company_id, "already_contacted": not created,
            "message": ("Votre message a été transmis au cédant." if created else "Contact déjà établi : retrouvez votre conversation dans la messagerie."),
            "message_id": (message_doc or {}).get("id")}

# ---- Actions du cédant sur son annonce (SPEC §4.2.4) ----
SELLER_STATUSES = {"paused", "published", "withdrawn", "sold_elsewhere"}
SELLER_STATUS_LABELS = {"paused": "mise en pause", "published": "remise en ligne", "withdrawn": "retirée", "sold_elsewhere": "vendue autrement"}

async def seller_status_change(company: dict, status: str, current_user: dict, now: str) -> dict:
    current = company.get("status")
    company_id = company["id"]
    if status == "published":
        if current != "paused":
            raise api_error(400, "validation", "Seule une annonce en pause peut être remise en ligne")
        if mandate_required() and not await has_signed_mandate(company):
            raise api_error(400, "mandate_required", "Signez un mandat avant de remettre l'annonce en ligne")
        relaxed = test_mode_enabled() and is_test_related(company, current_user)
        if not relaxed and await duplicate_listing_for(company_id, company.get("siret"), ("published",)):
            raise api_error(400, "validation", "Une autre annonce est déjà en ligne pour cette entreprise")
        await db.companies.update_one({"id": company_id}, {"$set": {"status": "published", "updated_at": now, "resumed_at": now},
                                                           "$unset": {"paused_at": "", "paused_reason": ""}})
    elif current not in ("published", "paused", "withdrawn", "mandat_en_attente", "draft", "pending"):
        raise api_error(400, "validation", "Cette annonce ne peut pas changer de statut")
    elif status == "paused":
        if current != "published":
            raise api_error(400, "validation", "Seule une annonce en ligne peut être mise en pause")
        await db.companies.update_one({"id": company_id}, {"$set": {"status": "paused", "paused_at": now, "paused_reason": "cedant", "updated_at": now}})
    elif status == "withdrawn":
        await db.companies.update_one({"id": company_id}, {"$set": {"status": "withdrawn", "withdrawn_at": now, "withdrawn_reason": "cedant",
                                                                    "updated_at": now}})
    elif status == "sold_elsewhere":
        await db.companies.update_one({"id": company_id}, {"$set": {"status": "sold_elsewhere", "sold_elsewhere_at": now,
                                                                    "veille_flag": True, "updated_at": now}})
        mandate = await db.generated_contracts.find_one({"id": company.get("mandate_id"), "type": "mandat"}, {"_id": 0}) if company.get("mandate_id") else None
        presented = await presented_buyers_view(company)
        buyers_list = " ; ".join(f"{b.get('name') or b['label']}" + (f" ({b['company_name']})" if b.get("company_name") else "") for b in presented) \
            or "aucun repreneur ne vous a été nommément présenté"
        tail = fmt_date_fr(company.get("mandate_tail_ends_at") or (mandate or {}).get("tail_ends_at")) or "la fin de la clause de suite"
        await email_user(company.get("seller_id"), "sold_elsewhere_tail_clause", tail_ends_at=tail, buyers_list=buyers_list,
                         registry_number=(mandate or {}).get("registry_number") or "", link=site_url("/seller/dashboard"))
        await email_admin("sold_elsewhere_admin", company_id=company_id, company_name=company.get("company_name") or company.get("title") or "",
                          siret=company.get("siret") or "", buyers_list=buyers_list)
    if status in ("withdrawn", "sold_elsewhere"):
        await close_pending_dataroom_requests(company_id, status, now)
    await create_audit_log(action=f"LISTING_{status.upper()}", company_id=company_id, actor_id=current_user["id"],
                           actor_email=current_user["email"], details={"from": current, "to": status})
    return {"message": "Status updated", "status": status, "label": SELLER_STATUS_LABELS[status]}

REMOVAL_REASONS = {
    "coordonnees": "L'annonce contient des coordonnées ou des éléments permettant d'identifier l'entreprise",
    "hors_perimetre": "L'activité n'entre pas dans le périmètre de la plateforme (entreprises du bâtiment)",
    "informations_inexactes": "Les informations de l'annonce sont inexactes ou invérifiables",
    "dirigeant": "La qualité de dirigeant ou de mandataire n'a pas pu être établie",
    "doublon": "Une annonce existe déjà pour cette entreprise",
    "autre": "Autre motif",
}

@api_router.put("/companies/{company_id}/status")
async def update_company_status(company_id: str, status: str, reason: Optional[str] = None, reason_text: Optional[str] = None,
                                current_user: dict = Depends(get_current_user)):
    """Changement de statut (API.md §2).
    Cédant : `paused` (mise en pause), `published` (reprise d'une annonce en pause), `withdrawn` (retrait),
    `sold_elsewhere` (vendue autrement : rappel de la clause de suite par e-mail, drapeau pour la veille BODACC).
    Admin : `published` = mise en ligne (mandat signé obligatoire, relecture close) ; `removed` = retrait motivé
    (motif obligatoire, e-mail au cédant, mandat caduc, le cédant peut corriger et re-soumettre)."""
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    now = datetime.now(timezone.utc).isoformat()
    
    if current_user["role"] != "admin":
        if status not in SELLER_STATUSES or not is_company_owner(company, current_user):
            raise api_error(403, "not_allowed", "Action réservée au cédant de l'annonce")
        return await seller_status_change(company, status, current_user, now)
    if status not in {"pending", "published", "rejected", "removed", "sold", "archived", "paused", "withdrawn", "sold_elsewhere"}:
        raise HTTPException(status_code=400, detail="Statut invalide")
    
    if status == "published":
        if mandate_required() and not await has_signed_mandate(company):
            raise HTTPException(status_code=400, detail="Publication impossible : le mandat de vente n'est pas signé")
        await publish_company(company)
        moderation = {**(company.get("moderation") or {}), "status": "ok", "reviewed_at": now, "reviewed_by": current_user["id"]}
        await db.companies.update_one({"id": company_id}, {"$set": {"moderation": moderation}})
        return {"message": "Status updated"}
    
    if status == "removed":
        if not reason or reason not in REMOVAL_REASONS:
            raise HTTPException(status_code=400, detail="Motif de retrait obligatoire : " + ", ".join(REMOVAL_REASONS))
        reason_label = REMOVAL_REASONS[reason] + (f" — {reason_text.strip()}" if reason_text and reason_text.strip() else "")
        moderation = {**(company.get("moderation") or {}), "status": "removed", "reviewed_at": now,
                      "reviewed_by": current_user["id"], "reason": reason, "reason_text": reason_label}
        await db.companies.update_one({"id": company_id}, {"$set": {"status": "removed", "removed_at": now, "updated_at": now,
                                                                     "moderation": moderation, "can_be_published": False}})
        if company.get("mandate_id"):
            # Caducité du mandat : l'annonce retirée met fin au mandat (SPEC §3.2), le cédant pourra en signer un nouveau
            # Clause de suite : 18 mois à compter de la caducité (fin du mandat, art. 7)
            tail_ends_at = add_months(datetime.fromisoformat(now), MANDATE_TAIL_MONTHS).isoformat()
            voided = await db.generated_contracts.update_one({"id": company["mandate_id"], "type": "mandat", "status": "signed"},
                                                             {"$set": {"status": "void", "void_at": now, "void_reason": "annonce retirée : " + reason_label,
                                                                       "tail_ends_at": tail_ends_at}})
            update = {"mandat_signed": False}
            if voided.modified_count:
                update["mandate_tail_ends_at"] = tail_ends_at
            await db.companies.update_one({"id": company_id}, {"$set": update, "$unset": {"mandate_id": ""}})
        await close_pending_dataroom_requests(company_id, "removed", now)
        await create_audit_log(action="LISTING_REMOVED", company_id=company_id, actor_id=current_user["id"],
                               actor_email=current_user["email"], details={"reason": reason, "text": reason_label})
        await email_user(company.get("seller_id"), "listing_removed", reason=reason_label, link=site_url("/seller/dashboard"))
        return {"message": "Status updated", "reason": reason_label}
    
    await db.companies.update_one({"id": company_id}, {"$set": {"status": status, "updated_at": now}})
    if status not in DATAROOM_OPEN_LISTING_STATUSES:
        await close_pending_dataroom_requests(company_id, status, now)
    if status == "rejected" and company.get("status") != "rejected":
        await email_user(company.get("seller_id"), "listing_rejected")
    return {"message": "Status updated"}

# ============ COMPANY UPDATE (SELLER) ============
class MandantAddress(BaseModel):
    """Adresse postale du mandant (API.md §2) ; `fmt_address` accepte aussi la chaîne historique"""
    line1: str = Field(..., min_length=3, max_length=200)
    line2: Optional[str] = Field(None, max_length=200)
    postal_code: str = Field(..., pattern=r"^\d{5}$")
    city: str = Field(..., min_length=1, max_length=120)

class CompanyUpdate(BaseModel):
    ca_n: Optional[float] = None
    ca_n1: Optional[float] = None
    ca_n2: Optional[float] = None
    margin: Optional[float] = None
    ebitda: Optional[float] = None
    mandataire_contracts: Optional[str] = None
    staff_count: Optional[int] = None
    pipeline: Optional[float] = None
    fixed_charges: Optional[Dict[str, float]] = None
    debt: Optional[float] = None
    asking_price: Optional[float] = None
    sale_type: Optional[str] = None
    equipment: Optional[str] = None
    premises: Optional[str] = None
    description: Optional[str] = None
    specialties: Optional[List[str]] = None
    rge_validity: Optional[str] = None
    creation_date: Optional[str] = None
    legal_structure: Optional[str] = None
    region: Optional[str] = None
    siret: Optional[str] = None
    company_name: Optional[str] = None
    rge_types: Optional[List[str]] = None
    # Tout le bâtiment (SPEC §2.2)
    trades: Optional[List[str]] = None
    other_qualifications: Optional[List[str]] = None
    department: Optional[str] = None
    sale_reason: Optional[Literal["retraite", "reconversion", "sante", "autre"]] = None
    sale_object: Optional[Literal["titres", "fonds", "indifferent"]] = None
    handover_months: Optional[int] = Field(default=None, ge=0, le=24)
    has_maintenance_contracts: Optional[bool] = None
    technical_referent_stays: Optional[bool] = None
    key_staff_stays: Optional[bool] = None
    decennale_ok: Optional[bool] = None
    auto_accept_dataroom: Optional[bool] = None
    mandant_address: Optional[Union[MandantAddress, str]] = None
    mandant_capacity: Optional[Literal["dirigeant", "associe", "mandataire"]] = None

# Champs figés une fois l'annonce publiée ou le mandat signé (l'identité de l'entreprise est portée par le mandat)
LOCKED_AFTER_MANDATE_FIELDS = ("siret", "company_name", "rge_types", "legal_structure", "creation_date")

@api_router.put("/companies/{company_id}")
async def update_company(company_id: str, update_data: CompanyUpdate, current_user: dict = Depends(get_current_user)):
    """
    Mise à jour d'une annonce par le vendeur (brouillon sauvegardé à chaque écran). Un brouillon bloqué dont le mandat
    est signé est re-soumis automatiquement après correction (publication immédiate si les contrôles passent).
    """
    if current_user["role"] != "seller":
        raise HTTPException(status_code=403, detail="Only sellers can update listings")
    
    company = await db.companies.find_one({"id": company_id, "seller_id": current_user["id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found or not authorized")
    # Filter out None values and update
    update_dict = validate_listing_fields({k: v for k, v in update_data.model_dump().items() if v is not None})
    if company.get("mandat_signed") or company.get("status") == "published":
        for f in LOCKED_AFTER_MANDATE_FIELDS:
            if f in update_dict and update_dict[f] != company.get(f):
                raise HTTPException(status_code=400, detail=f"Le champ « {f} » ne peut plus être modifié après la signature du mandat")
    if update_dict:
        update_dict["updated_at"] = datetime.now(timezone.utc).isoformat()
        if company.get("status") == "removed":
            update_dict["status"] = "draft"
        await db.companies.update_one({"id": company_id}, {"$set": update_dict})
    
    updated = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if updated.get("status") == "draft" and listing_complete(updated) and is_user_verified(current_user):
        if not updated.get("submitted_at") and not updated.get("blocking"):
            # Brouillon jamais soumis (créé à l'écran 1) : soumission dès que l'annonce est complète
            updated = await submit_listing(updated, current_user)
        elif updated.get("blocking") and await has_signed_mandate(updated):
            updated = await submit_listing(updated, current_user)
    elif updated.get("status") == "draft" and listing_complete(updated) and not updated.get("submitted_at") \
            and not company.get("draft_notified"):
        # Identité non vérifiée : brouillon complet, e-mail « enregistré en brouillon » une seule fois ; soumis à la vérification
        await db.companies.update_one({"id": company_id}, {"$set": {"draft_notified": True}})
        await email_user(current_user["id"], "listing_draft")
    # Baisse de prix sur une annonce en ligne : les repreneurs intéressés (favoris, contacts, alertes) sont prévenus
    old_price, new_price = float(company.get("asking_price") or 0), float(updated.get("asking_price") or 0)
    if updated.get("status") == "published" and old_price > 0 and 0 < new_price < old_price:
        try:
            await notify_price_drop(updated, old_price, new_price)
        except Exception as e:
            logging.error(f"Notification de baisse de prix impossible: {e}")
    return updated

# ============ PHOTOS MANAGEMENT ============
@api_router.post("/companies/{company_id}/photos")
async def upload_photo(
    company_id: str, 
    file: UploadFile = File(...), 
    visibility: Literal["public", "private"] = Form("public"),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload d'une photo pour une annonce
    - public: visible par tous
    - private: visible après signature NDA
    """
    if current_user["role"] != "seller":
        raise HTTPException(status_code=403, detail="Only sellers can upload photos")
    
    company = await db.companies.find_one({"id": company_id, "seller_id": current_user["id"]})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found or not authorized")
    
    # Check photo limit (max 5)
    existing_photos = await db.company_photos.count_documents({"company_id": company_id})
    if existing_photos >= 5:
        raise HTTPException(status_code=400, detail="Maximum 5 photos per listing")
    
    # Read and encode file
    content = await read_upload(file, ALLOWED_IMAGE_TYPES, 5 * 1024 * 1024)
    stored = await save_file(content, file.content_type, f"photos/{company_id}")
    
    photo_doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "filename": file.filename,
        "content_type": file.content_type,
        **stored,
        "visibility": visibility,  # public or private
        "uploaded_at": datetime.now(timezone.utc).isoformat()
    }
    mark_test(photo_doc, company, current_user)
    await db.company_photos.insert_one(photo_doc)
    photo_doc.pop("_id", None)
    photo_doc.pop("content", None)  # Don't return content in response
    return photo_doc

@api_router.get("/companies/{company_id}/photos")
async def get_company_photos(company_id: str, authorization: Optional[str] = Header(None)):
    """
    Récupère les photos d'une annonce
    - Photos publiques: visibles par tous
    - Photos privées: visibles si NDA signé
    """
    current_user = await get_current_user_optional(authorization)
    
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    # Check if user has signed NDA for private photos
    can_see_private = False
    if current_user:
        if is_company_owner(company, current_user) or current_user.get("role") == "admin":
            can_see_private = True
        elif await has_signed_nda(company_id, current_user.get("id")):
            can_see_private = True
    
    query = {"company_id": company_id}
    if not can_see_private:
        query["visibility"] = "public"
    
    photos = await db.company_photos.find(query, {"_id": 0, "content": 0}).to_list(10)
    return photos

@api_router.get("/companies/{company_id}/photos/{photo_id}")
async def get_photo_content(company_id: str, photo_id: str, authorization: Optional[str] = Header(None)):
    """
    Récupère le contenu d'une photo
    """
    current_user = await get_current_user_optional(authorization)
    
    photo = await db.company_photos.find_one({"id": photo_id, "company_id": company_id})
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Check visibility
    if photo["visibility"] == "private":
        if not current_user:
            raise HTTPException(status_code=403, detail="Authentication required")
        
        company = await db.companies.find_one({"id": company_id}, {"_id": 0})
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")
        if not is_company_owner(company, current_user) and current_user.get("role") != "admin":
            nda = await has_signed_nda(company_id, current_user.get("id"))
            if not nda:
                raise HTTPException(status_code=403, detail="NDA required to view private photos")
    
    data = await load_file(photo)
    return {"filename": photo["filename"], "content": base64.b64encode(data).decode("utf-8"), "content_type": photo.get("content_type")}

@api_router.delete("/companies/{company_id}/photos/{photo_id}")
async def delete_photo(company_id: str, photo_id: str, current_user: dict = Depends(get_current_user)):
    """
    Supprime une photo
    """
    if current_user["role"] != "seller":
        raise HTTPException(status_code=403, detail="Only sellers can delete photos")
    
    company = await db.companies.find_one({"id": company_id, "seller_id": current_user["id"]})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found or not authorized")
    
    photo = await db.company_photos.find_one({"id": photo_id, "company_id": company_id}, {"_id": 0})
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    await delete_file(photo)
    await db.company_photos.delete_one({"id": photo_id, "company_id": company_id})
    
    return {"message": "Photo deleted"}

# ============ DATA ROOM MANAGEMENT ============
DATAROOM_CATEGORIES = [
    {"id": "bilans", "label": "Bilans et comptes annuels"},
    {"id": "kbis", "label": "Kbis et statuts"},
    {"id": "contrats_clients", "label": "Contrats clients"},
    {"id": "contrats_fournisseurs", "label": "Contrats fournisseurs"},
    {"id": "baux", "label": "Baux et locaux"},
    {"id": "rge_certificats", "label": "Certificats RGE"},
    {"id": "assurances", "label": "Assurances"},
    {"id": "ressources_humaines", "label": "Ressources humaines"},
    {"id": "autres", "label": "Autres documents"},
]

@api_router.get("/dataroom/categories")
async def get_dataroom_categories():
    """Retourne les catégories de documents pour la data room"""
    return {"categories": DATAROOM_CATEGORIES}

@api_router.post("/dataroom/{company_id}/documents")
async def upload_dataroom_document(
    company_id: str,
    file: UploadFile = File(...),
    category: str = Form(...),
    custom_category: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload d'un document dans la data room par le vendeur
    """
    if current_user["role"] != "seller":
        raise HTTPException(status_code=403, detail="Only sellers can upload documents")
    
    company = await db.companies.find_one({"id": company_id, "seller_id": current_user["id"]})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found or not authorized")
    
    content = await read_upload(file, ALLOWED_DOCUMENT_TYPES)
    # Chaque consultation par un repreneur est filigranée : un fichier non filigranable (PDF protégé par mot de passe,
    # illisible) est refusé dès le dépôt plutôt que servi en clair
    try:
        await asyncio.to_thread(apply_watermark, content, file.content_type, "CONFIDENTIEL - contrôle", True)
    except WatermarkError:
        raise HTTPException(status_code=400, detail="Ce document est protégé ou illisible : déposez un PDF non protégé par mot de passe "
                                                    "(ou une image JPEG, PNG, WebP) pour qu'il puisse être filigrané.")
    stored = await save_file(content, file.content_type, f"dataroom/{company_id}")
    
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "category": category,
        "custom_category": custom_category,
        "description": description,
        "filename": file.filename,
        "content_type": file.content_type,
        **stored,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": current_user["id"]
    }
    mark_test(doc, company, current_user)
    await db.dataroom.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("content", None)
    return doc

@api_router.get("/dataroom/{company_id}/documents")
async def list_dataroom_documents(company_id: str, current_user: dict = Depends(get_current_user)):
    """
    Liste les documents de la data room
    - Vendeur: voit tout
    - Acheteur: voit uniquement si accès accordé (identité, accord de confidentialité, origine des fonds)
    """
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    # Seller can always see
    if current_user["id"] == company.get("seller_id"):
        docs = await db.dataroom.find({"company_id": company_id}, {"_id": 0, "content": 0}).to_list(100)
        return {"documents": docs, "access_granted": True}
    
    # Accès du repreneur : demande acceptée, identité vérifiée, NDA signé, origine des fonds déclarée
    access = await db.dataroom_access.find_one({
        "company_id": company_id,
        "buyer_id": current_user["id"],
        "status": "granted"
    })
    
    if not access:
        return {"documents": [], "access_granted": False, "message": "L'accès au dossier s'ouvre après l'accord de confidentialité et la déclaration d'origine des fonds."}
    
    docs = await db.dataroom.find({"company_id": company_id}, {"_id": 0, "content": 0}).to_list(100)
    
    # Log access
    await db.dataroom_access_logs.insert_one({
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "user_id": current_user["id"],
        "accessed_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"documents": docs, "access_granted": True}

@api_router.post("/dataroom/{company_id}/documents/{doc_id}/view")
async def view_dataroom_document(company_id: str, doc_id: str, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """
    Visualise un document de la data room (avec filigrane et log d'accès)
    Retourne le document en base64 pour affichage avec filigrane
    """
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    # Check access
    can_access = False
    is_seller = current_user["id"] == company.get("seller_id")
    is_admin = current_user.get("role") == "admin"
    
    if is_seller or is_admin:
        can_access = True
    else:
        access = await db.dataroom_access.find_one({
            "company_id": company_id,
            "buyer_id": current_user["id"],
            "status": "granted"
        })
        if access:
            can_access = True
    
    if not can_access:
        raise api_error(403, "not_allowed", "L'accès au dossier s'ouvre après l'accord de confidentialité et la déclaration d'origine des fonds")
    
    doc = await db.dataroom.find_one({"id": doc_id, "company_id": company_id})
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
            logging.error(f"Data room {company_id} : document {doc_id} non filigranable, consultation refusée ({e})")
    
    # Log access (only for buyers, not sellers viewing their own docs)
    if not is_seller and not is_admin:
        access_log = {
            "id": str(uuid.uuid4()),
            "company_id": company_id,
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
            company_id=company_id,
            actor_id=current_user["id"],
            actor_email=current_user["email"],
            details={"document_id": doc_id, "document_name": doc.get("filename")}
        )
    
    if watermark_failed:
        raise api_error(409, "watermark_failed", "Ce document ne peut pas être filigrané (fichier protégé ou illisible) : "
                                                 "il n'est pas consultable. Demandez au cédant de déposer une version PDF non protégée.")
    
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

@api_router.get("/dataroom/{company_id}/access-log")
async def get_dataroom_access_log(company_id: str, current_user: dict = Depends(get_current_user)):
    """
    Récupère le journal d'accès à la data room (pour vendeur et admin)
    """
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    # Only seller or admin can view access log
    if current_user["id"] != company.get("seller_id") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    
    logs = await db.dataroom_access_logs.find(
        {"company_id": company_id},
        {"_id": 0}
    ).sort("timestamp", -1).to_list(500)
    
    labels = PartyLabels(current_user)
    for log in logs:
        log["viewer_label"] = await labels.label(log.get("viewer_id") or log.get("user_id"), company)
    return {"logs": scrub_contacts(logs, current_user)}

@api_router.get("/dataroom/{company_id}/audit-trail")
async def get_dataroom_audit_trail(company_id: str, current_user: dict = Depends(get_current_user)):
    """
    Récupère le journal d'audit blockchain-like pour une entreprise (vendeur et admin)
    Ce journal est immuable et peut servir de preuve juridique.
    """
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    # Only seller or admin can view audit trail
    if current_user["id"] != company.get("seller_id") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    
    logs = await db.audit_logs.find(
        {"company_id": company_id},
        {"_id": 0}
    ).sort("sequence", 1).to_list(1000)
    labels = PartyLabels(current_user)
    for log in logs:
        log["actor_label"] = await labels.label(log.get("actor_id"), company)
        log["target_label"] = await labels.label(log.get("target_id"), company) if log.get("target_id") else None
    
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

@api_router.get("/dataroom/{company_id}/documents/{doc_id}/download")
async def download_dataroom_document(company_id: str, doc_id: str, current_user: dict = Depends(get_current_user)):
    """
    DÉSACTIVÉ - Téléchargement non autorisé pour la data room sécurisée
    Les documents sont consultables uniquement via l'endpoint /view
    """
    raise HTTPException(
        status_code=403, 
        detail="Téléchargement non autorisé. Les documents de la data room sont consultables uniquement en ligne avec filigrane."
    )

@api_router.delete("/dataroom/{company_id}/documents/{doc_id}")
async def delete_dataroom_document(company_id: str, doc_id: str, current_user: dict = Depends(get_current_user)):
    """
    Supprime un document de la data room (vendeur uniquement)
    """
    if current_user["role"] != "seller":
        raise HTTPException(status_code=403, detail="Only sellers can delete documents")
    
    company = await db.companies.find_one({"id": company_id, "seller_id": current_user["id"]})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found or not authorized")
    
    doc = await db.dataroom.find_one({"id": doc_id, "company_id": company_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await delete_file(doc)
    await db.dataroom.delete_one({"id": doc_id, "company_id": company_id})
    
    return {"message": "Document deleted"}

# ============ DEMANDE DE DOSSIER (DATA ROOM) : demande → acceptation → identité → NDA → origine des fonds → accès ============
# API.md §4. Statuts d'une demande : pending → accepted (cédant ou acceptation automatique) → granted (les trois étapes
# faites) ; rejected ; expired (J+10 sans réponse). Les statuts `validated` / `loi_pending` de la vague 1 valent `accepted`.
DATAROOM_REQUEST_EXPIRY_DAYS = 10
DATAROOM_REMINDER_DAYS = (2, 5)
FUNDS_SOURCE_LABELS = {"fonds-propres": "fonds propres", "emprunt": "emprunt bancaire", "mixte": "apport personnel et emprunt",
                       "investisseurs": "investisseurs ou associés"}
DATAROOM_STEP_LABELS = {"identity": "vérifier votre identité", "nda": "signer l'accord de confidentialité",
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

async def dataroom_steps(company_id: str, buyer: dict, access: Optional[dict] = None) -> dict:
    """Étapes obligatoires après acceptation : identité vérifiée, NDA signé, origine des fonds déclarée"""
    nda = bool((access or {}).get("nda_signed_at")) or await has_signed_nda(company_id, buyer["id"])
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
    steps = await dataroom_steps(access["company_id"], buyer, access)
    if next_dataroom_step(steps):
        return False
    res = await db.dataroom_access.update_one({"id": access["id"], "status": {"$ne": "granted"}},
                                              {"$set": {"status": "granted", "granted_at": now.isoformat(), "steps": steps}})
    if res.modified_count == 0:
        return False
    company = await db.companies.find_one({"id": access["company_id"]}, {"_id": 0, "seller_id": 1, "title": 1, "company_name": 1})
    await system_message(access["company_id"], access["buyer_id"],
                         "Identité vérifiée, accord de confidentialité signé et origine des fonds déclarée : l'accès au dossier est ouvert.",
                         "dataroom_granted")
    await create_audit_log(action="DATAROOM_GRANTED", company_id=access["company_id"], actor_id="system", actor_email="",
                           target_id=access["buyer_id"], details={"request_id": access["id"]})
    await email_user(access["buyer_id"], "dataroom_granted", company_title=(company or {}).get("title") or "l'entreprise",
                     link=site_url(f"/dataroom/{access['company_id']}"))
    if company:
        await email_user(company.get("seller_id"), "dataroom_granted_seller",
                         buyer_name=display_name(buyer) or buyer_pseudonym(buyer["id"]), link=site_url("/seller/dashboard"))
    return True

async def accept_access_request(access: dict, company: dict, by: Optional[dict], now: datetime, auto: bool = False) -> None:
    """Acceptation (cédant ou automatique) : étapes communiquées au repreneur, e-mail « dossier accepté » avec la checklist"""
    await db.dataroom_access.update_one({"id": access["id"]}, {"$set": {
        "status": "accepted", "accepted_at": now.isoformat(), "validated_at": now.isoformat(), "auto_accepted": auto,
        "accepted_by": by["id"] if by else "auto"}, "$unset": {"expires_at": ""}})
    buyer = await db.users.find_one({"id": access["buyer_id"]}, USER_SAFE_PROJECTION) or {"id": access["buyer_id"]}
    steps = await dataroom_steps(company["id"], buyer, access)
    pending = [k for k in ("identity", "nda", "funds") if not steps.get(k)]
    checklist = " ; ".join(DATAROOM_STEP_LABELS[k] for k in pending) if pending else "toutes les étapes sont faites"
    content = ("Votre demande de dossier est acceptée automatiquement." if auto else "Le cédant a accepté votre demande de dossier.") \
        + " Prochaines étapes : " + checklist + "."
    await system_message(company["id"], access["buyer_id"], content, "access_accepted", receiver_id=access["buyer_id"])
    await create_audit_log(action="ACCESS_ACCEPTED", company_id=company["id"], actor_id=by["id"] if by else "auto",
                           actor_email=(by or {}).get("email") or "", target_id=access["buyer_id"], details={"request_id": access["id"], "auto": auto})
    checklist_html = "".join(f"<li>{html_escape(DATAROOM_STEP_LABELS[k])}</li>" for k in pending) \
        or "<li>toutes les étapes sont déjà faites : l'accès s'ouvre automatiquement</li>"
    await email_user(access["buyer_id"], "dataroom_accepted", company_title=company.get("title") or "l'entreprise",
                     checklist=checklist_html, link=site_url(f"/dataroom/{company['id']}"))
    if auto:
        card = await buyer_card(access["buyer_id"])
        await email_user(company.get("seller_id"), "dataroom_auto_accepted", buyer_label=card["label"], card_rows=buyer_card_html(card),
                         company_title=company.get("title") or "votre annonce", link=site_url("/seller/dashboard"))
    if not pending:
        await grant_dataroom_access({**access, "status": "accepted"}, now)

@api_router.post("/dataroom/{company_id}/request-access")
async def request_dataroom_access(company_id: str, background_tasks: BackgroundTasks, data: Optional[AccessRequestCreate] = None,
                                  current_user: dict = Depends(get_current_user)):
    """Demande de dossier du repreneur (adresse confirmée, profil ≥ 40) → {request_id, status: 'pending'|'accepted'}.
    Acceptation immédiate si l'annonce a l'option `auto_accept_dataroom` et que le profil est ≥ 50 ; sinon le cédant
    est relancé à J+2 et J+5 et la demande expire à J+10."""
    if current_user["role"] != "buyer":
        raise api_error(403, "not_allowed", "Seuls les repreneurs demandent l'accès au dossier")
    require_verified_email(current_user)
    require_buyer_profile(current_user)

    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company or company.get("status") != "published":
        raise HTTPException(status_code=404, detail="Entreprise introuvable")
    now = datetime.now(timezone.utc)
    message = ((data.message if data else None) or "").strip()

    existing = await db.dataroom_access.find_one({"company_id": company_id, "buyer_id": current_user["id"]}, {"_id": 0})
    if existing and existing.get("status") not in ("expired", "closed"):
        return {"request_id": existing["id"], "status": access_request_status(existing), "already_requested": True,
                "message": "Demande déjà enregistrée"}

    conversation, _ = await get_or_create_conversation(company, current_user["id"], now)
    access_request = {
        "id": existing["id"] if existing else str(uuid.uuid4()),
        "company_id": company_id, "buyer_id": current_user["id"], "buyer_email": current_user["email"],
        "conversation_id": conversation["id"], "status": "pending", "message": message or None,
        "requested_at": now.isoformat(), "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=DATAROOM_REQUEST_EXPIRY_DAYS)).isoformat(),
        "reminders_sent": [], "profile_score": buyer_profile_score(current_user),
    }
    mark_test(access_request, current_user, company, existing)
    if existing:
        await db.dataroom_access.replace_one({"id": existing["id"]}, access_request)
    else:
        await db.dataroom_access.insert_one(access_request)
    access_request.pop("_id", None)

    # Le repreneur demande le dossier ; le cédant reçoit la carte repreneur
    await store_message(conversation, current_user,
                        message or "Je souhaite consulter le dossier de cette entreprise. Pouvez-vous accepter ma demande ?",
                        now, message_type="access_request")
    await create_audit_log(action="ACCESS_REQUEST", company_id=company_id, actor_id=current_user["id"],
                           actor_email=current_user["email"], target_id=company.get("seller_id"), details={"request_id": access_request["id"]})
    if company.get("auto_accept_dataroom") and buyer_profile_score(current_user) >= SCORE_AUTO_ACCEPT_MIN:
        await accept_access_request(access_request, company, None, now, auto=True)
        return {"request_id": access_request["id"], "status": "accepted", "auto_accepted": True, "message": "Demande acceptée automatiquement"}
    card = await buyer_card(current_user["id"])
    background_tasks.add_task(email_user, company.get("seller_id"), "access_request", buyer_label=card["label"],
                              card_rows=buyer_card_html(card), message=message or "(sans message)",
                              company_title=company.get("title") or "votre annonce", link=site_url("/seller/dashboard"))
    return {"request_id": access_request["id"], "status": "pending", "message": "Demande transmise au cédant"}

async def access_request_view(req: dict, company: dict) -> dict:
    buyer = await db.users.find_one({"id": req["buyer_id"]}, USER_SAFE_PROJECTION)
    revealed = bool(req.get("identity_revealed")) or await has_signed_nda(company["id"], req["buyer_id"])
    card = await buyer_card(req["buyer_id"], revealed=revealed)
    steps = await dataroom_steps(company["id"], buyer or {"id": req["buyer_id"]}, req)
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

@api_router.get("/dataroom/{company_id}/access-requests")
async def get_access_requests(company_id: str, current_user: dict = Depends(get_current_user)):
    """Cédant : demandes de dossier avec carte repreneur et étapes → [{id, buyer_id, buyer_card, message, status, created_at, expires_at, steps}]"""
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company or (current_user.get("role") != "admin" and not is_company_owner(company, current_user)):
        raise HTTPException(status_code=404, detail="Company not found or not authorized")
    requests = await db.dataroom_access.find({"company_id": company_id, "buyer_id": {"$exists": True, "$ne": None},
                                              "status": {"$exists": True, "$ne": None}}, {"_id": 0}).sort("requested_at", -1).to_list(200)
    for req in requests:
        if not req.get("conversation_id"):
            conversation, _ = await get_or_create_conversation(company, req["buyer_id"])
            req["conversation_id"] = conversation["id"]
            await db.dataroom_access.update_one({"id": req["id"]}, {"$set": {"conversation_id": conversation["id"]}})
    rows = [await access_request_view(r, company) for r in requests]
    return scrub_contacts(rows, current_user)

async def _owned_request(company_id: str, request_id: str, current_user: dict) -> tuple:
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company or (current_user.get("role") != "admin" and not is_company_owner(company, current_user)):
        raise HTTPException(status_code=404, detail="Company not found or not authorized")
    access_request = await db.dataroom_access.find_one({"id": request_id, "company_id": company_id}, {"_id": 0})
    if not access_request:
        raise HTTPException(status_code=404, detail="Access request not found")
    return company, access_request

@api_router.put("/dataroom/{company_id}/access/{request_id}/validate")
async def validate_access_request(company_id: str, request_id: str, current_user: dict = Depends(get_current_user)):
    """Cédant : accepte la demande en un geste → {status:'accepted'} ; le repreneur passe aux étapes identité → NDA → fonds"""
    company, access_request = await _owned_request(company_id, request_id, current_user)
    status = access_request_status(access_request)
    if status == "accepted":
        return {"status": "accepted", "message": "Demande déjà acceptée"}
    if status not in ("pending", "expired"):
        raise api_error(400, "validation", "Cette demande a déjà été traitée")
    await accept_access_request(access_request, company, current_user, datetime.now(timezone.utc))
    return {"status": "accepted", "message": "Demande acceptée : le repreneur doit vérifier son identité, signer l'accord de confidentialité et déclarer l'origine des fonds"}

@api_router.put("/dataroom/{company_id}/access/{request_id}/reject")
async def reject_access_request(company_id: str, request_id: str, reason: Optional[str] = None, data: Optional[AccessRejectInput] = None,
                                current_user: dict = Depends(get_current_user)):
    """Cédant : refuse la demande (motif facultatif, en corps `{reason}` ou en paramètre)"""
    company, access_request = await _owned_request(company_id, request_id, current_user)
    reason = ((data.reason if data else None) or reason or "").strip() or None
    now = datetime.now(timezone.utc).isoformat()
    await db.dataroom_access.update_one({"id": request_id, "company_id": company_id},
                                        {"$set": {"status": "rejected", "rejected_at": now, "rejection_reason": reason}})
    await create_audit_log(action="ACCESS_REJECTED", company_id=company_id, actor_id=current_user["id"], actor_email=current_user["email"],
                           target_id=access_request.get("buyer_id"), details={"request_id": request_id, "reason": reason})
    if access_request.get("status") != "rejected":
        await system_message(company_id, access_request["buyer_id"], "Le cédant n'a pas donné suite à votre demande de dossier."
                             + (f" Motif : {reason}" if reason else ""), "access_rejected", receiver_id=access_request["buyer_id"])
        await email_user(access_request.get("buyer_id"), "access_rejected", reason=reason or "non précisé", link=site_url("/"))
    return {"status": "rejected", "message": "Demande refusée"}

@api_router.post("/dataroom/{company_id}/funds-declaration")
async def declare_funds(company_id: str, data: FundsDeclaration, current_user: dict = Depends(get_current_user)):
    """Déclaration d'origine des fonds (après identité et NDA) → accès accordé automatiquement {access_granted:true}"""
    if current_user["role"] != "buyer":
        raise api_error(403, "not_allowed", "Seuls les repreneurs déclarent l'origine des fonds")
    access = await dataroom_request_for(company_id, current_user["id"])
    status = access_request_status(access)
    if status not in ("accepted", "granted"):
        raise api_error(403, "not_allowed", "Le cédant doit d'abord accepter votre demande de dossier")
    if not is_user_verified(current_user):
        raise api_error(403, "identity_required", "Vérifiez votre identité avant de déclarer l'origine des fonds")
    if not (access.get("nda_signed_at") or await has_signed_nda(company_id, current_user["id"])):
        raise api_error(403, "nda_required", "Signez l'accord de confidentialité avant de déclarer l'origine des fonds")
    now = datetime.now(timezone.utc)
    declaration = {"source": data.source, "source_label": FUNDS_SOURCE_LABELS[data.source], "amount": float(data.amount),
                   "financing_partner": (data.financing_partner or "").strip() or None, "declared_at": now.isoformat(),
                   "declared_by": current_user["id"]}
    await db.dataroom_access.update_one({"id": access["id"]}, {"$set": {"funds_declaration": declaration, "funds_declared_at": now.isoformat()}})
    await create_audit_log(action="FUNDS_DECLARED", company_id=company_id, actor_id=current_user["id"], actor_email=current_user["email"],
                           details={"request_id": access["id"], "source": data.source, "amount": float(data.amount)})
    granted = await grant_dataroom_access({**access, "funds_declaration": declaration}, now)
    refreshed = await dataroom_request_for(company_id, current_user["id"])
    return {"access_granted": refreshed.get("status") == "granted", "granted_now": granted, "access_status": access_request_status(refreshed),
            "funds_declaration": declaration}

DATAROOM_OPEN_LISTING_STATUSES = ("published", "paused")

async def close_pending_dataroom_requests(company_id: str, listing_status: Optional[str], now) -> int:
    """Clôt les demandes de dossier en attente d'une annonce qui n'est plus en ligne (retirée, vendue autrement,
    retirée par l'administrateur) : message système au repreneur, aucune relance ni expiration ensuite."""
    at = now.isoformat() if isinstance(now, datetime) else str(now)
    closed = 0
    async for req in db.dataroom_access.find({"company_id": company_id, "status": "pending"}, {"_id": 0, "id": 1, "buyer_id": 1}):
        res = await db.dataroom_access.update_one({"id": req["id"], "status": "pending"}, {"$set": {
            "status": "closed", "closed_at": at, "closed_reason": f"listing_{listing_status or 'unknown'}"}})
        if res.modified_count:
            closed += 1
            await system_message(company_id, req["buyer_id"], "Cette annonce n'est plus en ligne : votre demande de dossier est close.",
                                 "access_closed", receiver_id=req["buyer_id"])
    return closed

async def job_dataroom_requests(now: datetime) -> int:
    """Demandes de dossier sans réponse : relances du cédant à J+2 et J+5 (carte repreneur), expiration à J+10 avec e-mail au repreneur"""
    count = 0
    async for req in db.dataroom_access.find({"status": "pending"}, {"_id": 0}):
        requested = _parse_dt(req.get("requested_at") or req.get("created_at"))
        if not requested:
            continue
        company = await db.companies.find_one({"id": req["company_id"]}, {"_id": 0, "id": 1, "seller_id": 1, "title": 1, "status": 1})
        if not company:
            continue
        if company.get("status") not in DATAROOM_OPEN_LISTING_STATUSES:
            # Annonce retirée, vendue ou supprimée : la demande est close, sans relance au cédant ni e-mail d'expiration
            await close_pending_dataroom_requests(company["id"], company.get("status"), now)
            continue
        # Une demande renouvelée après expiration garde son id : les clés de relance portent la date de la demande
        cycle = f"{req['id']}:{req.get('requested_at') or req.get('created_at')}"
        elapsed = (now - requested).days
        expires = _parse_dt(req.get("expires_at")) or (requested + timedelta(days=DATAROOM_REQUEST_EXPIRY_DAYS))
        if now >= expires:
            if not await claim_once("dataroom_request_expired", cycle):
                continue
            await db.dataroom_access.update_one({"id": req["id"]}, {"$set": {"status": "expired", "expired_at": now.isoformat()}})
            await system_message(req["company_id"], req["buyer_id"],
                                 "Le cédant n'a pas répondu à votre demande de dossier dans les 10 jours. Nous l'avons relancé ; vous pouvez renouveler votre demande.",
                                 "access_expired", receiver_id=req["buyer_id"])
            await email_user(req["buyer_id"], "dataroom_request_expired", company_title=company.get("title") or "l'entreprise",
                             link=site_url(f"/dataroom/{req['company_id']}"))
            count += 1
            continue
        due = [d for d in DATAROOM_REMINDER_DAYS if elapsed >= d]
        if not due:
            continue
        day = due[-1]
        # Relance d'une démarche engagée par un repreneur : transactionnelle (la page de désinscription promet que les
        # demandes de dossier continuent de parvenir), toujours limitée à une relance par jour et par personne
        if not await send_reminder(company.get("seller_id"), "dataroom_request_reminder", f"{cycle}:{day}", now,
                                   template="dataroom_request_reminder", transactional=True, days=str(day),
                                   buyer_label=buyer_pseudonym(req["buyer_id"]), company_title=company.get("title") or "votre annonce",
                                   expires_at=fmt_date_fr(expires), link=site_url("/seller/dashboard")):
            continue
        await db.dataroom_access.update_one({"id": req["id"]}, {"$push": {"reminders_sent": {"day": day, "at": now.isoformat()}}})
        count += 1
    return count

@api_router.post("/admin/dataroom/{request_id}/remind")
async def admin_remind_dataroom_request(request_id: str, current_user: dict = Depends(require_admin)):
    """Admin (todo « Demandes de dossier sans réponse ») : relance humaine du cédant pour une demande en attente,
    au plus une fois par jour et par demande (e-mail transactionnel, indépendant des relances J+2/J+5) → {sent, reminded_at}"""
    req = await db.dataroom_access.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise api_error(404, "not_found", "Demande introuvable")
    if req.get("status") != "pending":
        raise api_error(400, "validation", "Cette demande n'est plus en attente de réponse")
    company = await db.companies.find_one({"id": req["company_id"]}, {"_id": 0, "id": 1, "seller_id": 1, "title": 1, "status": 1})
    if not company or company.get("status") not in DATAROOM_OPEN_LISTING_STATUSES:
        raise api_error(400, "validation", "L'annonce n'est plus en ligne")
    now = datetime.now(timezone.utc)
    if not await claim_once("dataroom_request_admin_reminder", f"{request_id}:{now.strftime('%Y-%m-%d')}"):
        raise api_error(409, "already_reminded", "Le cédant a déjà été relancé aujourd'hui pour cette demande")
    requested = _parse_dt(req.get("requested_at") or req.get("created_at")) or now
    expires = _parse_dt(req.get("expires_at")) or (requested + timedelta(days=DATAROOM_REQUEST_EXPIRY_DAYS))
    await email_user(company.get("seller_id"), "dataroom_request_reminder", days=str(max((now - requested).days, 1)),
                     buyer_label=buyer_pseudonym(req["buyer_id"]), company_title=company.get("title") or "votre annonce",
                     expires_at=fmt_date_fr(expires), link=site_url("/seller/dashboard"))
    await db.dataroom_access.update_one({"id": request_id}, {"$push": {"reminders_sent": {"day": "admin", "at": now.isoformat(),
                                                                                         "by": current_user["id"]}}})
    await create_audit_log(action="ACCESS_REQUEST_REMINDED", company_id=company["id"], actor_id=current_user["id"],
                           actor_email=current_user["email"], target_id=company.get("seller_id"), details={"request_id": request_id})
    return {"sent": True, "reminded_at": now.isoformat()}

def commission_info_for(company: dict) -> dict:
    """Commission affichée sur la fiche : toujours à la charge du cédant (barème v2). Les anciennes annonces dont le
    mandat (v1) désignait le repreneur comme débiteur gardent leur bandeau : aucune nouvelle ne peut l'avoir."""
    legacy_payer = company.get("commission_payer")
    payer = "repreneur" if legacy_payer == "repreneur" else COMMISSION_PAYER
    info = {
        "payer": payer,
        "rate_percent_ht": "6 %",
        "minimum_ht": commission_minimum_ht(),
        "terms_version": company.get("commission_terms_version") or ("v1" if legacy_payer else COMMISSION_TERMS_VERSION),
        "estimate_ht": None,
        "estimate_ttc": None,
    }
    if company.get("asking_price"):
        c = calculate_commission(float(company["asking_price"]))
        info.update({"estimate_ht": c["final_commission_ht"], "estimate_ttc": c["final_commission_ttc"], "base": "prix demandé"})
    return info

def buyer_commission_clause(company: dict) -> str:
    """Clause d'information de l'acquéreur, uniquement pour les anciennes annonces (mandat v1, repreneur débiteur)"""
    info = commission_info_for(company)
    if info["payer"] != "repreneur":
        return ""
    estimate = ""
    if info.get("estimate_ttc") is not None:
        eur = lambda v: f"{v:,.0f}".replace(",", " ") + " €"
        estimate = (f" À titre indicatif, sur la base du prix demandé, elle s'élèverait à {eur(info['estimate_ttc'])} TTC "
                    f"({eur(info['estimate_ht'])} HT) ; son montant définitif est calculé sur le prix de cession.")
    return ("Commission à la charge de l'Acheteur — Information\n\n"
            "Aux termes du mandat confié par le Vendeur, la commission de cession est à la charge de l'Acheteur, "
            f"en cas de réalisation de l'opération uniquement, selon le barème suivant : {commission_scale_text()}.{estimate} "
            "Aucune somme n'est due avant la signature de l'acte de cession.\n\n")

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

SALE_OBJECT_CESSION = {
    "titres": "la cession de la totalité des titres de la société {name}",
    "fonds": "la cession du fonds de commerce exploité par la société {name}",
    "indifferent": "la cession de la société {name}, par cession de titres ou de fonds de commerce au choix des parties",
}
SALE_OBJECT_ACQUISITION = {
    "titres": "la totalité des titres de la société {name}",
    "fonds": "le fonds de commerce exploité par la société {name}",
}
SALE_OBJECT_LABELS = {"titres": "cession de titres", "fonds": "cession de fonds de commerce", "indifferent": "titres ou fonds de commerce"}
MANDANT_CAPACITY_LABELS = {"dirigeant": "dirigeant", "associe": "associé", "mandataire": "mandataire des associés"}

def company_siege(company: dict) -> str:
    """Siège : adresse connue, sinon département et région (jamais vide)"""
    if company.get("address"):
        return fmt_address(company["address"])
    parts = []
    if company.get("department"):
        parts.append(taxonomy.departement_label(company["department"]))
    if company.get("region"):
        parts.append(str(company["region"]))
    return ", ".join(p for p in parts if p) or "France"

def company_activity_label(company: dict) -> str:
    labels = [taxonomy.trade_label(t, short=True) for t in (company.get("trades") or []) if taxonomy.trade_by_id(t)]
    return ", ".join(labels) if labels else "entreprise du bâtiment"

def company_qualifications_label(company: dict) -> str:
    rge = list(company.get("rge_types") or [])
    others = [taxonomy.other_qualification_label(q) for q in (company.get("other_qualifications") or [])]
    items = rge + [o for o in others if o]
    return ", ".join(items) if items else "aucune qualification déclarée"

def mandant_capacity(company: dict, user: dict) -> str:
    """Qualité du signataire : déclarée sur l'annonce (`mandant_capacity`), sinon déduite du contrôle de dirigeant"""
    declared = MANDANT_CAPACITY_LABELS.get(company.get("mandant_capacity") or "")
    if declared:
        return declared
    checks = company.get("company_checks") or {}
    if company.get("president_id") == user.get("id") or company.get("dirigeant_verified") \
            or checks.get("dirigeant_match") in ("match_exact", "match_partial"):
        return "dirigeant"
    return "mandataire des associés"

def company_contract_variables(company: dict) -> dict:
    """Variables communes aux contrats décrivant l'entreprise (toutes renseignées, jamais de blanc)"""
    siret = re.sub(r"\D", "", str(company.get("siret") or ""))
    siren = re.sub(r"\D", "", str(company.get("siren") or siret[:9]))
    return {
        "CIBLE_DENOMINATION": company.get("company_name") or "",
        "CIBLE_FORME_JURIDIQUE": company.get("legal_form") or company.get("legal_structure") or "société",
        "CIBLE_SIREN": fmt_siren_fr(siren) or "non communiqué",
        "CIBLE_SIEGE": company_siege(company),
        "CIBLE_ACTIVITE": company_activity_label(company),
        "CIBLE_LOCALISATION": ", ".join(p for p in [taxonomy.departement_label(company["department"]) if company.get("department") else "",
                                                     str(company.get("region") or "")] if p) or "France",
        "CIBLE_QUALIFICATIONS": company_qualifications_label(company),
        "RGE_TYPES": ", ".join(company.get("rge_types") or []),
        "PRIX_DEMANDE": fmt_eur_fr(company["asking_price"]) if company.get("asking_price") else "non communiqué",
        "BAREME_COMMISSION": commission_scale_text(),
        "MARQUE": site_name(),
        "CARTE_T": LEGAL_ENTITY["carte_t"],
        "CARTE_T_CCI": LEGAL_ENTITY["carte_t_issuer"],
        "CARTE_T_VALIDITE": LEGAL_ENTITY["carte_t_valid_until"],
        "RC_PRO": ("RC professionnelle : " + LEGAL_ENTITY["rc_pro"] + ".") if LEGAL_ENTITY.get("rc_pro")
                  else "RC professionnelle souscrite conformément à la loi Hoguet.",
        "PLATEFORME_CAPITAL": fmt_eur_fr(LEGAL_ENTITY.get("capital") or 0),
        "PLATEFORME_SIREN": fmt_siren_fr(LEGAL_ENTITY["siren"]),
        "ANNONCE_REF": f"PRJ-{(company.get('id') or '')[:8].upper()}",
        "PROJET_CODE": f"PRJ-{(company.get('id') or '')[:8].upper()}",
        "LISTING_ID": company.get("id", ""),
    }

def buyer_identity_text(user: dict) -> str:
    """Identité du repreneur telle que vérifiée (rapport Stripe : nom, prénom, date de naissance si disponible),
    adresse e-mail confirmée, société et SIREN s'ils existent. Aucune mention vide."""
    first = user.get("verified_first_name") or user.get("first_name") or ""
    last = user.get("verified_last_name") or user.get("last_name") or ""
    text = f"{first} {last}".strip() or "Repreneur"
    birth = user.get("verified_birth_date") or user.get("birth_date")
    if birth:
        text += f", né(e) le {fmt_date_fr(birth) or birth}"
    text += f", adresse électronique confirmée : {user.get('email', '')}"
    profile = user.get("buyer_profile") or {}
    company = user.get("company_name") or profile.get("company_name")
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
        "company_id": contract.get("company_id"),
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
    return f"/api/documents/{record.get('company_id')}/{record['id']}/pdf"

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

async def presented_buyers_view(company: dict) -> list:
    """Repreneurs présentés (NDA signé) : pseudonyme, nom et société révélés après NDA"""
    rows = []
    for p in company.get("presented_buyers") or []:
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

async def add_presented_buyer(company_id: str, buyer_id: str, contract_id: str, now: datetime) -> bool:
    """Inscrit le repreneur sur la liste nominative des présentés (une seule fois)"""
    res = await db.companies.update_one(
        {"id": company_id, "presented_buyers.buyer_id": {"$ne": buyer_id}},
        {"$push": {"presented_buyers": {"buyer_id": buyer_id, "at": now.isoformat(), "nda_contract_id": contract_id}}})
    return res.modified_count > 0

# ---- PDF d'un document signé avec page de preuve ----
CONTRACT_TITLES = {"mandat": "Mandat de vente simple", "nda": "Accord de confidentialité", "offer": "Offre indicative d'acquisition",
                   "loi": "Lettre d'intention (document antérieur à la version du 10/10/2026)"}

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
    return {"seller": "le Mandant (cédant)", "buyer": "le Repreneur", "platform": f"{LEGAL_ENTITY['denomination']} SAS"}.get(role or "", role or "")

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
        proofs.append({"label": r.get("label") or {"mandat": "mandat", "mandat_renewal": "prolongation du mandat", "nda": "accord de confidentialité",
                                                    "offer": "offre", "offer_counter_proposal": "contre-proposition du cédant",
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
    if contract.get("type") == "mandat" and contract.get("status") in ("denounced", "expired", "void"):
        label = {"denounced": f"Mandat dénoncé le {fmt_date_fr(contract.get('denounced_at'))}, effet le {fmt_date_fr(contract.get('effective_at'))}",
                 "expired": f"Mandat arrivé à échéance le {fmt_date_fr(contract.get('ends_at'))}",
                 "void": f"Mandat caduc depuis le {fmt_date_fr(contract.get('void_at'))} ({contract.get('void_reason') or 'annonce retirée'})"}[contract["status"]]
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
                          "rejected": "refusé", "cancelled": "annulé"}

def pdf_response(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "private, no-store"})

# ============ ACCORD DE CONFIDENTIALITÉ v2 (SPEC §3.3) ============
class GetContractForSignatureRequest(BaseModel):
    company_id: str
    doc_type: Literal["nda"]  # la lettre d'intention n'est plus générée (offre indicative, §3.4)

# Variables qui lèvent l'anonymat : masquées dans le NDA tant qu'il n'est pas signé
NDA_REVEALED_VARIABLES = ["CIBLE_DENOMINATION", "CIBLE_FORME_JURIDIQUE", "CIBLE_SIREN", "CIBLE_SIEGE", "VENDEUR_PRENOM", "VENDEUR_NOM"]
NDA_HIDDEN_PLACEHOLDER = "[communiqué après signature]"
# Statuts d'une demande de dossier acceptée par le cédant (`accepted` en v2 ; `validated` / `loi_pending` : données
# antérieures à la refonte du parcours, équivalentes à `accepted`)
DATAROOM_ACCEPTED_STATUSES = ("accepted", "granted", "validated", "loi_pending")

async def dataroom_request_for(company_id: str, buyer_id: str) -> Optional[dict]:
    return await db.dataroom_access.find_one({"company_id": company_id, "buyer_id": buyer_id}, {"_id": 0})

@api_router.post("/contracts/generate-for-signature")
async def generate_contract_for_signature(data: GetContractForSignatureRequest, current_user: dict = Depends(get_current_user)):
    """Génère l'accord de confidentialité du repreneur pour une annonce (texte masqué jusqu'à la signature).
    Exige : rôle repreneur, adresse e-mail confirmée, identité vérifiée (403 `identity_required`) et demande de dossier
    acceptée par le cédant (403 `not_allowed`)."""
    if current_user.get("role") != "buyer":
        raise api_error(403, "not_allowed", "Seuls les repreneurs signent l'accord de confidentialité")
    company = await db.companies.find_one({"id": data.company_id}, {"_id": 0})
    if not company or company.get("status") != "published":
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")
    require_verified_email(current_user)
    if not is_user_verified(current_user):
        raise api_error(403, "identity_required", "Vérifiez votre identité avant de signer l'accord de confidentialité")
    access = await dataroom_request_for(data.company_id, current_user["id"])
    if not access or access.get("status") not in DATAROOM_ACCEPTED_STATUSES:
        raise api_error(403, "not_allowed", "Le cédant doit d'abord accepter votre demande de dossier")

    existing_signature = await db.documents.find_one({"company_id": data.company_id, "doc_type": "nda", "signer_id": current_user["id"]})
    if existing_signature:
        existing_contract = await db.generated_contracts.find_one(
            {"company_id": data.company_id, "buyer_id": current_user["id"], "type": "nda", "status": "signed"}, {"_id": 0})
        return {"already_signed": True, "contract": existing_contract, "message": "Accord de confidentialité déjà signé"}

    seller = await db.users.find_one({"id": company.get("seller_id")}, {"_id": 0, "password_hash": 0})
    template_doc = await db.contract_templates.find_one({"type": "nda"}, {"_id": 0})
    template = template_doc["content"] if template_doc else DEFAULT_NDA_TEMPLATE
    settings_doc = await db.platform_settings.find_one({"type": "contracts"}, {"_id": 0})
    settings = {**DEFAULT_PLATFORM_SETTINGS, **(settings_doc["settings"] if settings_doc else {})}
    now = datetime.now(timezone.utc)

    existing_contract = await db.generated_contracts.find_one(
        {"company_id": data.company_id, "buyer_id": current_user["id"], "type": "nda", "status": {"$in": ["draft", "pending_signature"]}}, {"_id": 0})
    contract_number = existing_contract["contract_number"] if existing_contract else f"NDA-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    variables = {
        **settings,
        "REPRENEUR_IDENTITE": buyer_identity_text(current_user),
        "VENDEUR_PRENOM": (seller.get("first_name") or "") if seller else "",
        "VENDEUR_NOM": (seller.get("last_name") or "") if seller else "",
        **company_contract_variables(company),
        "NDA_NUMERO": contract_number,
        "DATE_SIGNATURE": SIGNATURE_DATE_PENDING,
    }
    full_content = render_template(template, variables)
    missing = missing_template_variables(full_content)
    if missing:
        raise api_error(400, "validation", "Le texte de l'accord ne peut pas être complété", missing=missing)
    # L'identité du cédant et de la société n'est révélée qu'une fois l'accord signé (Annexe A)
    generated_content = render_template(template, {**variables, **{k: NDA_HIDDEN_PLACEHOLDER for k in NDA_REVEALED_VARIABLES}})
    nda_test = is_test_context(current_user, company, existing_contract)
    full_content = with_test_banner(full_content, nda_test)
    generated_content = with_test_banner(generated_content, nda_test)

    if existing_contract:
        # Le projet non signé est régénéré avec les données à jour (le code en cours reste lié au même identifiant)
        regenerated = {"content": generated_content, "content_after_signature": full_content, "updated_at": now.isoformat()}
        if nda_test:
            regenerated["is_test"] = True
        await db.generated_contracts.update_one({"id": existing_contract["id"]}, {"$set": regenerated})
        return {"already_signed": False, "contract_id": existing_contract["id"], "contract_number": contract_number,
                "content": generated_content, "type": "nda", "terms_version": "v2", "terms_date": CONTRACT_TERMS_DATE}

    contract_doc = {
        "id": str(uuid.uuid4()),
        "contract_number": contract_number,
        "type": "nda",
        "company_id": data.company_id,
        "buyer_id": current_user["id"],
        "seller_id": company.get("seller_id"),
        "content": generated_content,
        "content_after_signature": full_content,
        "status": "pending_signature",
        "signers_pending": [current_user["id"]],
        "terms_version": "v2",
        "terms_date": CONTRACT_TERMS_DATE,
        "created_at": now.isoformat(),
        "auto_generated": True,
    }
    if nda_test:
        contract_doc["is_test"] = True
    await db.generated_contracts.insert_one(contract_doc)
    return {"already_signed": False, "contract_id": contract_doc["id"], "contract_number": contract_number,
            "content": generated_content, "type": "nda", "terms_version": "v2", "terms_date": CONTRACT_TERMS_DATE}

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

DOC_LABELS = {"mandat": "mandat de vente simple", "nda": "accord de confidentialité", "offer": "offre indicative"}

@api_router.post("/signatures/request-code")
@limiter.limit("10/minute")
async def request_signature_code(request: Request, data: SignatureCodeRequest, background_tasks: BackgroundTasks,
                                 current_user: dict = Depends(get_current_user)):
    """Envoie par e-mail un code à 6 chiffres permettant de signer ce document (10 minutes, 5 essais).
    Exige une adresse e-mail confirmée (double opt-in) et une identité vérifiée. Sert aussi à la contre-signature
    d'une offre par le cédant et à la prolongation d'un mandat."""
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
            # « test » : identité simulée en mode test (MODE-TEST-ET-APP.md §B.2.3), sans valeur probante
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
    """Signature par le repreneur d'un accord de confidentialité ou d'une offre indicative (code reçu par e-mail).
    NDA signé : identité du cédant révélée, repreneur inscrit sur la liste des présentés, PDF envoyé aux deux parties.
    Offre signée : passe à `pending`, le cédant est prévenu. Le mandat se signe par POST /seller/mandat/{id}/sign."""
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
    company = await db.companies.find_one({"id": contract.get("company_id")}, {"_id": 0})
    now = datetime.now(timezone.utc)

    if contract.get("type") == "offer":
        return await _offer_after_buyer_signature(contract, company, current_user, evidence, now)

    # ---- Accord de confidentialité ----
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
                  # Le NDA signé révèle l'identité de la cible (Annexe A)
                  "content": signed_content, "content_after_signature": signed_content}})

    # Liste nominative des présentés, identité révélée dans la conversation et la demande de dossier
    await add_presented_buyer(contract["company_id"], current_user["id"], contract_id, now)
    await db.dataroom_access.update_many({"company_id": contract["company_id"], "buyer_id": current_user["id"]},
                                         {"$set": {"nda_signed_at": now.isoformat(), "identity_revealed": True, "identity_revealed_at": now.isoformat()}})
    await db.conversations.update_many({"company_id": contract["company_id"], "buyer_id": current_user["id"]},
                                       {"$set": {"nda_signed": True, "identity_revealed": True, "identity_revealed_at": now.isoformat()}})
    # Origine des fonds déjà déclarée : l'accès au dossier s'ouvre dès maintenant (parcours §4.3.5)
    nda_access = await dataroom_request_for(contract["company_id"], current_user["id"])
    if nda_access and nda_access.get("funds_declaration"):
        await grant_dataroom_access({**nda_access, "nda_signed_at": now.isoformat()}, now)
    await db.contact_reveal_logs.insert_many([
        {"id": str(uuid.uuid4()), "who": current_user["id"], "what": "identite_cible", "subject_id": contract.get("company_id"),
         "company_id": contract.get("company_id"), "justification": {"nda_id": contract_id, "contract_number": contract.get("contract_number")},
         "when": now.isoformat()},
        {"id": str(uuid.uuid4()), "who": company.get("seller_id") if company else None, "what": "identite_acquereur",
         "subject_id": current_user["id"], "company_id": contract.get("company_id"),
         "justification": {"nda_id": contract_id, "contract_number": contract.get("contract_number")}, "when": now.isoformat()},
    ])
    await db.messages.insert_one({
        "id": str(uuid.uuid4()), "sender_id": current_user["id"], "sender_email": current_user["email"],
        "receiver_id": company.get("seller_id") if company else None, "company_id": contract.get("company_id"),
        "content": f"J'ai signé l'accord de confidentialité n° {contract.get('contract_number')}. Mon identité vous est communiquée.",
        "message_type": "nda_signed", "kind": "system", "contract_number": contract.get("contract_number"), "read": False, "created_at": now.isoformat()})
    await create_audit_log(action="NDA_SIGNED", company_id=contract.get("company_id"), actor_id=current_user["id"],
                           actor_email=current_user["email"], details={"contract_id": contract_id, "contract_number": contract.get("contract_number")})
    # Exemplaire PDF (lien authentifié) aux deux parties
    pdf_link = document_pdf_link(record)
    buyer_name = (record["evidence"].get("identity") or {}).get("verified_name") or display_name(current_user) or buyer_pseudonym(current_user["id"])
    if company:
        await email_user(company.get("seller_id"), "nda_signed_seller", buyer_name=buyer_name,
                         contract_number=contract.get("contract_number", ""), pdf_link=pdf_link)
    await email_user(current_user["id"], "nda_signed_buyer", contract_number=contract.get("contract_number", ""), pdf_link=pdf_link,
                     next_step="déclarez l'origine des fonds envisagés depuis votre espace ; l'accès au dossier s'ouvre ensuite automatiquement.")
    return {"message": "Accord de confidentialité signé avec succès", "contract_number": contract.get("contract_number"),
            "signature_hash": record["signature_hash"], "signed_at": now.isoformat(), "document_id": record["id"],
            "pdf_url": document_pdf_path(record), "identity_revealed": True}

# ============ DOCUMENTS SIGNÉS (API.md §4) ============
async def signed_documents_query(company_id: str, current_user: dict) -> dict:
    """Le vendeur de l'annonce et l'admin voient toutes les signatures, les autres uniquement les leurs"""
    query = {"company_id": company_id}
    if current_user.get("role") != "admin":
        company = await db.companies.find_one({"id": company_id}, {"_id": 0, "seller_id": 1, "president_id": 1})
        if not company or not is_company_owner(company, current_user):
            query["signer_id"] = current_user["id"]
    return query

def signed_document_view(record: dict) -> dict:
    return {
        "id": record["id"], "doc_type": record.get("doc_type"), "contract_id": record.get("contract_id"),
        "contract_number": record.get("contract_number"), "signer_id": record.get("signer_id"), "signer_role": record.get("signer_role"),
        "signed_at": record.get("signed_at"), "signature_hash": record.get("signature_hash"), "evidence_sha256": record.get("evidence_sha256"),
        "evidence": public_evidence(record.get("evidence")), "pdf_url": document_pdf_path(record),
    }

@api_router.get("/documents/{company_id}/signed")
async def get_signed_documents(company_id: str, current_user: dict = Depends(get_current_user)):
    """Documents signés pour une annonce avec leurs métadonnées de preuve :
    [{id, doc_type, signed_at, evidence: {document_sha256, previous_evidence_sha256, ip, user_agent, identity}, pdf_url}]"""
    query = await signed_documents_query(company_id, current_user)
    docs = await db.documents.find(query, {"_id": 0}).sort("signed_at", 1).to_list(200)
    company = await db.companies.find_one({"id": company_id}, {"_id": 0, "id": 1, "seller_id": 1, "president_id": 1})
    labels = PartyLabels(current_user)
    rows = []
    for d in docs:
        view = signed_document_view(d)
        view["signer_label"] = await labels.label(d.get("signer_id"), company)
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
    company = await db.companies.find_one({"id": record.get("company_id")}, {"_id": 0, "seller_id": 1, "president_id": 1})
    return bool(company) and is_company_owner(company, user)

@api_router.get("/documents/{company_id}/{doc_id}/pdf")
async def get_signed_document_pdf(company_id: str, doc_id: str, token: Optional[str] = None,
                                  current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Exemplaire PDF d'un document signé (texte intégral + page de preuve). Accès : signataire, parties au contrat,
    propriétaire de l'annonce, admin, ou lien authentifié par jeton (e-mails)."""
    record = await db.documents.find_one({"id": doc_id, "company_id": company_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Document introuvable")
    contract = await db.generated_contracts.find_one({"id": record.get("contract_id")}, {"_id": 0})
    if not await _document_access_allowed(record, contract, current_user, token):
        raise HTTPException(status_code=403, detail="Non autorisé")
    if not contract:
        raise HTTPException(status_code=404, detail="Contrat introuvable")
    pdf = await contract_pdf_bytes(contract)
    return pdf_response(pdf, f"{contract.get('type', 'document')}_{contract.get('contract_number', doc_id)}.pdf")
@api_router.get("/dataroom/{company_id}/access-status")
async def get_access_status(company_id: str, current_user: dict = Depends(get_current_user)):
    """Statut du parcours d'accès au dossier (API.md §4) : {access_granted, access_status, steps: {identity, nda, funds},
    next_step, request: {id, created_at, expires_at}}"""
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    if is_company_owner(company, current_user) or current_user.get("role") == "admin":
        return {"access_granted": True, "is_seller": True, "access_status": "granted", "steps": {"identity": True, "nda": True, "funds": True},
                "next_step": None, "request": None}
    access = await db.dataroom_access.find_one({"company_id": company_id, "buyer_id": current_user["id"]}, {"_id": 0})
    status = access_request_status(access)
    steps = await dataroom_steps(company_id, current_user, access)
    if status == "accepted" and not next_dataroom_step(steps):
        # Les trois étapes sont faites (par exemple identité vérifiée après la déclaration) : accès ouvert
        if await grant_dataroom_access(access):
            status = "granted"
    conversation = await db.conversations.find_one({"company_id": company_id, "buyer_id": current_user["id"]}, {"_id": 0, "id": 1})
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
# Une conversation par couple (annonce, repreneur) dans `db.conversations` ; les messages antérieurs (sans
# `conversation_id`) sont rattachés à la volée par `migrate_legacy_conversations` en les regroupant par (company_id, repreneur).
async def get_or_create_conversation(company: dict, buyer_id: str, now: Optional[datetime] = None) -> tuple:
    """(conversation, créée ?) du couple annonce / repreneur"""
    now = now or datetime.now(timezone.utc)
    existing = await db.conversations.find_one({"company_id": company["id"], "buyer_id": buyer_id}, {"_id": 0})
    if existing:
        return existing, False
    nda = await has_signed_nda(company["id"], buyer_id)
    doc = {
        "id": str(uuid.uuid4()), "company_id": company["id"], "buyer_id": buyer_id,
        "seller_id": company.get("seller_id") or company.get("president_id"),
        "created_at": now.isoformat(), "last_at": now.isoformat(), "last_message": "", "last_sender_id": None,
        "nda_signed": nda, "identity_revealed": nda,
    }
    mark_test(doc, company, await db.users.find_one({"id": buyer_id}, {"_id": 0, "is_test": 1}))
    await db.conversations.insert_one(doc)
    doc.pop("_id", None)
    return doc, True

async def migrate_legacy_conversations(user: dict) -> None:
    """Rattache les messages historiques de l'utilisateur (sans conversation_id) à une conversation par (annonce, repreneur)"""
    query = {"conversation_id": {"$exists": False}, "$or": [{"sender_id": user["id"]}, {"receiver_id": user["id"]}]}
    legacy = await db.messages.find(query, {"_id": 0, "id": 1, "company_id": 1, "sender_id": 1, "receiver_id": 1, "created_at": 1, "content": 1}).to_list(5000)
    if not legacy:
        return
    companies = {}
    for m in legacy:
        cid = m.get("company_id")
        if not cid:
            continue
        if cid not in companies:
            companies[cid] = await db.companies.find_one({"id": cid}, {"_id": 0, "id": 1, "seller_id": 1, "president_id": 1})
        company = companies[cid]
        if not company:
            continue
        owners = {company.get("seller_id"), company.get("president_id")} - {None}
        buyer_id = m.get("receiver_id") if m.get("sender_id") in owners else m.get("sender_id")
        if not buyer_id or buyer_id in owners:
            continue
        conversation, _ = await get_or_create_conversation(company, buyer_id, _parse_dt(m.get("created_at")) or datetime.now(timezone.utc))
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
        company = await db.companies.find_one({"id": conversation["company_id"]}, {"_id": 0, "seller_id": 1, "president_id": 1})
        if not company or not is_company_owner(company, user):
            raise api_error(403, "not_allowed", "Vous n'êtes pas partie à cette conversation")
    return conversation

def conversation_receiver(conversation: dict, sender: dict) -> Optional[str]:
    return conversation.get("seller_id") if sender["id"] == conversation.get("buyer_id") else conversation.get("buyer_id")

async def buyer_card(buyer_id: str, revealed: bool = False) -> dict:
    """Carte repreneur (API.md §3) : pseudonymisée avant NDA (projet, budget, financement, zones, métiers, horizon,
    société vérifiée, score), nom et société après NDA. Jamais de coordonnées."""
    user = await db.users.find_one({"id": buyer_id}, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "company_name": 1,
                                                       "verified_first_name": 1, "verified_last_name": 1, "phone": 1,
                                                       "buyer_profile": 1, "identity_verified": 1, "kyc_status": 1, "created_at": 1})
    profile = (user or {}).get("buyer_profile") or {}
    card = {
        "buyer_id": buyer_id, "label": buyer_pseudonym(buyer_id),
        "project_type": profile.get("project_type"), "budget_max": profile.get("budget_max"), "apport": profile.get("apport"),
        "financing": profile.get("financing"), "zones": profile.get("zones") or [], "trades": profile.get("trades") or [],
        "horizon": profile.get("horizon"), "experience": profile.get("experience"),
        "siren_verified": profile.get("siren_verified") is True, "profile_score": buyer_profile_score(user or {}),
        "identity_verified": is_user_verified(user or {}), "member_since": (user or {}).get("created_at"),
    }
    if revealed and user:
        name = f"{user.get('verified_first_name') or user.get('first_name') or ''} {user.get('verified_last_name') or user.get('last_name') or ''}".strip()
        card["name"] = name or None
        card["company_name"] = user.get("company_name") or profile.get("company_name")
    return card

def buyer_card_html(card: dict) -> str:
    """Carte repreneur en HTML pour les e-mails (valeurs échappées)"""
    labels = {"reprise-individuelle": "Reprise individuelle", "croissance-externe": "Croissance externe",
              "groupe-investisseur": "Groupe ou investisseur", "autre": "Autre projet",
              "fonds-propres": "Fonds propres", "emprunt": "Emprunt", "mixte": "Apport et emprunt", "a-definir": "À définir",
              "0-6": "Dans les 6 mois", "6-12": "Dans 6 à 12 mois", "12+": "Dans plus d'un an"}
    rows = []
    if card.get("name"):
        rows.append(("Repreneur", card["name"] + (f" — {card['company_name']}" if card.get("company_name") else "")))
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
    if card.get("trades"):
        rows.append(("Métiers", ", ".join(taxonomy.trade_label(t, short=True) for t in card["trades"])))
    if card.get("horizon"):
        rows.append(("Horizon", labels.get(card["horizon"], card["horizon"])))
    rows.append(("Société vérifiée", "oui (SIREN contrôlé au registre national)" if card.get("siren_verified") else "non"))
    rows.append(("Profil", f"complet à {card.get('profile_score', 0)} %"))
    return "".join(f"<li><strong>{html_escape(k)} :</strong> {html_escape(str(v))}</li>" for k, v in rows)

async def register_contact(company: dict, buyer_id: str, now: datetime) -> None:
    """Enregistrement du premier contact (statistiques, suivi à 30 jours) et compteur de l'annonce"""
    existing = await db.contacts.find_one({"buyer_id": buyer_id, "company_id": company["id"]})
    if existing:
        return
    await db.contacts.insert_one({"id": str(uuid.uuid4()), "buyer_id": buyer_id, "company_id": company["id"],
                                  "seller_id": company.get("seller_id"), "created_at": now.isoformat()})
    await db.companies.update_one({"id": company["id"]}, {"$inc": {"contacts_count": 1}})

async def store_message(conversation: dict, sender: dict, content: str, now: Optional[datetime] = None,
                        kind: str = "message", message_type: Optional[str] = None, **extra) -> dict:
    """Enregistre un message dans la conversation : coordonnées masquées tant que le NDA n'est pas signé (contournement),
    dernier message mémorisé sur la conversation. `kind: 'system'` pour les messages automatiques."""
    now = now or datetime.now(timezone.utc)
    receiver_id = conversation_receiver(conversation, sender) if sender.get("id") != "system" else None
    content_original = None
    if kind == "message" and sender.get("role") in ("buyer", "seller"):
        nda_signed = conversation.get("nda_signed") or await has_signed_nda(conversation["company_id"], conversation["buyer_id"])
        if not nda_signed:
            masked, changed = mask_contacts(content)
            if changed:
                content_original, content = content, masked
                await db.contact_attempts.insert_one({"id": str(uuid.uuid4()), "company_id": conversation["company_id"],
                                                      "sender_id": sender["id"], "receiver_id": receiver_id, "created_at": now.isoformat()})
    message_doc = {
        "id": str(uuid.uuid4()), "conversation_id": conversation["id"], "sender_id": sender.get("id"),
        "sender_email": sender.get("email"), "receiver_id": receiver_id, "company_id": conversation["company_id"],
        "content": content, "content_original": content_original, "contacts_masked": content_original is not None,
        "kind": kind, "message_type": message_type, "read": False, "created_at": now.isoformat(), **extra,
    }
    await db.messages.insert_one(message_doc)
    message_doc.pop("_id", None)
    await db.conversations.update_one({"id": conversation["id"]}, {"$set": {
        "last_at": now.isoformat(), "last_message": content[:200], "last_sender_id": sender.get("id"), "updated_at": now.isoformat()}})
    return message_doc

async def system_message(company_id: str, buyer_id: str, content: str, message_type: str, receiver_id: Optional[str] = None) -> Optional[dict]:
    """Message automatique (kind:'system') dans la conversation du couple ; la conversation est créée si besoin"""
    company = await db.companies.find_one({"id": company_id}, {"_id": 0, "id": 1, "seller_id": 1, "president_id": 1})
    if not company or not buyer_id:
        return None
    conversation, _ = await get_or_create_conversation(company, buyer_id)
    doc = await store_message(conversation, {"id": "system", "email": None}, content, kind="system", message_type=message_type)
    if receiver_id:
        await db.messages.update_one({"id": doc["id"]}, {"$set": {"receiver_id": receiver_id}})
    return doc

async def notify_first_contact(conversation: dict, buyer: dict, extract: str) -> None:
    """E-mail « premier contact » au cédant : extrait du message + carte repreneur pseudonymisée"""
    company = await db.companies.find_one({"id": conversation["company_id"]}, {"_id": 0, "title": 1})
    card = await buyer_card(buyer["id"], revealed=bool(conversation.get("identity_revealed")))
    await email_user(conversation.get("seller_id"), "first_contact", company_title=(company or {}).get("title") or "votre annonce",
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
    `receiver_id` + `company_id` (la conversation du couple est retrouvée ou créée)."""
    content = (message.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message vide")
    if len(content) > 5000:
        raise HTTPException(status_code=400, detail="Message trop long (5000 caractères maximum)")
    role = current_user.get("role")
    if role == "buyer":
        # Un repreneur n'écrit qu'avec une adresse e-mail confirmée (aucun paiement : loi Hoguet)
        require_verified_email(current_user)
    
    if message.conversation_id:
        conversation = await conversation_for_user(message.conversation_id, current_user)
        company = await db.companies.find_one({"id": conversation["company_id"]}, {"_id": 0})
        if not company:
            raise HTTPException(status_code=404, detail="Entreprise introuvable")
        if role == "buyer" and company.get("status") not in ("published", "paused", "sold", "sold_elsewhere", "withdrawn"):
            raise HTTPException(status_code=404, detail="Entreprise introuvable")
    else:
        if not message.company_id or not message.receiver_id:
            raise api_error(400, "validation", "Indiquez la conversation (conversation_id) ou l'annonce et le destinataire")
        company = await db.companies.find_one({"id": message.company_id}, {"_id": 0})
        if not company:
            raise HTTPException(status_code=404, detail="Entreprise introuvable")
        if role == "buyer":
            if company.get("status") != "published":
                raise HTTPException(status_code=404, detail="Entreprise introuvable")
            if message.receiver_id not in (company.get("seller_id"), company.get("president_id")):
                raise HTTPException(status_code=400, detail="Destinataire invalide pour cette annonce")
            existing = await db.conversations.find_one({"company_id": company["id"], "buyer_id": current_user["id"]}, {"_id": 0})
            if not existing:
                await migrate_legacy_conversations(current_user)
                existing = await db.conversations.find_one({"company_id": company["id"], "buyer_id": current_user["id"]}, {"_id": 0})
            if not existing:
                require_buyer_profile(current_user)  # premier contact par la messagerie : mêmes règles que /contact
            conversation, _ = await get_or_create_conversation(company, current_user["id"])
        elif role == "seller":
            if not is_company_owner(company, current_user):
                raise HTTPException(status_code=403, detail="Cette annonce ne vous appartient pas")
            await migrate_legacy_conversations(current_user)
            conversation = await db.conversations.find_one({"company_id": company["id"], "buyer_id": message.receiver_id}, {"_id": 0})
            if not conversation:
                raise HTTPException(status_code=400, detail="Cet utilisateur ne vous a pas contacté pour cette annonce")
        elif role == "admin":
            conversation, _ = await get_or_create_conversation(company, message.receiver_id)
        else:
            raise HTTPException(status_code=403, detail="Non autorisé")
    
    now = datetime.now(timezone.utc)
    created = False
    if role == "buyer":
        before = await db.messages.count_documents({"conversation_id": conversation["id"], "sender_id": current_user["id"], "kind": {"$ne": "system"}})
        created = before == 0
    message_doc = await store_message(conversation, current_user, content, now)
    if role == "buyer" and created:
        await register_contact(company, current_user["id"], now)
        background_tasks.add_task(notify_first_contact, conversation, current_user, message_doc["content"])
    else:
        background_tasks.add_task(notify_new_message, conversation, current_user, message_doc)
    view = {**scrub_contacts(message_doc, current_user), "is_mine": True, "sender_label": "Vous"}
    return view

async def label_messages(messages: list, viewer: dict) -> list:
    """Ajoute sender_label / receiver_label / is_mine / kind et retire les coordonnées (non-admin)"""
    labels = PartyLabels(viewer)
    companies = {}
    for m in messages:
        cid = m.get("company_id")
        if cid not in companies:
            companies[cid] = await db.companies.find_one({"id": cid}, {"_id": 0, "id": 1, "seller_id": 1, "president_id": 1})
        m["sender_label"] = await labels.label(m.get("sender_id"), companies[cid])
        m["receiver_label"] = await labels.label(m.get("receiver_id"), companies[cid])
        m["is_mine"] = m.get("sender_id") == viewer.get("id")
        m["kind"] = m.get("kind") or ("system" if m.get("sender_id") == "system" else "message")
    return scrub_contacts(messages, viewer)

@api_router.get("/messages")
async def get_messages(conversation_id: Optional[str] = None, company_id: Optional[str] = None,
                       current_user: dict = Depends(get_current_user)):
    """Messages d'une conversation (`conversation_id`, ordre chronologique) ; `company_id` : forme historique"""
    if conversation_id:
        conversation = await conversation_for_user(conversation_id, current_user)
        await migrate_legacy_conversations(current_user)
        messages = await db.messages.find({"conversation_id": conversation["id"]}, {"_id": 0}).sort("created_at", 1).to_list(2000)
        return await label_messages(messages, current_user)
    query = {"$or": [{"sender_id": current_user["id"]}, {"receiver_id": current_user["id"]}]}
    if company_id:
        query["company_id"] = company_id
    messages = await db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return await label_messages(messages, current_user)

async def conversation_view(conversation: dict, viewer: dict, labels: PartyLabels, companies: dict) -> dict:
    cid = conversation.get("company_id")
    if cid not in companies:
        companies[cid] = await db.companies.find_one({"id": cid}, {"_id": 0, "id": 1, "title": 1, "seller_id": 1, "president_id": 1,
                                                                   "trades": 1, "region": 1, "staff_count": 1, "status": 1})
    company = companies[cid] or {"id": cid}
    is_seller_side = viewer["id"] != conversation.get("buyer_id")
    other_id = conversation.get("buyer_id") if is_seller_side else conversation.get("seller_id")
    unread = await db.messages.count_documents({"conversation_id": conversation["id"], "receiver_id": viewer["id"], "read": False})
    access = await db.dataroom_access.find_one({"company_id": cid, "buyer_id": conversation.get("buyer_id")}, {"_id": 0, "status": 1, "id": 1})
    nda_signed = bool(conversation.get("nda_signed")) or await has_signed_nda(cid, conversation.get("buyer_id"))
    title = company.get("title") or (taxonomy.listing_title(company.get("trades") or [], company.get("region"), company.get("staff_count"))
                                     if company.get("trades") else "Annonce")
    view = {
        "id": conversation["id"], "company_id": cid, "company_title": title, "company_status": company.get("status"),
        "buyer_id": conversation.get("buyer_id"), "seller_id": conversation.get("seller_id"),
        "other_party_label": await labels.label(other_id, company),
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
    """Conversations de l'utilisateur (API.md §3), triées par dernier message : [{id, company_id, company_title, buyer_id,
    seller_id, other_party_label, buyer_card? (côté cédant), last_message, last_at, unread_count, nda_signed,
    identity_revealed, access_status}]"""
    await migrate_legacy_conversations(current_user)
    if current_user.get("role") == "admin":
        query = {}
    else:
        owned = [c["id"] async for c in db.companies.find({"$or": [{"seller_id": current_user["id"]}, {"president_id": current_user["id"]}]}, {"_id": 0, "id": 1})]
        query = {"$or": [{"buyer_id": current_user["id"]}, {"seller_id": current_user["id"]}, {"company_id": {"$in": owned}}]}
    conversations = await db.conversations.find(query, {"_id": 0}).sort("last_at", -1).to_list(500)
    labels = PartyLabels(current_user)
    companies = {}
    rows = [await conversation_view(c, current_user, labels, companies) for c in conversations]
    rows.sort(key=lambda r: r.get("last_at") or "", reverse=True)
    return scrub_contacts(rows, current_user)

@api_router.put("/messages/conversations/{conversation_id}/read")
async def mark_conversation_read(conversation_id: str, current_user: dict = Depends(get_current_user)):
    """Marque comme lus tous les messages reçus dans la conversation (ou, forme historique, pour une annonce)"""
    conversation = await db.conversations.find_one({"id": conversation_id}, {"_id": 0, "id": 1})
    if conversation:
        query = {"conversation_id": conversation_id, "receiver_id": current_user["id"], "read": False}
    else:
        query = {"company_id": conversation_id, "receiver_id": current_user["id"], "read": False}
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
@api_router.get("/documents/{company_id}")
async def get_documents(company_id: str, current_user: dict = Depends(get_current_user)):
    query = await signed_documents_query(company_id, current_user)
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
    """Configuration publique : marque, barème de la commission (cédant débiteur), version des conditions, mode test.
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
        "test_mode": test_mode,
        **({"test_panel_protected": test_panel_protected(), "test_panel_access": test_panel_access(request),
            "test_panel_admin": test_panel_access(request, admin=True)} if test_mode else {}),
    }

# ============ OFFRE INDICATIVE (SPEC §3.4, API.md §5) ============
# Formulaire structuré → document généré (gabarit DEFAULT_OFFER_TEMPLATE) signé par code par le repreneur
# (POST /contracts/{id}/sign), contresigné par le cédant à l'acceptation (PUT /offers/{id}/respond {action:'accept', otp_code}),
# refus motivé, contre-proposition acceptée par code (PUT /offers/{id}/accept-counter), expiration par tâche quotidienne.
class OfferFinancing(BaseModel):
    equity: float = Field(0, ge=0, description="Apport personnel")
    loan: float = Field(0, ge=0, description="Emprunt bancaire")
    vendor_loan: float = Field(0, ge=0, description="Crédit vendeur")
    earn_out: float = Field(0, ge=0, description="Complément de prix conditionnel")

class OfferCreate(BaseModel):
    company_id: str
    amount: float = Field(gt=0)
    sale_object: Literal["titres", "fonds"]
    financing: OfferFinancing = Field(default_factory=OfferFinancing)
    conditions: List[str] = Field(default_factory=list, max_length=20)
    target_date: str = Field(..., description="Date cible de signature de l'acte (AAAA-MM-JJ)")
    validity_days: int = Field(30, ge=15, le=60)
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

async def dataroom_access_granted(company_id: str, buyer_id: str) -> bool:
    access = await dataroom_request_for(company_id, buyer_id)
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
        "company_id": offer["company_id"], "content": content, "message_type": message_type, "kind": "system",
        "offer_id": offer["id"], "read": False, "created_at": now.isoformat()})

@api_router.post("/offers")
async def create_offer(offer: OfferCreate, current_user: dict = Depends(get_current_user)):
    """Repreneur : dépose une offre indicative (accès au dossier accordé obligatoire). Crée le document à signer et renvoie
    {offer, contract_id} ; l'offre reste `pending_signature` jusqu'à la signature par code."""
    if current_user.get("role") != "buyer":
        raise api_error(403, "not_allowed", "Seuls les repreneurs peuvent faire une offre")
    require_verified_email(current_user)
    company = await db.companies.find_one({"id": offer.company_id}, {"_id": 0})
    if not company or company.get("status") != "published":
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")
    if not await dataroom_access_granted(offer.company_id, current_user["id"]):
        raise api_error(403, "not_allowed", "L'accès au dossier de l'entreprise doit être accordé avant de faire une offre")
    target = _parse_date_iso(offer.target_date)
    if not target:
        raise api_error(400, "validation", "Date cible invalide (format AAAA-MM-JJ)", missing=["target_date"])
    existing = await db.offers.find_one({"company_id": offer.company_id, "buyer_id": current_user["id"], "status": {"$in": list(OFFER_OPEN_STATUSES)}}, {"_id": 0})
    if existing:
        raise api_error(400, "validation", "Vous avez déjà une offre en cours pour cette entreprise", offer_id=existing["id"])

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=offer.validity_days)
    seller = await db.users.find_one({"id": company.get("seller_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company_name": 1}) or {}
    settings_doc = await db.platform_settings.find_one({"type": "contracts"}, {"_id": 0})
    settings = {**DEFAULT_PLATFORM_SETTINGS, **(settings_doc["settings"] if settings_doc else {})}
    contract_number = f"OFFRE-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    conditions = [c.strip() for c in offer.conditions if c and c.strip()]
    financing = offer.financing.model_dump()
    variables = {
        **settings,
        **company_contract_variables(company),
        "REPRENEUR_IDENTITE": buyer_identity_text(current_user),
        "VENDEUR_PRENOM": seller.get("first_name") or "",
        "VENDEUR_NOM": seller.get("last_name") or "",
        "OBJET": SALE_OBJECT_ACQUISITION[offer.sale_object].format(name=company.get("company_name") or ""),
        "MONTANT": fmt_eur_fr(offer.amount),
        "FIN_APPORT": fmt_eur_fr(financing["equity"]),
        "FIN_EMPRUNT": fmt_eur_fr(financing["loan"]),
        "FIN_CREDIT_VENDEUR": fmt_eur_fr(financing["vendor_loan"]),
        "FIN_COMPLEMENT": fmt_eur_fr(financing["earn_out"]),
        "CONDITIONS": "\n".join(f"{i}. {c}" for i, c in enumerate(conditions, 1)) if conditions else "Aucune condition particulière.",
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
    offer_test = is_test_context(current_user, company)
    content = with_test_banner(content, offer_test)
    offer_doc = {
        "id": str(uuid.uuid4()), "company_id": offer.company_id, "buyer_id": current_user["id"], "buyer_email": current_user["email"],
        "seller_id": company.get("seller_id"), "amount": float(offer.amount), "sale_object": offer.sale_object, "financing": financing,
        "conditions": conditions, "target_date": target.date().isoformat(), "validity_days": offer.validity_days,
        "expires_at": expires_at.isoformat(), "message": (offer.message or "").strip() or None, "status": "pending_signature",
        "counter_amount": None, "contract_id": None, "contract_number": contract_number, "signed_at": None, "countersigned_at": None,
        "closing_id": None, "created_at": now.isoformat(), "terms_version": "v2",
    }
    contract_doc = {
        "id": str(uuid.uuid4()), "contract_number": contract_number, "type": "offer", "offer_id": offer_doc["id"],
        "company_id": offer.company_id, "buyer_id": current_user["id"], "seller_id": company.get("seller_id"),
        "content": content, "status": "pending_signature", "signers_pending": [current_user["id"]], "terms_version": "v2",
        "terms_date": CONTRACT_TERMS_DATE, "created_at": now.isoformat(), "auto_generated": True, "addenda": [],
    }
    offer_doc["contract_id"] = contract_doc["id"]
    if offer_test:
        offer_doc["is_test"] = contract_doc["is_test"] = True
    await db.generated_contracts.insert_one(contract_doc)
    await db.offers.insert_one(offer_doc)
    return {"offer": offer_view(offer_doc), "contract_id": contract_doc["id"], "content": content, "contract_number": contract_number}

async def _offer_after_buyer_signature(contract: dict, company: Optional[dict], user: dict, evidence: dict, now: datetime) -> dict:
    """Appelée par POST /contracts/{id}/sign pour un document `offer` : l'offre passe à `pending`, le cédant est prévenu"""
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
                         f"Offre indicative n° {contract.get('contract_number')} signée : {fmt_eur_fr(offer['amount'])} "
                         f"({SALE_OBJECT_LABELS.get(offer.get('sale_object'), '')}), valable jusqu'au {fmt_date_fr(offer.get('expires_at'))}.",
                         "offer", now)
    await create_audit_log(action="OFFER_SIGNED", company_id=offer["company_id"], actor_id=user["id"], actor_email=user["email"],
                           details={"offer_id": offer["id"], "contract_id": contract["id"], "amount": offer["amount"]})
    return {"message": "Offre signée avec succès", "contract_number": contract.get("contract_number"), "signature_hash": record["signature_hash"],
            "signed_at": now.isoformat(), "document_id": record["id"], "pdf_url": document_pdf_path(record), "offer_id": offer["id"], "status": "pending"}

@api_router.get("/offers/my")
async def get_my_offers(current_user: dict = Depends(get_current_user)):
    """Offres du repreneur, les plus récentes d'abord"""
    if current_user.get("role") != "buyer":
        raise HTTPException(status_code=403, detail="Endpoint réservé aux repreneurs")
    offers = await db.offers.find({"buyer_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for offer in offers:
        if offer.get("status") == "pending_signature" and offer.get("contract_id"):
            # « Signer mon offre » depuis le tableau de bord : texte intégral du contrat à signer
            contract = await db.generated_contracts.find_one({"id": offer["contract_id"]}, {"_id": 0, "content": 1, "contract_number": 1, "terms_date": 1})
            if contract:
                offer["content"] = contract.get("content")
                offer["contract_number"] = contract.get("contract_number")
                offer["terms_date"] = contract.get("terms_date")
        company = await db.companies.find_one({"id": offer["company_id"]}, {"_id": 0, "title": 1, "rge_types": 1, "region": 1, "asking_price": 1, "trades": 1})
        if company:
            offer["company"] = {"title": company.get("title"), "trades": company.get("trades"), "rge_types": company.get("rge_types"),
                                "region": company.get("region"), "asking_price": company.get("asking_price")}
    return {"offers": offers}

@api_router.get("/offers/company/{company_id}")
async def get_company_offers(company_id: str, current_user: dict = Depends(get_current_user)):
    """Offres reçues pour une annonce (cédant, admin) ; un repreneur ne voit que les siennes"""
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")
    if is_company_owner(company, current_user) or current_user.get("role") == "admin":
        offers = await db.offers.find({"company_id": company_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    else:
        offers = await db.offers.find({"company_id": company_id, "buyer_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    labels = PartyLabels(current_user)
    for offer in offers:
        offer["buyer_label"] = await labels.label(offer.get("buyer_id"), company)
    return {"offers": scrub_contacts(offers, current_user)}

async def _accept_offer(offer: dict, contract: Optional[dict], seller: dict, evidence: Optional[dict], now: datetime, amount: float,
                        buyer_signed_counter: Optional[dict] = None) -> dict:
    """Offre acceptée : contre-signature du cédant (ou signature du repreneur sur la contre-proposition), étape de vente"""
    record = None
    if contract and evidence is not None:
        document_sha256 = hashlib.sha256((contract.get("content") or "").encode()).hexdigest()
        record = await record_signature(contract, seller, evidence, "offer", "seller", now, document_sha256)
        await db.generated_contracts.update_one({"id": contract["id"]}, {"$set": {
            "status": "fully_signed", "countersigned_at": now.isoformat(), "countersignature_record_id": record["id"],
            "countersignature_evidence": record["evidence"], "signers_pending": []}})
    elif contract:
        # Contre-proposition acceptée : l'engagement du cédant est la contre-proposition enregistrée avec son dossier de preuve
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
    company = await db.companies.find_one({"id": offer["company_id"]}, {"_id": 0}) or {}
    # Étape de vente (closing.py, SPEC §4.5) : créée une seule fois, checklist envoyée aux deux parties
    closing_module = LOADED_MODULES.get("closing")
    if closing_module and company:
        try:
            closing = await closing_module.create_closing_for_offer(offer_doc, company)
            offer_doc["closing_id"] = closing.get("id")
        except Exception as e:
            logging.error(f"Création de l'étape de vente impossible pour l'offre {offer['id']}: {e}")
    return offer_doc

@api_router.put("/offers/{offer_id}/respond")
async def respond_to_offer(offer_id: str, response: OfferRespond, request: Request, current_user: dict = Depends(get_current_user)):
    """Cédant : accepte (contre-signature par code → `accepted` + étape de vente), refuse avec motif ou fait une
    contre-proposition (`countered`, acceptée ensuite par le repreneur avec un code)."""
    offer = await db.offers.find_one({"id": offer_id}, {"_id": 0})
    if not offer:
        raise HTTPException(status_code=404, detail="Offre non trouvée")
    if current_user["id"] != offer.get("seller_id") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Seul le cédant peut répondre à cette offre")
    if offer.get("status") != "pending":
        raise api_error(400, "validation", "Cette offre n'est pas en attente de votre réponse" if offer.get("status") != "pending_signature"
                        else "Le repreneur n'a pas encore signé cette offre")
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
        await _offer_message(current_user, offer["buyer_id"], offer, f"Offre de {amount_text} acceptée et contresignée. L'étape de vente est ouverte.", "offer_response", now)
        await create_audit_log(action="OFFER_ACCEPTED", company_id=offer["company_id"], actor_id=current_user["id"], actor_email=current_user["email"],
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

    # Contre-proposition : nouvelle proposition de prix du cédant, horodatée depuis son espace, à accepter par le repreneur (code)
    if not response.counter_amount:
        raise api_error(400, "validation", "Indiquez le montant de la contre-proposition", missing=["counter_amount"])
    counter = {"amount": float(response.counter_amount), "message": (response.message or "").strip() or None, "at": now.isoformat(),
               "by": current_user["id"], "ip": client_ip(request),
               "user_agent": request.headers.get("user-agent")}
    await db.offers.update_one({"id": offer_id}, {"$set": {"status": "countered", "responded_at": now.isoformat(), "counter_amount": counter["amount"],
                                                        "counter": counter, "response_message": counter["message"]}})
    if contract:
        text = (f"Le Cédant propose un prix de {fmt_eur_fr(counter['amount'])} en lieu et place de {amount_text}, "
                f"depuis son espace authentifié le {fmt_datetime_paris(now)}." + (f" Message : {counter['message']}" if counter["message"] else ""))
        # Dossier de preuve de la contre-proposition (horodatage, IP, navigateur, identité), chaîné aux actes du cédant
        is_seller = current_user["id"] == offer.get("seller_id")
        record = await record_signature(contract, current_user, session_evidence(current_user, contract, request, "authenticated_session"),
                                        "offer_counter_proposal", "seller" if is_seller else "platform", now,
                                        hashlib.sha256(text.encode()).hexdigest(), extra={"addendum": text})
        counter["record_id"] = record["id"]
        await db.offers.update_one({"id": offer_id}, {"$set": {"counter.record_id": record["id"]}})
        addendum = {"title": f"Contre-proposition du cédant du {fmt_date_fr(now)}", "text": text, "at": now.isoformat(), "kind": "counter",
                    "record_id": record["id"]}
        await db.generated_contracts.update_one({"id": contract["id"]}, {"$push": {"addenda": addendum}, "$set": {"signers_pending": [offer["buyer_id"]]}})
    await email_user(offer["buyer_id"], "offer_countered", amount=amount_text, counter_amount=fmt_eur_fr(counter["amount"]),
                     message=counter["message"] or "aucun message", expires_at=fmt_date_fr(offer.get("expires_at")))
    await _offer_message(current_user, offer["buyer_id"], offer, f"Contre-proposition : {fmt_eur_fr(counter['amount'])}." + (f" {counter['message']}" if counter["message"] else ""),
                         "offer_response", now)
    return {"message": "Contre-proposition envoyée", "status": "countered", "counter_amount": counter["amount"]}

@api_router.put("/offers/{offer_id}/accept-counter")
async def accept_counter_offer(offer_id: str, data: OfferCounterAccept, request: Request, current_user: dict = Depends(get_current_user)):
    """Repreneur : accepte la contre-proposition du cédant par code → `accepted` + étape de vente"""
    offer = await db.offers.find_one({"id": offer_id}, {"_id": 0})
    if not offer:
        raise HTTPException(status_code=404, detail="Offre non trouvée")
    if current_user["id"] != offer.get("buyer_id"):
        raise HTTPException(status_code=403, detail="Seul le repreneur peut accepter cette contre-proposition")
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
    text = (f"Le Repreneur accepte la contre-proposition du Cédant : prix de {fmt_eur_fr(counter_amount)} en lieu et place de "
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
        # Offres antérieures à la version du 10/10/2026 : PDF d'acceptation archivé
        legacy = await db.offer_pdfs.find_one({"offer_id": offer_id}, {"_id": 0})
        if not legacy:
            raise HTTPException(status_code=404, detail="PDF non trouvé")
        return {"filename": f"offre_{offer_id[:8]}.pdf", "content": legacy["content"]}
    pdf = await contract_pdf_bytes(contract)
    return {"filename": f"offre_{contract.get('contract_number', offer_id[:8])}.pdf", "content": base64.b64encode(pdf).decode("utf-8")}

async def job_offers_expiry(now: datetime) -> int:
    """Offres arrivées au terme de leur validité sans acceptation : `expired`, e-mail au repreneur (et au cédant si elle était signée)"""
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
            await email_user(offer.get("seller_id"), "offer_expired", amount=amount, role_text="reçue pour votre entreprise", expires_at=fmt_date_fr(expires),
                             next_step="Le repreneur peut vous adresser une nouvelle offre depuis son espace.")
        count += 1
    return count
# ============ ADMIN ROUTES ============
@api_router.get("/admin/stats")
async def get_admin_stats(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    total_companies = await db.companies.count_documents({})
    published_companies = await db.companies.count_documents({"status": "published"})
    total_users = await db.users.count_documents({"deleted_at": {"$exists": False}})
    
    # Revenu : factures d'honoraires émises et encaissées (montants HT)
    invoices = await db.invoices.find({"status": {"$nin": ["cancelled", "draft"]}}, {"_id": 0, "status": 1, "total_ht": 1}).to_list(10000)
    invoiced = round(sum(float(i.get("total_ht") or 0) for i in invoices), 2)
    paid = round(sum(float(i.get("total_ht") or 0) for i in invoices if i.get("status") == "paid"), 2)
    
    return {
        "total_companies": total_companies,
        "published_companies": published_companies,
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
    """Agrège tout ce qui attend l'administrateur : annonces publiées < 48 h à relire (drapeaux), demandes de dossier sans
    réponse > 7 j, offres acceptées > 60 j sans vente, ventes déclarées / contestées, factures en retard, mandats < 30 j,
    incidents BODACC, échecs de jobs, identités en repli."""
    now = now or datetime.now(timezone.utc)
    now_iso = now.isoformat()
    sections = []

    # 0. Mode test (MODE-TEST-ET-APP.md §B.2.12) : actif, ou désactivé avec des données de test restantes à purger
    rows = []
    if test_mode_enabled():
        rows.append(_todo_row("test_mode", "test_mode", "Mode test actif",
                              detail="Identité simulée, e-mails capturés dans la boîte de test, documents sans valeur juridique. "
                                     "Avant l'ouverture : supprimer les données de test, puis TEST_MODE=false.",
                              actions=[{"label": "Simuler la purge", "method": "POST", "url": "/api/admin/test/purge?dry_run=true"}]))
    elif await db.users.find_one({"is_test": True}, {"_id": 0, "id": 1}) or await db.companies.find_one({"is_test": True}, {"_id": 0, "id": 1}):
        rows.append(_todo_row("test_data", "test_data", "Données de test à supprimer",
                              detail="Le mode test est désactivé mais des comptes ou annonces de test restent en base.",
                              actions=[{"label": "Simuler la purge", "method": "POST", "url": "/api/admin/test/purge?dry_run=true"},
                                       {"label": "Supprimer", "method": "POST", "url": "/api/admin/test/purge?dry_run=false"}]))
    if rows:
        sections.append({"key": "test_mode", "title": "Mode test", "rows": rows})

    # 1. Annonces publiées depuis moins de 48 h, à relire (post-modération)
    rows = []
    for c in await db.companies.find({"status": "published", "moderation.status": "pending", "moderation.review_until": {"$gte": now_iso}},
                                     {"_id": 0, "id": 1, "title": 1, "moderation": 1, "siret": 1, "company_name": 1, "region": 1,
                                      "trades": 1, "published_at": 1, "asking_price": 1}).sort("published_at", -1).to_list(200):
        flags = [LISTING_FLAG_LABELS.get(f, f) for f in (c.get("moderation") or {}).get("flags") or []]
        rows.append(_todo_row("listing_review", c["id"], c.get("title") or "Annonce à relire",
                              detail=("Drapeaux : " + " · ".join(flags)) if flags else "Aucun drapeau", since=c.get("published_at") or "",
                              ref={"company_id": c["id"], "company_name": c.get("company_name"), "siret": c.get("siret"),
                                   "flags": (c.get("moderation") or {}).get("flags") or [], "asking_price": c.get("asking_price")},
                              actions=[{"label": "Valider", "method": "PUT", "url": f"/api/companies/{c['id']}/status?status=published"},
                                       {"label": "Retirer avec motif", "method": "PUT",
                                        "url": f"/api/companies/{c['id']}/status?status=removed&reason=<motif>&reason_text=<texte>",
                                        "reasons": REMOVAL_REASONS}]))
    sections.append({"key": "listings_review", "title": "Annonces publiées à relire (48 h)", "rows": rows})

    # 2. Demandes de dossier sans réponse depuis plus de 7 jours
    rows = []
    limit = (now - timedelta(days=7)).isoformat()
    for a in await db.dataroom_access.find({"status": "pending", "requested_at": {"$lte": limit}}, {"_id": 0}).sort("requested_at", 1).to_list(200):
        rows.append(_todo_row("dataroom_unanswered", a["id"], "Demande de dossier sans réponse du cédant",
                              detail=f"Annonce {a.get('company_id', '')[:8]} · repreneur {a.get('buyer_email') or a.get('buyer_id', '')}",
                              since=a.get("requested_at") or "", ref={"company_id": a.get("company_id"), "buyer_id": a.get("buyer_id")},
                              actions=[{"label": "Relancer le cédant", "method": "POST", "url": f"/api/admin/dataroom/{a['id']}/remind"}]))
    sections.append({"key": "dataroom_unanswered", "title": "Demandes de dossier sans réponse (> 7 j)", "rows": rows})

    # 3. Offres acceptées depuis plus de 60 jours sans vente déclarée ; ventes déclarées / contestées (closing.py)
    stale, declared = [], []
    limit60 = (now - timedelta(days=60)).isoformat()
    for cl in await db.closings.find({"status": {"$in": ["in_progress", "declared", "disputed"]}}, {"_id": 0}).sort("updated_at", -1).to_list(500):
        label = cl.get("company_label") or cl.get("company_id", "")[:8]
        if cl["status"] == "in_progress" and (cl.get("accepted_at") or "") <= limit60:
            stale.append(_todo_row("closing_stale", cl["id"], f"Offre acceptée sans vente depuis plus de 60 jours — {label}",
                                   since=cl.get("accepted_at") or "", ref={"closing_id": cl["id"], "company_id": cl.get("company_id")},
                                   actions=[{"label": "Voir", "method": "GET", "url": f"/api/admin/closings?status=in_progress"}]))
        elif cl["status"] in ("declared", "disputed"):
            title = ("Vente contestée" if cl["status"] == "disputed" else "Vente déclarée, en attente de confirmation") + f" — {label}"
            declared.append(_todo_row("closing_" + cl["status"], cl["id"], title,
                                      detail=((cl.get("dispute") or {}).get("reason") or ""),
                                      since=((cl.get("declaration") or {}).get("declared_at") or cl.get("updated_at") or ""),
                                      ref={"closing_id": cl["id"], "company_id": cl.get("company_id")},
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
                                               {"_id": 0, "id": 1, "company_id": 1, "ends_at": 1, "registry_number": 1, "seller_id": 1}).to_list(200):
        rows.append(_todo_row("mandate_expiring", m["id"], f"Mandat n° {m.get('registry_number', '')} expire le {(m.get('ends_at') or '')[:10]}",
                              since=m.get("ends_at") or "", ref={"mandate_id": m["id"], "company_id": m.get("company_id"), "seller_id": m.get("seller_id")},
                              actions=[{"label": "Voir le registre", "method": "GET", "url": "/api/admin/mandates"}]))
    sections.append({"key": "mandates_expiring", "title": "Mandats à moins de 30 jours", "rows": rows})

    # 6. Incidents BODACC (veille.py)
    rows = []
    for i in await db.incidents.find({"status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(100):
        ev = i.get("event") or {}
        rows.append(_todo_row("bodacc_incident", i["id"], f"BODACC {ev.get('famille_label') or ev.get('famille', '')} — {i.get('company_label') or i.get('siren', '')}",
                              detail=(ev.get("description") or "")[:300], since=i.get("created_at") or "",
                              ref={"incident_id": i["id"], "company_id": i.get("company_id"), "siren": i.get("siren"), "url": ev.get("url")},
                              actions=[{"label": "Clore", "method": "PUT", "url": f"/api/admin/incidents/{i['id']}", "body": {"status": "closed"}}]))
    sections.append({"key": "incidents", "title": "Incidents BODACC", "rows": rows})

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

    # 9. Demandes de dossier expirées sans réponse (cédants muets, 30 derniers jours) : relance humaine possible
    rows = []
    limit30d = (now - timedelta(days=30)).isoformat()
    for a in await db.dataroom_access.find({"status": "expired", "expired_at": {"$gte": limit30d}}, {"_id": 0}).sort("expired_at", -1).to_list(100):
        rows.append(_todo_row("dataroom_expired", a["id"], "Demande de dossier expirée sans réponse du cédant",
                              detail=f"Annonce {a.get('company_id', '')[:8]} · repreneur {buyer_pseudonym(a.get('buyer_id'))}",
                              since=a.get("expired_at") or "", ref={"company_id": a.get("company_id"), "buyer_id": a.get("buyer_id")},
                              actions=[{"label": "Voir l'annonce", "method": "GET", "url": f"/api/companies/{a.get('company_id')}"}]))
    sections.append({"key": "dataroom_expired", "title": "Demandes de dossier expirées (30 j)", "rows": rows})

    # 10. Signalements (page /signaler → événement `report`, 30 derniers jours)
    rows = []
    for ev in await db.events.find({"name": "report", "created_at": {"$gte": limit30d}}, {"_id": 0}).sort("created_at", -1).to_list(100):
        props = ev.get("props") or {}
        rows.append(_todo_row("report", ev.get("id") or ev.get("created_at", ""), f"Signalement : {props.get('reason') or 'motif non précisé'}",
                              detail=" · ".join(str(props.get(k)) for k in ("reference", "description") if props.get(k))[:300],
                              since=ev.get("created_at") or "", ref={"reference": props.get("reference"), "email": props.get("email")},
                              actions=[{"label": "Retirer avec motif", "method": "PUT",
                                        "url": "/api/companies/<company_id>/status?status=removed&reason=<motif>&reason_text=<texte>",
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
    "sales_declared": 1, "invoices_issued": 1, "invoices_paid": 1, "invoices_overdue": 0, "bodacc_incidents": 0, "costs": 600,
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
    companies = await db.companies.find({}, {"_id": 0, "id": 1, "status": 1, "created_at": 1, "published_at": 1, "submitted_at": 1,
                                             "blocking": 1, "auto_published": 1, "seller_id": 1, "mandate_id": 1}).to_list(100000)
    mandates = await db.generated_contracts.find({"type": "mandat", "status": {"$in": ["signed", "denounced", "expired", "void"]}},
                                                 {"_id": 0, "company_id": 1, "signed_at": 1}).to_list(100000)
    estimates = await db.estimates.find({"created_at": {"$gte": since_iso}}, {"_id": 0, "created_at": 1, "email": 1, "siret": 1}).to_list(100000)
    contacts = await db.contacts.find({}, {"_id": 0, "company_id": 1, "buyer_id": 1, "seller_id": 1, "created_at": 1}).to_list(100000)
    ndas = await db.documents.find({"doc_type": "nda"}, {"_id": 0, "company_id": 1, "signed_at": 1}).to_list(100000)
    offers = await db.offers.find({}, {"_id": 0, "status": 1, "created_at": 1, "accepted_at": 1, "signed_at": 1}).to_list(100000)
    requests = await db.dataroom_access.find({}, {"_id": 0, "status": 1, "expired_at": 1}).to_list(100000)
    closings = await db.closings.find({}, {"_id": 0, "status": 1, "declaration": 1, "confirmed_at": 1}).to_list(100000)
    invoices = await db.invoices.find({}, {"_id": 0, "status": 1, "issued_on": 1, "paid_on": 1, "due_on": 1, "total_ht": 1}).to_list(100000)
    incidents = await db.incidents.find({}, {"_id": 0, "created_at": 1}).to_list(100000)
    audits = await db.audit_logs.find({"action": {"$in": ["LISTING_REMOVED"]}}, {"_id": 0, "timestamp": 1}).to_list(100000)
    todos_done = await db.todos.find({"status": "done"}, {"_id": 0, "done_at": 1, "updated_at": 1}).to_list(100000)
    costs = {c["month"]: c async for c in db.costs.find({}, {"_id": 0})}
    seller_msgs = await db.messages.find({"kind": {"$ne": "system"}}, {"_id": 0, "company_id": 1, "sender_id": 1, "receiver_id": 1, "created_at": 1}).to_list(200000)
    first_reply = {}
    for m in seller_msgs:
        key = (m.get("company_id"), m.get("receiver_id"), m.get("sender_id"))
        t = dt(m.get("created_at"))
        if t and (key not in first_reply or t < first_reply[key]):
            first_reply[key] = t
    mandate_by_company = {}
    for m in mandates:
        t = dt(m.get("signed_at"))
        if t and (m.get("company_id") not in mandate_by_company or t < mandate_by_company[m["company_id"]]):
            mandate_by_company[m["company_id"]] = t
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
        published = [c for c in companies if in_week(c.get("published_at"), start, end)]
        created = [c for c in companies if in_week(c.get("created_at"), start, end)]
        blocked = [c for c in companies if c.get("blocking") and in_week(c.get("submitted_at"), start, end)]
        week_estimates = [e for e in estimates if in_week(e.get("created_at"), start, end)]
        delays = []
        for c in published:
            a, b = dt(c.get("created_at")), dt(c.get("published_at"))
            if a and b and b >= a:
                delays.append((b - a).total_seconds() / 3600)
        from_estimate = [c for c in created if sellers_by_id.get(c.get("seller_id")) in estimate_emails]
        with_mandate = [c for c in created if c["id"] in mandate_by_company]
        week_contacts = [c for c in contacts if in_week(c.get("created_at"), start, end)]
        replied_48h = 0
        for c in week_contacts:
            reply = first_reply.get((c.get("company_id"), c.get("buyer_id"), c.get("seller_id")))
            t0 = dt(c.get("created_at"))
            if reply and t0 and reply >= t0 and (reply - t0).total_seconds() <= 48 * 3600:
                replied_48h += 1
        live_30d = [c for c in companies if c.get("published_at") and (dt(c["published_at"]) or now) >= end - timedelta(days=30)
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
            "bodacc_incidents": sum(1 for inc in incidents if in_week(inc.get("created_at"), start, end)),
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
    """Nombre d'annonces en ligne par métier, département, région et activité RGE (hubs, pages d'atterrissage, pré-rendu).
    Seules les valeurs > 0 sont renvoyées : le front décide de l'affichage et n'écrit jamais « 0 »."""
    by_rge, by_region, by_trade, by_department, total, rge_total = {}, {}, {}, {}, 0, 0
    async for c in db.companies.find(hide_test_listings({"status": "published"}),
                                     {"_id": 0, "rge_types": 1, "region": 1, "trades": 1, "department": 1, "is_rge": 1}):
        total += 1
        if c.get("is_rge") or c.get("rge_types"):
            rge_total += 1
        for t in c.get("rge_types") or []:
            by_rge[t] = by_rge.get(t, 0) + 1
        for t in c.get("trades") or taxonomy.trades_for_rge(c.get("rge_types")):
            by_trade[t] = by_trade.get(t, 0) + 1
        if c.get("region"):
            by_region[c["region"]] = by_region.get(c["region"], 0) + 1
        if c.get("department"):
            by_department[c["department"]] = by_department.get(c["department"], 0) + 1
    rows = lambda d: [{"value": k, "count": v} for k, v in sorted(d.items(), key=lambda x: -x[1]) if v > 0]
    return {
        "total": total,
        "rge_total": rge_total,
        "by_trade": [{**r, "slug": taxonomy.trade_slug(r["value"]), "label": taxonomy.trade_label(r["value"])} for r in rows(by_trade)],
        "by_department": [{**r, "label": taxonomy.departement_name(r["value"]), "region": taxonomy.region_for_departement(r["value"])} for r in rows(by_department)],
        "by_region": [{**r, "slug": slugify(r["value"])} for r in rows(by_region)],
        "by_rge": rows(by_rge),
    }

def load_seo_routes() -> list:
    """Routes publiques statiques de l'application (copie de frontend/scripts/seo-routes.json, régénérée au build)"""
    try:
        with open(ROOT_DIR / "seo_routes.json", encoding="utf-8") as f:
            return json.load(f).get("routes", [])
    except (OSError, ValueError):
        return [{"path": "/", "changefreq": "daily"}]

# Anciennes pages marketing (MODE-TEST-ET-APP.md §A.1) : redirigées (301) vers la page des annonces, jamais dans le plan
LEGACY_REDIRECT_PATHS = ("/entreprises-a-vendre", "/search", "/buyer/search", "/verifier-entreprise-rge")
LEGACY_REDIRECT_PREFIXES = ("/entreprises-batiment-a-vendre", "/entreprises-rge-a-vendre", "/vendre-mon-entreprise-",
                            "/reprendre-une-entreprise-", "/guides")

def sitemap_static_path(path: Optional[str]) -> bool:
    """Route statique publiable dans le plan du site : ni fiche d'annonce, ni ancienne page redirigée, ni page technique"""
    if not path or not path.startswith("/") or path.startswith(("/company/", "/embed/", "/test/")) or path == "/test":
        return False
    if path in LEGACY_REDIRECT_PATHS:
        return False
    for prefix in LEGACY_REDIRECT_PREFIXES:
        if path.startswith(prefix) if prefix.endswith("-") else (path == prefix or path.startswith(prefix + "/")):
            return False
    return True

@api_router.get("/sitemap.xml")
async def sitemap():
    """Plan du site : routes statiques de seo_routes.json (page des annonces, estimateur, pages légales) puis fiches des
    annonces publiées (/company/{id}, date de dernière modification). Les annonces de test n'y figurent jamais, même en
    mode test ; les anciennes pages marketing redirigées non plus."""
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
    async for c in db.companies.find({"status": "published", "is_test": {"$ne": True}},
                                     {"_id": 0, "id": 1, "updated_at": 1, "published_at": 1}).sort("published_at", -1):
        lastmod = str(c.get("updated_at") or c.get("published_at") or "")[:10]
        lastmod = f"<lastmod>{lastmod}</lastmod>" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", lastmod) else ""
        urls.append(f"<url><loc>{xml_escape(site_url('/company/' + c['id']))}</loc>{lastmod}<changefreq>weekly</changefreq></url>")
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(urls) + "</urlset>"
    return Response(content=xml, media_type="application/xml")

# ============ SUIVI DU TEST DE MARCHÉ ============

FOLLOWUP_ANSWERS = {
    "en_discussion": "Toujours en discussion",
    "rencontre": "Rencontre prévue ou faite",
    "accord": "Accord ou offre en cours",
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
    companies = await db.companies.find({}, {"_id": 0, "id": 1, "status": 1, "created_at": 1, "seller_id": 1}).to_list(100000)
    contacts = await db.contacts.find({}, {"_id": 0}).to_list(100000)
    contracts = await db.generated_contracts.find(
        {"type": {"$in": ["nda", "offer"]}, "status": {"$in": ["signed", "buyer_signed", "fully_signed"]}},
        {"_id": 0, "type": 1, "buyer_id": 1, "signed_at": 1, "created_at": 1}).to_list(100000)
    offers = await db.offers.find({}, {"_id": 0, "buyer_id": 1, "status": 1, "created_at": 1}).to_list(100000)
    seller_msgs = await db.messages.find({}, {"_id": 0, "company_id": 1, "sender_id": 1, "receiver_id": 1, "created_at": 1}).to_list(200000)
    
    buyers = [u for u in users if u["role"] == "buyer" and in_period(u.get("created_at"))]
    sellers = [u for u in users if u["role"] == "seller" and in_period(u.get("created_at"))]
    period_contacts = [c for c in contacts if in_period(c.get("created_at"))]
    
    # Réponse du vendeur : premier message du vendeur vers l'acquéreur après le contact
    first_reply = {}
    for m in seller_msgs:
        key = (m.get("company_id"), m.get("receiver_id"), m.get("sender_id"))
        dt = _parse_dt(m.get("created_at"))
        if dt and (key not in first_reply or dt < first_reply[key]):
            first_reply[key] = dt
    reply_hours, replied_buyers = [], set()
    for c in period_contacts:
        reply = first_reply.get((c.get("company_id"), c.get("buyer_id"), c.get("seller_id")))
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
        {"step": "NDA signé", "count": len(buyer_ids & {c["buyer_id"] for c in contracts if c["type"] == "nda"})},
        {"step": "Offre signée", "count": len(buyer_ids & {c["buyer_id"] for c in contracts if c["type"] == "offer"})},
        {"step": "Offre", "count": len(buyer_ids & {o["buyer_id"] for o in offers})},
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
            "listings": sum(1 for c in companies if week_of(c.get("created_at")) == w),
            "contacts": sum(1 for c in contacts if week_of(c.get("created_at")) == w),
        })
    
    followup_counts = {}
    async for f in db.followups.find({"answer": {"$ne": None}}, {"_id": 0, "answer": 1}):
        followup_counts[f["answer"]] = followup_counts.get(f["answer"], 0) + 1
    
    statuses = [c.get("status") for c in companies]
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
    company_id: str

@api_router.post("/favorites")
async def add_favorite(favorite: FavoriteCreate, current_user: dict = Depends(get_current_user)):
    """Ajouter une annonce aux favoris"""
    # Check if company exists
    company = await db.companies.find_one({"id": favorite.company_id}, {"_id": 0})
    if not company or company.get("status") != "published":
        raise HTTPException(status_code=404, detail="Annonce non trouvée")
    
    # Check if already favorited
    existing = await db.favorites.find_one({
        "user_id": current_user["id"],
        "company_id": favorite.company_id
    })
    if existing:
        return {"message": "Déjà en favoris", "favorited": True}
    
    # Add to favorites
    fav_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "company_id": favorite.company_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    try:
        await db.favorites.insert_one(fav_doc)
    except Exception:
        # Double clic : l'index unique (user_id, company_id) a déjà la ligne
        return {"message": "Déjà en favoris", "favorited": True}
    
    # Increment favorites count on company
    await db.companies.update_one(
        {"id": favorite.company_id},
        {"$inc": {"favorites_count": 1}}
    )
    
    return {"message": "Ajouté aux favoris", "favorited": True, "favorite_id": fav_doc["id"]}

@api_router.delete("/favorites/{company_id}")
async def remove_favorite(company_id: str, current_user: dict = Depends(get_current_user)):
    """Retirer une annonce des favoris"""
    result = await db.favorites.delete_one({
        "user_id": current_user["id"],
        "company_id": company_id
    })
    
    if result.deleted_count > 0:
        # Decrement favorites count on company
        await db.companies.update_one(
            {"id": company_id},
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
    
    # Enrich with company info
    for fav in favorites:
        company = await db.companies.find_one({"id": fav["company_id"]}, {"_id": 0})
        if company:
            fav["company"] = await sanitize_company(company, current_user)
    
    return {"favorites": favorites}

@api_router.get("/favorites/check/{company_id}")
async def check_favorite(company_id: str, current_user: dict = Depends(get_current_user)):
    """Vérifier si une annonce est en favoris"""
    existing = await db.favorites.find_one({
        "user_id": current_user["id"],
        "company_id": company_id
    })
    return {"favorited": existing is not None}

# ============ ALERTES (avec compte et sans compte, SPEC §4.3.2, API.md §8) ============
# Alertes avec compte : db.alerts {user_id, trades, regions, max_price, rge, rge_types (héritage), region (héritage), active}.
# Alertes sans compte : db.public_alerts {email, trades, regions, max_price, rge, status: pending|active|unsubscribed} ;
# confirmation et désinscription par lien signé (JWT_SECRET), pages HTML minimales en français.
ALERT_CONFIRM_TTL = timedelta(days=7)
MAX_ALERTS_PER_USER = 5

class AlertCreate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    trades: Optional[List[str]] = None
    regions: Optional[List[str]] = None
    max_price: Optional[float] = Field(None, ge=0)
    rge: Optional[bool] = None
    # Champs historiques (toujours acceptés)
    rge_types: Optional[List[str]] = None
    region: Optional[str] = None
    min_price: Optional[float] = Field(None, ge=0)
    min_ca: Optional[float] = None
    max_ca: Optional[float] = None

class AlertUpdate(AlertCreate):
    active: Optional[bool] = None

class PublicAlertCreate(BaseModel):
    email: EmailStr
    trades: Optional[List[str]] = None
    regions: Optional[List[str]] = None
    max_price: Optional[float] = Field(None, ge=0)
    rge: Optional[bool] = None

def normalize_alert_fields(data: dict) -> dict:
    """Métiers de la taxonomie, régions connues (nom ou slug), prix maximum > 0"""
    out = {}
    if "trades" in data and data["trades"] is not None:
        out["trades"] = [t for t in dict.fromkeys(data["trades"]) if taxonomy.trade_by_id(t)]
    if "regions" in data and data["regions"] is not None:
        regions = []
        for r in data["regions"]:
            name = taxonomy.region_by_slug(r) or (r if r in taxonomy.REGIONS else None)
            if name and name not in regions:
                regions.append(name)
        out["regions"] = regions
    if "region" in data and data["region"]:
        out["region"] = data["region"]
        out.setdefault("regions", [])
        if data["region"] in taxonomy.REGIONS and data["region"] not in out["regions"]:
            out["regions"] = out["regions"] + [data["region"]]
    for key in ("max_price", "min_price", "min_ca", "max_ca"):
        if key in data and data[key] is not None:
            out[key] = float(data[key]) if data[key] and data[key] > 0 else None
    if "rge" in data:
        out["rge"] = data["rge"]
    if "rge_types" in data and data["rge_types"] is not None:
        out["rge_types"] = list(data["rge_types"])
    return out

def alert_name_for(alert: dict) -> str:
    parts = [", ".join(taxonomy.trade_label(t, short=True) for t in alert.get("trades") or []) or "Tous les métiers",
             ", ".join(alert.get("regions") or []) or "Toute la France"]
    if alert.get("rge") is True:
        parts.append("RGE")
    if alert.get("max_price"):
        parts.append(f"≤ {fmt_eur_fr(alert['max_price'])}")
    return " · ".join(parts)

def alert_matches(alert: dict, company: dict) -> bool:
    """Une annonce correspond à une alerte : métiers (OU), régions (OU), RGE oui/non, prix maximum (+ critères historiques)"""
    trades = alert.get("trades") or []
    if trades and not set(trades) & set(company.get("trades") or []):
        return False
    regions = alert.get("regions") or ([alert["region"]] if alert.get("region") else [])
    if regions and company.get("region") not in regions:
        return False
    if alert.get("rge") is True and not company.get("is_rge", bool(company.get("rge_types"))):
        return False
    if alert.get("rge") is False and company.get("is_rge", bool(company.get("rge_types"))):
        return False
    if alert.get("rge_types") and not set(alert["rge_types"]) & set(company.get("rge_types") or []):
        return False
    price = float(company.get("asking_price") or 0)
    if alert.get("max_price") and price > float(alert["max_price"]):
        return False
    if alert.get("min_price") and price < float(alert["min_price"]):
        return False
    ca = float(company.get("ca_n") or 0)
    if alert.get("min_ca") and ca < float(alert["min_ca"]):
        return False
    if alert.get("max_ca") and ca > float(alert["max_ca"]):
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

def listing_card_html(company: dict) -> str:
    """Résumé d'une annonce dans un e-mail (titre généré, métiers, localisation, effectif, CA, prix, badge RGE)"""
    title = company.get("title") or taxonomy.listing_title(company.get("trades") or [], company.get("region"), company.get("staff_count"))
    trades = ", ".join(taxonomy.trade_label(t, short=True) for t in company.get("trades") or [])
    place = " · ".join(x for x in [company.get("region"), taxonomy.departement_label(company.get("department")) if company.get("department") else ""] if x)
    rge = "RGE vérifié ADEME" if (company.get("company_checks") or {}).get("in_ademe_list") else ("Qualifications RGE déclarées" if company.get("rge_types") else "")
    lines = [f"<strong>{html_escape(title)}</strong>"]
    if trades:
        lines.append(html_escape(trades))
    if place:
        lines.append(html_escape(place))
    details = [f"CA {fmt_eur_fr(company['ca_n'])}" if company.get("ca_n") else "", f"Prix demandé {fmt_eur_fr(company['asking_price'])}" if company.get("asking_price") else "", rge]
    lines.append(" · ".join(html_escape(d) for d in details if d))
    link = site_url("/company/" + company["id"])
    return "<p>" + "<br>".join(lines) + f'<br><a href="{link}">Voir l\'annonce</a></p>'

@api_router.post("/alerts")
async def create_alert(alert: AlertCreate, current_user: dict = Depends(get_current_user)):
    """Alerte avec compte (adresse e-mail confirmée obligatoire) : métiers, régions, prix maximum, RGE"""
    require_verified_email(current_user)
    count = await db.alerts.count_documents({"user_id": current_user["id"]})
    if count >= MAX_ALERTS_PER_USER:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_ALERTS_PER_USER} alertes autorisées")
    fields = normalize_alert_fields(alert.model_dump())
    alert_doc = {
        "id": str(uuid.uuid4()), "user_id": current_user["id"], "user_email": current_user["email"],
        "trades": [], "regions": [], "max_price": None, "rge": None, "rge_types": [], "region": None,
        "min_price": None, "min_ca": None, "max_ca": None, **fields,
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
        "id": str(uuid.uuid4()), "email": email, "trades": fields.get("trades") or [], "regions": fields.get("regions") or [],
        "max_price": fields.get("max_price"), "rge": fields.get("rge"), "status": "pending",
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
<small>{html_escape(site_name())} est opéré par AlterEgo SAS, carte professionnelle T. Aucune somme n'est due avant la signature de l'acte de cession.</small></main></body></html>"""
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
async def alert_recipients_for(company: dict) -> list:
    """[(email, nom, lien de désinscription, alert_doc, kind)] des alertes actives qui correspondent à l'annonce"""
    recipients = []
    seen = set()
    # Une annonce de test n'est signalée qu'aux alertes de test (jamais aux abonnés réels)
    alert_query = {"is_test": True} if company.get("is_test") else {}
    async for alert in db.alerts.find({"active": True, **alert_query}, {"_id": 0}):
        if not alert_matches(alert, company):
            continue
        user = await db.users.find_one({"id": alert.get("user_id")}, {"_id": 0, "id": 1, "email": 1, "first_name": 1, "last_name": 1,
                                                                        "deleted_at": 1, "notifications_opt_out": 1})
        if not user or user.get("deleted_at") or user.get("notifications_opt_out") or user["email"] in seen:
            continue
        seen.add(user["email"])
        recipients.append((user["email"], display_name(user), unsubscribe_link_for_user(user["id"]), alert, "account"))
    async for alert in db.public_alerts.find({"status": "active", **alert_query}, {"_id": 0}):
        if alert["email"] in seen or not alert_matches(alert, company):
            continue
        seen.add(alert["email"])
        recipients.append((alert["email"], "", unsubscribe_link_for_public_alert(alert["id"]), alert, "public"))
    return recipients

async def trigger_alerts_for_company(company: dict) -> int:
    """Envoi immédiat aux alertes (compte et sans compte) qui correspondent à une annonce publiée ; renvoie le nombre d'envois"""
    sent = 0
    now = datetime.now(timezone.utc).isoformat()
    for email, name, unsubscribe, alert, kind in await alert_recipients_for(company):
        if not await claim_once("alert_listing", f"{alert['id']}:{company['id']}"):
            continue
        subject, html = render_email("alert_new_listing", criteria=alert_name_for(alert), card=listing_card_html(company))
        await send_brevo_email(email, name, subject, html, unsubscribe_url=unsubscribe)
        coll = db.alerts if kind == "account" else db.public_alerts
        await coll.update_one({"id": alert["id"]}, {"$set": {"last_triggered": now}})
        sent += 1
    return sent

async def count_matching_alerts(company: dict) -> int:
    return len(await alert_recipients_for(company))

async def job_alerts_weekly_digest(now: datetime) -> int:
    """Digest hebdomadaire : annonces publiées depuis 7 jours qui correspondent à chaque alerte active (une fois par semaine)"""
    since = (now - timedelta(days=7)).isoformat()
    companies = await db.companies.find({"status": "published", "published_at": {"$gte": since}}, PUBLIC_COMPANY_PROJECTION).to_list(500)
    if not companies:
        return 0
    week = _period_keys(now)["weekly"]
    sent = 0
    async def send_digest(alert: dict, email: str, name: str, unsubscribe: str) -> bool:
        # Les annonces de test ne figurent que dans le digest des alertes de test
        matching = [c for c in companies if alert_matches(alert, c) and (alert.get("is_test") or not c.get("is_test"))]
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

async def notify_price_drop(company: dict, old_price: float, new_price: float) -> int:
    """Baisse de prix d'une annonce en ligne : repreneurs qui l'ont mise en favori ou contactée (une fois par prix)"""
    buyer_ids = {f["user_id"] async for f in db.favorites.find({"company_id": company["id"]}, {"_id": 0, "user_id": 1})}
    buyer_ids |= {c["buyer_id"] async for c in db.conversations.find({"company_id": company["id"]}, {"_id": 0, "buyer_id": 1})}
    sent = 0
    for buyer_id in buyer_ids:
        if not buyer_id or not await claim_once("price_drop", f"{buyer_id}:{company['id']}:{int(new_price)}"):
            continue
        await email_user(buyer_id, "price_drop", unsubscribe_url=unsubscribe_link_for_user(buyer_id),
                         old_price=fmt_eur_fr(old_price), new_price=fmt_eur_fr(new_price), card=listing_card_html(dict(company)))
        sent += 1
    return sent

# ============ SELLER STATS ============

@api_router.get("/companies/{company_id}/stats")
async def get_company_stats(company_id: str, current_user: dict = Depends(get_current_user)):
    """Récupérer les statistiques d'une annonce (vendeur uniquement)"""
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Annonce non trouvée")
    
    # Only seller can see full stats
    if current_user["id"] != company.get("seller_id") and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Non autorisé")
    
    # Get stats
    views = company.get("views", 0)
    favorites_count = await db.favorites.count_documents({"company_id": company_id})
    messages_count = await db.messages.count_documents({"company_id": company_id})
    unique_contacts = len(set([
        msg["sender_id"] async for msg in db.messages.find(
            {"company_id": company_id, "receiver_id": company.get("seller_id")},
            {"sender_id": 1}
        )
    ]))
    offers_count = await db.offers.count_documents({"company_id": company_id})
    
    return {
        "company_id": company_id,
        "views": views,
        "favorites_count": favorites_count,
        "messages_count": messages_count,
        "unique_contacts": unique_contacts,
        "offers_count": offers_count
    }

# ============ ENHANCED ADMIN ROUTES ============

@api_router.get("/admin/companies")
async def get_all_companies_admin(current_user: dict = Depends(get_current_user)):
    """Admin: Récupérer toutes les annonces avec détails complets"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    companies = await db.companies.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    # Enrich with seller info
    for company in companies:
        seller = await db.users.find_one({"id": company.get("seller_id")}, USER_SAFE_PROJECTION)
        if seller:
            company["seller"] = seller
        
        # Add stats
        company["favorites_count"] = await db.favorites.count_documents({"company_id": company["id"]})
        company["messages_count"] = await db.messages.count_documents({"company_id": company["id"]})
    
    return {"companies": companies}

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
    """Inscription à la newsletter RGE - Intégration Brevo"""
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

# ============ CONTRACT TEMPLATES MANAGEMENT ============

# Default Mandat Vendeur Template
# ============ GABARITS CONTRACTUELS (SPEC §3.2 à §3.4) ============
# Textes complets en français, sans case à cocher ni blanc : toutes les variables {{...}} sont renseignées à la
# génération, sinon la génération échoue en nommant le champ manquant. Version des conditions : CONTRACT_TERMS_DATE.
CONTRACT_TERMS_DATE = "10/10/2026"
# Art. 10.4 : un seul texte pour tous les mandants. Le mandat est signé 100 % en ligne (contrat à distance) : l'art. L221-3
# C. conso ne vise que les contrats hors établissement (cadre-legal §2.6) ; la demande d'exécution immédiate est conservée.
MANDATE_EXECUTION_CLAUSE = ("Le présent mandat est conclu à distance, par voie électronique : il n'ouvre pas de droit de rétractation au titre "
                            "de l'article L221-3 du code de la consommation, qui ne vise que les contrats conclus hors établissement. "
                            "Le Mandant demande expressément que l'exécution du mandat (diffusion de l'annonce) commence dès sa signature ; "
                            "aucune somme ne lui est demandée à ce titre (article 6 de la loi n° 70-9 du 2 janvier 1970).")
MANDATE_TERMS_VERSION = "v2"
MANDATE_DURATION_MONTHS = 12
MANDATE_TAIL_MONTHS = 18
MANDATE_NOTICE_DAYS = 15
NDA_DURATION_MONTHS = 24
# Phrases remplacées à la signature (numéro de registre et horodatage ne sont connus qu'à ce moment-là)
MANDATE_REGISTRY_PENDING = "attribué automatiquement lors de la signature électronique et reporté sur l'exemplaire signé"
SIGNATURE_DATE_PENDING = "à la date et à l'heure de l'horodatage du code de signature, qui font foi entre les parties"

# Mandat de vente simple (non exclusif) : aucune clause d'exclusivité, de pénalité ni de garantie de rémunération
# (rien qui relève de l'art. 78 du décret n° 72-678).
DEFAULT_MANDAT_TEMPLATE = """MANDAT DE VENTE SIMPLE (NON EXCLUSIF)

Mandat n° {{MANDAT_NUMERO}} — Annonce {{ANNONCE_REF}} — Conditions du {{VERSION_CONDITIONS}}
Numéro d'inscription au registre des mandats : {{REGISTRE}}

ENTRE LES SOUSSIGNÉS

1. Le Mandataire
{{PLATEFORME_DENOMINATION}} SAS, {{PLATEFORME_FORME_JURIDIQUE}} au capital de {{PLATEFORME_CAPITAL}}, immatriculée au RCS de {{PLATEFORME_RCS_VILLE}} sous le numéro {{PLATEFORME_SIREN}}, dont le siège est {{PLATEFORME_ADRESSE_COMPLETE}}, exploitant la plateforme {{MARQUE}}, titulaire de la carte professionnelle n° {{CARTE_T}} portant la mention « Transactions sur immeubles et fonds de commerce », délivrée par la {{CARTE_T_CCI}}, valable jusqu'au {{CARTE_T_VALIDITE}}, représentée par sa Présidente, {{PLATEFORME_REPR_NOM}}.
{{PLATEFORME_DENOMINATION}} SAS déclare ne recevoir ni détenir d'autres fonds, effets ou valeurs que ceux représentatifs de sa rémunération. {{RC_PRO}}
Ci-après « le Mandataire ».

2. Le Mandant
{{MANDANT_PRENOM}} {{MANDANT_NOM}}, adresse électronique confirmée : {{MANDANT_EMAIL}}, demeurant {{MANDANT_ADRESSE}}, agissant en qualité de {{MANDANT_QUALITE}} de la société {{CIBLE_DENOMINATION}} ({{CIBLE_FORME_JURIDIQUE}}, SIREN {{CIBLE_SIREN}}, siège : {{CIBLE_SIEGE}}).
Le Mandant déclare avoir qualité et pouvoir pour engager l'ensemble des titulaires des titres ou le propriétaire du fonds.
Ci-après « le Mandant ».

IL A ÉTÉ CONVENU CE QUI SUIT

Article 1 – Objet du mandat
Le Mandant confie au Mandataire, qui l'accepte, la mission de rechercher un acquéreur en vue de {{OBJET}}.
Prix demandé : {{PRIX_DEMANDE}}. Ce prix est indicatif : le Mandant reste libre d'accepter ou de refuser toute offre, quel qu'en soit le montant.

Article 2 – Nature du mandat : mandat simple, non exclusif
Le présent mandat est un mandat simple. Le Mandant conserve la faculté de rechercher lui-même un acquéreur ou de confier des mandats à d'autres intermédiaires. Aucune indemnité, pénalité ni commission n'est due au Mandataire si la vente est conclue avec un acquéreur qui ne lui a pas été présenté par le Mandataire.

Article 3 – Durée, prolongation, dénonciation
3.1. Le mandat est conclu pour une durée de {{DUREE_MOIS}} mois à compter de sa signature. Il n'est pas reconduit tacitement.
3.2. Il peut être prolongé par périodes de {{DUREE_MOIS}} mois par accord exprès du Mandant, donné dans son espace en ligne par une nouvelle signature par code à usage unique ; chaque prolongation est horodatée et jointe au dossier de preuve.
3.3. Chacune des parties peut dénoncer le mandat à tout moment, par notification dans l'espace en ligne ou par courrier électronique à l'adresse de l'autre partie, avec un préavis de {{PREAVIS_JOURS}} jours. L'horodatage de la plateforme fait foi entre les parties. À la date d'effet, l'annonce est retirée.
3.4. Le mandat prend fin de plein droit, sans préavis, si l'annonce est retirée par la modération de la plateforme ; le Mandant en est informé par courrier électronique avec le motif du retrait.

Article 4 – Mission du Mandataire
Le Mandataire s'engage à :
a) diffuser sur la plateforme {{MARQUE}} une annonce anonyme ne révélant ni le nom de la société ni celui du Mandant ;
b) contrôler les qualifications déclarées sur les bases publiques (annuaire des professionnels RGE de l'ADEME, registres des entreprises) ;
c) qualifier les repreneurs : profil de projet, adresse électronique confirmée et identité vérifiée avant toute révélation du nom de la société ;
d) mettre à disposition du Mandant et des repreneurs une messagerie, un accord de confidentialité signé électroniquement, un espace documentaire sécurisé (data room) et des outils d'offre ;
e) informer le Mandant de tout contact, de toute demande d'accès au dossier et de toute offre ;
f) tenir la liste nominative des repreneurs présentés au Mandant, c'est-à-dire des repreneurs ayant signé l'accord de confidentialité relatif à l'entreprise.
Le Mandataire ne négocie pas, ne rédige pas les actes et ne fournit pas de conseil juridique, fiscal ou financier. Le Mandant et le repreneur conduisent la négociation et la rédaction des actes avec leurs propres conseils.

Article 5 – Obligations du Mandant
Le Mandant s'engage à :
a) fournir des informations exactes et à les tenir à jour pendant toute la durée du mandat ;
b) signaler au Mandataire, sans délai, toute vente, promesse ou négociation directe avec un repreneur présenté ;
c) répondre aux demandes des repreneurs et du Mandataire dans un délai raisonnable ;
d) respecter la confidentialité des informations reçues sur les repreneurs ; le Mandataire respecte réciproquement celle des informations reçues sur l'entreprise ;
e) accepter que le Mandataire consulte les publications légales de la société (BODACC) pendant la durée du mandat et la période visée à l'article 7, afin de vérifier qu'aucune cession conclue avec un repreneur présenté n'est restée non déclarée ; toute publication de cession ou de changement de dirigeant donne lieu à une demande d'explication au Mandant.

Article 6 – Rémunération du Mandataire
6.1. Barème : {{BAREME_COMMISSION}} {{ESTIMATION_COMMISSION}}
6.2. La rémunération est à la charge du Mandant. Elle est due uniquement si la cession (cession de titres ou de fonds, totale ou partielle, y compris au profit d'une société liée au repreneur) est conclue avec un repreneur nommément présenté par le Mandataire, c'est-à-dire inscrit sur la liste des présentations visée à l'article 4 f). Elle est exigible à la signature de l'acte définitif de cession. Aucune somme n'est due avant cette signature (article 6 de la loi n° 70-9 du 2 janvier 1970).
6.3. Paiement : en cas de cession de titres, sous trente jours à compter de la signature de l'acte ; en cas de cession de fonds de commerce, par prélèvement du séquestre sur le prix lors de sa libération, avant toute distribution au Mandant, et au plus tard cent quatre-vingts jours après l'acte.
6.4. Le Mandant donne ordre irrévocable au rédacteur de l'acte (notaire, avocat ou expert-comptable) de régler la rémunération du Mandataire sur le prix de cession. Il s'engage à reproduire dans l'acte de cession la désignation du Mandataire et le montant de sa rémunération, et à communiquer au Mandataire l'identité du rédacteur de l'acte ainsi que la date de signature.

Article 7 – Clause de suite
La rémunération prévue à l'article 6 reste due si la cession est conclue, dans les {{SUITE_MOIS}} mois suivant la fin du mandat, quelle qu'en soit la cause, avec un repreneur nommément présenté par le Mandataire. La liste nominative des repreneurs présentés est communiquée au Mandant à la fin du mandat.

Article 8 – Registre des mandats
Le présent mandat est inscrit par ordre chronologique au registre des mandats du Mandataire sous le numéro {{REGISTRE}}. Ce numéro est reporté sur l'exemplaire remis au Mandant.

Article 9 – Signature électronique et preuve
Le mandat est signé par un code à usage unique envoyé à l'adresse électronique confirmée du Mandant. Le dossier de preuve (empreinte SHA-256 du document, horodatage, adresse IP, navigateur, identité vérifiée du signataire, référence du code) est conservé dix ans et annexé à l'exemplaire PDF. Les parties conviennent que ce procédé identifie le signataire et garantit l'intégrité de l'acte, conformément aux articles 1366 et 1367 du code civil. Le Mandataire contresigne le mandat par voie électronique dès la signature du Mandant.

Article 10 – Mentions
10.1. Aucune somme d'argent, commission, frais de recherche, de démarche, de publicité ou d'entremise ne peut être exigée ni acceptée par le Mandataire avant la conclusion de l'opération (article 6 de la loi n° 70-9 du 2 janvier 1970).
10.2. Données personnelles : le Mandataire traite les données du Mandant pour l'exécution du mandat, la tenue du registre et le respect de ses obligations légales ; elles sont conservées dix ans pour le mandat et les preuves de signature. Le Mandant dispose des droits d'accès, de rectification, d'effacement et d'opposition, qu'il exerce à l'adresse {{CONTACT_EMAIL}}. Politique de confidentialité : {{URL_POLITIQUE_CONFIDENTIALITE}}.
10.3. {{MEDIATEUR}}
10.4. {{EXECUTION_IMMEDIATE}}
10.5. Le présent mandat est soumis au droit français. Tout litige relatif à sa validité, son interprétation ou son exécution relève, à défaut d'accord amiable, de la compétence des tribunaux de {{TRIBUNAL_COMPETENT}}.

SIGNATURES
Fait par voie électronique, en un exemplaire conservé par le Mandataire et remis au Mandant au format PDF, {{DATE_SIGNATURE}}.
Référence : mandat n° {{MANDAT_NUMERO}} — registre n° {{REGISTRE}} — annonce {{ANNONCE_REF}}."""

# Accord de confidentialité v2 : signé par le repreneur (identité vérifiée) avec AlterEgo pour le compte du cédant,
# désigné par la référence de l'annonce jusqu'à la révélation (Annexe A, jointe après signature).
DEFAULT_NDA_TEMPLATE = """ACCORD DE CONFIDENTIALITÉ

Accord n° {{NDA_NUMERO}} — Annonce {{ANNONCE_REF}} — Conditions du {{VERSION_CONDITIONS}}

ENTRE LES SOUSSIGNÉS

1. L'Opérateur
{{PLATEFORME_DENOMINATION}} SAS, {{PLATEFORME_FORME_JURIDIQUE}} au capital de {{PLATEFORME_CAPITAL}}, RCS {{PLATEFORME_RCS_VILLE}} {{PLATEFORME_SIREN}}, siège {{PLATEFORME_ADRESSE_COMPLETE}}, exploitant la plateforme {{MARQUE}}, titulaire de la carte professionnelle n° {{CARTE_T}} (Transactions sur immeubles et fonds de commerce) délivrée par la {{CARTE_T_CCI}}, agissant pour le compte du cédant de l'annonce {{ANNONCE_REF}} en vertu du mandat qui lui a été confié.
Ci-après « l'Opérateur ».

2. Le Repreneur
{{REPRENEUR_IDENTITE}}
Ci-après « le Repreneur ».

3. Le Cédant bénéficiaire
Le cédant est désigné par la référence de l'annonce {{ANNONCE_REF}} jusqu'à la signature du présent accord. Son identité et celle de la société sont communiquées au Repreneur immédiatement après signature, en Annexe A, qui fait partie intégrante de l'accord. L'Opérateur stipule le présent accord au bénéfice du cédant, qui peut s'en prévaloir directement.

IL A ÉTÉ CONVENU CE QUI SUIT

Article 1 – Objet
Le présent accord encadre la communication au Repreneur d'informations confidentielles relatives à l'entreprise présentée sous l'annonce {{ANNONCE_REF}} (entreprise du bâtiment, {{CIBLE_ACTIVITE}}, {{CIBLE_LOCALISATION}}, prix demandé indicatif : {{PRIX_DEMANDE}}), dans le seul but d'étudier sa reprise.

Article 2 – Informations couvertes
Sont confidentielles toutes les informations communiquées au Repreneur, par quelque moyen que ce soit, par l'Opérateur ou le cédant, et notamment : l'identité du cédant et de la société ; les données financières, commerciales, juridiques, sociales et techniques ; les qualifications et leurs numéros ; les clients, fournisseurs, salariés, contrats, carnet de commandes et prix ; les documents de l'espace documentaire ; l'existence même des discussions.
Ne sont pas confidentielles les informations dont le Repreneur démontre qu'elles sont publiques sans faute de sa part, qu'il les détenait avant leur communication ou qu'il les a reçues licitement d'un tiers non tenu au secret.

Article 3 – Engagements du Repreneur
Pendant {{NDA_DUREE_MOIS}} mois à compter de la signature, le Repreneur s'engage à :
a) garder strictement confidentielles les informations couvertes et ne les communiquer qu'à ses conseils (expert-comptable, avocat, banque) tenus à une obligation de confidentialité équivalente, pour les seuls besoins de l'étude ;
b) n'utiliser les informations couvertes qu'aux fins d'étudier la reprise de l'entreprise, à l'exclusion de toute autre finalité, notamment concurrentielle ;
c) ne pas contacter les salariés, clients, fournisseurs ou partenaires de l'entreprise sans l'accord écrit préalable du cédant ;
d) conduire les échanges et la négociation par la plateforme {{MARQUE}} ou, s'il négocie directement avec le cédant, en informer sans délai le cédant et l'Opérateur ; la présentation du Repreneur au cédant est faite par l'Opérateur, en exécution du mandat du cédant ;
e) restituer ou détruire, à première demande ou à la fin des discussions, les documents reçus et leurs copies, sous réserve des obligations légales de conservation de ses conseils.

Article 4 – Accès à l'espace documentaire
L'accès aux documents de l'entreprise est ouvert après signature du présent accord et après la déclaration par le Repreneur de l'origine des fonds envisagés pour la reprise (apport, emprunt, investisseurs), demandée dans son espace. Les documents consultés portent un filigrane nominatif ; l'Opérateur tient un journal horodaté des consultations (utilisateur, adresse IP, navigateur, empreinte du document), qui fait foi entre les parties.

Article 5 – Absence d'engagement de conclure
Le présent accord ne constitue ni promesse de vente ni promesse d'achat. Chaque partie reste libre de mettre fin aux discussions à tout moment. Les droits sur les informations communiquées restent la propriété du cédant.

Article 6 – Responsabilité
Tout manquement du Repreneur ou de ses conseils engage sa responsabilité envers le cédant et l'Opérateur, qui pourront demander réparation du préjudice subi devant la juridiction compétente. Le Repreneur informe immédiatement l'Opérateur de toute divulgation imposée par la loi ou une autorité et la limite au strict nécessaire.

Article 7 – Signature électronique et preuve
L'accord est signé par un code à usage unique envoyé à l'adresse électronique confirmée du Repreneur, dont l'identité a été vérifiée. Le dossier de preuve (empreinte SHA-256 du document, horodatage, adresse IP, navigateur, identité vérifiée, référence du code) est conservé dix ans et annexé à l'exemplaire PDF remis aux deux parties. Les parties conviennent que ce procédé identifie le signataire et garantit l'intégrité de l'acte (articles 1366 et 1367 du code civil).

Article 8 – Données personnelles
L'Opérateur traite les données d'identité et de contact du Repreneur pour l'exécution du présent accord, la sécurité de l'espace documentaire et le respect de ses obligations légales (lutte contre le blanchiment). Les images des pièces d'identité ne sont jamais conservées. Droits d'accès, de rectification, d'effacement et d'opposition : {{CONTACT_EMAIL}}. Politique de confidentialité : {{URL_POLITIQUE_CONFIDENTIALITE}}.

Article 9 – Droit applicable
Le présent accord est soumis au droit français. Tout litige relève, à défaut d'accord amiable, de la compétence des tribunaux de {{TRIBUNAL_COMPETENT}}.

SIGNATURE
Fait par voie électronique, {{DATE_SIGNATURE}}.
Référence : accord n° {{NDA_NUMERO}} — annonce {{ANNONCE_REF}}.

ANNEXE A — Identité du cédant et de la société (communiquée après signature)
Société : {{CIBLE_DENOMINATION}} ({{CIBLE_FORME_JURIDIQUE}}), SIREN {{CIBLE_SIREN}}, siège : {{CIBLE_SIEGE}}.
Cédant : {{VENDEUR_PRENOM}} {{VENDEUR_NOM}}.
Qualifications déclarées : {{CIBLE_QUALIFICATIONS}}.
Le Repreneur reconnaît que ces informations constituent des informations couvertes au sens de l'article 2."""

# Offre indicative (remplace la lettre d'intention) : signée par le repreneur, contresignée par le cédant à l'acceptation
DEFAULT_OFFER_TEMPLATE = """OFFRE INDICATIVE D'ACQUISITION

Offre n° {{OFFRE_NUMERO}} — Annonce {{ANNONCE_REF}} — Conditions du {{VERSION_CONDITIONS}}

1. Le Repreneur
{{REPRENEUR_IDENTITE}}

2. Le Cédant
{{VENDEUR_PRENOM}} {{VENDEUR_NOM}}, pour la société {{CIBLE_DENOMINATION}} ({{CIBLE_FORME_JURIDIQUE}}, SIREN {{CIBLE_SIREN}}, siège : {{CIBLE_SIEGE}}).

3. Plateforme
L'offre est transmise par {{PLATEFORME_DENOMINATION}} SAS, exploitant la plateforme {{MARQUE}}, carte professionnelle n° {{CARTE_T}} délivrée par la {{CARTE_T_CCI}}, en exécution du mandat de vente simple confié par le Cédant. {{PLATEFORME_DENOMINATION}} SAS ne négocie pas, ne rédige pas les actes et ne fournit aucun conseil juridique, fiscal ou financier.

Article 1 – Objet
Le Repreneur propose au Cédant d'acquérir {{OBJET}}.

Article 2 – Prix proposé
Prix proposé : {{MONTANT}}.
Financement envisagé : apport personnel {{FIN_APPORT}} ; emprunt bancaire {{FIN_EMPRUNT}} ; crédit vendeur {{FIN_CREDIT_VENDEUR}} ; complément de prix conditionnel {{FIN_COMPLEMENT}}.

Article 3 – Conditions
{{CONDITIONS}}

Article 4 – Calendrier
Date cible de signature de l'acte : {{DATE_CIBLE}}.
Validité de l'offre : {{VALIDITE_JOURS}} jours à compter de sa signature, soit jusqu'au {{DATE_EXPIRATION}}. Passé ce délai sans acceptation, l'offre est caduque.

Article 5 – Message du Repreneur
{{MESSAGE}}

Article 6 – Portée de l'offre
La présente offre est indicative. Elle exprime l'intention du Repreneur d'acquérir l'entreprise aux conditions ci-dessus et ne constitue pas une promesse d'achat ; l'acceptation du Cédant ne constitue pas une promesse de vente. Les parties conviennent de poursuivre de bonne foi la négociation, les vérifications et la rédaction des actes avec leurs conseils. Restent applicables : l'accord de confidentialité signé par le Repreneur, le mandat de vente simple du Cédant (la rémunération de {{PLATEFORME_DENOMINATION}} SAS est à la charge du Cédant, due uniquement à la signature de l'acte de cession ; rien n'est dû par le Repreneur) et les présentes stipulations relatives à la signature.

Article 7 – Signature électronique et preuve
L'offre est signée par le Repreneur, puis acceptée et contresignée par le Cédant, par un code à usage unique envoyé à l'adresse électronique confirmée de chaque signataire. Le dossier de preuve de chaque signature (empreinte SHA-256, horodatage, adresse IP, navigateur, identité vérifiée, référence du code) est conservé dix ans et annexé à l'exemplaire PDF remis aux deux parties (articles 1366 et 1367 du code civil). Une contre-proposition du Cédant est horodatée depuis son espace et prend effet à son acceptation par le Repreneur, signée par code.

SIGNATURE DU REPRENEUR
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
    # Mandat simple (SPEC §3.2) et accord de confidentialité (SPEC §3.3)
    "DUREE_MOIS": str(MANDATE_DURATION_MONTHS),
    "PREAVIS_JOURS": str(MANDATE_NOTICE_DAYS),
    "SUITE_MOIS": str(MANDATE_TAIL_MONTHS),
    "NDA_DUREE_MOIS": str(NDA_DURATION_MONTHS),
}

# ============ NEW WORKFLOW ENDPOINTS ============

# ============ MANDAT DE VENTE SIMPLE v2 (SPEC §3.2, API.md §6) ============
MANDATE_REQUIRED_FIELDS = {"mandant_address": "adresse postale du mandant", "sale_object": "objet de la cession (titres, fonds ou indifférent)",
                           "company_name": "dénomination de la société", "siret": "SIRET de la société"}

def mandate_pdf_path(contract_id: str) -> str:
    return f"/api/seller/mandat/{contract_id}/pdf"

def mandate_pdf_link(contract: dict) -> str:
    """Lien de téléchargement authentifié par jeton (e-mail envoyé au mandant à la signature)"""
    return site_url(f"{mandate_pdf_path(contract['id'])}?token={contract.get('pdf_token', '')}")

def mandate_summary(company: dict) -> list:
    """Résumé en 5 lignes affiché avant le texte dépliable (SPEC §4.2.3)"""
    objet = SALE_OBJECT_CESSION.get(company.get("sale_object") or "indifferent", SALE_OBJECT_CESSION["indifferent"]).format(name=company.get("company_name") or "")
    prix = fmt_eur_fr(company["asking_price"]) if company.get("asking_price") else "à fixer sur l'annonce"
    return [
        "Mandat simple, sans exclusivité : vous restez libre de vendre par vous-même ou par un autre intermédiaire, sans indemnité ni pénalité.",
        f"Objet : {objet} ; prix demandé {prix}, indicatif : vous restez libre d'accepter ou de refuser toute offre.",
        f"Durée {MANDATE_DURATION_MONTHS} mois, prolongeable par périodes de {MANDATE_DURATION_MONTHS} mois, résiliable à tout moment depuis votre espace avec un préavis de {MANDATE_NOTICE_DAYS} jours.",
        f"Rémunération à votre charge, due uniquement si la vente se fait avec un repreneur que nous vous avons nommément présenté : "
        f"6 % HT du prix (3 % HT au-delà d'un million), minimum {fmt_eur_fr(commission_minimum_ht())} HT, exigible à la signature de l'acte, rien avant.",
        f"Clause de suite de {MANDATE_TAIL_MONTHS} mois sur les repreneurs présentés ; signature par code reçu par e-mail, contre-signée par AlterEgo SAS, "
        "dossier de preuve conservé dix ans, numéro de registre attribué à la signature.",
    ]

async def mandate_variables(company: dict, user: dict, contract_number: str) -> dict:
    settings_doc = await db.platform_settings.find_one({"type": "contracts"}, {"_id": 0})
    settings = {**DEFAULT_PLATFORM_SETTINGS, **(settings_doc["settings"] if settings_doc else {})}
    name = company.get("company_name") or ""
    if company.get("asking_price"):
        c = calculate_commission(float(company["asking_price"]))
        estimation = (f"À titre indicatif, sur la base du prix demandé, la rémunération s'élèverait à {fmt_eur_fr(c['final_commission_ht'])} HT "
                      f"({fmt_eur_fr(c['final_commission_ttc'])} TTC) ; son montant définitif est calculé sur le prix de cession effectif.")
    else:
        estimation = "Son montant définitif est calculé sur le prix de cession effectif."
    mediateur = LEGAL_ENTITY.get("mediateur")
    return {
        **settings,
        "MANDANT_PRENOM": user.get("verified_first_name") or user.get("first_name") or "",
        "MANDANT_NOM": user.get("verified_last_name") or user.get("last_name") or "",
        "MANDANT_EMAIL": user.get("email", ""),
        "MANDANT_ADRESSE": fmt_address(company.get("mandant_address")),
        "MANDANT_QUALITE": mandant_capacity(company, user),
        **company_contract_variables(company),
        "OBJET": SALE_OBJECT_CESSION.get(company.get("sale_object") or "indifferent", SALE_OBJECT_CESSION["indifferent"]).format(name=name),
        "ESTIMATION_COMMISSION": estimation,
        "MEDIATEUR": (f"Médiateur de la consommation : {mediateur}. Le Mandant peut y recourir gratuitement en cas de litige non résolu à l'amiable."
                      if mediateur else "En cas de difficulté, les parties recherchent d'abord une solution amiable par échange dans l'espace en ligne ou par courrier électronique."),
        "EXECUTION_IMMEDIATE": MANDATE_EXECUTION_CLAUSE,
        "MANDAT_NUMERO": contract_number,
        "REGISTRE": MANDATE_REGISTRY_PENDING,
        "DATE_SIGNATURE": SIGNATURE_DATE_PENDING,
    }

async def latest_mandate(company_id: str, seller_id: Optional[str] = None) -> Optional[dict]:
    query = {"company_id": company_id, "type": "mandat"}
    if seller_id:
        query["seller_id"] = seller_id
    return await db.generated_contracts.find_one(query, {"_id": 0}, sort=[("created_at", -1)])

@api_router.post("/seller/mandat/generate")
async def generate_seller_mandat(company_id: str, current_user: dict = Depends(get_current_user)):
    """Cédant : génère le mandat de vente simple à signer. Exige l'e-mail confirmé (403 `email_not_verified`), l'identité
    vérifiée (403 `identity_required`), `mandant_address` et `sale_object` sur l'annonce (400 `validation`, `missing`)."""
    if current_user.get("role") != "seller":
        raise HTTPException(status_code=403, detail="Vendeur uniquement")
    company = await db.companies.find_one({"id": company_id, "seller_id": current_user["id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée ou non autorisée")
    if not is_email_verified(current_user):
        raise api_error(403, "email_not_verified", EMAIL_NOT_VERIFIED_DETAIL)
    if not is_user_verified(current_user):
        raise api_error(403, "identity_required", "Vérifiez votre identité avant de signer le mandat")

    existing = await latest_mandate(company_id, current_user["id"])
    if existing and existing.get("status") == "signed":
        return {"already_signed": True, "contract": {k: v for k, v in existing.items() if k != "pdf_token"},
                "summary": mandate_summary(company), "pdf_url": mandate_pdf_path(existing["id"])}

    missing = [f for f, _ in MANDATE_REQUIRED_FIELDS.items() if not company.get(f)]
    if company.get("mandant_address") and not fmt_address(company["mandant_address"]):
        missing.append("mandant_address")
    if missing:
        labels = ", ".join(MANDATE_REQUIRED_FIELDS[f] for f in missing)
        raise api_error(400, "validation", f"Complétez votre annonce avant de générer le mandat : {labels}", missing=missing)

    template_doc = await db.contract_templates.find_one({"type": "mandat"}, {"_id": 0})
    template = template_doc["content"] if template_doc else DEFAULT_MANDAT_TEMPLATE
    now = datetime.now(timezone.utc)
    pending = existing if existing and existing.get("status") == "pending_signature" else None
    contract_number = pending["contract_number"] if pending else f"MANDAT-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    content = render_template(template, await mandate_variables(company, current_user, contract_number))
    unresolved = missing_template_variables(content)
    if unresolved:
        raise api_error(400, "validation", "Le texte du mandat ne peut pas être complété", missing=unresolved)
    # Mandat de test : mention en tête, numéro pris dans le registre de test à la signature (jamais dans le registre réel)
    mandate_test = is_test_context(current_user, company, pending)
    content = with_test_banner(content, mandate_test)
    summary = mandate_summary(company)
    if pending:
        # Projet non signé régénéré avec les données à jour de l'annonce (adresse, objet, prix)
        regenerated = {
            "content": content, "updated_at": now.isoformat(), "terms_version": MANDATE_TERMS_VERSION, "terms_date": CONTRACT_TERMS_DATE,
            "mandant_address": fmt_address(company.get("mandant_address")), "sale_object": company.get("sale_object"), "signers_pending": [current_user["id"]]}
        if mandate_test:
            regenerated["is_test"] = True
        await db.generated_contracts.update_one({"id": pending["id"]}, {"$set": regenerated})
        return {"already_signed": False, "contract_id": pending["id"], "contract_number": contract_number, "content": content,
                "summary": summary, "terms_version": MANDATE_TERMS_VERSION, "terms_date": CONTRACT_TERMS_DATE, "type": "mandat"}
    contract_doc = {
        "id": str(uuid.uuid4()), "contract_number": contract_number, "type": "mandat", "company_id": company_id,
        "seller_id": current_user["id"], "content": content, "status": "pending_signature", "signers_pending": [current_user["id"]],
        "terms_version": MANDATE_TERMS_VERSION, "terms_date": CONTRACT_TERMS_DATE, "mandant_address": fmt_address(company.get("mandant_address")),
        "sale_object": company.get("sale_object"), "created_at": now.isoformat(), "auto_generated": True, "renewals": [],
    }
    if mandate_test:
        contract_doc["is_test"] = True
    await db.generated_contracts.insert_one(contract_doc)
    return {"already_signed": False, "contract_id": contract_doc["id"], "contract_number": contract_number, "content": content,
            "summary": summary, "terms_version": MANDATE_TERMS_VERSION, "terms_date": CONTRACT_TERMS_DATE, "type": "mandat"}

COMMISSION_PAYER_PLACEHOLDER = "[choix du Mandant lors de la signature]"
COMMISSION_PAYER_TEXT = {
    "cedant": "le Mandant (cédant)",
    "repreneur": "l'acquéreur (repreneur)",
}

class MandatSignature(BaseModel):
    otp_code: Optional[str] = None  # le débiteur n'est plus un choix : toujours le cédant (barème v2)

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
    """Cédant : signe le mandat par code. Numéro de registre, dates (12 mois, clause de suite 18 mois), contre-signature
    automatique d'AlterEgo SAS, dossier de preuve chaîné, e-mail avec lien PDF. Requis avant publication."""
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
    company = await db.companies.find_one({"id": contract.get("company_id")}, {"_id": 0})
    evidence = await verify_signature_code(current_user, contract, signature.otp_code, request)

    now = datetime.now(timezone.utc)
    payer = COMMISSION_PAYER  # toujours le cédant
    content = contract.get("content") or ""
    if COMMISSION_PAYER_PLACEHOLDER in content:  # anciens mandats générés avec un espace à compléter
        content = content.replace(COMMISSION_PAYER_PLACEHOLDER, COMMISSION_PAYER_TEXT[payer])
    mandate_test = is_test_context(contract, company, current_user)
    if mandate_test:
        # Registre de test séparé (compteur `mandate_registry_test`, numéro TEST-0001) : le registre réel n'avance jamais
        registry_number = mandate_test_number(await next_sequence(MANDATE_REGISTRY_TEST_COUNTER))
        content = with_test_banner(content, True)
    else:
        registry_number = await next_sequence("mandate_registry")
    signer_name = f"{current_user.get('verified_first_name') or current_user.get('first_name') or ''} {current_user.get('verified_last_name') or current_user.get('last_name') or ''}".strip()
    # Le gabarit porte déjà « numéro » / « n° » devant {{REGISTRE}} : seul le nombre est inséré (jamais « n° n° 12 »)
    content = content.replace(MANDATE_REGISTRY_PENDING, str(registry_number)).replace(SIGNATURE_DATE_PENDING, f"le {fmt_datetime_paris(now)}")
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
            "terms_version": MANDATE_TERMS_VERSION, "terms_date": contract.get("terms_date") or CONTRACT_TERMS_DATE,
            "seller_signature_hash": signature_hash, "commission_payer": payer, "commission_terms_version": COMMISSION_TERMS_VERSION,
            "registry_number": registry_number, "content": content, "signature_evidence": record["evidence"], "signature_record_id": record["id"],
            "countersignature": countersignature, "mandant_address": fmt_address((company or {}).get("mandant_address")) or contract.get("mandant_address"),
            "sale_object": (company or {}).get("sale_object") or contract.get("sale_object"), "renewals": contract.get("renewals") or [],
            "signers_pending": [current_user["id"]],  # une prolongation reste possible tant que le mandat est en cours
            "pdf_token": pdf_token, **({"is_test": True} if mandate_test else {}),
        }}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Mandat déjà signé")
    listing_update = {"mandat_signed": True, "mandat_signed_at": now.isoformat(), "mandate_id": contract_id, "commission_payer": payer,
                      "commission_terms_version": COMMISSION_TERMS_VERSION, "mandate_ends_at": ends_at.isoformat(),
                      "mandate_tail_ends_at": tail_ends_at.isoformat()}
    # Mandat de test sur une annonce réelle (créée hors essai, cédant réel) : l'annonce n'est jamais repassée en donnée de
    # test (la purge l'effacerait avec son mandat réel du registre) ; elle porte `mandate_is_test` et reste masquée au
    # public hors mode test tant qu'un vrai mandat n'est pas signé
    listing_update["mandate_is_test"] = mandate_test
    if mandate_test and is_test_related(company, current_user):
        listing_update["is_test"] = True  # annonce de test publiée sous un mandat de test (supprimée par la purge)
    await db.companies.update_one({"id": contract.get("company_id")}, {"$set": listing_update})
    await create_audit_log(action="MANDAT_SIGNED", company_id=contract.get("company_id"), actor_id=current_user["id"],
                           actor_email=current_user["email"], details={"contract_id": contract_id, "contract_number": contract.get("contract_number"),
                                                                       "registry_number": registry_number})
    # Mandat précédent dénoncé et encore en préavis : remplacé par le nouveau mandat, la date d'effet de la dénonciation
    # ne dépublie plus l'annonce (tâche `mandate_denounce_effective`)
    await db.generated_contracts.update_many(
        {"type": "mandat", "company_id": contract.get("company_id"), "id": {"$ne": contract_id}, "status": "denounced",
         "effective_applied": {"$ne": True}},
        {"$set": {"effective_applied": True, "superseded_by": contract_id, "superseded_at": now.isoformat()}})
    # L'annonce en attente de mandat, ou retirée à la fin du mandat précédent, poursuit son circuit (publication automatique)
    company = await db.companies.find_one({"id": contract.get("company_id")}, {"_id": 0})
    listing_status = company.get("status") if company else None
    if company and (company.get("status") == "mandat_en_attente" or (company.get("status") == "draft" and listing_complete(company))
                    or (company.get("status") == "withdrawn" and company.get("withdrawn_reason") == "mandate_ended")):
        listing_status = (await submit_listing(company, current_user)).get("status")
    signed = await db.generated_contracts.find_one({"id": contract_id}, {"_id": 0})
    await email_user(current_user["id"], "mandate_signed_pdf", registry_number=registry_number, contract_number=contract.get("contract_number", ""),
                     ends_at=fmt_date_fr(ends_at), pdf_link=mandate_pdf_link(signed), bareme=commission_scale_text())
    return {
        "status": "signed", "message": "Mandat signé avec succès", "contract_number": contract.get("contract_number"),
        "registry_number": registry_number, "signed_at": now.isoformat(), "ends_at": ends_at.isoformat(), "tail_ends_at": tail_ends_at.isoformat(),
        "terms_version": MANDATE_TERMS_VERSION, "commission_payer": payer, "signature_hash": signature_hash,
        "listing_status": listing_status, "pdf_url": mandate_pdf_path(contract_id),
    }

class MandateDenounce(BaseModel):
    reason: Optional[str] = Field(None, max_length=1000)

@api_router.post("/seller/mandat/{contract_id}/denounce")
async def denounce_seller_mandat(contract_id: str, data: Optional[MandateDenounce] = None, current_user: dict = Depends(get_current_user)):
    """Dénonciation du mandat par le mandant (ou par AlterEgo via l'admin) : préavis de 15 jours, e-mail aux deux parties,
    annonce dépubliée à la date d'effet par la tâche `mandate_denounce_effective`."""
    contract = await _mandate_for_owner(contract_id, current_user)
    if contract.get("status") != "signed":
        raise api_error(400, "validation", "Seul un mandat en cours peut être dénoncé")
    now = datetime.now(timezone.utc)
    effective_at = now + timedelta(days=MANDATE_NOTICE_DAYS)
    # Clause de suite (art. 7) : 18 mois à compter de la fin du mandat, « quelle qu'en soit la cause » → date d'effet + 18 mois
    tail_ends_at = add_months(effective_at, MANDATE_TAIL_MONTHS)
    by_role = "seller" if current_user["id"] == contract.get("seller_id") else "platform"
    by_text = "le Mandant" if by_role == "seller" else f"{LEGAL_ENTITY['denomination']} SAS"
    await db.generated_contracts.update_one({"id": contract_id, "status": "signed"}, {"$set": {
        "status": "denounced", "denounced_at": now.isoformat(), "denounced_by": current_user["id"], "denounced_by_role": by_role,
        "denounce_reason": (data.reason.strip() if data and data.reason else None), "effective_at": effective_at.isoformat(),
        "tail_ends_at": tail_ends_at.isoformat(), "signers_pending": []}})
    await db.companies.update_one({"id": contract.get("company_id"), "mandate_id": {"$in": [contract_id, None]}}, {"$set": {
        "mandate_denounced_at": now.isoformat(), "mandate_effective_at": effective_at.isoformat(), "mandate_tail_ends_at": tail_ends_at.isoformat()}})
    await create_audit_log(action="MANDAT_DENOUNCED", company_id=contract.get("company_id"), actor_id=current_user["id"], actor_email=current_user["email"],
                           details={"contract_id": contract_id, "effective_at": effective_at.isoformat(), "by": by_role})
    values = {"registry_number": contract.get("registry_number", ""), "contract_number": contract.get("contract_number", ""),
              "denounced_at": fmt_datetime_paris(now), "denounced_by": by_text, "effective_at": fmt_date_fr(effective_at), "company_id": contract.get("company_id", "")}
    await email_user(contract.get("seller_id"), "mandate_denounced", **values)
    await email_admin("mandate_denounced_admin", **values)
    return {"status": "denounced", "effective_at": effective_at.isoformat(), "denounced_at": now.isoformat(), "tail_ends_at": tail_ends_at.isoformat()}

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
    await db.companies.update_one({"id": contract.get("company_id")}, {"$set": {"mandate_ends_at": new_ends_at.isoformat(), "mandate_tail_ends_at": new_tail.isoformat()}})
    await create_audit_log(action="MANDAT_RENEWED", company_id=contract.get("company_id"), actor_id=current_user["id"], actor_email=current_user["email"],
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
    query = {"type": "mandat", "status": {"$in": ["signed", "denounced", "expired", "void"]}, "registry_number": {"$exists": True}}
    if not include_test:
        query["is_test"] = {"$ne": True}
    mandates = sorted(await db.generated_contracts.find(query, {"_id": 0}).to_list(None), key=_registry_sort_key)
    for m in mandates:
        company = await db.companies.find_one({"id": m.get("company_id")}, {"_id": 0, "company_name": 1, "id": 1, "status": 1})
        seller = await db.users.find_one({"id": m.get("seller_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company_name": 1})
        rows.append({
            "id": m["id"], "registry_number": m.get("registry_number"), "contract_number": m.get("contract_number"),
            "company_id": m.get("company_id"),
            "company_label": (company or {}).get("company_name") or f"PRJ-{(m.get('company_id') or '')[:8].upper()}",
            "listing_status": (company or {}).get("status"),
            "seller_name": display_name(seller), "commission_payer": m.get("commission_payer"),
            "signed_at": m.get("signed_at"), "ends_at": m.get("ends_at"), "tail_ends_at": m.get("tail_ends_at"), "effective_at": m.get("effective_at"),
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
    writer.writerow(["N° registre", "N° mandat", "Date de signature", "Échéance", "Clause de suite", "Statut", "Annonce", "Cédant",
                     "Débiteur de la commission", "Version", "Statut annonce", "Méthode de signature", "Test"])
    for r in data:
        writer.writerow([r["registry_number"], r["contract_number"], (r["signed_at"] or "")[:19], (r["ends_at"] or "")[:10], (r["tail_ends_at"] or "")[:10],
                         r["status"], r["company_label"], r["seller_name"], COMMISSION_PAYER_TEXT.get(r["commission_payer"], ""), r["terms_version"],
                         r["listing_status"], r["signature_method"], "oui" if r["test"] else "non"])
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=registre-des-mandats.csv"})

@api_router.get("/seller/mandat/{contract_id}/pdf")
async def download_mandat_pdf(contract_id: str, token: Optional[str] = None, current_user: Optional[dict] = Depends(get_current_user_optional)):
    """PDF du mandat avec page de preuve. Connecté (cédant, admin) : JSON {filename, content base64} ;
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

@api_router.get("/seller/mandat/status/{company_id}")
async def get_mandat_status(company_id: str, current_user: dict = Depends(get_current_user)):
    """État du mandat de l'annonce (dernier mandat : signé, dénoncé, expiré, caduc ou en attente) et repreneurs présentés"""
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")
    if current_user.get("role") != "admin" and not is_company_owner(company, current_user):
        raise HTTPException(status_code=403, detail="Non autorisé")
    mandat = None
    if company.get("mandate_id"):
        mandat = await db.generated_contracts.find_one({"id": company["mandate_id"], "type": "mandat"}, {"_id": 0})
    if not mandat:
        mandat = await latest_mandate(company_id)
    return {"mandat_signed": bool(mandat) and mandat.get("status") == "signed", "mandat": mandate_view(mandat),
            "presented_buyers": await presented_buyers_view(company)}

# ---- Fin de mandat (expiration, dénonciation effective) ----
async def end_mandate(contract: dict, reason: str, listing_status: str, now: datetime, ended_at: Optional[datetime] = None) -> None:
    """Dépublie l'annonce et envoie au mandant la liste nominative des repreneurs présentés (clause de suite).
    L'annonce n'est modifiée que si ce mandat est celui qui la couvre (`company.mandate_id`) : un nouveau mandat signé
    entre-temps la laisse en ligne, et aucun e-mail de fin de mandat n'est alors envoyé."""
    company = await db.companies.find_one({"id": contract.get("company_id")}, {"_id": 0})
    if company and company.get("mandate_id") and company["mandate_id"] != contract.get("id"):
        if await has_signed_mandate(company):
            return
        company = None  # annonce couverte par un autre mandat (caduc, expiré…) : seule la liste des présentés est envoyée
    if company:
        update = {"mandat_signed": False, "updated_at": now.isoformat(), "mandate_ended_at": now.isoformat()}
        if company.get("status") == "published":
            update["status"] = listing_status
            if listing_status == "withdrawn":
                # Retrait lié à la fin du mandat : un nouveau mandat signé remet l'annonce en ligne (sign_seller_mandat)
                update.update({"withdrawn_reason": "mandate_ended", "withdrawn_at": now.isoformat()})
        await db.companies.update_one({"id": company["id"]}, {"$set": update})
    else:
        company = await db.companies.find_one({"id": contract.get("company_id")}, {"_id": 0})
    buyers = await presented_buyers_view(company or {})
    if buyers:
        lines = [f"{b.get('name') or b['label']}" + (f" ({b['company_name']})" if b.get("company_name") else "") + f", accord signé le {fmt_date_fr(b.get('at'))}"
                 for b in buyers]
        buyers_list = " ; ".join(lines)
    else:
        buyers_list = "aucun repreneur ne vous a été nommément présenté pendant ce mandat"
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
                             link=site_url(f"/seller/mandat/{m.get('company_id')}"))
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
@api_router.post("/buyer/request-commercial-info")
async def request_commercial_info(company_id: str, current_user: dict = Depends(get_current_user)):
    """
    Acheteur: Demande les informations commerciales après signature NDA.
    """
    if current_user["role"] != "buyer":
        raise HTTPException(status_code=403, detail="Acheteur uniquement")
    
    # Check NDA signed
    nda_signed = await db.generated_contracts.find_one({
        "company_id": company_id,
        "buyer_id": current_user["id"],
        "type": "nda",
        "status": "signed"
    })
    
    if not nda_signed:
        raise HTTPException(status_code=400, detail="Vous devez d'abord signer le NDA")
    
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")
    
    # Check if already requested
    existing_request = await db.commercial_info_requests.find_one({
        "company_id": company_id,
        "buyer_id": current_user["id"]
    })
    
    if existing_request:
        return {"message": "Demande déjà envoyée", "status": existing_request.get("status")}
    
    # Create request
    request_doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "buyer_id": current_user["id"],
        "buyer_email": current_user["email"],
        "seller_id": company.get("seller_id"),
        "status": "pending",
        "requested_at": datetime.now(timezone.utc).isoformat()
    }
    await db.commercial_info_requests.insert_one(request_doc)
    
    # Notify seller
    message_doc = {
        "id": str(uuid.uuid4()),
        "sender_id": current_user["id"],
        "sender_email": current_user["email"],
        "receiver_id": company.get("seller_id"),
        "company_id": company_id,
        "content": "Je souhaite obtenir les informations commerciales de votre entreprise (nom, SIREN, SIRET, adresse, site web). NDA signé.",
        "message_type": "commercial_info_request",
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.messages.insert_one(message_doc)
    
    return {"message": "Demande envoyée au vendeur", "request_id": request_doc["id"]}

@api_router.put("/seller/share-commercial-info/{request_id}")
async def share_commercial_info(request_id: str, current_user: dict = Depends(get_current_user)):
    """
    Vendeur: Partage les informations commerciales avec l'acheteur.
    """
    request = await db.commercial_info_requests.find_one({"id": request_id}, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Demande non trouvée")
    
    if request.get("seller_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Non autorisé")
    
    company = await db.companies.find_one({"id": request.get("company_id")}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Entreprise non trouvée")
    
    now = datetime.now(timezone.utc)
    
    # Update request status
    await db.commercial_info_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": "shared",
            "shared_at": now.isoformat()
        }}
    )
    
    # Store shared info
    commercial_info = {
        "company_name": company.get("company_name"),
        "siren": company.get("siren") or (company.get("siret") or "")[:9],
        "siret": company.get("siret"),
        "address": company.get("address"),
        "website": company.get("website", ""),
        "shared_at": now.isoformat()
    }
    
    await db.commercial_info_requests.update_one(
        {"id": request_id},
        {"$set": {"shared_info": commercial_info}}
    )
    
    # Notify buyer
    message_doc = {
        "id": str(uuid.uuid4()),
        "sender_id": current_user["id"],
        "sender_email": current_user["email"],
        "receiver_id": request.get("buyer_id"),
        "company_id": request.get("company_id"),
        "content": f"""Voici les informations commerciales de mon entreprise :

**Nom** : {company.get('company_name')}
**SIREN** : {company.get('siren', 'N/A')}
**SIRET** : {company.get('siret', 'N/A')}
**Adresse** : {company.get('address', 'N/A')}
**Site web** : {company.get('website', 'N/A')}

Vous pouvez maintenant me soumettre une offre indicative si vous êtes intéressé.""",
        "message_type": "commercial_info_shared",
        "commercial_info": commercial_info,
        "read": False,
        "created_at": now.isoformat()
    }
    await db.messages.insert_one(message_doc)
    
    await create_audit_log(
        action="COMMERCIAL_INFO_SHARED",
        company_id=request.get("company_id"),
        actor_id=current_user["id"],
        actor_email=current_user["email"],
        target_id=request.get("buyer_id"),
        details={"request_id": request_id}
    )
    
    return {"message": "Informations partagées", "commercial_info": commercial_info}

@api_router.get("/buyer/commercial-info/{company_id}")
async def get_commercial_info(company_id: str, current_user: dict = Depends(get_current_user)):
    """
    Acheteur: Récupère les informations commerciales si partagées.
    """
    request = await db.commercial_info_requests.find_one({
        "company_id": company_id,
        "buyer_id": current_user["id"]
    }, {"_id": 0})
    
    if not request:
        return {"status": "not_requested", "info": None}
    
    return {
        "status": request.get("status"),
        "info": request.get("shared_info") if request.get("status") == "shared" else None
    }

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
    """Cédant sans réponse depuis 3 jours au dernier message d'un repreneur (annonces en ligne ou en pause) : un seul
    e-mail récapitulatif par cédant (« N conversations attendent votre réponse »), via send_reminder (une relance par
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
                                            {"_id": 0, "id": 1, "company_id": 1, "buyer_id": 1, "seller_id": 1, "last_at": 1, "last_sender_id": 1}):
        if conv.get("last_sender_id") != conv.get("buyer_id") or not conv.get("seller_id"):
            continue
        if conv["company_id"] not in statuses:
            company = await db.companies.find_one({"id": conv["company_id"]}, {"_id": 0, "status": 1})
            statuses[conv["company_id"]] = (company or {}).get("status")
        if statuses[conv["company_id"]] not in DATAROOM_OPEN_LISTING_STATUSES:
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
        company = await db.companies.find_one({"id": contact.get("company_id")}, {"_id": 0, "trades": 1, "rge_types": 1, "region": 1})
        token = secrets.token_urlsafe(24)
        trades = [taxonomy.trade_label(t) for t in ((company or {}).get("trades") or []) if taxonomy.trade_by_id(t)]
        label = ", ".join(trades or (company or {}).get("rge_types") or []) + (f" – {company.get('region')}" if company and company.get("region") else "")
        # Questionnaire non transactionnel : lien de désinscription, notifications_opt_out, une relance par jour
        if not await send_reminder(contact.get("buyer_id"), "followup_30d", contact["id"], now, "followup_30d",
                                   company_label=label or f"annonce {site_name()}", link_base=site_url(f"/suivi?token={token}")):
            continue
        await db.followups.insert_one({
            "token": token, "contact_id": contact["id"], "buyer_id": contact.get("buyer_id"),
            "company_id": contact.get("company_id"), "sent_at": now.isoformat(), "answer": None
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
        listings = await db.companies.find({"$or": [{"seller_id": seller["id"]}, {"president_id": seller["id"]}]},
                                           {"_id": 0, "id": 1, "status": 1, "created_at": 1, "updated_at": 1}).to_list(50)
        if not listings:
            # Les présidents invités n'ont pas vocation à créer d'annonce
            invited = await db.president_invitations.find_one({"accepted_by": seller["id"]})
            # Prospection : lien de désinscription et notifications_opt_out (SPEC §6.1), une relance par jour
            if not invited and await send_reminder(seller["id"], "seller_no_listing", seller["id"], now, "seller_no_listing",
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
MANDATE_OBJECTIONS = {
    1: ("« Je ne veux pas d'exclusivité. »", "Le mandat est simple, non exclusif : vous restez libre de vendre par vous-même ou avec d'autres "
        "intermédiaires, sans pénalité. Rien n'est dû si l'acquéreur ne vous a pas été présenté par la plateforme."),
    4: ("« Combien ça coûte ? »", "Rien avant la vente. La commission (6 % HT, 3 % HT au-delà d'un million, minimum 4 000 € HT) n'est due qu'à "
        "la signature de l'acte, et seulement si le repreneur vous a été présenté par la plateforme."),
    10: ("« Je peux résilier ? »", "À tout moment, depuis votre espace, avec un préavis de 15 jours. Le mandat dure 12 mois et ne se prolonge "
         "qu'avec votre accord exprès."),
}

async def job_mandate_reminders(now: datetime) -> int:
    """Annonce prête, mandat non signé : relances J+1, J+4, J+10 (une objection traitée à chaque envoi)"""
    sent = 0
    async for c in db.companies.find({"status": "mandat_en_attente"}, {"_id": 0, "id": 1, "seller_id": 1, "updated_at": 1, "mandate_pending_since": 1, "created_at": 1}):
        since = _parse_dt(c.get("mandate_pending_since") or c.get("updated_at") or c.get("created_at"))
        if not since:
            continue
        elapsed = (now - since).days
        due = [d for d in MANDATE_REMINDER_DAYS if elapsed >= d]
        if not due:
            continue
        day = due[-1]
        title, text = MANDATE_OBJECTIONS[day]
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
    async for c in db.companies.find({"status": {"$nin": list(LISTING_ACTIVE_STATUSES)}},
                                     {"_id": 0, "id": 1, "updated_at": 1, "withdrawn_at": 1, "sold_at": 1, "removed_at": 1}):
        ended = max([v for v in (c.get("updated_at"), c.get("withdrawn_at"), c.get("sold_at"), c.get("removed_at")) if v] or [""])
        if not ended or ended >= docs_limit:
            continue
        async for doc in db.dataroom.find({"company_id": c["id"]}, {"_id": 0, "id": 1, "storage": 1, "storage_key": 1}):
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

def price_range_for(company: dict) -> Optional[dict]:
    """Fourchette indicative (estimator.compute_estimate) à partir des chiffres de l'annonce ; None si incalculable"""
    estimator = LOADED_MODULES.get("estimator")
    if not estimator:
        return None
    try:
        return estimator.compute_estimate(company.get("ca_n"), company.get("ebitda"), company.get("staff_count"),
                                          bool(company.get("has_maintenance_contracts")), bool(company.get("technical_referent_stays")),
                                          bool(company.get("key_staff_stays")))
    except (ValueError, TypeError):
        return None

async def job_seller_lifecycle(now: datetime) -> int:
    """Annonces en ligne : 14 jours sans contact (leviers), 30 jours (prix face à la fourchette), 60 jours sans connexion
    du cédant (avertissement à J-7 puis mise en pause)"""
    sent = 0
    sellers = {}
    async for c in db.companies.find({"status": "published"}, {"_id": 0}):
        published = _parse_dt(c.get("published_at"))
        seller_id = c.get("seller_id")
        if not published or not seller_id:
            continue
        title = c.get("title") or "votre annonce"
        elapsed = (now - published).days
        contacts = await db.contacts.count_documents({"company_id": c["id"]})
        if elapsed >= 14 and contacts == 0:
            if await send_reminder(seller_id, "seller_no_contact_14d", c["id"], now, "seller_no_contact_14d", company_title=title,
                                   link=site_url("/seller/dashboard")):
                sent += 1
                continue
        if elapsed >= 30:
            estimate = price_range_for(c)
            if estimate:
                asking = float(c.get("asking_price") or 0)
                if asking > estimate["high"]:
                    advice = ("Votre prix est au-dessus de la fourchette : les repreneurs comparent avant d'écrire. "
                              "Un prix ramené dans la fourchette, ou un argument chiffré dans la description (contrats récurrents, carnet de commandes), relance les contacts.")
                elif asking < estimate["low"]:
                    advice = "Votre prix est en dessous de la fourchette : vérifiez que vos chiffres sont bien à jour avant de le laisser ainsi."
                else:
                    advice = "Votre prix est dans la fourchette : les contacts dépendent maintenant de la qualité de la description et de votre réactivité."
                activity = (f"Elle a reçu {contacts} contact{'s' if contacts > 1 else ''}." if contacts
                            else "Elle n'a pas encore reçu de contact.")
                if await send_reminder(seller_id, "seller_price_30d", c["id"], now, "seller_price_30d", company_title=title,
                                       activity_line=activity, asking_price=fmt_eur_fr(asking), low=fmt_eur_fr(estimate["low"]),
                                       high=fmt_eur_fr(estimate["high"]), method=estimate.get("method", "méthode par multiples"),
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
                await db.companies.update_one({"id": c["id"]}, {"$set": {"status": "paused", "paused_at": now.isoformat(),
                                                                         "paused_reason": "inactivite", "updated_at": now.isoformat()}})
                await email_user(seller_id, "seller_listing_paused", company_title=title, link=site_url("/seller/dashboard"))
                sent += 1
        elif idle >= SELLER_INACTIVITY_WARNING_DAYS:
            pause_on = fmt_date_fr(last + timedelta(days=SELLER_INACTIVITY_DAYS))
            if await send_reminder(seller_id, "seller_inactive_warning", key, now, "seller_inactive_warning", company_title=title,
                                   days=str(idle), pause_on=pause_on, link=site_url("/login")):
                sent += 1
    return sent

BUYER_IDENTITY_REMINDER_DAYS = (1, 3, 10)
BUYER_NDA_REMINDER_DAYS = (2, 7)

async def job_buyer_reminders(now: datetime) -> int:
    """Demande acceptée : identité à vérifier J+1/J+3/J+10, NDA à signer J+2/J+7 ; accès ouvert sans consultation à J+3"""
    sent = 0
    async for a in db.dataroom_access.find({"status": {"$in": ["accepted", "validated", "loi_pending", "granted"]}}, {"_id": 0}):
        buyer = await db.users.find_one({"id": a.get("buyer_id")}, USER_SAFE_PROJECTION)
        company = await db.companies.find_one({"id": a.get("company_id")}, {"_id": 0, "id": 1, "title": 1, "status": 1})
        if not buyer or not company or company.get("status") not in ("published", "paused"):
            continue
        title = company.get("title") or "l'entreprise"
        link = site_url(f"/dataroom/{company['id']}")
        if a.get("status") == "granted":
            granted = _parse_dt(a.get("granted_at"))
            if granted and (now - granted).days >= 3:
                visited = await db.dataroom_access_logs.find_one({"company_id": company["id"], "$or": [{"user_id": buyer["id"]}, {"viewer_id": buyer["id"]}]})
                if not visited and await send_reminder(buyer["id"], "buyer_dataroom_unvisited", a["id"], now, "buyer_dataroom_unvisited",
                                                       company_title=title, link=link):
                    sent += 1
            continue
        accepted = _parse_dt(a.get("accepted_at") or a.get("validated_at"))
        if not accepted:
            continue
        elapsed = (now - accepted).days
        steps = await dataroom_steps(company["id"], buyer, a)
        if not steps["identity"]:
            due = [d for d in BUYER_IDENTITY_REMINDER_DAYS if elapsed >= d]
            if due and await send_reminder(buyer["id"], "buyer_identity_reminder", f"{a['id']}:{due[-1]}", now, "buyer_identity_reminder",
                                           company_title=title, days=str(elapsed), plural="s" if elapsed > 1 else "", link=link):
                sent += 1
        elif not steps["nda"]:
            due = [d for d in BUYER_NDA_REMINDER_DAYS if elapsed >= d]
            if due and await send_reminder(buyer["id"], "buyer_nda_reminder", f"{a['id']}:{due[-1]}", now, "buyer_nda_reminder",
                                           company_title=title, link=link):
                sent += 1
    return sent

async def job_seller_weekly(now: datetime) -> int:
    """Hebdo cédant : vues, favoris et contacts de la semaine sur ses annonces en ligne (jamais de compteur à zéro)"""
    sent = 0
    week = _period_keys(now)["weekly"]
    since = (now - timedelta(days=7)).isoformat()
    by_seller = {}
    async for c in db.companies.find({"status": "published"}, {"_id": 0, "id": 1, "seller_id": 1, "title": 1, "views": 1, "weekly_snapshot": 1}):
        by_seller.setdefault(c.get("seller_id"), []).append(c)
    for seller_id, listings in by_seller.items():
        if not seller_id or not await claim_once("seller_weekly", f"{seller_id}:{week}"):
            continue
        lines, pending = [], 0
        for c in listings:
            snapshot = c.get("weekly_snapshot") or {}
            views_delta = max(0, int(c.get("views") or 0) - int(snapshot.get("views") or 0))
            favorites = await db.favorites.count_documents({"company_id": c["id"], "created_at": {"$gte": since}})
            contacts = await db.contacts.count_documents({"company_id": c["id"], "created_at": {"$gte": since}})
            pending += await db.dataroom_access.count_documents({"company_id": c["id"], "status": "pending"})
            pending += await db.messages.count_documents({"company_id": c["id"], "receiver_id": seller_id, "read": False, "kind": {"$ne": "system"}})
            parts = [f"{views_delta} vue{'s' if views_delta > 1 else ''}" if views_delta else "",
                     f"{favorites} favori{'s' if favorites > 1 else ''}" if favorites else "",
                     f"{contacts} contact{'s' if contacts > 1 else ''}" if contacts else ""]
            parts = [p for p in parts if p]
            label = html_escape(c.get("title") or "Votre annonce")
            lines.append(f"<li><strong>{label}</strong> : {', '.join(parts) if parts else 'pas encore de nouvelle activité cette semaine'}</li>")
            await db.companies.update_one({"id": c["id"]}, {"$set": {"weekly_snapshot": {"views": int(c.get("views") or 0), "at": now.isoformat()}}})
        intro = "Voici l'activité de la semaine sur vos annonces."
        todo = (f"{pending} action{'s' if pending > 1 else ''} vous attend{'ent' if pending > 1 else ''} (messages non lus, demandes de dossier)."
                if pending else "Pour attirer plus de repreneurs : une description complète, les cases « ce qui rassure » et un prix dans la fourchette d'estimation.")
        await email_user(seller_id, "seller_weekly", unsubscribe_url=unsubscribe_link_for_user(seller_id), intro=intro, lines="".join(lines),
                         todo_line=todo, link=site_url("/seller/dashboard"))
        sent += 1
    return sent

NPS_DELAY_DAYS = 7

async def job_nps(now: datetime) -> int:
    """Sept jours après une vente confirmée : question NPS en un clic aux deux parties (une seule fois)"""
    sent = 0
    async for cl in db.closings.find({"status": "confirmed"}, {"_id": 0, "id": 1, "buyer_id": 1, "seller_id": 1, "confirmed_at": 1, "company_label": 1}):
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
                                   company_label=cl.get("company_label") or "l'entreprise", scores=scores):
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
              # Messages sans réponse du cédant depuis 3 jours : un récapitulatif par cédant et par jour au plus
              ("seller_reminders", job_seller_reminders),
              # Contrats (SPEC §3.2, §3.4) : échéance des mandats (J-30 puis expiration), dénonciations effectives, offres expirées
              ("mandate_expiry", job_mandate_expiry), ("mandate_denounce_effective", job_mandate_denounce_effective),
              ("offers_expiry", job_offers_expiry),
              # Parcours (SPEC §6.1, §6.4) : demandes de dossier (J+2/J+5, expiration J+10), mandat à signer (J+1/4/10),
              # vie de l'annonce (14 j, 30 j, 60 j sans connexion), repreneur (identité, NDA, data room), NPS après vente
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
for _module_name in ("events", "estimator", "closing", "veille", "transmissibility", "testmode"):
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
    await db.companies.create_index("seller_id")
    await db.messages.create_index("sender_id")
    await db.messages.create_index("receiver_id")
    await db.email_verifications.create_index("token_hash")
    await db.login_otps.create_index("user_id")
    await db.password_resets.create_index("token_hash")
    # Modules : statistiques, estimateur, veille BODACC, étape de vente, factures, « À faire »
    await db.events.create_index([("day", 1), ("name", 1)])
    await db.estimates.create_index("confirm_token_hash")
    await db.estimates.create_index("email")
    await db.incidents.create_index([("siren", 1), ("event.id", 1)])
    await db.dataroom_access.create_index([("company_id", 1), ("buyer_id", 1)])
    await db.closings.create_index("offer_id", unique=True)
    await db.closings.create_index([("status", 1), ("updated_at", -1)])
    await db.closings.create_index("seller_id")
    await db.closings.create_index("buyer_id")
    await db.invoices.create_index("number", unique=True)
    await db.invoices.create_index("closing_id")
    await db.invoices.create_index([("status", 1), ("due_on", 1)])
    await db.invoices.create_index("debtor.user_id")
    await db.todos.create_index([("type", 1), ("key", 1), ("status", 1)])
    await db.companies.create_index([("moderation.status", 1), ("moderation.review_until", 1)])
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
    await db.favorites.create_index([("user_id", 1), ("company_id", 1)], unique=True)
    await db.alerts.create_index("user_id")
    await db.public_alerts.create_index("email")
    await db.conversations.create_index([("company_id", 1), ("buyer_id", 1)], unique=True)
    await db.conversations.create_index([("seller_id", 1), ("last_at", -1)])
    await db.conversations.create_index([("buyer_id", 1), ("last_at", -1)])
    await db.messages.create_index([("conversation_id", 1), ("created_at", 1)])
    await db.costs.create_index("month", unique=True)
    await db.nps.create_index([("closing_id", 1), ("user_id", 1)], unique=True)
    await db.dataroom_access_logs.create_index("company_id")
    # Mode test : boîte mail de test (purgée après 30 jours) et marquage des données de test
    await db.test_emails.create_index([("to", 1), ("created_at", -1)])
    for coll in (db.users, db.companies, db.generated_contracts):
        await coll.create_index("is_test", sparse=True)
    try:
        await db.test_emails.create_index("expire_at", expireAfterSeconds=0)
    except Exception as e:  # mongomock n'implémente pas tous les index
        logger.debug(f"Index TTL non créé : {e}")
