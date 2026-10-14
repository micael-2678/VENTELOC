"""Contrats v2 (SPEC §3.2 à §3.5, API.md §4-§6) : mandat simple (génération, texte, dates, dénonciation, prolongation,
expiration, PDF avec preuve), NDA v2 (identité + demande acceptée, repreneurs présentés), offre indicative (signature,
contre-signature, contre-proposition, refus, expiration), chaîne de preuve, étape de vente directe."""
import base64
import io
import re
import uuid
from datetime import datetime, timedelta, timezone

import business_model
import server
from conftest import last_email, listing

NOW = datetime.now(timezone.utc)


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


def iso(days):
    return (NOW + timedelta(days=days)).isoformat()


def pdf_text(content: bytes) -> str:
    from pypdf import PdfReader
    assert content[:4] == b"%PDF"
    return " ".join(" ".join(p.extract_text().split()) for p in PdfReader(io.BytesIO(content)).pages).replace("\xa0", " ")


def seller_with_listing(api, client, **extra):
    seller = api.register(uid("cedant"), "seller", first="Paul", last="Dupont")
    api.verify_kyc(seller)
    # SIRET unique par annonce : un doublon de SIREN déjà publié bloque la publication (SPEC §4.4)
    extra.setdefault("siret", f"{uuid.uuid4().int % 10**9:09d}00011")
    c = client.post("/api/properties", headers=api.h(seller), json=listing(**extra)).json()
    return seller, c


def published(api, client, **extra):
    seller, c = seller_with_listing(api, client, **extra)
    api.publish(seller, c["id"])
    return seller, c


def presented_buyer(api, client, seller, cid, first="Marie", last="Martin"):
    """Repreneur avec NDA signé (présenté) et accès au dossier accordé"""
    buyer = api.register(uid("repreneur"), "buyer", first=first, last=last)
    api.grant_dataroom(seller, buyer, cid)
    return buyer


def signed_mandate(api, client):
    seller, c = seller_with_listing(api, client)
    m = api.mandate(seller, c["id"])
    r = api.sign_mandate(seller, m["contract_id"])
    assert r.status_code == 200, r.text
    return seller, c, m, r.json()


def run_jobs(api, client):
    r = client.post("/api/admin/jobs/run", headers=api.h(api.admin()))
    assert r.status_code == 200, r.text
    return r.json()


OFFER = {"amount": 480000, "sale_object": "titres", "financing": {"equity": 150000, "loan": 300000, "vendor_loan": 30000, "earn_out": 0},
         "conditions": ["Audit comptable satisfaisant", "Transfert de l'assurance décennale"], "target_date": "2027-03-31", "validity_days": 30,
         "message": "Projet de reprise individuelle."}


# ---------- Mandat simple : génération ----------

def test_generation_refusee_sans_adresse_ni_objet(api, client):
    seller = api.register(uid("cedant"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json={**listing(), "sale_object": None}).json()
    r = client.post("/api/seller/mandat/generate", params={"property_id": c["id"]}, headers=api.h(seller))
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "validation" and set(detail["missing"]) == {"mandant_address", "sale_object"}
    assert "adresse postale" in detail["message"]
    # Adresse seule : il manque encore l'objet
    assert client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"mandant_address": "1 rue Haute, 29200 Brest"}).status_code == 200
    r = client.post("/api/seller/mandat/generate", params={"property_id": c["id"]}, headers=api.h(seller))
    assert r.status_code == 400 and r.json()["detail"]["missing"] == ["sale_object"]
    assert client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"sale_object": "fonds"}).status_code == 200
    m = client.post("/api/seller/mandat/generate", params={"property_id": c["id"]}, headers=api.h(seller)).json()
    assert m["terms_version"] == "v2" and len(m["summary"]) == 5
    assert "la cession du fonds de commerce exploité par la société SECRET ENERGIE SAS" in m["content"]
    assert "1 rue Haute, 29200 Brest" in m["content"]


