"""
Open data gratuit, sans clé : recherche-entreprises.api.gouv.fr (INSEE + RNE/INPI).

- lookup_siren(siren_ou_siret) : identité de l'entreprise (nom, NAF, création, effectif, département,
  état, dirigeants), cache mémoire 24 h. Jamais bloquant : en cas d'erreur réseau le résultat porte
  `available: False` et l'utilisateur continue (« vérification différée »).
- match_dirigeant(siren, prenom, nom) : compare l'identité du vendeur aux dirigeants du RNE
  (noms normalisés sans accents) → match_exact | match_partial | no_match | unavailable.
- naf_in_building(naf) : section F (41/42/43) + codes connexes tolérés (voir taxonomy).
- department_from_siret(siret) : département de l'établissement (ou du siège).

Tous les appels HTTP passent par `fetch_json(url)` (fonction module-level, `requests`, timeout 8 s),
exécutée dans `asyncio.to_thread` : les tests la remplacent par une fonction qui renvoie un JSON.

Le BODACC n'est pas ici : il est dans veille.py.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests

import taxonomy
from taxonomy import naf_in_building, naf_status  # noqa: F401  (ré-exportés : API du module)

logger = logging.getLogger("opendata")

RECHERCHE_ENTREPRISES_URL = "https://recherche-entreprises.api.gouv.fr/search"
TIMEOUT_SECONDS = 8
CACHE_TTL_SECONDS = 24 * 3600
# Une panne n'est pas mémorisée 24 h : on réessaie au bout de 2 minutes
ERROR_TTL_SECONDS = 120
SOURCE = "recherche-entreprises"

# Tranches d'effectif INSEE : code → (libellé, effectif estimé)
TRANCHES_EFFECTIF: Dict[str, tuple] = {
    "NN": ("Sans salarié", 0), "00": ("0 salarié", 0), "01": ("1 à 2 salariés", 2),
    "02": ("3 à 5 salariés", 4), "03": ("6 à 9 salariés", 7), "11": ("10 à 19 salariés", 14),
    "12": ("20 à 49 salariés", 30), "21": ("50 à 99 salariés", 70), "22": ("100 à 199 salariés", 140),
    "31": ("200 à 249 salariés", 220), "32": ("250 à 499 salariés", 350), "41": ("500 à 999 salariés", 700),
    "42": ("1 000 à 1 999 salariés", 1400), "51": ("2 000 à 4 999 salariés", 3000),
    "52": ("5 000 à 9 999 salariés", 7000), "53": ("10 000 salariés et plus", 10000),
}

# Catégories juridiques INSEE (niveau 3) les plus courantes dans le bâtiment : code → (libellé, valeur
# du champ `legal_structure` de l'annonce)
NATURES_JURIDIQUES: Dict[str, tuple] = {
    "1000": ("Entrepreneur individuel", "EI"),
    "5202": ("Société en nom collectif", "SNC"),
    "5410": ("SARL nationale", "SARL"),
    "5453": ("SARL coopérative artisanale", "SARL"),
    "5458": ("SARL coopérative ouvrière de production (SCOP)", "SARL"),
    "5498": ("EURL (SARL unipersonnelle)", "EURL"),
    "5499": ("SARL", "SARL"),
    "5505": ("SA à conseil d'administration", "SA"),
    "5510": ("SA nationale à conseil d'administration", "SA"),
    "5599": ("SA à conseil d'administration", "SA"),
    "5605": ("SA à directoire", "SA"),
    "5699": ("SA à directoire", "SA"),
    "5710": ("SAS", "SAS"),
    "5720": ("SASU", "SASU"),
    "5785": ("Société d'exercice libéral par actions simplifiée", "SAS"),
    "5800": ("Société européenne", "SA"),
    "6540": ("SCI", "SCI"),
    "6599": ("Société civile", "SC"),
    "9220": ("Association déclarée", "Association"),
}
_NATURE_PREFIXES = (
    ("1", ("Entrepreneur individuel", "EI")), ("54", ("SARL", "SARL")), ("55", ("SA", "SA")),
    ("56", ("SA", "SA")), ("57", ("SAS", "SAS")), ("65", ("Société civile", "SC")),
    ("92", ("Association", "Association")),
)

# ----------------------------------------------------------------------------------------------
# HTTP + cache


def _user_agent() -> str:
    site = os.environ.get("SITE_URL", "https://cessionbatiment.fr").strip()
    return f"cession-plateforme/1.0 (+{site})"


def fetch_json(url: str) -> Any:
    """
    Appel HTTP synchrone (toujours lancé dans un thread par les fonctions async de ce module).
    Lève une exception en cas d'erreur réseau ou de statut HTTP ≠ 2xx. Remplacée dans les tests.
    """
    response = requests.get(url, timeout=TIMEOUT_SECONDS,
                            headers={"Accept": "application/json", "User-Agent": _user_agent()})
    response.raise_for_status()
    return response.json()


_cache: Dict[str, tuple] = {}
_cache_lock = threading.Lock()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


class OpenDataUnavailable(Exception):
    """L'API n'a pas répondu (réseau, délai, statut 5xx…)."""


def _cached_fetch_sync(url: str) -> Any:
    now = time.monotonic()
    with _cache_lock:
        entry = _cache.get(url)
    if entry and entry[0] > now:
        if entry[1] == "error":
            raise OpenDataUnavailable(entry[2])
        return entry[1]
    try:
        data = fetch_json(url)
    except Exception as e:  # réseau, délai, HTTP, JSON invalide
        logger.warning("Open data indisponible (%s) : %s", url, e)
        with _cache_lock:
            _cache[url] = (now + ERROR_TTL_SECONDS, "error", str(e))
        raise OpenDataUnavailable(str(e)) from e
    with _cache_lock:
        _cache[url] = (now + CACHE_TTL_SECONDS, data)
    return data


async def fetch_json_cached(url: str) -> Any:
    """Variante async avec cache mémoire 24 h ; lève OpenDataUnavailable en cas d'échec."""
    return await asyncio.to_thread(_cached_fetch_sync, url)


