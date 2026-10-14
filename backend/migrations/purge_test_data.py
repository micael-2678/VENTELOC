"""
Purge des données de test (MODE-TEST-ET-APP.md §B.2.11). Dry-run par défaut.

Supprime tout ce qui porte `is_test: true` ou qui est rattaché à un utilisateur `is_test` (directement ou par une annonce,
un contrat, une offre, une étape de vente, une conversation de test) : utilisateurs, annonces, photos et documents de la
data room (fichiers stockés compris, via storage.py), conversations, messages, demandes de dossier, contrats et preuves de
signature, offres, étapes de vente, factures de test, alertes, événements, estimations, e-mails de la boîte de test et
compteurs `*_test` (registre des mandats de test, factures de test), journaux d'identité révélée. Une donnée sans `is_test`
et sans lien vers une donnée de test n'est jamais touchée.

Défense en profondeur : un mandat inscrit au registre réel (numéro entier, sans `is_test`) et une facture réelle
(FAC-…, sans `is_test`) ne sont jamais supprimés, ni l'annonce qui porte ce mandat (avec ses preuves et son journal
d'audit) : ils sont signalés dans le résultat (`protected`) pour être examinés à la main.

La même fonction sert à la route admin `POST /api/admin/test/purge?dry_run=true|false` (testmode.py), disponible même
hors mode test pour nettoyer la base avant l'ouverture réelle.

Usage :  cd backend && python -m migrations.purge_test_data [--apply]
"""
import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from storage import delete_file  # noqa: E402

TEST_COUNTER_SUFFIX = "_test"
# Collections dont les documents portent un fichier stocké (base64 en base, ou objet S3 à supprimer)
FILE_COLLECTIONS = ("property_photos", "dataroom")


def _any(*clauses) -> dict:
    """Requête « l'une des conditions » en ignorant les listes vides (aucun `$in: []` inutile)"""
    kept = [c for c in clauses if c and all(not (isinstance(v, dict) and v.get("$in") == []) for v in c.values())]
    if not kept:
        return {"_id": {"$exists": False}}  # ne correspond à rien
    return kept[0] if len(kept) == 1 else {"$or": kept}


def _in(field: str, ids) -> dict:
    return {field: {"$in": sorted(set(ids))}}


def _except(query: dict, field: str, ids) -> dict:
    """`query` sauf les documents dont `field` est dans `ids` (données réelles protégées)"""
    return {"$and": [query, {field: {"$nin": sorted(set(ids))}}]} if ids else query


def _real_registry_number(value) -> bool:
    """Numéro du registre réel des mandats : entier (le registre de test porte « TEST-0001 »)"""
    return isinstance(value, int) and not isinstance(value, bool)


async def protected_records(db) -> dict:
    """Données réelles jamais purgées, même rattachées à une donnée de test : mandats du registre réel et factures réelles
    → {contracts: [{id, property_id, registry_number}], invoices: [{id, number, closing_id}]}"""
    contracts = [c for c in await db.generated_contracts.find(
        {"type": "mandat", "is_test": {"$ne": True}, "registry_number": {"$exists": True}},
        {"_id": 0, "id": 1, "property_id": 1, "registry_number": 1}).to_list(None) if _real_registry_number(c.get("registry_number"))]
    invoices = await db.invoices.find({"is_test": {"$ne": True}, "number": {"$regex": "^FAC-"}},
                                      {"_id": 0, "id": 1, "number": 1, "closing_id": 1}).to_list(None)
    return {"contracts": contracts, "invoices": invoices}


async def _ids(coll, query: dict, field: str = "id") -> list:
    return [d[field] for d in await coll.find(query, {"_id": 0, field: 1}).to_list(None) if d.get(field)]


