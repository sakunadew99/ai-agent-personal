---
description: Create and verify an Alembic migration for a model change.
---
Create a migration for: $ARGUMENTS

1. Confirm the model change in `backend/app/models` is expand-only (new tables/nullable columns/indexes).
2. Run `make revision m="<short message>"` and read the generated file; fix anything autogenerate got wrong.
3. Run `make migrate`, `make downgrade`, `make migrate`, then `cd backend && .venv/bin/alembic check`.
4. Ask the migration-reviewer subagent to review it.
5. Report the file, the commands with their output, and the rollback command.
