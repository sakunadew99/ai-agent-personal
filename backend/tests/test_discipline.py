import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import DisciplineEvent, DisciplineGoal
from app.services import discipline


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"dc.{uuid.uuid4().hex[:8]}@example.com", "password": "Disc-test-pass-one", "full_name": "D"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_goal_streak_checkins_reset_and_insights():
    with TestClient(app) as client:
        a = _user(client)
        ov = a("GET", "/discipline").json()
        assert ov["goals"] == [] and "late_night" in ov["triggers"] and ov["blocking"]["dns"][0]["host"].endswith("cleanbrowsing.org")
        start = (date.today() - timedelta(days=10)).isoformat()
        g = a("POST", "/discipline/goals", {"kind": "porn_free", "reasons": "Focus and confidence", "replacements": ["Gym", " ", "Read"],
                                            "started_on": start}).json()
        assert g["label"] == "Self-control" and g["replacements"] == ["Gym", "Read"]
        assert 9 <= g["streak_days"] <= 11 and g["next_milestone"] == 14
        assert a("POST", "/discipline/goals", {"started_on": (date.today() + timedelta(days=3)).isoformat()}).status_code == 422
        u = a("POST", f"/discipline/goals/{g['id']}/checkin", {"kind": "urge", "trigger": "boredom", "intensity": 4}).json()
        assert u["timer_minutes"] == 10 and "Read" in u["suggestions"] and "support" in u
        ev = u["goal"]["recent"][0]
        assert a("PATCH", f"/discipline/events/{ev['id']}", {"stayed": True, "action": "Read"}).json()["stayed"] is True
        assert a("POST", f"/discipline/goals/{g['id']}/checkin", {"kind": "urge", "trigger": "nope"}).status_code == 422
        m = a("POST", f"/discipline/goals/{g['id']}/checkin", {"kind": "motivation"}).json()
        assert m["your_why"] == "Focus and confidence"
        ok = a("POST", f"/discipline/goals/{g['id']}/checkin", {"kind": "ok"}).json()
        assert ok["goal"]["checked_in_today"] is True and ok["goal"]["handled_30d"] == 1
        assert any("boredom" in i for i in ok["goal"]["insights"])
        best = ok["goal"]["streak_days"]
        r = a("POST", f"/discipline/goals/{g['id']}/checkin", {"kind": "reset", "trigger": "late_night"}).json()
        assert r["goal"]["streak_days"] == 0 and r["goal"]["best_streak"] == best and r["goal"]["resets"] == 1
        assert "isn't failure" in r["message"] and r["suggestions"]
        assert a("PATCH", f"/discipline/goals/{g['id']}", {"label": "My focus", "active": False}).json()["label"] == "My focus"
        assert not any(x["kind"] == "discipline" for x in a("GET", "/search?q=confidence").json()["results"])   # stays out of search
        assert a("DELETE", f"/discipline/goals/{g['id']}").status_code == 204
        assert a("GET", "/discipline").json()["goals"] == []


def test_discipline_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        g = a("POST", "/discipline/goals", {"kind": "nofap"}).json()
        ev = a("POST", f"/discipline/goals/{g['id']}/checkin", {"kind": "urge"}).json()["goal"]["recent"][0]
        assert b("GET", "/discipline").json()["goals"] == []
        for method, path, body in (("PATCH", f"/discipline/goals/{g['id']}", {"label": "x"}), ("POST", f"/discipline/goals/{g['id']}/checkin", {"kind": "ok"}),
                                   ("PATCH", f"/discipline/events/{ev['id']}", {"stayed": True}), ("DELETE", f"/discipline/goals/{g['id']}", None)):
            assert b(method, path, body).status_code == 404


def test_suggestions_late_night_and_own_replacements():
    g = DisciplineGoal(user_id=uuid.uuid4(), kind="custom", label="x", replacements=["Guitar"], started_on=date.today(), streak_start=date.today())
    s = discipline.suggestions(g, "stress", 23)
    assert s[0] == "Put the phone outside the bedroom now" and "Guitar" in s and len(s) <= 6
    assert discipline.suggestions(g, None, 14)[0] == discipline.BY_TRIGGER["other"][0]


def test_clean_days_count_slip_days_once():
    with SessionLocal() as db:
        from app.models.entities import User
        u = User(email=f"dc.{uuid.uuid4().hex[:8]}@example.com", password_hash="x", full_name="D")
        db.add(u); db.flush()
        today = date.today()
        g = DisciplineGoal(user_id=u.id, kind="custom", label="x", started_on=today - timedelta(days=20), streak_start=today - timedelta(days=2),
                           best_streak=12, resets=2)
        db.add(g); db.flush()
        for d in (today - timedelta(days=8), today - timedelta(days=8), today - timedelta(days=2)):
            db.add(DisciplineEvent(user_id=u.id, goal_id=g.id, kind="reset", local_date=d, local_hour=23))
        db.flush()
        out = discipline.goal_out(db, g, today)
        assert out["clean_days_total"] == 18 and out["best_streak"] == 12 and out["streak_days"] == 2
        db.rollback()