def test_texte_du_mandat_simple(api, client):
    seller, c = seller_with_listing(api, client)
    m = api.mandate(seller, c["id"])
    text = m["content"]
    assert text.startswith("MANDAT DE VENTE SIMPLE (NON EXCLUSIF)")
    assert "{{" not in text and "☐" not in text and "___" not in text and "à compléter" not in text.lower()
    # Aucune clause d'exclusivité ni de pénalité (art. 78 du décret 72-678) : les seules occurrences sont les négations
    stripped = text.replace("(NON EXCLUSIF)", "").replace("mandat simple, non exclusif", "").replace("Le présent mandat est un mandat simple.", "")
    assert "exclusi" not in stripped.lower(), "le mot n'apparaît que pour dire que le mandat n'est pas exclusif"
    assert "Aucune indemnité, pénalité ni commission n'est due au Mandataire si la vente est conclue avec un acquéreur qui ne lui a pas été présenté" in text
    assert text.count("pénalité") == 1
    for banned in ("tacite reconduction", "lettre recommandée", "jusqu'au closing", "Lehman", "tranches successives"):
        assert banned not in text
    # Parties, objet, prix, durée, préavis, clause de suite, rémunération, signature électronique
    assert "Paul Dupont" in text and seller["email"] in text and "12 rue de la Mer, 29200 Brest" in text
    assert "SECRET ENERGIE SAS" in text and f"SIREN {c['siret'][:3]} {c['siret'][3:6]} {c['siret'][6:9]}" in text
    assert "la cession de la totalité des titres de la société SECRET ENERGIE SAS" in text and "500 000 €".replace(" ", " ") in text
    assert "durée de 12 mois" in text and "préavis de 15 jours" in text and "dans les 18 mois suivant la fin du mandat" in text
    assert "6 % HT du prix de cession" in text and "à la charge du Mandant" in text and "nommément présenté" in text
    assert "30\u00a0000\u00a0€ HT" in text and "36\u00a0000\u00a0€ TTC" in text
    assert "ordre irrévocable au rédacteur de l'acte" in text and "articles 1366 et 1367 du code civil" in text
    assert "CPI 7801 2025 000 000 049" in text and "ne recevoir ni détenir d'autres fonds" in text and "Versailles" in text
    assert "ne négocie pas, ne rédige pas les actes" in text
    # Art. 10.4 : un seul texte quelle que soit la taille de l'entreprise (contrat à distance, L221-3 hors champ, cadre-legal §2.6)
    clause = "Le Mandant demande expressément que l'exécution du mandat (diffusion de l'annonce) commence dès sa signature"
    assert clause in text and "il n'ouvre pas de droit de rétractation au titre de l'article L221-3" in text
    seller_small, c_small = seller_with_listing(api, client, staff_count=3)
    small_text = api.mandate(seller_small, c_small["id"])["content"]
    assert clause in small_text and "conclu à distance" in small_text
    # Art. 5 e) : veille BODACC prévue au mandat (rappelée par l'e-mail « vendue autrement »)
    assert "e) accepter que le Mandataire consulte les publications légales de la société (BODACC)" in text
    assert "Conditions du 10/10/2026" in text and "attribué automatiquement lors de la signature" in text
    # Résumé en 5 lignes
    assert any("sans exclusivité" in line for line in m["summary"]) and any("préavis de 15 jours" in line for line in m["summary"])


# ---------- Signature, dates, contre-signature, PDF ----------

