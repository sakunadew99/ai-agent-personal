import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.main import app
from app.services import gcalendar, gmail, nudges

TZ = ZoneInfo("Asia/Colombo")
TODAY = datetime.now(TZ).date()


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"nc.{uuid.uuid4().hex[:8]}@example.com", "password": "Nudge-test-pass-one", "full_name": "N"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_today_tasks_and_goals_and_claim():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        due = datetime.combine(TODAY, datetime.min.time(), TZ)
        ids = [a("POST", "/tasks", {"title": f"T{i}", "priority": "high" if i == 2 else "medium", "due_at": (due.replace(hour=9) + timedelta(hours=i)).isoformat()}).json()["id"] for i in range(4)]
        a("POST", "/tasks", {"title": "Later", "due_at": (due + timedelta(days=3)).isoformat()})
        t = a("GET", "/today").json()["tasks_today"]
        assert [x["title"] for x in t["open"]][0] == "T2" and "Later" not in [x["title"] for x in t["open"]] and t["done_count"] == 0
        for i in ids[:3]:
            a("PATCH", f"/tasks/{i}/complete")
        t = a("GET", "/today").json()["tasks_today"]
        assert t["done_count"] == 3 and len(t["open"]) == 1
        g = a("GET", "/nudges").json()["goals"]
        assert g["total"] == 5 and next(i for i in g["items"] if i["key"] == "tasks")["done"] and not g["complete"]
        assert a("POST", "/nudges/claim").json()["ok"] is False                               # not all goals yet
        assert b("GET", "/today").json()["tasks_today"]["open"] == []


def test_nudges_water_combo_and_claim(monkeypatch):
    with TestClient(app) as client:
        a = _user(client)
        a("PATCH", "/profile", {"wake_time": "00:00", "sleep_time": "23:59"})
        late = datetime.now(TZ).replace(hour=20, minute=0)
        with_user = {}

        def fake(db, user, day, now_local=None):
            return orig(db, user, day, late)
        orig = nudges.nudges
        monkeypatch.setattr(nudges, "nudges", fake)
        n = a("GET", "/nudges").json()
        kinds = {x["icon"] for x in n["nudges"]}
        assert "💧" in kinds and "🎁" in kinds and with_user == {}
        water = next(x for x in n["nudges"] if x["icon"] == "💧")
        assert water["action"] == {"label": "+250 ml", "kind": "water", "ml": 250}


def test_calendar_events_on_today_and_brief_with_email(monkeypatch):
    start = datetime.now(timezone.utc) + timedelta(minutes=30)
    ev = [{"id": "e1", "title": "Team meeting", "start": start, "end": start + timedelta(hours=1), "all_day": False, "busy": True, "from_sakuna": False, "start_date": None}]
    monkeypatch.setattr(gcalendar, "list_events", lambda db, uid, s, e: (ev, "connected"))
    monkeypatch.setattr(gmail, "inbox", lambda db, uid, limit=5: {"status": "connected", "unread": 2, "emails": [
        {"id": "m1", "from": "Bank", "subject": "Your statement", "snippet": "…", "url": "https://mail.google.com/mail/u/0/#inbox/m1"}]})
    with TestClient(app) as client:
        a = _user(client)
        t = a("GET", "/today").json()
        assert t["calendar"] == "connected" and t["events"][0]["title"] == "Team meeting" and t["next_event"]["in_minutes"] <= 31
        assert any(s["category"] == "calendar" for s in t["ring"])
        m = a("GET", "/brief/morning").json()
        assert m["emails"][0]["subject"] == "Your statement" and any("Team meeting" in s for s in m["steps"]) and any("unread email" in s for s in m["steps"])
        n = a("GET", "/nudges").json()
        assert any(x["icon"] == "📅" and "Team meeting" in x["title"] for x in n["nudges"])
        assert a("GET", "/gmail/inbox").json()["status"] in ("not_connected", "connected")


def test_gmail_not_connected_is_safe():
    with TestClient(app) as client:
        a = _user(client)
        assert a("GET", "/gmail/inbox").json() == {"status": "not_connected", "emails": [], "unread": 0}
        assert a("GET", "/today").json()["calendar"] == "not_connected"
