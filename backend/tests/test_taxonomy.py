"""Référentiels VenteLoc : identité back/front (biens loués, régions, départements), calculs partagés, slugs"""
import os
import re

import pytest

import taxonomy

FRONT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "frontend", "src", "lib",
                          "referentiels.js")


def _js_string(raw):
    """Valeur d'une chaîne JS à guillemets simples (seule l'apostrophe est échappée dans le fichier)."""
    return raw.replace("\\'", "'")


def _js_block(source, name):
    m = re.search(r"export const " + name + r" = (\[|\{)(.*?)^(\]|\});", source, re.S | re.M)
    assert m, f"{name} introuvable dans referentiels.js"
    return m.group(2)


@pytest.fixture(scope="module")
def front():
    if not os.path.exists(FRONT_FILE):
        pytest.skip("frontend/src/lib/referentiels.js absent")
    with open(FRONT_FILE, encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------------------------------------- identité front
def _js_objects(block):
    """Objets JS { clé: 'valeur', … } d'un tableau → liste de dict (seulement les valeurs chaînes)"""
    rows = []
    for obj in re.findall(r"\{([^{}]*)\}", block):
        rows.append({k: _js_string(v) for k, v in re.findall(r"(\w+): '((?:\\'|[^'])*)'", obj)})
    return rows


VENTELOC_TABLES = ("PROPERTY_TYPES", "LEASE_TYPES", "DPE_CLASSES", "TENANT_PAYMENT_STATUSES", "OWNER_TYPES", "SALE_OBJECTS",
                   "SALE_REASONS", "BUYER_PROJECT_TYPES", "FINANCING_TYPES")


@pytest.mark.parametrize("name", VENTELOC_TABLES)
def test_venteloc_tables_identical_to_front(front, name):
    """Même ordre, mêmes ids, mêmes libellés (et mêmes attributs short, category, regime) des deux côtés"""
    rows = _js_objects(_js_block(front, name))
    assert rows == [dict(row) for row in getattr(taxonomy, name)], name


def test_dpe_rental_ban_identical_to_front(front):
    block = _js_block(front, "DPE_RENTAL_BAN")
    assert dict(re.findall(r"(\w): '(\d{4}-\d{2}-\d{2})'", block)) == taxonomy.DPE_RENTAL_BAN


def test_front_exposes_shared_helpers(front):
    for name in ("propertyTypeLabel", "leaseTypeLabel", "isHousingLease", "dpeRentalStatus", "grossYield", "netYield",
                 "propertyTitle"):
        assert f"export const {name} =" in front, name
    # Même table de titres (début du titre et accord de « loué »)
    block = re.search(r"const PROPERTY_TITLE_HEADS = \{(.*?)\};", front, re.S).group(1)
    heads = {k.strip("'"): (a, b) for k, a, b in re.findall(r"('?[\w-]+'?): \['([^']*)', '([^']*)'\]", block)}
    assert heads == taxonomy.PROPERTY_TITLE_HEADS


def test_regions_identical_to_front(front):
    block = _js_block(front, "REGIONS")
    rows = [_js_string(r) for r in re.findall(r"'((?:\\'|[^'])*)'", block)]
    assert rows == taxonomy.REGIONS


def test_departements_identical_to_front(front):
    block = _js_block(front, "DEPARTEMENTS")
    rows = re.findall(r"'([0-9AB]{2,3})': '((?:\\'|[^'])*)'", block)
    assert [(r[0], _js_string(r[1])) for r in rows] == list(taxonomy.DEPARTEMENTS.items())


def test_front_paths_and_slug_rules(front):
    # La page des annonces est « / »
    assert "export const SEARCH_PATH = '/';" in front
    # Même traitement des ligatures dans les deux slugify
    assert ".replace(/œ/g, 'oe')" in front


def test_building_tables_removed_from_backend():
    for name in ("TRADES", "RGE_CATEGORIES", "RGE_TYPES", "OTHER_QUALIFICATIONS", "NAF_LIBELLES", "listing_title", "trades_for_rge",
                 "naf_in_building", "MIN_TRADES"):
        assert not hasattr(taxonomy, name), name


# ---------------------------------------------------------------------------------------------- biens loués
def test_ids_are_stable():
    assert taxonomy.PROPERTY_TYPE_IDS == ["appartement", "maison", "immeuble", "residence-geree", "local-commercial", "bureaux",
                                          "parking", "autre"]
    assert "habitation-vide" in taxonomy.LEASE_TYPE_IDS and "commercial" in taxonomy.LEASE_TYPE_IDS
    assert taxonomy.SALE_OBJECT_IDS == ["bien", "parts", "indifferent"]
    assert taxonomy.DPE_CLASS_IDS[-2:] == ["vierge", "non-soumis"]


def test_labels_and_housing_lease():
    assert taxonomy.property_type_label("immeuble") == "Immeuble de rapport"
    assert taxonomy.property_type_label("immeuble", short=True) == "Immeuble"
    assert taxonomy.lease_type_label("commercial", short=True) == "Bail commercial"
    assert taxonomy.property_type_label("inconnu") == ""
    assert taxonomy.is_housing_lease("habitation-meublee") is True
    assert taxonomy.is_housing_lease("commercial") is False
    assert taxonomy.is_housing_lease(None) is False


def test_dpe_rental_status_calendar():
    assert taxonomy.dpe_rental_status("G", "habitation-vide", today="2026-10-14") == {"status": "interdit", "date": "2025-01-01"}
    assert taxonomy.dpe_rental_status("f", "habitation-vide", today="2026-10-14") == {"status": "echeance", "date": "2028-01-01"}
    assert taxonomy.dpe_rental_status("F", "colocation", today="2028-01-01")["status"] == "interdit"
    assert taxonomy.dpe_rental_status("E", "habitation-vide", today="2026-10-14") == {"status": "echeance", "date": "2034-01-01"}
    assert taxonomy.dpe_rental_status("C", "habitation-vide") == {"status": "ok", "date": None}
    assert taxonomy.dpe_rental_status("G", "commercial") == {"status": "non-applicable", "date": None}


def test_yields():
    assert taxonomy.gross_yield(800, 200000) == 4.8
    assert taxonomy.net_yield(800, 200000, 900, 400) == 4.15
    assert taxonomy.gross_yield(0, 200000) is None and taxonomy.gross_yield(800, None) is None
    assert taxonomy.net_yield(800, 0) is None


def test_property_title():
    assert taxonomy.property_title("appartement", "Lyon", "69", 42, 2) == "Appartement T2 loué · 42 m² · Lyon (69)"
    assert taxonomy.property_title("immeuble", "Saint-Étienne", "42", 310.5, units_count=5) == \
        "Immeuble de rapport loué · 5 lots · 310,5 m² · Saint-Étienne (42)"
    assert taxonomy.property_title("parking", "Paris", "75", 12) == "Parking loué · Paris (75)"
    assert taxonomy.property_title("maison", department="44") == "Maison louée · Loire-Atlantique (44)"
    assert taxonomy.property_title("bureaux") == "Bureaux loués"


# ---------------------------------------------------------------------------------------------- départements
def test_departements_table():
    assert len(taxonomy.DEPARTEMENTS) == 101
    assert "2A" in taxonomy.DEPARTEMENTS and "2B" in taxonomy.DEPARTEMENTS and "20" not in taxonomy.DEPARTEMENTS
    assert set(taxonomy.DEPARTEMENT_REGION) == set(taxonomy.DEPARTEMENTS)
    assert set(taxonomy.DEPARTEMENT_REGION.values()) == set(taxonomy.REGIONS)
    assert taxonomy.departement_label("29") == "Finistère (29)"
    assert taxonomy.departement_label("2a") == "Corse-du-Sud (2A)"
    assert taxonomy.departement_label("974") == "La Réunion (974)"
    assert taxonomy.departement_label(" 1 ") == "Ain (01)"
    assert taxonomy.departement_label("029") == "Finistère (29)"
    assert taxonomy.departement_label("20") == ""
    assert taxonomy.departement_label("") == ""
    assert taxonomy.departement_label(None) == ""
    assert taxonomy.departement_name("75") == "Paris"


def test_region_for_departement():
    assert taxonomy.region_for_departement("29") == "Bretagne"
    assert taxonomy.region_for_departement("75") == "Île-de-France"
    assert taxonomy.region_for_departement("2B") == "Corse"
    assert taxonomy.region_for_departement("971") == "DOM-TOM"
    assert taxonomy.region_for_departement("xx") == ""
    assert taxonomy.departements_for_region("Bretagne") == ["22", "29", "35", "56"]
    assert taxonomy.departements_for_region("Nulle part") == []
    assert taxonomy.region_by_slug("provence-alpes-cote-d-azur") == "Provence-Alpes-Côte d'Azur"


def test_departement_from_postal_code():
    assert taxonomy.departement_from_postal_code("29200") == "29"
    assert taxonomy.departement_from_postal_code("75008") == "75"
    assert taxonomy.departement_from_postal_code("20000") == "2A"
    assert taxonomy.departement_from_postal_code("20200") == "2B"
    assert taxonomy.departement_from_postal_code("97400") == "974"
    assert taxonomy.departement_from_postal_code("98800") == ""     # Nouvelle-Calédonie : hors table
    assert taxonomy.departement_from_postal_code("2920") == ""
    assert taxonomy.departement_from_postal_code(None) == ""


# ---------------------------------------------------------------------------------------------- slug
def test_slugify_identical_to_front_rules():
    assert taxonomy.slugify("Provence-Alpes-Côte d'Azur") == "provence-alpes-cote-d-azur"
    assert taxonomy.slugify("Lot en résidence gérée (étudiants, seniors)") == "lot-en-residence-geree-etudiants-seniors"
    assert taxonomy.slugify("Cœur de ville") == "coeur-de-ville"
    assert taxonomy.slugify("  Île-de-France ") == "ile-de-france"
    assert taxonomy.slugify("L’Étage") == "l-etage"
    assert taxonomy.slugify("") == ""
    assert taxonomy.slugify(None) == ""
