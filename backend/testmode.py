"""
Mode test (docs/refonte-2026-10/MODE-TEST-ET-APP.md, partie B) : essayer toute l'application sans vérifier réellement son
identité, sans dépendre de l'envoi d'e-mails et sans engager de vrais contrats.

Activation : TEST_MODE=true (lu à chaque appel, `test_mode_enabled()`). Hors mode test, toutes les routes /test/* répondent
404 « Introuvable » (dépendance `require_test_mode`, évaluée avant l'authentification).

Routes (préfixe /api) :
- POST /test/identity/simulate {first_name?, last_name?, birth_date?} : identité de l'utilisateur connecté marquée vérifiée
  (`kyc_provider: 'test'`), mêmes effets que Stripe Identity (brouillons soumis, accès au dossier ouverts) ;
- POST /test/confirm-email : confirme l'adresse de l'utilisateur connecté ;
- POST /test/seed : comptes de démonstration (vendeur, repreneur, admin @test.local, mot de passe TEST_DEMO_PASSWORD) et
  8 annonces publiées par le parcours réel (création, adresse du mandant, mandat de test signé, contrôles, publication) ;
  idempotent ;
- POST /test/login-as {persona} : jeton d'un compte de démonstration (jamais d'un vrai compte) ;
- GET /test/emails?limit=&to= , GET /test/emails/{id}, DELETE /test/emails : boîte mail de test (db.test_emails, alimentée
  par business_model.send_brevo_email) ; un utilisateur ne voit que ses e-mails, l'admin voit tout ;
- POST /admin/test/purge?dry_run=true|false (admin, disponible même hors mode test) : purge des données de test
  (migrations/purge_test_data.py, même fonction que la ligne de commande).
"""
from __future__ import annotations

import logging
import os
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

import taxonomy
from business_model import (DEMO_EMAIL_DOMAIN, is_demo_email, sender_email, sender_name,  # noqa: F401 (réexport)
                            test_mode_enabled)
from migrations.purge_test_data import purge_test_data
from server import (OTP_TTL_SECONDS, USER_SAFE_PROJECTION, BuyerProfile, CompanyCreate, CompanyUpdate, MandantAddress,
                    MandatSignature, api_error, buyer_profile_score, create_company, db, generate_seller_mandat,
                    get_current_user, hash_password_async, identity_verified_effects, issue_token, limiter, mask_email,
                    normalize_buyer_profile, otp_hash, require_admin, sign_seller_mandat, test_panel_access, update_company,
                    with_profile_score)

logger = logging.getLogger("testmode")

NOT_FOUND = "Introuvable"
DEFAULT_DEMO_PASSWORD = "Demo-2026!"
EMAILS_MAX_LIMIT = 200


def demo_password() -> str:
    """Mot de passe commun des comptes de démonstration (TEST_DEMO_PASSWORD, affiché dans le panneau de test)"""
    return os.environ.get("TEST_DEMO_PASSWORD", "").strip() or DEFAULT_DEMO_PASSWORD


async def require_test_mode() -> None:
    """Dépendance des routes /test/* : 404 hors mode test (la route n'existe pas pour le visiteur)"""
    if not test_mode_enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter()
test_router = APIRouter(prefix="/test", dependencies=[Depends(require_test_mode)])


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ----------------------------------------------------------------------------------------------
# Comptes de démonstration

DEMO_PERSONAS = {
    "vendeur": {"email": f"vendeur.demo@{DEMO_EMAIL_DOMAIN}", "role": "seller", "first_name": "Vincent", "last_name": "Lebrun",
                "company_name": "Lebrun Énergies (démonstration)", "birth_date": "1961-04-12", "phone": "06 00 00 00 01"},
    "repreneur": {"email": f"repreneur.demo@{DEMO_EMAIL_DOMAIN}", "role": "buyer", "first_name": "Claire", "last_name": "Martin",
                  "company_name": "Martin Holding (démonstration)", "birth_date": "1984-09-23", "phone": "06 00 00 00 02"},
    "admin": {"email": f"admin.demo@{DEMO_EMAIL_DOMAIN}", "role": "admin", "first_name": "Alice", "last_name": "Admin",
              "company_name": None, "birth_date": "1979-01-30", "phone": None},
}

