#!/usr/bin/env bash
# Deploy (or roll back) a release on the VM.
#   /opt/sakuna/deploy.sh <git-sha>
# Rollback = run it again with the previous sha (shown in /opt/sakuna/releases.log).
# Migrations must be expand-only so the previous image still works on the new schema.
set -euo pipefail

NEW_TAG="${1:?usage: deploy.sh <git-sha>}"
cd "$(dirname "$0")"
[ -f docker-compose.prod.yml ] || cd /opt/sakuna

# shellcheck disable=SC1091
set -a; . ./.env; set +a
# The command-line SHA always wins over anything in .env (compose also prefers the shell env).
TAG="$NEW_TAG"
export TAG
C="docker compose -f docker-compose.prod.yml"

echo "==> [1/5] backup before deploy"
./scripts/backup.sh "pre-deploy-${TAG:0:12}"

echo "==> [2/5] pull images for $TAG"
$C pull api mcp web

echo "==> [3/5] migrate"
$C up -d db
$C run --rm --no-deps api alembic upgrade head

echo "==> [4/5] start services"
$C up -d --remove-orphans

echo "==> [5/5] health check"
for _ in $(seq 1 45); do
  if $C exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" >/dev/null 2>&1; then
    echo "$(date -u +%FT%TZ) $TAG" >> releases.log
    echo "OK: $TAG is live"
    # Informational: the public HTTPS route through Caddy (TLS can take a minute on first deploy).
    curl -fsS -m 10 --resolve "${SITE_ADDRESS}:443:127.0.0.1" "https://${SITE_ADDRESS}/api/v1/health" \
      && echo || echo "warning: https://${SITE_ADDRESS}/api/v1/health not reachable yet (check DNS/TLS)"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

PREV=$(tail -n 1 releases.log 2>/dev/null | awk '{print $2}')
echo "Health check FAILED for $TAG."
echo "Logs:      $C logs --tail 100 api"
echo "Roll back: ./deploy.sh ${PREV:-<previous-sha>}"
exit 1
