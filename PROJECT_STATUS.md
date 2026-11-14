# Sakuna AI project status

Updated: 2026-11-10

## Current milestone

Sprint 0: repository safety and a reproducible development baseline.

## Audit summary

- Existing implementation: FastAPI + SQLAlchemy + Alembic + PostgreSQL/pgvector, Next.js web app, Expo mobile app, separate MCP service, and Docker Compose.
- Existing backend areas: authentication, profile, tasks, goals, planning, habits, memory/capture, finance, health, career records, focus sessions, approvals, notifications, and chat.
- Mobile Health Connect: Android-only native integration configured with least-privilege step read permission, an explicit connect flow, daily aggregated step reads, and user-initiated sync into the existing health records endpoint. Requires a custom native Android build and device validation.
- Mobile Focus: added a configurable in-app focus timer. System-level app and website blocking is not implemented and is identified as such in the app.
- Added starter backend finance/capture tests and MCP health/authentication tests. They have not been run locally because pytest is not installed in the local Python environment.
- GitHub Actions now has separate backend and MCP test jobs, in addition to its existing container build job. CI has not run yet.
- MCP Streamable HTTP host lifecycle was repaired and a regression test was added; runtime behavior remains unverified until the test runs.
- Git was initialized in this folder. No baseline commit has been made, and all project files are currently untracked.
- Production deployment, backup/restore, and several product modules remain unimplemented. See `IMPLEMENTATION_ROADMAP.md`.

## Security actions

- `.env.example` contains no provider credential. Keep real secrets in the ignored root `.env` file or a deployment secret store.
- Revoke any provider credential that may have been exposed in an earlier copy of `.env.example`; this external action is still outstanding.
- `.env*` files are ignored, with `.env.example` explicitly allowed as the safe template.

## Verification state

- Mobile TypeScript check passed. Expo Android prebuild passed; generated manifest contains the step read permission, Health Connect package visibility, and the permission rationale entry. A Gradle APK build did not finish: the first build had to download toolchain artifacts and then stalled during Expo Kotlin plugin compilation. The Health Connect permission flow has not been tested on a physical Android device.
- Web production image build passed, including Next.js TypeScript checking. The web client now uses a same-origin `/api/v1` proxy to the backend container.
- Local Docker Compose startup completed; API `/health` returned `ok`, web returned HTTP 200, and MCP `/health` returned `ok`. Proxy requests through both `localhost:3000` and `127.0.0.1:3000` reached the API and returned the expected unauthenticated `401` response.
- Backend pytest suite passed in a disposable container: 5 passed. MCP pytest suite and CI remain unverified.
- No production deployment has been performed. Validate each workflow before promoting a feature to complete.
