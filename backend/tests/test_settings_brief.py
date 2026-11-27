import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.main import app

TODAY = datetime.now(ZoneInfo("Asia/Colombo")).date()


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"st.{uuid.uuid4().hex[:8]}@example.com", "password": "Set-test-pass-one", "full_name": "Sakuna D"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_settings_hub_and_prefs():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        s = a("GET", "/settings").json()
        assert s["user"]["full_name"] == "Sakuna D" and s["prefs"]["onboarding_done"] is False
        assert s["prefs"]["notifications"]["approvals"]["on"] is True and s["prefs"]["notifications"]["morning"]["time"] == "07:00"
        p = a("PATCH", "/settings/prefs", {"onboarding_done": True, "notifications": {"water": {"on": True}, "morning": {"time": "06:30"}},
                                           "cards": ["habits", "ring", "bogus"], "hidden_cards": ["week"], "pinned": ["Water", "Water", "Gym"]}).json()
        assert p["onboarding_done"] and p["notifications"]["water"]["on"] and p["notifications"]["morning"]["time"] == "06:30"
        assert p["cards"][:2] == ["habits", "ring"] and "bogus" not in p["cards"] and len(p["cards"]) == len(set(p["cards"])) >= 10
        assert p["hidden_cards"] == ["week"] and p["pinned"] == ["Water", "Gym"]
        assert a("PATCH", "/settings/prefs", {"notifications": {"fireworks": {"on": True}}}).status_code == 422
        assert a("PATCH", "/settings/prefs", {"notifications": {"night": {"time": "25:99"}}}).status_code == 422
        assert b("GET", "/settings").json()["prefs"]["onboarding_done"] is False                   # per user
        me = a("PATCH", "/profile", {"full_name": "Sakuna", "height_cm": 175, "sex": "male", "location": "Colombo"}).json()
        assert me["user"]["full_name"] == "Sakuna"
        s = a("GET", "/settings").json()
        assert s["profile"]["height_cm"] == 175 and s["profile"]["location"] == "Colombo"


def test_morning_and_night_briefs():
    with TestClient(app) as client:
        a = _user(client)
        a("POST", "/tasks", {"title": "Send report", "due_at": datetime.combine(TODAY, datetime.min.time(), ZoneInfo("Asia/Colombo")).replace(hour=10).isoformat()})
        a("POST", "/tasks", {"title": "Dentist", "due_at": datetime.combine(TODAY + timedelta(days=1), datetime.min.time(), ZoneInfo("Asia/Colombo")).replace(hour=9).isoformat()})
        m = a("GET", "/brief/morning").json()
        assert m["kind"] == "morning" and m["affirmation"] and any("First task: Send report" in s for s in m["steps"])
        n = a("GET", "/brief/night").json()
        assert n["tomorrow"][0]["title"] == "Dentist" and any("grateful" in s for s in n["steps"]) and n["bedtime"]
        assert a("GET", "/brief/lunch").status_code == 404


def test_points_for_water_mindset_learning_and_checkins():
    with TestClient(app) as client:
        a = _user(client)
        a("POST", "/water", {"ml": 3000})                                                           # goal reached
        a("POST", "/mindset/entries", {"kind": "affirm_read"})
        a("POST", "/reels/events", {"events": [{"video_id": "v1", "category": "educational", "title": "Black holes", "action": "complete"}]})
        a("POST", "/day/gaps/fill", {"day": (TODAY - timedelta(days=1)).isoformat(), "answers": [{"hour": 10, "category": "study"}]})
        g = a("GET", "/game").json() if a("GET", "/game").status_code == 200 else a("GET", "/rewards").json()
        text = str(g)
        for reason in ("Daily water goal reached", "Affirmations read", "Black holes", "Logged 10:00"):
            assert reason in text, reason
