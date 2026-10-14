"""
Mode test (docs/refonte-2026-10/MODE-TEST-ET-APP.md, partie B) : essayer toute l'application sans vérifier réellement son
identité, sans dépendre de l'envoi d'e-mails et sans engager de vrais contrats.

Activation : TEST_MODE=true (lu à chaque appel, `test_mode_enabled()`). Hors mode test, toutes les routes /test/* répondent
404 « Introuvable » (dépendance `require_test_mode`, évaluée avant l'authentification).

Routes (préfixe /api) :
- POST /test/identity/simulate {first_name?, last_name?, birth_date?} : identité de l'utilisateur connecté marquée vérifiée
  (`kyc_provider: 'test'`), mêmes effets que Stripe Identity (brouillons soumis, accès au dossier du bien ouverts) ;
- POST /test/confirm-email : confirme l'adresse de l'utilisateur connecté ;
- POST /test/seed : comptes de démonstration (vendeur, acquéreur, admin @test.local, mot de passe TEST_DEMO_PASSWORD) et
  8 biens loués publiés par le parcours réel (création, justificatif de propriété vérifié, adresse et qualité du mandant,
  mandat de test signé, contrôles, publication) ; idempotent ;
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

from business_model import (DEMO_EMAIL_DOMAIN, is_demo_email, sender_email, sender_name,  # noqa: F401 (réexport)
                            test_mode_enabled)
from migrations.purge_test_data import purge_test_data
from business_model import text_to_pdf
from server import (OTP_TTL_SECONDS, USER_SAFE_PROJECTION, BuyerProfile, PropertyCreate, PropertyUpdate, MandantAddress,
                    MandatSignature, api_error, buyer_profile_score, create_property, db, generate_seller_mandat,
                    get_current_user, hash_password_async, identity_verified_effects, issue_token, limiter, mask_email,
                    normalize_buyer_profile, otp_hash, require_admin, sign_seller_mandat, test_panel_access, update_property,
                    with_profile_score)
from storage import save_file

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
                "company_name": None, "birth_date": "1961-04-12", "phone": "06 00 00 00 01"},
    "acquereur": {"email": f"acquereur.demo@{DEMO_EMAIL_DOMAIN}", "role": "buyer", "first_name": "Claire", "last_name": "Martin",
                  "company_name": None, "birth_date": "1984-09-23", "phone": "06 00 00 00 02"},
    "admin": {"email": f"admin.demo@{DEMO_EMAIL_DOMAIN}", "role": "admin", "first_name": "Alice", "last_name": "Admin",
              "company_name": None, "birth_date": "1979-01-30", "phone": None},
}

DEMO_BUYER_PROFILE = {"project_type": "particulier", "budget_max": 350000, "apport": 90000, "financing": "mixte",
                      "zones": ["Auvergne-Rhône-Alpes", "Nouvelle-Aquitaine", "Pays de la Loire", "Bretagne"],
                      "property_types": ["appartement", "maison", "immeuble"], "min_yield": 5, "horizon": "0-6",
                      "experience": "Propriétaire de deux appartements loués depuis 2018, gérés en direct."}


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
        "last_name": spec["last_name"], "company_name": spec["company_name"], "phone": spec["phone"],
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
# Annonces de démonstration : 8 biens loués fictifs (adresses « de la Démonstration », SIRET fictif de la SCI avec une clé
# de contrôle volontairement invalide : aucune société réelle ne peut porter ce numéro), publiés par le parcours réel avec
# un justificatif de propriété vérifié et un mandat de test signé. Aucune donnée de locataire.

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
        "key": "studio-lyon", "days_ago": 1, "property_type": "appartement", "owner_type": "personne-physique",
        "address": "12 rue de la Démonstration", "postal_code": "69007", "city": "Lyon", "district": "Jean Macé",
        "surface": 24, "rooms": 1, "floor": 3, "elevator": True, "construction_year": 1965, "is_copro": True, "copro_lots": 28,
        "copro_charges_annual": 720, "copro_procedure": False, "dpe_class": "C", "ges_class": "C", "energy_cost_min": 380,
        "energy_cost_max": 560, "dpe_date": "2024-03-12",
        "lease_type": "habitation-meublee", "rent_monthly": 620, "charges_monthly": 60, "lease_start": "2023-09-01",
        "lease_end": "2026-08-31", "tenant_since": "2023-09-01", "deposit": 1240, "indexation": "irl", "last_revision": "2025-09-01",
        "tenant_payment_status": "a-jour", "has_gli": True, "has_guarantor": False, "property_tax": 520,
        "non_recoverable_charges": 420, "management": "direct",
        "asking_price": 145000, "sale_object": "bien", "sale_reason": "arbitrage",
        "availability_note": "Signature de l'acte possible à partir de janvier.",
        "description": "Studio meublé de 24 m² au troisième étage avec ascenseur, à deux pas du métro Jean Macé et des "
                       "universités du septième arrondissement. Pièce de vie lumineuse sur cour calme, kitchenette équipée, "
                       "salle d'eau refaite en 2022, rangements intégrés. Loué depuis septembre 2023 à un étudiant avec garantie "
                       "loyers impayés, loyers toujours payés à l'échéance. Copropriété bien tenue, ravalement voté et financé.",
        "equipment": "Cave, double vitrage, interphone, local vélos.",
        "recent_works": "Salle d'eau refaite en 2022, peintures et sols en 2023.",
    },
    {
        "key": "t2-lille", "days_ago": 4, "property_type": "appartement", "owner_type": "personne-physique",
        "address": "8 rue de la Démonstration", "postal_code": "59000", "city": "Lille", "district": "Wazemmes",
        "surface": 41, "rooms": 2, "floor": 1, "elevator": False, "construction_year": 1930, "is_copro": True, "copro_lots": 6,
        "copro_charges_annual": 540, "copro_procedure": False, "dpe_class": "E", "ges_class": "E", "energy_cost_min": 900,
        "energy_cost_max": 1250, "dpe_date": "2023-11-05",
        "lease_type": "habitation-vide", "rent_monthly": 640, "charges_monthly": 40, "lease_start": "2021-06-01",
        "lease_end": "2027-05-31", "tenant_since": "2021-06-01", "deposit": 640, "indexation": "irl", "last_revision": "2025-06-01",
        "tenant_payment_status": "a-jour", "has_gli": False, "has_guarantor": True, "property_tax": 780,
        "non_recoverable_charges": 360, "management": "agence",
        "asking_price": 128000, "sale_object": "bien", "sale_reason": "gestion",
        "description": "Deux pièces de 41 m² au premier étage d'une petite copropriété de six lots, dans le quartier vivant de "
                       "Wazemmes, proche du marché et du métro. Séjour sur rue, chambre sur cour, cuisine séparée. Locataire en "
                       "place depuis 2021, avec caution, sans incident de paiement. Bail vide à échéance 2027. Le classement E "
                       "laisse jusqu'en 2034 pour réaliser une isolation ; des devis sont disponibles dans le dossier du bien.",
        "equipment": "Cave, chaudière gaz individuelle récente.",
        "recent_works": "Chaudière remplacée en 2022.",
    },
    {
        "key": "t3-bordeaux", "days_ago": 9, "property_type": "appartement", "owner_type": "indivision",
        "address": "21 cours de la Démonstration", "postal_code": "33000", "city": "Bordeaux", "district": "Chartrons",
        "surface": 64, "rooms": 3, "floor": 2, "elevator": True, "construction_year": 1972, "is_copro": True, "copro_lots": 42,
        "copro_charges_annual": 1380, "copro_procedure": False, "dpe_class": "D", "ges_class": "D", "energy_cost_min": 820,
        "energy_cost_max": 1110, "dpe_date": "2024-01-18",
        "lease_type": "habitation-vide", "rent_monthly": 1050, "charges_monthly": 110, "lease_start": "2022-10-01",
        "lease_end": "2025-09-30", "tenant_since": "2019-10-01", "deposit": 1050, "indexation": "irl", "last_revision": "2025-10-01",
        "tenant_payment_status": "a-jour", "has_gli": True, "has_guarantor": False, "property_tax": 1350,
        "non_recoverable_charges": 900, "management": "direct",
        "asking_price": 265000, "sale_object": "bien", "sale_reason": "succession",
        "description": "Trois pièces de 64 m² aux Chartrons, au deuxième étage avec ascenseur d'une résidence des années "
                       "soixante-dix entretenue. Séjour traversant avec balcon, deux chambres, cuisine aménagée. Locataires en "
                       "place depuis 2019, couple stable, bail reconduit en 2022 et loyer au prix du quartier. Vente après "
                       "succession, en accord entre les deux indivisaires. Tram et commerces au pied de l'immeuble.",
        "equipment": "Balcon, cave, place de stationnement en sous-sol.",
        "recent_works": "Fenêtres en double vitrage posées en 2020.",
    },
    {
        "key": "maison-nantes", "days_ago": 15, "property_type": "maison", "owner_type": "personne-physique",
        "address": "5 impasse de la Démonstration", "postal_code": "44000", "city": "Nantes", "district": "Doulon",
        "surface": 92, "rooms": 4, "construction_year": 1958, "is_copro": False, "dpe_class": "F", "ges_class": "F",
        "energy_cost_min": 2100, "energy_cost_max": 2850, "dpe_date": "2023-05-22",
        "lease_type": "habitation-vide", "rent_monthly": 1250, "charges_monthly": 0, "lease_start": "2020-04-01",
        "lease_end": "2026-03-31", "tenant_since": "2020-04-01", "deposit": 1250, "indexation": "irl", "last_revision": "2022-04-01",
        "tenant_payment_status": "retards", "has_gli": False, "has_guarantor": True, "property_tax": 1680,
        "non_recoverable_charges": 650, "management": "direct",
        "asking_price": 310000, "sale_object": "bien", "sale_reason": "liquidites",
        "description": "Maison de 92 m² avec jardin de 300 m² dans le quartier résidentiel de Doulon, à dix minutes du centre "
                       "en tramway. Quatre pièces dont trois chambres, garage attenant, sous-sol complet. Famille locataire "
                       "depuis 2020, quelques retards ponctuels régularisés. Classée F : le bail en cours continue, mais une "
                       "rénovation énergétique (isolation des combles et des murs, chauffage) est à prévoir avant 2028 pour "
                       "pouvoir relouer ; le loyer est gelé tant que la classe F demeure.",
        "equipment": "Jardin, garage, sous-sol.",
        "recent_works": "Toiture révisée en 2021.",
    },
    {
        "key": "immeuble-saint-etienne", "days_ago": 22, "property_type": "immeuble", "owner_type": "sci",
        "company_name": "SCI du Furan (démonstration)", "siret": _fictitious_siret(5),
        "address": "17 rue de la Démonstration", "postal_code": "42000", "city": "Saint-Étienne", "district": "Jacquard",
        "surface": 310, "rooms": 11, "construction_year": 1910, "units_count": 5, "units_rented": 5, "is_copro": False,
        "dpe_class": "D", "ges_class": "D", "energy_cost_min": 5200, "energy_cost_max": 7100, "dpe_date": "2024-02-02",
        "lease_type": "plusieurs-baux", "rent_monthly": 2950, "charges_monthly": 250, "lease_start": "2019-01-01",
        "tenant_since": "2017-03-01", "deposit": 2950, "indexation": "irl", "last_revision": "2025-01-01",
        "tenant_payment_status": "a-jour", "has_gli": True, "has_guarantor": False, "property_tax": 3900,
        "non_recoverable_charges": 2400, "management": "agence",
        "asking_price": 390000, "sale_object": "bien", "sale_reason": "arbitrage",
        # Seule annonce laissée « à relire » (drapeaux de l'open data) : scénario admin du panneau de test
        "a_relire": True,
        "description": "Immeuble de rapport de cinq lots entièrement loués, en pierre, dans le quartier Jacquard, proche du "
                       "tramway et des commerces : un commerce de proximité en rez-de-chaussée et quatre appartements du T2 au "
                       "T3. Baux d'habitation vides, locataires stables, gestion confiée à une agence locale. Toiture refaite "
                       "en 2019, électricité des parties communes mise aux normes. Vente de l'immeuble par la SCI propriétaire, "
                       "rendement brut supérieur à 9 %.",
        "equipment": "Caves, cour commune, compteurs individuels.",
        "recent_works": "Toiture refaite en 2019, parties communes rénovées en 2021.",
        "mandant_capacity": "gerant",
    },
    {
        "key": "local-rennes", "days_ago": 30, "property_type": "local-commercial", "owner_type": "personne-physique",
        "address": "3 place de la Démonstration", "postal_code": "35000", "city": "Rennes", "district": "Centre",
        "surface": 85, "construction_year": 1985, "is_copro": True, "copro_lots": 12, "copro_charges_annual": 1100,
        "copro_procedure": False, "dpe_class": "D", "energy_cost_min": 1400, "energy_cost_max": 1900, "dpe_date": "2023-09-14",
        "lease_type": "commercial", "rent_monthly": 1600, "charges_monthly": 120, "lease_start": "2021-01-01",
        "lease_end": "2029-12-31", "tenant_since": "2021-01-01", "deposit": 4800, "indexation": "ilc", "last_revision": "2025-01-01",
        "tenant_payment_status": "a-jour", "has_gli": False, "has_guarantor": False, "property_tax": 2100,
        "non_recoverable_charges": 900, "management": "direct",
        "asking_price": 240000, "sale_object": "bien", "sale_reason": "fiscalite",
        "description": "Local commercial de 85 m² en rez-de-chaussée avec vitrine, dans une rue piétonne du centre de Rennes "
                       "à fort passage. Loué depuis 2021 à une enseigne régionale d'optique par un bail commercial 3-6-9, "
                       "loyer indexé sur l'indice des loyers commerciaux, taxe foncière refacturée selon le bail. Réserve et "
                       "sanitaires à l'arrière. Le locataire bénéficie d'un droit de préférence que le notaire purgera.",
        "equipment": "Vitrine, réserve, rideau métallique.",
        "recent_works": "Façade et vitrine rénovées par le locataire en 2021.",
    },
    {
        "key": "parking-paris", "days_ago": 38, "property_type": "parking", "owner_type": "personne-physique",
        "address": "40 rue de la Démonstration", "postal_code": "75015", "city": "Paris", "district": "Commerce",
        "is_copro": True, "copro_lots": 120, "copro_charges_annual": 180, "copro_procedure": False, "dpe_class": "non-soumis",
        "lease_type": "parking", "rent_monthly": 140, "charges_monthly": 0, "lease_start": "2022-02-01",
        "tenant_since": "2022-02-01", "deposit": 140, "indexation": "aucune", "tenant_payment_status": "a-jour",
        "has_gli": False, "has_guarantor": False, "property_tax": 160, "non_recoverable_charges": 180, "management": "direct",
        "asking_price": 32000, "sale_object": "bien", "sale_reason": "gestion",
        "description": "Place de parking en deuxième sous-sol d'une résidence récente du quinzième arrondissement, accès par "
                       "badge et porte automatique, à proximité de la rue du Commerce et du métro. Louée depuis 2022 à un "
                       "résident de l'immeuble, sans incident. Charges de copropriété faibles, aucune gestion à prévoir : "
                       "un premier investissement simple dans un quartier où le stationnement est rare.",
        "equipment": "Accès par badge, porte automatique, vidéosurveillance.",
    },
    {
        "key": "residence-toulouse", "days_ago": 45, "property_type": "residence-geree", "owner_type": "personne-physique",
        "address": "9 allée de la Démonstration", "postal_code": "31400", "city": "Toulouse", "district": "Rangueil",
        "surface": 19, "rooms": 1, "floor": 2, "elevator": True, "construction_year": 2012, "is_copro": True, "copro_lots": 140,
        "copro_charges_annual": 0, "copro_procedure": False, "dpe_class": "C", "ges_class": "B", "energy_cost_min": 310,
        "energy_cost_max": 450, "dpe_date": "2022-06-30",
        "lease_type": "residence-geree", "rent_monthly": 430, "charges_monthly": 0, "lease_start": "2021-09-01",
        "lease_end": "2030-08-31", "deposit": 0, "indexation": "irl", "last_revision": "2025-09-01",
        "tenant_payment_status": "a-jour", "has_gli": False, "has_guarantor": False, "property_tax": 430,
        "non_recoverable_charges": 160, "management": "exploitant", "operator_lease_end": "2030-08-31",
        "asking_price": 98000, "sale_object": "bien", "sale_reason": "arbitrage",
        "description": "Studio de 19 m² meublé dans une résidence étudiante de 2012 à Rangueil, à proximité immédiate de "
                       "l'université et du métro. Le lot est loué à l'exploitant de la résidence par un bail commercial "
                       "renouvelé en 2021 jusqu'en 2030 : loyer versé chaque trimestre par l'exploitant, sans vacance ni gestion "
                       "locative pour le propriétaire. Taux d'occupation de la résidence supérieur à 95 % ces trois dernières années.",
        "equipment": "Meublé, kitchenette, salle d'eau, services de la résidence.",
    },
]


# Champs de PropertyCreate repris des fiches de démonstration (les clés internes `key`, `days_ago`, `a_relire` et la
# qualité du mandant sont exclues)
DEMO_LISTING_FIELDS = tuple(k for k in PropertyCreate.model_fields)


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


async def _verified_ownership(property: dict, seller_id: str) -> None:
    """Justificatif de propriété de démonstration (PDF généré, `verified`) : visible dans l'espace admin"""
    if (property.get("ownership") or {}).get("status") == "verified":
        return
    now = _now().isoformat()
    content = text_to_pdf("Justificatif de propriété — démonstration",
                          "DOCUMENT DE TEST — SANS VALEUR JURIDIQUE\n\nAttestation de propriété fictive générée par le mode test "
                          f"pour l'annonce « {property.get('title') or ''} ».")
    stored = await save_file(content, "application/pdf", f"ownership/{property['id']}")
    proof = {"id": str(uuid.uuid4()), "property_id": property["id"], "doc_type": "attestation-notariee",
             "filename": "attestation-de-propriete-demonstration.pdf", "content_type": "application/pdf", **stored,
             "uploaded_at": now, "uploaded_by": seller_id, "is_test": True}
    await db.ownership_proofs.delete_many({"property_id": property["id"]})
    await db.ownership_proofs.insert_one(proof)
    ownership = {"status": "verified", "doc_type": "attestation-notariee", "filename": proof["filename"],
                 "content_type": "application/pdf", "uploaded_at": now, "proof_id": proof["id"], "reviewed_at": now,
                 "reviewed_by": "demonstration", "note": None}
    await db.properties.update_one({"id": property["id"]}, {"$set": {"ownership": ownership}})


