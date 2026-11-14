#!/usr/bin/env bash
# One-time toolchain setup inside WSL2 Ubuntu 24.04.
# Usage: bash scripts/wsl/setup-ubuntu.sh
set -euo pipefail

echo "==> apt packages"
sudo apt-get update
sudo apt-get install -y build-essential git curl unzip make jq rsync ca-certificates \
  postgresql-client python3 python3-venv python3-pip

echo "==> git defaults (LF line endings)"
git config --global core.autocrlf input
git config --global init.defaultBranch main

if ! command -v node >/dev/null 2>&1; then
  echo "==> Node LTS via nvm"
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm alias default 'lts/*'
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "==> uv (fast Python installer, optional)"
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

if ! command -v docker >/dev/null 2>&1; then
  echo
  echo "!! docker not found inside WSL."
  echo "   Docker Desktop -> Settings -> Resources -> WSL integration -> enable 'Ubuntu', then reopen this terminal."
else
  docker compose version
fi

if ! command -v claude >/dev/null 2>&1; then
  echo
  echo "Optional: install Claude Code inside WSL:  curl -fsSL https://claude.ai/install.sh | bash"
fi

echo
echo "Done. Open a new terminal (so PATH updates), then:"
echo "  bash scripts/wsl/move-repo-to-linux.sh   # if the repo is still under /mnt/c or /mnt/d"
echo "  cd ~/code/sakuna-ai && make setup && make db && make api"
