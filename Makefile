# Sakuna AI — developer shortcuts. Run inside WSL2 (Ubuntu) from the repo root.
# Daily layout: `make db` + `make api` + `make web` + `make mobile` in separate terminals.

SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help
.PHONY: help setup env db db-stop api worker web mobile up down logs ps migrate revision downgrade \
        test test-api test-mcp test-web lint fmt typecheck check psql backup restore

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ---------- one-time setup ----------
env: ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "Created .env - edit JWT_SECRET and SERVICE_TOKEN")

setup: env ## Install backend venv + web/mobile/mcp deps (inside WSL)
	./scripts/dev/setup.sh

# ---------- daily dev (native processes + DB in Docker) ----------
db: ## Start PostgreSQL + pgvector only
	$(COMPOSE) up -d db

db-stop: ## Stop the database
	$(COMPOSE) stop db

api: ## Run FastAPI with hot reload on :8000
	cd backend && .venv/bin/alembic upgrade head && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

worker: ## Run the reminder/check-in worker
	cd backend && .venv/bin/python -m app.workers.checkins

web: ## Run Next.js dev server on :3000
	cd apps/web && npm run dev

mobile: ## Run Metro for the Expo dev build (TUNNEL=1 if the phone cannot reach WSL)
	cd apps/mobile && npx expo start --dev-client $(if $(TUNNEL),--tunnel,)

# ---------- full stack in containers ----------
up: env ## Build and run the full stack in Docker (db, api, worker, mcp, web)
	$(COMPOSE) --profile full up -d --build
	@echo "Web http://localhost:3000  API http://localhost:8000/docs  MCP http://localhost:8100/mcp"

down: ## Stop all containers (data volume kept)
	$(COMPOSE) --profile full down

logs: ## Follow container logs (S=service to filter)
	$(COMPOSE) --profile full logs -f $(S)

ps: ## Show container status
	$(COMPOSE) --profile full ps

# ---------- database ----------
migrate: ## Apply Alembic migrations
	cd backend && .venv/bin/alembic upgrade head

revision: ## New migration: make revision m="add memory_embeddings"
	@test -n "$(m)" || (echo 'usage: make revision m="message"' && exit 1)
	cd backend && .venv/bin/alembic revision --autogenerate -m "$(m)"

downgrade: ## Roll back one migration
	cd backend && .venv/bin/alembic downgrade -1

psql: ## Open psql in the db container
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-sakuna} $${POSTGRES_DB:-sakuna}

backup: ## Dump the local database to backups/
	./infra/scripts/backup.sh local

restore: ## Restore into the local db: make restore f=backups/file.dump
	@test -n "$(f)" || (echo 'usage: make restore f=backups/x.dump' && exit 1)
	./infra/scripts/restore.sh "$(f)"

# ---------- quality ----------
test-api: ## Backend tests
	cd backend && .venv/bin/python -m pytest -q

test-mcp: ## MCP service tests
	cd mcp-service && .venv/bin/python -m pytest -q

test-web: ## Web type-check (no unit tests yet)
	cd apps/web && npx tsc --noEmit

test: test-api test-mcp test-web ## All tests

lint: ## Ruff (backend + mcp)
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff check ../mcp-service

fmt: ## Auto-fix safe lint issues
	cd backend && .venv/bin/ruff check --fix .

typecheck: ## TypeScript checks for web and mobile
	cd apps/web && npx tsc --noEmit
	cd apps/mobile && npx tsc --noEmit

check: lint test ## Everything CI runs for backend + web