async def _publish_demo_listing(spec: dict, seller_id: str, request: Request) -> tuple:
    """(annonce, créée ?) : création → justificatif vérifié → adresse et qualité du mandant → mandat de test → signature →
    contrôles et publication"""
    existing = await db.properties.find_one({"seller_id": seller_id, "demo_key": spec["key"]}, {"_id": 0})
    created = existing is None
    if created:
        data = {k: spec[k] for k in DEMO_LISTING_FIELDS if k in spec}
        property = await create_property(PropertyCreate(**data), current_user=await _fresh(seller_id))
        await db.properties.update_one({"id": property["id"]}, {"$set": {"demo_key": spec["key"], "is_test": True}})
        property_id = property["id"]
    else:
        property_id = existing["id"]
        if existing.get("status") == "published":
            return existing, False
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    await _verified_ownership(property, seller_id)
    if not property.get("mandant_address"):
        address = MandantAddress(line1="1 place de la Démonstration", postal_code=spec["postal_code"], city=spec["city"])
        await update_property(property_id, PropertyUpdate(mandant_address=address,
                                                          mandant_capacity=spec.get("mandant_capacity") or
                                                          ("coindivisaire" if spec.get("owner_type") == "indivision" else "proprietaire")),
                             current_user=await _fresh(seller_id))
    mandate = await generate_seller_mandat(property_id=property_id, current_user=await _fresh(seller_id))
    if not mandate.get("already_signed"):
        await _sign_with_test_code(mandate["contract_id"], await _fresh(seller_id), request)
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if property.get("status") != "published":
        logger.warning(f"Annonce de démonstration {spec['key']} non publiée : {property.get('status')} {property.get('blocking')}")
        return property, created
    # Dates étalées sur deux mois (tri « récentes » réaliste)
    published = _now() - timedelta(days=spec["days_ago"], hours=3)
    update = {"published_at": published.isoformat(), "created_at": (published - timedelta(days=2)).isoformat(),
              "submitted_at": published.isoformat(), "updated_at": published.isoformat()}
    if spec.get("a_relire"):
        # Drapeaux de l'open data conservés (SIRET fictif de la SCI) : l'annonce apparaît dans « À faire » de l'admin démo
        update["moderation.status"] = "pending"
        update["moderation.review_until"] = (_now() + timedelta(hours=24)).isoformat()
    else:
        # Contrôles réputés passés : propriétaire vérifié, annonce relue
        update.update(_demo_checks_passed(property, published))
    await db.properties.update_one({"id": property_id}, {"$set": update})
    return await db.properties.find_one({"id": property_id}, {"_id": 0}), created


