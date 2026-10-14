"""Migration refonte_2026_10 : dry-run sans écriture, application idempotente, rollback des champs ajoutés (SPEC §7.9)."""
import uuid

import server
from migrations.refonte_2026_10 import MARKER, run_migration, run_rollback


def run(client, coro_fn, *args, **kwargs):
    return client.portal.call(lambda: coro_fn(*args, **kwargs))


def _seed(client):
    db = server.db
    tag = uuid.uuid4().hex[:8]
    user = {"id": f"u-{tag}", "email": f"ancien-{tag}@test.fr", "role": "seller", "kyc_documents": [{"data": "base64"}]}
    property = {"id": f"c-{tag}", "seller_id": user["id"], "status": "published", "rge_types": ["Isolation des combles perdus"],
               "region": "Bretagne", "staff_count": 8, "siret": "73282932000074", "mandat_signed": True, "company_name": "SECRET SAS"}
    mandate = {"id": f"m-{tag}", "type": "mandat", "status": "signed", "property_id": property["id"]}
    invoice = {"id": f"i-{tag}", "status": "a_valider", "total_ht": 4000}
    run(client, db.users.insert_one, user)
    run(client, db.properties.insert_one, property)
    run(client, db.generated_contracts.insert_one, mandate)
    run(client, db.invoices.insert_one, invoice)
    run(client, db.credits.insert_one, {"user_id": user["id"], "balance": 3})
    return user, property, mandate, invoice


def test_dry_run_puis_apply_puis_rollback(client):
    db = server.db
    user, property, mandate, invoice = _seed(client)

    report = run(client, run_migration, db, True)
    assert report["dry_run"] is True and report["users"] >= 1 and report["properties"] >= 1
    assert report["mandates"] >= 1 and report["invoices"] >= 1 and report["dropped"]["credits"] >= 1
    assert "kyc_documents" in run(client, db.users.find_one, {"id": user["id"]})
    assert run(client, db.properties.find_one, {"id": property["id"]}).get("trades") is None

    report = run(client, run_migration, db, False)
    assert report["dry_run"] is False
    u = run(client, db.users.find_one, {"id": user["id"]})
    assert u["email_verified"] is True and "kyc_documents" not in u and u["_migrations"]["refonte_2026_10"]["before"]["email_verified"] is None
    c = run(client, db.properties.find_one, {"id": property["id"]})
    assert c["trades"] == ["isolation"] and c["is_rge"] is True and c["moderation"]["status"] == "ok"
    assert c["title"].startswith("Entreprise d") and "SECRET" not in c["title"] and c["commission_terms_version"] == "v1"
    assert run(client, db.generated_contracts.find_one, {"id": mandate["id"]})["commission_terms_version"] == "v1"
    assert run(client, db.invoices.find_one, {"id": invoice["id"]})["status"] == "draft"
    assert run(client, db.credits.count_documents, {}) == 0

    # Idempotente : rien à refaire
    again = run(client, run_migration, db, True)
    assert again["users"] == 0 and again["properties"] == 0 and again["mandates"] == 0 and again["invoices"] == 0

    # Rollback : champs restaurés, marqueur retiré
    rb = run(client, run_rollback, db, False)
    assert rb["users"] >= 1 and rb["properties"] >= 1
    u = run(client, db.users.find_one, {"id": user["id"]})
    assert u["email_verified"] is False and "refonte_2026_10" not in (u.get("_migrations") or {})
    c = run(client, db.properties.find_one, {"id": property["id"]})
    assert "trades" not in c and "title" not in c and "moderation" not in c and "refonte_2026_10" not in (c.get("_migrations") or {})
    assert "commission_terms_version" not in run(client, db.generated_contracts.find_one, {"id": mandate["id"]})
    assert run(client, db.invoices.find_one, {"id": invoice["id"]})["status"] == "a_valider"


def test_annonces_pending_reprises_par_la_migration(client):
    """Ancien statut « en validation » : mandat signé → publiée et à relire (À faire) ; sinon → mandat à signer ; rollback"""
    db = server.db
    tag = uuid.uuid4().hex[:8]
    signed = {"id": f"cp-{tag}", "seller_id": f"u-{tag}", "status": "pending", "rge_types": ["Isolation des combles perdus"],
              "region": "Bretagne", "staff_count": 4, "siret": "73282932000074", "mandat_signed": True, "company_name": "SECRET SAS"}
    unsigned = {"id": f"cu-{tag}", "seller_id": f"u-{tag}", "status": "pending", "trades": ["isolation"], "title": "Entreprise",
                "region": "Bretagne", "siret": "73282932000074"}
    run(client, db.properties.insert_one, signed)
    run(client, db.properties.insert_one, unsigned)
    run(client, db.generated_contracts.insert_one, {"id": f"mp-{tag}", "type": "mandat", "status": "signed", "property_id": signed["id"],
                                                    "commission_terms_version": "v1"})
    run(client, run_migration, db, False)
    c = run(client, db.properties.find_one, {"id": signed["id"]})
    assert c["status"] == "published" and c["published_at"] and c["mandate_id"] == f"mp-{tag}"
    assert c["moderation"]["status"] == "pending" and "migration_sans_controles" in c["moderation"]["flags"]
    u = run(client, db.properties.find_one, {"id": unsigned["id"]})
    assert u["status"] == "mandat_en_attente" and u["mandate_pending_since"]
    todo = run(client, server.build_admin_todo)
    review = next(s for s in todo["sections"] if s["key"] == "listings_review")
    assert any(r["id"] == signed["id"] for r in review["rows"])
    run(client, run_rollback, db, False)
    c = run(client, db.properties.find_one, {"id": signed["id"]})
    assert c["status"] == "pending" and "published_at" not in c and "mandate_id" not in c
    assert run(client, db.properties.find_one, {"id": unsigned["id"]})["status"] == "pending"
