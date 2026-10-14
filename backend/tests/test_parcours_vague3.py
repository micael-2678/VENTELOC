"""Vague 3 — correctifs du parcours (revue parcours-jobs, juridique, ux) :
demande de dossier renouvelée après expiration (relances et expiration rejouées), demandes closes quand l'annonce
n'est plus en ligne, relances transactionnelles malgré notifications_opt_out, récapitulatif quotidien des messages
sans réponse, relances héritées avec lien de désinscription, relance humaine depuis « À faire », doublon d'adresse
d'une annonce en pause, purge RGPD (durées de la politique de confidentialité)."""
import uuid
from datetime import datetime, timedelta, timezone

import server
from conftest import listing
from test_parcours_v2 import ago, db_call, mails_to, published_listing, run_jobs, uid


def _request(api, client, property_id, buyer):
    r = client.post(f"/api/dataroom/{property_id}/request-access", headers=api.h(buyer))
    assert r.status_code == 200, r.text
    return r.json()


def _antedate_request(client, property_id, buyer_id, days, expires_in_days):
    db_call(client, server.db.dataroom_access.update_one, {"property_id": property_id, "buyer_id": buyer_id},
            {"$set": {"requested_at": ago(days), "expires_at": (datetime.now(timezone.utc) + timedelta(days=expires_in_days)).isoformat()}})


def _stored_request(client, property_id, buyer_id):
    return db_call(client, server.db.dataroom_access.find_one, {"property_id": property_id, "buyer_id": buyer_id})


# ---------- parcours-jobs-01 : nouvelle demande après expiration ----------

