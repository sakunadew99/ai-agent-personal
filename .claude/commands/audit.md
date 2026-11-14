---
description: Read-only repository audit (Phase 0). No files are changed.
---
Do a READ-ONLY audit of this repository. Do not edit, create or delete files.

Focus: $ARGUMENTS (if empty, audit everything).

Report:
1. What exists per area (backend routes/services/models, migrations, worker, MCP tools, web modules, mobile screens) with file paths.
2. Test status: run `make test` and `make lint` (or the direct commands) and paste the summary.
3. Schema vs. the guide's domain map (docs/architecture.md and guide §5.2): existing, missing, conflicting.
4. Security risks ranked (ownership, secrets, injection, autonomy).
5. A file-by-file plan for the next phase, with migration impact and rollback.
Stop and wait for approval.
