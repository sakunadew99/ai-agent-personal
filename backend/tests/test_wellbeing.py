import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"wb.{uuid.uuid4().hex[:8]}@example.com", "password": "Well-test-pass-one", "full_name": "W"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_medicines_doses_stock_reminders_and_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        m = a("POST", "/medicines", {"name": "Vitamin D", "dose": "1000 IU", "times": ["20:00", "08:00"], "stock": 8, "per_dose": 1, "refill_at": 7})
        assert m.status_code == 201, m.text
        mid = m.json()["id"]
        assert m.json()["times"] == ["08:00", "20:00"]
        out = a("POST", f"/medicines/{mid}/log", {"slot": "08:00", "status": "taken"}).json()
        med = next(x for x in out["medicines"] if x["id"] == mid)
        assert med["stock"] == 7 and med["low_stock"] is True and out["refill"]
        assert next(d for d in out["doses"] if d["slot"] == "08:00")["status"] == "taken"
        out = a("POST", f"/medicines/{mid}/log", {"slot": "08:00", "status": None}).json()              # undo gives the pill back
        assert next(x for x in out["medicines"] if x["id"] == mid)["stock"] == 8
        assert a("POST", f"/medicines/{mid}/log", {"slot": "09:30", "status": "taken"}).status_code == 422
        assert isinstance(a("GET", "/medicines/reminders?days=2").json()["items"], list)
        assert a("PATCH", f"/medicines/{mid}", {"times": ["09:00"]}).json()["times"] == ["09:00"]
        assert b("GET", "/medicines").json()["medicines"] == []
        assert b("PATCH", f"/medicines/{mid}", {"name": "x"}).status_code == 404
        assert b("POST", f"/medicines/{mid}/log", {"slot": "09:00", "status": "taken"}).status_code == 404
        assert b("DELETE", f"/medicines/{mid}").status_code == 404
        assert a("DELETE", f"/medicines/{mid}").status_code == 204


def test_skills_sessions_trainer_metrics_plan_and_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        ov = a("GET", "/skills").json()
        assert any(t["trainer"] == "pitch" for t in ov["templates"])
        ov = a("POST", "/skills", {"name": "Singing", "category": "music", "icon": "🎤", "trainer": "pitch", "weekly_minutes": 60}).json()
        sid = ov["skills"][0]["id"]
        ov = a("POST", f"/skills/{sid}/sessions", {"minutes": 20, "rating": 4, "source": "pitch", "metrics": {"in_tune_pct": 72, "range": "C3-G4"}}).json()
        a("POST", f"/skills/{sid}/sessions", {"minutes": 10, "on": (date.today() - timedelta(days=1)).isoformat()})
        s = a("GET", "/skills").json()["skills"][0]
        assert s["week_minutes"] >= 20 and s["streak"] >= 1 and s["last_metrics"]["in_tune_pct"] == 72 and s["recent"][0]["source"] in ("pitch", "manual")
        assert "Singing" not in [t["name"] for t in a("GET", "/skills").json()["templates"]]
        plan = a("POST", f"/skills/{sid}/plan?ai=true").json()
        assert plan["steps"] and plan["source"] == "plan"                                             # no AI key: built-in plan
        assert b("GET", "/skills").json()["skills"] == []
        assert b("POST", f"/skills/{sid}/sessions", {"minutes": 5}).status_code == 404
        assert b("PATCH", f"/skills/{sid}", {"level": 9}).status_code == 404
        session_id = s["recent"][0]["id"]
        assert b("DELETE", f"/skills/sessions/{session_id}").status_code == 404
        assert a("DELETE", f"/skills/sessions/{session_id}").status_code == 204
        assert a("PATCH", f"/skills/{sid}", {"level": 3}).json()["skills"][0]["level"] == 3
        assert a("DELETE", f"/skills/{sid}").status_code == 204


def test_health_sync_upserts_days_and_advice():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        today = date.today()
        days = [{"day": (today - timedelta(days=k)).isoformat(), "steps": 3000 + k * 100, "heart_rate_avg": 72} for k in range(7)]
        sleep = [{"start_at": f"{(today - timedelta(days=1)).isoformat()}T23:00:00+05:30", "end_at": f"{today.isoformat()}T05:30:00+05:30", "stages": [4, 5]}]
        first = a("POST", "/health/sync", {"days": days, "sleep": sleep}).json()
        assert first["saved"] == 15
        again = a("POST", "/health/sync", {"days": days, "sleep": sleep}).json()
        assert again == {"saved": 0, "updated": 0}                                                    # no duplicates
        days[0]["steps"] = 9000
        assert a("POST", "/health/sync", {"days": days[:1]}).json()["updated"] == 1
        adv = a("GET", "/health/advice?ai=true").json()
        assert adv["facts"]["avg_steps_7d"] and any(t["title"] == "Sleep is short" for t in adv["tips"]) and adv["ai_note"]
        assert b("GET", "/health/advice").json()["facts"]["avg_steps_7d"] is None                    # private