def test_signature_dates_contresignature_et_pdf(api, client, emails):
    emails.clear()
    seller, c, m, signed = signed_mandate(api, client)
    assert signed["status"] == "signed" and signed["terms_version"] == "v2" and signed["registry_number"] >= 1
    signed_at, ends_at, tail = (datetime.fromisoformat(signed[k]) for k in ("signed_at", "ends_at", "tail_ends_at"))
    assert ends_at == server.add_months(signed_at, 12) and tail == server.add_months(ends_at, 18)
    assert signed["pdf_url"] == f"/api/seller/mandat/{m['contract_id']}/pdf" and signed["listing_status"] == "published"

    status = client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()
    mandat = status["mandat"]
    assert status["mandat_signed"] is True and mandat["status"] == "signed" and mandat["registry_number"] == signed["registry_number"]
    assert mandat["ends_at"] == signed["ends_at"] and mandat["tail_ends_at"] == signed["tail_ends_at"] and mandat["terms_version"] == "v2"
    assert mandat["mandant_address"] == "12 rue de la Mer, 29200 Brest" and mandat["sale_object"] == "titres"
    assert "pdf_token" not in mandat and status["presented_buyers"] == []
    # Texte signé : numéro de registre et horodatage reportés, contre-signature AlterEgo
    assert f"n° {signed['registry_number']}" in mandat["content"] and "attribué automatiquement" not in mandat["content"]
    assert "Signé électroniquement par AlterEgo SAS" in mandat["content"] and "Signé électroniquement par le Mandant, Paul Dupont" in mandat["content"]
    assert mandat["countersignature"]["by"] == "AlterEgo SAS" and mandat["countersignature"]["evidence"]["previous_evidence_sha256"]
    assert mandat["signature_evidence"]["document_sha256"] == server.hashlib.sha256(mandat["content"].encode()).hexdigest()

    # E-mail au mandant avec lien PDF authentifié
    mail = last_email(seller["email"], f"Votre mandat n° {signed['registry_number']} est signé")
    assert mail and "{" not in mail["html"]
    link = re.search(r'href="(https://cessionrge.test/api/seller/mandat/[^"]+\?token=[^"]+)"', mail["html"]).group(1)
    r = client.get(link.replace("https://cessionrge.test", ""))
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    text = pdf_text(r.content)
    assert "MANDAT DE VENTE SIMPLE" in text and f"n° {signed['registry_number']}" in text
    assert "Dossier de preuve" in text and "Empreinte SHA-256 du document" in text and mandat["signature_evidence"]["document_sha256"] in text
    assert "heure de Paris" in text and "UTC" in text and "contre-signature" in text.lower()
    # Même PDF en JSON pour l'espace connecté ; jeton erroné refusé
    j = client.get(f"/api/seller/mandat/{m['contract_id']}/pdf", headers=api.h(seller)).json()
    assert "mandat simple" in pdf_text(base64.b64decode(j["content"])).lower()
    assert client.get(f"/api/seller/mandat/{m['contract_id']}/pdf", params={"token": "faux"}).status_code == 401
    # Le mandat signé figure dans les documents signés de l'annonce avec sa preuve
    docs = client.get(f"/api/documents/{c['id']}/signed", headers=api.h(seller)).json()
    assert isinstance(docs, list) and docs[0]["doc_type"] == "mandat" and docs[0]["evidence"]["previous_evidence_sha256"] is None
    assert docs[0]["pdf_url"].startswith(f"/api/documents/{c['id']}/") and docs[0]["evidence"]["document_sha256"]


def test_generation_apres_signature_renvoie_le_mandat_signe(api, client):
    seller, c, m, signed = signed_mandate(api, client)
    again = api.mandate(seller, c["id"])
    assert again["already_signed"] is True and again["contract"]["registry_number"] == signed["registry_number"]
    assert "pdf_token" not in again["contract"]
    assert client.post(f"/api/seller/mandat/{m['contract_id']}/sign", headers=api.h(seller), json={"otp_code": "000000"}).status_code == 409


# ---------- Dénonciation et job d'effet ----------

def test_denonciation_preavis_et_job_effet(api, client, emails):
    seller, c, m, signed = signed_mandate(api, client)
    buyer = presented_buyer(api, client, seller, c["id"])
    emails.clear()
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/denounce", headers=api.h(seller))
    assert r.status_code == 200, r.text
    effective = datetime.fromisoformat(r.json()["effective_at"])
    assert r.json()["status"] == "denounced" and timedelta(days=14, hours=23) < effective - NOW < timedelta(days=15, hours=1)
    assert last_email(seller["email"], "Résiliation de votre mandat") and last_email("admin@test.fr", "[Admin] Mandat n°")
    status = client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()
    assert status["mandat_signed"] is False and status["mandat"]["status"] == "denounced" and status["mandat"]["effective_at"]
    assert client.post(f"/api/seller/mandat/{m['contract_id']}/denounce", headers=api.h(seller)).status_code == 400
    # Avant la date d'effet : l'annonce reste en ligne
    run_jobs(api, client)
    assert client.get(f"/api/properties/{c['id']}").status_code == 200
    # À la date d'effet : annonce retirée, e-mail avec la liste nominative des présentés
    db_call(client, server.db.generated_contracts.update_one, {"id": m["contract_id"]}, {"$set": {"effective_at": iso(-1)}})
    emails.clear()
    result = run_jobs(api, client)
    assert result["daily:mandate_denounce_effective"] == 1
    property = db_call(client, server.db.properties.find_one, {"id": c["id"]}, {"_id": 0})
    assert property["status"] == "withdrawn" and property["mandat_signed"] is False
    assert client.get(f"/api/properties/{c['id']}").status_code == 404
    mail = last_email(seller["email"], f"Fin de votre mandat n° {signed['registry_number']}")
    assert mail and "Marie Martin" in mail["html"] and "dénoncé" in mail["html"] and "{" not in mail["html"]
    # Idempotent
    emails.clear()
    assert run_jobs(api, client)["daily:mandate_denounce_effective"] == 0 and not [e for e in emails if e["to"] == seller["email"]]
    # Un repreneur ne peut pas dénoncer
    assert client.post(f"/api/seller/mandat/{m['contract_id']}/denounce", headers=api.h(buyer)).status_code == 403


