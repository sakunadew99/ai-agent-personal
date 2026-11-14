#!/usr/bin/env bash
# Start Sakuna in home-server mode and print the public HTTPS URL.
# Optional: DB_PORT / EDGE_PORT env vars on first run if 5432 / 8080 are taken on this PC.
set -euo pipefail
# shellcheck source=scripts/home/common.sh
. "$(dirname "$0")/common.sh"

secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else python3 -c 'import secrets; print(secrets.token_hex(32))' 2>/dev/null || python -c 'import secrets; print(secrets.token_hex(32))'
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  echo "==> creating $ENV_FILE with fresh secrets (kept on this PC, never committed)"
  umask 077
  {
    echo "# Home-server settings. Generated $(date -u +%FT%TZ). Do not commit or share."
    echo "JWT_SECRET=$(secret)"
    echo "SERVICE_TOKEN=$(secret)"
    echo "# Compose host ports (change if something else on this PC uses them)"
    echo "DB_PORT=${DB_PORT:-5432}"
    echo "EDGE_PORT=${EDGE_PORT:-8080}"
  } > "$ENV_FILE"
fi

echo "==> starting containers (first run builds images; can take a few minutes)"
"${COMPOSE[@]}" up -d --build

echo "==> waiting for the public tunnel URL"
URL=""
for _ in $(seq 1 60); do
  URL="$(current_url || true)"
  [ -n "$URL" ] && break
  sleep 2
done
if [ -z "$URL" ]; then
  echo "No tunnel URL yet. Check: ${COMPOSE[*]} logs cloudflared"; exit 1
fi

echo "==> checking $URL/api/v1/health"
for _ in $(seq 1 30); do
  if curl -fsS -m 10 "$URL/api/v1/health" >/dev/null 2>&1; then
    echo
    echo "Sakuna is live:  $URL"
    echo "Phone app:       set EXPO_PUBLIC_API_URL=$URL  (no /api/v1)"
    echo "Sign-ups are closed; sign in with your existing account."
    echo "The URL changes when the tunnel restarts. Print it again with: ./scripts/home/url.sh"
    exit 0
  fi
  sleep 3
done
echo "Tunnel is up at $URL but the health check is not passing yet (DNS for new tunnels can take ~30 s)."
echo "Try again in a minute: curl $URL/api/v1/health"
