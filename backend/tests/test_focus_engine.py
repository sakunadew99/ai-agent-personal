"""Life OS Phase 2: focus engine (target, review, task done, next step as task, today view) and avoid-habits."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import FocusSession


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"fe.{uuid.uuid4().hex[:8]}@example.com", "password": "Focus-test-pass-1", "full_name": "F"})
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


@pytest.fixture()
def api(client):
    return _user(client)


def _age(session_id: str, minutes: int) -> None:
    """Pretend the session started `minutes` ago (tests can't wait 50 minutes)."""
    with SessionLocal() as db:
        row = db.get(FocusSession, uuid.UUID(session_id))
        row.started_at = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        db.commit()


def test_full_focus_flow_with_review(api):
    task = api("POST", "/tasks", {"title": "Write IELTS essay", "category": "learning"}, 201).json()
    s = api("POST", "/focus/sessions", {"minutes": 50, "mode": "deep", "task_id": task["id"], "target": "Finish intro and 2 body paragraphs",
                                        "break_minutes": 10}, 201).json()
    assert s["target"].startswith("Finish intro") and s["break_minutes"] == 10 and s["ends_at"]
    api("POST", "/focus/sessions", {"minutes": 25}, 409)                                     # one task at a time
    active = api("GET", "/focus/today", expect=200).json()["active"]
    assert active and active["id"] == s["id"]
    _age(s["id"], 50)
    out = api("PATCH", f"/focus/sessions/{s['id']}/finish", {"distractions": 1, "notes": "Intro + 2 paragraphs done", "rating": 4,
                                                             "next_step": "Write the conclusion", "task_done": True, "next_as_task": True}, 200).json()
    assert out["task_done"] is True and out["next_task_id"] and out["points"] > 0 and out["minutes"] >= 49
    tasks = {t["title"]: t for t in api("GET", "/tasks", expect=200).json()}
    assert tasks["Write the conclusion"]["category"] == "learning"
    with SessionLocal() as db:
        from app.models.entities import Task
        assert db.get(Task, uuid.UUID(task["id"])).status == "done"
    today = api("GET", "/focus/today", expect=200).json()
    assert today["active"] is None and today["sessions"] == 1 and today["minutes"] >= 49 and today["avg_rating"] == 4
    assert today["best_hours"] and len(today["week"]) == 7
    api("PATCH", f"/focus/sessions/{s['id']}/finish", {"distractions": 0}, 409)              # already finished


def test_review_validation_and_plain_finish(api):
    s = api("POST", "/focus/sessions", {"minutes": 25, "mode": "pomodoro"}, 201).json()
    api("PATCH", f"/focus/sessions/{s['id']}/finish", {"rating": 6}, 422)
    api("POST", "/focus/sessions", {"minutes": 25, "break_minutes": 45}, 422)
    out = api("PATCH", f"/focus/sessions/{s['id']}/finish", {"distractions": 0}, 200).json()  # old clients still work
    assert out["next_task_id"] is None and out["points"] == 0                                # a few seconds earn nothing


def test_avoid_habits_starter_streak_and_slip(api):
    out = api("POST", "/focus/avoid/starter", expect=201).json()
    assert out["added"] == 5 and {h["name"] for h in out["habits"]} >= {"Oversleeping", "Gossip (wela kadha)"}
    assert api("POST", "/focus/avoid/starter", expect=201).json()["added"] == 0                # idempotent
    habits = {h["name"]: h for h in api("GET", "/focus/avoid", expect=200).json()}
    sugar = habits["Sugar and oily food"]["id"]
    today = datetime.fromisoformat(api("GET", "/focus/today", expect=200).json()["date"]).date()
    for n in (2, 1, 0):
        api("POST", f"/habits/{sugar}/logs", {"logged_on": str(today - timedelta(days=n)), "completed": True}, 201)
    view = {h["name"]: h for h in api("GET", "/focus/avoid", expect=200).json()}
    assert view["Sugar and oily food"]["streak"] == 3 and view["Sugar and oily food"]["today"] == "clean"
    api("POST", f"/habits/{sugar}/logs", {"completed": False}, 201)                            # honest slip
    view = {h["name"]: h for h in api("GET", "/focus/avoid", expect=200).json()}
    assert view["Sugar and oily food"]["today"] == "slipped" and view["Sugar and oily food"]["streak"] == 0
    kinds = {h["name"]: h["kind"] for h in api("GET", "/habits", expect=200).json()}
    assert kinds["Oversleeping"] == "avoid"
    api("POST", "/habits", {"name": "Read 10 pages"}, 201)
    assert {h["name"]: h["kind"] for h in api("GET", "/habits", expect=200).json()}["Read 10 pages"] == "build"


def test_ownership(client):
    a, b = _user(client), _user(client)
    task = a("POST", "/tasks", {"title": "A's task"}, 201).json()
    b("POST", "/focus/sessions", {"minutes": 25, "task_id": task["id"]}, 404)                 # can't focus on someone else's task
    s = a("POST", "/focus/sessions", {"minutes": 25, "task_id": task["id"]}, 201).json()
    b("PATCH", f"/focus/sessions/{s['id']}/finish", {"distractions": 0, "task_done": True}, 404)
    assert b("GET", "/focus/today", expect=200).json()["active"] is None
    a("POST", "/focus/avoid/starter", expect=201)
    assert b("GET", "/focus/avoid", expect=200).json() == []
    habit = a("GET", "/focus/avoid", expect=200).json()[0]["id"]
    b("POST", f"/habits/{habit}/logs", {"completed": True}, 404)
