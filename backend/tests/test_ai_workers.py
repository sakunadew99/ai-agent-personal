"""Life OS Phase 4: AI workers: setup, rule notes, AI notes within budget, schedule (tick), actions, feedback, ownership."""
import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import AiUsage, AiWorker, Notification, WorkerNote
from app.services import ai_client
from app.services.ai_workers import run_due

TZ = ZoneInfo("Asia/Colombo")


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"aw.{uuid.uuid4().hex[:8]}@example.com", "password": "Worker-test-pass-1", "full_name": "W"})
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
    call = _user(client)
    call("POST", "/routines/starter", expect=201)
    call("GET", "/exams", expect=200)
    return call


def test_team_setup_and_settings(api):
    workers = {w["key"]: w for w in api("GET", "/workers", expect=200).json()}
    assert list(workers) == ["morning_coach", "focus_guard", "study_coach", "night_reviewer", "weekly_report", "news_scout", "market_analyst"]
    assert workers["morning_coach"]["run_time"].startswith("07:15")                           # 15 min after the default wake-up
    assert workers["night_reviewer"]["enabled"] and workers["news_scout"]["enabled"] and workers["news_scout"]["available"]
    assert not workers["market_analyst"]["available"]
    api("PATCH", "/workers/market_analyst", {"enabled": True}, 422)                            # arrives in a later phase
    out = api("PATCH", "/workers/focus_guard", {"run_time": "15:00", "days": [1, 2, 3, 4, 5], "use_ai": False, "daily_token_budget": 500}, 200).json()
    assert out["run_time"].startswith("15:00") and out["days"] == [1, 2, 3, 4, 5] and out["use_ai"] is False
    api("PATCH", "/workers/focus_guard", {"days": [8]}, 422)
    api("PATCH", "/workers/nobody", {"enabled": False}, 404)
    assert len(api("GET", "/workers", expect=200).json()) == 7                                 # created once


def test_rule_notes_without_ai(api):
    note = api("POST", "/workers/morning_coach/run", expect=200).json()
    assert note["used_ai"] is False and note["title"].startswith("Good morning")
    assert "Routines:" in note["body"] and any(a["action"] == "open:Plan" for a in note["actions"])
    if datetime.now(TZ).isoweekday() != 7:                                                    # Sunday is the exams' rest day
        assert "IELTS" in note["body"]
    study = api("POST", "/workers/study_coach/run", expect=200).json()
    assert "IELTS" in study["body"] and "Goethe" in study["body"]
    night = api("POST", "/workers/night_reviewer/run", expect=200).json()
    assert "Routines" in night["body"] and "00:00" in night["body"]
    again = api("POST", "/workers/morning_coach/run", expect=200).json()
    assert again["id"] == note["id"]                                                          # one note per worker per day
    today = api("GET", "/workers/today", expect=200).json()
    assert {"morning_coach", "focus_guard", "study_coach", "night_reviewer", "weekly_report", "news_scout"} == {i["worker"] for i in today["items"]} and today["unread"] >= 3


def test_ai_note_within_budget(api, monkeypatch):
    assert ai_client.feature_group("worker_morning_coach") == "workers"
    monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai_client, "chat_complete", lambda *a, **k: "Good morning! Office + gym today. Protect your 14:00 IELTS block first.")
    note = api("POST", "/workers/morning_coach/run", expect=200).json()
    assert note["used_ai"] is True and "IELTS block" in note["body"]
    api("PATCH", "/workers/morning_coach", {"use_ai": False}, 200)
    assert api("POST", "/workers/morning_coach/run", expect=200).json()["used_ai"] is False    # AI off for this worker
    api("PATCH", "/workers/morning_coach", {"use_ai": True, "daily_token_budget": 100}, 200)
    user_id = uuid.UUID(str(api("GET", "/me", expect=200).json()["user"]["id"]))
    with SessionLocal() as db:
        db.add(AiUsage(user_id=user_id, feature="worker_morning_coach", model="m", input_tokens=90, output_tokens=40))
        db.commit()
    assert api("POST", "/workers/morning_coach/run", expect=200).json()["used_ai"] is False    # budget used up -> rules


