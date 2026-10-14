"""Diagnostic de transmissibilité (transmissibility.py) : organismes, statut des qualifications, règles titres/fonds,
référent technique, décennale, niveau, version publique (ADEME simulée) et version complète (accès data room)"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import server
import transmissibility as tr
from conftest import listing

SIRET = "55203253400018"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def future(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")


def ademe_raw(details=True):
    """Réponse de server.get_company_qualifications ; `details` = dates par qualification (ajout HANDOFF)"""
    raw = {"found": True, "company": {"siret": SIRET, "nom_entreprise": "SECRET ENERGIE", "code_postal": "29200", "commune": "BREST"},
           "domaines": ["Pompe à chaleur", "Isolation des murs par l'extérieur"],
           "qualifications": ["QualiPAC", "Qualibat 7131 ITE"], "organismes": ["Qualit'EnR", "QUALIBAT"], "total_certifications": 2}
    if details:
        raw["details"] = [
            {"nom_qualification": "QualiPAC", "organisme": "Qualit'EnR", "domaine": "Pompe à chaleur",
             "lien_date_debut": "2024-01-01", "lien_date_fin": future(500), "nom_certificat": "QualiPAC"},
            {"nom_qualification": "Qualibat 7131 ITE", "organisme": "QUALIBAT", "domaine": "Isolation des murs par l'extérieur",
             "lien_date_debut": "2023-06-01", "lien_date_fin": future(90), "nom_certificat": "RGE"},
        ]
    return raw


@pytest.fixture
def ademe(monkeypatch):
    state = {"raw": ademe_raw(), "calls": []}

    async def fake(siret):
        state["calls"].append(siret)
        return state["raw"]

    monkeypatch.setattr(server, "get_company_qualifications", fake)
    return state


# ---------- Constantes et fonctions pures ----------

def test_organismes_et_detection():
    assert set(tr.ORGANISMES) == {"qualibat", "qualit-enr", "qualifelec", "certibat", "rge-etudes", "autre"}
    for key, org in tr.ORGANISMES.items():
        assert org["label"] and org["titres"] and org["fonds"] and org["delai_fonds"] and org["referent"]
    assert tr.organisme_for("QUALIBAT") == "qualibat"
    assert tr.organisme_for("Qualit'EnR") == "qualit-enr" and tr.organisme_for("", "QualiPAC") == "qualit-enr"
    assert tr.organisme_for("QUALIBOIS") == "qualit-enr" and tr.organisme_for("Qualisol") == "qualit-enr"
    assert tr.organisme_for("QUALIFELEC") == "qualifelec" and tr.organisme_for("CERTIBAT") == "certibat"
    assert tr.organisme_for("OPQIBI") == "rge-etudes" and tr.organisme_for("RGE Études") == "rge-etudes"
    assert tr.organisme_for(None, "") == "autre"
    assert tr.REFERENT["deadline_months"] == 6 and "six mois" in tr.REFERENT["text"]
    assert "L241-1" in tr.DECENNALE["fonds"] and "L113-2" in tr.DECENNALE["titres"]
    assert any("1er janvier 2027" in r["label"] for r in tr.REFORME)
    assert all("à compléter" not in str(v).lower() for v in (tr.ORGANISMES, tr.REFERENT, tr.DECENNALE, tr.AIDES, tr.REFORME, tr.TRANSFER))


def test_statut_des_qualifications():
    assert tr.qualification_status(future(400))["status"] == "valide"
    s = tr.qualification_status(future(30))
    assert s["status"] == "expire_bientot" and 29 <= s["days_left"] <= 30
    assert tr.qualification_status("2020-01-01")["status"] == "expiree"
    assert tr.qualification_status("01/01/2020")["status"] == "expiree"
    assert tr.qualification_status(None) == {"status": "inconnue", "days_left": None}
    assert tr.qualification_status("n'importe quoi")["status"] == "inconnue"


def test_normalize_ademe_avec_et_sans_details():
    n = tr.normalize_ademe(ademe_raw())
    assert n["available"] and n["found"] and n["company"]["nom_entreprise"] == "SECRET ENERGIE"
    assert [(q["name"], q["organisme"]) for q in n["qualifications"]] == [("QualiPAC", "qualit-enr"), ("Qualibat 7131 ITE", "qualibat")]
    assert n["qualifications"][0]["date_fin"] == future(500) and n["qualifications"][1]["domaine"].startswith("Isolation")
    n2 = tr.normalize_ademe(ademe_raw(details=False))
    assert [(q["name"], q["organisme"], q["date_fin"]) for q in n2["qualifications"]] == \
        [("QualiPAC", "qualit-enr", None), ("Qualibat 7131 ITE", "qualibat", None)]
    assert tr.normalize_ademe({"found": False, "error": "timeout"})["available"] is False
    absent = tr.normalize_ademe({"found": False, "message": "Entreprise non trouvée dans la base RGE"})
    assert absent["available"] is True and absent["found"] is False and absent["qualifications"] == []


def test_diagnostic_public_depuis_liste_ademe():
    quals = tr.normalize_ademe(ademe_raw())["qualifications"]
    d = tr.build_diagnostic(quals, with_financials=False)
    assert d["scope"] == "public" and d["is_rge"] is True and d["source"] == "ademe"
    assert [q["status"] for q in d["qualifications"]] == ["valide", "expire_bientot"]
    assert [o["key"] for o in d["organismes"]] == ["qualibat", "qualit-enr"]
    assert d["organismes"][1]["qualifications"] == ["QualiPAC"] and any("six mois" in t for t in d["organismes"][1]["titres"])
    assert d["transfer"]["recommended"] == "titres" and d["transfer"]["titres"]["steps"] and d["transfer"]["fonds"]["steps"]
    assert any("retourne" in s for s in d["transfer"]["fonds"]["steps"]), "Qualibat : certificat à retourner en cession de fonds"
    assert d["referent"]["stays"] is None and d["decennale"]["ok"] is None
    assert "checklist" not in d and "financials" not in d
    assert d["level"]["value"] == "moyenne" and any("renouveler" in r for r in d["level"]["reasons"])
    assert d["disclaimer"]
    # Toutes valides → à compléter par le cédant (pas de données sur le référent)
    quals[1]["date_fin"] = future(800)
    assert tr.build_diagnostic(quals)["level"]["value"] == "a-completer"
    # Expirée → fragile
    quals[1]["date_fin"] = "2021-01-01"
    assert tr.build_diagnostic(quals)["level"]["value"] == "fragile"
    # Libellés simples acceptés
    simple = tr.build_diagnostic(["QualiPV", "Qualifelec RGE"])
    assert [q["organisme"] for q in simple["qualifications"]] == ["qualit-enr", "qualifelec"]
    assert [q["status"] for q in simple["qualifications"]] == ["inconnue", "inconnue"]


def test_diagnostic_sans_qualification():
    d = tr.build_diagnostic([])
    assert d["is_rge"] is False and d["source"] == "aucune" and d["organismes"] == []
    assert d["level"]["value"] == "non-applicable" and d["decennale"]["fonds"]


def test_diagnostic_complet_depuis_annonce():
    company = {"id": "c1", "rge_types": ["Pompes à chaleur air/eau"], "other_qualifications": ["qualibat", "handibat"],
               "rge_validity": future(600), "sale_object": "titres", "handover_months": 6, "has_maintenance_contracts": True,
               "technical_referent_stays": True, "key_staff_stays": True, "decennale_ok": True, "staff_count": 9,
               "ca_n": 900000, "ebitda": 150000, "asking_price": 500000}
    d = tr.build_diagnostic(company, with_financials=True)
    assert d["scope"] == "complet" and d["source"] == "declaration"
    assert [(q["name"], q["organisme"], q["source"]) for q in d["qualifications"]] == \
        [("Pompes à chaleur air/eau", "autre", "declaration"), ("Qualibat", "qualibat", "declaration")]
    assert d["qualifications"][0]["status"] == "valide"
    assert d["level"]["value"] == "elevee"
    assert d["transfer"]["chosen"] == "titres" and d["referent"]["stays"] is True and d["decennale"]["ok"] is True
    checklist = {c["key"]: c["status"] for c in d["checklist"]}
    # Qualifications seulement déclarées (non retrouvées sur la liste ADEME) : pas de coche verte
    assert checklist == {"qualifications": "inconnu", "referent": "ok", "decennale": "ok", "sale_object": "ok", "key_staff": "ok", "handover": "ok"}
    assert next(c for c in d["checklist"] if c["key"] == "qualifications")["label"] == "Qualifications déclarées en cours de validité"
    verified = tr.build_diagnostic({**company, "ademe_qualifications": [{"nom_qualification": "QualiPAC", "organisme": "qualit-enr",
                                                                         "date_fin": future(600)[:10]}]}, with_financials=True)
    assert verified["source"] == "ademe" and {c["key"]: c["status"] for c in verified["checklist"]}["qualifications"] == "ok"
    assert d["financials"]["asking_price"] == 500000 and d["financials"]["sale_object"] == "titres"

    # Référent qui part + cession de fonds → moyenne ; décennale non à jour → fragile
    weaker = {**company, "technical_referent_stays": False, "sale_object": "fonds", "handover_months": 1}
    d2 = tr.build_diagnostic(weaker, with_financials=True)
    assert d2["level"]["value"] == "moyenne"
    c2 = {c["key"]: c["status"] for c in d2["checklist"]}
    assert c2["referent"] == "attention" and c2["sale_object"] == "attention" and c2["handover"] == "attention"
    d3 = tr.build_diagnostic({**company, "decennale_ok": False}, with_financials=True)
    assert d3["level"]["value"] == "fragile"
    # Rien de renseigné → inconnu partout, niveau moyen
    d4 = tr.build_diagnostic({"id": "c2", "rge_types": ["Isolation des combles"]}, with_financials=True)
    c4 = {c["key"]: c["status"] for c in d4["checklist"]}
    assert c4["referent"] == "inconnu" and c4["decennale"] == "inconnu" and c4["sale_object"] == "inconnu" and c4["qualifications"] == "inconnu"
    assert d4["level"]["value"] == "moyenne"
    # Version publique d'une annonce : pas de données financières
    pub = tr.build_diagnostic(company, with_financials=False)
    assert pub["scope"] == "public" and "financials" not in pub and pub["referent"]["stays"] is None
    # Qualifications ADEME injectées par la route : elles priment sur le déclaratif
    with_ademe = {**company, "ademe_qualifications": tr.normalize_ademe(ademe_raw())["qualifications"]}
    assert tr.build_diagnostic(with_ademe, with_financials=True)["source"] == "ademe"


# ---------- Route publique ----------

def test_route_publique(client, ademe):
    r = client.get(f"/api/rge/company/{SIRET}/transmissibility")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["found"] is True and body["available"] is True and body["company"]["nom_entreprise"] == "SECRET ENERGIE"
    assert body["siren"] == "552032534" and ademe["calls"] == [SIRET]
    d = body["diagnostic"]
    assert d["scope"] == "public" and len(d["qualifications"]) == 2 and "financials" not in d
    assert d["verified_at"]
    assert client.get("/api/rge/company/123/transmissibility").status_code == 400
    # Entreprise absente de la liste ADEME : diagnostic générique, jamais bloquant
    ademe["raw"] = {"found": False, "message": "Entreprise non trouvée dans la base RGE"}
    r = client.get("/api/rge/company/12345678900011/transmissibility")
    assert r.status_code == 200 and r.json()["found"] is False and r.json()["diagnostic"]["level"]["value"] == "non-applicable"
    # Panne ADEME
    ademe["raw"] = {"found": False, "error": "timeout"}
    r = client.get("/api/rge/company/12345678900011/transmissibility")
    assert r.status_code == 200 and r.json()["available"] is False and "différée" in r.json()["message"]


def test_route_publique_tolere_une_exception_ademe(client, monkeypatch):
    async def boom(siret):
        raise RuntimeError("ADEME HS")
    monkeypatch.setattr(server, "get_company_qualifications", boom)
    r = client.get(f"/api/rge/company/{SIRET}/transmissibility")
    assert r.status_code == 200 and r.json()["available"] is False


# ---------- Route complète (après accès data room) ----------

def test_route_annonce_reservee_au_cedant_et_aux_repreneurs_autorises(api, client, ademe):
    seller = api.register(uid("ced"), "seller")
    payload = listing(siret=SIRET, sale_object="titres", technical_referent_stays=True, decennale_ok=True)
    company = client.post("/api/companies", headers=api.h(seller), json=payload).json()
    url = f"/api/companies/{company['id']}/transmissibility"
    assert client.get(url).status_code in (401, 403)
    assert client.get("/api/companies/inexistante/transmissibility", headers=api.h(seller)).status_code == 404

    r = client.get(url, headers=api.h(seller))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ademe"]["found"] is True and ademe["calls"][-1] == SIRET
    d = body["diagnostic"]
    assert d["scope"] == "complet" and d["source"] == "ademe" and "checklist" in d and "financials" in d
    assert d["financials"]["asking_price"] == 500000

    buyer = api.register(uid("rep"), "buyer")
    assert client.get(url, headers=api.h(buyer)).status_code == 403
    db_call(client, server.db.dataroom_access.insert_one,
            {"id": str(uuid.uuid4()), "company_id": company["id"], "buyer_id": buyer["id"], "status": "pending"})
    assert client.get(url, headers=api.h(buyer)).status_code == 403
    db_call(client, server.db.dataroom_access.update_one, {"company_id": company["id"], "buyer_id": buyer["id"]},
            {"$set": {"status": "granted"}})
    assert client.get(url, headers=api.h(buyer)).status_code == 200
    assert client.get(url, headers=api.h(api.admin())).status_code == 200


def test_route_annonce_sans_siret_utilise_le_declaratif(api, client, ademe):
    seller = api.register(uid("decl"), "seller")
    company = client.post("/api/companies", headers=api.h(seller), json=listing(siret="")).json()
    r = client.get(f"/api/companies/{company['id']}/transmissibility", headers=api.h(seller))
    assert r.status_code == 200
    assert r.json()["ademe"]["found"] is False and r.json()["diagnostic"]["source"] == "declaration"
    assert ademe["calls"] == [], "pas d'appel ADEME sans SIRET"


def test_module_branche():
    assert "transmissibility" in server.LOADED_MODULES
