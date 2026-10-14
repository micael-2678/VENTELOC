"""
Référentiels de VenteLoc, partagés à l'identique avec frontend/src/lib/referentiels.js
(le test tests/test_taxonomy.py relit le fichier JS pour garantir que les deux restent synchronisés).

Contenu :
- REGIONS, DEPARTEMENTS (96 + DOM), correspondance département → région, code postal → département ;
- slugify() (même algorithme que le front) ;
- référentiels des biens loués (section « VENTELOC ») : types de biens, baux, DPE, situation locative, propriétaire,
  objet et motif de la vente, profil de l'acquéreur, et les calculs partagés (rendements, décence énergétique, titre).

Ce module n'importe rien du reste de l'application : il peut être utilisé par les migrations,
les tests et les autres modules (opendata, estimator, bail, server) sans effet de bord.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Dict, List, Optional


# ----------------------------------------------------------------------------------------------
# Régions
REGIONS: List[str] = [
    "Île-de-France", "Auvergne-Rhône-Alpes", "Provence-Alpes-Côte d'Azur",
    "Nouvelle-Aquitaine", "Occitanie", "Hauts-de-France", "Pays de la Loire",
    "Bretagne", "Grand Est", "Normandie", "Bourgogne-Franche-Comté",
    "Centre-Val de Loire", "Corse", "DOM-TOM",
]

# Départements : code → nom (96 métropolitains dont 2A/2B + 5 DOM)
DEPARTEMENTS: Dict[str, str] = {
    "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
    "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube",
    "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal",
    "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud",
    "2B": "Haute-Corse", "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne",
    "25": "Doubs", "26": "Drôme", "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère",
    "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde", "34": "Hérault",
    "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura",
    "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire", "44": "Loire-Atlantique",
    "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère", "49": "Maine-et-Loire",
    "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle",
    "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
    "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône",
    "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
    "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
    "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse",
    "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne",
    "90": "Territoire de Belfort", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis",
    "94": "Val-de-Marne", "95": "Val-d'Oise",
    "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte",
}
DEPARTEMENT_CODES: List[str] = list(DEPARTEMENTS.keys())

# Région de chaque département (même découpage que REGIONS ; les DOM sont regroupés)
_REGION_DEPARTEMENTS: Dict[str, List[str]] = {
    "Auvergne-Rhône-Alpes": ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
    "Bourgogne-Franche-Comté": ["21", "25", "39", "58", "70", "71", "89", "90"],
    "Bretagne": ["22", "29", "35", "56"],
    "Centre-Val de Loire": ["18", "28", "36", "37", "41", "45"],
    "Corse": ["2A", "2B"],
    "Grand Est": ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"],
    "Hauts-de-France": ["02", "59", "60", "62", "80"],
    "Île-de-France": ["75", "77", "78", "91", "92", "93", "94", "95"],
    "Normandie": ["14", "27", "50", "61", "76"],
    "Nouvelle-Aquitaine": ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"],
    "Occitanie": ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
    "Pays de la Loire": ["44", "49", "53", "72", "85"],
    "Provence-Alpes-Côte d'Azur": ["04", "05", "06", "13", "83", "84"],
    "DOM-TOM": ["971", "972", "973", "974", "976"],
}
DEPARTEMENT_REGION: Dict[str, str] = {
    code: region for region, codes in _REGION_DEPARTEMENTS.items() for code in codes
}

# ----------------------------------------------------------------------------------------------
# Slug : même algorithme que `slugify` dans frontend/src/lib/referentiels.js
_COMBINING = re.compile(r"[̀-ͯ]")


def slugify(value) -> str:
    """Version URL-safe d'un libellé : sans accents, minuscules, tirets. Identique au front."""
    s = unicodedata.normalize("NFD", str(value or ""))
    s = _COMBINING.sub("", s)
    s = s.lower().replace("œ", "oe").replace("æ", "ae")
    s = re.sub(r"['’]", "-", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


# ----------------------------------------------------------------------------------------------
# Départements, régions
def normalize_departement(code) -> str:
    """Code département canonique ('29', '2A', '974') ou '' si inconnu. Accepte '2a', ' 29 ', '029'."""
    s = str(code or "").strip().upper()
    if not s:
        return ""
    if s in DEPARTEMENTS:
        return s
    if s.isdigit():
        if len(s) == 1:
            s = "0" + s
        elif len(s) == 3 and s.startswith("0"):
            s = s[1:]
        if s in DEPARTEMENTS:
            return s
    if s == "20":
        # Corse sans précision : impossible de trancher entre 2A et 2B
        return ""
    return ""


def departement_label(code) -> str:
    """« Finistère (29) » ; '' si le code est inconnu."""
    c = normalize_departement(code)
    return f"{DEPARTEMENTS[c]} ({c})" if c else ""


def departement_name(code) -> str:
    c = normalize_departement(code)
    return DEPARTEMENTS.get(c, "") if c else ""


def region_for_departement(code) -> str:
    """Région (libellé REGIONS) d'un département, '' si inconnu."""
    c = normalize_departement(code)
    return DEPARTEMENT_REGION.get(c, "") if c else ""


def departements_for_region(region) -> List[str]:
    """Codes des départements d'une région (ordre de la table), [] si la région est inconnue."""
    return list(_REGION_DEPARTEMENTS.get(str(region or "").strip(), []))


def region_by_slug(slug) -> Optional[str]:
    s = slugify(slug)
    return next((r for r in REGIONS if slugify(r) == s), None)


def departement_from_postal_code(postal_code) -> str:
    """Code département déduit d'un code postal ('29200' → '29', '20000' → '2A', '97400' → '974')."""
    cp = re.sub(r"\D", "", str(postal_code or ""))
    if len(cp) != 5:
        return ""
    if cp.startswith("97") or cp.startswith("98"):
        return normalize_departement(cp[:3])
    if cp.startswith("20"):
        return "2A" if int(cp) < 20200 else "2B"
    return normalize_departement(cp[:2])


# ==============================================================================================
# VENTELOC — référentiels des biens loués (docs/venteloc/SPEC.md §2). Identiques à
# frontend/src/lib/referentiels.js (même ordre, mêmes libellés).
# ----------------------------------------------------------------------------------------------
# Types de biens. `category` : habitation | professionnel | annexe.
PROPERTY_TYPES: List[Dict[str, str]] = [
    {"id": "appartement", "label": "Appartement", "short": "Appartement", "category": "habitation"},
    {"id": "maison", "label": "Maison", "short": "Maison", "category": "habitation"},
    {"id": "immeuble", "label": "Immeuble de rapport", "short": "Immeuble", "category": "habitation"},
    {"id": "residence-geree", "label": "Lot en résidence gérée (étudiants, seniors, tourisme, EHPAD)", "short": "Résidence gérée", "category": "professionnel"},
    {"id": "local-commercial", "label": "Local commercial", "short": "Local commercial", "category": "professionnel"},
    {"id": "bureaux", "label": "Bureaux", "short": "Bureaux", "category": "professionnel"},
    {"id": "parking", "label": "Parking, box, garage", "short": "Parking", "category": "annexe"},
    {"id": "autre", "label": "Autre bien loué", "short": "Bien", "category": "annexe"},
]
PROPERTY_TYPE_IDS: List[str] = [t["id"] for t in PROPERTY_TYPES]
PROPERTY_TYPES_BY_ID: Dict[str, Dict[str, str]] = {t["id"]: t for t in PROPERTY_TYPES}

# Types de baux. `regime` : habitation (loi du 6 juillet 1989, calendrier DPE applicable) | commercial | professionnel | autre.
LEASE_TYPES: List[Dict[str, str]] = [
    {"id": "habitation-vide", "label": "Bail d'habitation vide (loi du 6 juillet 1989)", "short": "Location vide", "regime": "habitation"},
    {"id": "habitation-meublee", "label": "Bail d'habitation meublé (résidence principale)", "short": "Location meublée", "regime": "habitation"},
    {"id": "colocation", "label": "Colocation (bail unique ou baux individuels)", "short": "Colocation", "regime": "habitation"},
    {"id": "bail-mobilite", "label": "Bail mobilité (1 à 10 mois)", "short": "Bail mobilité", "regime": "habitation"},
    {"id": "mixte", "label": "Bail mixte (habitation et professionnel)", "short": "Bail mixte", "regime": "habitation"},
    {"id": "commercial", "label": "Bail commercial (3-6-9)", "short": "Bail commercial", "regime": "commercial"},
    {"id": "residence-geree", "label": "Bail commercial avec un exploitant de résidence", "short": "Bail exploitant", "regime": "commercial"},
    {"id": "professionnel", "label": "Bail professionnel", "short": "Bail professionnel", "regime": "professionnel"},
    {"id": "parking", "label": "Location de parking ou de box", "short": "Location parking", "regime": "autre"},
    {"id": "plusieurs-baux", "label": "Plusieurs baux (immeuble ou plusieurs lots)", "short": "Plusieurs baux", "regime": "habitation"},
]
LEASE_TYPE_IDS: List[str] = [t["id"] for t in LEASE_TYPES]
LEASE_TYPES_BY_ID: Dict[str, Dict[str, str]] = {t["id"]: t for t in LEASE_TYPES}

# Diagnostic de performance énergétique : classes de A à G, plus « non soumis » et « DPE vierge ».
DPE_CLASSES: List[Dict[str, str]] = [
    {"id": "A", "label": "A"}, {"id": "B", "label": "B"}, {"id": "C", "label": "C"}, {"id": "D", "label": "D"},
    {"id": "E", "label": "E"}, {"id": "F", "label": "F"}, {"id": "G", "label": "G"},
    {"id": "vierge", "label": "DPE vierge"}, {"id": "non-soumis", "label": "Non soumis au DPE"},
]
DPE_CLASS_IDS: List[str] = [c["id"] for c in DPE_CLASSES]
# Interdiction de louer un logement (nouveau bail, renouvellement, reconduction tacite) selon la classe DPE :
# loi Climat et résilience du 22 août 2021, art. 160 (décence énergétique). Dates d'effet en France métropolitaine.
DPE_RENTAL_BAN: Dict[str, str] = {"G": "2025-01-01", "F": "2028-01-01", "E": "2034-01-01"}

# Situation locative déclarée par le vendeur (12 derniers mois)
TENANT_PAYMENT_STATUSES: List[Dict[str, str]] = [
    {"id": "a-jour", "label": "Loyers payés à l'échéance"},
    {"id": "retards", "label": "Retards ponctuels, régularisés"},
    {"id": "impayes", "label": "Impayés en cours"},
]
TENANT_PAYMENT_STATUS_IDS: List[str] = [s["id"] for s in TENANT_PAYMENT_STATUSES]

# Qui est propriétaire, et à quel titre le mandant signe
OWNER_TYPES: List[Dict[str, str]] = [
    {"id": "personne-physique", "label": "Propriétaire en nom propre"},
    {"id": "indivision", "label": "Indivision (plusieurs propriétaires)"},
    {"id": "sci", "label": "Société civile immobilière (SCI)"},
    {"id": "societe", "label": "Autre société (SARL, SAS…)"},
]
OWNER_TYPE_IDS: List[str] = [o["id"] for o in OWNER_TYPES]

# Objet de la vente
SALE_OBJECTS: List[Dict[str, str]] = [
    {"id": "bien", "label": "Vente du bien (immeuble ou lot de copropriété)"},
    {"id": "parts", "label": "Cession des parts de la société propriétaire"},
    {"id": "indifferent", "label": "Bien ou parts, à décider avec l'acquéreur"},
]
SALE_OBJECT_IDS: List[str] = [s["id"] for s in SALE_OBJECTS]

SALE_REASONS: List[Dict[str, str]] = [
    {"id": "arbitrage", "label": "Arbitrage de patrimoine"},
    {"id": "succession", "label": "Succession, donation, partage"},
    {"id": "liquidites", "label": "Besoin de liquidités"},
    {"id": "fiscalite", "label": "Fiscalité"},
    {"id": "gestion", "label": "Ne plus gérer de location"},
    {"id": "autre", "label": "Autre raison"},
]
SALE_REASON_IDS: List[str] = [s["id"] for s in SALE_REASONS]

# Profil de l'acquéreur
BUYER_PROJECT_TYPES: List[Dict[str, str]] = [
    {"id": "particulier", "label": "Investisseur particulier (en nom propre)"},
    {"id": "sci", "label": "Achat via une SCI"},
    {"id": "societe", "label": "Société (IS, holding)"},
    {"id": "professionnel", "label": "Investisseur professionnel, marchand de biens"},
]
BUYER_PROJECT_TYPE_IDS: List[str] = [p["id"] for p in BUYER_PROJECT_TYPES]
FINANCING_TYPES: List[Dict[str, str]] = [
    {"id": "comptant", "label": "Comptant"},
    {"id": "emprunt", "label": "Emprunt bancaire"},
    {"id": "mixte", "label": "Apport et emprunt"},
    {"id": "a-definir", "label": "À définir"},
]
FINANCING_TYPE_IDS: List[str] = [f["id"] for f in FINANCING_TYPES]


def property_type_by_id(type_id) -> Optional[Dict[str, str]]:
    return PROPERTY_TYPES_BY_ID.get(str(type_id or "").strip())


def property_type_label(type_id, short: bool = False) -> str:
    t = property_type_by_id(type_id)
    return (t["short"] if short else t["label"]) if t else ""


def lease_type_by_id(lease_id) -> Optional[Dict[str, str]]:
    return LEASE_TYPES_BY_ID.get(str(lease_id or "").strip())


def lease_type_label(lease_id, short: bool = False) -> str:
    t = lease_type_by_id(lease_id)
    return (t["short"] if short else t["label"]) if t else ""


def is_housing_lease(lease_id) -> bool:
    """Bail soumis à la loi du 6 juillet 1989 (calendrier de décence énergétique, gel des loyers F/G)."""
    t = lease_type_by_id(lease_id)
    return bool(t and t["regime"] == "habitation")


def dpe_rental_status(dpe_class, lease_id, today: Optional[str] = None) -> Dict[str, Optional[str]]:
    """
    Décence énergétique d'un logement loué : {'status': 'interdit' | 'echeance' | 'ok' | 'non-applicable', 'date': 'AAAA-MM-JJ'|None}.
    'interdit' : la classe ne permet plus de conclure, renouveler ou reconduire un bail d'habitation depuis `date` ;
    'echeance' : l'interdiction prendra effet à `date`. Le bail en cours continue jusqu'à son terme.
    `today` (AAAA-MM-JJ) sert aux tests ; par défaut la date du jour (UTC).
    """
    if not is_housing_lease(lease_id):
        return {"status": "non-applicable", "date": None}
    ban = DPE_RENTAL_BAN.get(str(dpe_class or "").strip().upper())
    if not ban:
        return {"status": "ok", "date": None}
    if today is None:
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).date().isoformat()
    return {"status": "interdit" if today >= ban else "echeance", "date": ban}