# ---------- Prolongation ----------

def test_renouvellement_par_code(api, client):
    seller, c, m, signed = signed_mandate(api, client)
    assert client.post(f"/api/seller/mandat/{m['contract_id']}/renew", headers=api.h(seller), json={}).status_code == 400
    code = api.request_code(seller, m["contract_id"])
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/renew", headers=api.h(seller), json={"otp_code": code})
    assert r.status_code == 200, r.text
    new_end = datetime.fromisoformat(r.json()["ends_at"])
    assert new_end == server.add_months(datetime.fromisoformat(signed["ends_at"]), 12)
    assert datetime.fromisoformat(r.json()["tail_ends_at"]) == server.add_months(new_end, 18) and r.json()["renewals"] == 1
    mandat = client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()["mandat"]
    assert len(mandat["renewals"]) == 1 and mandat["renewals"][0]["new_ends_at"] == r.json()["ends_at"]
    assert mandat["renewals"][0]["evidence"]["previous_evidence_sha256"], "la preuve de prolongation est chaînée à la signature"
    assert mandat["content"] == db_call(client, server.db.generated_contracts.find_one, {"id": m["contract_id"]})["content"], "le texte signé reste figé"
    assert "Prolongation du mandat" in pdf_text(base64.b64decode(client.get(f"/api/seller/mandat/{m['contract_id']}/pdf", headers=api.h(seller)).json()["content"]))
    # Le même code ne sert pas deux fois
    assert client.post(f"/api/seller/mandat/{m['contract_id']}/renew", headers=api.h(seller), json={"otp_code": code}).status_code == 400


# ---------- Expiration J-30 et échéance ----------

def test_expiration_j30_puis_echeance(api, client, emails):
    seller, c, m, signed = signed_mandate(api, client)
    presented_buyer(api, client, seller, c["id"], first="Luc", last="Bernard")
    db_call(client, server.db.generated_contracts.update_one, {"id": m["contract_id"]}, {"$set": {"ends_at": iso(20)}})
    emails.clear()
    run_jobs(api, client)
    mail = last_email(seller["email"], "Votre mandat arrive à échéance")
    assert mail and "prolonger mon mandat" in mail["html"]
    emails.clear()
    run_jobs(api, client)
    assert not last_email(seller["email"], "Votre mandat arrive à échéance"), "un seul e-mail J-30 par échéance"
    # Échéance passée : mandat expiré, annonce retirée (nouveau mandat nécessaire), liste des présentés
    db_call(client, server.db.generated_contracts.update_one, {"id": m["contract_id"]}, {"$set": {"ends_at": iso(-1)}})
    emails.clear()
    assert run_jobs(api, client)["daily:mandate_expiry"] == 1
    mandat = db_call(client, server.db.generated_contracts.find_one, {"id": m["contract_id"]})
    property = db_call(client, server.db.properties.find_one, {"id": c["id"]})
    assert mandat["status"] == "expired" and property["status"] == "mandat_en_attente" and property["mandat_signed"] is False
    mail = last_email(seller["email"], f"Fin de votre mandat n° {signed['registry_number']}")
    assert mail and "Luc Bernard" in mail["html"] and "échéance" in mail["html"]
    rows = client.get("/api/admin/mandates", headers=api.h(api.admin())).json()["mandates"]
    assert next(r for r in rows if r["id"] == m["contract_id"])["status"] == "expired"
    # Un nouveau mandat peut être généré et signé
    m2 = api.mandate(seller, c["id"])
    assert m2["already_signed"] is False and m2["contract_id"] != m["contract_id"]
    assert api.sign_mandate(seller, m2["contract_id"]).json()["listing_status"] == "published"


def test_mandat_caduc_au_retrait_par_la_moderation(api, client):
    seller, c, m, signed = signed_mandate(api, client)
    r = client.put(f"/api/properties/{c['id']}/status", params={"status": "removed", "reason": "coordonnees"}, headers=api.h(api.admin()))
    assert r.status_code == 200
    assert db_call(client, server.db.generated_contracts.find_one, {"id": m["contract_id"]})["status"] == "void"
    assert client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()["mandat"]["status"] == "void"


# ---------- NDA v2 ----------