DEMO_BUYER_PROFILE = {"project_type": "reprise-individuelle", "budget_max": 900000, "apport": 220000, "financing": "mixte",
                      "zones": ["Bretagne", "Pays de la Loire", "Nouvelle-Aquitaine"],
                      "trades": ["pac-clim-cvc", "plomberie-chauffage", "electricite"], "horizon": "6-12",
                      "experience": "Quinze ans de conduite de travaux en génie climatique, dont huit comme responsable d'agence."}


async def _ensure_persona(persona: str, password_hash: str, now: str) -> tuple:
    """(compte, créé ?) : crée ou remet en état un compte de démonstration (e-mail confirmé, identité simulée, is_test)"""
    spec = DEMO_PERSONAS[persona]
    existing = await db.users.find_one({"email": spec["email"]}, {"_id": 0})
    if existing and not existing.get("is_test"):
        raise api_error(409, "conflict", f"L'adresse {spec['email']} appartient à un compte réel : comptes de démonstration non créés")
    state = {
        "email_verified": True, "email_verified_at": now, "email_verified_via": "test",
        "identity_verified": True, "kyc_status": "verified", "kyc_provider": "test", "verified_at": now, "kyc_verified_at": now,
        "verified_first_name": spec["first_name"], "verified_last_name": spec["last_name"], "verified_birth_date": spec["birth_date"],
        "password_hash": password_hash, "is_test": True, "demo_persona": persona,
    }
    if existing:
        await db.users.update_one({"id": existing["id"]}, {"$set": state, "$unset": {"deleted_at": ""}})
        return {**existing, **state}, False
    user = {
        "id": str(uuid.uuid4()), "email": spec["email"], "role": spec["role"], "first_name": spec["first_name"],
        "last_name": spec["last_name"], "company_name": spec["company_name"], "siret": None, "phone": spec["phone"],
        "notifications_opt_out": False, "created_at": now, "last_activity_at": now, "score": 0, "acquisition_source": "demonstration",
        **state,
    }
    if spec["role"] == "buyer":
        user["buyer_profile"] = await normalize_buyer_profile(BuyerProfile(**DEMO_BUYER_PROFILE)) or {}
        user["profile_score"] = buyer_profile_score(user)
    await db.users.insert_one(user)
    user.pop("_id", None)
    return user, True


# ----------------------------------------------------------------------------------------------
# Annonces de démonstration : 8 entreprises fictives (SIRET fictifs, clé de contrôle volontairement invalide : aucune
# entreprise réelle ne peut porter ces numéros), publiées par le parcours réel avec un mandat de test signé.

def _fictitious_siret(index: int) -> str:
    """SIRET de 14 chiffres dont la clé de Luhn est fausse (accepté en mode test, jamais attribué par l'INSEE)"""
    base = f"9990{index:05d}0001"
    for digit in "0123456789":
        candidate = base + digit
        total = 0
        for i, ch in enumerate(reversed(candidate)):
            d = int(ch) * (2 if i % 2 else 1)
            total += d - 9 if d > 9 else d
        if total % 10:
            return candidate
    return base + "1"