def _demo_checks_passed(property: dict, published: datetime) -> dict:
    """Champs d'une annonce de démonstration dont les contrôles automatiques sont passés"""
    checks = {**(property.get("property_checks") or {}), "ownership_verified": True, "opendata_available": True,
              "duplicate_address": False, "checked_at": published.isoformat()}
    return {"property_checks": checks, "flags": [], "moderation.flags": [], "moderation.status": "ok",
            "moderation.reviewed_at": (published + timedelta(days=1)).isoformat(), "moderation.reason": "Annonce de démonstration"}


# ----------------------------------------------------------------------------------------------
# Routes du mode test

class IdentitySimulation(BaseModel):
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    birth_date: Optional[str] = Field(None, description="AAAA-MM-JJ")


@test_router.post("/identity/simulate")
async def simulate_identity(data: Optional[IdentitySimulation] = None, current_user: dict = Depends(get_current_user)):
    """Identité de l'utilisateur connecté marquée vérifiée (`kyc_provider: 'test'`), avec les mêmes effets que Stripe
    Identity : brouillons du vendeur soumis (mandat, contrôles, publication), accès au dossier de l'acquéreur ouverts si
    les autres étapes sont faites. Nom, prénom et date de naissance : ceux du corps, sinon ceux du profil."""
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
    listings = await db.properties.find({"seller_id": current_user["id"]}, {"_id": 0, "id": 1, "status": 1, "title": 1}).to_list(50)
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
    for persona in ("vendeur", "acquereur", "admin"):
        user, created = await _ensure_persona(persona, password_hash, now)
        users[persona] = user
        created_accounts += int(created)
        accounts.append({"persona": persona, "email": user["email"], "role": user["role"], "created": created})
    seller_id = users["vendeur"]["id"]
    created_listings, published = 0, 0
    for spec in DEMO_LISTINGS:
        try:
            property, created = await _publish_demo_listing(spec, seller_id, request)
        except HTTPException as e:
            logger.error(f"Annonce de démonstration {spec['key']} : {e.detail}")
            continue
        created_listings += int(created)
        published += int(property.get("status") == "published")
    return {"accounts": accounts, "password": password, "accounts_created": created_accounts,
            "listings_created": created_listings, "listings_published": published, "listings_total": len(DEMO_LISTINGS)}


class LoginAs(BaseModel):
    persona: Literal["vendeur", "acquereur", "admin"]


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
