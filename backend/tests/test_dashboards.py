"""Dashboard chart data: money trends, health trends, my-life overview, and that each stays private."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"db.{uuid.uuid4().hex[:8]}@example.com", "password": "Dashboard-test-pass-1", "full_name": "D"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None):
        resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_finance_trends(client):
    api = _user(client)
    cur = api("GET", "/finance/trends", expect=200).json()["currency"]
    api("POST", "/finance/income", {"amount": 1000, "currency": cur, "source": "freelance", "record_kind": "actual"}, 201)
    api("POST", "/finance/expenses", {"amount": 150, "currency": cur, "category": "food", "scope": "personal", "record_kind": "actual"}, 201)
    api("POST", "/finance/expenses", {"amount": 50, "currency": cur, "category": "transport", "scope": "personal", "record_kind": "actual"}, 201)
    api("POST", "/finance/expenses", {"amount": 999, "currency": "EUR" if cur != "EUR" else "GBP", "category": "food", "scope": "personal", "record_kind": "actual"}, 201)
    t = api("GET", "/finance/trends", expect=200).json()
    assert len(t["months"]) == 6 and t["months"][-1]["income"] == 1000 and t["months"][-1]["expenses"] == 200
    assert t["this_month"]["spent"] == 200 and t["this_month"]["savings_rate"] == 80.0
    assert [c["category"] for c in t["categories"]] == ["food", "transport"] and t["other_currency_records"] == 1
    assert sum(d["spent"] for d in t["days"]) == 200 and t["biggest"][0]["amount"] == 150
    assert _user(client)("GET", "/finance/trends", expect=200).json()["this_month"]["spent"] == 0   # private


def test_health_trends(client):
    api = _user(client)
    now = datetime.now(timezone.utc)
    api("POST", "/health/records", {"metric": "steps", "value": 9000, "unit": "count", "recorded_at": now.isoformat(), "source": "health_connect"}, 201)
    api("POST", "/health/sleep", {"start_at": (now - timedelta(hours=8)).isoformat(), "end_at": now.isoformat(), "source": "manual"}, 201)
    api("POST", "/health/workouts", {"activity": "gym", "duration_minutes": 45, "started_at": now.isoformat(), "source": "manual"}, 201)
    h = api("GET", "/health/trends?days=7", expect=200).json()
    assert len(h["days"]) == 7 and h["has_data"] and h["today"]["steps"] == 9000 and h["today"]["workout_minutes"] == 45
    assert h["week"]["step_goal_days"] == 1 and h["week"]["sleep_goal_days"] == 1 and 0 < h["score"] <= 100
    assert _user(client)("GET", "/health/trends", expect=200).json()["has_data"] is False


def test_life_overview(client):
    api = _user(client)
    t = api("POST", "/tasks", {"title": "Write SOP", "priority": "high"}, 201).json()
    api("POST", "/tasks", {"title": "Old one", "due_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}, 201)
    api("PATCH", f"/tasks/{t['id']}/complete", expect=200)
    h = api("POST", "/habits", {"name": "Read 20 pages", "schedule": "daily"}, 201).json()
    api("POST", f"/habits/{h['id']}/logs", {"completed": True}, 201)
    api("POST", "/goals", {"title": "IELTS 7", "target_value": 10, "current_value": 4}, 201)
    o = api("GET", "/life/overview", expect=200).json()
    assert o["tasks"]["open"] == 1 and o["tasks"]["overdue"] == 1 and o["tasks"]["done_this_week"] == 1
    assert o["habits"][0]["done_today"] and o["habits"][0]["streak"] == 1 and sum(o["habits"][0]["week"]) == 1
    assert o["goals"][0]["percent"] == 40.0 and len(o["done_14_days"]) == 14 and 0 <= o["score"] <= 100
    other = _user(client)("GET", "/life/overview", expect=200).json()
    assert other["tasks"]["open"] == 0 and other["habits"] == [] and other["goals"] == []