DEMO_LISTINGS = [
    {
        "key": "pac-finistere", "department": "29", "postal_code": "29200", "city": "Brest", "days_ago": 1,
        "trades": ["pac-clim-cvc", "plomberie-chauffage"], "staff_count": 9, "legal_structure": "SAS", "creation_date": "2009-03-02",
        "rge_types": ["Pompes à chaleur air/eau", "Chauffe-eau thermodynamique"], "other_qualifications": ["qualit-enr"],
        "ca_n": 1350000, "ca_n1": 1210000, "ca_n2": 1080000, "ebitda": 185000, "margin": 14, "asking_price": 520000,
        "sale_object": "titres", "sale_reason": "retraite", "handover_months": 6, "has_maintenance_contracts": True,
        "technical_referent_stays": True, "key_staff_stays": True, "decennale_ok": True,
        "company_name": "Thermi Ouest (démonstration)",
        "description": "Installateur de pompes à chaleur et de chauffe-eau thermodynamiques implanté depuis quinze ans dans le "
                       "nord du Finistère. Clientèle de particuliers en rénovation, complétée par 420 contrats d'entretien "
                       "annuels qui assurent un tiers de la marge. Deux équipes de pose autonomes, un technicien SAV et une "
                       "assistante qui gère les dossiers d'aides. Carnet de commandes de quatre mois. Le dirigeant part à la "
                       "retraite et accompagne le repreneur six mois.",
        "equipment": "Trois fourgons aménagés, outillage frigorifique complet, stock tampon de deux mois.",
        "premises": "Atelier et bureau de 300 m² en location (bail commercial récent).",
    },
    {
        "key": "electricite-rhone", "department": "69", "postal_code": "69007", "city": "Lyon", "days_ago": 4,
        "trades": ["electricite"], "staff_count": 14, "legal_structure": "SARL", "creation_date": "1998-06-15",
        "rge_types": [], "other_qualifications": ["qualifelec", "irve"],
        "ca_n": 2100000, "ca_n1": 1950000, "ca_n2": 1870000, "ebitda": 260000, "margin": 12, "asking_price": 780000,
        "sale_object": "titres", "sale_reason": "retraite", "handover_months": 9, "has_maintenance_contracts": True,
        "technical_referent_stays": True, "key_staff_stays": True, "decennale_ok": True,
        "company_name": "Lumen Électricité (démonstration)",
        "description": "Entreprise d'électricité générale de quatorze personnes travaillant pour des syndics, des bailleurs "
                       "sociaux et des entreprises tertiaires de l'agglomération lyonnaise. Activité récurrente de maintenance "
                       "et de mise en conformité, installation de bornes de recharge en copropriété depuis trois ans. Chef "
                       "d'équipe expérimenté en place, prêt à reprendre la conduite des chantiers. Aucun client ne dépasse "
                       "12 % du chiffre d'affaires.",
        "equipment": "Six véhicules utilitaires, nacelle, appareils de mesure et de contrôle à jour.",
        "premises": "Local d'activité de 220 m² avec parking, loué à une SCI indépendante.",
    },
    {
        "key": "couverture-gironde", "department": "33", "postal_code": "33600", "city": "Pessac", "days_ago": 9,
        "trades": ["couverture-charpente", "etancheite"], "staff_count": 6, "legal_structure": "SARL", "creation_date": "2004-01-20",
        "rge_types": [], "other_qualifications": ["qualibat"],
        "ca_n": 780000, "ca_n1": 735000, "ca_n2": 690000, "ebitda": 98000, "margin": 13, "asking_price": 240000,
        "sale_object": "fonds", "sale_reason": "retraite", "handover_months": 4, "has_maintenance_contracts": False,
        "technical_referent_stays": True, "key_staff_stays": True, "decennale_ok": True,
        "company_name": "Charpentes de l'Estey (démonstration)",
        # Seule annonce laissée « à relire » (drapeaux de l'open data) : scénario admin du panneau de test
        "a_relire": True,
        "description": "Couvreur-charpentier reconnu sur la métropole bordelaise : réfection de toitures en tuiles, zinguerie, "
                       "charpente traditionnelle et petites étanchéités de toitures terrasses. Clientèle de particuliers et "
                       "d'agences immobilières, très peu de prospection nécessaire grâce au bouche-à-oreille. Équipe stable de "
                       "cinq compagnons dont un chef d'équipe qualifié. Cession du fonds avec matériel et véhicules.",
        "equipment": "Échafaudages, monte-matériaux, deux camions plateau et un fourgon.",
        "premises": "Dépôt de 400 m² avec cour, bail transférable.",
    },
    {
        "key": "isolation-nord", "department": "59", "postal_code": "59650", "city": "Villeneuve-d'Ascq", "days_ago": 15,
        "trades": ["isolation"], "staff_count": 18, "legal_structure": "SAS", "creation_date": "2012-09-01",
        "rge_types": ["Isolation des combles perdus", "Isolation des murs par l'extérieur",
                      "Isolation par l'intérieur (murs, rampants, plafonds)"], "other_qualifications": [],
        "ca_n": 3200000, "ca_n1": 2850000, "ca_n2": 2400000, "ebitda": 410000, "margin": 13, "asking_price": 1400000,
        "sale_object": "titres", "sale_reason": "reconversion", "handover_months": 12, "has_maintenance_contracts": False,
        "technical_referent_stays": True, "key_staff_stays": True, "decennale_ok": True,
        "company_name": "Isonord Habitat (démonstration)",
        "description": "Spécialiste de l'isolation des logements dans les Hauts-de-France : combles, isolation thermique par "
                       "l'extérieur et doublages intérieurs. Trois équipes de pose, un conducteur de travaux et un bureau "
                       "qui monte les dossiers d'aides à la rénovation. Croissance régulière depuis trois exercices, marges "
                       "maîtrisées, aucune dette bancaire. Les associés souhaitent se consacrer à un autre projet et "
                       "restent disponibles un an pour la transition.",
        "equipment": "Machines à souffler, échafaudages de façade, cinq véhicules.",
        "premises": "Entrepôt de 900 m² et bureaux, bail de neuf ans signé en 2023.",
    },
    {
        "key": "plomberie-hauts-de-seine", "department": "92", "postal_code": "92130", "city": "Issy-les-Moulineaux", "days_ago": 22,
        "trades": ["plomberie-chauffage"], "staff_count": 4, "legal_structure": "EURL", "creation_date": "2015-05-11",
        "rge_types": ["Chaudières gaz/fioul à condensation"], "other_qualifications": ["qualibat"],
        "ca_n": 520000, "ca_n1": 498000, "ca_n2": 470000, "ebitda": 72000, "margin": 14, "asking_price": 160000,
        "sale_object": "fonds", "sale_reason": "sante", "handover_months": 3, "has_maintenance_contracts": True,
        "technical_referent_stays": False, "key_staff_stays": True, "decennale_ok": True,
        "company_name": "Hydro Seine Services (démonstration)",
        "description": "Plombier-chauffagiste de proximité dans le sud des Hauts-de-Seine : dépannage, remplacement de "
                       "chaudières à condensation, rénovation de salles d'eau. Portefeuille de 180 contrats d'entretien et "
                       "partenariats avec quatre syndics de copropriété. Deux salariés qualifiés et un apprenti en dernière "
                       "année. Le gérant cède pour raisons de santé et assure trois mois de présentation de la clientèle.",
        "equipment": "Deux fourgons équipés, caméra d'inspection, matériel de soudure.",
        "premises": "Petit local de stockage de 60 m² en sous-sol, bail récent.",
    },
    {
        "key": "menuiserie-loire-atlantique", "department": "44", "postal_code": "44800", "city": "Saint-Herblain", "days_ago": 30,
        "trades": ["menuiserie"], "staff_count": 11, "legal_structure": "SAS", "creation_date": "2001-02-26",
        "rge_types": ["Menuiseries extérieures (fenêtres, portes, volets)"], "other_qualifications": [],
        "ca_n": 1600000, "ca_n1": 1520000, "ca_n2": 1490000, "ebitda": 175000, "margin": 11, "asking_price": 590000,
        "sale_object": "titres", "sale_reason": "retraite", "handover_months": 6, "has_maintenance_contracts": False,
        "technical_referent_stays": True, "key_staff_stays": True, "decennale_ok": True,
        "company_name": "Ouvertures Atlantique (démonstration)",
        "description": "Fourniture et pose de menuiseries extérieures, volets roulants et portes de garage auprès des "
                       "particuliers de l'agglomération nantaise. Showroom fréquenté, devis signés à plus de 40 %, "
                       "fournisseurs référencés depuis longtemps avec des conditions négociées. Quatre équipes de pose, un "
                       "technico-commercial et une assistante. Le dirigeant part à la retraite ; l'encadrement reste en "
                       "place.",
        "equipment": "Showroom équipé, quatre fourgons, outillage de pose complet.",
        "premises": "Showroom et atelier de 350 m² en zone commerciale, bail commercial.",
    },
    {
        "key": "peinture-haute-garonne", "department": "31", "postal_code": "31200", "city": "Toulouse", "days_ago": 38,
        "trades": ["platrerie-peinture", "renovation-generale"], "staff_count": 7, "legal_structure": "SARL", "creation_date": "2011-10-03",
        "rge_types": [], "other_qualifications": ["eco-artisan"],
        "ca_n": 690000, "ca_n1": 720000, "ca_n2": 700000, "ebitda": 64000, "margin": 9, "asking_price": 90000,
        "sale_object": "fonds", "sale_reason": "reconversion", "handover_months": 3, "has_maintenance_contracts": False,
        "technical_referent_stays": True, "key_staff_stays": False, "decennale_ok": True,
        "company_name": "Atelier Garonne Finitions (démonstration)",
        "description": "Entreprise de plâtrerie, peinture et rénovation intérieure à Toulouse et dans sa première couronne. "
                       "Chantiers de particuliers et de petits commerces, sous-traitance régulière pour deux architectes "
                       "d'intérieur. Activité stable, rentabilité améliorable par une meilleure organisation des plannings. "
                       "Le gérant se reconvertit et cède le fonds à un prix raisonnable, adapté à un premier projet de "
                       "reprise.",
        "equipment": "Deux utilitaires, ponceuses, échafaudages roulants.",
        "premises": "Pas de local : stockage chez un loueur de garde-meubles.",
    },
    {
        "key": "photovoltaique-var", "department": "83", "postal_code": "83130", "city": "La Garde", "days_ago": 52,
        "trades": ["photovoltaique-enr", "electricite"], "staff_count": 8, "legal_structure": "SAS", "creation_date": "2014-07-07",
        "rge_types": ["Panneaux photovoltaïques", "Bornes de recharge véhicules électriques"], "other_qualifications": ["qualifelec", "irve"],
        "ca_n": 1150000, "ca_n1": 980000, "ca_n2": 860000, "ebitda": 140000, "margin": 12, "asking_price": 430000,
        "sale_object": "titres", "sale_reason": "autre", "handover_months": 6, "has_maintenance_contracts": True,
        "technical_referent_stays": True, "key_staff_stays": True, "decennale_ok": True,
        "company_name": "Soleil Varois Énergies (démonstration)",
        "description": "Installateur de centrales photovoltaïques en toiture pour particuliers et petits professionnels du Var, "
                       "avec une activité complémentaire de bornes de recharge et de maintenance d'installations existantes. "
                       "Chiffre d'affaires en hausse continue, carnet de commandes de trois mois et contrats de maintenance "
                       "pluriannuels. Équipe technique autonome encadrée par un responsable de chantier. Le fondateur "
                       "souhaite rejoindre un groupe industriel.",
        "equipment": "Trois véhicules, nacelle, outillage électrique et lignes de vie.",
        "premises": "Bureaux et dépôt de 180 m², bail commercial de 2022.",
    },
]
for _i, _listing in enumerate(DEMO_LISTINGS, 1):
    _listing["siret"] = _fictitious_siret(_i)
    _listing["region"] = taxonomy.region_for_departement(_listing["department"])

