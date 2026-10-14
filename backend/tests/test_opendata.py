"""Open data (recherche-entreprises) simulé : fetch_json remplacé, cache, correspondance dirigeant, NAF"""
import asyncio
import copy

import pytest

import opendata

# Réponse réaliste de https://recherche-entreprises.api.gouv.fr/search?q=552032534 (format 2025)
SIREN = "552032534"          # clé de Luhn valide
SIRET_SIEGE = "55203253400041"
SIRET_AGENCE = "55203253400066"

RESPONSE = {
    "results": [
        {
            "siren": SIREN,
            "nom_complet": "SECRET ENERGIE",
            "nom_raison_sociale": "SECRET ENERGIE",
            "sigle": None,
            "nombre_etablissements": 2,
            "nombre_etablissements_ouverts": 2,
            "siege": {
                "activite_principale": "43.22A",
                "adresse": "12 RUE DE LA FONTAINE 29200 BREST",
                "code_postal": "29200",
                "commune": "29019",
                "departement": "29",
                "region": "53",
                "libelle_commune": "BREST",
                "siret": SIRET_SIEGE,
                "date_creation": "2010-03-15",
                "etat_administratif": "A",
                "est_siege": True,
                "tranche_effectif_salarie": "11",
            },
            "activite_principale": "43.22A",
            "categorie_entreprise": "PME",
            "date_creation": "2010-03-15",
            "date_mise_a_jour": "2025-09-01T10:00:00",
            "dirigeants": [
                {"nom": "DUPONT", "prenoms": "Paul Jean", "annee_de_naissance": "1968",
                 "qualite": "Président", "type_dirigeant": "personne physique"},
                {"nom": "DA SILVA RIBEIRO", "prenoms": "Romane", "annee_de_naissance": "1990",
                 "qualite": "Directeur général", "type_dirigeant": "personne physique"},
                {"nom": "MARTIN (DURAND)", "prenoms": "Marie-Noëlle", "annee_de_naissance": "1975",
                 "qualite": "Directeur général délégué", "type_dirigeant": "personne physique"},
            ],
            "etat_administratif": "A",
            "nature_juridique": "5710",
            "section_activite_principale": "F",
            "tranche_effectif_salarie": "11",
            "annee_tranche_effectif_salarie": "2023",
            "matching_etablissements": [
                {"activite_principale": "43.22B", "adresse": "4 AVENUE DU PORT 56100 LORIENT",
                 "code_postal": "56100", "commune": "56121", "libelle_commune": "LORIENT",
                 "siret": SIRET_AGENCE, "etat_administratif": "A", "est_siege": False},
            ],
            "complements": {"est_rge": True, "est_ess": False},
        },
        {
            # Résultat plein texte parasite : autre SIREN
            "siren": "123456782", "nom_complet": "AUTRE SOCIETE", "siege": {"departement": "75"},
            "dirigeants": [{"nom": "DUPONT", "prenoms": "Paul", "qualite": "Gérant"}],
            "etat_administratif": "C", "nature_juridique": "5499",
        },
    ],
    "total_results": 2, "page": 1, "per_page": 10, "total_pages": 1,
}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def api(monkeypatch):
    """fetch_json simulé ; `calls` liste les URL demandées ; `response` est modifiable par test"""
    state = {"calls": [], "response": copy.deepcopy(RESPONSE), "error": None}

    def fake_fetch(url):
        state["calls"].append(url)
        if state["error"]:
            raise state["error"]
        return copy.deepcopy(state["response"])

    monkeypatch.setattr(opendata, "fetch_json", fake_fetch)
    opendata.clear_cache()
    yield state
    opendata.clear_cache()


