"""Study-abroad planner (checklist backward from deadline, costs, scholarships, verify) and coach (rules, options, safety)."""
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import CoachSuggestion, SleepRecord, User
from app.services.coach import is_distress


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"sc.{uuid.uuid4().hex[:8]}@example.com", "password": "Study-coach-pass-1", "full_name": "S"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None):
        resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    call.email = r.json()["user"]["email"] if "user" in r.json() else None
    return call


@pytest.fixture()
def api():
    with TestClient(app) as client:
        yield _user(client)


def D(v):
    return Decimal(str(v))


# ---------- study abroad ----------

def test_program_checklist_counts_back_and_is_idempotent(api):
    deadline = date.today() + timedelta(days=120)
    prog = api("POST", "/study/programs", {"country": "Germany", "university": "TU Munich", "course": "MSc Data Science", "language": "English",
                                           "stage": "shortlist", "deadline": deadline.isoformat(), "language_test": "IELTS 6.5",
                                           "currency": "eur", "application_fee": "75", "tuition_per_year": "0", "living_per_month": "1100"}, 201).json()
    assert prog["currency"] == "EUR" and prog["last_verified_at"] is None
    reqs = api("POST", f"/study/programs/{prog['id']}/checklist", {"create_tasks": True}, 200).json()
    by = {r["kind"]: r for r in reqs}
    assert by["submit"]["due_date"] == (deadline - timedelta(days=2)).isoformat()
    assert by["transcripts"]["due_date"] == (deadline - timedelta(days=45)).isoformat()
    assert "IELTS 6.5" in by["language_test"]["title"] and all(r["task_id"] for r in reqs)
    assert len(api("POST", f"/study/programs/{prog['id']}/checklist", {"create_tasks": True}, 200).json()) == len(reqs)   # no duplicates
    tasks = [t for t in api("GET", "/tasks", expect=200).json() if "TU Munich" in t["title"]]
    assert len(tasks) == len(reqs)
    done = api("PATCH", f"/study/requirements/{by['cv']['id']}", {"status": "done"}, 200).json()
    assert done["status"] == "done"
    assert next(t for t in api("GET", "/tasks", expect=200).json() if t["id"] == by["cv"]["task_id"])["status"] == "done"


def test_checklist_needs_deadline_and_passed_deadlines_clamp_to_today(api):
    prog = api("POST", "/study/programs", {"country": "NL", "university": "TU Delft", "course": "MSc"}, 201).json()
    api("POST", f"/study/programs/{prog['id']}/checklist", {"create_tasks": False}, 422)
    api("PATCH", f"/study/programs/{prog['id']}", {"deadline": (date.today() + timedelta(days=10)).isoformat()}, 200)
    reqs = api("POST", f"/study/programs/{prog['id']}/checklist", {"create_tasks": False}, 200).json()
    assert all(r["due_date"] >= date.today().isoformat() for r in reqs) and all(r["task_id"] is None for r in reqs)
    assert "language_test" not in {r["kind"] for r in reqs}            # no test listed for this program


def test_costs_lkr_conversion_and_fund_goal(api):
    prog = api("POST", "/study/programs", {"country": "Germany", "university": "RWTH", "course": "MSc CS", "stage": "shortlist", "currency": "EUR",
                                           "application_fee": "75", "living_per_month": "1000", "fx_rate_to_lkr": "330.5", "fx_rate_date": "2026-11-15",
                                           "deadline": (date.today() + timedelta(days=200)).isoformat()}, 201).json()
    plan = api("POST", f"/study/programs/{prog['id']}/costs", {"item": "visa_fee", "amount": "75", "currency": "EUR"}, 201).json()
    plan = api("POST", f"/study/programs/{prog['id']}/costs", {"item": "travel", "amount": "150000", "currency": "LKR"}, 201).json()
    plan = api("POST", f"/study/programs/{prog['id']}/costs", {"item": "other", "amount": "100", "currency": "USD"}, 201).json()
    assert D(plan["first_year_total"]) == D("12150.00")                     # 75 + 12000 + 75
    assert D(plan["lkr_total"]) == D("12150") * D("330.5") + D("150000")      # your rate, plus LKR items
    assert {k: D(v) for k, v in plan["not_converted"].items()} == {"USD": D("100")}   # never converted by guess
    goal = api("POST", f"/study/programs/{prog['id']}/fund-goal", expect=201).json()
    assert goal["metric"] == "savings_balance" and goal["metric_currency"] == "LKR" and D(goal["target_value"]) == D(plan["lkr_total"])


