"""
Taxonomie du bâtiment, partagée à l'identique avec frontend/src/lib/referentiels.js
(le test tests/test_taxonomy.py relit le fichier JS pour garantir que les deux restent synchronisés).

Contenu :
- TRADES : les 16 métiers (ids stables, libellé long, libellé court) ;
- RGE_CATEGORIES : les 18 domaines RGE (`value` = libellé long stocké dans `rge_types`) ;
- OTHER_QUALIFICATIONS : qualifications déclaratives (sans vérification) ;
- REGIONS, DEPARTEMENTS (96 + DOM), correspondance département → région ;
- codes NAF du bâtiment (section F) et codes connexes tolérés ;
- fonctions utilitaires : trades_for_rge(), trade_label(), departement_label(), slugify(), validate_trades()…

Ce module n'importe rien du reste de l'application : il peut être utilisé par les migrations,
les tests et les autres modules (opendata, estimator, server) sans effet de bord.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Dict, Iterable, List, Optional

# ----------------------------------------------------------------------------------------------
# Métiers du bâtiment (spécification §2.1)
# `id` : stable, déjà au format URL (slug) ; `label` : libellé affiché ; `short` : libellé court
# (cartes d'annonces, titres générés, liens).
TRADES: List[Dict[str, str]] = [
    {"id": "plomberie-chauffage", "label": "Plomberie, chauffage, sanitaire", "short": "Plomberie-chauffage"},
    {"id": "pac-clim-cvc", "label": "Pompes à chaleur, climatisation, CVC", "short": "PAC, climatisation"},
    {"id": "electricite", "label": "Électricité générale", "short": "Électricité"},
    {"id": "isolation", "label": "Isolation (ITE, ITI, combles)", "short": "Isolation"},
    {"id": "couverture-charpente", "label": "Couverture, charpente, zinguerie", "short": "Couverture-charpente"},
    {"id": "menuiserie", "label": "Menuiserie, fermetures, stores", "short": "Menuiserie"},
    {"id": "maconnerie-gros-oeuvre", "label": "Maçonnerie, gros œuvre", "short": "Maçonnerie"},
    {"id": "platrerie-peinture", "label": "Plâtrerie, peinture, finitions", "short": "Plâtrerie-peinture"},
    {"id": "carrelage-sols", "label": "Carrelage, sols, parquets", "short": "Carrelage, sols"},
    {"id": "photovoltaique-enr", "label": "Photovoltaïque, énergies renouvelables", "short": "Photovoltaïque"},
    {"id": "renovation-generale", "label": "Rénovation générale, tous corps d'état", "short": "Rénovation générale"},
    {"id": "terrassement-vrd", "label": "Terrassement, VRD, réseaux", "short": "Terrassement, VRD"},
    {"id": "etancheite", "label": "Étanchéité, bardage", "short": "Étanchéité"},
    {"id": "serrurerie-metallerie", "label": "Serrurerie, métallerie", "short": "Serrurerie-métallerie"},
    {"id": "agencement", "label": "Agencement, cuisines, salles de bains", "short": "Agencement"},
    {"id": "piscine-paysage", "label": "Piscines, paysage, clôtures", "short": "Piscines, paysage"},
]
TRADE_IDS: List[str] = [t["id"] for t in TRADES]
TRADES_BY_ID: Dict[str, Dict[str, str]] = {t["id"]: t for t in TRADES}

# Nombre de métiers par annonce (spécification §2.2 : 1 à 4, obligatoire)
MIN_TRADES = 1
MAX_TRADES = 4

# ----------------------------------------------------------------------------------------------
# Domaines RGE (inchangés). `value` = libellé long, valeur stockée dans `rge_types`.
RGE_CATEGORIES: List[Dict[str, str]] = [
    {"id": "isolation_interieur", "label": "Isolation par l'intérieur (murs, rampants, plafonds)"},
    {"id": "isolation_exterieur", "label": "Isolation des murs par l'extérieur"},
    {"id": "isolation_toiture", "label": "Isolation toiture terrasse / par l'extérieur"},
    {"id": "isolation_combles", "label": "Isolation des combles perdus"},
    {"id": "isolation_plancher", "label": "Isolation plancher bas"},
    {"id": "menuiserie", "label": "Menuiseries extérieures (fenêtres, portes, volets)"},
    {"id": "chauffage_bois", "label": "Chauffage au bois (poêles, inserts, chaudières)"},
    {"id": "chauffage_gaz", "label": "Chaudières gaz/fioul à condensation"},
    {"id": "pac_air_eau", "label": "Pompes à chaleur air/eau"},
    {"id": "pac_eau_eau", "label": "Pompes à chaleur géothermiques (eau/eau)"},
    {"id": "pac_air_air", "label": "Pompes à chaleur air/air"},
    {"id": "chauffe_eau_thermo", "label": "Chauffe-eau thermodynamique"},
    {"id": "solaire_thermique", "label": "Capteurs solaires thermiques"},
    {"id": "solaire_combine", "label": "Systèmes solaires combinés"},
    {"id": "photovoltaique", "label": "Panneaux photovoltaïques"},
    {"id": "ventilation", "label": "Ventilation mécanique contrôlée (VMC)"},
    {"id": "audit_energetique", "label": "Audit énergétique"},
    {"id": "borne_recharge", "label": "Bornes de recharge véhicules électriques"},
]
RGE_TYPES: List[Dict[str, str]] = [{**c, "value": c["label"]} for c in RGE_CATEGORIES]
RGE_VALUES: List[str] = [c["label"] for c in RGE_CATEGORIES]
_RGE_ID_BY_LABEL: Dict[str, str] = {c["label"]: c["id"] for c in RGE_CATEGORIES}

# Correspondance domaine RGE → métier (migration et préremplissage, spécification §2.1)
_RGE_TO_TRADE_EXACT: Dict[str, str] = {
    "menuiserie": "menuiserie",
    "chauffage_bois": "plomberie-chauffage",
    "chauffage_gaz": "plomberie-chauffage",
    "chauffe_eau_thermo": "pac-clim-cvc",
    "ventilation": "pac-clim-cvc",
    "photovoltaique": "photovoltaique-enr",
    "borne_recharge": "electricite",
    "audit_energetique": "renovation-generale",
}
_RGE_TO_TRADE_PREFIXES = (
    ("isolation", "isolation"),          # isolation_*
    ("pac_", "pac-clim-cvc"),            # pac_*
    ("solaire_", "photovoltaique-enr"),  # solaire_*
)

# ----------------------------------------------------------------------------------------------
# Autres qualifications, déclaratives (aucune vérification automatique)
OTHER_QUALIFICATIONS: List[Dict[str, str]] = [
    {"id": "qualibat", "label": "Qualibat"},
    {"id": "qualifelec", "label": "Qualifelec"},
    {"id": "qualit-enr", "label": "Qualit'EnR (QualiPAC, QualiPV, Qualibois, Qualisol)"},
    {"id": "certibat", "label": "Certibat"},
    {"id": "nf-habitat", "label": "NF Habitat"},
    {"id": "handibat", "label": "Handibat"},
    {"id": "eco-artisan", "label": "ECO Artisan"},
    {"id": "irve", "label": "IRVE (bornes de recharge)"},
    {"id": "amiante-ss4", "label": "Amiante sous-section 4"},
    {"id": "cstb-etancheite", "label": "Certification CSTB étanchéité"},
]
OTHER_QUALIFICATION_IDS: List[str] = [q["id"] for q in OTHER_QUALIFICATIONS]

# ----------------------------------------------------------------------------------------------
# Régions (inchangées : mêmes libellés que les annonces existantes)
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
# Codes NAF (rév. 2). Section F = construction : divisions 41, 42, 43.
# Codes connexes tolérés (signalés à l'admin, jamais bloquants) : spécification §2.3.
NAF_BUILDING_DIVISIONS = ("41", "42", "43")
NAF_TOLERATED_PREFIXES = ("1623", "236", "2511", "2512", "7112", "8130")

NAF_LIBELLES: Dict[str, str] = {
    "4110A": "Promotion immobilière de logements",
    "4110B": "Promotion immobilière de bureaux",
    "4110C": "Promotion immobilière d'autres bâtiments",
    "4110D": "Supports juridiques de programmes",
    "4120A": "Construction de maisons individuelles",
    "4120B": "Construction d'autres bâtiments",
    "4211Z": "Construction de routes et autoroutes",
    "4212Z": "Construction de voies ferrées de surface et souterraines",
    "4213A": "Construction d'ouvrages d'art",
    "4213B": "Construction et entretien de tunnels",
    "4221Z": "Construction de réseaux pour fluides",
    "4222Z": "Construction de réseaux électriques et de télécommunications",
    "4291Z": "Construction d'ouvrages maritimes et fluviaux",
    "4299Z": "Construction d'autres ouvrages de génie civil",
    "4311Z": "Travaux de démolition",
    "4312A": "Travaux de terrassement courants et travaux préparatoires",
    "4312B": "Travaux de terrassement spécialisés ou de grande masse",
    "4313Z": "Forages et sondages",
    "4321A": "Travaux d'installation électrique dans tous locaux",
    "4321B": "Travaux d'installation électrique sur la voie publique",
    "4322A": "Travaux d'installation d'eau et de gaz en tous locaux",
    "4322B": "Travaux d'installation d'équipements thermiques et de climatisation",
    "4329A": "Travaux d'isolation",
    "4329B": "Autres travaux d'installation",
    "4331Z": "Travaux de plâtrerie",
    "4332A": "Travaux de menuiserie bois et PVC",
    "4332B": "Travaux de menuiserie métallique et serrurerie",
    "4332C": "Agencement de lieux de vente",
    "4333Z": "Travaux de revêtement des sols et des murs",
    "4334Z": "Travaux de peinture et vitrerie",
    "4339Z": "Autres travaux de finition",
    "4391A": "Travaux de charpente",
    "4391B": "Travaux de couverture par éléments",
    "4399A": "Travaux d'étanchéification",
    "4399B": "Travaux de montage de structures métalliques",
    "4399C": "Travaux de maçonnerie générale et gros œuvre de bâtiment",
    "4399D": "Autres travaux spécialisés de construction",
    "4399E": "Location avec opérateur de matériel de construction",
    # Codes connexes tolérés
    "1623Z": "Fabrication de charpentes et d'autres menuiseries",
    "2361Z": "Fabrication d'éléments en béton pour la construction",
    "2362Z": "Fabrication d'éléments en plâtre pour la construction",
    "2363Z": "Fabrication de béton prêt à l'emploi",
    "2364Z": "Fabrication de mortiers et bétons secs",
    "2365Z": "Fabrication d'ouvrages en fibre-ciment",
    "2369Z": "Fabrication d'autres ouvrages en béton, en ciment ou en plâtre",
    "2511Z": "Fabrication de structures métalliques et de parties de structures",
    "2512Z": "Fabrication de portes et fenêtres en métal",
    "7112A": "Activité des géomètres",
    "7112B": "Ingénierie, études techniques",
    "8130Z": "Services d'aménagement paysager",
}

# Métier suggéré d'après le code NAF (préremplissage de l'estimation et de l'annonce)
_NAF_TO_TRADE: Dict[str, str] = {
    "4120A": "maconnerie-gros-oeuvre", "4120B": "maconnerie-gros-oeuvre",
    "4211Z": "terrassement-vrd", "4212Z": "terrassement-vrd", "4213A": "terrassement-vrd",
    "4213B": "terrassement-vrd", "4221Z": "terrassement-vrd", "4222Z": "electricite",
    "4291Z": "terrassement-vrd", "4299Z": "terrassement-vrd",
    "4311Z": "terrassement-vrd", "4312A": "terrassement-vrd", "4312B": "terrassement-vrd",
    "4313Z": "terrassement-vrd",
    "4321A": "electricite", "4321B": "electricite",
    "4322A": "plomberie-chauffage", "4322B": "pac-clim-cvc",
    "4329A": "isolation", "4329B": "renovation-generale",
    "4331Z": "platrerie-peinture",
    "4332A": "menuiserie", "4332B": "serrurerie-metallerie", "4332C": "agencement",
    "4333Z": "carrelage-sols", "4334Z": "platrerie-peinture", "4339Z": "renovation-generale",
    "4391A": "couverture-charpente", "4391B": "couverture-charpente",
    "4399A": "etancheite", "4399B": "serrurerie-metallerie", "4399C": "maconnerie-gros-oeuvre",
    "4399D": "renovation-generale", "4399E": "terrassement-vrd",
    "1623Z": "menuiserie", "2511Z": "serrurerie-metallerie", "2512Z": "menuiserie",
    "8130Z": "piscine-paysage",
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
# Métiers
def trade_by_id(trade_id) -> Optional[Dict[str, str]]:
    return TRADES_BY_ID.get(str(trade_id or "").strip())


def trade_label(trade_id, short: bool = False) -> str:
    """Libellé d'un métier ('' si l'id est inconnu)."""
    trade = trade_by_id(trade_id)
    if not trade:
        return ""
    return trade["short"] if short else trade["label"]


def trade_slug(trade_id) -> str:
    """Les ids sont déjà des slugs : la partie d'URL /metier/<slug> est l'id lui-même."""
    trade = trade_by_id(trade_id)
    return trade["id"] if trade else ""


def trade_by_slug(slug) -> Optional[Dict[str, str]]:
    """Retrouve un métier par le slug d'URL (id, ou slug du libellé par tolérance)."""
    s = slugify(slug)
    if not s:
        return None
    return TRADES_BY_ID.get(s) or next((t for t in TRADES if slugify(t["label"]) == s), None)


