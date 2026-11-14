# Backend rules (FastAPI, SQLAlchemy 2, Alembic, Python 3.12)

- Layout: `app/api/v1` routers (thin) -> `app/services` (business rules, take `user_id`) -> `app/models`.
  `app/schemas` are Pydantic DTOs; never return ORM objects. `app/workers` reuse services, no ad-hoc SQL.
- Every new table: UUID pk, `user_id` FK if user-owned, `created_at`/`updated_at` timestamptz, CHECK constraints for
  statuses, unique constraints for dedupe. Money `Numeric(18,2)` + `currency CHAR(3)`.
- Migrations: `make revision m="..."`, then READ the generated file. Expand-only changes in the same release as code;
  drops/renames come in a later release. Downgrade must work. CI runs upgrade/downgrade/upgrade + `alembic check`.
- WARNING: `0001_initial` builds tables from current model metadata (`create_all`). Before adding the first new
  migration, freeze 0001 into explicit `op.create_table` calls (see docs/wsl-docker-setup.md "Known follow-ups").
- Creating endpoints used by mobile retries accept `Idempotency-Key` (see `services/idempotency.py`).
- All model calls go through `services/ai_client.py`; budgets and the no-key fallback must keep working.
- Tests: `make test-api`. Add an ownership test per new route. Lint: `make lint` (ruff, config in `/ruff.toml`).
- Health: `/health` and `/api/v1/health` (DB readiness), `/health/live` (process only). Keep them cheap.