DEMO_LISTING_FIELDS = ("trades", "staff_count", "legal_structure", "creation_date", "rge_types", "other_qualifications", "ca_n",
                       "ca_n1", "ca_n2", "ebitda", "margin", "asking_price", "sale_object", "sale_reason", "handover_months",
                       "has_maintenance_contracts", "technical_referent_stays", "key_staff_stays", "decennale_ok",
                       "company_name", "description", "equipment", "premises", "siret", "department", "region")


async def _sign_with_test_code(contract_id: str, seller: dict, request: Request) -> dict:
    """Signature du mandat par le parcours réel (POST /seller/mandat/{id}/sign) avec un code émis comme celui de
    POST /signatures/request-code (sans e-mail : le panneau de test le connaît)"""
    now = _now()
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.signature_otps.update_many({"user_id": seller["id"], "contract_id": contract_id, "used": False},
                                        {"$set": {"used": True, "superseded": True}})
    await db.signature_otps.insert_one({
        "id": str(uuid.uuid4()), "user_id": seller["id"], "contract_id": contract_id, "code_hash": otp_hash(code, contract_id),
        "attempts": 0, "used": False, "channel": "email", "destination": mask_email(seller["email"]), "created_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=OTP_TTL_SECONDS)).isoformat(), "expire_at": now + timedelta(days=1), "is_test": True,
    })
    return await sign_seller_mandat(contract_id, MandatSignature(otp_code=code), request, current_user=seller)


