"""Veille BODACC (veille.py) : URL opendatasoft, normalisation des annonces, pertinence, cibles (mandats sous clause de
suite, NDA signés, ventes déclarées exclues), incidents sans doublon, e-mails cédant + admin, routes admin"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

import pytest

import server
import veille
from conftest import last_email

SIREN = "552032534"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def iso(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def record(famille, date="2026-09-15", **extra):
    base = {"id": extra.pop("id", f"{famille}-{uuid.uuid4().hex[:6]}"), "familleavis": famille,
            "familleavis_lib": veille.FAMILLES.get(famille, famille), "typeavis": "A", "typeavis_lib": "Avis initial",
            "dateparution": date, "numeroannonce": 1234, "tribunal": "Greffe du tribunal de commerce de Brest",
            "commercant": "SECRET ENERGIE", "ville": "Brest", "numerodepartement": "29", "registre": ["552 032 534", SIREN],
            "url_complete": "https://www.bodacc.fr/annonce/x"}
    base.update(extra)
    return base


@pytest.fixture
def bodacc(monkeypatch):
    """fetch_json simulé : `by_siren` donne les annonces par SIREN ; `calls` liste les URL ; `error` fait échouer"""
    state = {"calls": [], "by_siren": {}, "error": None}

    def fake(url):
        state["calls"].append(url)
        if state["error"]:
            raise state["error"]
        where = unquote(url.split("where=")[1].split("&")[0])
        siren = where.split('"')[1]
        rows = state["by_siren"].get(siren, [])
        offset = int(url.split("offset=")[1])
        return {"total_count": len(rows), "results": rows[offset:offset + veille.PAGE_SIZE]}

    monkeypatch.setattr(veille, "fetch_json", fake)
    return state


# ---------- Fonctions pures ----------

def test_url_bodacc():
    url = veille.bodacc_url(SIREN, datetime(2026, 1, 15, tzinfo=timezone.utc))
    assert url.startswith(veille.BODACC_URL + "?where=")
    where = unquote(url.split("where=")[1].split("&")[0])
    assert where == 'registre like "552032534" and dateparution >= "2026-01-15"'
    assert "order_by=dateparution%20desc" in url and "limit=100" in url and "offset=0" in url
    assert 'dateparution >= "2026-03-01"' in unquote(veille.bodacc_url(SIREN, "2026-03-01T10:00:00"))


def test_normalisation_et_pertinence():
    vente = veille.normalize_record(record("vente", acte=json.dumps({"categorieVente": "Vente de fonds de commerce",
                                                                     "descriptif": "Cession du fonds"})), SIREN)
    assert vente["famille"] == "vente" and vente["relevant"] is True and vente["date"] == "2026-09-15"
    assert "Cession du fonds" in vente["description"] and vente["siren"] == SIREN and vente["famille_label"] == "Ventes et cessions"
    modif_dirigeant = veille.normalize_record(record("modification", modificationsgenerales=json.dumps(
        {"descriptif": "Modification de la direction : nouveau Président M. Martin"})))
    assert modif_dirigeant["relevant"] is True and modif_dirigeant["siren"] == SIREN
    modif_siege = veille.normalize_record(record("modification", modificationsgenerales=json.dumps(
        {"descriptif": "Transfert du siège social au 4 rue du Port"})))
    assert modif_siege["relevant"] is False
    modif_vide = veille.normalize_record(record("modification"))
    assert modif_vide["relevant"] is True, "texte indisponible : signalé plutôt que manqué"
    assert veille.normalize_record(record("depot"))["relevant"] is False
    assert veille.normalize_record(record("collective"))["relevant"] is False
    assert veille.is_relevant("modification", "Changement de GÉRANT") is True
    sans_id = veille.normalize_record({"familleavis": "vente", "dateparution": "2026-09-15", "numeroannonce": 7}, SIREN)
    assert sans_id["id"] == f"{SIREN}-2026-09-15-7"


def test_bodacc_events_pagine_et_siren_invalide(client, bodacc):
    bodacc["by_siren"][SIREN] = [record("depot", date=f"2026-0{1 + i // 28}-{1 + i % 28:02d}", id=f"d{i}") for i in range(150)]
    events = db_call(client, veille.bodacc_events, SIREN, "2026-01-01")
    assert len(events) == 150 and len(bodacc["calls"]) == 2 and "offset=100" in bodacc["calls"][1]
    assert db_call(client, veille.bodacc_events, "123", "2026-01-01") == []


def test_fin_de_clause_de_suite():
    now = datetime(2026, 10, 10, tzinfo=timezone.utc)
    assert veille.mandate_tail_end({"tail_ends_at": "2027-01-01T00:00:00+00:00"}) == datetime(2027, 1, 1, tzinfo=timezone.utc)
    from_ends = veille.mandate_tail_end({"ends_at": "2026-01-01T00:00:00+00:00"})
    assert abs((from_ends - datetime(2027, 7, 1, tzinfo=timezone.utc)).days) <= 3
    from_signed = veille.mandate_tail_end({"signed_at": "2024-01-01T00:00:00+00:00"})
    assert abs((from_signed - datetime(2026, 7, 1, tzinfo=timezone.utc)).days) <= 5 and from_signed < now
    assert veille.mandate_tail_end({}) is None


# ---------- Job mensuel ----------

def _company(client, seller, siret, **extra):
    doc = {"id": str(uuid.uuid4()), "seller_id": seller["id"], "siret": siret, "company_name": extra.pop("name", "SECRET ENERGIE SAS"),
           "status": "published", "rge_types": ["Pompes à chaleur air/eau"], "region": "Bretagne", **extra}
    db_call(client, server.db.companies.insert_one, doc)
    return doc


def _mandat(client, company, status="signed", signed_days_ago=100, **extra):
    doc = {"id": str(uuid.uuid4()), "type": "mandat", "company_id": company["id"], "seller_id": company["seller_id"],
           "status": status, "signed_at": iso(-signed_days_ago), "created_at": iso(-signed_days_ago - 1), **extra}
    db_call(client, server.db.generated_contracts.insert_one, doc)
    return doc


def _nda(client, company, buyer, signed_days_ago):
    doc = {"id": str(uuid.uuid4()), "doc_type": "nda", "company_id": company["id"], "signer_id": buyer["id"],
           "signed_at": iso(-signed_days_ago)}
    db_call(client, server.db.documents.insert_one, doc)
    return doc


def test_veille_cree_les_incidents_et_previent(api, client, emails, bodacc):
    seller = api.register(uid("veille"), "seller", first="Paul", last="Dupont")
    company = _company(client, seller, "55203253400018")
    _mandat(client, company, "signed", signed_days_ago=120, tail_ends_at=iso(700))
    bodacc["by_siren"][SIREN] = [
        record("vente", date="2026-09-15", id="v1", acte=json.dumps({"descriptif": "Vente du fonds de commerce"})),
        record("modification", date="2026-09-20", id="m1", modificationsgenerales=json.dumps({"descriptif": "Nouveau gérant"})),
        record("depot", date="2026-09-25", id="d1"),
        record("modification", date="2026-09-26", id="m2", modificationsgenerales=json.dumps({"descriptif": "Transfert du siège"})),
    ]
    created = db_call(client, veille.monthly_job)
    assert created == 2
    incidents = db_call(client, server.db.incidents.find({"siren": SIREN}, {"_id": 0}).to_list, 10)
    assert {i["event"]["id"] for i in incidents} == {"v1", "m1"}
    for i in incidents:
        assert i["type"] == "bodacc" and i["status"] == "open" and i["company_id"] == company["id"] and i["created_at"]
        assert i["sources"] and i["sources"][0].startswith("mandat signé (clause de suite jusqu'au ")
    # Requête BODACC depuis la date du mandat
    call = next(c for c in bodacc["calls"] if SIREN in c)
    since = unquote(call).split('dateparution >= "')[1][:10]
    assert since == (datetime.now(timezone.utc) - timedelta(days=120)).strftime("%Y-%m-%d")
    # E-mails : cédant + admin (ADMIN_NOTIFICATION_EMAIL, sinon ADMIN_EMAIL)
    e = last_email(seller["email"], "Publication au BODACC")
    assert e and SIREN in e["html"] and "Vente du fonds de commerce" in e["html"] and "Nouveau gérant" in e["html"]
    assert "18 mois" in e["html"] and "Si la société a été cédée" in e["html"] and "15/09/2026" in e["html"]
    a = last_email("admin@test.fr", "Incident BODACC")
    assert a and SIREN in a["html"] and company["id"] in a["html"]
    assert len([x for x in emails if x["to"] == seller["email"] and "BODACC" in x["subject"]]) == 1
    run = db_call(client, server.db.veille_runs.find_one, {"incidents_created": 2})
    assert run and run["errors"] == []

    # Deuxième passage : aucun doublon, aucun nouvel e-mail
    before = len(emails)
    assert db_call(client, veille.monthly_job) == 0
    assert db_call(client, server.db.incidents.count_documents, {"siren": SIREN}) == 2 and len(emails) == before

    # Routes admin
    r = client.get("/api/admin/incidents", headers=api.h(api.admin()))
    assert r.status_code == 200 and {i["event"]["id"] for i in r.json()["incidents"] if i["siren"] == SIREN} == {"v1", "m1"}
    first = next(i for i in r.json()["incidents"] if i["siren"] == SIREN)
    r = client.put(f"/api/admin/incidents/{first['id']}", json={"status": "closed", "note": "Changement d'adresse, pas de cession"},
                   headers=api.h(api.admin()))
    assert r.status_code == 200 and r.json()["status"] == "closed" and r.json()["closed_at"]
    assert first["id"] not in {i["id"] for i in client.get("/api/admin/incidents", headers=api.h(api.admin())).json()["incidents"]}
    closed = client.get("/api/admin/incidents", params={"status": "closed"}, headers=api.h(api.admin())).json()["incidents"]
    assert any(i["id"] == first["id"] and i["note"].startswith("Changement") for i in closed)
    assert client.put(f"/api/admin/incidents/{first['id']}", json={"status": "open"}, headers=api.h(api.admin())).json()["closed_at"] is None
    assert client.put("/api/admin/incidents/inconnu", json={"status": "closed"}, headers=api.h(api.admin())).status_code == 404
    assert client.get("/api/admin/incidents", headers=api.h(seller)).status_code == 403


def test_cibles_mandats_nda_et_exclusions(api, client, bodacc):
    seller = api.register(uid("cibles"), "seller")
    buyer = api.register(uid("rep"), "buyer")
    now = datetime.now(timezone.utc)
    # 1. Mandat dénoncé, clause de suite en cours → surveillé
    c1 = _company(client, seller, "11111111100011", name="Un")
    _mandat(client, c1, "denounced", signed_days_ago=400, tail_ends_at=iso(300))
    # 2. Mandat expiré, clause de suite terminée → ignoré
    c2 = _company(client, seller, "22222222200011", name="Deux")
    _mandat(client, c2, "expired", signed_days_ago=1000, tail_ends_at=iso(-10))
    # 3. Mandat signé sans tail_ends_at (ancien) → signature + 30 mois
    c3 = _company(client, seller, "33333333300011", name="Trois")
    _mandat(client, c3, "signed", signed_days_ago=30)
    # 4. NDA signé il y a 10 mois, pas de mandat → surveillé depuis le NDA ; SIREN via `siren`
    c4 = _company(client, seller, "", siren="444 444 444", name="Quatre")
    _nda(client, c4, buyer, signed_days_ago=300)
    # 5. NDA de plus de 24 mois → ignoré
    c5 = _company(client, seller, "55555555500011", name="Cinq")
    _nda(client, c5, buyer, signed_days_ago=800)
    # 6. Vente déclarée (closing) → ignoré ; 7. annonce vendue → ignoré
    c6 = _company(client, seller, "66666666600011", name="Six")
    _mandat(client, c6, "signed", signed_days_ago=50, tail_ends_at=iso(800))
    db_call(client, server.db.closings.insert_one, {"id": str(uuid.uuid4()), "company_id": c6["id"], "status": "confirmed"})
    c7 = _company(client, seller, "77777777700011", name="Sept", status="sold")
    _mandat(client, c7, "signed", signed_days_ago=50, tail_ends_at=iso(800))
    # 8. Mandat en attente de signature → ignoré
    c8 = _company(client, seller, "88888888800011", name="Huit")
    _mandat(client, c8, "pending_signature", signed_days_ago=5, tail_ends_at=iso(800))
    # 9. Mandat + NDA sur la même société : une seule cible, depuis la date la plus ancienne
    c9 = _company(client, seller, "99999999900011", name="Neuf")
    _mandat(client, c9, "signed", signed_days_ago=60, tail_ends_at=iso(800))
    _nda(client, c9, buyer, signed_days_ago=200)

    targets = db_call(client, veille.collect_targets, now)
    assert {"111111111", "333333333", "444444444", "999999999"} <= set(targets)
    assert not {"222222222", "555555555", "666666666", "777777777", "888888888"} & set(targets)
    assert targets["111111111"]["company_label"] == "Un" and targets["111111111"]["seller_id"] == seller["id"]
    assert len(targets["999999999"]["sources"]) == 2
    assert abs((targets["999999999"]["since"] - (now - timedelta(days=200))).days) <= 1
    assert "NDA" in targets["444444444"]["sources"][0]


def test_panne_bodacc(api, client, bodacc):
    seller = api.register(uid("panne"), "seller")
    company = _company(client, seller, "12121212100011")
    _mandat(client, company, "signed", signed_days_ago=10, tail_ends_at=iso(800))
    bodacc["error"] = ConnectionError("proxy")
    failures_before = db_call(client, server.db.job_failures.count_documents, {"job": "monthly:veille"})
    assert db_call(client, veille.monthly_job) == 0, "jamais d'exception : le planificateur attend un entier"
    run = db_call(client, server.db.veille_runs.find_one, {"sirens_checked": 0, "errors": {"$ne": []}})
    assert run and run["incidents_created"] == 0
    assert db_call(client, server.db.job_failures.count_documents, {"job": "monthly:veille"}) == failures_before + 1
    assert db_call(client, server.db.incidents.count_documents, {"siren": "121212121"}) == 0
    r = client.post("/api/admin/veille/run", headers=api.h(api.admin()))
    assert r.status_code == 503
    bodacc["error"] = None
    r = client.post("/api/admin/veille/run", headers=api.h(api.admin()))
    assert r.status_code == 200 and r.json()["sirens"] >= 1 and r.json()["incidents_created"] == 0 and r.json()["errors"] == []
    assert client.post("/api/admin/veille/run", headers=api.h(seller)).status_code == 403


def test_module_branche():
    assert "veille" in server.LOADED_MODULES
    assert any(name == "veille" for name, _ in server.MONTHLY_JOBS)
    from business_model import EMAIL_TEMPLATES
    assert "bodacc_incident_seller" in EMAIL_TEMPLATES and "bodacc_incident_admin" in EMAIL_TEMPLATES
