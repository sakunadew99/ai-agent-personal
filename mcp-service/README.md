# Sakuna AI MCP server

This independently deployed MCP server exposes a narrow allowlist of Sakuna API operations over Streamable HTTP at `/mcp`. It validates the caller's Sakuna bearer access token with the backend and forwards it for user-scoped calls. It does not connect to PostgreSQL directly.

Read operations call user-scoped backend endpoints. Write operations only create pending approval records; the user must approve them through Sakuna before the backend runs the action.

## Local run

Install `requirements.txt`, set `BACKEND_URL` if the API is not at `http://localhost:8000`, and run `uvicorn app.main:app --reload --port 8100`. Connect an MCP client to `http://localhost:8100/mcp` and provide a valid Sakuna bearer access token. Read tools return user-scoped data. Write tools create pending approvals; they do not directly execute changes.
