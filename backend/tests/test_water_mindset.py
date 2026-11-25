import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.services import hf


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"wm.{uuid.uuid4().hex[:8]}@example.com", "password": "Water-test-pass-one", "full_name": "W"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_water_target_from_weight_and_logging():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        w = a("GET", "/water").json()
        assert w["target_ml"] == 2500 and w["today_ml"] == 0
        a("POST", "/body/measurements", {"weight_kg": 80})
        assert a("GET", "/water").json()["target_ml"] == 2800                    # 35 ml x 80 kg
        r = a("POST", "/water", {"ml": 250}).json()
        r = a("POST", "/water", {"ml": 500}).json()
        assert r["today_ml"] == 750 and r["percent"] == 27 and r["left_ml"] == 2050 and r["week"][-1]["ml"] == 750
        assert a("POST", "/water", {"ml": 0}).status_code == 422 and a("POST", "/water", {"ml": 5000}).status_code == 422
        eid = r["entries"][0]["id"]
        assert b("DELETE", f"/water/{eid}").status_code == 404
        assert a("DELETE", f"/water/{eid}").status_code == 204 and a("GET", "/water").json()["today_ml"] == 250
        assert b("GET", "/water").json()["today_ml"] == 0


def test_affirmations_starter_set_and_crud():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        m = a("GET", "/mindset").json()
        assert len(m["affirmations"]) == 18 and m["affirmation_of_the_day"] and "don't make things happen" in m["honest"]
        mine = a("POST", "/affirmations", {"text": "I finish what I start.", "category": "discipline"}).json()
        assert mine["favorite"] is True
        assert a("GET", "/mindset").json()["affirmation_of_the_day"]["text"] == "I finish what I start."   # favourites come first
        assert a("POST", "/affirmations", {"text": "x", "category": "luck"}).status_code == 422
        assert b("PATCH", f"/affirmations/{mine['id']}", {"favorite": False}).status_code == 404
        assert a("PATCH", f"/affirmations/{mine['id']}", {"active": False}).json()["active"] is False
        assert all(x["id"] != mine["id"] for x in a("GET", "/mindset").json()["affirmations"])
        assert b("DELETE", f"/affirmations/{mine['id']}").status_code == 404 and a("DELETE", f"/affirmations/{mine['id']}").status_code == 204


def test_reads_scripting_55x5_gratitude_and_woop():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        r1 = a("POST", "/mindset/entries", {"kind": "affirm_read"}).json()
        assert a("POST", "/mindset/entries", {"kind": "affirm_read"}).json()["id"] == r1["id"]        # once per day
        m = a("GET", "/mindset").json()
        assert m["read_today"] and m["read_streak"] == 1
        assert a("POST", "/mindset/entries", {"kind": "scripting", "body": " "}).status_code == 422
        a("POST", "/mindset/entries", {"kind": "scripting", "body": "\n".join(["I am fit and focused"] * 55), "data": {"mode": "55x5", "statement": "I am fit and focused"}})
        f = a("GET", "/mindset").json()["fifty_five"]
        assert f["active"] and f["day"] == 1 and f["done_today"] and f["statement"] == "I am fit and focused"
        assert a("POST", "/mindset/entries", {"kind": "gratitude", "data": {"items": []}}).status_code == 422
        g = a("POST", "/mindset/entries", {"kind": "gratitude", "data": {"items": ["My family", "Good sleep", " "]}}).json()
        assert g["data"]["items"] == ["My family", "Good sleep"]
        assert a("POST", "/mindset/entries", {"kind": "woop", "data": {"wish": "Gym 3x a week"}}).status_code == 422
        w = a("POST", "/mindset/entries", {"kind": "woop", "data": {"wish": "Gym 3x a week", "outcome": "Energy and confidence",
                                                                 "obstacle": "Tired after work", "plan": "If I feel tired at 6 pm, I go for just 20 minutes"}}).json()
        m = a("GET", "/mindset").json()
        assert m["woop"][0]["plan"].startswith("If I feel tired") and m["gratitude_week"] == 1 and m["scripting_streak"] == 1
        assert b("DELETE", f"/mindset/entries/{w['id']}").status_code == 404
        assert b("GET", "/mindset").json()["woop"] == []


def test_optional_emotion_on_journal(monkeypatch):
    monkeypatch.setattr(hf, "enabled", lambda: True)
    monkeypatch.setattr(hf, "_post", lambda model, payload, suffix="": [[{"label": "joy", "score": 0.91}, {"label": "sadness", "score": 0.02}]])
    with TestClient(app) as client:
        a = _user(client)
        r = a("POST", "/mindset/entries", {"kind": "gratitude", "data": {"items": ["A great day at the gym"]}, "ai_mood": True}).json()
        assert r["data"]["mood"] == "joy"
        r = a("POST", "/mindset/entries", {"kind": "gratitude", "data": {"items": ["Rest"]}}).json()
        assert "mood" not in r["data"]                                                             # off unless you ask
