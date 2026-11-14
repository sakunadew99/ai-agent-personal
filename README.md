# Sakuna AI

Sakuna AI is a personal life operating system with a FastAPI backend, PostgreSQL/pgvector storage, a Next.js web client, a separate MCP tool gateway, and an optional notification worker.

For the full system overview, architecture, module status, mobile/Health Connect setup, security notes, and run/build instructions, see [SYSTEM_DOCUMENTATION.md](SYSTEM_DOCUMENTATION.md).

## Develop on Windows 11 + WSL2

Step-by-step setup, daily workflow and deployment: **[docs/wsl-docker-setup.md](docs/wsl-docker-setup.md)**. In short, inside Ubuntu:

```bash
bash scripts/wsl/setup-ubuntu.sh && bash scripts/wsl/move-repo-to-linux.sh
cd ~/code/sakuna-ai && make setup
make db      # terminal 1: PostgreSQL + pgvector
make api     # terminal 2: FastAPI :8000
make web     # terminal 3: Next.js :3000
make mobile  # terminal 4: Expo dev build
make help    # every shortcut
```

## Run with Docker Compose

1. Copy `.env.example` to `.env` (or `make env`) and replace `JWT_SECRET` and `SERVICE_TOKEN` before exposing the app beyond your machine. `OPENAI_API_KEY` is intentionally blank in the template; add your own key only to the local `.env` file. If a key from an earlier copy of the template was real, revoke it with the provider.
2. Start the full stack with `make up` (= `docker compose --profile full up -d --build`). Plain `docker compose up` now starts only the database, for native development.
3. Open [http://localhost:3000](http://localhost:3000). The API docs are at [http://localhost:8000/docs](http://localhost:8000/docs).
4. Optional production-like routing through Caddy on one origin: `docker compose --profile full --profile edge up -d --build`, then open `http://localhost:8080`.

If port 5432 or 8080 is already in use, set `DB_PORT` / `EDGE_PORT` in `.env`.

Compose starts PostgreSQL with pgvector, runs Alembic migrations before the API, and starts the API, check-in worker, MCP server, and web client. Production uses `infra/docker-compose.prod.yml` (images from GHCR, Caddy with automatic HTTPS) and is deployed by `.github/workflows/release.yml` → `infra/scripts/deploy.sh`. Connect an MCP client to `http://localhost:8100/mcp` with a user's Sakuna bearer access token. Write tools create pending approvals; resolve them from the Sakuna approvals page or API.

## Run the backend locally

Use Python 3.12, create a virtual environment, install `backend/requirements.txt`, and set `DATABASE_URL` to PostgreSQL or a local SQLite URL. From `backend/`, run `alembic upgrade head` followed by `uvicorn app.main:app --reload`. SQLite is useful for local development; pgvector semantic embeddings require PostgreSQL with the vector extension.

## Configure AI

Set `OPENAI_API_KEY` in the root `.env`. Without it, chat uses factual local summaries, text memory search uses keyword matching, and voice transcription returns a clear unavailable response. The UI and API never need an OpenAI key in the browser.

## Main API

All application endpoints are under `/api/v1`. Register or log in to receive a short-lived access token and rotating refresh token. Authenticated routes include dashboard, tasks, goals, capture, planning, memory, chat, finance, career, health, habits, focus sessions, check-ins, notifications, and approval review. Records are scoped to the authenticated user.

## Web frontend

The responsive Next.js app provides sign-in and registration plus workspace pages for Overview, Assistant, Capture Inbox, My Life (tasks, goals and habits), Planner, Finance, Career, Health, Focus, Experiences, Memory, Insights, Approvals, and Settings. Forms submit to the authenticated API and display saved records, empty states, request errors, and approval status. The browser keeps access and rotating refresh tokens in local storage; use HTTPS in production and review your organization’s client-side token storage policy before deployment.

The Expo app has Home, Plan, Capture, AI, Health, Focus, and Profile tabs. Run it separately with `cd apps/mobile`, install its package dependencies, then start Expo. Set `EXPO_PUBLIC_API_URL` to an address reachable from the device (Android emulator: `http://10.0.2.2:8000`; physical phone: your development computer’s LAN address). Its access token is held in app memory and clears when the app restarts; sign in again to resume.

## Important limits

- The Android app requests Health Connect step access, reads the aggregated daily total, and uploads only after the user chooses to sync. A custom native Android build and real-device permission check are required; Expo Go cannot load this integration.
- The mobile Focus tab has an in-app timer. Android app blocking and VPN-based website blocking are not implemented yet and are not represented as active.
- Currency totals only combine matching currency codes. No currency conversion is guessed.
- MCP write calls create proposals and do not run until the user approves them.
- Push delivery, calendar sync, production observability, and deployment secrets are environment-specific and still need to be configured for a real production launch.
