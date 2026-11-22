import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import WellnessSession
from app.services import kegel


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"nk.{uuid.uuid4().hex[:8]}@example.com", "password": "Note-test-pass-one", "full_name": "N"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_notes_crud_checklist_tags_search_and_privacy():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        n = a("POST", "/notes", {"title": "Gym bag", "body": "- [ ] towel\n- [x] shoes\nremember water", "tags": ["#gym", "Gym", "daily"], "color": "green"}).json()
        assert n["tags"] == ["gym", "daily"] and n["checklist"] == {"done": 1, "total": 2}
        assert a("POST", "/notes", {"title": " ", "body": ""}).status_code == 422
        t = a("POST", f"/notes/{n['id']}/toggle/0").json()
        assert t["body"].splitlines()[0] == "- [x] towel" and t["checklist"]["done"] == 2
        assert a("POST", f"/notes/{n['id']}/toggle/2").status_code == 404                   # not a checklist line
        a("POST", "/notes", {"title": "Ideas", "body": "Sakuna content plan"})
        pinned = a("POST", "/notes", {"title": "Pinned one", "pinned": True}).json()
        lst = a("GET", "/notes").json()
        assert lst["items"][0]["id"] == pinned["id"] and lst["tags"] == ["daily", "gym"]
        assert [x["title"] for x in a("GET", "/notes?q=content").json()["items"]] == ["Ideas"]
        assert [x["title"] for x in a("GET", "/notes?tag=GYM").json()["items"]] == ["Gym bag"]
        assert a("PATCH", f"/notes/{n['id']}", {"color": "blue", "pinned": True}).json()["color"] == "blue"
        assert any(r["kind"] == "note" for r in a("GET", "/search?q=towel").json()["results"])     # in "search everything"
        assert b("GET", "/notes").json()["items"] == []
        for method, path, body in (("PATCH", f"/notes/{n['id']}", {"title": "x"}), ("POST", f"/notes/{n['id']}/toggle/0", None), ("DELETE", f"/notes/{n['id']}", None)):
            assert b(method, path, body).status_code == 404
        assert not any(r["kind"] == "note" for r in b("GET", "/search?q=towel").json()["results"])
        assert a("DELETE", f"/notes/{n['id']}").status_code == 204


def test_kegel_levels_progress_and_privacy():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        ov = a("GET", "/wellness/kegel").json()
        assert ov["level"] == 1 and ov["today"] == {"sets": 0, "target": 3, "done": False} and ov["ready_for_next"] is False
        assert all(r["url"].startswith("https://") for r in ov["resources"]) and ov["guide"]["safety"] and ov["disclaimer"]
        ov = a("POST", "/wellness/kegel/sessions", {"level": 1, "sets": 3}).json()
        assert ov["today"]["done"] is True and ov["streak"] == 1 and ov["week"][-1]["sets"] == 3
        assert b("GET", "/wellness/kegel").json()["today"]["sets"] == 0
        assert a("POST", "/wellness/kegel/sessions", {"level": 5}).status_code == 422


def test_level_up_rule_needs_five_good_days():
    with SessionLocal() as db, TestClient(app) as client:
        a = _user(client)
        uid = a("GET", "/me").json()["user"]["id"]
        for _ in range(5):                                                              # 2 sets a day ...
            a("POST", "/wellness/kegel/sessions", {"level": 1, "sets": 2})
        rows = db.query(WellnessSession).filter(WellnessSession.user_id == uuid.UUID(uid)).all()
        for k, r in enumerate(rows):                                                    # ... on 5 different days
            r.local_date = date.today() - timedelta(days=k)
        db.commit()
        out = kegel.overview(db, uuid.UUID(uid), date.today())
        assert out["good_days_7"] == 5 and out["ready_for_next"] is True and out["streak"] == 5
        rows[0].sets = 1                                                                # one weak day: not ready yet
        db.commit()
        assert kegel.overview(db, uuid.UUID(uid), date.today())["ready_for_next"] is False
