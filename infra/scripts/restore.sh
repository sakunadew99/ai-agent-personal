#!/usr/bin/env bash
# Restore a pg_dump file into a database.
#   Local dev:     ./infra/scripts/restore.sh backups/sakuna_....dump
#   VM drill:      /opt/sakuna/scripts/restore.sh backups/x.dump --prod --into sakuna_restore_test
#   VM real:       /opt/sakuna/scripts/restore.sh backups/x.dump --prod --into sakuna   (stop api/worker first!)
# Encrypted .age files need AGE_IDENTITY=/path/to/key.txt (keep the key off the server normally).
set -euo pipefail

FILE="${1:?usage: restore.sh <file.dump[.age]> [--prod] [--into dbname]}"; shift
if [ ! -s "$FILE" ]; then echo "error: backup file '$FILE' not found or empty" >&2; exit 1; fi
MODE=local; TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prod) MODE=prod ;;
    --into) TARGET="$2"; shift ;;
  esac
  shift
done

if [ "$MODE" = local ]; then
  C="docker compose -f $(cd "$(dirname "$0")/../.." && pwd)/docker-compose.yml"
else
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  C="docker compose -f $ROOT/docker-compose.prod.yml"
  set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
fi
DB_USER="${POSTGRES_USER:-sakuna}"
TARGET="${TARGET:-${POSTGRES_DB:-sakuna}}"

SRC="$FILE"
if [[ "$FILE" == *.age ]]; then
  : "${AGE_IDENTITY:?set AGE_IDENTITY to your age private key file}"
  SRC="$(mktemp)"; age -d -i "$AGE_IDENTITY" -o "$SRC" "$FILE"
fi

echo "==> restoring $FILE into database '$TARGET'"
$C exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT 1 FROM pg_database WHERE datname='$TARGET'" | grep -q 1 \
  || $C exec -T db createdb -U "$DB_USER" "$TARGET"
$C exec -T db psql -U "$DB_USER" -d "$TARGET" -c "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null
$C exec -T db pg_restore -U "$DB_USER" -d "$TARGET" --clean --if-exists --no-owner < "$SRC"

[ "$SRC" != "$FILE" ] && rm -f -- "$SRC"
echo "==> row counts (sanity check)"
$C exec -T db psql -U "$DB_USER" -d "$TARGET" -c \
  "SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10"
echo "OK"
