# Developing Sakuna AI on Windows 11 + WSL2 + Docker

This is the practical "how do I run it" companion to the Architecture & Build Guide (sections 9–12).

## 1. One-time setup

**PowerShell (Administrator)**
```powershell
wsl --install -d Ubuntu-24.04     # skip if Ubuntu already exists (wsl -l -v)
wsl --update
```
Copy [`docs/wslconfig.example`](wslconfig.example) to `C:\Users\<you>\.wslconfig`, then `wsl --shutdown` and reopen Ubuntu.

**Docker Desktop:** Settings → Resources → WSL integration → enable *Ubuntu*.

**Inside Ubuntu** (the repo is still on `D:` at this point):
```bash
cd /mnt/d/cursor/sakuna-ai
bash scripts/wsl/setup-ubuntu.sh          # apt packages, Node LTS (nvm), uv, checks docker
bash scripts/wsl/move-repo-to-linux.sh    # copies the repo to ~/code/sakuna-ai (D: copy is left untouched)
cd ~/code/sakuna-ai
make setup                                # .env, backend + mcp venvs, web + mobile npm install
code .                                    # VS Code with the "WSL" extension
```
Keep working in `~/code/sakuna-ai`. Under `/mnt/c` or `/mnt/d`, file watching and `npm install` are slow.

### `.env` additions
`make setup` copies `.env.example` to `.env`. Add these lines to `.env` (they are optional, because compose has defaults), and copy them into `.env.example` too:
```ini
POSTGRES_USER=sakuna
POSTGRES_PASSWORD=sakuna
POSTGRES_DB=sakuna
DB_PORT=5432          # use 5433 if a native PostgreSQL already listens on 5432
EDGE_PORT=8080        # host port for the Caddy "edge" profile; pick another if 8080 is taken
```
If you set `DB_PORT=5433`, also change `DATABASE_URL` to `...@localhost:5433/sakuna` for `make api`.
On this PC a Windows PostgreSQL service owns 5432 and something else owns 8080, so use `DB_PORT=5433` and `EDGE_PORT=8088`.

## 2. Daily work: four terminals

| Terminal | Command | What |
|---|---|---|
| 1 | `make db` | PostgreSQL 16 + pgvector in Docker (bound to 127.0.0.1 only) |
| 2 | `make api` | migrations, then FastAPI with hot reload on :8000 (`/docs`) |
| 3 | `make web` | Next.js dev server on :3000 (proxies `/api/v1` to :8000) |
| 4 | `make mobile` | Metro for the Expo dev build (`TUNNEL=1 make mobile` if the phone can't connect) |

Plus `make worker` when you work on reminders, and `claude` in a fifth terminal (one session per area: `cd backend && claude`).

Phone: run `scripts/dev/phone-ip.sh` and put the printed URL in `apps/mobile/.env` as `EXPO_PUBLIC_API_URL`.

## 3. Full stack in Docker (deployment-like)

```bash
make up          # = docker compose --profile full up -d --build   (db, backend, worker, mcp, web)
make ps          # status
make logs S=backend
make down        # stop; the database volume is kept
```
- Web: http://localhost:3000 · API docs: http://localhost:8000/docs · MCP: http://localhost:8100/mcp

**Production-like routing through Caddy** (one origin, as on the VM):
```bash
docker compose --profile full --profile edge up -d --build
curl http://localhost:${EDGE_PORT:-8080}/api/v1/health
```
`/` goes to web, `/api/*` to the API and `/mcp*` to MCP, all through `infra/caddy/Caddyfile`.

## 4. Quality checks (same as CI)

```bash
make lint        # ruff (backend + mcp), config in /ruff.toml
make test        # backend pytest, mcp pytest, web type-check
make typecheck   # web + mobile tsc
```
CI (`.github/workflows/ci.yml`) additionally runs `alembic upgrade → downgrade -1 → upgrade → check` against pgvector,
builds all three images, shellchecks scripts, validates compose/Caddy and scans for secrets. Mark **`ci-ok`** as the
only required check in branch protection.

## 5. Ship it (Phase 1 checklist)

Full click-by-click version: **[deploy/free-deployment-runbook.md](deploy/free-deployment-runbook.md)**.

1. Push to GitHub, protect `main` (PR + `ci-ok` required, no force-push).
2. Merging to `main` runs `release.yml`: multi-arch (amd64 + arm64) images to `ghcr.io/<owner>/sakuna-{api,mcp,web}:<sha>`.
3. Create the Oracle Always Free VM (2 OCPU / 12 GB, Ubuntu 24.04 aarch64), reserved IP, VCN ingress 80/443.
4. On the VM: `bash infra/scripts/bootstrap.sh` (Docker, deploy user, firewall, cron backups, `/opt/sakuna`).
5. Fill `/opt/sakuna/.env` from `infra/.env.prod.example`; `docker login ghcr.io` with a read-only token.
6. First deploy by hand: `/opt/sakuna/deploy.sh <sha>`.
7. GitHub: secrets `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`; variable `DEPLOY_ENABLED=true`;
   environment `production` with yourself as a required reviewer. From now on, every merge deploys.
8. Restore drill: `scripts/restore.sh backups/<file>.dump --prod --into sakuna_restore_test`.
9. Android: `eas build --profile preview --platform android`, or Actions → **Android APK** (free fallback).
   Back up the signing keystore outside the repo.

Rollback: `/opt/sakuna/deploy.sh <previous-sha>` (listed in `/opt/sakuna/releases.log`).

## 6. Known follow-ups (found in the Phase 0 audit)

- **Freeze migration `0001_initial`.** It calls `Base.metadata.create_all()`, so it always builds the *current* models.
  The first new migration will clash on fresh databases. Before Phase 2, replace its body with explicit
  `op.create_table(...)` calls that match today's schema (generate them with `alembic revision --autogenerate`
  against an empty database), and keep the revision id `0001_initial`.
- The web client keeps tokens in `localStorage`; the guide recommends an httpOnly refresh cookie (§4.2).
- The mobile client keeps the access token in memory only; move it to `expo-secure-store` (§7.1).
- `infra/nginx.conf` is superseded by `infra/caddy/Caddyfile` and can be deleted once you agree.
