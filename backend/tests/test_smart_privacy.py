"""Morning plan, weekly insights, auto time entries, nudges, all-in net worth, export, privacy switches, data retention,
voice logging (gym + day tracker) with undo, and a smoke test that every screen's data loads for a new user."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import AiSettings, TimeEntry
from app.services import smart


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"sp.{uuid.uuid4().hex[:8]}@example.com", "password": "Smart-test-pass-one", "full_name": "S"})
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


SCREENS = ["/dashboard", "/compass", "/workers/today", "/routines/today", "/routines/week", "/routines/month", "/focus/today", "/journal", "/exams", "/you",
           "/invest", "/tasks", "/goals", "/habits", "/finance/summary", "/finance/trends", "/health/summary", "/health/trends", "/life/overview",
           "/subscriptions", "/gym", "/learning/tracker", "/language/today", "/day/report", "/brain", "/today/plan", "/insights/week", "/nudge",
           "/finance/all", "/money/balance", "/money/wishlist", "/money/buy-list", "/capture", "/study", "/study/programs", "/game", "/ai/usage",
           "/career/jobs", "/learning/cards", "/vault", "/me"]


def test_every_screen_loads_for_a_new_user(client):
    api = _user(client)
    for path in SCREENS:
        api("GET", path, expect=200)


def test_today_plan_week_insights_nudge(client):
    api = _user(client)
    api("PATCH", "/profile", {"work_days": [1, 2, 3, 4, 5, 6, 7], "gym_days": [1, 2, 3, 4, 5, 6, 7]}, 200)
    api("POST", "/tasks", {"title": "Write thesis outline", "priority": "high"}, 201)
    plan = api("GET", "/today/plan", expect=200).json()
    kinds = {b["kind"] for b in plan["blocks"]}
    assert {"work", "gym", "focus"} <= kinds and any("Write thesis outline" in b["title"] for b in plan["blocks"])
    assert all(b["start"] <= b["end"] for b in plan["blocks"]) and isinstance(plan["gaps"], list)
    today = api("GET", "/day/report", expect=200).json()["date"]
    api("POST", "/day/entries", {"local_date": today, "start_time": "20:00", "end_time": "21:30", "category": "wasted"}, 201)
    api("PUT", "/day/usage", {"local_date": today, "total_minutes": 200, "distracting_minutes": 130, "apps": [
        {"package": "com.instagram.android", "label": "Instagram", "mark": "distracting", "minutes": 130}], "hourly": [0] * 20 + [60, 60, 10, 0]}, 200)
    w = api("GET", "/insights/week", expect=200).json()
    assert w["totals"]["wasted"] >= 220 and any("20:00" in x for x in w["insights"]) and w["top_apps"][0]["label"] == "Instagram"
    n = api("GET", "/nudge", expect=200).json()["nudge"]
    assert n["level"] == "high" and "Instagram" in n["text"]
    assert _user(client)("GET", "/nudge", expect=200).json()["nudge"] is None        # private


def test_auto_entries_fill_the_day(client):
    api = _user(client)
    api("POST", "/gym/workouts", {"title": "Leg day", "duration_minutes": 60, "started_at": datetime.now(timezone.utc).replace(minute=0).isoformat(),
                                  "sets": [{"exercise": "Squat", "weight_kg": 80, "reps": 5}]}, 201)
    r = api("GET", "/day/report", expect=200).json()
    assert any(a["source"] == "gym" and a["category"] == "exercise" for a in r["auto"])
    assert any(h["category"] == "exercise" for h in r["hours"])


def test_voice_logs_gym_and_time_with_undo(client):
    api = _user(client)
    c = api("POST", "/commands", {"text": "bench 60 kg x 8 and squat 80kg 3x5", "source": "voice"}, 201).json()
    assert c["understood"]["kind"] == "gym_log" and c["status"] == "created" and "Bench press" in c["summary"]
    assert api("GET", "/gym", expect=200).json()["recent"][0]["set_count"] == 4
    t = api("POST", "/commands", {"text": "wasted an hour on tiktok"}, 201).json()
    assert t["understood"]["kind"] == "time_log" and "Time wasted" in t["summary"]
    assert len(api("GET", "/day/report", expect=200).json()["entries"]) == 1
    api("POST", f"/commands/{t['id']}/undo", expect=200)
    api("POST", f"/commands/{c['id']}/undo", expect=200)
    assert api("GET", "/day/report", expect=200).json()["entries"] == [] and api("GET", "/gym", expect=200).json()["recent"] == []
    task = api("POST", "/commands", {"text": "call the bank tomorrow at 5pm"}, 201).json()
    assert task["understood"]["kind"] not in ("gym_log", "time_log")                               # normal tasks still work


def test_finance_all_export_and_privacy(client):
    a, b = _user(client), _user(client)
    a("POST", "/money/accounts", {"name": "BOC", "account_type": "bank", "currency": "LKR", "balance": "250000"}, 201)
    a("POST", "/subscriptions", {"name": "Netflix", "amount": 1500, "currency": "LKR", "next_due": date.today().isoformat()}, 201)
    f = a("GET", "/finance/all", expect=200).json()
    lkr = next(c for c in f["currencies"] if c["currency"] == "LKR")
    assert float(lkr["total"]) == 250000 and float(lkr["monthly_subscriptions"]) == 1500
    exp = a("GET", "/me/export", expect=200).json()
    assert exp["counts"]["subscriptions"] == 1 and "password_hash" not in str(exp) and "refresh_tokens" not in exp["tables"]
    assert "subscriptions" not in b("GET", "/me/export", expect=200).json()["tables"]          # only your own rows
    s = a("PATCH", "/ai/settings", {"share_journal": False, "share_activity": False, "keep_activity_days": 30}, 200).json()["settings"]
    assert s["share_journal"] is False and s["share_activity"] is False and s["keep_activity_days"] == 30
    text = a("POST", "/day/report/explain", expect=200).json()["text"]
    assert "isn't shared with AI" in text


def test_purge_old_keeps_only_chosen_days(client):
    a = _user(client)
    old = (date.today() - timedelta(days=40)).isoformat()
    a("POST", "/day/entries", {"local_date": old, "start_time": "09:00", "end_time": "10:00", "category": "work"}, 201)
    a("POST", "/day/entries", {"local_date": date.today().isoformat(), "start_time": "09:00", "end_time": "10:00", "category": "work"}, 201)
    a("PATCH", "/ai/settings", {"keep_activity_days": 30}, 200)
    with SessionLocal() as db:
        assert smart.purge_old(db) >= 1
        db.commit()
        dates = {e.local_date.isoformat() for e in db.query(TimeEntry).all()}
        assert old not in dates
        assert db.query(AiSettings).filter(AiSettings.keep_activity_days == 30).count() >= 1
