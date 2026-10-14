#!/usr/bin/env bash
# Sauvegarde MongoDB quotidienne (service `backup` de docker-compose.yml, image mongo:7).
#
# - mongodump --gzip --archive dans $BACKUP_DIR (volume `backups`), une fois par jour à $BACKUP_HOUR (heure UTC)
# - une archive n'est conservée que si mongodump a réussi et qu'elle n'est pas vide ; sinon rien n'est renommé,
#   aucune ancienne archive n'est supprimée, l'échec est écrit dans $BACKUP_DIR/last_failure et une nouvelle
#   tentative a lieu une heure plus tard
# - rétention : les $BACKUP_RETENTION_DAYS archives les plus récentes (14 par défaut, une par jour), appliquée
#   seulement après une sauvegarde réussie : les bonnes archives ne sont jamais effacées par une série d'échecs
# - $BACKUP_DIR/last_success contient la date de la dernière sauvegarde réussie (fraîcheur des sauvegardes)
# - le backend pousse ensuite la dernière archive vers S3 si S3_BUCKET est défini (job quotidien `backup_s3`)
#
# Variables : MONGO_URL (obligatoire), DB_NAME (vide = toute l'instance), BACKUP_DIR (/backups),
#             BACKUP_RETENTION_DAYS (14), BACKUP_HOUR (23, heure UTC), BACKUP_RETRY_SECONDS (3600),
#             BACKUP_ONCE=1 pour une sauvegarde immédiate puis sortie (code de sortie 1 en cas d'échec).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
HOUR="${BACKUP_HOUR:-23}"
RETRY_SECONDS="${BACKUP_RETRY_SECONDS:-3600}"
PREFIX="${DB_NAME:-mongodb}"

if [ -z "${MONGO_URL:-}" ]; then
  echo "MONGO_URL manquant" >&2
  exit 1
fi
case "$RETENTION" in ''|*[!0-9]*) echo "BACKUP_RETENTION_DAYS doit être un entier" >&2; exit 1 ;; esac
[ "$RETENTION" -ge 1 ] || RETENTION=1
mkdir -p "$BACKUP_DIR"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"; }

fail() {
  log "ÉCHEC : $*"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" > "$BACKUP_DIR/last_failure"
  return 1
}

# Garde les $RETENTION archives les plus récentes (jamais appelée après un échec)
prune() {
  local old
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/*.archive.gz 2>/dev/null | tail -n +"$((RETENTION + 1))" | while IFS= read -r old; do
    rm -f -- "$old" && log "supprimé $old"
  done
}

# Appelée sous la forme `run_backup || …` : `set -e` n'y est pas actif, chaque étape est donc vérifiée explicitement.
run_backup() {
  local stamp file tmp
  stamp="$(date -u +%Y-%m-%dT%H-%M)"
  file="$BACKUP_DIR/${PREFIX}-${stamp}.archive.gz"
  tmp="${file}.part"
  rm -f "$BACKUP_DIR"/*.part
  log "début → $file"
  local db_args=()
  if [ -n "${DB_NAME:-}" ]; then
    db_args=(--db="$DB_NAME")
  fi
  if ! mongodump --uri="$MONGO_URL" "${db_args[@]}" --gzip --archive="$tmp" --quiet; then
    rm -f "$tmp"
    fail "mongodump en échec (base injoignable, mot de passe changé ?) : aucune archive écrite, anciennes archives conservées"
    return 1
  fi
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    fail "archive vide : aucune archive écrite, anciennes archives conservées"
    return 1
  fi
  if ! mv "$tmp" "$file"; then
    rm -f "$tmp"
    fail "impossible de renommer l'archive (disque plein ?)"
    return 1
  fi
  date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/last_success"
  rm -f "$BACKUP_DIR/last_failure"
  log "terminé ($(du -h "$file" | cut -f1))"
  prune
}

seconds_until_next_run() {
  local now target
  now="$(date -u +%s)"
  target="$(date -u -d "$(date -u +%Y-%m-%d) ${HOUR}:00:00" +%s)"
  if [ "$target" -le "$now" ]; then
    target=$((target + 86400))
  fi
  echo $((target - now))
}

if [ "${BACKUP_ONCE:-0}" = "1" ]; then
  run_backup || exit 1
  exit 0
fi

# Première sauvegarde au démarrage si aucune archive n'existe encore (utile après une restauration ou un premier déploiement)
if ! ls "$BACKUP_DIR"/*.archive.gz >/dev/null 2>&1; then
  run_backup || log "première sauvegarde en échec (la base n'est peut-être pas encore prête)"
fi

while true; do
  wait="$(seconds_until_next_run)"
  log "prochaine sauvegarde dans ${wait}s"
  sleep "$wait"
  until run_backup; do
    log "nouvelle tentative dans ${RETRY_SECONDS}s"
    sleep "$RETRY_SECONDS"
  done
done
