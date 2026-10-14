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
    # Identité certifiée par Stripe (simulée) : nom « Dupont » = gérant de la SCI
    db_call(client, server.db.users.update_one, {"id": seller["id"]},
            {"$set": {"verified_first_name": "Paul", "verified_last_name": "Dupont"}})
    api.verify_kyc(seller)
    # Sans mandat signé, l'annonce attend le mandat (loi Hoguet) et reste invisible
    assert client.get(f"/api/properties/{c['id']}").status_code == 404
    listing_status = db_call(client, server.db.properties.find_one, {"id": c["id"]})["status"]
    assert listing_status == "mandat_en_attente"
    assert any(e["to"] == seller["email"] and "mandat" in e["subject"] for e in emails)
    api.ownership(seller, c["id"])
    m = api.mandate(seller, c["id"])
    r = api.sign_mandate(seller, m["contract_id"])
    assert r.json()["listing_status"] == "published"
    assert client.get(f"/api/properties/{c['id']}").status_code == 200
    assert any(e["to"] == seller["email"] and "en ligne" in e["subject"] for e in emails)


def test_gerant_non_confirme_publie_avec_drapeau_et_relu(api, client, emails, db):
    """SPEC §5.4 : publication sans humain ; un gérant de SCI différent du vendeur est un drapeau (post-modération 48 h),
    pas une file « en validation » ni un e-mail admin immédiat ; l'admin peut retirer avec un motif obligatoire."""
    seller = api.register(uid("autre"), "seller", last="Autre")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(siret="66677788800011", postal_code="29200", city="Brest")).json()
    assert c["status"] == "mandat_en_attente"
    # L'admin ne peut pas publier sans mandat
    r = client.put(f"/api/properties/{c['id']}/status", params={"status": "published"}, headers=api.h(api.admin()))
    assert r.status_code == 400
    api.ownership(seller, c["id"])
    m = api.mandate(seller, c["id"])
    assert api.sign_mandate(seller, m["contract_id"]).json()["listing_status"] == "published"
    assert not any(e["to"] == "admin@test.fr" and "valider" in e["subject"] for e in emails)
    doc = client.get(f"/api/properties/{c['id']}", headers=api.h(seller)).json()
    assert doc["status"] == "published"
    assert doc["moderation"]["status"] == "pending" and "gerant_mismatch" in doc["moderation"]["flags"]
    assert doc["property_checks"]["gerant_match"] == "no_match" and doc["property_checks"]["siren_active"] is True
    assert doc["department"] == "29" and doc["region"] == "Bretagne"
    assert doc["title"] == "Appartement T2 loué · 42 m² · Brest (29)" and "Tilleuls" not in doc["title"]
    # L'annonce figure dans « À faire » avec ses drapeaux et l'action « Retirer avec motif »
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    review = next(s for s in todo["sections"] if s["key"] == "listings_review")
    row = next(r for r in review["rows"] if r["id"] == c["id"])
    assert "gerant_mismatch" in row["ref"]["flags"] and any(a["label"].startswith("Retirer") for a in row["actions"])
    removal = next(a for a in row["actions"] if a["label"].startswith("Retirer"))
    assert [x["id"] if isinstance(x, dict) else x for x in removal["reasons"]][:1] == ["justificatif"]
    # Retrait sans motif refusé ; avec motif : annonce retirée, mandat caduc, e-mail motivé au vendeur
    r = client.put(f"/api/properties/{c['id']}/status", params={"status": "removed"}, headers=api.h(api.admin()))
    assert r.status_code == 400
    r = client.put(f"/api/properties/{c['id']}/status", params={"status": "removed", "reason": "justificatif",
                                                                "reason_text": "Le titre de propriété est au nom d'un tiers"},
                   headers=api.h(api.admin()))
    assert r.status_code == 200, r.text
    assert client.get(f"/api/properties/{c['id']}").status_code == 404
    mandate = client.portal.call(server.db.generated_contracts.find_one, {"id": m["contract_id"]})
    e = next(e for e in reversed(emails) if e["to"] == seller["email"] and "retirée" in e["subject"])
    assert "au nom d" in e["html"] and "tiers" in e["html"]
    assert mandate["status"] == "void"
    # Validation par l'admin d'une autre annonce : relecture close
    seller2 = api.register(uid("dupont"), "seller", first="Paul", last="Dupont")
    api.verify_kyc(seller2)
    c2 = client.post("/api/properties", headers=api.h(seller2), json=listing(siret="66677788900011")).json()
    api.ownership(seller2, c2["id"])
    m2 = api.mandate(seller2, c2["id"])
    assert api.sign_mandate(seller2, m2["contract_id"]).json()["listing_status"] == "published"
    doc2 = client.get(f"/api/properties/{c2['id']}", headers=api.h(seller2)).json()
    assert "gerant_mismatch" not in doc2["moderation"]["flags"] and doc2["property_checks"]["gerant_match"] == "match_exact"
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
    # Relance du vendeur : dernier message de l'acquéreur sans réponse depuis plus de 3 jours (conversation)
    waiting = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    db_call(client, server.db.conversations.update_many, {"property_id": c["id"]}, {"$set": {"last_at": waiting}})
    db_call(client, server.db.users.update_one, {"id": lazy_seller["id"]}, {"$set": {"created_at": old}})
    emails.clear()

    result = client.post("/api/admin/jobs/run", headers=api.h(api.admin())).json()
    assert all(isinstance(v, int) for v in result.values()), result
    subjects = [(e["to"], e["subject"]) for e in emails]
    assert (seller["email"], "Un acquéreur attend votre réponse") in subjects
    assert (buyer["email"], "Où en êtes-vous avec ce vendeur ?") in subjects
    assert (lazy_seller["email"], "Votre annonce de bien loué en 10 minutes") in subjects

    # Pas de doublon au passage suivant
    emails.clear()
    client.post("/api/admin/jobs/run", headers=api.h(api.admin()))
    assert not [e for e in emails if e["to"] in (seller["email"], buyer["email"], lazy_seller["email"])]

    # Réponse au questionnaire via le lien de l'email
    followup = db_call(client, server.db.followups.find_one, {"buyer_id": buyer["id"]})
    r = client.post(f"/api/followup/{followup['token']}", json={"answer": "rencontre", "comment": "Visite avec le locataire la semaine prochaine"})
    assert r.status_code == 200 and r.json()["label"] == "Visite prévue ou faite"
    assert client.post("/api/followup/faux", json={"answer": "accord"}).status_code == 404


