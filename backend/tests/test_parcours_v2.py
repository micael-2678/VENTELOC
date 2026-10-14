"""Parcours v2 (SPEC §4.1, §4.3, §4.4, §5.2, §6.1, §6.3, §6.4 ; API.md §1 à §4, §8, §9) :
profil acquéreur et score, contact et conversations, carte acquéreur, demande de dossier (acceptation automatique,
relances, expiration, origine des fonds → accès), filtres et tri des annonces, actions du vendeur, alertes sans compte,
e-mails et jobs de relance, KPI et coûts admin."""
import re
import uuid
from datetime import datetime, timedelta, timezone

import opendata
import server
from conftest import listing, sent_emails


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


def ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def reset_daily_gate(client):
    """Autorise une nouvelle relance le même jour (la règle « un e-mail de relance par jour et par personne » est testée à part)"""
    db_call(client, server.db.job_marks.delete_many, {"kind": "reminder_day"})


def run_jobs(api, client, emails=None, reset_gate=False):
    if emails is not None:
        emails.clear()
    if reset_gate:
        reset_daily_gate(client)
    r = client.post("/api/admin/jobs/run", headers=api.h(api.admin()))
    assert r.status_code == 200, r.text
    result = r.json()
    assert all(isinstance(v, int) for v in result.values()), result
    return result


def unique_siret():
    """SIRET au format valide (clés de Luhn) propre au test, pour un bien détenu par une SCI"""
    base = f"{uuid.uuid4().int % 10**8:08d}"
    siren = next(base + d for d in "0123456789" if opendata.luhn_ok(base + d))
    return next(siren + "0001" + d for d in "0123456789" if opendata.luhn_ok(siren + "0001" + d))