def test_renewed_dataroom_request_is_reminded_and_expires_again(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    first = _request(api, client, c["id"], buyer)
    _antedate_request(client, c["id"], buyer["id"], 11, -1)
    run_jobs(api, client, emails, reset_gate=True)
    assert mails_to(emails, buyer["email"], "n'a pas répondu")
    assert _stored_request(client, c["id"], buyer["id"])["status"] == "expired"
    # L'acquéreur renouvelle sa demande (comme le promet l'e-mail d'expiration) : même identifiant, nouveau cycle
    second = _request(api, client, c["id"], buyer)
    assert second["status"] == "pending" and second["request_id"] == first["request_id"]
    _antedate_request(client, c["id"], buyer["id"], 3, 7)
    run_jobs(api, client, emails, reset_gate=True)
    assert len(mails_to(emails, seller["email"], "attend votre réponse depuis 2 jours")) == 1, "relance J+2 du nouveau cycle"
    _antedate_request(client, c["id"], buyer["id"], 11, -1)
    run_jobs(api, client, emails, reset_gate=True)
    assert mails_to(emails, buyer["email"], "n'a pas répondu"), "la demande renouvelée expire à son tour"
    assert _stored_request(client, c["id"], buyer["id"])["status"] == "expired"


# ---------- parcours-jobs-02 : annonce retirée / vendue autrement ----------

def test_pending_requests_closed_when_listing_leaves_the_site(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    _request(api, client, c["id"], buyer)
    r = client.put(f"/api/properties/{c['id']}/status", params={"status": "withdrawn"}, headers=api.h(seller))
    assert r.status_code == 200, r.text
    req = _stored_request(client, c["id"], buyer["id"])
    assert req["status"] == "closed" and req["closed_reason"] == "listing_withdrawn"
    notice = db_call(client, server.db.messages.find_one, {"property_id": c["id"], "message_type": "access_closed"})
    assert notice and notice["receiver_id"] == buyer["id"]
    _antedate_request(client, c["id"], buyer["id"], 11, -1)
    run_jobs(api, client, emails, reset_gate=True)
    assert not mails_to(emails, seller["email"], "attend votre réponse") and not mails_to(emails, buyer["email"], "n'a pas répondu")
    # Demande restée en attente d'une annonce déjà vendue autrement (données antérieures) : close par le job, sans e-mail
    seller2, c2 = published_listing(api, client)
    buyer2 = api.register(uid("rep"), "buyer")
    _request(api, client, c2["id"], buyer2)
    db_call(client, server.db.properties.update_one, {"id": c2["id"]}, {"$set": {"status": "sold_elsewhere"}})
    _antedate_request(client, c2["id"], buyer2["id"], 3, 7)
    run_jobs(api, client, emails, reset_gate=True)
    assert not mails_to(emails, seller2["email"], "attend votre réponse")
    assert _stored_request(client, c2["id"], buyer2["id"])["status"] == "closed"
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    rows = [r for s in todo["sections"] if s["key"] in ("dataroom_unanswered", "dataroom_expired") for r in s["rows"]]
    assert not any(r["ref"].get("buyer_id") in (buyer["id"], buyer2["id"]) for r in rows)


# ---------- parcours-jobs-03 : relances transactionnelles malgré notifications_opt_out ----------

def test_transactional_reminders_reach_opted_out_seller(api, client, emails):
    seller, c = published_listing(api, client)
    client.put("/api/auth/profile", headers=api.h(seller), json={"notifications_opt_out": True})
    buyer = api.register(uid("rep"), "buyer")
    _request(api, client, c["id"], buyer)
    _antedate_request(client, c["id"], buyer["id"], 6, 4)
    run_jobs(api, client, emails, reset_gate=True)
    assert len(mails_to(emails, seller["email"], "attend votre réponse depuis 5 jours")) == 1
    # Mandat à signer : « signature » au sens de la page de désinscription
    lazy = api.register(uid("cedant"), "seller")
    api.verify_kyc(lazy)
    client.put("/api/auth/profile", headers=api.h(lazy), json={"notifications_opt_out": True})
    m = client.post("/api/properties", headers=api.h(lazy), json=listing()).json()
    assert m["status"] == "mandat_en_attente"
    db_call(client, server.db.properties.update_one, {"id": m["id"]}, {"$set": {"mandate_pending_since": ago(2)}})
    run_jobs(api, client, emails, reset_gate=True)
    assert len(mails_to(emails, lazy["email"], "Signez votre mandat")) == 1


# ---------- parcours-jobs-04 : messages sans réponse, un récapitulatif par vendeur ----------

def test_seller_reminder_single_recap_only_for_listings_online(api, client, emails):
    seller, c = published_listing(api, client)
    other_seller, sold = published_listing(api, client)
    buyers = [api.register(uid("rep"), "buyer") for _ in range(3)]
    for b in buyers[:2]:
        assert client.post(f"/api/properties/{c['id']}/contact", headers=api.h(b), json={"message": "Bonjour, je suis intéressé"}).status_code == 200
    assert client.post(f"/api/properties/{sold['id']}/contact", headers=api.h(buyers[2]), json={"message": "Bonjour"}).status_code == 200
    assert client.put(f"/api/properties/{sold['id']}/status", params={"status": "sold_elsewhere"}, headers=api.h(other_seller)).status_code == 200
    db_call(client, server.db.conversations.update_many, {"property_id": {"$in": [c["id"], sold["id"]]}}, {"$set": {"last_at": ago(4)}})
    run_jobs(api, client, emails, reset_gate=True)
    recap = mails_to(emails, seller["email"], "attendent votre réponse")
    assert len(recap) == 1 and recap[0]["subject"] == "2 acquéreurs attendent votre réponse" and "Ne plus recevoir" in recap[0]["html"]
    assert not mails_to(emails, other_seller["email"], "attend"), "annonce vendue autrement : aucune relance"
    run_jobs(api, client, emails, reset_gate=True)
    assert not mails_to(emails, seller["email"], "attend"), "chaque dernier message n'est rappelé qu'une fois"


# ---------- parcours-jobs-05 / juridique-04 : relances héritées ----------

def test_legacy_reminders_carry_unsubscribe_and_respect_opt_out(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    opted = api.register(uid("rep"), "buyer")
    client.put("/api/auth/profile", headers=api.h(opted), json={"notifications_opt_out": True})
    for b in (buyer, opted):
        client.post(f"/api/properties/{c['id']}/contact", headers=api.h(b), json={"message": "Bonjour"})
    db_call(client, server.db.contacts.update_many, {"property_id": c["id"]}, {"$set": {"created_at": ago(31)}})
    lazy = api.register(uid("sansannonce"), "seller")
    lazy_opted = api.register(uid("sansannonce"), "seller")
    client.put("/api/auth/profile", headers=api.h(lazy_opted), json={"notifications_opt_out": True})
    db_call(client, server.db.users.update_many, {"id": {"$in": [lazy["id"], lazy_opted["id"]]}}, {"$set": {"created_at": ago(4)}})
    run_jobs(api, client, emails, reset_gate=True)
    followup = mails_to(emails, buyer["email"], "Où en êtes-vous")
    assert len(followup) == 1 and "Ne plus recevoir" in followup[0]["html"]
    assert "bien loué" in followup[0]["html"] and "Lyon" in followup[0]["html"]
    assert not mails_to(emails, opted["email"], "Où en êtes-vous")
    relaunch = mails_to(emails, lazy["email"], "Votre annonce de bien loué")
    assert len(relaunch) == 1 and "Ne plus recevoir" in relaunch[0]["html"] and "gratuit" not in relaunch[0]["html"]
    assert "sans frais" in relaunch[0]["html"]
    assert not mails_to(emails, lazy_opted["email"], "Votre annonce de bien loué")


# ---------- parcours-jobs-07 : « Relancer le vendeur » depuis « À faire » ----------

def test_admin_reminds_seller_from_todo(api, client, emails):
    seller, c = published_listing(api, client)
    buyer = api.register(uid("rep"), "buyer")
    req_id = _request(api, client, c["id"], buyer)["request_id"]
    _antedate_request(client, c["id"], buyer["id"], 8, 2)
    run_jobs(api, client, emails, reset_gate=True)
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    row = next(r for s in todo["sections"] if s["key"] == "dataroom_unanswered" for r in s["rows"] if r["id"] == req_id)
    action = next(a for a in row["actions"] if a["label"] == "Relancer le vendeur")
    assert action["url"] == f"/api/admin/dataroom/{req_id}/remind"
    emails.clear()
    assert client.post(action["url"], headers=api.h(buyer)).status_code == 403
    r = client.post(action["url"], headers=api.h(api.admin()))
    assert r.status_code == 200 and r.json()["sent"] is True, r.text
    assert len(mails_to(emails, seller["email"], "attend votre réponse")) == 1
    r = client.post(action["url"], headers=api.h(api.admin()))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_reminded"
    assert any(x.get("day") == "admin" for x in _stored_request(client, c["id"], buyer["id"])["reminders_sent"])


# ---------- parcours-jobs-08 : doublon d'adresse d'une annonce en pause ----------

def test_duplicate_address_flagged_while_first_listing_paused(api, client, emails):
    seller1, c1 = published_listing(api, client, address="12 rue des Doublons")
    assert client.put(f"/api/properties/{c1['id']}/status", params={"status": "paused"}, headers=api.h(seller1)).status_code == 200
    seller2 = api.register(uid("dupont"), "seller", first="Paul", last="Dupont")
    api.verify_kyc(seller2)
    # Même adresse, casse et ponctuation différentes : même clé normalisée
    c2 = client.post("/api/properties", headers=api.h(seller2), json=listing(address="12, Rue des DOUBLONS")).json()
    assert any(f["code"] == "duplicate_address" for f in c2["flags"]), c2["flags"]
    # Drapeau non bloquant : publication automatique, puis relecture admin (48 h) avec le drapeau
    api.ownership(seller2, c2["id"])
    m = api.mandate(seller2, c2["id"])
    assert api.sign_mandate(seller2, m["contract_id"]).json()["listing_status"] == "published"
    doc = client.get(f"/api/properties/{c2['id']}", headers=api.h(seller2)).json()
    assert doc["status"] == "published" and doc["property_checks"]["duplicate_address"] is True
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    row = next(r for s in todo["sections"] if s["key"] == "listings_review" for r in s["rows"] if r["ref"]["property_id"] == c2["id"])
    assert "duplicate_address" in row["ref"]["flags"] and "même adresse" in row["detail"]
    # Une annonce du même vendeur à la même adresse n'est pas un doublon (republication après retrait de l'autre annonce)
    assert client.put(f"/api/properties/{c2['id']}/status", params={"status": "withdrawn"}, headers=api.h(seller2)).status_code == 200
    c3 = client.post("/api/properties", headers=api.h(seller1), json=listing(address="12 rue des Doublons")).json()
    assert not any(f["code"] == "duplicate_address" for f in c3["flags"])


# ---------- parcours-jobs-06 : annonce « pending » héritée → retrait possible par le vendeur ----------

def test_seller_can_withdraw_legacy_pending_listing(api, client):
    seller, c = published_listing(api, client)
    db_call(client, server.db.properties.update_one, {"id": c["id"]}, {"$set": {"status": "pending"}})
    r = client.put(f"/api/properties/{c['id']}/status", params={"status": "withdrawn"}, headers=api.h(seller))
    assert r.status_code == 200 and r.json()["status"] == "withdrawn"


# ---------- juridique-01 : durées de conservation ----------

def test_rgpd_purge_applies_privacy_policy_retention(api, client):
    db = server.db
    now = datetime.now(timezone.utc)
    years = lambda n: (now - timedelta(days=365 * n + 2)).isoformat()
    tag = uuid.uuid4().hex[:8]
    inactive = {"id": f"u-inactif-{tag}", "email": f"inactif-{tag}@test.fr", "role": "buyer", "first_name": "Anne",
                "last_name": "Ancienne", "phone": "0600000000", "last_activity_at": years(4), "created_at": years(5),
                "identity_verified": True, "stripe_identity_report": {"first_name": "Anne"}, "verified_birth_date": "1970-01-01"}
    bound = {"id": f"u-mandat-{tag}", "email": f"mandat-{tag}@test.fr", "role": "seller", "first_name": "Marc",
             "last_activity_at": years(4), "created_at": years(5)}
    old_deleted = {"id": f"u-supprime-{tag}", "email": f"deleted-{tag}@anonyme.invalid", "role": "buyer", "deleted_at": years(6),
                   "last_activity_at": years(6), "created_at": years(7), "stripe_identity_report": {"first_name": "X"}}
    recent = {"id": f"u-actif-{tag}", "email": f"actif-{tag}@test.fr", "role": "buyer", "first_name": "Lea",
              "last_activity_at": years(1), "created_at": years(2)}
    for u in (inactive, bound, old_deleted, recent):
        db_call(client, db.users.insert_one, dict(u))
    db_call(client, db.generated_contracts.insert_one, {"id": f"m-{tag}", "type": "mandat", "status": "signed", "seller_id": bound["id"]})
    db_call(client, db.messages.insert_one, {"id": f"msg-old-{tag}", "content": "ancien", "created_at": years(4)})
    db_call(client, db.messages.insert_one, {"id": f"msg-new-{tag}", "content": "récent", "created_at": years(1)})
    db_call(client, db.dataroom_access_logs.insert_one, {"id": f"log-{tag}", "timestamp": years(4)})
    db_call(client, db.contact_attempts.insert_one, {"id": f"ca-{tag}", "created_at": years(2)})

    assert db_call(client, server.job_rgpd_purge, now) >= 5
    assert not db_call(client, db.messages.find_one, {"id": f"msg-old-{tag}"})
    assert db_call(client, db.messages.find_one, {"id": f"msg-new-{tag}"})
    assert not db_call(client, db.dataroom_access_logs.find_one, {"id": f"log-{tag}"})
    assert not db_call(client, db.contact_attempts.find_one, {"id": f"ca-{tag}"})
    u = db_call(client, db.users.find_one, {"id": inactive["id"]})
    assert u["deleted_at"] and u["email"].endswith("@anonyme.invalid") and "first_name" not in u and "phone" not in u
    assert u["stripe_identity_report"], "rapport d'identité conservé 5 ans après la fin de la relation"
    assert db_call(client, db.users.find_one, {"id": bound["id"]})["email"] == bound["email"], "mandat en cours : compte conservé"
    assert "stripe_identity_report" not in db_call(client, db.users.find_one, {"id": old_deleted["id"]})
    assert db_call(client, db.users.find_one, {"id": recent["id"]})["first_name"] == "Lea"
    # Idempotente
    db_call(client, server.job_rgpd_purge, now)
    assert db_call(client, db.users.find_one, {"id": inactive["id"]})["stripe_identity_report"]


# ---------- juridique-08 : adresse de contact des contrats ----------

def test_legal_contact_email_defaults_to_site_address():
    assert server.LEGAL_ENTITY["email"] == server.sender_email()
    assert server.LEGAL_ENTITY["email"] == "contact@venteloc.fr"

