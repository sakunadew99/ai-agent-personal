import uuid

from fastapi.testclient import TestClient

from app.main import app


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"rt.{uuid.uuid4().hex[:8]}@example.com", "password": "Ritual-test-pass-one", "full_name": "R"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_morning_and_evening_rituals_are_private():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        a("POST", "/tasks", {"title": "Finish report", "priority": "high"})
        m = a("GET", "/ritual/morning").json()
        assert m["done"] is False and m["suggested_focus"] == "Finish report" and "blocks" in m
        m = a("POST", "/ritual/morning", {"energy": 4, "mood": 3, "focus": "Finish report"}).json()
        assert m["done"] and m["saved"] == {"energy": 4, "mood": 3, "focus": "Finish report"}
        e = a("GET", "/ritual/evening").json()
        assert e["morning_focus"] == "Finish report" and e["done"] is False
        out = a("POST", "/ritual/evening", {"mood": 4, "wins": ["Gym", "Report draft"], "lesson": "Start earlier", "tomorrow": ["Send report", "Finish report", "Call mum"]}).json()
        assert out["tasks_created"] == ["Send report", "Call mum"]                       # "Finish report" is already open
        e = a("GET", "/ritual/evening").json()
        assert e["done"] and e["saved"]["wins"] == ["Gym", "Report draft"] and e["saved"]["lesson"] == "Start earlier"
        assert b("GET", "/ritual/morning").json()["done"] is False and b("GET", "/ritual/evening").json()["morning_focus"] is None
        assert all(t["title"] != "Send report" for t in b("GET", "/tasks").json())
        assert a("POST", "/ritual/morning", {"energy": 9, "mood": 3}).status_code == 422
