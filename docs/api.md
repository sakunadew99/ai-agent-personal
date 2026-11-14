# API guide

Base path: `/api/v1`. Register or log in to receive a short-lived access token and a rotating refresh token. Send the access token as `Authorization: Bearer <token>`. All user data endpoints enforce record ownership.

## Main resources

| Resource | Routes |
|---|---|
| Account | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`; `GET /me`; `PATCH /profile` |
| Dashboard | `GET /dashboard`, `/dashboard/summary` |
| Assistant | `POST /chat`; `GET /conversations`, `/conversations/{id}`; `POST /voice/transcribe` |
| Capture | `POST /capture`; `GET /capture`; `POST /capture/{id}/confirm` |
| Tasks and goals | `GET/POST /tasks`, `PATCH/DELETE /tasks/{id}`, `PATCH /tasks/{id}/complete`; corresponding `/goals` routes |
| Planner | `POST /planner/generate`, `GET /planner/daily`, `/planner/weekly`, `PATCH /planner/items/{id}` |
| Memory | `GET/POST /memories`, `PATCH/DELETE /memories/{id}`, `POST /memories/search` |
| Finance | `POST /finance/income`, `/finance/expenses`, `/finance/assets`, `/finance/liabilities`; `GET /finance/summary`, `/finance/reports` |
| Career | `GET/PUT /career/profile`; `GET/POST /career/jobs` and `/career/projects` |
| Health | `POST /health/records`, `/health/sleep`, `/health/workouts`; `GET /health/summary`, `/health/activity`, `/health/sleep`, `/health/workouts` |
| Habits and focus | `GET/POST /habits`, `POST /habits/{id}/logs`; `GET/POST /focus/sessions`, `PATCH /focus/sessions/{id}/finish` |
| Check-ins and approvals | `GET/POST /checkins/settings`, `GET/POST /checkins/history`, `GET /approvals`, `POST /approvals/{id}/approve` or `/reject` |

## Action semantics

AI responses distinguish proposals from completed actions. Capture items can be reviewed before converting them to tasks or memories. MCP gateway write calls create pending approvals. Finance records preserve `record_kind` (`actual`, `estimated`, or `projected`) and require explicit currency codes.