def validate_trades(trades) -> List[str]:
    """
    Normalise la liste de métiers d'une annonce : ids connus, sans doublon, entre 1 et 4.
    Lève ValueError avec un message en français destiné à l'utilisateur.
    """
    if trades is None or isinstance(trades, (str, bytes)) or not isinstance(trades, Iterable):
        raise ValueError("Indiquez au moins un métier.")
    cleaned: List[str] = []
    for raw in trades:
        tid = str(raw or "").strip()
        if not tid:
            continue
        if tid not in TRADES_BY_ID:
            raise ValueError(f"Métier inconnu : {tid}")
        if tid not in cleaned:
            cleaned.append(tid)
    if len(cleaned) < MIN_TRADES:
        raise ValueError("Indiquez au moins un métier.")
    if len(cleaned) > MAX_TRADES:
        raise ValueError(f"Indiquez au plus {MAX_TRADES} métiers.")
    return cleaned


def rge_id_for(value) -> Optional[str]:
    """Id d'un domaine RGE à partir de son id ou de son libellé long (valeur stockée)."""
    v = str(value or "").strip()
    if not v:
        return None
    if v in _RGE_ID_BY_LABEL:
        return _RGE_ID_BY_LABEL[v]
    if any(c["id"] == v for c in RGE_CATEGORIES):
        return v
    # Tolérance : comparaison insensible aux accents/casse (anciennes saisies)
    s = slugify(v)
    return next((c["id"] for c in RGE_CATEGORIES if slugify(c["label"]) == s or slugify(c["id"]) == s), None)


