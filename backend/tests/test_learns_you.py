"""Life OS Phase 5: learns you: profile, findings with evidence, one change, weekly report, feedback effects, cache, ownership."""
import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import AiCache, FocusSession, Routine, RoutineRun, SleepRecord, WorkerNote
from app.services import ai_client
from app.services.you import findings, one_change

TZ = ZoneInfo("Asia/Colombo")


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"yo.{uuid.uuid4().hex[:8]}@example.com", "password": "Learns-test-pass-1", "full_name": "Y"})
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


def _uid(api) -> uuid.UUID:
    return uuid.UUID(str(api("GET", "/me", expect=200).json()["user"]["id"]))


def _seed_history(user_id: uuid.UUID):
    """Three weeks of life: focus at 18:00-20:00, Night routine often skipped, short sleep -> less focus."""
    today = datetime.now(TZ).date()
    with SessionLocal() as db:
        for r in db.scalars(select(Routine).where(Routine.user_id == user_id)).all():
            r.created_at = datetime.now(timezone.utc) - timedelta(days=40)
        night = db.scalar(select(Routine).where(Routine.user_id == user_id, Routine.name == "Night"))
        morning = db.scalar(select(Routine).where(Routine.user_id == user_id, Routine.name == "Morning"))
        for n in range(1, 29):
            d = today - timedelta(days=n)
            short_night = n % 2 == 0
            utc = timezone.utc                                                            # store UTC, like Postgres does
            db.add(SleepRecord(user_id=user_id, start_at=datetime.combine(d - timedelta(days=1), time(23, 30), tzinfo=TZ).astimezone(utc),
                               end_at=datetime.combine(d, time(5 if short_night else 7, 0), tzinfo=TZ).astimezone(utc),
                               duration_minutes=330 if short_night else 450))
            minutes = 30 if short_night else 100
            start = datetime.combine(d, time(18, 0), tzinfo=TZ).astimezone(utc)
            db.add(FocusSession(user_id=user_id, mode="deep", minutes_planned=50, started_at=start, ended_at=start + timedelta(minutes=minutes)))
            db.add(RoutineRun(user_id=user_id, routine_id=morning.id, run_date=d, mode="full", status="done", done_step_ids=[]))
            if n % 4 == 0:
                db.add(RoutineRun(user_id=user_id, routine_id=night.id, run_date=d, mode="short", status="done", done_step_ids=[]))
        db.commit()


def test_profile_findings_and_one_change(client):
    api = _user(client)
    api("POST", "/routines/starter", expect=201)
    empty = api("GET", "/you", expect=200).json()
    assert empty["findings"] == [] and empty["change"] is None                               # nothing guessed without data
    _seed_history(_uid(api))
    you = api("GET", "/you", expect=200).json()
    kinds = {f["kind"]: f for f in you["findings"]}
    assert "18:00" in kinds["focus_hours"]["text"]
    assert "sleep_focus" in kinds and "after good sleep" in kinds["sleep_focus"]["text"]
    assert any(f["kind"] == "routine_skipped" and f["routine"] == "Night" for f in you["findings"])
    assert any(f["kind"] == "routine_strong" and "Morning" in f["text"] for f in you["findings"])
    assert all(f["evidence"] in ("strong", "some", "early") for f in you["findings"])
    assert you["change"]["title"].startswith("Protect 7 hours of sleep")                      # biggest lever first


def test_one_change_priority_rules():
    p = {"focus": {"best_hours": {"from": "18:00", "to": "20:00", "share": 0.6}, "total_minutes": 500, "by_weekday": {}}}
    found = [{"kind": "routine_skipped", "text": "Night 30%", "routine": "Night", "evidence": "some"},
             {"kind": "focus_hours", "text": "best 18-20", "evidence": "some"}]
    assert one_change(p, found)["title"] == "Use the short version of Night"
    assert one_change(p, [found[1]])["title"] == "Book your hardest task at 18:00"
    assert one_change(p, []) is None
    assert findings({"focus": {"best_hours": None, "total_minutes": 0, "by_weekday": {}}, "routines": [], "routine_by_weekday": {},
                     "sleep": {"nights": 0, "effect": None}, "avoid": [], "study": [], "advice": {}, "data_days": 0}) == []


def test_weekly_report_worker_and_memory(client):
    api = _user(client)
    api("POST", "/routines/starter", expect=201)
    _seed_history(_uid(api))
    workers = {w["key"]: w for w in api("GET", "/workers", expect=200).json()}
    assert workers["weekly_report"]["days"] == [7] and workers["weekly_report"]["run_time"].startswith("18:00")
    note = api("POST", "/workers/weekly_report/run", expect=200).json()
    assert note["title"].startswith("About you") and "One change for next week" in note["body"]
    report = api("GET", "/you/reports", expect=200).json()[0]
    assert report["change"] and report["findings"]
    out = api("POST", f"/you/reports/{report['id']}/memory", expect=200).json()
    assert out["saved"] >= 1 and out["saved"] + len(out["skipped"]) == len(report["findings"])   # sensitive ones are skipped, not forced
    assert any(m["category"] == "pattern" for m in api("GET", "/memories", expect=200).json())
    again = api("POST", "/you/report", expect=201).json()
    assert again["id"] == report["id"]                                                       # one report per week


def test_feedback_shortens_disliked_worker_and_reaches_prompt(client, monkeypatch):
    api = _user(client)
    api("POST", "/routines/starter", expect=201)
    note = api("POST", "/workers/morning_coach/run", expect=200).json()
    user_id = _uid(api)
    with SessionLocal() as db:                                                               # two earlier 👎 days
        for n in (1, 2):
            db.add(WorkerNote(user_id=user_id, worker_key="morning_coach", local_date=datetime.now(TZ).date() - timedelta(days=n),
                              title="x", body="x", facts={}, actions=[], feedback="down"))
        db.commit()
    short = api("POST", "/workers/morning_coach/run", expect=200).json()
    assert len(short["body"].splitlines()) <= 3 < max(3, len(note["body"].splitlines())) or len(note["body"].splitlines()) <= 3
    seen = {}

    def fake(db, uid, feature, model, messages, temperature=0.2):
        seen["system"] = messages[0]["content"]
        return "Short and concrete: protect your 14:00 study block today."
    monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai_client, "chat_complete", fake)
    api("POST", "/workers/morning_coach/run", expect=200)
    assert "3 short, concrete lines" in seen["system"] and "found less useful: morning_coach" in seen["system"]


def test_answer_cache_saves_tokens(client, monkeypatch):
    api = _user(client)
    calls = []

    def fake(db, uid, feature, model, messages, temperature=0.2):
        calls.append(feature)
        ai_client._last_tokens = 900
        return "Cached-able note text for today, plain and short."
    monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai_client, "chat_complete", fake)
    first = api("POST", "/workers/study_coach/run", expect=200).json()
    second = api("POST", "/workers/study_coach/run", expect=200).json()
    assert first["used_ai"] and second["used_ai"] and len(calls) == 1                          # same facts -> reused answer
    cache = api("GET", "/you", expect=200).json()["cache"]
    assert cache["hits"] == 1 and cache["tokens_saved"] == 900
    with SessionLocal() as db:
        assert db.scalar(select(AiCache).where(AiCache.user_id == _uid(api))).feature == "worker_study_coach"


def test_ownership(client):
    a, b = _user(client), _user(client)
    a("POST", "/routines/starter", expect=201)
    report = a("POST", "/you/report", expect=201).json()
    b("POST", f"/you/reports/{report['id']}/memory", expect=404)
    assert b("GET", "/you/reports", expect=200).json() == []
