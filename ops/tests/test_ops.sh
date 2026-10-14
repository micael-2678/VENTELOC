#!/usr/bin/env bash
# Tests de non-régression des scripts d'exploitation (sans Docker ni MongoDB : mongodump simulé).
# Usage : ops/tests/test_ops.sh   (lancé par la CI, job backend)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failures=0

check() { # check <description> <commande…>
  local desc="$1"; shift
  if "$@"; then echo "ok   - $desc"; else echo "ÉCHEC - $desc"; failures=$((failures + 1)); fi
}

# ---- Faux mongodump : FAKE_MODE=fail (écrit 8 octets puis sort en 1), empty (succès sans rien écrire), ok ----
mkdir -p "$WORK/bin"
cat > "$WORK/bin/mongodump" <<'EOF'
#!/bin/sh
for a; do case "$a" in --archive=*) f="${a#--archive=}";; esac; done
case "$FAKE_MODE" in
  fail) printf 'partial!' > "$f"; echo "Failed: connection reset" >&2; exit 1 ;;
  empty) : > "$f"; exit 0 ;;
  *) printf 'archive-complete' > "$f"; exit 0 ;;
esac
EOF
chmod +x "$WORK/bin/mongodump"

run_once() { # run_once <mode> <dossier>
  FAKE_MODE="$1" PATH="$WORK/bin:$PATH" MONGO_URL="mongodb://x" DB_NAME="testdb" BACKUP_DIR="$2" \
    BACKUP_RETENTION_DAYS=14 BACKUP_ONCE=1 bash "$ROOT/ops/backup.sh" > "$2.log" 2>&1
}

# 20 anciennes archives valides (une par jour)
seed_archives() {
  mkdir -p "$1"
  for i in $(seq 1 20); do
    f="$1/testdb-old-$(printf '%02d' "$i").archive.gz"
    printf 'old' > "$f"
    touch -d "$i days ago" "$f"
  done
}

# 1. mongodump en échec : code de sortie 1, aucune archive créée, rien de supprimé, last_failure écrit
d="$WORK/fail"; seed_archives "$d"
run_once fail "$d"; rc=$?
check "mongodump en échec → code de sortie non nul" test "$rc" -ne 0
check "mongodump en échec → aucune nouvelle archive" test "$(ls "$d"/*.archive.gz | wc -l)" -eq 20
check "mongodump en échec → aucun fichier .part restant" test -z "$(ls "$d"/*.part 2>/dev/null)"
check "mongodump en échec → pas de « terminé » dans le journal" bash -c "! grep -q 'terminé' '$d.log'"
check "mongodump en échec → ÉCHEC journalisé" grep -q "ÉCHEC" "$d.log"
check "mongodump en échec → last_failure écrit, pas de last_success" bash -c "test -s '$d/last_failure' && test ! -e '$d/last_success'"

# 2. archive vide : refusée
d="$WORK/empty"; seed_archives "$d"
run_once empty "$d"; rc=$?
check "archive vide → code de sortie non nul" test "$rc" -ne 0
check "archive vide → anciennes archives conservées" test "$(ls "$d"/*.archive.gz | wc -l)" -eq 20

# 3. succès : archive créée, rétention = 14 archives les plus récentes, last_success écrit
d="$WORK/ok"; seed_archives "$d"
run_once ok "$d"; rc=$?
check "succès → code de sortie 0" test "$rc" -eq 0
check "succès → rétention à 14 archives" test "$(ls "$d"/*.archive.gz | wc -l)" -eq 14
check "succès → la nouvelle archive est conservée" bash -c "ls '$d'/testdb-20*.archive.gz >/dev/null"
check "succès → les plus anciennes sont supprimées" test ! -e "$d/testdb-old-20.archive.gz"
check "succès → last_success écrit" test -s "$d/last_success"

# ---- restore.sh : doit fonctionner avec un .env copié de .env.example (valeurs avec espaces) ----
R="$WORK/repo"
mkdir -p "$R/ops"
cp "$ROOT/ops/restore.sh" "$R/ops/restore.sh"
cp "$ROOT/.env.example" "$R/.env"
printf 'LEGAL_CARTE_T=CPI 7801 2025 000 000 049\nMONGO_PASSWORD="s3cret"\nDB_NAME=prod_db\n' >> "$R/.env"
out="$(cd "$R" && RESTORE_DRY_RUN=1 bash ops/restore.sh --test x.archive.gz 2>&1)"; rc=$?
check "restore.sh --test avec un .env issu de .env.example → code 0" test "$rc" -eq 0
check "restore.sh lit MONGO_PASSWORD (guillemets retirés) et DB_NAME du .env" \
  bash -c "grep -q 'admin:s3cret@mongodb' <<<\"\$1\" && grep -q 'prod_db_restore_test' <<<\"\$1\"" _ "$out"
out="$(cd "$R" && RESTORE_DRY_RUN=1 bash ops/restore.sh --list 2>&1)"; rc=$?
check "restore.sh --list avec un .env issu de .env.example → code 0" test "$rc" -eq 0
printf 'S3_BUCKET=mon-bucket\n' >> "$R/.env"
out="$(cd "$R" && RESTORE_DRY_RUN=1 bash ops/restore.sh --from-s3 backups/x.archive.gz 2>&1)"; rc=$?
check "restore.sh --from-s3 → code 0" test "$rc" -eq 0
check "restore.sh --from-s3 n'écrit pas dans /backups du backend (volume en lecture seule)" \
  bash -c "! grep -q \"dest = '/backups/\" <<<\"\$1\" && grep -q 'cp ' <<<\"\$1\"" _ "$out"

if [ "$failures" -gt 0 ]; then
  echo "$failures test(s) en échec"
  exit 1
fi
echo "tous les tests d'exploitation passent"