def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def gross_yield(rent_monthly, price) -> Optional[float]:
    """Rendement brut en % (loyer hors charges × 12 / prix), arrondi à 0,01 ; None si incalculable."""
    rent, p = _num(rent_monthly), _num(price)
    if rent <= 0 or p <= 0:
        return None
    return round(rent * 12 / p * 100, 2)


def net_yield(rent_monthly, price, property_tax=0, non_recoverable_charges=0, other_costs=0) -> Optional[float]:
    """Rendement net de charges en % : (loyers annuels − taxe foncière − charges non récupérables − autres frais annuels) / prix."""
    rent, p = _num(rent_monthly), _num(price)
    if rent <= 0 or p <= 0:
        return None
    net = rent * 12 - _num(property_tax) - _num(non_recoverable_charges) - _num(other_costs)
    return round(net / p * 100, 2)


def _fmt_surface(surface) -> str:
    s = _num(surface)
    if s <= 0:
        return ""
    return (f"{s:.0f}" if s == int(s) else f"{s:.1f}".replace(".", ",")) + " m²"


# Début du titre généré et accord de « loué » (« Maison louée », « Bureaux loués »)
PROPERTY_TITLE_HEADS: Dict[str, tuple] = {
    "appartement": ("Appartement", "loué"), "maison": ("Maison", "louée"), "immeuble": ("Immeuble de rapport", "loué"),
    "residence-geree": ("Lot en résidence gérée", "loué"), "local-commercial": ("Local commercial", "loué"),
    "bureaux": ("Bureaux", "loués"), "parking": ("Parking", "loué"), "autre": ("Bien", "loué"),
}


