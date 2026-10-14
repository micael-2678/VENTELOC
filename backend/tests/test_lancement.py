"""Fonctions du test de marché : brouillons, publication automatique, statistiques, relances, SEO"""
import uuid
from datetime import datetime, timedelta, timezone

import server
from conftest import listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    """Accès direct à la base sur la boucle du serveur de test"""
    return client.portal.call(lambda: fn(*args, **kwargs))


def test_draft_then_mandate_then_auto_publish(api, client, emails):
    seller = api.register(uid("dupont"), "seller", first="Paul", last="Dupont")
    c = client.post("/api/properties", headers=api.h(seller), json=listing(siret="55566677700011")).json()
    assert c["status"] == "draft"
    assert any(e["to"] == seller["email"] and "brouillon" in e["subject"] for e in emails)
    # Identité certifiée par Stripe (simulée) : nom « Dupont » = dirigeant
    db_call(client, server.db.users.update_one, {"id": seller["id"]},
            {"$set": {"verified_first_name": "Paul", "verified_last_name": "Dupont"}})
    api.verify_kyc(seller)
    # Sans mandat signé, l'annonce attend le mandat (loi Hoguet) et reste invisible
    assert client.get(f"/api/properties/{c['id']}").status_code == 404
    listing_status = db_call(client, server.db.properties.find_one, {"id": c["id"]})["status"]
    assert listing_status == "mandat_en_attente"
    assert any(e["to"] == seller["email"] and "mandat" in e["subject"] for e in emails)
    m = api.mandate(seller, c["id"])
    r = api.sign_mandate(seller, m["contract_id"])
    assert r.json()["listing_status"] == "published"
    assert client.get(f"/api/properties/{c['id']}").status_code == 200
    assert any(e["to"] == seller["email"] and "en ligne" in e["subject"] for e in emails)


def test_unverified_director_is_published_with_flag_and_reviewed(api, client, emails, db):
    """SPEC §4.4 : publication sans humain ; la qualité de dirigeant non confirmée est un drapeau (post-modération 48 h),
    plus une file « en validation » ni d'e-mail admin immédiat ; l'admin peut retirer avec un motif obligatoire."""
    seller = api.register(uid("autre"), "seller", last="Autre")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(siret="66677788800011")).json()
    assert c["status"] == "mandat_en_attente"
    # L'admin ne peut pas publier sans mandat
    r = client.put(f"/api/properties/{c['id']}/status", params={"status": "published"}, headers=api.h(api.admin()))
    assert r.status_code == 400
    m = api.mandate(seller, c["id"])
    assert api.sign_mandate(seller, m["contract_id"]).json()["listing_status"] == "published"
    assert not any(e["to"] == "admin@test.fr" and "valider" in e["subject"] for e in emails)
    doc = client.get(f"/api/properties/{c['id']}", headers=api.h(seller)).json()
    assert doc["status"] == "published"
    assert doc["moderation"]["status"] == "pending" and "dirigeant_non_confirme" in doc["moderation"]["flags"]
    assert doc["property_checks"]["dirigeant_match"] == "no_match" and doc["property_checks"]["siren_active"] is True
    assert doc["trades"] == ["pac-clim-cvc"] and doc["is_rge"] is True and doc["department"] == "29"
    assert doc["title"].startswith("Entreprise de ") and "SECRET" not in doc["title"]
    # L'annonce figure dans « À faire » avec ses drapeaux et l'action « Retirer avec motif »
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    review = next(s for s in todo["sections"] if s["key"] == "listings_review")
    row = next(r for r in review["rows"] if r["id"] == c["id"])
    assert "dirigeant_non_confirme" in row["ref"]["flags"] and any(a["label"].startswith("Retirer") for a in row["actions"])
    # Retrait sans motif refusé ; avec motif : annonce retirée, mandat caduc, e-mail motivé au cédant
    r = client.put(f"/api/properties/{c['id']}/status", params={"status": "removed"}, headers=api.h(api.admin()))
    assert r.status_code == 400
    r = client.put(f"/api/properties/{c['id']}/status", params={"status": "removed", "reason": "dirigeant", "reason_text": "SIREN d'une holding"},
                   headers=api.h(api.admin()))
    assert r.status_code == 200, r.text
    assert client.get(f"/api/properties/{c['id']}").status_code == 404
    mandate = client.portal.call(server.db.generated_contracts.find_one, {"id": m["contract_id"]})
    e = next(e for e in reversed(emails) if e["to"] == seller["email"] and "retirée" in e["subject"])
    assert "holding" in e["html"]
    assert mandate["status"] == "void"
    # Validation par l'admin d'une autre annonce : relecture close
    seller2 = api.register(uid("dupont"), "seller", first="Paul", last="Dupont")
    api.verify_kyc(seller2)
    c2 = client.post("/api/properties", headers=api.h(seller2), json=listing(siret="66677788900011")).json()
    m2 = api.mandate(seller2, c2["id"])
    assert api.sign_mandate(seller2, m2["contract_id"]).json()["listing_status"] == "published"
    doc2 = client.get(f"/api/properties/{c2['id']}", headers=api.h(seller2)).json()
    assert "dirigeant_non_confirme" not in doc2["moderation"]["flags"] and doc2["property_checks"]["dirigeant_match"] == "match_exact"
    r = client.put(f"/api/properties/{c2['id']}/status", params={"status": "published"}, headers=api.h(api.admin()))
    assert r.status_code == 200
    assert client.get(f"/api/properties/{c2['id']}", headers=api.h(seller2)).json()["moderation"]["status"] == "ok"


