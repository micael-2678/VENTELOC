#!/usr/bin/env bash
# Chaque variable d'environnement lue par le backend (os.environ / os.getenv dans backend/*.py et migrations/*.py,
# tests exclus) doit être documentée dans backend/.env.example (ligne active, commentée ou mentionnée en commentaire).
# Usage : ops/tests/check_env_doc.sh  (lancé par la CI)
set -euo pipefail
cd "$(dirname "$0")/../../backend"
missing=0
for var in $(grep -hoE "os\.(environ\.get|getenv)\(\s*[\"'][A-Z0-9_]+[\"']|os\.environ\[[\"'][A-Z0-9_]+[\"']\]" ./*.py migrations/*.py \
             | grep -oE "[A-Z][A-Z0-9_]+" | sort -u); do
  if ! grep -qE "(^|[^A-Z0-9_])${var}([^A-Z0-9_]|$)" .env.example; then
    echo "non documentée dans backend/.env.example : $var"
    missing=$((missing + 1))
  fi
done
[ "$missing" -eq 0 ] && echo "toutes les variables d'environnement du backend sont documentées"
exit "$((missing > 0))"
