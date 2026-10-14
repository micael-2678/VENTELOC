"""Taxonomie du bâtiment : identité back/front, correspondances RGE → métiers, départements, NAF, slugs"""
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
def test_trades_identical_to_front(front):
    block = _js_block(front, "TRADES")
    rows = re.findall(r"\{ id: '([^']*)', label: '((?:\\'|[^'])*)', short: '((?:\\'|[^'])*)' \}", block)
    assert [(r[0], _js_string(r[1]), _js_string(r[2])) for r in rows] == \
        [(t["id"], t["label"], t["short"]) for t in taxonomy.TRADES]


def test_rge_categories_identical_to_front(front):
    block = _js_block(front, "RGE_CATEGORIES")
    rows = re.findall(r"\{ id: '([^']*)', label: '((?:\\'|[^'])*)' \}", block)
    assert [(r[0], _js_string(r[1])) for r in rows] == [(c["id"], c["label"]) for c in taxonomy.RGE_CATEGORIES]
    assert len(taxonomy.RGE_CATEGORIES) == 18


def test_other_qualifications_identical_to_front(front):
    block = _js_block(front, "OTHER_QUALIFICATIONS")
    rows = re.findall(r"\{ id: '([^']*)', label: '((?:\\'|[^'])*)' \}", block)
    assert [(r[0], _js_string(r[1])) for r in rows] == \
        [(q["id"], q["label"]) for q in taxonomy.OTHER_QUALIFICATIONS]


def test_regions_identical_to_front(front):
    block = _js_block(front, "REGIONS")
    rows = [_js_string(r) for r in re.findall(r"'((?:\\'|[^'])*)'", block)]
    assert rows == taxonomy.REGIONS


def test_departements_identical_to_front(front):
    block = _js_block(front, "DEPARTEMENTS")
    rows = re.findall(r"'([0-9AB]{2,3})': '((?:\\'|[^'])*)'", block)
    assert [(r[0], _js_string(r[1])) for r in rows] == list(taxonomy.DEPARTEMENTS.items())


def test_front_paths_and_slug_rules(front):
    # La page des annonces est « / » (MODE-TEST-ET-APP.md §A.3) ; les anciens hubs n'ont plus de chemin dans le front
    assert "export const SEARCH_PATH = '/';" in front
    assert "BUILDING_HUB_PATH" not in front and "SEO_HUB_PATH" not in front
    # Même traitement des ligatures dans les deux slugify
    assert ".replace(/œ/g, 'oe')" in front


# ---------------------------------------------------------------------------------------------- métiers
def test_trades_shape():
    assert len(taxonomy.TRADES) == 16
    ids = [t["id"] for t in taxonomy.TRADES]
    assert len(set(ids)) == 16
    for t in taxonomy.TRADES:
        assert taxonomy.slugify(t["id"]) == t["id"], f"id non slug : {t['id']}"
        assert t["label"] and t["short"]
    assert taxonomy.trade_label("plomberie-chauffage") == "Plomberie, chauffage, sanitaire"
    assert taxonomy.trade_label("plomberie-chauffage", short=True) == "Plomberie-chauffage"
    assert taxonomy.trade_label("inconnu") == ""
    assert taxonomy.trade_slug("maconnerie-gros-oeuvre") == "maconnerie-gros-oeuvre"
    assert taxonomy.trade_by_slug("maconnerie-gros-oeuvre")["id"] == "maconnerie-gros-oeuvre"
    assert taxonomy.trade_by_slug("maconnerie-gros-oeuvre-")["id"] == "maconnerie-gros-oeuvre"
    assert taxonomy.trade_by_slug("Électricité générale")["id"] == "electricite"
    assert taxonomy.trade_by_slug("") is None


def test_validate_trades():
    assert taxonomy.validate_trades(["isolation", "isolation", " menuiserie "]) == ["isolation", "menuiserie"]
    with pytest.raises(ValueError, match="au moins un métier"):
        taxonomy.validate_trades([])
    with pytest.raises(ValueError, match="au moins un métier"):
        taxonomy.validate_trades(None)
    with pytest.raises(ValueError, match="au moins un métier"):
        taxonomy.validate_trades("isolation")
    with pytest.raises(ValueError, match="Métier inconnu : plomberie"):
        taxonomy.validate_trades(["plomberie"])
    with pytest.raises(ValueError, match="au plus 4"):
        taxonomy.validate_trades(["isolation", "menuiserie", "electricite", "etancheite", "agencement"])


def test_trades_for_rge_mapping_from_spec():
    by_label = {c["id"]: c["label"] for c in taxonomy.RGE_CATEGORIES}
    expected = {
        "isolation_interieur": "isolation", "isolation_exterieur": "isolation", "isolation_toiture": "isolation",
        "isolation_combles": "isolation", "isolation_plancher": "isolation", "menuiserie": "menuiserie",
        "chauffage_bois": "plomberie-chauffage", "chauffage_gaz": "plomberie-chauffage",
        "pac_air_eau": "pac-clim-cvc", "pac_eau_eau": "pac-clim-cvc", "pac_air_air": "pac-clim-cvc",
        "chauffe_eau_thermo": "pac-clim-cvc", "ventilation": "pac-clim-cvc",
        "solaire_thermique": "photovoltaique-enr", "solaire_combine": "photovoltaique-enr",
        "photovoltaique": "photovoltaique-enr", "borne_recharge": "electricite",
        "audit_energetique": "renovation-generale",
    }
    for rge_id, trade in expected.items():
        assert taxonomy.trade_for_rge(rge_id) == trade, rge_id
        assert taxonomy.trade_for_rge(by_label[rge_id]) == trade, rge_id   # libellé stocké en base
    assert taxonomy.trade_for_rge("inconnu") is None