def test_overview_scholarships_verify_and_month_view(api):
    soon = date.today() + timedelta(days=20)
    prog = api("POST", "/study/programs", {"country": "Germany", "university": "LMU", "course": "MSc Econ", "stage": "apply",
                                           "deadline": soon.isoformat()}, 201).json()
    sch = api("POST", "/study/scholarships", {"name": "DAAD EPOS", "deadline": (soon + timedelta(days=5)).isoformat(), "program_id": prog["id"]}, 201).json()
    ov = api("GET", "/study", expect=200).json()
    assert ov["by_stage"] == {"apply": 1}
    assert [d["kind"] for d in ov["deadlines_60_days"]] == ["program", "scholarship"] and ov["deadlines_60_days"][0]["verify"] is True
    assert prog["id"] in [v["id"] for v in ov["to_verify"]]
    api("PATCH", f"/study/programs/{prog['id']}", {"verified": True}, 200)
    assert api("GET", "/study", expect=200).json()["to_verify"] == []
    api("PATCH", f"/study/scholarships/{sch['id']}", {"verified": True, "status": "preparing"}, 200)
    month = api("GET", f"/planner/monthly?month={soon:%Y-%m}", expect=200).json()
    assert any(e["kind"] == "deadline" and "LMU" in e["title"] for e in month["days"].get(soon.isoformat(), []))
    assert "never" in ov["disclaimer"]


def test_study_ownership(api):
    prog = api("POST", "/study/programs", {"country": "X", "university": "U", "course": "C", "deadline": "2030-01-01"}, 201).json()
    req = api("POST", f"/study/programs/{prog['id']}/checklist", {"create_tasks": False}, 200).json()[0]
    sch = api("POST", "/study/scholarships", {"name": "S"}, 201).json()
    with TestClient(app) as client:
        bob = _user(client)
        for method, path, body in [("PATCH", f"/study/programs/{prog['id']}", {"stage": "dropped"}), ("DELETE", f"/study/programs/{prog['id']}", None),
                                   ("POST", f"/study/programs/{prog['id']}/checklist", {}), ("GET", f"/study/programs/{prog['id']}/costs", None),
                                   ("POST", f"/study/programs/{prog['id']}/fund-goal", None), ("PATCH", f"/study/requirements/{req['id']}", {"status": "done"}),
                                   ("PATCH", f"/study/scholarships/{sch['id']}", {"status": "won"}), ("DELETE", f"/study/scholarships/{sch['id']}", None),
                                   ("POST", "/study/scholarships", {"name": "x", "program_id": prog["id"]})]:
            bob(method, path, body, expect=404)
        assert bob("GET", "/study/programs", expect=200).json() == [] and bob("GET", "/study", expect=200).json()["programs"] == 0


# ---------- coach ----------

def test_distress_detection():
    for text in ("I feel hopeless", "sometimes I want to die", "thinking about self-harm", "I can't go on"):
        assert is_distress(text), text
    for text in ("deadline is killing me lol", "finished the die-cast model", "hope this works"):
        assert not is_distress(text), text


def test_checkin_and_distress_pauses_coaching(api):
    view = api("GET", "/coach", expect=200).json()
    assert view["checkin"] is None and view["care"] is None and "not a doctor" in view["about"]
    out = api("POST", "/coach/checkin", {"energy": 4, "mood": 4, "win": "Finished the SOP draft"}, 200).json()
    assert out["care"] is None
    out = api("POST", "/coach/checkin", {"energy": 1, "mood": 1, "note": "I feel hopeless lately"}, 200).json()   # same day: updates
    assert out["care"] and any(h["phone"] == "1926" for h in out["care"]["help"])
    view = api("GET", "/coach", expect=200).json()
    assert view["care"] and view["suggestions"] == [] and view["brief"] is None and view["checkin"]["energy"] == 1
    api("POST", "/coach/checkin", {"energy": 6, "mood": 3}, 422)


def _uid_for(api) -> uuid.UUID:
    me = api("GET", "/me", expect=200).json()
    return uuid.UUID(me["user"]["id"])