def test_nda_exige_identite_et_demande_acceptee(api, client, emails):
    seller, c = published(api, client)
    buyer = api.register(uid("repreneur"), "buyer", first="Marie", last="Martin", company_name="Martin Reprise")
    h = api.h(buyer)
    body = {"property_id": c["id"], "doc_type": "nda"}
    r = client.post("/api/contracts/generate-for-signature", headers=h, json=body)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "identity_required"
    api.verify_kyc(buyer)
    r = client.post("/api/contracts/generate-for-signature", headers=h, json=body)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "not_allowed"
    client.post(f"/api/dataroom/{c['id']}/request-access", headers=h)
    r = client.post("/api/contracts/generate-for-signature", headers=h, json=body)
    assert r.status_code == 403, "demande en attente : pas encore acceptée"
    api.accept_dataroom(seller, buyer, c["id"])
    nda = client.post("/api/contracts/generate-for-signature", headers=h, json=body).json()
    text = nda["content"]
    assert "{{" not in text and "Marie Martin" in text and buyer["email"] in text and "Martin Reprise" in text
    assert "SECRET ENERGIE" not in text and "[communiqué après signature]" in text and "500 000 €".replace(" ", " ") in text
    assert "24 mois" in text and "sans l'accord écrit préalable du cédant" in text and "informer sans délai le cédant et l'Opérateur" in text
    assert "origine des fonds" in text and "pénalité" not in text.lower() and "commission" not in text.lower()
    assert "Lettre d'intention" not in text and "LOI" not in text
    emails.clear()
    signed = api.sign_contract(buyer, nda["contract_id"]).json()
    assert signed["identity_revealed"] is True and signed["pdf_url"].startswith(f"/api/documents/{c['id']}/")
    # Repreneur présenté (nom et société révélés), dataroom_access.identity_revealed, e-mails aux deux parties avec lien PDF
    status = client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()
    assert status["presented_buyers"][0] == {**status["presented_buyers"][0], "buyer_id": buyer["id"], "name": "Marie Martin", "company_name": "Martin Reprise"}
    access = db_call(client, server.db.dataroom_access.find_one, {"property_id": c["id"], "buyer_id": buyer["id"]})
    assert access["identity_revealed"] is True and access["nda_signed_at"]
    assert last_email(seller["email"], "Un repreneur a signé l'accord de confidentialité")["html"].count("Marie Martin") >= 1
    buyer_mail = last_email(buyer["email"], "Votre accord de confidentialité est signé")
    link = re.search(r'href="(https://cessionrge.test/api/documents/[^"]+\?token=[^"]+)"', buyer_mail["html"]).group(1)
    r = client.get(link.replace("https://cessionrge.test", ""))
    assert r.status_code == 200 and "ACCORD DE CONFIDENTIALITÉ" in pdf_text(r.content) and "SECRET ENERGIE SAS" in pdf_text(r.content)
    # Le PDF est aussi accessible connecté (signataire, cédant), pas par un tiers
    doc_id = link.split("/pdf")[0].rsplit("/", 1)[1]
    assert client.get(f"/api/documents/{c['id']}/{doc_id}/pdf", headers=api.h(seller)).status_code == 200
    stranger = api.register(uid("tiers"), "buyer")
    assert client.get(f"/api/documents/{c['id']}/{doc_id}/pdf", headers=api.h(stranger)).status_code == 403
    assert client.get(f"/api/documents/{c['id']}/{doc_id}/pdf").status_code == 403
    # Une seconde génération renvoie le document signé
    assert client.post("/api/contracts/generate-for-signature", headers=h, json=body).json()["already_signed"] is True


# ---------- Offre indicative ----------