def test_trades_for_rge_order_dedupe_limit():
    assert taxonomy.trades_for_rge(["Pompes à chaleur air/eau", "Pompes à chaleur air/air",
                                    "Panneaux photovoltaïques", "n'existe pas"]) == \
        ["pac-clim-cvc", "photovoltaique-enr"]
    many = ["isolation_combles", "menuiserie", "chauffage_gaz", "pac_air_eau", "photovoltaique", "borne_recharge"]
    assert taxonomy.trades_for_rge(many) == ["isolation", "menuiserie", "plomberie-chauffage", "pac-clim-cvc"]
    unlimited = ["isolation", "menuiserie", "plomberie-chauffage", "pac-clim-cvc", "photovoltaique-enr", "electricite"]
    assert taxonomy.trades_for_rge(many, limit=0) == unlimited
    assert taxonomy.trades_for_rge([]) == []
    assert taxonomy.trades_for_rge(None) == []


def test_rge_id_tolerant_to_accents():
    assert taxonomy.rge_id_for("Pompes a chaleur air/eau") == "pac_air_eau"
    assert taxonomy.rge_id_for("pac_air_eau") == "pac_air_eau"
    assert taxonomy.rge_id_for("") is None


# ---------------------------------------------------------------------------------------------- qualifications
def test_other_qualifications():
    assert len(taxonomy.OTHER_QUALIFICATIONS) == 10
    assert taxonomy.other_qualification_label("qualit-enr").startswith("Qualit'EnR")
    assert taxonomy.other_qualification_label("cstb-etanchéité") == "Certification CSTB étanchéité"
    assert taxonomy.other_qualification_label("rien") == ""
    assert taxonomy.validate_other_qualifications(["qualibat", "QUALIBAT", "inconnu", "cstb-etanchéité"]) == \
        ["qualibat", "cstb-etancheite"]


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
    assert taxonomy.slugify("Isolation par l'intérieur (murs, rampants, plafonds)") == \
        "isolation-par-l-interieur-murs-rampants-plafonds"
    assert taxonomy.slugify("Maçonnerie, gros œuvre") == "maconnerie-gros-oeuvre"
    assert taxonomy.slugify("  Île-de-France ") == "ile-de-france"
    assert taxonomy.slugify("L’Étanchéité") == "l-etancheite"
    assert taxonomy.slugify("") == ""
    assert taxonomy.slugify(None) == ""


# ---------------------------------------------------------------------------------------------- NAF
def test_naf_in_building():
    assert taxonomy.naf_in_building("43.22A") is True
    assert taxonomy.naf_in_building("4322a") is True
    assert taxonomy.naf_in_building("41.20A") is True
    assert taxonomy.naf_in_building("42.11Z") is True
    assert taxonomy.naf_status("43.22A") == "batiment"
    # Codes connexes : tolérés (vrai) mais signalés
    for code in ("16.23Z", "23.61Z", "23.69Z", "25.11Z", "25.12Z", "71.12B", "81.30Z"):
        assert taxonomy.naf_in_building(code) is True, code
        assert taxonomy.naf_status(code) == "connexe", code
    assert taxonomy.naf_in_building("62.01Z") is False
    assert taxonomy.naf_status("62.01Z") == "hors-batiment"
    assert taxonomy.naf_in_building("") is False
    assert taxonomy.naf_status(None) == "inconnu"
    assert taxonomy.naf_label("43.22A") == "Travaux d'installation d'eau et de gaz en tous locaux"
    assert taxonomy.naf_label("62.01Z") == ""
    assert taxonomy.format_naf("4322A") == "43.22A"
    assert taxonomy.format_naf("43.22A") == "43.22A"


def test_trade_for_naf():
    assert taxonomy.trade_for_naf("43.22A") == "plomberie-chauffage"
    assert taxonomy.trade_for_naf("43.22B") == "pac-clim-cvc"
    assert taxonomy.trade_for_naf("43.21A") == "electricite"
    assert taxonomy.trade_for_naf("43.91B") == "couverture-charpente"
    assert taxonomy.trade_for_naf("43.99C") == "maconnerie-gros-oeuvre"
    assert taxonomy.trade_for_naf("81.30Z") == "piscine-paysage"
    assert taxonomy.trade_for_naf("62.01Z") is None
    for naf, trade in taxonomy._NAF_TO_TRADE.items():
        assert trade in taxonomy.TRADES_BY_ID, naf


# ---------------------------------------------------------------------------------------------- titre
def test_listing_title():
    assert taxonomy.listing_title(["plomberie-chauffage", "isolation"], "Bretagne", 10) == \
        "Entreprise de plomberie-chauffage · Bretagne · 10 salariés"
    assert taxonomy.listing_title(["pac-clim-cvc"], "Occitanie", 1) == \
        "Entreprise de PAC, climatisation · Occitanie · 1 salarié"
    assert taxonomy.listing_title(["electricite"], None, None) == "Entreprise d’électricité"
    assert taxonomy.listing_title(["isolation"], "Bretagne", 0) == "Entreprise d’isolation · Bretagne · 0 salarié"
    assert taxonomy.listing_title([], "Corse", "abc") == "Entreprise du bâtiment · Corse"
