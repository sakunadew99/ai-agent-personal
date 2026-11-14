# Repository map

```text
sakuna-ai/
├── CLAUDE.md                 Project rules for Claude Code (plus backend/, apps/web/, apps/mobile/ CLAUDE.md)
├── .claude/
│   ├── settings.json         Permissions (deny .env, keystores, backups; allow tests/lint)
│   ├── agents/               migration-reviewer, security-reviewer, ai-safety-reviewer, test-writer
│   └── commands/             /audit, /new-migration, /phase-report, /new-agent
├── Makefile                  WSL shortcuts: make db | api | web | mobile | up | test | lint | migrate ...
├── docker-compose.yml        Dev: db by default; --profile full = api, worker, mcp, web; --profile edge = Caddy
├── ruff.toml                 Shared Python lint config
├── apps/
│   ├── web/                  Next.js web workspace (standalone Docker image, non-root)
│   │   ├── app/              App Router shell and responsive life OS screens
│   │   ├── components/       Shared branded UI primitives
│   │   └── lib/              Authenticated API client and token refresh (relative /api/v1)
│   └── mobile/               Expo app; eas.json build profiles; android/ is generated, not committed
│       └── src/              API client and native capability adapters
├── backend/
│   ├── app/api/v1/           FastAPI endpoints
│   ├── app/core/             Settings, database, JWT, request dependencies
│   ├── app/models/           SQLAlchemy entities and database types
│   ├── app/schemas/          Request and response validation
│   ├── app/services/         Assistant, planner, memory, finance, permissions
│   ├── app/workers/          Persistent reminder/check-in worker (same image as the API)
│   └── alembic/              Database migration environment and revisions
├── mcp-service/              Separate MCP Streamable HTTP server
├── infra/
│   ├── caddy/Caddyfile       One hostname: / -> web, /api/* -> api, /mcp* -> mcp, automatic HTTPS
│   ├── docker-compose.prod.yml  Production stack for the Oracle Always Free Arm VM (images from GHCR)
│   ├── .env.prod.example     Template for /opt/sakuna/.env on the server
│   ├── scripts/              deploy.sh, backup.sh, restore.sh, bootstrap.sh
│   └── nginx.conf            Older reverse-proxy example (superseded by Caddy)
├── scripts/
│   ├── wsl/                  setup-ubuntu.sh, move-repo-to-linux.sh
│   └── dev/                  setup.sh (deps), phone-ip.sh (EXPO_PUBLIC_API_URL helper)
├── docs/                     Architecture, API, privacy, mobile, WSL/Docker setup, .wslconfig example
├── .github/
│   ├── workflows/ci.yml      Path-filtered checks + single required "ci-ok" gate
│   ├── workflows/release.yml Multi-arch images -> GHCR -> SSH deploy (when DEPLOY_ENABLED=true)
│   ├── workflows/android-apk.yml  Manual APK build (free fallback for the EAS quota)
│   └── dependabot.yml
└── .env.example              Safe environment template; keep secrets in .env
```

The Next.js UI currently uses a single App Router entry point and switches among life OS modules in the client shell. The empty scaffold route folders are not separate routable pages; add new route files only when module URLs are introduced.
