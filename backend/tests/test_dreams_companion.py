import uuid

from fastapi.testclient import TestClient

from app.main import app


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"dc.{uuid.uuid4().hex[:8]}@example.com", "password": "Dream-test-pass-one", "full_name": "D"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_dream_becomes_plan_only_after_accept_and_ladder_is_private():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        plan = a("POST", "/dreams/propose", {"dream": "I want to learn swimming", "horizon": "month"}).json()
        assert plan["title"] == "Learn swimming" and plan["area"] == "body" and plan["source"] == "plan"
        assert len(plan["milestones"]) == 4 and plan["why"] and plan["next_action"]
        assert a("GET", "/goals").json() == []                                               # a proposal saves nothing
        plan["next_action"] = "Find a beginner swimming class near me"
        out = a("POST", "/dreams/accept", plan)
        assert out.status_code == 201, out.text
        month = next(h for h in out.json()["horizons"] if h["key"] == "month")["goals"][0]
        assert month["title"] == "Learn swimming" and month["milestones_total"] == 4 and month["progress"] == 0
        assert month["open_tasks"] == ["Find a beginner swimming class near me"]
        assert any(c["goal"] == "Learn swimming" for c in a("GET", "/dreams/ladder").json()["today_connects"])
        goal = a("GET", "/goals").json()[0]
        assert goal["horizon"] == "month" and goal["why"] and goal["skills"]
        assert b("GET", "/dreams/ladder").json()["total"] == 0
        bad = {**plan, "parent_id": goal["id"]}                                               # user B can't hang a goal under A's
        assert b("POST", "/dreams/accept", bad).status_code == 404
        assert a("POST", "/dreams/propose", {"dream": "I want to study in Germany", "horizon": "3y"}).json()["area"] == "abroad"


def test_companion_frequency_and_answers():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        q = a("GET", "/companion?force=true").json()
        assert q["question"]["text"] and q["question"]["choices"]
        assert a("PUT", "/companion/frequency", {"frequency": "off"}).json() == {"frequency": "off"}
        off = a("GET", "/companion").json()
        assert off["question"] is None and off["frequency"] == "off"
        assert b("GET", "/companion").json()["frequency"] == "useful"                        # settings are per person
        ans = a("POST", "/companion/answer", {"choice": "health"}).json()
        assert ans["text"] and {x["open"] for x in ans["actions"]} >= {"Gym", "Health"}
        g = a("POST", "/goals", {"title": "Old goal"}).json()
        a("POST", "/companion/answer", {"choice": "pause", "goal_id": g["id"]})
        assert a("GET", "/goals").json()[0]["status"] == "paused"
        g2 = a("POST", "/goals", {"title": "A's other goal"}).json()
        b("POST", "/companion/answer", {"choice": "pause", "goal_id": g2["id"]})                # B can't pause A's goal
        assert next(x for x in a("GET", "/goals").json() if x["id"] == g2["id"])["status"] == "active"
        assert a("PUT", "/companion/frequency", {"frequency": "hourly"}).status_code == 422


def test_dream_areas_are_detected():
    from app.services.dreams import _area
    assert _area("I want to speak German fluently")[0] == "language"
    assert _area("I want to study in Germany")[0] == "abroad"
    assert _area("build $1 million net worth")[0] == "money"
    assert _area("start a new Fiverr gig")[0] == "freelance"
    assert _area("visit Ella")[0] == "travel"
    assert _area("become a better person")[0] == "self"
