"""Authenticated Model Context Protocol server for the Sakuna API."""
from contextlib import asynccontextmanager
from contextvars import ContextVar
import os

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from mcp.server import MCPServer
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]
current_user_token: ContextVar[str | None] = ContextVar("sakuna_mcp_user_token", default=None)

mcp = MCPServer("Sakuna AI", instructions=(
    "Use Sakuna's user-scoped tools to read personal data. Write tools only create proposals. "
    "Tell the user that a proposed write is not done until it is approved in Sakuna."
))


async def _backend(method: str, path: str, *, body: dict | None = None, params: dict | None = None):
    token = current_user_token.get()
    if not token:
        raise RuntimeError("A Sakuna user access token is required")
    async with httpx.AsyncClient(base_url=BACKEND_URL, timeout=30) as client:
        response = await client.request(
            method,
            path,
            headers={"Authorization": f"Bearer {token}"},
            json=body,
            params=params,
        )
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail", response.text)
        except ValueError:
            detail = response.text
        raise RuntimeError(f"Sakuna API returned {response.status_code}: {str(detail)[:500]}")
    return None if response.status_code == 204 else response.json()


async def _proposal(tool_name: str, payload: dict):
    return await _backend("POST", "/api/v1/mcp/proposals", body={"tool_name": tool_name, "payload": payload})


@mcp.tool()
async def get_dashboard() -> dict:
    """Read the authenticated user's Sakuna dashboard summary."""
    return await _backend("GET", "/api/v1/dashboard")


@mcp.tool()
async def list_tasks(status: str | None = None) -> list[dict]:
    """List the authenticated user's tasks, optionally filtered by status."""
    return await _backend("GET", "/api/v1/tasks", params={"status": status} if status else None)


@mcp.tool()
async def list_goals() -> list[dict]:
    """List the authenticated user's personal goals."""
    return await _backend("GET", "/api/v1/goals")


@mcp.tool()
async def search_memories(query: str, limit: int = 8) -> list[dict]:
    """Search only the authenticated user's saved memories."""
    return await _backend("POST", "/api/v1/memories/search", body={"query": query, "limit": limit})


@mcp.tool()
async def get_financial_summary(month: str | None = None) -> dict:
    """Read actual, estimated, and projected finance totals for a month."""
    return await _backend("GET", "/api/v1/finance/summary", params={"month": month} if month else None)


@mcp.tool()
async def get_health_summary() -> dict:
    """Read the user's recorded health, workout, and sleep data."""
    return await _backend("GET", "/api/v1/health/summary")


@mcp.tool()
async def get_daily_plan(day: str | None = None) -> dict:
    """Read the user's plan for a date, using today when omitted."""
    return await _backend("GET", "/api/v1/planner/daily", params={"day": day} if day else None)


@mcp.tool()
async def create_task(
    title: str,
    category: str = "personal",
    priority: str = "medium",
    duration_minutes: int = 30,
    due_at: str | None = None,
    goal_id: str | None = None,
) -> dict:
    """Propose a task. The user must approve it in Sakuna before it is created."""
    payload = {"title": title, "category": category, "priority": priority, "duration_minutes": duration_minutes}
    if due_at is not None: payload["due_at"] = due_at
    if goal_id is not None: payload["goal_id"] = goal_id
    return await _proposal("create_task", payload)


@mcp.tool()
async def update_task(
    task_id: str,
    title: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    due_at: str | None = None,
) -> dict:
    """Propose a task update. The user must approve it in Sakuna before it is applied."""
    payload = {"id": task_id}
    for key, value in (("title", title), ("status", status), ("priority", priority), ("due_at", due_at)):
        if value is not None: payload[key] = value
    return await _proposal("update_task", payload)


@mcp.tool()
async def create_goal(title: str, category: str = "personal", description: str | None = None) -> dict:
    """Propose a goal. The user must approve it in Sakuna before it is created."""
    payload = {"title": title, "category": category}
    if description is not None: payload["description"] = description
    return await _proposal("create_goal", payload)


@mcp.tool()
async def save_memory(content: str, category: str = "note", allow_sensitive: bool = False) -> dict:
    """Propose saving a memory. Sensitive content requires explicit user opt-in."""
    return await _proposal("save_memory", {"content": content, "category": category, "allow_sensitive": allow_sensitive})


@mcp.tool()
async def create_daily_plan(plan_date: str | None = None) -> dict:
    """Propose generating a daily plan; the user approves before the plan is rebuilt."""
    return await _proposal("create_daily_plan", {"plan_date": plan_date} if plan_date else {})


@mcp.tool()
async def create_expense(amount: float, currency: str, category: str, notes: str | None = None) -> dict:
    """Propose recording an expense. The user must approve it before it is saved."""
    payload = {"amount": amount, "currency": currency, "category": category}
    if notes is not None: payload["notes"] = notes
    return await _proposal("create_expense", payload)


class UserTokenMiddleware:
    """Validate each MCP HTTP request against Sakuna and scope tools to its user."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/mcp"):
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        authorization = headers.get(b"authorization", b"").decode("latin-1")
        if not authorization.lower().startswith("bearer "):
            response = JSONResponse({"detail": "Sakuna bearer token required"}, status_code=401)
            await response(scope, receive, send)
            return
        token = authorization.split(" ", 1)[1].strip()
        if not token or not await _valid_user_token(token):
            response = JSONResponse({"detail": "Invalid or expired Sakuna access token"}, status_code=401)
            await response(scope, receive, send)
            return
        context_token = current_user_token.set(token)
        try:
            await self.app(scope, receive, send)
        finally:
            current_user_token.reset(context_token)


async def _valid_user_token(token: str) -> bool:
    try:
        async with httpx.AsyncClient(base_url=BACKEND_URL, timeout=8) as client:
            response = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
        return response.status_code == 200
    except httpx.HTTPError:
        return False


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Mounting an MCP ASGI app inside FastAPI disables the mounted app's
    # lifespan, so the host must start the MCP session manager itself.
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="Sakuna AI MCP Server", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


app.mount("/", mcp.streamable_http_app(json_response=True, stateless_http=True))
app.add_middleware(UserTokenMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "MCP-Protocol-Version", "MCP-Session-Id", "MCP-Method"],
)
