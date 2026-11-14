#!/usr/bin/env bash
# Print the current public URL of the home server.
set -euo pipefail
# shellcheck source=scripts/home/common.sh
. "$(dirname "$0")/common.sh"
URL="$(current_url || true)"
if [ -z "$URL" ]; then echo "Tunnel not running. Start it with ./scripts/home/up.sh"; exit 1; fi
echo "$URL"
