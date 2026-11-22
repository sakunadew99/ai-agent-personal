import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"gp.{uuid.uuid4().hex[:8]}@example.com", "password": "Goal-test-pass-one", "full_name": "G"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_goal_start_priority_progress_and_pace():
    with TestClient(app) as client:
        a = _user(client)
        today = date.today()
        g = a("POST", "/goals", {"title": "Run 5k", "priority": "high", "start_date": (today - timedelta(days=50)).isoformat(),
                                 "due_date": (today + timedelta(days=50)).isoformat(), "progress_pct": 20}).json()
        assert g["priority"] == "high" and g["progress_percent"] == 20 and g["start_date"]
        assert a("POST", "/goals", {"title": "x", "progress_pct": 120}).status_code == 422
        assert a("POST", "/goals", {"title": "x", "priority": "urgent"}).status_code == 422
        money = a("POST", "/goals", {"title": "Save", "target_value": "1000", "current_value": "250"}).json()
        assert money["progress_percent"] == 25 and money["priority"] == "medium"
        p = a("GET", "/progress").json()
        assert p["goals"][0]["title"] == "Run 5k"                                            # high priority first
        run = p["goals"][0]
        assert 45 <= run["time_elapsed_percent"] <= 55 and run["pace"] == "behind" and p["behind"] == ["Run 5k"]
        assert a("PATCH", f"/goals/{g['id']}", {"progress_pct": 60}).json()["progress_percent"] == 60
        assert a("GET", "/progress").json()["goals"][0]["pace"] == "ahead"
        assert a("PATCH", f"/goals/{g['id']}", {"status": "completed"}).json()["progress_percent"] == 100
        rep = a("GET", "/reports/weekly").json()
        assert rep["text"].startswith("Week of") and "Save (medium): 25%" in rep["text"]


def test_note_proposal_is_idempotent_and_needs_approval():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        body = {"tool_name": "create_note", "payload": {"title": "Idea", "body": "Podcast about Sri Lanka", "tags": ["#Ideas"]}}
        p1 = a("POST", "/mcp/proposals", body).json()
        p2 = a("POST", "/mcp/proposals", body).json()
        assert p1["id"] == p2["id"] and p1["status"] == "pending"
        assert a("GET", "/notes").json()["items"] == []                                     # nothing saved yet
        assert a("POST", "/mcp/proposals", {"tool_name": "create_note", "payload": {"body": "x" * 60000}}).status_code == 422
        assert b("POST", f"/approvals/{p1['id']}/approve").status_code == 404
        assert a("POST", f"/approvals/{p1['id']}/approve").json()["status"] == "approved"
        notes = a("GET", "/notes").json()["items"]
        assert notes[0]["title"] == "Idea" and notes[0]["tags"] == ["ideas"]
        assert b("GET", "/progress").json()["goals"] == [] and b("GET", "/notes").json()["items"] == []