async def purge_plan(db) -> tuple:
    """([(collection, requête)], ids des utilisateurs de test, ids des annonces de test) : données de test dans l'ordre de
    suppression (les liens sont résolus une seule fois, avant toute suppression)"""
    is_test = {"is_test": True}
    protected = await protected_records(db)
    protected_contracts = [c["id"] for c in protected["contracts"]]
    protected_properties = [c["property_id"] for c in protected["contracts"] if c.get("property_id")]
    protected_invoices = [i["id"] for i in protected["invoices"]]
    user_ids = await _ids(db.users, is_test)
    property_ids = await _ids(db.properties, _except(_any(is_test, _in("seller_id", user_ids), _in("president_id", user_ids)),
                                                   "id", protected_properties))
    contract_ids = await _ids(db.generated_contracts, _except(_any(is_test, _in("seller_id", user_ids), _in("buyer_id", user_ids),
                                                                   _in("property_id", property_ids)), "id", protected_contracts))
    offer_ids = await _ids(db.offers, _any(is_test, _in("seller_id", user_ids), _in("buyer_id", user_ids), _in("property_id", property_ids)))
    closing_ids = await _ids(db.closings, _any(is_test, _in("seller_id", user_ids), _in("buyer_id", user_ids),
                                               _in("property_id", property_ids), _in("offer_id", offer_ids)))
    invoice_ids = await _ids(db.invoices, _except(_any(is_test, _in("closing_id", closing_ids), _in("property_id", property_ids),
                                                       _in("debtor.user_id", user_ids)), "id", protected_invoices))
    conversation_ids = await _ids(db.conversations, _any(is_test, _in("seller_id", user_ids), _in("buyer_id", user_ids),
                                                         _in("property_id", property_ids)))
    by_user = lambda field="user_id": _in(field, user_ids)  # noqa: E731
    by_property = _in("property_id", property_ids)
    return [
        ("test_emails", {}),
        ("counters", {"_id": {"$regex": f"{TEST_COUNTER_SUFFIX}$"}}),
        ("events", is_test),
        ("estimates", is_test),
        ("public_alerts", is_test),
        ("alerts", _any(is_test, by_user())),
        ("favorites", _any(by_user(), by_property)),
        ("property_photos", _any(is_test, by_property)),
        ("dataroom", _any(is_test, by_property, by_user("uploaded_by"))),
        ("dataroom_access_logs", _any(by_property, by_user(), by_user("buyer_id"))),
        ("dataroom_access", _any(is_test, by_property, by_user("buyer_id"))),
        ("messages", _any(_in("conversation_id", conversation_ids), by_property, by_user("sender_id"), by_user("receiver_id"))),
        ("conversations", _any(is_test, _in("id", conversation_ids))),
        ("contacts", _any(by_property, by_user("buyer_id"))),
        ("contact_attempts", _any(by_property, by_user("sender_id"), by_user("receiver_id"))),
        ("commercial_info_requests", _any(by_property, by_user("buyer_id"), by_user("seller_id"))),
        ("followups", _any(by_property, by_user("buyer_id"))),
        ("documents", _except(_any(is_test, _in("contract_id", contract_ids), by_property, by_user("signer_id")),
                              "contract_id", protected_contracts)),
        ("signature_otps", _any(_in("contract_id", contract_ids), by_user())),
        ("generated_contracts", _except(_any(is_test, _in("id", contract_ids)), "id", protected_contracts)),
        ("offer_pdfs", _in("offer_id", offer_ids)),
        ("offers", _any(is_test, _in("id", offer_ids))),
        ("nps", _any(_in("closing_id", closing_ids), by_user())),
        ("todos", _any(_in("ref.property_id", property_ids), _in("ref.closing_id", closing_ids), _in("ref.invoice_id", invoice_ids))),
        ("invoices", _except(_any(is_test, _in("id", invoice_ids)), "id", protected_invoices)),
        ("closings", _any(is_test, _in("id", closing_ids))),
        ("incidents", by_property),
        # Journal d'audit chaîné : seules les chaînes des annonces de test sont supprimées (jamais un maillon d'une annonce réelle)
        ("audit_logs", by_property),
        ("president_invitations", _any(by_property, by_user("invited_by"))),
        ("dirigeant_verifications", by_user()),
        ("email_verifications", by_user()),
        ("login_otps", by_user()),
        ("password_resets", by_user()),
        ("kyc_sessions", by_user()),
        ("contact_reveal_logs", _any(by_property, by_user("who"), by_user("subject_id"))),
        ("properties", _except(_any(is_test, _in("id", property_ids)), "id", protected_properties)),
        ("users", _any(is_test, _in("id", user_ids))),
    ], user_ids, property_ids