async def _fresh(user_id: str) -> dict:
    return await db.users.find_one({"id": user_id}, USER_SAFE_PROJECTION)


async def _publish_demo_listing(spec: dict, seller_id: str, request: Request) -> tuple:
    """(annonce, créée ?) : création → adresse du mandant → mandat de test → signature → contrôles et publication"""
    existing = await db.companies.find_one({"seller_id": seller_id, "demo_key": spec["key"]}, {"_id": 0})
    created = existing is None
    if created:
        data = {k: spec[k] for k in DEMO_LISTING_FIELDS}
        company = await create_company(CompanyCreate(**data), current_user=await _fresh(seller_id))
        await db.companies.update_one({"id": company["id"]}, {"$set": {"demo_key": spec["key"], "is_test": True}})
        company_id = company["id"]
    else:
        company_id = existing["id"]
        if existing.get("status") == "published":
            return existing, False
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company.get("mandant_address"):
        address = MandantAddress(line1="1 place de la Démonstration", postal_code=spec["postal_code"], city=spec["city"])
        await update_company(company_id, CompanyUpdate(mandant_address=address, mandant_capacity="dirigeant"),
                             current_user=await _fresh(seller_id))
    mandate = await generate_seller_mandat(company_id=company_id, current_user=await _fresh(seller_id))
    if not mandate.get("already_signed"):
        await _sign_with_test_code(mandate["contract_id"], await _fresh(seller_id), request)
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if company.get("status") != "published":
        logger.warning(f"Annonce de démonstration {spec['key']} non publiée : {company.get('status')} {company.get('blocking')}")
        return company, created
    # Dates étalées sur deux mois (tri « récentes » réaliste)
    published = _now() - timedelta(days=spec["days_ago"], hours=3)
    update = {"published_at": published.isoformat(), "created_at": (published - timedelta(days=2)).isoformat(),
              "submitted_at": published.isoformat(), "updated_at": published.isoformat()}
    if spec.get("a_relire"):
        # Drapeaux de l'open data conservés (SIRET fictif) : l'annonce apparaît dans « À faire » de l'admin démo
        update["moderation.status"] = "pending"
        update["moderation.review_until"] = (_now() + timedelta(hours=24)).isoformat()
    else:
        # Contrôles réputés passés : dirigeant confirmé au registre, RGE déclaré retrouvé sur la liste ADEME (badge vert
        # « RGE vérifié ADEME » sur la carte et la fiche), annonce relue
        update.update(_demo_checks_passed(company, spec, published))
    await db.companies.update_one({"id": company_id}, {"$set": update})
    return await db.companies.find_one({"id": company_id}, {"_id": 0}), created