def test_acquisition_source_and_metrics(api, client):
    api.register(uid("src"), "buyer", acquisition_source="linkedin")
    m = client.get("/api/admin/metrics", params={"days": 30}, headers=api.h(api.admin())).json()
    assert any(s["source"] == "linkedin" for s in m["sources"])
    assert m["funnel"][0]["step"] == "Acquéreurs inscrits" and m["funnel"][0]["count"] >= 1
    assert len(m["weekly"]) == 12 and {"reply_rate", "median_reply_hours"} <= set(m["totals"])


def test_scheduled_jobs_reminder_followup_relaunch(api, client, emails):
    seller = api.register(uid("vendeur"), "seller")
    buyer = api.register(uid("acheteur"), "buyer")
    lazy_seller = api.register(uid("sansannonce"), "seller")
    for u in (seller, buyer):
        api.verify_kyc(u)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(siret="77788899900011")).json()
    api.publish(seller, c["id"])
    client.post(f"/api/properties/{c['id']}/contact", headers=api.h(buyer))
    client.post("/api/messages", headers=api.h(buyer), json={"receiver_id": seller["id"], "property_id": c["id"], "content": "Bonjour"})

    old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    db_call(client, server.db.messages.update_many, {"property_id": c["id"]}, {"$set": {"created_at": old}})
    db_call(client, server.db.contacts.update_many, {"property_id": c["id"]}, {"$set": {"created_at": old}})
    # Relance du cédant : dernier message du repreneur sans réponse depuis plus de 3 jours (conversation)
    waiting = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    db_call(client, server.db.conversations.update_many, {"property_id": c["id"]}, {"$set": {"last_at": waiting}})
    db_call(client, server.db.users.update_one, {"id": lazy_seller["id"]}, {"$set": {"created_at": old}})
    emails.clear()

    result = client.post("/api/admin/jobs/run", headers=api.h(api.admin())).json()
    assert all(isinstance(v, int) for v in result.values()), result
    subjects = [(e["to"], e["subject"]) for e in emails]
    assert (seller["email"], "Un acquéreur attend votre réponse") in subjects
    assert (buyer["email"], "Où en êtes-vous avec ce vendeur ?") in subjects
    assert (lazy_seller["email"], "Votre annonce de cession en 10 minutes") in subjects

    # Pas de doublon au passage suivant
    emails.clear()
    client.post("/api/admin/jobs/run", headers=api.h(api.admin()))
    assert not [e for e in emails if e["to"] in (seller["email"], buyer["email"], lazy_seller["email"])]

    # Réponse au questionnaire via le lien de l'email
    followup = db_call(client, server.db.followups.find_one, {"buyer_id": buyer["id"]})
    r = client.post(f"/api/followup/{followup['token']}", json={"answer": "rencontre", "comment": "RDV la semaine prochaine"})
    assert r.status_code == 200 and r.json()["label"] == "Rencontre prévue ou faite"
    assert client.post("/api/followup/faux", json={"answer": "accord"}).status_code == 404


def test_public_stats_and_sitemap(api, client):
    seller = api.register(uid("seo"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(siret="88899900000011", region="Provence-Alpes-Côte d'Azur")).json()
    api.publish(seller, c["id"])
    stats = client.get("/api/public/listing-stats").json()
    assert any(r["value"] == "Provence-Alpes-Côte d'Azur" for r in stats["by_region"])
    assert any(r["value"] == "pac-clim-cvc" and r["count"] >= 1 and r["slug"] == "pac-clim-cvc" for r in stats["by_trade"])
    assert all(r["count"] > 0 for key in ("by_trade", "by_department", "by_region", "by_rge") for r in stats[key])
    xml = client.get("/api/sitemap.xml").text
    # Plan du site recentré sur l'application (MODE-TEST-ET-APP.md §A) : fiches des annonces publiées, plus aucune
    # ancienne page marketing (redirigées vers la page des annonces)
    assert f"https://cessionrge.test/property/{c['id']}</loc>" in xml
    for legacy in ("/entreprises-rge-a-vendre", "/entreprises-batiment-a-vendre", "/entreprises-a-vendre</loc>", "/search</loc>", "/guides"):
        assert legacy not in xml


def test_sitemap_matches_prerendered_routes(client):
    """Le sitemap reprend les pages pré-rendues ; la copie backend doit rester identique à celle du frontend"""
    import json
    import os
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backend_copy = json.load(open(os.path.join(here, "seo_routes.json"), encoding="utf-8"))["routes"]
    front = os.path.join(here, "..", "frontend", "scripts", "seo-routes.json")
    if os.path.exists(front):
        assert [r["path"] for r in json.load(open(front, encoding="utf-8"))["routes"]] == [r["path"] for r in backend_copy], \
            "Copier frontend/scripts/seo-routes.json vers backend/seo_routes.json après un build"
    xml = client.get("/api/sitemap.xml").text
    # Routes statiques reprises telles quelles, sauf les anciennes pages redirigées (fichier lu tel qu'il est livré)
    for route in backend_copy:
        path = route["path"]
        listed = f"https://cessionrge.test{path}</loc>" in xml
        assert listed == server.sitemap_static_path(path), path
    assert "https://cessionrge.test/</loc>" in xml