def trade_for_rge(value) -> Optional[str]:
    """Métier correspondant à un domaine RGE (id ou libellé), None si inconnu."""
    rge_id = rge_id_for(value)
    if not rge_id:
        return None
    if rge_id in _RGE_TO_TRADE_EXACT:
        return _RGE_TO_TRADE_EXACT[rge_id]
    return next((trade for prefix, trade in _RGE_TO_TRADE_PREFIXES if rge_id.startswith(prefix)), None)


def trades_for_rge(rge_types, limit: int = MAX_TRADES) -> List[str]:
    """
    Métiers déduits d'une liste de domaines RGE (ids ou libellés), dans l'ordre d'apparition,
    sans doublon, limités à `limit` (4 par défaut : maximum par annonce). Utilisé par la migration.
    """
    out: List[str] = []
    for value in rge_types or []:
        trade = trade_for_rge(value)
        if trade and trade not in out:
            out.append(trade)
        if limit and len(out) >= limit:
            break
    return out


# ----------------------------------------------------------------------------------------------
# Autres qualifications
def other_qualification_label(qualification_id) -> str:
    """Libellé d'une qualification déclarative ('' si inconnue ; tolère les accents dans l'id)."""
    s = slugify(qualification_id)
    return next((q["label"] for q in OTHER_QUALIFICATIONS if q["id"] == s), "")