def _demo_checks_passed(company: dict, spec: dict, published: datetime) -> dict:
    """Champs d'une annonce de démonstration dont les contrôles automatiques sont passés (open data, dirigeant, ADEME)"""
    rge = bool(spec.get("rge_types"))
    checks = {**(company.get("company_checks") or {}), "opendata_available": True, "siren_active": True, "naf_in_building": True,
              "naf_status": "batiment", "dirigeant_match": "match_exact", "duplicate_siren": False,
              "in_ademe_list": True if rge else None, "checked_at": published.isoformat()}
    return {"company_checks": checks, "dirigeant_status": "match_exact", "dirigeant_verified": True,
            "qualifications_verified_at": published.isoformat() if rge else None,
            "moderation.flags": [], "moderation.status": "ok", "moderation.reviewed_at": (published + timedelta(days=1)).isoformat(),
            "moderation.reason": "Annonce de démonstration"}


# ----------------------------------------------------------------------------------------------
# Routes du mode test

class IdentitySimulation(BaseModel):
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    birth_date: Optional[str] = Field(None, description="AAAA-MM-JJ")


@test_router.post("/identity/simulate")
async def simulate_identity(data: Optional[IdentitySimulation] = None, current_user: dict = Depends(get_current_user)):
    """Identité de l'utilisateur connecté marquée vérifiée (`kyc_provider: 'test'`), avec les mêmes effets que Stripe
    Identity : brouillons du cédant soumis (mandat, contrôles, publication), accès au dossier du repreneur ouverts si les
    autres étapes sont faites. Nom, prénom et date de naissance : ceux du corps, sinon ceux du profil."""
    data = data or IdentitySimulation()
    first = (data.first_name or "").strip() or current_user.get("first_name") or ""
    last = (data.last_name or "").strip() or current_user.get("last_name") or ""
    if not first or not last:
        raise api_error(400, "validation", "Indiquez le prénom et le nom à certifier", missing=[k for k, v in
                                                                                            (("first_name", first), ("last_name", last)) if not v])
    birth = (data.birth_date or "").strip() or current_user.get("verified_birth_date") or None
    if birth:
        try:
            born = date.fromisoformat(birth)
        except ValueError:
            raise api_error(400, "validation", "Date de naissance invalide (format AAAA-MM-JJ)", missing=["birth_date"])
        if not (date(1900, 1, 1) <= born <= date.today() - timedelta(days=18 * 365)):
            raise api_error(400, "validation", "Date de naissance invalide : la personne doit être majeure", missing=["birth_date"])
    now = _now().isoformat()
    update = {"identity_verified": True, "kyc_status": "verified", "kyc_provider": "test", "verified_at": now,
              "kyc_verified_at": now, "verified_first_name": first, "verified_last_name": last, "updated_at": now}
    if birth:
        update["verified_birth_date"] = birth
    for field, value in (("first_name", first), ("last_name", last)):
        if not current_user.get(field):
            update[field] = value
    await db.users.update_one({"id": current_user["id"]}, {"$set": update})
    await identity_verified_effects(current_user["id"])
    user = await _fresh(current_user["id"])
    listings = await db.companies.find({"seller_id": current_user["id"]}, {"_id": 0, "id": 1, "status": 1, "title": 1}).to_list(50)
    return {"verified": True, "kyc_provider": "test", "user": with_profile_score(user), "listings": listings}