def test_offre_creation_signature_acceptation_closing(api, client, emails):
    seller, c = published(api, client)
    buyer = presented_buyer(api, client, seller, c["id"])
    r = client.post("/api/offers", headers=api.h(buyer), json={"property_id": c["id"], **OFFER, "validity_days": 10})
    assert r.status_code == 422, "validité entre 15 et 60 jours"
    emails.clear()
    created = client.post("/api/offers", headers=api.h(buyer), json={"property_id": c["id"], **OFFER}).json()
    offer, contract_id = created["offer"], created["contract_id"]
    assert offer["status"] == "pending_signature" and offer["contract_id"] == contract_id and offer["financing"]["loan"] == 300000
    assert offer["validity_days"] == 30 and offer["conditions"] == OFFER["conditions"] and offer["target_date"] == "2027-03-31"
    expires = datetime.fromisoformat(offer["expires_at"])
    assert timedelta(days=29, hours=23) < expires - NOW < timedelta(days=30, hours=1)
    text = created["content"]
    assert "{{" not in text and "480 000 €".replace(" ", " ") in text and "Audit comptable satisfaisant" in text and "Marie Martin" in text
    assert "SECRET ENERGIE SAS" in text and "31/03/2027" in text and "à la charge du Cédant" in text
    # Le cédant ne peut pas répondre avant la signature ; une seconde offre ouverte est refusée
    assert client.put(f"/api/offers/{offer['id']}/respond", headers=api.h(seller), json={"action": "accept"}).status_code == 400
    assert client.post("/api/offers", headers=api.h(buyer), json={"property_id": c["id"], **OFFER}).status_code == 400
    assert client.get(f"/api/offers/{offer['id']}/pdf", headers=api.h(buyer)).status_code == 400
    # Signature du repreneur → pending, e-mail au cédant
    signed = api.sign_contract(buyer, contract_id).json()
    assert signed["status"] == "pending" and signed["offer_id"] == offer["id"]
    mail = last_email(seller["email"], "Offre indicative reçue")
    assert mail and "480" in mail["html"] and "Marie Martin" in mail["html"]
    assert client.get("/api/offers/my", headers=api.h(buyer)).json()["offers"][0]["status"] == "pending"
    # Acceptation : code obligatoire, contre-signature du cédant, étape de vente
    r = client.put(f"/api/offers/{offer['id']}/respond", headers=api.h(seller), json={"action": "accept"})
    assert r.status_code == 400 and "code" in r.json()["detail"].lower()
    code = api.request_code(seller, contract_id)
    emails.clear()
    r = client.put(f"/api/offers/{offer['id']}/respond", headers=api.h(seller), json={"action": "accept", "otp_code": code})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "accepted" and r.json()["closing_id"]
    accepted = r.json()["offer"]
    assert accepted["countersigned_at"] and accepted["closing_id"] == r.json()["closing_id"]
    closing = db_call(client, server.db.closings.find_one, {"offer_id": offer["id"]}, {"_id": 0})
    assert closing["status"] == "in_progress" and closing["sale_object"] == "titres" and closing["offer_amount"] == 480000
    mine = client.get("/api/closing/my", headers=api.h(seller)).json()["closings"]
    assert mine[0]["id"] == closing["id"] and mine[0]["property_title"]
    assert last_email(buyer["email"], "Votre offre de") and last_email(buyer["email"], "Offre acceptée : les prochaines étapes")
    # PDF avec les deux signatures
    pdf = client.get(f"/api/offers/{offer['id']}/pdf", headers=api.h(seller)).json()
    text = pdf_text(base64.b64decode(pdf["content"]))
    assert "OFFRE INDICATIVE" in text and "Signature 1" in text and "Signature 2" in text and "Mandant (cédant)" in text and "Repreneur" in text
    docs = client.get(f"/api/documents/{c['id']}/signed", headers=api.h(seller)).json()
    assert [d["doc_type"] for d in docs].count("offer") == 2 and {d["signer_role"] for d in docs if d["doc_type"] == "offer"} == {"buyer", "seller"}
    # Les offres du cédant : repreneur nommé (NDA signé)
    offers = client.get(f"/api/offers/property/{c['id']}", headers=api.h(seller)).json()["offers"]
    assert offers[0]["buyer_label"] == "Marie Martin" and "buyer_email" not in offers[0]