# ----------------------------------------------------------------------------------------------
# Identifiants


def _digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def luhn_ok(number: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(number)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def validate_siren(value) -> Optional[str]:
    """SIREN nettoyé (9 chiffres, clé de Luhn valide) ou None."""
    s = _digits(value)
    return s if len(s) == 9 and luhn_ok(s) else None


def validate_siret(value) -> Optional[str]:
    """SIRET nettoyé (14 chiffres, clé de Luhn valide ; cas particulier de La Poste) ou None."""
    s = _digits(value)
    if len(s) != 14:
        return None
    if s.startswith("356000000"):
        # Établissements de La Poste : la somme simple des chiffres est un multiple de 5
        return s if sum(int(c) for c in s) % 5 == 0 else None
    return s if luhn_ok(s) else None


def split_identifier(value) -> tuple:
    """(siren, siret) à partir d'un SIREN ou d'un SIRET (espaces tolérés) ; ('', '') si invalide."""
    s = _digits(value)
    if len(s) == 14:
        return s[:9], s
    if len(s) == 9:
        return s, ""
    return "", ""


# ----------------------------------------------------------------------------------------------
# Normalisation des noms


def normalize_name(value) -> str:
    """Minuscules, sans accents, tirets et apostrophes remplacés par des espaces, espaces réduits."""
    s = unicodedata.normalize("NFD", str(value or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("œ", "oe").replace("æ", "ae")
    s = re.sub(r"[-'’.,]", " ", s)
    return " ".join(s.split())


_PARTICLES = {"de", "du", "des", "le", "la", "les", "d", "l", "von", "van", "da", "di", "del", "della"}


def _lastname_variants(raw) -> List[str]:
    """
    « MARTIN (DURAND) » → ['martin', 'durand'] (nom d'usage et nom de naissance) ; les particules
    seules ne sont pas des variantes.
    """
    text = str(raw or "")
    parts = re.findall(r"\(([^)]*)\)", text)
    main = re.sub(r"\([^)]*\)", " ", text)
    out = []
    for p in [main] + parts:
        n = normalize_name(p)
        if n and n not in out:
            out.append(n)
    return out


def _first_tokens(raw) -> List[str]:
    return [t for t in normalize_name(raw).split() if t]


def _compare_person(user_first: str, user_last: str, api_first: str, api_last_raw: str) -> Optional[str]:
    """'match_exact', 'match_partial' ou None pour un dirigeant donné."""
    u_last = normalize_name(user_last)
    if not u_last:
        return None
    variants = _lastname_variants(api_last_raw)
    if not variants:
        return None
    last_exact = u_last in variants
    u_last_core = " ".join(t for t in u_last.split() if t not in _PARTICLES) or u_last
    last_partial = False
    if not last_exact:
        for v in variants:
            v_core = " ".join(t for t in v.split() if t not in _PARTICLES) or v
            if len(u_last_core) >= 3 and len(v_core) >= 3 and (u_last_core in v_core or v_core in u_last_core):
                last_partial = True
                break
    if not last_exact and not last_partial:
        return None

    u_first = _first_tokens(user_first)
    a_first = _first_tokens(api_first)
    if not a_first:
        # Le registre ne donne pas de prénom : on ne peut pas aller plus loin qu'une correspondance partielle
        return "match_partial" if (last_exact and u_first) else None
    if not u_first:
        return "match_partial" if last_exact else None
    first_exact = u_first[0] == a_first[0] or set(u_first) == set(a_first) or \
        (len(u_first) > 1 and u_first[0] in a_first)
    first_partial = (not first_exact) and (
        bool(set(u_first) & set(a_first)) or (len(u_first[0]) >= 3 and u_first[0][:3] == a_first[0][:3])
    )
    if last_exact and first_exact:
        return "match_exact"
    if (last_exact and first_partial) or (last_partial and first_exact):
        return "match_partial"
    return None


def _best_match(candidates, prenom, nom) -> tuple:
    """Meilleur résultat parmi [(dirigeant, prenoms, nom)] : exact > partiel > rien."""
    best, best_dirigeant = None, None
    for dirigeant, api_first, api_last in candidates:
        result = _compare_person(prenom, nom, api_first, api_last)
        if result == "match_exact":
            return result, dirigeant
        if result == "match_partial" and best is None:
            best, best_dirigeant = result, dirigeant
    return best, best_dirigeant


def match_in_list(dirigeants, prenom, nom) -> tuple:
    """
    Compare « prénom nom » à une liste de dirigeants déjà normalisés ({nom, prenoms, …}, personnes
    physiques ; les autres entrées sont ignorées). Renvoie (status, dirigeant) avec status ∈
    match_exact | match_partial | no_match. Sert aussi au second choix INPI (même règle de comparaison).
    """
    candidates = [(d, d.get("prenoms") or d.get("prenom") or "", d.get("nom") or "")
                  for d in dirigeants or [] if isinstance(d, dict) and d.get("nom")]
    status, dirigeant = _best_match(candidates, prenom, nom)
    return (status or "no_match"), dirigeant


# ----------------------------------------------------------------------------------------------
# Lecture du résultat recherche-entreprises


def _tranche_effectif(code) -> tuple:
    c = str(code or "").strip().upper()
    label, estimate = TRANCHES_EFFECTIF.get(c, ("", None))
    return c, label, estimate


def _nature_juridique(code) -> tuple:
    c = str(code or "").strip()
    if c in NATURES_JURIDIQUES:
        return NATURES_JURIDIQUES[c]
    for prefix, value in _NATURE_PREFIXES:
        if c.startswith(prefix):
            return value
    return ("", "")


def _etat(code) -> str:
    c = str(code or "").strip().upper()
    if c == "A":
        return "actif"
    if c == "C":
        return "cessé"
    return "inconnu"


def _dirigeants(entreprise: dict) -> List[Dict[str, Any]]:
    """Dirigeants (personnes physiques et morales) dans un format homogène."""
    out: List[Dict[str, Any]] = []
    for d in entreprise.get("dirigeants") or []:
        if not isinstance(d, dict):
            continue
        is_pm = (d.get("type_dirigeant") or "").lower().startswith("personne morale") or \
            (not d.get("nom") and d.get("denomination"))
        if is_pm:
            out.append({
                "type": "personne morale",
                "denomination": (d.get("denomination") or "").strip(),
                "siren": _digits(d.get("siren")),
                "qualite": (d.get("qualite") or "").strip(),
                "nom": "", "prenoms": "",
            })
        else:
            out.append({
                "type": "personne physique",
                "nom": (d.get("nom") or "").strip(),
                "prenoms": (d.get("prenoms") or d.get("prenom") or "").strip(),
                "qualite": (d.get("qualite") or "").strip(),
                "annee_de_naissance": d.get("annee_de_naissance"),
            })
    for d in entreprise.get("dirigeants_pm") or []:  # ancien format de l'API
        if isinstance(d, dict):
            out.append({
                "type": "personne morale",
                "denomination": (d.get("denomination") or "").strip(),
                "siren": _digits(d.get("siren")),
                "qualite": (d.get("qualite") or "").strip(),
                "nom": "", "prenoms": "",
            })
    return out


def _pick_etablissement(entreprise: dict, siret: str) -> dict:
    """Établissement demandé (dans matching_etablissements) ou siège."""
    siege = entreprise.get("siege") or {}
    if siret:
        for etab in entreprise.get("matching_etablissements") or []:
            if isinstance(etab, dict) and _digits(etab.get("siret")) == siret:
                return etab
        if _digits(siege.get("siret")) == siret:
            return siege
    return siege


def _departement(etab: dict, siege: dict) -> str:
    for source in (etab, siege):
        code = taxonomy.normalize_departement(source.get("departement"))
        if code:
            return code
        code = taxonomy.departement_from_postal_code(source.get("code_postal"))
        if code:
            return code
    return ""


def parse_entreprise(entreprise: dict, siret: str = "") -> Dict[str, Any]:
    """Transforme un résultat brut de recherche-entreprises en fiche normalisée (voir lookup_siren)."""
    siege = entreprise.get("siege") or {}
    etab = _pick_etablissement(entreprise, siret)
    naf_raw = etab.get("activite_principale") or entreprise.get("activite_principale") or ""
    naf = taxonomy.format_naf(naf_raw)
    tranche_code, tranche_label, effectif = _tranche_effectif(
        entreprise.get("tranche_effectif_salarie") or siege.get("tranche_effectif_salarie"))
    nature_code = str(entreprise.get("nature_juridique") or "").strip()
    forme_label, legal_structure = _nature_juridique(nature_code)
    departement = _departement(etab, siege)
    etat = _etat(entreprise.get("etat_administratif") or siege.get("etat_administratif"))
    complements = entreprise.get("complements") or {}
    return {
        "available": True,
        "found": True,
        "source": SOURCE,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "siren": _digits(entreprise.get("siren")),
        "siret": _digits(etab.get("siret")) or _digits(siege.get("siret")),
        "siret_siege": _digits(siege.get("siret")),
        "nom_complet": (entreprise.get("nom_complet") or entreprise.get("nom_raison_sociale") or "").strip(),
        "nom_raison_sociale": (entreprise.get("nom_raison_sociale") or "").strip(),
        "sigle": (entreprise.get("sigle") or "").strip(),
        "nature_juridique": nature_code,
        "forme_juridique": forme_label,
        "legal_structure": legal_structure,
        "naf": naf,
        "naf_libelle": taxonomy.naf_label(naf),
        "naf_status": taxonomy.naf_status(naf),
        "naf_in_building": taxonomy.naf_in_building(naf),
        "trade_suggestion": taxonomy.trade_for_naf(naf),
        "date_creation": entreprise.get("date_creation") or siege.get("date_creation") or "",
        "tranche_effectif": tranche_code,
        "tranche_effectif_libelle": tranche_label,
        "effectif_estime": effectif,
        "departement": departement,
        "departement_libelle": taxonomy.departement_label(departement),
        "region": taxonomy.region_for_departement(departement),
        "code_postal": str(etab.get("code_postal") or siege.get("code_postal") or ""),
        "commune": (etab.get("libelle_commune") or siege.get("libelle_commune") or "").strip(),
        "adresse": (etab.get("adresse") or siege.get("adresse") or "").strip(),
        "etat": etat,
        "siren_active": etat == "actif",
        "est_rge": complements.get("est_rge") if isinstance(complements, dict) else None,
        "dirigeants": _dirigeants(entreprise),
    }


def _unavailable(siren: str, siret: str, reason: str, message: str) -> Dict[str, Any]:
    return {"available": False, "found": False, "source": SOURCE, "siren": siren, "siret": siret,
            "reason": reason, "message": message, "dirigeants": []}


async def lookup_siren(siren_or_siret) -> Dict[str, Any]:
    """
    Fiche d'identité d'une entreprise d'après son SIREN ou son SIRET (recherche-entreprises).
    Résultat :
      - trouvée : {available: True, found: True, siren, siret, siret_siege, nom_complet, nature_juridique,
        forme_juridique, legal_structure, naf, naf_libelle, naf_status, naf_in_building, trade_suggestion,
        date_creation, tranche_effectif, tranche_effectif_libelle, effectif_estime, departement,
        departement_libelle, region, code_postal, commune, adresse, etat (actif/cessé), siren_active,
        est_rge, dirigeants: [{type, nom, prenoms, qualite} | {type, denomination, siren, qualite}]}
      - inconnue : {available: True, found: False, reason: 'not_found'}
      - identifiant invalide : {available: True, found: False, reason: 'invalid'}
      - API injoignable : {available: False, found: False, reason: 'unavailable'} (vérification différée)
    """
    siren, siret = split_identifier(siren_or_siret)
    if not siren:
        return {"available": True, "found": False, "source": SOURCE, "siren": "", "siret": "", "reason": "invalid",
                "message": "SIREN (9 chiffres) ou SIRET (14 chiffres) attendu", "dirigeants": []}
    url = f"{RECHERCHE_ENTREPRISES_URL}?q={quote(siren)}&page=1&per_page=10"
    try:
        data = await fetch_json_cached(url)
    except OpenDataUnavailable as e:
        return _unavailable(siren, siret, "unavailable",
                            f"Base des entreprises momentanément indisponible, vérification différée ({e})")
    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        # Réponse 200 inexploitable : on ne la garde pas 24 h en cache
        with _cache_lock:
            _cache.pop(url, None)
        return _unavailable(siren, siret, "unavailable", "Réponse inattendue de la base des entreprises")
    # La recherche est plein texte : ne garder que l'entreprise portant exactement ce SIREN
    entreprise = next((r for r in results if isinstance(r, dict) and _digits(r.get("siren")) == siren), None)
    if not entreprise:
        return {"available": True, "found": False, "source": SOURCE, "siren": siren, "siret": siret,
                "reason": "not_found", "message": "Aucune entreprise ne porte ce SIREN", "dirigeants": []}
    return parse_entreprise(entreprise, siret)


async def match_dirigeant(siren, prenom, nom) -> Dict[str, Any]:
    """
    Compare « prénom nom » aux dirigeants du RNE (via recherche-entreprises).
    Résultat : {status: match_exact | match_partial | no_match | unavailable, verified (exact ou partiel),
    reason, message, dirigeant (celui qui correspond), dirigeants (liste), has_personne_morale, company}.
    Ce n'est pas une condition de publication : badge et motif de post-modération (spécification §2.3).
    """
    siren_clean, _ = split_identifier(siren)
    base = {"status": "unavailable", "verified": False, "dirigeant": None, "dirigeants": [],
            "has_personne_morale": False, "company": None, "source": SOURCE}
    if not siren_clean:
        return {**base, "reason": "invalid_siren", "message": "SIREN invalide (9 chiffres requis)"}
    if not normalize_name(nom):
        return {**base, "reason": "missing_identity",
                "message": "Nom non renseigné : complétez votre identité avant la vérification"}
    company = await lookup_siren(siren_clean)
    summary = {k: company.get(k) for k in ("siren", "nom_complet", "forme_juridique", "etat", "departement")}
    if not company.get("available"):
        return {**base, "company": summary, "reason": "api_unavailable",
                "message": "Base des entreprises momentanément indisponible : vérification différée"}
    if not company.get("found"):
        return {**base, "company": None, "reason": "company_not_found",
                "message": "Aucune entreprise ne porte ce SIREN"}

    dirigeants = company.get("dirigeants") or []
    physiques = [d for d in dirigeants if d.get("type") == "personne physique"]
    has_pm = any(d.get("type") == "personne morale" for d in dirigeants)
    base.update({"company": summary, "dirigeants": dirigeants, "has_personne_morale": has_pm})

    candidates = [(d, d.get("prenoms", ""), d.get("nom", "")) for d in physiques]
    if not candidates and company.get("legal_structure") == "EI" and company.get("nom_complet"):
        # Entrepreneur individuel : le nom de l'entreprise est celui de la personne (« PAUL DUPONT »)
        tokens = company["nom_complet"].split()
        candidates = [({"type": "personne physique", "nom": " ".join(tokens[1:]) or tokens[0],
                        "prenoms": tokens[0] if len(tokens) > 1 else "", "qualite": "Entrepreneur individuel"},
                       tokens[0] if len(tokens) > 1 else "", " ".join(tokens[1:]) or tokens[0])]
        if len(tokens) > 1:
            # Le RNE écrit parfois « NOM PRENOM » : on teste aussi l'ordre inverse
            candidates.append(({"type": "personne physique", "nom": tokens[0], "prenoms": " ".join(tokens[1:]),
                                "qualite": "Entrepreneur individuel"}, " ".join(tokens[1:]), tokens[0]))
    if not candidates:
        reason = "personne_morale" if has_pm else "no_dirigeants_data"
        message = ("La société est dirigée par une personne morale (holding) : vérification manuelle"
                   if has_pm else "Le registre ne mentionne aucun dirigeant pour cette société")
        return {**base, "status": "unavailable", "reason": reason, "message": message}

    best, best_dirigeant = _best_match(candidates, prenom, nom)
    if best == "match_exact":
        return {**base, "status": "match_exact", "verified": True, "dirigeant": best_dirigeant, "reason": None,
                "message": "Dirigeant confirmé par le registre national des entreprises",
                "matched_as": best_dirigeant.get("qualite") or "Dirigeant"}
    if best == "match_partial":
        return {**base, "status": "match_partial", "verified": True, "dirigeant": best_dirigeant, "reason": None,
                "message": "Dirigeant confirmé (correspondance partielle du nom)",
                "matched_as": best_dirigeant.get("qualite") or "Dirigeant"}
    return {**base, "status": "no_match", "reason": "name_mismatch",
            "message": "Vous n'apparaissez pas comme dirigeant de cette société au registre national"}


async def department_from_siret(siret) -> Optional[str]:
    """Code département de l'établissement (ou du siège si l'établissement est inconnu) ; None si indisponible."""
    siren, _ = split_identifier(siret)
    if not siren:
        return None
    company = await lookup_siren(siret)
    if not company.get("found"):
        return None
    return company.get("departement") or None


def company_checks_from(company: Dict[str, Any], dirigeant: Optional[Dict[str, Any]] = None,
                        in_ademe_list: Optional[bool] = None, duplicate_siren: bool = False) -> Dict[str, Any]:
    """
    Drapeaux `company_checks` d'une annonce (spécification §2.2) à partir d'un résultat de lookup_siren
    et de match_dirigeant. `None` signifie « non vérifié » (open data indisponible).
    """
    available = bool(company and company.get("available"))
    found = bool(company and company.get("found"))
    return {
        "opendata_available": available,
        "siren_active": bool(company.get("siren_active")) if found else None,
        "naf_code": company.get("naf") if found else None,
        "naf_status": company.get("naf_status") if found else None,
        "naf_in_building": bool(company.get("naf_in_building")) if found else None,
        "in_ademe_list": in_ademe_list,
        "dirigeant_match": (dirigeant or {}).get("status") or "unavailable",
        "duplicate_siren": bool(duplicate_siren),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