def property_title(property_type, city=None, department=None, surface=None, rooms=None, units_count=None) -> str:
    """
    Titre d'annonce généré côté serveur, jamais l'adresse : « Appartement T2 loué · 42 m² · Lyon (69) »,
    « Immeuble de rapport loué · 6 lots · Saint-Étienne (42) », « Parking loué · Nice (06) ». Segments vides omis.
    """
    t = property_type_by_id(property_type)
    head, rented = PROPERTY_TITLE_HEADS.get(t["id"] if t else "autre", PROPERTY_TITLE_HEADS["autre"])
    try:
        n_rooms = int(rooms) if rooms not in (None, "") else None
    except (TypeError, ValueError):
        n_rooms = None
    if t and t["id"] in ("appartement", "maison") and n_rooms and n_rooms > 0:
        head = f"{head} T{n_rooms}"
    parts = [f"{head} {rented}"]
    try:
        n_units = int(units_count) if units_count not in (None, "") else None
    except (TypeError, ValueError):
        n_units = None
    if t and t["id"] == "immeuble" and n_units and n_units > 0:
        parts.append(f"{n_units} lot{'s' if n_units > 1 else ''}")
    surf = _fmt_surface(surface)
    if surf and not (t and t["id"] == "parking"):
        parts.append(surf)
    dep = normalize_departement(department)
    place = str(city or "").strip()
    if place and dep:
        parts.append(f"{place} ({dep})")
    elif place:
        parts.append(place)
    elif dep:
        parts.append(departement_label(dep))
    return " · ".join(parts)
