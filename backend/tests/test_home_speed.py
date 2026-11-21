import uuid

from fastapi.testclient import TestClient

from app.main import app

PARTS = {"/dashboard", "/finance/summary", "/health/summary", "/life/overview", "/nudge", "/today/plan", "/routines/today", "/health/trends?days=14"}


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"hm.{uuid.uuid4().hex[:8]}@example.com", "password": "Home-test-pass-one", "full_name": "H"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_home_bundle_has_every_part_and_matches_single_calls():
    with TestClient(app) as client:
        h = _user(client)
        client.post("/api/v1/tasks", headers=h, json={"title": "Home bundle task", "priority": "high"})
        out = client.get("/api/v1/home", headers=h).json()
        assert set(out) == PARTS and all(v is not None for v in out.values())
        assert [t["title"] for t in out["/dashboard"]["tasks"]] == [t["title"] for t in client.get("/api/v1/dashboard", headers=h).json()["tasks"]]
        assert out["/health/trends?days=14"]["days"] and isinstance(out["/finance/summary"], dict)
        other = client.get("/api/v1/home", headers=_user(client)).json()                    # private: user B sees none of A's tasks
        assert not any(t["title"] == "Home bundle task" for t in other["/dashboard"]["tasks"])
        assert client.get("/api/v1/home").status_code == 401


def test_responses_are_gzipped():
    with TestClient(app) as client:
        h = _user(client)
        r = client.get("/api/v1/home", headers={**h, "Accept-Encoding": "gzip"})
        assert r.headers.get("content-encoding") == "gzip"