# ---------------------------------------------------------------------------------------------- lookup_siren
def test_lookup_by_siren(api):
    r = run(opendata.lookup_siren(SIREN))
    assert r["available"] is True and r["found"] is True
    assert r["siren"] == SIREN
    assert r["siret_siege"] == SIRET_SIEGE and r["siret"] == SIRET_SIEGE
    assert r["nom_complet"] == "SECRET ENERGIE"
    assert r["nature_juridique"] == "5710" and r["forme_juridique"] == "SAS" and r["legal_structure"] == "SAS"
    # Plus aucune donnée « bâtiment » (NAF, RGE) dans la fiche
    assert not any(k in r for k in ("naf", "naf_libelle", "naf_status", "naf_in_building", "trade_suggestion", "est_rge"))
    assert r["date_creation"] == "2010-03-15"
    assert r["tranche_effectif"] == "11" and r["tranche_effectif_libelle"] == "10 à 19 salariés"
    assert r["effectif_estime"] == 14
    assert r["departement"] == "29" and r["departement_libelle"] == "Finistère (29)" and r["region"] == "Bretagne"
    assert r["commune"] == "BREST" and r["code_postal"] == "29200"
    assert r["etat"] == "actif" and r["siren_active"] is True
    assert [d["nom"] for d in r["dirigeants"]] == ["DUPONT", "DA SILVA RIBEIRO", "MARTIN (DURAND)"]
    president = {"type": "personne physique", "nom": "DUPONT", "prenoms": "Paul Jean",
                 "qualite": "Président", "annee_de_naissance": "1968"}
    assert r["dirigeants"][0] == president
    # Une seule requête, sur le SIREN, vers recherche-entreprises
    assert len(api["calls"]) == 1
    assert api["calls"][0].startswith("https://recherche-entreprises.api.gouv.fr/search?q=552032534")


def test_lookup_by_siret_uses_matching_establishment(api):
    r = run(opendata.lookup_siren("552 032 534 00066"))
    assert r["found"] and r["siret"] == SIRET_AGENCE and r["siret_siege"] == SIRET_SIEGE
    # Département déduit du code postal de l'établissement (le champ `departement` n'y figure pas)
    assert r["departement"] == "56" and r["region"] == "Bretagne" and r["commune"] == "LORIENT"


def test_lookup_cache_24h(api):
    run(opendata.lookup_siren(SIREN))
    run(opendata.lookup_siren(SIRET_SIEGE))
    run(opendata.match_dirigeant(SIREN, "Paul", "Dupont"))
    assert len(api["calls"]) == 1, "le cache mémoire doit éviter les appels répétés"
    opendata.clear_cache()
    run(opendata.lookup_siren(SIREN))
    assert len(api["calls"]) == 2


def test_lookup_not_found_and_invalid(api):
    api["response"] = {"results": [], "total_results": 0}
    r = run(opendata.lookup_siren("123456782"))
    assert r["available"] is True and r["found"] is False and r["reason"] == "not_found"
    r = run(opendata.lookup_siren("12345"))
    assert r["available"] is True and r["found"] is False and r["reason"] == "invalid"
    assert api["calls"] == ["https://recherche-entreprises.api.gouv.fr/search?q=123456782&page=1&per_page=10"]


def test_lookup_ignores_other_siren_in_results(api):
    api["response"]["results"] = api["response"]["results"][1:]   # seul le SIREN parasite reste
    r = run(opendata.lookup_siren(SIREN))
    assert r["found"] is False and r["reason"] == "not_found"


def test_lookup_unavailable_never_blocks(api):
    api["error"] = ConnectionError("timeout")
    r = run(opendata.lookup_siren(SIREN))
    assert r["available"] is False and r["found"] is False and r["reason"] == "unavailable"
    assert "différée" in r["message"]
    assert r["dirigeants"] == []
    # Une panne est mémorisée brièvement (pas 24 h) : pas de nouvel appel immédiat
    run(opendata.lookup_siren(SIREN))
    assert len(api["calls"]) == 1


def test_lookup_unexpected_payload(api):
    api["response"] = {"message": "rate limited"}
    r = run(opendata.lookup_siren(SIREN))
    assert r["available"] is False and r["reason"] == "unavailable"


def test_lookup_ceased_company_and_old_pm_format(api):
    e = api["response"]["results"][0]
    e["etat_administratif"] = "C"
    e["dirigeants"] = [{"siren": "444333222", "denomination": "HOLDING SECRET", "qualite": "Président",
                        "type_dirigeant": "personne morale"}]
    e["dirigeants_pm"] = [{"siren": "111222333", "denomination": "AUTRE HOLDING", "qualite": "Directeur général"}]
    r = run(opendata.lookup_siren(SIREN))
    assert r["etat"] == "cessé" and r["siren_active"] is False
    assert [d["type"] for d in r["dirigeants"]] == ["personne morale", "personne morale"]
    assert r["dirigeants"][0]["denomination"] == "HOLDING SECRET" and r["dirigeants"][0]["siren"] == "444333222"


