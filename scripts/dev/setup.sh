#!/usr/bin/env bash
# Install project dependencies for native (non-Docker) development inside WSL.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> backend venv"
python3 -m venv backend/.venv
backend/.venv/bin/pip install -q --upgrade pip
backend/.venv/bin/pip install -q -r backend/requirements.txt -r backend/requirements-dev.txt

echo "==> mcp-service venv"
python3 -m venv mcp-service/.venv
mcp-service/.venv/bin/pip install -q --upgrade pip
mcp-service/.venv/bin/pip install -q -r mcp-service/requirements-dev.txt

echo "==> web deps"
(cd apps/web && npm install)

echo "==> mobile deps"
(cd apps/mobile && npm install)

[ -f apps/mobile/.env ] || cp apps/mobile/.env.example apps/mobile/.env

echo
echo "Setup complete. Start the database with 'make db', then 'make api' and 'make web'."
