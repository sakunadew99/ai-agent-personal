#!/usr/bin/env bash
# Dump PostgreSQL (custom format), optionally encrypt with age and copy off the box with rclone.
#   On the VM:  /opt/sakuna/scripts/backup.sh [label]       (nightly via cron, and before each deploy)
#   Locally:    ./infra/scripts/backup.sh local              (uses the dev docker-compose.yml)
# Keeps 7 daily + 4 weekly dumps locally. A backup that was never restored is not a backup:
# run scripts/restore.sh into a scratch database once a month.
set -euo pipefail

LABEL="${1:-nightly}"
if [ "$LABEL" = "local" ]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  C="docker compose -f $ROOT/docker-compose.yml"
  OUT_DIR="$ROOT/backups"
else
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # /opt/sakuna
  C="docker compose -f $ROOT/docker-compose.prod.yml"
  OUT_DIR="$ROOT/backups"
  # shellcheck disable=SC1091
  set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
fi

DB_USER="${POSTGRES_USER:-sakuna}"
DB_NAME="${POSTGRES_DB:-sakuna}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
FILE="$OUT_DIR/sakuna_${STAMP}_${LABEL}.dump"

echo "==> pg_dump -> $FILE"
$C exec -T db pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$FILE"
test -s "$FILE"

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ] && command -v age >/dev/null; then
  age -r "$BACKUP_AGE_RECIPIENT" -o "$FILE.age" "$FILE" && rm -f -- "$FILE"
  FILE="$FILE.age"
  echo "==> encrypted -> $FILE"
fi

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$FILE" "$BACKUP_RCLONE_REMOTE/" && echo "==> copied off-box to $BACKUP_RCLONE_REMOTE"
fi

# Retention: 7 nightly + 4 weekly (cron runs "weekly" on Sundays) + 5 pre-deploy dumps.
prune() {   # `ls` fails when nothing matches yet; that must not abort the backup under pipefail
  { ls -1t "$OUT_DIR"/sakuna_*_"$1"*.dump* 2>/dev/null || true; } | tail -n +"$(( $2 + 1 ))" | xargs -r rm -f --
}
prune nightly 7
prune weekly 4
prune pre-deploy 5

if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$BACKUP_HEARTBEAT_URL" >/dev/null || true
fi
echo "OK: $FILE"