@test_router.post("/confirm-email")
async def confirm_own_email(current_user: dict = Depends(get_current_user)):
    """Confirme l'adresse de l'utilisateur connecté. Les liens de confirmation reçus restent valables : une confirmation
    simulée ne vaut qu'en mode test (is_email_verified), le lien permet ensuite la vraie confirmation."""
    if current_user.get("email_verified") and current_user.get("email_verified_via") != "test":
        return {"verified": True, "already_verified": True, "email": current_user["email"]}
    now = _now().isoformat()
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"email_verified": True, "email_verified_at": now,
                                                                     "email_verified_via": "test"}})
    return {"verified": True, "already_verified": False, "email": current_user["email"]}


@test_router.post("/seed")
@limiter.limit("5/minute")
async def seed_demo(request: Request):
    """Crée (idempotent) les trois comptes de démonstration et les 8 annonces publiées du vendeur démo (clé du panneau
    exigée quand TEST_PANEL_KEY est définie)"""
    if not test_panel_access(request):
        raise api_error(403, "test_key_required", "Données de démonstration réservées au panneau de test : ouvrez "
                                                  "l'application avec le lien qui contient la clé du panneau (?cle=…)")
    now = _now().isoformat()
    password = demo_password()
    password_hash = await hash_password_async(password)
    accounts, created_accounts = [], 0
    users = {}
    for persona in ("vendeur", "repreneur", "admin"):
        user, created = await _ensure_persona(persona, password_hash, now)
        users[persona] = user
        created_accounts += int(created)
        accounts.append({"persona": persona, "email": user["email"], "role": user["role"], "created": created})
    seller_id = users["vendeur"]["id"]
    created_listings, published = 0, 0
    for spec in DEMO_LISTINGS:
        try:
            company, created = await _publish_demo_listing(spec, seller_id, request)
        except HTTPException as e:
            logger.error(f"Annonce de démonstration {spec['key']} : {e.detail}")
            continue
        created_listings += int(created)
        published += int(company.get("status") == "published")
    return {"accounts": accounts, "password": password, "accounts_created": created_accounts,
            "listings_created": created_listings, "listings_published": published, "listings_total": len(DEMO_LISTINGS)}


class LoginAs(BaseModel):
    persona: Literal["vendeur", "repreneur", "admin"]


