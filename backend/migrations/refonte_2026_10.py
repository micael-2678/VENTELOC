"""
Migration de la refonte d'octobre 2026 (SPEC §7.9). Dry-run par défaut, idempotente, rollback des champs ajoutés.

Ce qu'elle fait (--apply) :
- users : `email_verified=True` sur tous les comptes existants (sinon plus de contact / signature / publication),
  purge des pièces KYC base64 (`kyc_documents`) ;
- properties : `trades` déduits de `rge_types` (sinon « renovation-generale »), `is_rge`, `title` généré (jamais le nom),
  `department` depuis le SIRET via l'open data (seulement avec --network, jamais en dry-run), `moderation.status='ok'`
  sur les annonces publiées, `commission_terms_version='v1'` sur les annonces dont le mandat est antérieur à la refonte ;
  annonces `pending` (ancien « en validation ») : mandat signé → `published` + relecture admin 48 h
  (`moderation.status='pending'`, drapeau `migration_sans_controles`), sinon → `mandat_en_attente` ;
- generated_contracts (mandats) : `commission_terms_version='v1'` quand absent (les nouveaux mandats sont en v2) ;
- invoices : `a_valider` → `draft` (listées dans GET /admin/invoices?status=draft, PDF non régénéré) ;
- collections `credits`, `credit_contacts`, `transactions` supprimées (irréversible : faire une sauvegarde avant,
  `ops/backup.sh`).

Chaque document modifié porte un marqueur `_migrations.refonte_2026_10` avec les valeurs d'origine : `--rollback`
restaure ces champs et retire le marqueur (les collections supprimées ne sont pas restaurées).

Usage :  cd backend && python -m migrations.refonte_2026_10 [--apply] [--network] [--rollback]
"""
import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import taxonomy  # noqa: E402

MARKER = "_migrations.refonte_2026_10"
DROPPED_COLLECTIONS = ("credits", "credit_contacts", "transactions")


def _marker(before: dict, now: str) -> dict:
    return {"at": now, "before": before}


async def _migrate_users(db, dry_run: bool, now: str, report: dict):
    changed = 0
    async for u in db.users.find({MARKER: {"$exists": False}}, {"_id": 0, "id": 1, "email_verified": 1, "kyc_documents": 1, "deleted_at": 1}):
        if u.get("deleted_at"):
            continue
        before = {"email_verified": u.get("email_verified"), "had_kyc_documents": "kyc_documents" in u}
        if u.get("email_verified") is True and "kyc_documents" not in u:
            continue
        changed += 1
        if not dry_run:
            await db.users.update_one({"id": u["id"]}, {"$set": {"email_verified": True, "email_verified_at": u.get("email_verified_at") or now,
                                                            MARKER: _marker(before, now)},
                                                   "$unset": {"kyc_documents": ""}})
    report["users"] = changed


async def _signed_mandate_for(db, c: dict):
    """Mandat signé de l'annonce (par `mandate_id`, sinon par `property_id`) ; None s'il n'y en a pas"""
    query = {"type": "mandat", "status": "signed"}
    if c.get("mandate_id"):
        found = await db.generated_contracts.find_one({**query, "id": c["mandate_id"]}, {"_id": 0, "id": 1})
        if found:
            return found
    return await db.generated_contracts.find_one({**query, "property_id": c["id"]}, {"_id": 0, "id": 1})


async def _migrate_pending_listing(db, c: dict, now: str, update: dict, before: dict):
    """Annonce `pending` : mandat signé → publiée et listée « à relire » (48 h) dans le todo admin ;
    sinon → `mandat_en_attente` (relances de signature J+1/J+4/J+10). Les champs touchés vont dans `before`."""
    from datetime import timedelta
    for key in ("status", "published_at", "mandate_pending_since", "mandate_id"):
        before[key] = c.get(key)
    mandate = await _signed_mandate_for(db, c)
    if mandate:
        update["status"] = "published"
        update["published_at"] = c.get("published_at") or now
        if not c.get("mandate_id"):
            update["mandate_id"] = mandate["id"]
        review_until = (datetime.fromisoformat(now) + timedelta(hours=48)).isoformat()
        update["moderation"] = {"status": "pending", "flags": ["migration_sans_controles"], "review_until": review_until,
                                "reason": None, "migrated": True}
    else:
        update["status"] = "mandat_en_attente"
        update["mandate_pending_since"] = now


async def _migrate_properties(db, dry_run: bool, network: bool, now: str, report: dict):
    changed = 0
    department_lookup = None
    if network and not dry_run:
        import opendata
        department_lookup = opendata.department_from_siret
    async for c in db.properties.find({MARKER: {"$exists": False}}, {"_id": 0}):
        before = {k: c.get(k) for k in ("trades", "is_rge", "title", "department", "moderation", "commission_terms_version")}
        update = {}
        if not c.get("trades"):
            update["trades"] = taxonomy.trades_for_rge(c.get("rge_types")) or ["renovation-generale"]
        if "is_rge" not in c:
            update["is_rge"] = bool(c.get("rge_types"))
        trades = update.get("trades") or c.get("trades")
        if not c.get("title"):
            update["title"] = taxonomy.listing_title(trades, c.get("region"), c.get("staff_count"))
        if not c.get("department") and c.get("siret") and department_lookup:
            try:
                dep = await department_lookup(c["siret"])
                if dep:
                    update["department"] = dep
            except Exception:
                pass
        if c.get("status") == "published" and (c.get("moderation") or {}).get("status") != "ok":
            update["moderation"] = {"status": "ok", "flags": [], "reviewed_at": now, "reason": None, "migrated": True}
        if c.get("mandat_signed") and not c.get("commission_terms_version"):
            update["commission_terms_version"] = "v1"
        if c.get("status") == "pending":
            # Ancien statut « en validation (sous 48 h) » : n'existe plus (publication automatique, SPEC §4.4)
            await _migrate_pending_listing(db, c, now, update, before)
        if not update:
            continue
        changed += 1
        if not dry_run:
            update[MARKER] = _marker(before, now)
            await db.properties.update_one({"id": c["id"]}, {"$set": update})
    report["properties"] = changed