def validate_other_qualifications(values) -> List[str]:
    """Liste normalisée d'ids connus, sans doublon ; les valeurs inconnues sont ignorées."""
    out: List[str] = []
    for raw in values or []:
        s = slugify(raw)
        if s in OTHER_QUALIFICATION_IDS and s not in out:
            out.append(s)
    return out


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


# ----------------------------------------------------------------------------------------------
# NAF
def normalize_naf(naf) -> str:
    """'43.22A' / '4322a' / '43 22 A' → '4322A' ; '' si vide."""
    return re.sub(r"[^0-9A-Z]", "", str(naf or "").upper())


def naf_status(naf) -> str:
    """
    'batiment' : section F (41, 42, 43) ; 'connexe' : code toléré (16.23, 23.6, 25.11, 25.12, 71.12,
    81.30), signalé à l'admin sans bloquer ; 'hors-batiment' : autre code ; 'inconnu' : vide.
    """
    code = normalize_naf(naf)
    if not code:
        return "inconnu"
    if code[:2] in NAF_BUILDING_DIVISIONS:
        return "batiment"
    if any(code.startswith(p) for p in NAF_TOLERATED_PREFIXES):
        return "connexe"
    return "hors-batiment"


def naf_in_building(naf) -> bool:
    """Vrai pour la section F et pour les codes connexes tolérés (voir naf_status pour le détail)."""
    return naf_status(naf) in ("batiment", "connexe")