def test_offre_contre_proposition_acceptee_par_code(api, client, emails):
    seller, c = published(api, client)
    buyer = presented_buyer(api, client, seller, c["id"])
    created = client.post("/api/offers", headers=api.h(buyer), json={"property_id": c["id"], **OFFER}).json()
    offer, contract_id = created["offer"], created["contract_id"]
    api.sign_contract(buyer, contract_id)
    assert client.put(f"/api/offers/{offer['id']}/respond", headers=api.h(seller), json={"action": "counter"}).status_code == 400
    emails.clear()
    r = client.put(f"/api/offers/{offer['id']}/respond", headers=api.h(seller), json={"action": "counter", "counter_amount": 520000, "message": "Prix plancher."})
    assert r.status_code == 200 and r.json()["status"] == "countered"
    mail = last_email(buyer["email"], "Contre-proposition du cédant")
    assert mail and "520" in mail["html"] and "Prix plancher." in mail["html"]
    # Le cédant ne peut plus répondre ; le repreneur accepte avec un code
    assert client.put(f"/api/offers/{offer['id']}/respond", headers=api.h(seller), json={"action": "reject", "reason": "trop tard"}).status_code == 400
    assert client.put(f"/api/offers/{offer['id']}/accept-counter", headers=api.h(seller), json={}).status_code == 403
    assert client.put(f"/api/offers/{offer['id']}/accept-counter", headers=api.h(buyer), json={}).status_code == 400
    code = api.request_code(buyer, contract_id)
    r = client.put(f"/api/offers/{offer['id']}/accept-counter", headers=api.h(buyer), json={"otp_code": code})
    assert r.status_code == 200, r.text
    final = r.json()["offer"]
    assert final["status"] == "accepted" and final["amount"] == 520000 and final["initial_amount"] == 480000 and final["closing_id"]
    assert db_call(client, server.db.closings.find_one, {"offer_id": offer["id"]})["offer_amount"] == 520000
    assert last_email(seller["email"], "Votre contre-proposition de")
    text = pdf_text(base64.b64decode(client.get(f"/api/offers/{offer['id']}/pdf", headers=api.h(buyer)).json()["content"]))
    assert "Contre-proposition du cédant" in text and "Acceptation de la contre-proposition" in text and "520 000 €" in text


def test_offre_refus_motive_et_expiration(api, client, emails):
    seller, c = published(api, client)
    buyer = presented_buyer(api, client, seller, c["id"])
    created = client.post("/api/offers", headers=api.h(buyer), json={"property_id": c["id"], **OFFER}).json()
    api.sign_contract(buyer, created["contract_id"])
    r = client.put(f"/api/offers/{created['offer']['id']}/respond", headers=api.h(seller), json={"action": "reject"})
    assert r.status_code == 400 and r.json()["detail"]["missing"] == ["reason"]
    emails.clear()
    r = client.put(f"/api/offers/{created['offer']['id']}/respond", headers=api.h(seller), json={"action": "reject", "reason": "Prix trop éloigné de mes attentes."})
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert "Prix trop éloigné" in last_email(buyer["email"], "Réponse du cédant à votre offre")["html"]
    # Une nouvelle offre est possible après un refus ; elle expire par la tâche quotidienne
    second = client.post("/api/offers", headers=api.h(buyer), json={"property_id": c["id"], **OFFER, "amount": 500000}).json()
    api.sign_contract(buyer, second["contract_id"])
    db_call(client, server.db.offers.update_one, {"id": second["offer"]["id"]}, {"$set": {"expires_at": iso(-1)}})
    emails.clear()
    assert run_jobs(api, client)["daily:offers_expiry"] == 1
    assert db_call(client, server.db.offers.find_one, {"id": second["offer"]["id"]})["status"] == "expired"
    assert last_email(buyer["email"], "Votre offre de") and last_email(seller["email"], "Votre offre de")
    assert client.put(f"/api/offers/{second['offer']['id']}/respond", headers=api.h(seller), json={"action": "accept", "otp_code": "1"}).status_code == 400
    assert run_jobs(api, client)["daily:offers_expiry"] == 0
    # Sans accès au dossier accordé, pas d'offre
    other = api.register(uid("curieux"), "buyer")
    api.verify_kyc(other)
    r = client.post("/api/offers", headers=api.h(other), json={"property_id": c["id"], **OFFER})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "not_allowed"


# ---------- Chaîne de preuve ----------