async def _migrate_mandates(db, dry_run: bool, now: str, report: dict):
    query = {"type": "mandat", "commission_terms_version": {"$exists": False}, MARKER: {"$exists": False}}
    count = await db.generated_contracts.count_documents(query)
    if not dry_run and count:
        async for m in db.generated_contracts.find(query, {"_id": 0, "id": 1}):
            await db.generated_contracts.update_one({"id": m["id"]}, {"$set": {"commission_terms_version": "v1",
                                                                              MARKER: _marker({"commission_terms_version": None}, now)}})
    report["mandates"] = count


async def _migrate_invoices(db, dry_run: bool, now: str, report: dict):
    query = {"status": "a_valider", MARKER: {"$exists": False}}
    count = await db.invoices.count_documents(query)
    if not dry_run and count:
        async for i in db.invoices.find(query, {"_id": 0, "id": 1}):
            await db.invoices.update_one({"id": i["id"]}, {"$set": {"status": "draft", MARKER: _marker({"status": "a_valider"}, now)}})
    report["invoices"] = count


async def _drop_credits(db, dry_run: bool, report: dict):
    dropped = {}
    for name in DROPPED_COLLECTIONS:
        coll = db[name]
        n = await coll.count_documents({})
        dropped[name] = n
        if not dry_run and n:
            await coll.drop()
    report["dropped"] = dropped


async def run_migration(db, dry_run: bool = True, network: bool = False) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    report = {"mode": "migration", "dry_run": dry_run}
    await _migrate_users(db, dry_run, now, report)
    await _migrate_properties(db, dry_run, network, now, report)
    await _migrate_mandates(db, dry_run, now, report)
    await _migrate_invoices(db, dry_run, now, report)
    await _drop_credits(db, dry_run, report)
    return report


async def run_rollback(db, dry_run: bool = True) -> dict:
    report = {"mode": "rollback", "dry_run": dry_run}
    # users
    n = 0
    async for u in db.users.find({MARKER: {"$exists": True}}, {"_id": 0, "id": 1, "_migrations": 1}):
        before = (u.get("_migrations") or {}).get("refonte_2026_10", {}).get("before", {})
        n += 1
        if not dry_run:
            ops = {"$unset": {MARKER: ""}}
            if before.get("email_verified") is not True:
                ops["$set"] = {"email_verified": bool(before.get("email_verified"))}
            await db.users.update_one({"id": u["id"]}, ops)
    report["users"] = n
    # properties
    n = 0
    async for c in db.properties.find({MARKER: {"$exists": True}}, {"_id": 0, "id": 1, "_migrations": 1}):
        before = (c.get("_migrations") or {}).get("refonte_2026_10", {}).get("before", {})
        n += 1
        if not dry_run:
            restore = {k: v for k, v in before.items() if v is not None}
            unset = {k: "" for k, v in before.items() if v is None}
            unset[MARKER] = ""
            ops = {"$unset": unset}
            if restore:
                ops["$set"] = restore
            await db.properties.update_one({"id": c["id"]}, ops)
    report["properties"] = n
    # mandats et factures
    for coll, field, name in ((db.generated_contracts, "commission_terms_version", "mandates"), (db.invoices, "status", "invoices")):
        n = 0
        async for d in coll.find({MARKER: {"$exists": True}}, {"_id": 0, "id": 1, "_migrations": 1}):
            before = (d.get("_migrations") or {}).get("refonte_2026_10", {}).get("before", {})
            n += 1
            if not dry_run:
                ops = {"$unset": {MARKER: ""}}
                if before.get(field) is None:
                    ops["$unset"][field] = ""
                else:
                    ops["$set"] = {field: before[field]}
                await coll.update_one({"id": d["id"]}, ops)
        report[name] = n
    report["dropped"] = "non restaurées (sauvegarde ops/backup.sh)"
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="appliquer (sinon simulation)")
    parser.add_argument("--network", action="store_true", help="interroger l'open data pour le département (avec --apply)")
    parser.add_argument("--rollback", action="store_true", help="restaurer les champs modifiés")
    args = parser.parse_args()
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    if args.rollback:
        result = asyncio.run(run_rollback(db, dry_run=not args.apply))
    else:
        result = asyncio.run(run_migration(db, dry_run=not args.apply, network=args.network))
    print(f"{result['mode']} — {'SIMULATION' if result['dry_run'] else 'APPLIQUÉ'}")
    for k, v in result.items():
        if k not in ("mode", "dry_run"):
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