def test_public_stats_and_sitemap(api, client):
    seller = api.register(uid("seo"), "seller")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(property_type="local-commercial", lease_type="commercial",
                                                                           postal_code="13001", city="Marseille", indexation="ilc")).json()
    api.publish(seller, c["id"])
    stats = client.get("/api/public/listing-stats").json()
    assert set(stats) == {"total", "by_property_type", "by_lease_type", "by_department", "by_region"} and stats["total"] >= 1
    assert any(r["value"] == "Provence-Alpes-Côte d'Azur" and r["slug"] == "provence-alpes-cote-d-azur" for r in stats["by_region"])
    assert any(r["value"] == "local-commercial" and r["count"] >= 1 for r in stats["by_property_type"])
    assert any(r["value"] == "13" and r["label"] == "Bouches-du-Rhône" for r in stats["by_department"])
    assert all(r["count"] > 0 for key in ("by_property_type", "by_lease_type", "by_department", "by_region") for r in stats[key])
    xml = client.get("/api/sitemap.xml").text
    # Plan du site : fiches des annonces publiées sous /annonce/{id}, plus aucune page de l'ancienne plateforme
    assert f"https://venteloc.test/annonce/{c['id']}</loc>" in xml and "/property/" not in xml
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
        listed = f"https://venteloc.test{path}</loc>" in xml
        assert listed == server.sitemap_static_path(path), path
    assert "https://venteloc.test/</loc>" in xml and "https://venteloc.test/vendre</loc>" in xml
