import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"ask.{uuid.uuid4().hex[:8]}@example.com", "password": "Ask-test-pass-one", "full_name": "A"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def _iso(days: int, hour: int = 10) -> str:
    d = datetime.now(timezone.utc).replace(hour=hour, minute=0, second=0, microsecond=0) + timedelta(days=days)
    return d.isoformat()


def test_five_questions_answered_without_ai():
    with TestClient(app) as client:
        a = _user(client)
        assert len(a("GET", "/ask").json()["questions"]) == 5
        assert "clear" in a("GET", "/ask/today").json()["answer"]
        g = a("POST", "/goals", {"title": "Germany masters", "category": "learning"}).json()
        a("PATCH", f"/goals/{g['id']}", {"next_action": "Email two professors"})
        a("POST", "/tasks", {"title": "Low thing", "priority": "low"})
        late = a("POST", "/tasks", {"title": "Pay rent", "priority": "medium", "due_at": _iso(-3)}).json()
        a("POST", "/tasks", {"title": "IELTS mock", "priority": "high", "goal_id": g["id"], "due_at": _iso(5)})
        imp = a("GET", "/ask/important").json()
        assert imp["tasks"][0]["id"] == late["id"] and any("overdue" in w for w in imp["tasks"][0]["why"])
        today = a("GET", "/ask/today").json()
        assert [t["title"] for t in today["tasks"]] == ["Pay rent"]
        assert "Email two professors" in a("GET", "/ask/next").json()["answer"]
        neg = a("GET", "/ask/neglecting").json()
        assert any(i["kind"] == "goal" for i in neg["items"])
        done = a("POST", "/tasks", {"title": "Done one", "goal_id": g["id"]}).json()
        a("PATCH", f"/tasks/{done['id']}", {"status": "done"})
        wk = a("GET", "/ask/week").json()
        assert wk["goals_moved"] == ["Germany masters"] and "finished 1 task" in wk["answer"]
        assert a("GET", "/ask/nonsense").status_code == 404


def test_plan_check_only_proposes_and_is_idempotent():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        t = a("POST", "/tasks", {"title": "Call bank", "due_at": _iso(-2, 9)}).json()
        a("POST", "/tasks", {"title": "Future", "due_at": _iso(3)})
        r = a("POST", "/plan/check").json()
        assert len(r["proposals"]) == 1 and "Call bank" in r["proposals"][0]["preview"]
        assert a("POST", "/plan/check").json()["proposals"] == []                        # no duplicate proposals
        task = next(x for x in a("GET", "/tasks").json() if x["id"] == t["id"])
        assert task["due_at"][:10] == t["due_at"][:10]                                       # unchanged until approved
        pid = r["proposals"][0]["id"]
        assert b("POST", f"/approvals/{pid}/cancel").status_code == 404                     # ownership
        assert b("POST", "/plan/check").json()["proposals"] == []
        ok = a("POST", f"/approvals/{pid}/approve").json()
        assert ok["status"] == "approved"
        task = next(x for x in a("GET", "/tasks").json() if x["id"] == t["id"])
        assert date.fromisoformat(task["due_at"][:10]) >= date.today()
        assert a("POST", f"/approvals/{pid}/cancel").status_code == 409


def test_cancel_pending_proposal():
    with TestClient(app) as client:
        a = _user(client)
        a("POST", "/tasks", {"title": "Old", "due_at": _iso(-4)})
        pid = a("POST", "/plan/check").json()["proposals"][0]["id"]
        assert a("POST", f"/approvals/{pid}/cancel").json()["status"] == "cancelled"
        assert a("POST", f"/approvals/{pid}/approve").status_code == 409
        assert len(a("POST", "/plan/check").json()["proposals"]) == 1                      # cancelled -> can be proposed again
