"""
Rattrapage des annonces publiées sans mandat signé (référentiel v2, règle 6.1).

- Les annonces `published` sans mandat signé passent en `mandat_en_attente` (retirées des résultats publics).
  Elles ne sont jamais supprimées : un marqueur `_migrations.mandate_backfill` garde le statut d'origine.
- Idempotent : une annonce déjà marquée n'est pas retraitée.
- `--dry-run` (défaut) : n'écrit rien, liste ce qui serait fait. `--apply` : applique. `--rollback` : restaure.
- `--notify` : envoie au cédant un e-mail l'invitant à signer son mandat (avec --apply).

Usage :  cd backend && python -m migrations.mandate_backfill [--apply] [--rollback] [--notify]
"""
import argparse
import asyncio
import os
from datetime import datetime, timezone

MARKER = "_migrations.mandate_backfill"


async def _has_signed_mandate(db, property):
    query = {"type": "mandat", "status": "signed", "property_id": property["id"]}
    if property.get("mandate_id"):
        query = {"id": property["mandate_id"], "type": "mandat", "status": "signed"}
    return bool(await db.generated_contracts.find_one(query))


async def run_backfill(db, dry_run=True, rollback=False, notify=None):
    now = datetime.now(timezone.utc).isoformat()
    changed = []
    if rollback:
        async for c in db.properties.find({MARKER: {"$exists": True}}, {"_id": 0}):
            marker = (c.get("_migrations") or {}).get("mandate_backfill") or {}
            if c.get("status") != "mandat_en_attente":
                continue  # l'annonce a évolué depuis (mandat signé, retrait…) : on ne touche pas
            changed.append({"id": c["id"], "from": c["status"], "to": marker.get("from_status", "published")})
            if not dry_run:
                await db.properties.update_one({"id": c["id"]}, {"$set": {"status": marker.get("from_status", "published")},
                                                                  "$unset": {MARKER: ""}})
        return {"mode": "rollback", "dry_run": dry_run, "count": len(changed), "listings": changed}

    async for c in db.properties.find({"status": "published", MARKER: {"$exists": False}}, {"_id": 0}):
        if await _has_signed_mandate(db, c):
            continue
        changed.append({"id": c["id"], "from": "published", "to": "mandat_en_attente", "seller_id": c.get("seller_id")})
        if not dry_run:
            await db.properties.update_one({"id": c["id"]}, {"$set": {
                "status": "mandat_en_attente", "updated_at": now,
                MARKER: {"from_status": "published", "at": now},
            }})
            if notify:
                await notify(c.get("seller_id"), c["id"])
    return {"mode": "backfill", "dry_run": dry_run, "count": len(changed), "listings": changed}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="appliquer (sinon simulation)")
    parser.add_argument("--rollback", action="store_true", help="restaurer le statut d'origine")
    parser.add_argument("--notify", action="store_true", help="prévenir les cédants par e-mail")
    args = parser.parse_args()
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    notify = None
    if args.notify and args.apply and not args.rollback:
        import server  # e-mails avec les modèles de la plateforme
        notify = lambda seller_id, property_id: server.email_user(  # noqa: E731
            seller_id, "listing_mandate_backfill", link=server.site_url(f"/seller/mandat/{property_id}"))
    result = asyncio.run(run_backfill(db, dry_run=not args.apply, rollback=args.rollback, notify=notify))
    print(f"{result['mode']} — {'SIMULATION' if result['dry_run'] else 'APPLIQUÉ'} — {result['count']} annonce(s)")
    for row in result["listings"]:
        print(f"  {row['id']} : {row['from']} → {row['to']}")


if __name__ == "__main__":
    main()
