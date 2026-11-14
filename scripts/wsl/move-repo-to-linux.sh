#!/usr/bin/env bash
# Copy the repo from the Windows drive (/mnt/d/...) into the Linux filesystem (~/code/sakuna-ai).
# File watching, npm install and Docker bind mounts are much faster there.
# The original folder on D: is left untouched; delete it yourself once the copy works.
# Usage (from the repo on /mnt/d):  bash scripts/wsl/move-repo-to-linux.sh [target]
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${1:-$HOME/code/sakuna-ai}"

if [[ "$SRC" != /mnt/* ]]; then
  echo "Repo is already on the Linux filesystem: $SRC"; exit 0
fi
if [ -e "$DEST" ]; then
  echo "Target $DEST already exists. Choose another path or move it aside first."; exit 1
fi

mkdir -p "$(dirname "$DEST")"
echo "==> copying $SRC -> $DEST (skipping node_modules, venvs, build caches)"
rsync -a --info=progress2 \
  --exclude node_modules --exclude .venv --exclude .next --exclude __pycache__ \
  --exclude .gradle-cache --exclude 'apps/mobile/android' --exclude 'apps/mobile/.expo*' \
  "$SRC/" "$DEST/"

cd "$DEST"
git config core.autocrlf input
# Convert CRLF to LF in shell scripts and make them executable.
find . -name '*.sh' -not -path '*/node_modules/*' -exec sed -i 's/\r$//' {} + -exec chmod +x {} +

echo
echo "Done. Next:"
echo "  cd $DEST && code .      # VS Code with the WSL extension"
echo "  make setup && make db && make api"