def test_chaine_de_preuve_par_utilisateur(api, client):
    seller, c = published(api, client)
    buyer = presented_buyer(api, client, seller, c["id"])
    created = client.post("/api/offers", headers=api.h(buyer), json={"property_id": c["id"], **OFFER}).json()
    api.sign_contract(buyer, created["contract_id"])
    docs = client.get(f"/api/documents/{c['id']}/signed", headers=api.h(buyer)).json()
    assert [d["doc_type"] for d in docs] == ["nda", "offer"], "le repreneur ne voit que ses propres signatures"
    nda, offer = docs
    assert set(nda["evidence"]) >= {"document_sha256", "previous_evidence_sha256", "ip", "user_agent", "identity"}
    assert nda["evidence"]["previous_evidence_sha256"] is None and nda["evidence"]["identity"]["identity_verified"] is True
    assert offer["evidence"]["previous_evidence_sha256"] == nda["evidence_sha256"], "chaque preuve contient l'empreinte de la précédente du même signataire"
    records = {d["id"]: db_call(client, server.db.documents.find_one, {"id": d["id"]}, {"_id": 0}) for d in docs}
    for d in docs:
        assert records[d["id"]]["evidence_sha256"] == server.evidence_sha256(records[d["id"]]["evidence"])
        assert d["pdf_url"] == f"/api/documents/{c['id']}/{d['id']}/pdf" and "access_token" not in d
    # Le cédant voit toutes les signatures de l'annonce (mandat compris), sans adresse e-mail des signataires
    all_docs = client.get(f"/api/documents/{c['id']}/signed", headers=api.h(seller)).json()
    assert [d["doc_type"] for d in all_docs] == ["mandat", "nda", "offer"] and all("signer_email" not in d for d in all_docs)
    assert all_docs[0]["evidence"]["previous_evidence_sha256"] is None
    # La signature du cédant sur l'offre est chaînée à sa signature du mandat
    code = api.request_code(seller, created["contract_id"])
    client.put(f"/api/offers/{created['offer']['id']}/respond", headers=api.h(seller), json={"action": "accept", "otp_code": code})
    all_docs = client.get(f"/api/documents/{c['id']}/signed", headers=api.h(seller)).json()
    seller_sig = [d for d in all_docs if d["signer_role"] == "seller" and d["doc_type"] == "offer"][0]
    assert seller_sig["evidence"]["previous_evidence_sha256"] == all_docs[0]["evidence_sha256"]


# ---------- Étape de vente directe ----------

def test_closing_direct_pour_un_repreneur_presente(api, client, emails):
    seller, c = published(api, client)
    buyer = presented_buyer(api, client, seller, c["id"])
    stranger = api.register(uid("inconnu"), "buyer")
    r = client.post("/api/closing/direct", headers=api.h(seller), json={"property_id": c["id"], "buyer_id": stranger["id"]})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "validation"
    assert client.post("/api/closing/direct", headers=api.h(buyer), json={"property_id": c["id"], "buyer_id": buyer["id"]}).status_code == 403
    emails.clear()
    r = client.post("/api/closing/direct", headers=api.h(seller), json={"property_id": c["id"], "buyer_id": buyer["id"]})
    assert r.status_code == 200, r.text
    clo = r.json()
    assert clo["status"] == "in_progress" and clo["buyer_id"] == buyer["id"] and clo["offer_id"] is None and clo["property_title"]
    assert last_email(buyer["email"], "Offre acceptée : les prochaines étapes")
    # Idempotent pour le même couple ; un second closing direct (autre annonce) ne bloque pas sur l'index offer_id
    assert client.post("/api/closing/direct", headers=api.h(seller), json={"property_id": c["id"], "buyer_id": buyer["id"]}).json()["id"] == clo["id"]
    seller2, c2 = published(api, client)
    buyer2 = presented_buyer(api, client, seller2, c2["id"], first="Anne", last="Leroy")
    r = client.post("/api/closing/direct", headers=api.h(seller2), json={"property_id": c2["id"], "buyer_id": buyer2["id"]})
    assert r.status_code == 200 and r.json()["id"] != clo["id"]
    mine = client.get("/api/closing/my", headers=api.h(buyer)).json()["closings"]
    assert mine[0]["id"] == clo["id"] and mine[0]["property_title"]


# ---------- Gabarits et suppression de la LOI ----------

def test_gabarits_emails_et_loi_supprimee(api, client):
    for tpl in ("mandate_signed_pdf", "mandate_j30", "mandate_denounced", "mandate_ended", "nda_signed_buyer", "nda_signed_seller",
                "offer_received", "offer_accepted", "offer_rejected", "offer_countered", "offer_expired"):
        assert tpl in business_model.EMAIL_TEMPLATES and "à compléter" not in business_model.EMAIL_TEMPLATES[tpl]["html"].lower()
    assert not hasattr(server, "DEFAULT_LOI_TEMPLATE")
    for tpl in (server.DEFAULT_MANDAT_TEMPLATE, server.DEFAULT_NDA_TEMPLATE, server.DEFAULT_OFFER_TEMPLATE):
        assert "à préciser" not in tpl and "☐" not in tpl and "[ ]" not in tpl
    assert client.post("/api/loi/countersign/x", headers=api.h(api.admin()), json={}).status_code in (404, 405)
    metrics = client.get("/api/admin/metrics", headers=api.h(api.admin())).json()
    assert "loi_signed" not in metrics["totals"] and "offers_signed" in metrics["totals"]
    assert all("LOI" not in step["step"] for step in metrics["funnel"])