# ---------------------------------------------------------------------------------------------- match_dirigeant
@pytest.mark.parametrize("prenom,nom,status", [
    ("Paul", "Dupont", "match_exact"),            # premier prénom + nom
    ("Paul Jean", "DUPONT", "match_exact"),       # tous les prénoms
    ("Jean-Paul", "Dupont", "match_exact"),       # mêmes prénoms, ordre différent, tiret
    ("paul", "dûpont", "match_exact"),            # accents et casse ignorés
    ("Marie-Noëlle", "Martin", "match_exact"),    # nom d'usage
    ("Marie Noelle", "Durand", "match_exact"),    # nom de naissance entre parenthèses
    ("Romane", "Da Silva Ribeiro", "match_exact"),
    ("Romane", "Da Silva", "match_partial"),      # nom composé tronqué
    ("Romane", "Ribeiro", "match_partial"),
    ("Pauline", "Dupont", "match_partial"),       # nom exact, prénom proche (3 premières lettres)
    ("Jean", "Dupont", "match_partial"),          # second prénom seulement
    ("Marie", "Martin", "match_exact"),           # premier prénom d'un prénom composé (comme « Paul » / « Paul Jean »)
    ("Noëlle", "Martin", "match_partial"),        # second élément du prénom composé
    ("Romane", "Silva", "match_partial"),         # segment du nom composé (particule ignorée)
    ("Jacques", "Dupont", "no_match"),            # nom exact, prénom différent
    ("Paul", "Durand", "no_match"),               # prénom exact, nom d'une autre personne
    ("Paul", "Dupond", "no_match"),               # une lettre de différence : pas de correspondance
    ("Romane", "Da", "no_match"),                 # particule seule : trop court pour une sous-chaîne
])
def test_match_dirigeant_statuses(api, prenom, nom, status):
    r = run(opendata.match_dirigeant(SIREN, prenom, nom))
    assert r["status"] == status, r
    assert r["verified"] is (status in ("match_exact", "match_partial"))
    assert r["source"] == "recherche-entreprises"
    assert r["company"]["nom_complet"] == "SECRET ENERGIE"
    if status != "no_match":
        assert r["dirigeant"]["type"] == "personne physique"
        assert r["matched_as"]
    else:
        assert r["dirigeant"] is None and r["reason"] == "name_mismatch"


def test_match_dirigeant_exact_wins_over_partial(api):
    # « Paul Dupont » correspond exactement au président, pas seulement partiellement à un autre
    r = run(opendata.match_dirigeant(SIREN, "Paul", "Dupont"))
    assert r["status"] == "match_exact" and r["dirigeant"]["qualite"] == "Président"
    assert r["matched_as"] == "Président"


def test_match_dirigeant_unavailable(api):
    api["error"] = TimeoutError("délai dépassé")
    r = run(opendata.match_dirigeant(SIREN, "Paul", "Dupont"))
    assert r["status"] == "unavailable" and r["verified"] is False and r["reason"] == "api_unavailable"


def test_match_dirigeant_company_not_found(api):
    api["response"] = {"results": []}
    r = run(opendata.match_dirigeant(SIREN, "Paul", "Dupont"))
    assert r["status"] == "unavailable" and r["reason"] == "company_not_found"


def test_match_dirigeant_invalid_inputs(api):
    r = run(opendata.match_dirigeant("12", "Paul", "Dupont"))
    assert r["status"] == "unavailable" and r["reason"] == "invalid_siren"
    r = run(opendata.match_dirigeant(SIREN, "Paul", ""))
    assert r["status"] == "unavailable" and r["reason"] == "missing_identity"
    assert api["calls"] == []


