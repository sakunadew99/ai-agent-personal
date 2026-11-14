# Sakuna AI architecture

## Runtime services

| Service | Location | Responsibility |
|---|---|---|
| Web | `apps/web` | Next.js responsive management interface |
| Mobile | `apps/mobile` | Expo quick capture, daily plan, assistant, and profile |
| API | `backend` | Authentication, user-scoped business logic, and REST API |
| Database | Compose `db` | PostgreSQL and pgvector extension |
| MCP server | `mcp-service` | Streamable HTTP protocol, authenticated as the user |
| Worker | `backend/app/workers` | Persistent in-app reminders and check-ins |

## Data and trust boundaries

The API is the only service that accesses the database. Authenticated records are filtered by the caller's user ID. The tool gateway forwards the user's access token and never receives unrestricted SQL access. Tool writes create pending approval records; the API applies the normal ownership and input checks when those approvals are resolved.

The application keeps actual, estimated, and projected money records separately. Currency totals only combine records that use the same currency code. Health summaries are personal records and are not medical advice.

## Startup sequence

Compose waits for PostgreSQL health, the backend container applies Alembic migrations, and dependent services wait for the API health endpoint. The web application is built with a browser-reachable API URL. Expo runs separately because it needs a host/device-specific API address and native runtime.

## Current integration boundaries

- OpenAI support is optional and configured only in the backend.
- pgvector semantic memory is available on PostgreSQL; local SQLite development uses text matching.
- The Android app has a Health Connect reader for permitted steps, heart-rate samples and sleep sessions, with an explicit user-triggered upload to the API. A custom native build is required, and real-device behavior remains unverified; iOS and background sync are not implemented.
- The tool service speaks MCP Streamable HTTP and validates Sakuna access tokens with the backend before serving tool calls. The current token exchange uses the Sakuna login flow rather than a separate OAuth authorization server.
- Push notifications, calendar sync, production observability, and multi-user operations need deployment-specific setup.
