#!/usr/bin/env bash
# Shared settings for the home-server scripts. Sourced, not run.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
ENV_FILE=".env.home"
COMPOSE=(docker compose --env-file "$ENV_FILE")
# Use the Supabase database when .env.supabase exists (it holds DATABASE_URL; gitignored).
[ -f .env.supabase ] && COMPOSE+=(--env-file .env.supabase)
COMPOSE+=(-f docker-compose.yml -f docker-compose.home.yml --profile full --profile edge)

current_url() {
  "${COMPOSE[@]}" logs cloudflared 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -n 1
}