def test_low_sleep_rule_slow_down_and_option_creates_task(api):
    uid = _uid_for(api)
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        for n in range(3):
            end = now - timedelta(days=n, hours=1)
            db.add(SleepRecord(user_id=uid, start_at=end - timedelta(hours=5), end_at=end, duration_minutes=300, source="manual"))
        db.commit()
    view = api("GET", "/coach", expect=200).json()
    s = next(x for x in view["suggestions"] if x["kind"] == "low_sleep")
    assert s["evidence"]["avg_sleep_hours_3_nights"] == 5.0 and "work harder" not in s["message"].lower()
    assert "Go easy" in s["message"]
    again = api("GET", "/coach", expect=200).json()
    assert sum(1 for x in again["suggestions"] if x["kind"] == "low_sleep") == 1             # once per kind per day
    out = api("POST", f"/coach/suggestions/{s['id']}/decide", {"option_id": "early_night", "helpful": True}, 200).json()
    assert out["task_id"] and any(t["title"] == "Wind down for an early night" for t in api("GET", "/tasks", expect=200).json())
    api("POST", f"/coach/suggestions/{s['id']}/decide", {"option_id": "early_night"}, 409)
    hist = api("GET", "/coach/history", expect=200).json()
    assert hist["suggestions_by_kind"]["low_sleep"] == {"shown": 1, "accepted": 1, "helpful": 1}


def test_overdue_rule_moves_tasks_and_mute_and_cap(api):
    for i in range(5):
        api("POST", "/tasks", {"title": f"Old {i}", "priority": "high" if i == 0 else "low",
                               "due_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}, 201)
    s = next(x for x in api("GET", "/coach", expect=200).json()["suggestions"] if x["kind"] == "overdue_pileup")
    assert s["evidence"] == {"overdue": 5, "not_high_priority": 4}
    assert api("POST", f"/coach/suggestions/{s['id']}/decide", {"option_id": "move"}, 200).json()["moved"] == 4
    still = [t for t in api("GET", "/tasks", expect=200).json() if t["title"].startswith("Old ")]
    moved = [t for t in still if t["priority"] == "low"]
    assert all(datetime.fromisoformat(t["due_at"].replace("Z", "+00:00")).replace(tzinfo=timezone.utc) > datetime.now(timezone.utc) for t in moved)
    settings = api("PATCH", "/coach/settings", {"muted_kinds": ["overdue_pileup"], "daily_cap": 0, "tone": "direct"}, 200).json()
    assert settings == {"tone": "direct", "daily_cap": 0, "muted_kinds": ["overdue_pileup"]}


def test_ignored_three_times_asks_keep_or_stop(api):
    uid = _uid_for(api)
    with SessionLocal() as db:
        for n in range(1, 4):
            db.add(CoachSuggestion(user_id=uid, kind="low_sleep", local_date=date.today() - timedelta(days=n), message="m", status="dismissed", choice="dismiss"))
        now = datetime.now(timezone.utc)
        for n in range(3):
            end = now - timedelta(days=n, hours=1)
            db.add(SleepRecord(user_id=uid, start_at=end - timedelta(hours=4), end_at=end, duration_minutes=240, source="manual"))
        db.commit()
    s = next(x for x in api("GET", "/coach", expect=200).json()["suggestions"] if x["kind"] == "low_sleep")
    assert [o["id"] for o in s["options"]][:2] == ["keep", "mute"]
    api("POST", f"/coach/suggestions/{s['id']}/decide", {"option_id": "mute"}, 200)
    with SessionLocal() as db:
        assert db.get(User, uid) is not None
    assert "low_sleep" in api("PATCH", "/coach/settings", {}, 200).json()["muted_kinds"]


def test_coach_ownership(api):
    for i in range(5):
        api("POST", "/tasks", {"title": f"Late {i}", "due_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()}, 201)
    s = api("GET", "/coach", expect=200).json()["suggestions"][0]
    with TestClient(app) as client:
        bob = _user(client)
        bob("POST", f"/coach/suggestions/{s['id']}/decide", {"option_id": s["options"][0]["id"]}, 404)
        assert bob("GET", "/coach", expect=200).json()["suggestions"] == [] or all(x["id"] != s["id"] for x in bob("GET", "/coach", expect=200).json()["suggestions"])