def test_match_dirigeant_personne_morale_only(api):
    api["response"]["results"][0]["dirigeants"] = [
        {"siren": "444333222", "denomination": "HOLDING SECRET", "qualite": "Président",
         "type_dirigeant": "personne morale"}]
    r = run(opendata.match_dirigeant(SIREN, "Paul", "Dupont"))
    assert r["status"] == "unavailable" and r["reason"] == "personne_morale" and r["has_personne_morale"] is True
    assert "holding" in r["message"].lower()


def test_match_dirigeant_no_dirigeants_data(api):
    api["response"]["results"][0]["dirigeants"] = []
    r = run(opendata.match_dirigeant(SIREN, "Paul", "Dupont"))
    assert r["status"] == "unavailable" and r["reason"] == "no_dirigeants_data"


def test_match_dirigeant_entrepreneur_individuel(api):
    e = api["response"]["results"][0]
    e["dirigeants"] = []
    e["nature_juridique"] = "1000"
    e["nom_complet"] = "PAUL DUPONT"
    assert run(opendata.match_dirigeant(SIREN, "Paul", "Dupont"))["status"] == "match_exact"
    e["nom_complet"] = "DUPONT PAUL"     # ordre inverse parfois utilisé par le registre
    opendata.clear_cache()
    assert run(opendata.match_dirigeant(SIREN, "Paul", "Dupont"))["status"] == "match_exact"
    opendata.clear_cache()
    assert run(opendata.match_dirigeant(SIREN, "Jacques", "Dupont"))["status"] == "no_match"


def test_match_in_list_reusable_for_inpi_fallback():
    """Même règle de comparaison pour une liste venue d'une autre source (INPI en second choix)"""
    inpi = [{"nom": "Dupont", "prenom": "Paul", "qualite": "Président"},
            {"denomination": "HOLDING", "qualite": "Directeur général"}]
    assert opendata.match_in_list(inpi, "Paul", "DUPONT") == ("match_exact", inpi[0])
    assert opendata.match_in_list(inpi, "Pauline", "Dupont") == ("match_partial", inpi[0])
    assert opendata.match_in_list(inpi, "Jacques", "Dupont") == ("no_match", None)
    assert opendata.match_in_list([], "Paul", "Dupont") == ("no_match", None)
    assert opendata.match_in_list(None, "Paul", "Dupont") == ("no_match", None)


# ---------------------------------------------------------------------------------------------- périmètre du module
def test_module_keeps_only_company_checks():
    """SPEC §6.4 : opendata ne garde que lookup_siren, match_dirigeant et l'utilitaire de requête"""
    for name in ("lookup_siren", "match_dirigeant", "fetch_json", "fetch_json_cached"):
        assert callable(getattr(opendata, name))
    for name in ("naf_in_building", "naf_status", "department_from_siret", "property_checks_from"):
        assert not hasattr(opendata, name), name


# ---------------------------------------------------------------------------------------------- identifiants, noms
def test_siren_siret_validation():
    assert opendata.validate_siren("552 032 534") == "552032534"
    assert opendata.validate_siren("552032535") is None          # clé de Luhn fausse
    assert opendata.validate_siren("12345") is None
    assert opendata.validate_siret("552 032 534 00042") == "55203253400042"
    assert opendata.validate_siret("55203253400041") is None          # clé de Luhn fausse
    assert opendata.validate_siret("35600000009075") == "35600000009075"   # La Poste : somme des chiffres multiple de 5
    assert opendata.validate_siret("35600000009076") is None
    assert opendata.split_identifier("552032534") == ("552032534", "")
    assert opendata.split_identifier("55203253400041") == ("552032534", "55203253400041")
    assert opendata.split_identifier("") == ("", "")


def test_normalize_name():
    assert opendata.normalize_name("  Jean-Noël  D'ARTAGNAN ") == "jean noel d artagnan"
    assert opendata.normalize_name("Lœuvre") == "loeuvre"
    assert opendata.normalize_name(None) == ""


def test_fetch_json_runs_in_thread(api):
    """fetch_json est synchrone : la version async ne bloque pas la boucle (to_thread)"""
    import threading
    seen = {}

    def fake(url):
        seen["thread"] = threading.current_thread().name
        return copy.deepcopy(RESPONSE)

    opendata.fetch_json = fake
    opendata.clear_cache()
    run(opendata.lookup_siren(SIREN))
    assert seen["thread"] != threading.main_thread().name
