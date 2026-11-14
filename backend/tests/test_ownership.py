"""Ownership: a user can never read or change another user's records (every ID route returns 404)."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

PASSWORD = "Ownership-test-pass-1"


def _register(client: TestClient, name: str) -> dict:
    email = f"{name}.{uuid.uuid4().hex[:8]}@example.com"
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD, "full_name": name})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture(scope="module")
def world():
    with TestClient(app) as client:
        a, b = _register(client, "alice"), _register(client, "bob")

        def make(path: str, body: dict) -> str:
            response = client.post(f"/api/v1{path}", json=body, headers=a)
            assert response.status_code in (200, 201), f"{path}: {response.status_code} {response.text}"
            return response.json()

        ids = {
            "task": make("/tasks", {"title": "Alice task"})["id"],
            "goal": make("/goals", {"title": "Alice goal"})["id"],
            "memory": make("/memories", {"content": "Alice likes green tea", "category": "preference"})["id"],
            "capture": make("/capture", {"text": "Alice note for later"})["id"],
            "habit": make("/habits", {"name": "Alice habit", "schedule": "daily"})["id"],
            "focus": make("/focus/sessions", {"minutes": 25})["id"],
            "conversation": make("/chat", {"message": "hello"})["conversation_id"],
            "approval": make("/mcp/proposals", {"tool_name": "create_task", "payload": {"title": "Proposed for Alice"}})["id"],
        }
        yield client, a, b, ids


ID_ROUTES = [
    ("PATCH", "/tasks/{task}", {"title": "hijacked"}),
    ("PATCH", "/tasks/{task}/complete", None),
    ("DELETE", "/tasks/{task}", None),
    ("PATCH", "/goals/{goal}", {"title": "hijacked"}),
    ("DELETE", "/goals/{goal}", None),
    ("PATCH", "/memories/{memory}", {"content": "hijacked"}),
    ("DELETE", "/memories/{memory}", None),
    ("POST", "/capture/{capture}/confirm", {}),
    ("POST", "/habits/{habit}/logs", {"completed": True}),
    ("PATCH", "/focus/sessions/{focus}/finish", {"distractions": 0}),
    ("GET", "/conversations/{conversation}", None),
    ("POST", "/approvals/{approval}/approve", None),
    ("POST", "/approvals/{approval}/reject", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ID_ROUTES, ids=[f"{m} {p}" for m, p, _ in ID_ROUTES])
def test_other_user_gets_404_on_my_records(world, method, path, body):
    client, _alice, bob, ids = world
    response = client.request(method, "/api/v1" + path.format(**ids), headers=bob, **({"json": body} if body is not None else {}))
    assert response.status_code == 404, f"{method} {path} as another user -> {response.status_code}: {response.text}"


@pytest.mark.parametrize("path", ["/tasks", "/goals", "/memories", "/capture", "/habits", "/focus/sessions", "/conversations", "/approvals"])
def test_other_users_lists_never_include_my_records(world, path):
    client, _alice, bob, ids = world
    response = client.get("/api/v1" + path, headers=bob)
    assert response.status_code == 200, response.text
    assert not set(ids.values()) & {str(row.get("id")) for row in response.json() if isinstance(row, dict)}


def test_owner_still_has_access(world):
    client, alice, _bob, ids = world
    assert client.patch(f"/api/v1/tasks/{ids['task']}", json={"title": "Alice task, renamed"}, headers=alice).status_code == 200
    assert client.get(f"/api/v1/conversations/{ids['conversation']}", headers=alice).status_code == 200