def naf_label(naf) -> str:
    """Libellé du code NAF s'il fait partie des codes connus du bâtiment, sinon ''."""
    return NAF_LIBELLES.get(normalize_naf(naf), "")


def format_naf(naf) -> str:
    """'4322A' → '43.22A' (forme usuelle) ; renvoie la valeur nettoyée si le format est inattendu."""
    code = normalize_naf(naf)
    return f"{code[:2]}.{code[2:]}" if len(code) == 5 else code


def trade_for_naf(naf) -> Optional[str]:
    """Métier suggéré d'après le code NAF, None si aucune correspondance."""
    return _NAF_TO_TRADE.get(normalize_naf(naf))


# ----------------------------------------------------------------------------------------------
# Titre d'annonce généré côté serveur (spécification §2.2), jamais le nom de l'entreprise
def listing_title(trades, region=None, staff_count=None) -> str:
    """« Entreprise de plomberie-chauffage · Bretagne · 10 salariés » (segments vides omis)."""
    trade_ids = [t for t in (trades or []) if trade_by_id(t)]
    first = trade_label(trade_ids[0], short=True) if trade_ids else ""
    # Minuscule initiale sauf pour un sigle (« PAC, climatisation » reste tel quel)
    if len(first) > 1 and first[1].islower():
        first = first[0].lower() + first[1:]
    # Élision devant une voyelle : « Entreprise d'électricité »
    elided = slugify(first[:1]) in ("a", "e", "i", "o", "u", "y") if first else False
    parts = [f"Entreprise {'d’' if elided else 'de '}{first}" if first else "Entreprise du bâtiment"]
    if region:
        parts.append(str(region))
    try:
        n = int(staff_count) if staff_count is not None and str(staff_count).strip() != "" else None
    except (TypeError, ValueError):
        n = None
    if n is not None and n >= 0:
        parts.append(f"{n} salarié{'s' if n > 1 else ''}")
    return " · ".join(parts)