def published_listing(api, client, **extra):
    seller = api.register(uid("vendeur"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(**extra)).json()
    api.publish(seller, c["id"])
    return seller, c


def plain(html):
    return html.replace(chr(0x202F), " ").replace(chr(0xA0), " ")


def mails_to(emails, to, subject_part):
    return [e for e in emails if e["to"] == to and subject_part.lower() in e["subject"].lower()]


# ---------- §4 : profil acquéreur et score ----------

def test_profile_score_and_thresholds(api, client):
    buyer = api.register(uid("sansprofil"), "buyer", profile=False)
    me = client.get("/api/auth/profile", headers=api.h(buyer)).json()
    assert me["profile_score"] == 0 and me["buyer_profile"] == {} and "project_type" in me["profile_missing"]
    assert me["email_verified"] is True and "password_hash" not in me and me["notifications_opt_out"] is False
    # Barème (SPEC §4) : project_type 15, budget_max 15, apport 10, financing 10, zones 10, property_types 10, min_yield 10,
    # horizon 10, téléphone 10
    r = client.put("/api/auth/profile", headers=api.h(buyer), json={"buyer_profile": {"project_type": "particulier", "budget_max": 400000}})
    assert r.status_code == 200 and r.json()["user"]["profile_score"] == 30
    r = client.put("/api/auth/profile", headers=api.h(buyer), json={"phone": "0612345678"})
    assert r.json()["user"]["profile_score"] == 40
    r = client.put("/api/auth/profile", headers=api.h(buyer), json={"buyer_profile": {"project_type": "particulier", "budget_max": 400000,
                                                                                   "min_yield": 5.5}})
    assert r.json()["user"]["profile_score"] == 50 and "min_yield" not in r.json()["user"]["profile_missing"]
    full = api.buyer_profile(buyer)
    assert full["profile_score"] == 100 and full["profile_missing"] == []
    # Types de biens inconnus ignorés, régions par slug acceptées
    r = client.put("/api/auth/profile", headers=api.h(buyer), json={"buyer_profile": {**api.BUYER_PROFILE, "property_types": ["inconnu", "parking"],
                                                                                   "zones": ["bretagne", "Atlantide"]}})
    user = r.json()["user"]
    assert user["profile_score"] == 100 and user["buyer_profile"]["property_types"] == ["parking"] and user["buyer_profile"]["zones"] == ["Bretagne"]
    # Achat en société : SIREN vérifié par l'open data (simulée), jamais compté dans le score
    r = client.put("/api/auth/profile", headers=api.h(buyer), json={"buyer_profile": {**api.BUYER_PROFILE, "project_type": "sci", "siren": "552 032 534"}})
    user = r.json()["user"]
    assert user["buyer_profile"]["siren_verified"] is True and user["buyer_profile"]["company_name"] == "SCI DES TILLEULS"
    assert user["profile_score"] == 100
    # Valeurs hors référentiel refusées
    for bad in ({"project_type": "croissance-externe"}, {"financing": "credit-vendeur"}, {"min_yield": 25}, {"budget_max": -1}):
        r = client.put("/api/auth/profile", headers=api.h(buyer), json={"buyer_profile": {**api.BUYER_PROFILE, **bad}})
        assert r.status_code in (400, 422), bad
    # Téléphone invalide refusé, préférence de notifications
    r = client.put("/api/auth/profile", headers=api.h(buyer), json={"phone": "12"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "validation"
    r = client.put("/api/auth/profile", headers=api.h(buyer), json={"notifications_opt_out": True, "first_name": "Marie"})
    assert r.json()["user"]["notifications_opt_out"] is True and r.json()["user"]["first_name"] == "Marie"


def test_register_buyer_with_profile_and_company_siren(api, client, monkeypatch):
    r = client.post("/api/auth/register", json={"email": uid("acq"), "password": "Password1!", "role": "buyer", "first_name": "Luc",
                                                 "last_name": "Rey", "phone": "06 00 00 00 00", "source": "google",
                                                 "buyer_profile": {**api.BUYER_PROFILE, "project_type": "societe", "siren": "552032534",
                                                                   "experience": "Trois appartements loués à Lyon, tél 06 11 22 33 44"}})
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["profile_score"] == 100 and user["buyer_profile"]["siren_verified"] is True and user["acquisition_source"] == "google"
    assert "06 11 22 33 44" not in user["buyer_profile"]["experience"], "coordonnées masquées (carte présentée avant l'engagement)"
    # Vendeur : pas de profil ni de score ; un SIRET envoyé à l'inscription est ignoré (il se saisit sur l'annonce)
    r = client.post("/api/auth/register", json={"email": uid("vend"), "password": "Password1!", "role": "seller", "first_name": "Paul",
                                                 "last_name": "Dupont", "siret": "123 456 789 00011"})
    user = r.json()["user"]
    assert r.status_code == 200 and "profile_score" not in user and "siret" not in user
    # Open data indisponible : SIREN « non vérifié », jamais bloquant
    def down(url):
        raise RuntimeError("réseau")
    monkeypatch.setattr(opendata, "fetch_json", down)
    opendata.clear_cache()
    r = client.post("/api/auth/register", json={"email": uid("acq2"), "password": "Password1!", "role": "buyer", "first_name": "Ana",
                                                 "last_name": "Roy", "buyer_profile": {**api.BUYER_PROFILE, "project_type": "sci", "siren": "987654321",
                                                                                       "company_name": "SCI Roy"}})
    assert r.status_code == 200
    profile = r.json()["user"]["buyer_profile"]
    assert profile["siren_verified"] is False and profile["company_name"] == "SCI Roy"
    opendata.clear_cache()


# ---------- §4.3.4 : contact et conversations ----------

def test_contact_requires_profile_and_verified_email(api, client, emails):
    seller, c = published_listing(api, client)
    nobody = api.register(uid("vide"), "buyer", profile=False)
    r = client.post(f"/api/properties/{c['id']}/contact", headers=api.h(nobody), json={"message": "Bonjour"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "profile_incomplete" and r.json()["detail"]["profile_score"] == 0
    assert client.post(f"/api/dataroom/{c['id']}/request-access", headers=api.h(nobody)).status_code == 403
    unverified = api.register(uid("nonconfirme"), "buyer", verify_email=False)
    r = client.post(f"/api/properties/{c['id']}/contact", headers=api.h(unverified), json={"message": "Bonjour"})
    assert r.status_code == 403 and r.json()["detail"].startswith("Confirmez")
    # Profil à 40 : contact possible
    weak = api.buyer_profile(nobody, score_min=40, property_types=[], zones=[], horizon=None, apport=None, financing=None, min_yield=None)
    assert weak["profile_score"] == 40
    r = client.post(f"/api/properties/{c['id']}/contact", headers=api.h(nobody), json={"message": "J'investis dans l'ancien loué à Lyon"})
    assert r.status_code == 200 and r.json()["conversation_id"] and r.json()["already_contacted"] is False
    assert client.get(f"/api/properties/{c['id']}/contact", headers=api.h(seller)).status_code == 405
    assert client.post(f"/api/properties/{c['id']}/contact", headers=api.h(seller), json={"message": "x"}).status_code == 403


def test_conversation_per_pair_cards_and_recipients(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("acq"), "buyer", first="Marie", last="Martin", company_name="SCI Martin")
    other = api.register(uid("autre"), "buyer")
    emails.clear()
    r = client.post(f"/api/properties/{c['id']}/contact", headers=api.h(buyer), json={"message": "Mon projet : un premier investissement locatif. Mon tél 06 11 22 33 44"})
    conv_id = r.json()["conversation_id"]
    # Même couple → même conversation ; autre acquéreur → autre conversation
    again = client.post(f"/api/properties/{c['id']}/contact", headers=api.h(buyer), json={"message": "Relance"}).json()
    assert again["conversation_id"] == conv_id and again["already_contacted"] is True
    other_conv = client.post(f"/api/properties/{c['id']}/contact", headers=api.h(other), json={"message": "Bonjour"}).json()["conversation_id"]
    assert other_conv != conv_id
    # E-mail « premier contact » au vendeur avec la carte pseudonymisée et l'extrait (coordonnées masquées)
    first = mails_to(emails, seller["email"], "présente son projet")
    assert len(first) == 2 and "Investisseur particulier" in first[0]["html"] and "Rendement brut visé" in first[0]["html"] and "Marie" not in first[0]["html"] and "06 11 22 33 44" not in first[0]["html"]
    assert "Ne plus recevoir" not in first[0]["html"], "e-mail transactionnel : pas de lien de désinscription"
    assert mails_to(emails, buyer["email"], "transmis au vendeur")

    # Côté vendeur : tableau API.md §3 avec carte pseudonymisée ; côté acquéreur : titre de l'annonce, pas de carte
    convs = client.get("/api/messages/conversations", headers=api.h(seller)).json()
    mine = next(x for x in convs if x["id"] == conv_id)
    assert mine["property_id"] == c["id"] and mine["buyer_id"] == buyer["id"] and mine["seller_id"] == seller["id"]
    assert mine["unread_count"] == 2 and mine["nda_signed"] is False and mine["identity_revealed"] is False and mine["access_status"] is None
    assert mine["buyer_card"]["label"].startswith("Acquéreur n°") and mine["buyer_card"]["project_type"] == "particulier"
    assert mine["buyer_card"]["property_types"] == ["appartement", "maison"] and mine["buyer_card"]["min_yield"] == 4
    assert "name" not in mine["buyer_card"] and "email" not in str(mine) and "phone" not in str(mine["buyer_card"])
    assert mine["other_party_label"] == mine["buyer_card"]["label"] and mine["property_title"].startswith("Appartement T2 loué")
    buyer_view = client.get("/api/messages/conversations", headers=api.h(buyer)).json()
    assert [x["id"] for x in buyer_view] == [conv_id] and "buyer_card" not in buyer_view[0] and buyer_view[0]["other_party_label"] == "Vendeur"
    assert client.get("/api/messages/conversations", headers=api.h(other)).json()[0]["id"] == other_conv

    # Messages de la conversation : le vendeur répond sans receiver_id, le bon destinataire reçoit, coordonnées masquées avant NDA
    r = client.post("/api/messages", headers=api.h(seller), json={"conversation_id": conv_id, "content": "Merci, appelez-moi au 06 99 88 77 66"})
    assert r.status_code == 200 and r.json()["receiver_id"] == buyer["id"] and "06 99 88 77 66" not in r.json()["content"]
    thread = client.get("/api/messages", params={"conversation_id": conv_id}, headers=api.h(buyer)).json()
    assert [m["is_mine"] for m in thread] == [True, True, False] and thread[-1]["sender_label"] == "Vendeur" and thread[-1]["kind"] == "message"
    assert all("06 11 22 33 44" not in m["content"] for m in thread)
    # Un tiers ne lit ni n'écrit dans la conversation
    assert client.get("/api/messages", params={"conversation_id": conv_id}, headers=api.h(other)).status_code == 403
    assert client.post("/api/messages", headers=api.h(other), json={"conversation_id": conv_id, "content": "spam"}).status_code == 403
    # Lecture
    assert client.put(f"/api/messages/conversations/{conv_id}/read", headers=api.h(buyer)).json()["ok"] is True
    assert client.get("/api/messages/conversations", headers=api.h(buyer)).json()[0]["unread_count"] == 0

    # Après l'engagement de confidentialité : carte révélée (nom, société), conversation nda_signed / identity_revealed
    api.verify_kyc(buyer)
    api.accept_dataroom(seller, buyer, c["id"])
    api.sign_nda(buyer, c["id"])
    mine = next(x for x in client.get("/api/messages/conversations", headers=api.h(seller)).json() if x["id"] == conv_id)
    assert mine["nda_signed"] is True and mine["identity_revealed"] is True and mine["access_status"] == "accepted"
    assert mine["buyer_card"]["name"] == "Marie Martin" and mine["buyer_card"]["company_name"] == "SCI Martin"
    assert mine["other_party_label"] == "Marie Martin"
    # Les messages système (engagement signé) sont rattachés à la conversation
    thread = client.get("/api/messages", params={"conversation_id": conv_id}, headers=api.h(seller)).json()
    assert any(m["kind"] == "system" for m in thread)


def test_legacy_messages_are_grouped_into_conversations(api, client):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("ancien"), "buyer")
    # Messages historiques sans conversation_id (forme antérieure à la refonte)
    old = ago(3)
    db_call(client, server.db.messages.insert_many, [
        {"id": str(uuid.uuid4()), "sender_id": buyer["id"], "sender_email": buyer["email"], "receiver_id": seller["id"],
         "property_id": c["id"], "content": "Ancien message", "read": False, "created_at": old},
        {"id": str(uuid.uuid4()), "sender_id": seller["id"], "sender_email": seller["email"], "receiver_id": buyer["id"],
         "property_id": c["id"], "content": "Ancienne réponse", "read": True, "created_at": ago(2)},
    ])
    convs = client.get("/api/messages/conversations", headers=api.h(seller)).json()
    conv = next(x for x in convs if x["property_id"] == c["id"] and x["buyer_id"] == buyer["id"])
    assert conv["last_message"] == "Ancienne réponse" and conv["unread_count"] == 1
    thread = client.get("/api/messages", params={"conversation_id": conv["id"]}, headers=api.h(buyer)).json()
    assert [m["content"] for m in thread] == ["Ancien message", "Ancienne réponse"]
    # L'ancienne forme d'envoi (receiver_id + property_id) rejoint la même conversation
    r = client.post("/api/messages", headers=api.h(buyer), json={"receiver_id": seller["id"], "property_id": c["id"], "content": "Suite"})
    assert r.status_code == 200 and r.json()["conversation_id"] == conv["id"]
    assert client.put(f"/api/messages/conversations/{c['id']}/read", headers=api.h(seller)).json()["ok"] is True


# ---------- §4.3.5 : demande de dossier ----------

def test_dataroom_request_auto_accept_and_steps(api, client, emails):
    seller, c = published_listing(api, client, auto_accept_dataroom=True)
    assert "auto_accept_dataroom" not in client.get(f"/api/properties/{c['id']}").json()
    weak = api.register(uid("faible"), "buyer", profile=False)
    api.buyer_profile(weak, score_min=40, property_types=[], zones=[], horizon=None, apport=None, financing=None, min_yield=None)
    assert weak["profile_score"] == 40
    emails.clear()
    r = client.post(f"/api/dataroom/{c['id']}/request-access", headers=api.h(weak), json={"message": "Je souhaite voir le bail et les quittances"})
    assert r.status_code == 200 and r.json()["status"] == "pending", "score 40 : acceptation manuelle"
    assert mails_to(emails, seller["email"], "Demande de dossier")
    status = client.get(f"/api/dataroom/{c['id']}/access-status", headers=api.h(weak)).json()
    assert status["access_status"] == "pending" and status["access_granted"] is False and status["request"]["expires_at"] and status["next_step"] is None

    strong = api.register(uid("fort"), "buyer")
    emails.clear()
    r = client.post(f"/api/dataroom/{c['id']}/request-access", headers=api.h(strong), json={})
    assert r.status_code == 200 and r.json()["status"] == "accepted" and r.json()["auto_accepted"] is True
    status = client.get(f"/api/dataroom/{c['id']}/access-status", headers=api.h(strong)).json()
    assert status["access_status"] == "accepted" and status["steps"] == {"identity": False, "nda": False, "funds": False} and status["next_step"] == "identity"
    assert mails_to(emails, strong["email"], "Dossier accepté") and mails_to(emails, seller["email"], "acceptée automatiquement")
    # Demande déjà enregistrée : idempotent
    assert client.post(f"/api/dataroom/{c['id']}/request-access", headers=api.h(strong)).json()["already_requested"] is True
    # Côté vendeur : tableau avec carte, étapes, message, conversation
    reqs = client.get(f"/api/dataroom/{c['id']}/access-requests", headers=api.h(seller)).json()
    by_buyer = {r["buyer_id"]: r for r in reqs}
    assert by_buyer[weak["id"]]["status"] == "pending" and by_buyer[weak["id"]]["message"] == "Je souhaite voir le bail et les quittances" and by_buyer[weak["id"]]["expires_at"]
    assert by_buyer[strong["id"]]["status"] == "accepted" and by_buyer[strong["id"]]["auto_accepted"] is True and by_buyer[strong["id"]]["steps"]["identity"] is False
    assert by_buyer[strong["id"]]["conversation_id"] and "email" not in str(reqs)
    # Les étapes sont ordonnées : fonds refusés avant identité, puis avant l'engagement
    r = client.post(f"/api/dataroom/{c['id']}/funds-declaration", headers=api.h(strong), json={"source": "mixte", "amount": 300000})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "identity_required"
    api.verify_kyc(strong)
    r = client.post(f"/api/dataroom/{c['id']}/funds-declaration", headers=api.h(strong), json={"source": "mixte", "amount": 300000})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "nda_required"
    assert client.get(f"/api/dataroom/{c['id']}/access-status", headers=api.h(strong)).json()["next_step"] == "nda"
    api.sign_nda(strong, c["id"])
    status = client.get(f"/api/dataroom/{c['id']}/access-status", headers=api.h(strong)).json()
    assert status["next_step"] == "funds" and status["access_granted"] is False
    emails.clear()
    r = client.post(f"/api/dataroom/{c['id']}/funds-declaration", headers=api.h(strong), json={"source": "emprunt", "amount": 300000, "financing_partner": "Banque Test"})
    assert r.status_code == 200 and r.json()["access_granted"] is True
    status = client.get(f"/api/dataroom/{c['id']}/access-status", headers=api.h(strong)).json()
    assert status["access_granted"] is True and status["access_status"] == "granted" and status["next_step"] is None
    assert mails_to(emails, strong["email"], "accès au dossier est ouvert") and mails_to(emails, seller["email"], "accède à votre dossier")
    assert client.get(f"/api/dataroom/{c['id']}/documents", headers=api.h(strong)).json()["access_granted"] is True
    # Le vendeur voit la déclaration ; l'acquéreur figure sur la liste des présentés
    req = next(r for r in client.get(f"/api/dataroom/{c['id']}/access-requests", headers=api.h(seller)).json() if r["buyer_id"] == strong["id"])
    assert req["status"] == "granted" and req["funds_declaration"]["source"] == "emprunt" and req["buyer_card"]["name"] == "Jean Test"


def test_funds_declared_before_nda_then_granted_at_signature(api, client):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    api.accept_dataroom(seller, buyer, c["id"])
    api.verify_kyc(buyer)
    # Fonds déclarés en base avant l'engagement (par exemple ancien parcours) : sa signature ouvre l'accès
    db_call(client, server.db.dataroom_access.update_one, {"property_id": c["id"], "buyer_id": buyer["id"]},
            {"$set": {"funds_declaration": {"source": "fonds-propres", "amount": 200000}}})
    api.sign_nda(buyer, c["id"])
    status = client.get(f"/api/dataroom/{c['id']}/access-status", headers=api.h(buyer)).json()
    assert status["access_granted"] is True and status["steps"] == {"identity": True, "nda": True, "funds": True}


def test_dataroom_reminders_and_expiry(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    client.post(f"/api/dataroom/{c['id']}/request-access", headers=api.h(buyer))
    # J+3 : relance J+2 du vendeur, une seule fois ; un seul e-mail de relance par jour et par personne
    db_call(client, server.db.dataroom_access.update_one, {"property_id": c["id"], "buyer_id": buyer["id"]},
            {"$set": {"requested_at": ago(3), "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()}})
    run_jobs(api, client, emails)
    reminders = mails_to(emails, seller["email"], "attend votre réponse depuis")
    # Relance d'une démarche engagée par un acquéreur : transactionnelle (pas de lien de désinscription)
    assert len(reminders) == 1 and "2 jours" in reminders[0]["subject"] and "Ne plus recevoir" not in reminders[0]["html"]
    run_jobs(api, client, emails)
    assert not mails_to(emails, seller["email"], "attend votre réponse"), "idempotent"
    status = client.get(f"/api/dataroom/{c['id']}/access-status", headers=api.h(buyer)).json()
    assert status["access_status"] == "pending"
    # J+10 : expiration, e-mail à l'acquéreur, nouvelle demande possible, ligne admin
    db_call(client, server.db.dataroom_access.update_one, {"property_id": c["id"], "buyer_id": buyer["id"]},
            {"$set": {"requested_at": ago(11), "expires_at": ago(1)}})
    run_jobs(api, client, emails)
    assert mails_to(emails, buyer["email"], "n'a pas répondu")
    status = client.get(f"/api/dataroom/{c['id']}/access-status", headers=api.h(buyer)).json()
    assert status["access_status"] == "expired" and status["request"]["expires_at"] is None
    run_jobs(api, client, emails)
    assert not mails_to(emails, buyer["email"], "n'a pas répondu")
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    sections = {s["key"]: s for s in todo["sections"]}
    assert {"dataroom_unanswered", "dataroom_expired", "reports", "listings_review"} <= set(sections)
    assert any(r["ref"].get("buyer_id") == buyer["id"] for r in sections["dataroom_expired"]["rows"])
    r = client.post(f"/api/dataroom/{c['id']}/request-access", headers=api.h(buyer), json={"message": "Je renouvelle ma demande"})
    assert r.status_code == 200 and r.json()["status"] == "pending"
    # Le vendeur accepte en un geste puis le refus d'une autre demande porte un motif
    req = next(x for x in client.get(f"/api/dataroom/{c['id']}/access-requests", headers=api.h(seller)).json() if x["buyer_id"] == buyer["id"])
    assert client.put(f"/api/dataroom/{c['id']}/access/{req['id']}/validate", headers=api.h(seller)).json()["status"] == "accepted"
    other = api.register(uid("autre"), "buyer")
    client.post(f"/api/dataroom/{c['id']}/request-access", headers=api.h(other))
    req2 = next(x for x in client.get(f"/api/dataroom/{c['id']}/access-requests", headers=api.h(seller)).json() if x["buyer_id"] == other["id"])
    emails.clear()
    r = client.put(f"/api/dataroom/{c['id']}/access/{req2['id']}/reject", headers=api.h(seller), json={"reason": "Budget insuffisant pour ce bien"})
    assert r.json()["status"] == "rejected"
    assert "Budget insuffisant pour ce bien" in mails_to(emails, other["email"], "Réponse du vendeur")[0]["html"]
    assert client.get(f"/api/dataroom/{c['id']}/access-status", headers=api.h(other)).json()["access_status"] == "rejected"


def test_buyer_reminders_identity_nda_dataroom(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    api.accept_dataroom(seller, buyer, c["id"])
    db_call(client, server.db.dataroom_access.update_one, {"property_id": c["id"], "buyer_id": buyer["id"]}, {"$set": {"accepted_at": ago(3)}})
    run_jobs(api, client, emails)
    assert mails_to(emails, buyer["email"], "Vérifiez votre identité")
    run_jobs(api, client, emails)
    assert not mails_to(emails, buyer["email"], "Vérifiez votre identité")
    api.verify_kyc(buyer)
    db_call(client, server.db.dataroom_access.update_one, {"property_id": c["id"], "buyer_id": buyer["id"]}, {"$set": {"accepted_at": ago(8)}})
    run_jobs(api, client, emails)
    assert not [e for e in emails if e["to"] == buyer["email"]], "un seul e-mail de relance par jour et par personne"
    run_jobs(api, client, emails, reset_gate=True)
    assert mails_to(emails, buyer["email"], "Signez l'engagement de confidentialité")
    api.grant_dataroom(seller, buyer, c["id"])
    db_call(client, server.db.dataroom_access.update_one, {"property_id": c["id"], "buyer_id": buyer["id"]}, {"$set": {"granted_at": ago(4)}})
    run_jobs(api, client, emails, reset_gate=True)
    assert mails_to(emails, buyer["email"], "vous attend")
    # L'acquéreur qui a refusé les e-mails d'information ne reçoit plus les relances
    db_call(client, server.db.dataroom_access.update_one, {"property_id": c["id"], "buyer_id": buyer["id"]}, {"$set": {"granted_at": ago(4)}})
    db_call(client, server.db.job_marks.delete_many, {"kind": "buyer_dataroom_unvisited"})
    client.put("/api/auth/profile", headers=api.h(buyer), json={"notifications_opt_out": True})
    run_jobs(api, client, emails, reset_gate=True)
    assert not [e for e in emails if e["to"] == buyer["email"]]


# ---------- §4.3.1 / API.md §2 : annonces ----------

def test_public_listing_filters_and_scrub(api, client):
    # Brest : appartement 150 000 €, 750 €/mois → 6 % brut ; Toulouse : local commercial 400 000 €, 3 000 €/mois → 9 % brut
    seller1, c1 = published_listing(api, client, siret=unique_siret(), name="SCI Iroise", postal_code="29200", city="Brest",
                                    asking_price=150000, rent_monthly=750, surface=38)
    seller2, c2 = published_listing(api, client, property_type="local-commercial", lease_type="commercial", postal_code="31000",
                                    city="Toulouse", asking_price=400000, rent_monthly=3000, surface=120, rooms=None, is_copro=False,
                                    dpe_class="D", indexation="ilc", lease_end="2032-06-30")
    assert c1["gross_yield"] == 6.0 and c2["gross_yield"] == 9.0 and c1["region"] == "Bretagne" and c2["department"] == "31"
    r = client.get("/api/properties", params={"property_types": "local-commercial,bureaux", "limit": 100})
    ids = [x["id"] for x in r.json()]
    assert c2["id"] in ids and c1["id"] not in ids and r.headers["X-Total-Count"] == str(len(ids))
    leases = [x["id"] for x in client.get("/api/properties", params={"lease_types": "habitation-vide", "limit": 100}).json()]
    assert c1["id"] in leases and c2["id"] not in leases
    occitanie = [x["id"] for x in client.get("/api/properties", params={"region": "Occitanie", "limit": 100}).json()]
    assert c2["id"] in occitanie and c1["id"] not in occitanie
    assert [x["id"] for x in client.get("/api/properties", params={"region": "occitanie", "department": "31", "property_types": "local-commercial"}).json()] == [c2["id"]]
    dep29 = [x["id"] for x in client.get("/api/properties", params={"department": "29", "limit": 100}).json()]
    assert c1["id"] in dep29 and c2["id"] not in dep29
    priced = [x["id"] for x in client.get("/api/properties", params={"min_price": 350000, "max_price": 450000, "limit": 100}).json()]
    assert c2["id"] in priced and c1["id"] not in priced
    # Rendement brut et surface minimum
    high = [x["id"] for x in client.get("/api/properties", params={"min_yield": 8.5, "limit": 100}).json()]
    assert c2["id"] in high and c1["id"] not in high
    mid = [x["id"] for x in client.get("/api/properties", params={"min_yield": 5.5, "limit": 100}).json()]
    assert {c1["id"], c2["id"]} <= set(mid)
    big = [x["id"] for x in client.get("/api/properties", params={"min_surface": 100, "limit": 100}).json()]
    assert c2["id"] in big and c1["id"] not in big
    r = client.post("/api/properties/search", json={"min_surface": 100, "department": "31"})
    assert [x["id"] for x in r.json()] == [c2["id"]]
    # Tris : prix décroissant, rendement décroissant, plus récentes
    prices = [x.get("asking_price") or 0 for x in client.get("/api/properties", params={"sort": "price_desc", "limit": 100}).json()]
    assert prices == sorted(prices, reverse=True)
    yields = [x.get("gross_yield") or 0 for x in client.get("/api/properties", params={"sort": "yield_desc", "limit": 100}).json()]
    assert yields == sorted(yields, reverse=True)
    page = client.get("/api/properties", params={"sort": "recent", "limit": 1, "page": 2})
    assert len(page.json()) == 1 and int(page.headers["X-Total-Count"]) >= 2
    recent = client.get("/api/properties", params={"sort": "recent", "limit": 2}).json()
    assert recent[0]["id"] == c2["id"]
    # Champs publics (API.md §2) : jamais l'adresse, la dénomination, le SIRET, l'adresse du mandant, le vendeur
    pub = client.get(f"/api/properties/{c1['id']}").json()
    for forbidden in ("address", "address_key", "company_name", "siret", "seller_id", "seller_email", "mandant_address",
                      "mandant_capacity", "presented_buyers", "auto_accept_dataroom", "blocking", "company_lookup"):
        assert forbidden not in pub, forbidden
    assert pub["title"] == "Appartement T2 loué · 38 m² · Brest (29)" and pub["department"] == "29" and pub["region"] == "Bretagne"
    assert pub["postal_code"] == "29200" and pub["city"] == "Brest" and pub["gross_yield"] == 6.0 and pub["net_yield"] is not None
    assert set(pub["property_checks"]) == {"ownership_verified", "dpe_rental_status"} and pub["ownership"] == {"status": "pending"}
    assert pub["commission_info"]["payer"] == "vendeur"
    # POST /properties/search : mêmes filtres, X-Total-Count
    r = client.post("/api/properties/search", json={"property_types": ["local-commercial"], "department": "31", "min_yield": 9})
    assert [x["id"] for x in r.json()] == [c2["id"]] and r.headers["X-Total-Count"] == "1" and "siret" not in r.json()[0]
    assert client.post("/api/properties/search", json={"lease_types": ["commercial"], "limit": 1}).status_code == 200
    # Statistiques publiques : uniquement des comptages > 0
    stats = client.get("/api/public/listing-stats").json()
    assert stats["total"] >= 2
    assert any(d["value"] == "31" and d["label"] == "Haute-Garonne" for d in stats["by_department"])
    assert any(t["value"] == "local-commercial" and t["label"] == "Local commercial" for t in stats["by_property_type"])
    assert all(row["count"] > 0 for key in ("by_property_type", "by_lease_type", "by_department", "by_region") for row in stats[key])
    # Le vendeur voit ses propres annonces avec tous les champs (GET /properties avec son jeton, ou /properties/seller/mine)
    own = client.get("/api/properties", headers=api.h(seller1)).json()
    assert [x["id"] for x in own] == [c1["id"]] and own[0]["company_name"] == "SCI Iroise" and own[0]["address"]
    mine = client.get("/api/properties/seller/mine", headers=api.h(seller1)).json()
    assert [x["id"] for x in mine] == [c1["id"]]


def test_seller_status_actions_and_tail_clause(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer", first="Marie", last="Martin")
    api.verify_kyc(buyer)
    api.accept_dataroom(seller, buyer, c["id"])
    api.sign_nda(buyer, c["id"])
    other = api.register(uid("autrevendeur"), "seller")
    url = f"/api/properties/{c['id']}/status"
    assert client.put(url, params={"status": "paused"}, headers=api.h(other)).status_code == 403
    assert client.put(url, params={"status": "removed", "reason": "autre"}, headers=api.h(seller)).status_code == 403
    assert client.put(url, params={"status": "paused"}, headers=api.h(seller)).json()["status"] == "paused"
    assert client.get(f"/api/properties/{c['id']}").status_code == 404
    r = client.put(url, params={"status": "paused"}, headers=api.h(seller))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "validation"
    assert client.put(url, params={"status": "published"}, headers=api.h(seller)).json()["status"] == "published"
    assert client.get(f"/api/properties/{c['id']}").status_code == 200
    emails.clear()
    assert client.put(url, params={"status": "sold_elsewhere"}, headers=api.h(seller)).json()["status"] == "sold_elsewhere"
    mail = mails_to(emails, seller["email"], "en dehors de la plateforme")
    assert mail and "Marie Martin" in mail[0]["html"] and "clause de suite" in mail[0]["html"].lower()
    stored = db_call(client, server.db.properties.find_one, {"id": c["id"]})
    assert stored["status"] == "sold_elsewhere" and stored["sold_elsewhere_at"]
    # Vendue autrement → définitif ; une autre annonce peut être retirée
    assert client.put(url, params={"status": "published"}, headers=api.h(seller)).status_code == 400
    seller2, c2 = published_listing(api, client, siret=unique_siret())
    assert client.put(f"/api/properties/{c2['id']}/status", params={"status": "withdrawn"}, headers=api.h(seller2)).json()["status"] == "withdrawn"


def test_property_update_mandant_address_object_and_price_drop(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("fan"), "buyer")
    client.post("/api/favorites", headers=api.h(buyer), json={"property_id": c["id"]})
    r = client.put(f"/api/properties/{c['id']}", headers=api.h(seller),
                   json={"mandant_address": {"line1": "1 rue du Port", "postal_code": "29200", "city": "Brest"}, "mandant_capacity": "coindivisaire"})
    assert r.status_code == 200 and r.json()["mandant_address"]["city"] == "Brest" and r.json()["mandant_capacity"] == "coindivisaire"
    assert server.fmt_address(r.json()["mandant_address"]) == "1 rue du Port, 29200 Brest"
    assert client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"mandant_address": {"line1": "x", "postal_code": "29", "city": "B"}}).status_code == 422
    emails.clear()
    r = client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"asking_price": 180000})
    assert r.json()["gross_yield"] == round(800 * 12 * 100 / 180000, 2), "rendement recalculé à chaque mise à jour"
    mail = mails_to(emails, buyer["email"], "Baisse de prix")
    assert mail and "180 000" in plain(mail[0]["html"]) and "Ne plus recevoir" in mail[0]["html"]
    emails.clear()
    client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"asking_price": 190000})
    assert not mails_to(emails, buyer["email"], "Baisse de prix"), "hausse : pas d'e-mail"


# ---------- API.md §8 : alertes ----------

def confirm_link(emails, to):
    mail = mails_to(emails, to, "Confirmez votre alerte")
    assert mail, "aucun e-mail de confirmation"
    return re.search(r"/api/alerts/confirm/([A-Za-z0-9_\-\.]+)", mail[-1]["html"]).group(1)


def test_public_alert_confirmation_immediate_send_unsubscribe(api, client, emails):
    email = uid("alerte").lower()
    emails.clear()
    r = client.post("/api/alerts/public", json={"email": email, "property_types": ["appartement"], "regions": ["Bretagne"], "max_price": 300000, "min_yield": 5})
    assert r.status_code == 200 and r.json()["status"] == "confirmation_sent"
    token = confirm_link(emails, email)
    # Pas d'envoi tant que l'alerte n'est pas confirmée
    emails.clear()
    published_listing(api, client, postal_code="29200", city="Brest", asking_price=150000)
    assert not [e for e in emails if e["to"] == email]
    assert client.get("/api/alerts/confirm/faux").status_code == 200 and "invalide" in client.get("/api/alerts/confirm/faux").text
    page = client.get(f"/api/alerts/confirm/{token}")
    assert page.status_code == 200 and "text/html" in page.headers["content-type"] and "Votre alerte est active" in page.text and 'lang="fr"' in page.text
    assert mails_to(emails, email, "Votre alerte est active")
    # Envoi immédiat à la publication d'une annonce qui correspond, avec lien de désinscription
    emails.clear()
    seller, c = published_listing(api, client, postal_code="56100", city="Lorient", asking_price=150000)
    mail = mails_to(emails, email, "Nouvelle annonce")
    assert len(mail) == 1 and f"/annonce/{c['id']}" in mail[0]["html"] and "Appartement T2 loué" in mail[0]["html"]
    # Rendement trop faible (4,8 %) : pas d'envoi
    emails.clear()
    published_listing(api, client, postal_code="35000", city="Rennes", asking_price=200000)
    assert not mails_to(emails, email, "Nouvelle annonce")
    unsubscribe = re.search(r"/api/alerts/unsubscribe/([A-Za-z0-9_\-\.]+)", mail[0]["html"]).group(1)
    # Annonce hors critères : rien ; vendeur prévenu du nombre d'acquéreurs servis, jamais « 0 »
    emails.clear()
    s2, c2 = published_listing(api, client, postal_code="31000", city="Toulouse", asking_price=150000)
    assert not mails_to(emails, email, "Nouvelle annonce")
    published = mails_to(emails, s2["email"], "en ligne")
    assert published and "0 acquéreur" not in published[0]["html"]
    # Désinscription en un clic, puis plus aucun envoi
    # Le lien (GET, ouvert aussi par les passerelles de sécurité) n'affiche qu'une confirmation ; le bouton (POST) désinscrit
    page = client.get(f"/api/alerts/unsubscribe/{unsubscribe}")
    assert page.status_code == 200 and "Confirmer la désinscription" in page.text and 'method="post"' in page.text
    assert db_call(client, server.db.public_alerts.find_one, {"email": email})["status"] == "active"
    page = client.post(f"/api/alerts/unsubscribe/{unsubscribe}")
    assert page.status_code == 200 and "désinscrit" in page.text
    emails.clear()
    published_listing(api, client, postal_code="29200", city="Brest", asking_price=150000)
    assert not [e for e in emails if e["to"] == email]
    assert db_call(client, server.db.public_alerts.find_one, {"email": email})["status"] == "unsubscribed"


PARKING_BREST = {"property_type": "parking", "lease_type": "parking", "postal_code": "29200", "city": "Brest", "surface": None,
                 "rooms": None, "floor": None, "dpe_class": "non-soumis", "ges_class": None, "rent_monthly": 90, "charges_monthly": 0,
                 "deposit": 90, "indexation": "aucune", "asking_price": 18000, "property_tax": 120, "non_recoverable_charges": 60}


def test_account_alert_filters_digest_and_opt_out(api, client, emails):
    buyer = api.register(uid("rep"), "buyer")
    r = client.post("/api/alerts", headers=api.h(buyer), json={"name": "Parkings bretons", "property_types": ["parking"], "regions": ["bretagne"], "min_yield": 5})
    alert = r.json()["alert"]
    assert r.status_code == 200 and alert["regions"] == ["Bretagne"] and alert["name"] == "Parkings bretons" and alert["min_yield"] == 5
    alert_id = r.json()["alert"]["id"]
    emails.clear()
    seller, c = published_listing(api, client, **PARKING_BREST)
    mail = mails_to(emails, buyer["email"], "Nouvelle annonce")
    assert len(mail) == 1 and "Ne plus recevoir" in mail[0]["html"]
    published = mails_to(emails, seller["email"], "en ligne")
    assert published and "envoyée à 1 acquéreur" in published[0]["html"]
    # Digest hebdomadaire : une fois par semaine et par alerte
    run_jobs(api, client, emails)
    digest = mails_to(emails, buyer["email"], "cette semaine pour votre alerte")
    assert len(digest) == 1 and f"/annonce/{c['id']}" in digest[0]["html"]
    run_jobs(api, client, emails)
    assert not mails_to(emails, buyer["email"], "cette semaine")
    # Lien de désinscription du compte : préférence notifications_opt_out, alertes désactivées
    unsubscribe = re.search(r"/api/alerts/unsubscribe/([A-Za-z0-9_\-\.]+)", mail[0]["html"]).group(1)
    assert "Confirmer la désinscription" in client.get(f"/api/alerts/unsubscribe/{unsubscribe}").text
    assert client.get("/api/auth/profile", headers=api.h(buyer)).json().get("notifications_opt_out") is not True
    # Désinscription en un clic depuis le client de messagerie (RFC 8058)
    assert "désinscrit" in client.post(f"/api/alerts/unsubscribe/{unsubscribe}", data={"List-Unsubscribe": "One-Click"}).text
    me = client.get("/api/auth/profile", headers=api.h(buyer)).json()
    assert me["notifications_opt_out"] is True
    assert client.get("/api/alerts", headers=api.h(buyer)).json()["alerts"][0]["active"] is False
    client.put(f"/api/alerts/{alert_id}", headers=api.h(buyer), json={"active": True})
    emails.clear()
    published_listing(api, client, **PARKING_BREST)
    assert not mails_to(emails, buyer["email"], "Nouvelle annonce"), "préférence notifications_opt_out respectée"


# ---------- §6.1 / §6.4 : relances vendeur, NPS ----------

def test_seller_lifecycle_reminders_and_pause(api, client, emails):
    seller, c = published_listing(api, client)
    db_call(client, server.db.properties.update_one, {"id": c["id"]}, {"$set": {"published_at": ago(15)}})
    run_jobs(api, client, emails)
    assert mails_to(emails, seller["email"], "14 jours en ligne")
    # Hebdo vendeur (tâche hebdomadaire, une fois par semaine) : jamais de « 0 »
    weekly = mails_to(emails, seller["email"], "Votre semaine")
    assert len(weekly) == 1 and "Ne plus recevoir" in weekly[0]["html"]
    assert not re.search(r"\b0 (vue|favori|contact)", weekly[0]["html"]), "aucun compteur à zéro"
    db_call(client, server.db.properties.update_one, {"id": c["id"]}, {"$set": {"published_at": ago(31)}})
    run_jobs(api, client, emails, reset_gate=True)
    mail = mails_to(emails, seller["email"], "30 jours en ligne")
    assert mail and "200 000 €" in plain(mail[0]["html"]) and "fourchette" in mail[0]["html"] and "loyer" in mail[0]["html"]
    # 60 jours sans connexion : avertissement à J-7 puis mise en pause
    db_call(client, server.db.users.update_one, {"id": seller["id"]}, {"$set": {"last_activity_at": ago(54)}})
    run_jobs(api, client, emails, reset_gate=True)
    assert mails_to(emails, seller["email"], "mise en pause dans 7 jours")
    db_call(client, server.db.users.update_one, {"id": seller["id"]}, {"$set": {"last_activity_at": ago(61)}})
    run_jobs(api, client, emails, reset_gate=True)
    assert mails_to(emails, seller["email"], "est mise en pause")
    stored = db_call(client, server.db.properties.find_one, {"id": c["id"]})
    assert stored["status"] == "paused" and stored["paused_reason"] == "inactivite"
    assert client.put(f"/api/properties/{c['id']}/status", params={"status": "published"}, headers=api.h(seller)).status_code == 200
    run_jobs(api, client, emails, reset_gate=True)
    assert not mails_to(emails, seller["email"], "Votre semaine"), "un seul récapitulatif par semaine"


def test_mandate_reminders_j1_j4_j10_once_per_day(api, client, emails):
    seller = api.register(uid("vendeur"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing()).json()
    assert c["status"] == "mandat_en_attente"
    db_call(client, server.db.properties.update_one, {"id": c["id"]}, {"$set": {"mandate_pending_since": ago(1)}})
    run_jobs(api, client, emails)
    j1 = mails_to(emails, seller["email"], "Signez votre mandat")
    # Signature en cours : relance transactionnelle (la page de désinscription promet que les signatures continuent)
    assert len(j1) == 1 and "exclusivité" in j1[0]["html"] and "Ne plus recevoir" not in j1[0]["html"]
    db_call(client, server.db.properties.update_one, {"id": c["id"]}, {"$set": {"mandate_pending_since": ago(10)}})
    run_jobs(api, client, emails)
    assert not mails_to(emails, seller["email"], "Signez votre mandat"), "une seule relance par jour et par personne"
    db_call(client, server.db.job_marks.delete_many, {"kind": "reminder_day"})
    run_jobs(api, client, emails)
    j10 = mails_to(emails, seller["email"], "Signez votre mandat")
    assert len(j10) == 1 and "résilier" in j10[0]["html"]


def test_nps_after_confirmed_sale(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    db_call(client, server.db.closings.insert_one, {"id": str(uuid.uuid4()), "property_id": c["id"], "buyer_id": buyer["id"], "seller_id": seller["id"],
                                                    "offer_id": "direct:" + uuid.uuid4().hex, "status": "confirmed", "confirmed_at": ago(8),
                                                    "property_label": "Appartement T2 loué · Lyon (69)", "created_at": ago(40), "updated_at": ago(8)})
    run_jobs(api, client, emails)
    mail = mails_to(emails, seller["email"], "Comment s'est passée")
    assert mail and mails_to(emails, buyer["email"], "Comment s'est passée")
    link = re.search(r"/api/nps/([A-Za-z0-9_\-\.]+)\?score=9", mail[0]["html"]).group(0)
    page = client.get(link)
    assert page.status_code == 200 and "Confirmer votre note" in page.text and 'value="9"' in page.text
    assert db_call(client, server.db.nps.find_one, {"user_id": seller["id"]}) is None, "un GET n'enregistre rien"
    page = client.post(link.split("?")[0], data={"score": 9})
    assert page.status_code == 200 and "Merci" in page.text
    assert db_call(client, server.db.nps.find_one, {"user_id": seller["id"]})["score"] == 9
    run_jobs(api, client, emails)
    assert not mails_to(emails, seller["email"], "Comment s'est passée")


# ---------- API.md §9 : KPI et coûts ----------

def test_admin_kpis_and_costs(api, client):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    client.post(f"/api/properties/{c['id']}/contact", headers=api.h(buyer), json={"message": "Bonjour"})
    assert client.get("/api/admin/kpis", headers=api.h(buyer)).status_code == 403
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    r = client.put("/api/admin/costs", headers=api.h(api.admin()), json={"month": month, "amount": 120.5, "note": "Hébergement + domaine"})
    assert r.status_code == 200 and r.json()["cost"]["amount"] == 120.5
    assert client.put("/api/admin/costs", headers=api.h(api.admin()), json={"month": "2026-13", "amount": 1}).status_code == 422
    costs = client.get("/api/admin/costs", headers=api.h(api.admin())).json()
    assert any(x["month"] == month and x["note"] == "Hébergement + domaine" for x in costs["costs"])
    kpis = client.get("/api/admin/kpis", params={"weeks": 4}, headers=api.h(api.admin())).json()
    today = datetime.now(timezone.utc).date().isoformat()
    assert len(kpis["weeks"]) == 4 and kpis["weeks"][-1]["end"] < kpis["current"]["start"] <= today <= kpis["current"]["end"]
    assert [w["start"] for w in kpis["weeks"]] == sorted(w["start"] for w in kpis["weeks"]) and kpis["previous"] == kpis["weeks"][-1]
    expected = {"listings_published", "listings_blocked", "estimates_completed", "estimate_to_listing_pct", "listing_to_mandate_pct",
                "publish_delay_median_h", "auto_publish_pct", "contacts", "contacts_per_listing_30d", "nda_signed", "nda_per_listing_30d",
                "offers", "seller_response_48h_pct", "requests_expired", "offers_accepted", "sales_declared", "invoices_issued",
                "invoices_paid", "invoices_overdue", "ownership_pending", "costs", "blocking_actions"}
    current = kpis["current"]["kpis"]
    assert expected <= set(current) and expected <= set(kpis["targets"]) and expected <= set(kpis["weeks"][0]["kpis"])
    assert current["listings_published"] >= 1 and current["contacts"] >= 1 and current["costs"] == 120.5
    assert current["publish_delay_median_h"] is not None and current["auto_publish_pct"] is not None
    assert kpis["targets"]["seller_response_48h_pct"] == 80 and kpis["targets"]["costs"] == 600
    assert "bodacc_incidents" not in current and current["ownership_pending"] >= 0


def test_valorization_route_removed(client):
    assert client.post("/api/valorization/estimate", json={"ca": 1, "ebitda": 1, "sector": "x", "region": "y"}).status_code in (404, 405)
    assert db_call(client, server.db.valorization.count_documents, {}) == 0


def test_contact_email_is_sent_once_per_conversation(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    emails.clear()
    client.post(f"/api/properties/{c['id']}/contact", headers=api.h(buyer), json={"message": "Premier"})
    client.post("/api/messages", headers=api.h(buyer), json={"receiver_id": seller["id"], "property_id": c["id"], "content": "Deuxième"})
    assert len(mails_to(emails, seller["email"], "présente son projet")) == 1
    assert not mails_to(emails, seller["email"], "Nouveau message"), "pas de second e-mail tant que le premier n'est pas lu"
    assert len(sent_emails) >= 2
