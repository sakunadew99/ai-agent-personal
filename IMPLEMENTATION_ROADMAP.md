# Sakuna AI implementation roadmap

This roadmap extends the existing repository; it does not replace its stack or database. Complete and verify one phase before moving to the next.

## Sprint 0 — safe, reproducible baseline

1. [x] Remove the populated provider key from `.env.example`; revoke any key that may have been real (manual provider action still required).
2. [~] Initialize Git in the project folder. Create/review a baseline commit only after inspecting the full staged diff.
3. [ ] Pin dependencies with lockfiles for Python, web, mobile, and MCP.
4. [~] Add starter backend and MCP tests and CI jobs; install dependencies and run them successfully, then add frontend checks.
5. [ ] Test migrations on disposable PostgreSQL data and define backup/restore and rollback procedures.
6. [~] Repair MCP ASGI lifespan; run its regression test and verify authenticated reads and approval-only writes.

**Exit criteria:** a clean checkout can install dependencies, start locally, migrate an empty database, pass automated checks, and connect to the MCP endpoint. No check is considered passed until it has actually run.

## Sprint 1 — dependable daily use

- Harden authentication, session storage, rate limits, authorization, and account data export/deletion.
- Finish task capture, duplicate prevention, task history, reminders, and planner validation.
- Complete memory review, edit/delete, source references, temporary-memory expiry, and retrieval tests.
- Add chat action authorization, cancellation, action history, and emergency pause.

## Sprint 2 — life, career, and learning

- Expand life entries into searchable timeline, journal, review, achievement, and attachment workflows.
- Add structured skill paths, study plans, learning progress, and skill-gap recommendations.
- Add separate English and German learning sessions and mistake-based revision.
- Build LinkedIn draft and content-calendar workflows with explicit approval before publishing.

## Sprint 3 — finance and personal planning

- Add budgets, savings goals, configurable currencies, and clearly labeled projections.
- Build wealth scenarios, house/car plans, and wishlist/purchase tracking.
- Add relationship dates and private life-balance reflection tools.
- Test all financial calculations and ownership boundaries.

## Sprint 4 — mobile and integrations

- Persist mobile sessions securely, add offline capture with conflict-safe synchronization, and configure push notifications.
- [~] Add Android Health Connect step permission, aggregated read, and opt-in backend sync; still needs a native build and physical device validation.
- Add external integrations through scoped credentials, sync logs, and user approval.
- [~] Add a mobile focus timer and state the Android system-blocking gap explicitly. Full usage monitoring, app blocking, and website VPN enforcement remain separate native implementation work.

## Sprint 5 — production readiness

- Add staging and production deployment workflows, health checks, logs, alerts, and rollback procedures.
- Validate managed PostgreSQL/pgvector, backups, restore drills, secret management, and HTTPS.
- Produce EAS Android builds and test on supported devices.
- Complete security review, accessibility checks, and end-to-end regression coverage.
