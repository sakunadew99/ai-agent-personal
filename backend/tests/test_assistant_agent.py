import json
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.main import app
from app.services import agent, ai_client

TZ = ZoneInfo("Asia/Colombo")


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"ag.{uuid.uuid4().hex[:8]}@example.com", "password": "Agent-test-pass-one", "full_name": "A"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_split_and_water_rules():
    assert agent.split_commands("Drank 500 ml water; add milk and eggs to my buy list and remind me to call Amma at 6pm") == [
        "Drank 500 ml water", "add milk and eggs to my buy list", "remind me to call Amma at 6pm"]
    assert agent.split_commands("clean the room and plan the trip") == ["clean the room and plan the trip"]
    assert agent.parse_water("drank 2 glasses of water") == 500
    assert agent.parse_water("had 1.5 l water") == 1500
    assert agent.parse_water("log water") is None or agent.parse_water("log water") == 250
    assert agent.parse_water("how much water should I drink?") is None
    assert agent.parse_water("bought 2 l water for 200") is None
    assert agent.parse_water("drank coffee") is None


def test_chat_runs_several_commands_and_undo():
    with TestClient(app) as client:
        a = _user(client)
        r = a("POST", "/chat", {"message": "Drank 500 ml water; add milk and eggs to my buy list"}).json()
        tools = {x["tool"] for x in r["actions_completed"]}
        assert tools == {"log_water", "add_to_buy_list"}, r
        assert a("GET", "/water").json()["today_ml"] == 500
        buy = next(x for x in r["actions_completed"] if x["tool"] == "add_to_buy_list")
        assert buy["undoable"] and len(buy["resource_ids"]) == 2
        w = next(x for x in r["actions_completed"] if x["tool"] == "log_water")
        assert a("POST", "/chat/undo", {"tool": "log_water", "ids": w["resource_ids"]}).json()["undone"] == 1
        assert a("GET", "/water").json()["today_ml"] == 0


def test_chat_habit_and_task_done_with_undo_and_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        a("POST", "/habits", {"name": "Workout"})
        task = a("POST", "/tasks", {"title": "Send the monthly report"}).json()
        r = a("POST", "/chat", {"message": "did my workout"}).json()
        assert [x["tool"] for x in r["actions_completed"]] == ["log_habit"], r
        r2 = a("POST", "/chat", {"message": "did my workout"}).json()                   # second time: nothing doubles
        assert "already" in r2["actions_completed"][0]["summary"] and not r2["actions_completed"][0]["undoable"]
        r = a("POST", "/chat", {"message": "finished the monthly report"}).json()
        done = r["actions_completed"][0]
        assert done["tool"] == "complete_task" and done["undoable"]
        assert next(t for t in a("GET", "/tasks").json() if t["id"] == task["id"])["status"] == "done"
        # someone else can't undo (or see) it
        assert b("POST", "/chat/undo", {"tool": "complete_task", "ids": [task["id"]]}).status_code == 404
        assert a("POST", "/chat/undo", {"tool": "complete_task", "ids": [task["id"]]}).json()["undone"] == 1
        assert next(t for t in a("GET", "/tasks").json() if t["id"] == task["id"])["status"] == "todo"
        assert a("POST", "/chat/undo", {"tool": "exam_update", "ids": [task["id"]]}).status_code == 400


def test_ai_router_only_runs_validated_tools(monkeypatch):
    def fake(db, uid, feature, model, messages, temperature=0.2):
        if feature == "assistant_tools":
            return json.dumps({"actions": [
                {"tool": "create_task", "args": {"title": "Book dentist", "date": datetime.now(TZ).date().isoformat(), "time": "17:00"}},
                {"tool": "add_to_wishlist", "args": {"items": ["Kindle"]}},
                {"tool": "send_email", "args": {"to": "x@example.com"}},            # not on the list: ignored
                {"tool": "log_water", "args": {"ml": "lots"}},                       # invalid: ignored
            ]})
        return "Done."
    monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai_client, "chat_complete", fake)
    with TestClient(app) as client:
        a = _user(client)
        r = a("POST", "/chat", {"message": "set up the dentist thing for 5 and put a kindle on my wishes"}).json()
        everything = {x["tool"] for x in r["actions_completed"] + r["actions_proposed"]}
        assert everything == {"create_task", "add_to_wishlist"}, r
        assert any(x["tool"] == "create_task" for x in r["actions_proposed"])          # tasks still need your approval by default


def test_today_bundle_one_request():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        a("POST", "/tasks", {"title": "Only mine", "due_at": datetime.now(TZ).replace(hour=23, minute=0).isoformat()})
        r = a("GET", "/today/bundle?brief=morning").json()
        assert {"today", "goals", "prefs", "week", "consistency", "brief"} <= set(r)
        assert r["today"]["tasks_today"]["open"][0]["title"] == "Only mine" and r["brief"]["kind"] == "morning"
        assert r["goals"]["total"] == 5 and "cards" in r["prefs"]
        assert a("GET", "/today/bundle").json()["brief"] is None
        assert b("GET", "/today/bundle").json()["today"]["tasks_today"]["open"] == []
        assert a("GET", "/today/bundle?brief=evil").status_code == 422


def test_calendar_asked_once_for_today_ring_and_nudges(monkeypatch):
    from types import SimpleNamespace
    from app.core import cache
    from app.services import gcalendar, google_oauth
    monkeypatch.setattr(cache, "TTL_SECONDS", 900)
    calls = []
    monkeypatch.setattr(gcalendar, "_conn", lambda db, uid: SimpleNamespace(status="connected"))
    monkeypatch.setattr(google_oauth, "call", lambda db, conn, method, url, params=None, body=None: (calls.append(url), (200, {"items": []}))[1])
    with TestClient(app) as client:
        a = _user(client)
        assert a("GET", "/today").json()["calendar"] == "connected"
        a("GET", "/nudges")
        assert len(calls) == 1                                   # ring + today + nudges share one Google request
        a("POST", "/water", {"ml": 250})                         # any change you make refreshes it
        a("GET", "/today")
        assert len(calls) == 2
