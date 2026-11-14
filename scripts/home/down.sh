#!/usr/bin/env bash
# Stop the home server. The database volume is kept; start again with ./scripts/home/up.sh
set -euo pipefail
# shellcheck source=scripts/home/common.sh
. "$(dirname "$0")/common.sh"
"${COMPOSE[@]}" down
echo "Stopped. Data kept. (The public URL will be different next time.)"