async def purge_test_data(db, dry_run: bool = True) -> dict:
    """Compte (dry_run) ou supprime les données de test ; renvoie {dry_run, counts: {collection: n}, total, files}.
    Les fichiers des photos et de la data room sont supprimés du stockage (S3) avant leurs documents."""
    plan, user_ids, property_ids = await purge_plan(db)
    counts, files = {}, 0
    # Étapes de vente réelles facturées pendant l'essai : la facture de test supprimée n'y reste pas référencée (une
    # facture réelle pourra être émise)
    invoices_query = dict(plan)["invoices"]
    purged_invoice_ids = await _ids(db.invoices, invoices_query)
    unlinked = {"invoice_id": {"$in": purged_invoice_ids}, "is_test": {"$ne": True}}
    unlinked_count = await db.closings.count_documents(unlinked) if purged_invoice_ids else 0
    # Une annonce réelle garde sa liste nominative de repreneurs présentés : seuls les repreneurs de test en sont retirés
    presented = {"presented_buyers.buyer_id": {"$in": user_ids}, "id": {"$nin": property_ids}}
    presented_count = await db.properties.count_documents(presented) if user_ids else 0
    if unlinked_count and not dry_run:
        await db.closings.update_many(unlinked, {"$unset": {"invoice_id": "", "invoice_number": ""}})
    for name, query in plan:
        coll = db[name]
        n = await coll.count_documents(query)
        if n:
            counts[name] = n
        if dry_run or not n:
            continue
        if name in FILE_COLLECTIONS:
            async for doc in coll.find(query, {"_id": 0, "storage": 1, "storage_key": 1}):
                if doc.get("storage") == "s3":
                    try:
                        await delete_file(doc)
                        files += 1
                    except Exception as e:  # un objet déjà absent ne bloque pas la purge
                        logging.warning(f"Fichier de test non supprimé du stockage ({doc.get('storage_key')}) : {e}")
        await coll.delete_many(query)
    if presented_count:
        counts["properties.presented_buyers"] = presented_count
        if not dry_run:
            await db.properties.update_many(presented, {"$pull": {"presented_buyers": {"buyer_id": {"$in": user_ids}}}})
    if unlinked_count:
        counts["closings.invoice_id"] = unlinked_count
    protected = await _protected_report(db, user_ids)
    return {"dry_run": dry_run, "counts": counts, "total": sum(v for k, v in counts.items() if "." not in k), "files": files,
            "protected": protected}


async def _protected_report(db, user_ids: list) -> dict:
    """Données réelles conservées alors qu'elles touchent une donnée de test (annonce de test, utilisateur de test) :
    {generated_contracts: [{id, registry_number}], invoices: [{id, number}]} (listes vides si rien à signaler)"""
    protected = await protected_records(db)
    contracts, invoices = [], []
    if protected["contracts"]:
        test_properties = set(await _ids(db.properties, _any({"is_test": True}, _in("seller_id", user_ids))))
        contracts = [{"id": c["id"], "registry_number": c["registry_number"]} for c in protected["contracts"]
                     if c.get("property_id") in test_properties]
    if protected["invoices"]:
        test_closings = set(await _ids(db.closings, _any({"is_test": True}, _in("seller_id", user_ids), _in("buyer_id", user_ids))))
        invoices = [{"id": i["id"], "number": i["number"]} for i in protected["invoices"] if i.get("closing_id") in test_closings]
    return {"generated_contracts": contracts, "invoices": invoices}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="supprimer (sinon simulation : comptes par collection)")
    args = parser.parse_args()
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    result = asyncio.run(purge_test_data(db, dry_run=not args.apply))
    print(f"Purge des données de test — {'SIMULATION' if result['dry_run'] else 'APPLIQUÉE'}")
    if not result["counts"]:
        print("  Aucune donnée de test.")
    for name, n in result["counts"].items():
        print(f"  {name}: {n}")
    for name, items in result["protected"].items():
        for item in items:
            print(f"  CONSERVÉ ({name}, donnée réelle liée à une donnée de test) : {item}")
    if not result["dry_run"]:
        print(f"  fichiers supprimés du stockage S3 : {result['files']}")
    elif result["counts"]:
        print("Relancer avec --apply pour supprimer.")


if __name__ == "__main__":
    main()
