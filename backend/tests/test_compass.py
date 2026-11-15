"""Life Compass: seven areas from every feature, pace-aware status, next actions, manual logs, chat logging, navigator, ownership."""
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import SleepRecord
from app.services.assistant import classify_intent
from app.services.compass import parse_life_log

TZ = ZoneInfo("Asia/Colombo")


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"cp.{uuid.uuid4().hex[:8]}@example.com", "password": "Compass-test-pass-1", "full_name": "C"})
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


@pytest.mark.parametrize(("text", "area"), [
    ("called my mother today", "family"), ("spent time with my family", "family"), ("had dinner with my parents", "family"),
    ("met some friends for tea", "social"), ("hung out with old friends", "social"), ("volunteered at the temple cleanup", "social"),
    ("went to the temple this morning", "growth"), ("meditated for 10 minutes", "growth"), ("log a hobby block", "leisure"),
    ("played cricket with the boys", "leisure"),
])
def test_parse_life_log(text, area):
    assert parse_life_log(text) == {"area": area, "note": text}
    assert classify_intent(text) == "life_log"


def test_life_log_ignores_plans_questions_and_money():
    for text in ("remind me to call my mother", "I need to visit my parents tomorrow", "should I call my father?", "spent 1500 on lunch", "buy milk"):
        assert parse_life_log(text) is None, text
    assert classify_intent("spent 1500 on lunch") == "expense"
    assert classify_intent("remind me to call my mother") == "capture"
    assert classify_intent("how is my life balance?") == "life"


def test_seven_areas_from_real_data(client):
    api = _user(client)
    v = api("GET", "/compass", expect=200).json()
    assert [a["key"] for a in v["areas"]] == ["health", "work", "family", "social", "money", "leisure", "growth"]
    family = next(a for a in v["areas"] if a["key"] == "family")
    assert family["percent"] == 0 and family["can_log"] and v["day"]["routines_total"] == 0
    health = next(a for a in v["areas"] if a["key"] == "health")
    assert health["signals"][0]["actual"] is None and "Mi Band" in health["signals"][0]["note"]      # untracked is said, not guessed

    # Real data in several features moves the right areas.
    api("POST", "/routines/starter", expect=201)
    user_id = uuid.UUID(str(api("GET", "/me", expect=200).json()["user"]["id"]))
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        db.add(SleepRecord(user_id=user_id, start_at=now - timedelta(hours=8), end_at=now - timedelta(minutes=30), duration_minutes=450))
        db.commit()
    plans = {p["exam"]: p for p in api("GET", "/exams", expect=200).json()}
    api("POST", f"/exams/{plans['ielts']['id']}/log", {"skill": "listening", "minutes": 30}, 201)
    api("POST", "/meals", {"meal": "lunch", "slow": True, "no_screen": True, "upright": True, "stopped_80": True}, 201)
    api("POST", "/finance/expenses", {"amount": "500", "currency": "LKR", "category": "food", "spent_at": now.isoformat()}, 201)
    v = api("POST", "/compass/family/log", {"note": "Dinner with parents"}, 201).json()
    areas = {a["key"]: a for a in v["areas"]}
    assert areas["family"]["percent"] == 33 and areas["money"]["signals"][0]["actual"] == 1
    assert areas["health"]["signals"][0]["actual"] == 7.5 and areas["health"]["signals"][0]["percent"] == 100
    assert any(s["label"] == "Mindful meals" and s["actual"] == 1 for s in areas["health"]["signals"])
    assert areas["growth"]["signals"][0]["actual"] >= 1 and "30 min of exam study" in areas["growth"]["signals"][0]["note"]
    assert v["day"]["study_minutes"] == 30 and v["day"]["sleep_hours"] == 7.5
    assert v["overall"] is not None and all(a["status"] in ("done", "on_track", "behind", "no_data") for a in v["areas"])
    api("POST", "/compass/work/log", {}, 422)                                                 # measured areas have no manual log
    api("POST", "/compass/family/log", {"amount": 0}, 422)
    # The older Life balance page sees the same family log (one source of truth).
    balance = {a["key"]: a for a in api("GET", "/balance", expect=200).json()["areas"]}
    assert float(balance["relationships"]["actual"]) == 1.0 and "social" in balance


def test_actions_point_at_what_is_behind(client):
    api = _user(client)
    v = api("GET", "/compass", expect=200).json()
    day_of_week = datetime.now(TZ).isoweekday()
    behind = [a for a in v["areas"] if a["status"] == "behind"]
    assert behind                                                                             # an empty week is honestly behind
    assert v["weakest"] in {a["key"] for a in behind} and v["message"]
    area_actions = [a for a in v["actions"] if a.get("area")]
    assert area_actions and len(v["actions"]) <= 4
    loggable = [a for a in v["actions"] if a.get("log")]
    if loggable:
        after = api("POST", f"/compass/{loggable[0]['log']}/log", {}, 201).json()
        assert next(a for a in after["areas"] if a["key"] == loggable[0]["log"])["percent"] > 0
    assert 1 <= day_of_week <= 7 and round(v["week_fraction"] * 7) == day_of_week


def test_chat_logs_and_navigator(client):
    api = _user(client)
    reply = api("POST", "/chat", {"message": "called my mother today"}, 200).json()
    assert any(a["tool"] == "log_life_area" for a in reply["actions_completed"]), reply
    family = next(a for a in api("GET", "/compass", expect=200).json()["areas"] if a["key"] == "family")
    assert family["percent"] == 33
    picture = api("POST", "/chat", {"message": "how is my life balance?"}, 200).json()["reply"]
    assert "Life compass" in picture and "Family & relationships 33%" in picture
    workers = {w["key"]: w for w in api("GET", "/workers", expect=200).json()}
    assert workers["life_navigator"]["enabled"] and workers["life_navigator"]["run_time"].startswith("20:30")
    note = api("POST", "/workers/life_navigator/run", expect=200).json()
    assert note["title"].startswith("Life compass") and "❤️ 33%" in note["body"]
    log_action = next((a for a in note["actions"] if a["action"].startswith("log_area:")), None)
    if log_action:
        out = api("POST", f"/workers/notes/{note['id']}/act", {"action_id": log_action["id"]}, 200).json()
        assert out["logged"] in ("family", "social", "leisure", "growth")


def test_ownership(client):
    a, b = _user(client), _user(client)
    a("POST", "/compass/social/log", {"note": "Met Kasun"}, 201)
    mine = next(x for x in a("GET", "/compass", expect=200).json()["areas"] if x["key"] == "social")
    theirs = next(x for x in b("GET", "/compass", expect=200).json()["areas"] if x["key"] == "social")
    assert mine["percent"] == 50 and theirs["percent"] == 0