def test_schedule_runs_once_on_time(api):
    api("GET", "/workers", expect=200)                                                       # the team is created on first open
    me = api("GET", "/me", expect=200).json()
    user_id = uuid.UUID(str(me["user"]["id"]))
    with SessionLocal() as db:
        w = db.scalar(select(AiWorker).where(AiWorker.user_id == user_id, AiWorker.key == "night_reviewer"))
        now_local = datetime.now(TZ)
        w.run_time = (now_local - timedelta(minutes=5)).time().replace(microsecond=0)
        w.days = [1, 2, 3, 4, 5, 6, 7]
        for other in db.scalars(select(AiWorker).where(AiWorker.user_id == user_id, AiWorker.key != "night_reviewer")).all():
            other.enabled = False
        db.commit()
        if (now_local - timedelta(minutes=5)).date() != now_local.date():
            pytest.skip("too close to midnight for this check")
        now = datetime.now(timezone.utc)
        assert run_due(db, now) >= 1
        db.commit()
        assert run_due(db, now) == 0                                                          # once per day
        notes = db.scalars(select(WorkerNote).where(WorkerNote.user_id == user_id)).all()
        assert [n.worker_key for n in notes] == ["night_reviewer"]
        assert db.scalar(select(Notification).where(Notification.user_id == user_id, Notification.kind == "worker")) is not None
        w = db.scalar(select(AiWorker).where(AiWorker.user_id == user_id, AiWorker.key == "night_reviewer"))
        w.last_run_date = None
        w.run_time = time(23, 59) if now_local.time() < time(23, 50) else time(0, 0)
        db.commit()
        late = db.scalar(select(AiWorker).where(AiWorker.user_id == user_id, AiWorker.key == "night_reviewer"))
        if late.run_time == time(23, 59):
            assert run_due(db, now) == 0                                                      # not time yet


def test_actions_and_feedback(api):
    local_now = datetime.now(TZ)
    due = (local_now + timedelta(minutes=30)) if local_now.hour < 23 else local_now
    task = api("POST", "/tasks", {"title": "Call the bank", "due_at": due.isoformat()}, 201).json()
    night = api("POST", "/workers/night_reviewer/run", expect=200).json()
    move = next((a for a in night["actions"] if a["action"] == "move_today_to_tomorrow"), None)
    assert move is not None, night
    out = api("POST", f"/workers/notes/{night['id']}/act", {"action_id": move["id"]}, 200).json()
    assert out["moved"] >= 1
    moved = next(t for t in api("GET", "/tasks", expect=200).json() if t["id"] == task["id"])
    assert datetime.fromisoformat(moved["due_at"].replace("Z", "+00:00")).astimezone(TZ).date() == due.date() + timedelta(days=1)
    focus = api("POST", "/workers/focus_guard/run", expect=200).json()
    block = next((a for a in focus["actions"] if a["action"].startswith("task_today:")), None)
    if block:
        assert api("POST", f"/workers/notes/{focus['id']}/act", {"action_id": block["id"]}, 200).json()["task_id"]
    api("POST", f"/workers/notes/{focus['id']}/act", {"action_id": "rm -rf"}, 422)            # only the note's own actions
    fb = api("POST", f"/workers/notes/{focus['id']}/feedback", {"feedback": "up"}, 200).json()
    assert fb["feedback"] == "up"
    api("POST", f"/workers/notes/{focus['id']}/feedback", {"feedback": "meh"}, 422)


def test_ownership(client):
    a, b = _user(client), _user(client)
    note = a("POST", "/workers/morning_coach/run", expect=200).json()
    b("POST", f"/workers/notes/{note['id']}/act", {"action_id": "done"}, 404)
    b("POST", f"/workers/notes/{note['id']}/feedback", {"feedback": "down"}, 404)
    b_notes = [i["note"]["id"] for i in b("GET", "/workers/today", expect=200).json()["items"] if i["note"]]
    assert note["id"] not in b_notes                                                          # B only ever sees B's own notes
    assert a("GET", "/workers/today", expect=200).json()["items"][0]["note"]["id"] == note["id"]


def test_opening_today_card_catches_up_missed_runs(api):
    api("GET", "/workers", expect=200)
    user_id = uuid.UUID(str(api("GET", "/me", expect=200).json()["user"]["id"]))
    now_local = datetime.now(TZ)
    if now_local.hour < 1:
        pytest.skip("too close to midnight for this check")
    with SessionLocal() as db:
        for w in db.scalars(select(AiWorker).where(AiWorker.user_id == user_id)).all():
            w.enabled = w.key == "morning_coach"
            w.run_time = time(0, 30)                     # long past, as if the scheduler skipped it
            w.days = [1, 2, 3, 4, 5, 6, 7]
        db.commit()
    today = api("GET", "/workers/today", expect=200).json()
    morning = next(i for i in today["items"] if i["worker"] == "morning_coach")
    assert morning["note"] is not None and morning["note"]["title"].startswith("Good morning")
    again = api("GET", "/workers/today", expect=200).json()
    assert next(i for i in again["items"] if i["worker"] == "morning_coach")["note"]["id"] == morning["note"]["id"]   # once a day
