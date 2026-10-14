#!/usr/bin/env bash
# Restauration d'une sauvegarde MongoDB (archives produites par ops/backup.sh dans le volume `backups`).
#
# Usage :
#   ops/restore.sh --list                      liste les archives disponibles
#   ops/restore.sh --test <archive>            restaure dans une base <DB_NAME>_restore_test et compte les documents
#                                              (procédure de test, sans toucher à la base de production)
#   ops/restore.sh <archive> [--drop]          restaure dans la base de production (--drop remplace les collections)
#   ops/restore.sh --from-s3 <clé>             copie d'abord l'archive S3 (ex. backups/<fichier>) dans le volume `backups`
#
# <archive> est un nom de fichier dans le volume (ex. cessionrge_prod-2026-10-10T23-00.archive.gz) ou un chemin local.
# Le script s'exécute sur l'hôte Docker, dans le dossier du docker-compose.yml déployé (avec Dokploy :
# /etc/dokploy/compose/<nom-de-l-application>/code, et COMPOSE="docker compose -p <nom-de-l-application>").
# Variables lues dans l'environnement, sinon dans .env (clé par clé, le fichier n'est jamais exécuté) :
# MONGO_PASSWORD, DB_NAME (défaut cessionrge_prod), MONGO_URI (défaut mongodb://admin:<MONGO_PASSWORD>@mongodb:27017),
# COMPOSE (défaut « docker compose »). RESTORE_DRY_RUN=1 affiche les commandes sans les exécuter.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env}"

# Valeur d'une clé du .env, sans l'exécuter (une valeur avec espaces, ex. LEGAL_CARTE_T, ferait échouer `source`)
getenv_file() {
  [ -f "$ENV_FILE" ] || return 0
  { grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$ENV_FILE" || true; } | tail -n 1 \
    | sed -E "s/^[^=]*=//; s/^[[:space:]]+//; s/[[:space:]]+\$//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/"
}

MONGO_PASSWORD="${MONGO_PASSWORD:-$(getenv_file MONGO_PASSWORD)}"
DB_NAME="${DB_NAME:-$(getenv_file DB_NAME)}"
DB_NAME="${DB_NAME:-cessionrge_prod}"
COMPOSE="${COMPOSE:-docker compose}"
MONGO_URI="${MONGO_URI:-mongodb://admin:${MONGO_PASSWORD}@mongodb:27017}"

run() {
  if [ "${RESTORE_DRY_RUN:-0}" = "1" ]; then
    echo "+ $*"
  else
    "$@"
  fi
}

# Toute commande mongo tourne dans un conteneur éphémère du service backup (même réseau, même volume)
in_backup() {
  # shellcheck disable=SC2086
  run $COMPOSE run --rm --no-deps -T --entrypoint "" backup "$@"
}

usage() { sed -n '2,/^set -euo/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'; exit 1; }

[ $# -ge 1 ] || usage
mode="restore"; archive=""; drop=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list) mode="list" ;;
    --test) mode="test" ;;
    --drop) drop="--drop" ;;
    --from-s3) mode="from-s3" ;;
    -h|--help) usage ;;
    *) archive="$1" ;;
  esac
  shift
done

case "$mode" in
  list)
    in_backup sh -c 'ls -lh /backups/*.archive.gz 2>/dev/null || echo "aucune archive"; cat /backups/last_success 2>/dev/null | sed "s/^/dernière sauvegarde réussie : /"; cat /backups/last_failure 2>/dev/null | sed "s/^/dernier échec : /"; true'
    ;;
  from-s3)
    [ -n "$archive" ] || usage
    name="$(basename "$archive")"
    # Le volume est monté en lecture seule dans le backend : téléchargement dans /tmp du backend (boto3 et les clés S3
    # y sont déjà), puis copie vers le volume `backups` par le service backup.
    # shellcheck disable=SC2086
    run $COMPOSE exec -T backend python -c "
import boto3, os, sys
s3 = boto3.client('s3', endpoint_url=os.environ.get('S3_ENDPOINT_URL') or None, region_name=os.environ.get('S3_REGION') or None)
bucket = os.environ.get('S3_BUCKET') or sys.exit('S3_BUCKET manquant dans le backend')
s3.download_file(bucket, sys.argv[1], '/tmp/' + sys.argv[2]); print('téléchargé', '/tmp/' + sys.argv[2])
" "$archive" "$name"
    host_tmp="$(mktemp -d)"
    trap 'rm -rf "$host_tmp"' EXIT
    # shellcheck disable=SC2086
    run $COMPOSE cp "backend:/tmp/$name" "$host_tmp/$name"
    # shellcheck disable=SC2086
    run $COMPOSE cp "$host_tmp/$name" "backup:/backups/$name"
    # shellcheck disable=SC2086
    run $COMPOSE exec -T backend rm -f "/tmp/$name"
    echo "Archive copiée dans le volume backups. Relancez : ops/restore.sh --test $name  puis  ops/restore.sh $name --drop"
    ;;
  test)
    [ -n "$archive" ] || usage
    test_db="${DB_NAME}_restore_test"
    echo "Restauration de test dans $test_db (la base $DB_NAME n'est pas modifiée)"
    in_backup mongorestore --uri="$MONGO_URI" --gzip --archive="/backups/$(basename "$archive")" \
      --nsFrom="${DB_NAME}.*" --nsTo="${test_db}.*" --drop --quiet
    # URI sans base : l'utilisateur admin s'authentifie sur la base `admin`, la base de test est ouverte ensuite
    in_backup mongosh "$MONGO_URI" --quiet --eval '
      const t = db.getSiblingDB("'"$test_db"'");
      const names = t.getCollectionNames().sort();
      let total = 0;
      for (const n of names) { const c = t.getCollection(n).countDocuments(); total += c; print(n + " : " + c); }
      print("collections : " + names.length + ", documents : " + total);
      if (!names.includes("users") || !names.includes("properties")) { print("ÉCHEC : collections attendues absentes"); t.dropDatabase(); quit(2); }
      print("RESTAURATION DE TEST OK");
      t.dropDatabase();'
    ;;
  restore)
    [ -n "$archive" ] || usage
    echo "Restauration de $archive dans $DB_NAME ${drop:+(collections remplacées)}"
    if [ "${RESTORE_DRY_RUN:-0}" != "1" ]; then
      read -r -p "Confirmer (oui/non) ? " answer
      [ "$answer" = "oui" ] || { echo "annulé"; exit 1; }
    fi
    in_backup mongorestore --uri="$MONGO_URI" --gzip --archive="/backups/$(basename "$archive")" \
      --nsInclude="${DB_NAME}.*" $drop --quiet
    echo "Terminé. Redémarrez le backend : $COMPOSE restart backend"
    ;;
esac
