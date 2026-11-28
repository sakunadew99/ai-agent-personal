"""Life roadmap: generate from the money plan, live progress, auto-done, reports by period, monitor proposals need approval,
AI changes are validated, edits and ownership on every route, Sunday tick."""
import json
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.main import app
from app.services import ai_client

TZ = ZoneInfo("Asia/Colombo")
SETUP = {"salary": 100000, "payday": 25, "fixed": {"boarding": 6500}, "food_transport": 30000, "debts": [{"name": "Credit card", "balance": 40000}]}


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"rm.{uuid.uuid4().hex[:8]}@example.com", "password": "Roadmap-test-pass-1", "full_name": "R"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def _item(v, title_part):
    return next(i for ph in v["phases"] for i in ph["items"] if title_part in i["title"])


def test_generate_progress_auto_done_and_reports():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        assert a("GET", "/roadmap").json()["has_roadmap"] is False
        a("POST", "/money/setup", SETUP)
        v = a("POST", "/roadmap/generate", {}).json()
        assert v["current_phase"] == "now" and len(v["phases"]) == 5 and v["focus"]
        assert a("POST", "/roadmap/generate", {}).status_code == 409                          # one roadmap; rebuild on purpose
        card = _item(v, "credit card")
        assert card["metric"] == "debt_total" and card["current"] == 40000 and card["state"] != "done"
        # paying off the card (debt row removed) marks the step done automatically
        lid = a("GET", "/money/plan").json()["debt"]["debts"][0]["id"]
        a("DELETE", f"/finance/liabilities/{lid}")
        v = a("GET", "/roadmap").json()
        assert _item(v, "credit card")["state"] == "done" and v["today"]["kind"] == "daily"
        # 3 workouts a week from the day tracker
        today = datetime.now(TZ).date()
        for k in range(3):
            a("POST", "/day/entries", {"local_date": (today - timedelta(days=k)).isoformat(), "start_time": "18:00", "end_time": "19:00", "category": "exercise", "source": "manual"})
        assert _item(a("GET", "/roadmap").json(), "3 workouts")["state"] == "done"
        w = a("GET", "/roadmap/review/weekly").json()
        assert w["kind"] == "weekly" and any("credit card" in t.lower() for t in w["done_in_period"]) and w["history"]
        assert a("GET", "/roadmap/review/monthly").json()["score"] >= 0 and a("GET", "/roadmap/review/yearly").json()["kind"] == "yearly"
        assert a("GET", "/roadmap/review/hourly").status_code == 404
        assert b("GET", "/roadmap").json()["has_roadmap"] is False                            # someone else sees nothing


def test_edit_add_delete_and_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        a("POST", "/money/setup", SETUP)
        v = a("POST", "/roadmap/generate", {}).json()
        cv = _item(v, "LinkedIn")
        assert b("PATCH", f"/roadmap/items/{cv['id']}", {"status": "done"}).status_code == 404
        assert b("DELETE", f"/roadmap/items/{cv['id']}").status_code == 404
        v = a("PATCH", f"/roadmap/items/{cv['id']}", {"status": "done"}).json()
        assert _item(v, "LinkedIn")["state"] == "done"
        v = a("POST", "/roadmap/items", {"phase": "m1_3", "area": "learn", "title": "German A1 course", "metric": "manual"}).json()
        new = _item(v, "German A1")
        assert new["source"] == "user"
        assert a("DELETE", f"/roadmap/items/{new['id']}").status_code == 204


def test_monitor_proposes_needs_approval_and_validates_ai(monkeypatch):
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        a("POST", "/money/setup", SETUP)
        v = a("POST", "/roadmap/generate", {}).json()
        late = _item(v, "Sleep 7")
        a("PATCH", f"/roadmap/items/{late['id']}", {"target_date": (datetime.now(TZ).date() - timedelta(days=2)).isoformat()})
        other = b("POST", "/money/setup", SETUP) and b("POST", "/roadmap/generate", {}).json()
        foreign = other["phases"][0]["items"][0]["id"]

        def fake(db, uid, feature, model, messages, temperature=0.2):
            if feature == "roadmap_check":
                return json.dumps({"summary": "Good start. Card first, then the emergency fund.", "changes": [
                    {"op": "add", "phase": "m1_3", "area": "learn", "title": "Power BI course, 2 hours a week", "metric": "manual", "why": "fits your ideas"},
                    {"op": "drop", "id": foreign, "why": "not yours: must be ignored"},
                    {"op": "move", "id": late["id"], "target_date": "1999-01-01", "why": "bad date: ignored"},
                    {"op": "explode", "id": late["id"]}]})
            return None
        monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
        monkeypatch.setattr(ai_client, "chat_complete", fake)
        r = a("POST", "/roadmap/check", {"ai": True}).json()
        ops = [(c["op"], c.get("id"), c.get("title")) for c in r["changes"]]
        assert r["approval_id"] and r["summary"].startswith("Good start")
        assert ("move", late["id"], None) in ops                                           # the rule: 30 more days
        assert any(o == "add" and t.startswith("Power BI") for o, _i, t in ops)
        assert not any(i == foreign for _o, i, _t in ops) and not any(o == "explode" for o, _i, _t in ops)
        assert _item(a("GET", "/roadmap").json(), "Sleep 7")["state"] == "late"               # nothing changed before approval
        assert b("POST", f"/approvals/{r['approval_id']}/approve").status_code == 404
        a("POST", f"/approvals/{r['approval_id']}/approve")
        v = a("GET", "/roadmap").json()
        assert _item(v, "Sleep 7")["state"] != "late" and _item(v, "Power BI course")["source"] == "ai"
        assert _item(b("GET", "/roadmap").json(), other["phases"][0]["items"][0]["title"][:12])["state"] != "dropped"


def test_sunday_tick_report_and_check_once():
    from app.core.database import SessionLocal
    from app.services import roadmap
    with TestClient(app) as client:
        a = _user(client)
        a("POST", "/money/setup", SETUP)
        a("POST", "/roadmap/generate", {})
        sunday = datetime(2027, 3, 7, 13, 0, tzinfo=timezone.utc)          # 18:30 in Colombo
        with SessionLocal() as db:
            n1 = roadmap.weekly_due(db, sunday); db.commit()
            n2 = roadmap.weekly_due(db, sunday); db.commit()
        assert n1 >= 1 and n2 == 0


def test_assistant_answers_roadmap_question():
    with TestClient(app) as client:
        a = _user(client)
        assert "don't have a life roadmap" in a("POST", "/chat", {"message": "How is my roadmap going?"}).json()["reply"]
        a("POST", "/money/setup", SETUP)
        a("POST", "/roadmap/generate", {})
        assert a("POST", "/chat", {"message": "How is my roadmap going?"}).json()["reply"].startswith("Now: This month")