@test_router.post("/login-as")
async def login_as(data: LoginAs, request: Request):
    """Connexion rapide à un compte de démonstration (jamais à un vrai compte : adresse @test.local et `is_test` exigés).
    Clé du panneau (TEST_PANEL_KEY, en-tête X-Test-Key) exigée quand elle est définie ; sans clé, l'admin démo est fermé
    en production. Le jeton porte `tm` : il cesse d'être valable dès que le mode test est désactivé."""
    if not test_panel_access(request, admin=data.persona == "admin"):
        raise api_error(403, "test_key_required", "Connexion rapide réservée au panneau de test : ouvrez l'application avec le "
                                                  "lien qui contient la clé du panneau (?cle=…)")
    spec = DEMO_PERSONAS[data.persona]
    user = await db.users.find_one({"email": spec["email"]}, {"_id": 0})
    if not user:
        raise api_error(404, "not_found", "Comptes de démonstration absents : créez-les depuis le panneau de test")
    if not user.get("is_test") or not is_demo_email(user.get("email")) or user.get("deleted_at"):
        raise api_error(403, "not_allowed", "Connexion rapide réservée aux comptes de démonstration")
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_activity_at": _now().isoformat()}})
    return {"token": issue_token(user), "user": with_profile_score(user)}


def _own_emails_query(user: dict) -> dict:
    """E-mails de l'utilisateur : adressés à son adresse et reçus depuis la création de son compte (jamais ceux d'un
    ancien titulaire de la même adresse)"""
    query = {"to": (user.get("email") or "").lower()}
    if isinstance(user.get("created_at"), str) and user["created_at"]:
        query["created_at"] = {"$gte": user["created_at"]}
    return query


def _email_summary(doc: dict) -> dict:
    return {"id": doc["id"], "to": doc.get("to"), "from": f"{sender_name()} <{sender_email()}>", "subject": doc.get("subject"),
            "created_at": doc.get("created_at")}


@test_router.get("/emails")
async def list_test_emails(response: Response, limit: int = Query(50, ge=1, le=EMAILS_MAX_LIMIT), to: Optional[str] = None,
                           current_user: dict = Depends(get_current_user)):
    """Boîte mail de test, du plus récent au plus ancien : e-mails adressés à l'utilisateur connecté ; un admin voit tous
    les e-mails (filtre `?to=`). En-tête X-Total-Count."""
    if current_user.get("role") == "admin":
        query = {"to": to.strip().lower()} if to and to.strip() else {}
    else:
        query = _own_emails_query(current_user)
    response.headers["X-Total-Count"] = str(await db.test_emails.count_documents(query))
    docs = await db.test_emails.find(query, {"_id": 0, "html": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return [_email_summary(d) for d in docs]


@test_router.get("/emails/{email_id}")
async def get_test_email(email_id: str, current_user: dict = Depends(get_current_user)):
    """Un e-mail de la boîte de test : {id, to, subject, html, created_at} (le sien, ou n'importe lequel pour un admin)"""
    query = {"id": email_id} if current_user.get("role") == "admin" else {"id": email_id, **_own_emails_query(current_user)}
    doc = await db.test_emails.find_one(query, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="E-mail introuvable")
    return {"id": doc["id"], "to": doc.get("to"), "from": f"{sender_name()} <{sender_email()}>", "subject": doc.get("subject"),
            "html": doc.get("html"), "created_at": doc.get("created_at")}


@test_router.delete("/emails")
async def clear_test_emails(current_user: dict = Depends(require_admin)):
    """Admin : vide la boîte mail de test"""
    result = await db.test_emails.delete_many({})
    return {"deleted": result.deleted_count}


@router.post("/admin/test/purge")
async def admin_purge_test_data(dry_run: bool = True, current_user: dict = Depends(require_admin)):
    """Admin, disponible même hors mode test : compte (`dry_run=true`, par défaut) ou supprime toutes les données de test
    (`is_test` ou rattachées à un utilisateur `is_test`) ; renvoie {dry_run, counts, total, files}"""
    result = await purge_test_data(db, dry_run=dry_run)
    if not dry_run:
        logger.warning(f"Purge des données de test par {current_user.get('email')} : {result['total']} documents supprimés")
    return result


router.include_router(test_router)
