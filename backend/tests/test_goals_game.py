"""Goal engine (levels, automatic progress, forecast) and the game (points, caps, bonus, streak, quests, treats)."""
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import FocusSession, Goal, GoalSnapshot
from app.services.game import level_for, streak, task_points
from app.services.goal_engine import _rates, _status


# ---------- pure rules ----------

def test_levels_and_streak_rules():
    assert level_for(0) == {"level": 1, "into_level": 0, "next_level_at": 100}
    assert level_for(100) == {"level": 2, "into_level": 0, "next_level_at": 150}
    assert level_for(260) == {"level": 3, "into_level": 10, "next_level_at": 200}
    t = date(2026, 11, 15)
    d = lambda n: t - timedelta(days=n)  # noqa: E731
    assert streak({d(0), d(1), d(2)}, t) == 3
    assert streak({d(1), d(2)}, t) == 2                    # today not earned yet: still counts
    assert streak({d(0), d(2), d(3)}, t) == 3              # one missed day is forgiven
    assert streak({d(0), d(3), d(4)}, t) == 1              # two missed days in a row reset
    assert [task_points(m, 10) for m in (15, 45, 90, 240, None)] == [5, 10, 15, 20, 5]


def test_forecast_math():
    today = date(2026, 11, 15)
    hist = [(today - timedelta(days=180), Decimal("0")), (today - timedelta(days=90), Decimal("300")), (today - timedelta(days=30), Decimal("500"))]
    rates = _rates(hist, Decimal("600"), today)
    assert set(rates) == {30, 90, 180}
    assert rates[180] == Decimal("101.46") and rates[30] == Decimal("101.46")   # 100 per ~month either way
    assert _status(Decimal("50"), Decimal("100"), Decimal("120"), today + timedelta(days=30), today) == "ahead"
    assert _status(Decimal("50"), Decimal("100"), Decimal("95"), today + timedelta(days=30), today) == "on_track"
    assert _status(Decimal("50"), Decimal("100"), Decimal("60"), today + timedelta(days=30), today) == "behind"
    assert _status(Decimal("100"), Decimal("100"), None, None, today) == "achieved"
    assert _status(Decimal("10"), Decimal("100"), None, today - timedelta(days=1), today) == "missed"


# ---------- API ----------

def _make_user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"gg.{uuid.uuid4().hex[:8]}@example.com", "password": "Goals-game-pass-1", "full_name": "GG"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None):
        resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


@pytest.fixture()
def fresh():
    with TestClient(app) as client:
        yield _make_user(client)


@pytest.fixture(scope="module")
def api():
    with TestClient(app) as client:
        yield _make_user(client)

def D(v):
    return Decimal(str(v))


def test_goal_levels_and_money_metric(api):
    api("POST", "/goals", {"title": "Emergency fund", "metric": "savings_balance"}, 422)          # money needs currency
    goal = api("POST", "/goals", {"title": "Emergency fund", "metric": "savings_balance", "metric_currency": "lkr"}, 201).json()
    assert goal["metric_currency"] == "LKR"
    api("POST", "/money/accounts", {"name": "Savings", "account_type": "savings", "currency": "LKR", "balance": "250000"}, 201)
    api("POST", "/money/accounts", {"name": "Wallet", "account_type": "cash", "currency": "LKR", "balance": "9999"}, 201)  # not savings
    due = (date.today() + timedelta(days=365)).isoformat()
    api("PUT", f"/goals/{goal['id']}/levels", {"levels": [{"level": "floor", "target_value": "300000", "target_date": due},
                                                          {"level": "stretch", "target_value": "100000"}]}, 422)   # floor above stretch
    fc = api("PUT", f"/goals/{goal['id']}/levels", {"levels": [
        {"level": "floor", "target_value": "200000", "target_date": due},
        {"level": "realistic", "target_value": "500000", "target_date": due},
        {"level": "stretch", "target_value": "1000000", "target_date": due}]}, 200).json()
    assert D(fc["current"]) == D("250000.00")
    levels = {lv["level"]: lv for lv in fc["levels"]}
    assert levels["floor"]["status"] == "achieved" and levels["floor"]["percent"] == 100
    assert levels["stretch"]["status"] == "not_enough_data" and D(levels["stretch"]["required_per_month"]) > 0
    assert fc["confidence"] == "low" and any("not financial advice" in n for n in fc["notes"])
    # With history (snapshots 60 days ago), the trend appears: +50,000 over ~2 months.
    with SessionLocal() as db:
        owner = db.get(Goal, uuid.UUID(goal["id"])).user_id
        db.add(GoalSnapshot(user_id=owner, goal_id=uuid.UUID(goal["id"]), snapshot_date=date.today() - timedelta(days=60), value=Decimal("200000")))
        db.commit()
    fc = api("GET", f"/goals/{goal['id']}/forecast", expect=200).json()
    assert fc["rate_per_month"]["trend"] is not None and D(fc["rate_per_month"]["trend"]) > D("24000")
    assert {lv["level"]: lv["status"] for lv in fc["levels"]}["stretch"] == "behind"
    assert goal["id"] in [f["goal_id"] for f in api("GET", "/goals/forecasts", expect=200).json()]


def test_goal_tasks_done_metric(api):
    goal = api("POST", "/goals", {"title": "Ship portfolio", "metric": "tasks_done", "target_value": "3"}, 201).json()
    for i in range(3):
        t = api("POST", "/tasks", {"title": f"Piece {i}", "goal_id": goal["id"]}, 201).json()
        api("PATCH", f"/tasks/{t['id']}/complete", expect=200)
    fc = api("GET", f"/goals/{goal['id']}/forecast", expect=200).json()
    assert D(fc["current"]) == D("3.00") and fc["levels"][0]["status"] == "achieved"


def test_points_after_real_actions_caps_and_no_double_count(api):
    before = api("GET", "/game", expect=200).json()
    t = api("POST", "/tasks", {"title": "Big task", "duration_minutes": 90, "category": "learning"}, 201).json()
    api("PATCH", f"/tasks/{t['id']}/complete", expect=200)
    api("PATCH", f"/tasks/{t['id']}", {"status": "todo"}, 200)
    api("PATCH", f"/tasks/{t['id']}/complete", expect=200)                 # re-complete: no second award
    g = api("GET", "/game", expect=200).json()
    task_rows = [r for r in g["recent"] if r["event_type"] == "task" and "Big task" in r["reason"]]
    assert len(task_rows) == 1 and task_rows[0]["points"] == 15 and task_rows[0]["area"] == "learning"
    # Habit: once per habit per day.
    habit = api("POST", "/habits", {"name": "Read 20 pages", "schedule": "daily"}, 201).json()
    api("POST", f"/habits/{habit['id']}/logs", {"completed": True}, 201)
    api("POST", f"/habits/{habit['id']}/logs", {"completed": True}, 201)
    g = api("GET", "/game", expect=200).json()
    assert sum(1 for r in g["recent"] if r["event_type"] == "habit") == 1
    assert g["total_earned"] > before["total_earned"] and g["streak_days"] >= 1


def test_health_points_and_balance_bonus_and_daily_cap(api):
    api("PATCH", "/game/settings", {"steps_target": 8000}, 200)
    api("POST", "/health/records", {"metric": "steps", "value": 5000, "unit": "steps", "source": "manual"}, 201)   # below target
    api("POST", "/health/records", {"metric": "steps", "value": 9100, "unit": "steps", "source": "manual"}, 201)
    api("POST", "/health/records", {"metric": "steps", "value": 12000, "unit": "steps", "source": "manual"}, 201)  # same day: once
    api("POST", "/health/workouts", {"activity": "Run", "duration_minutes": 30, "source": "manual"}, 201)
    api("POST", "/health/workouts", {"activity": "Second run", "duration_minutes": 30, "source": "manual"}, 201)   # capped (20/day)
    g = api("GET", "/game", expect=200).json()
    assert sum(1 for r in g["recent"] if r["event_type"] == "steps") == 1
    workouts = [r for r in g["recent"] if r["event_type"] == "workout"]
    assert sorted(r["points"] for r in workouts) == [0, 20] and any("cap" in r["reason"] for r in workouts)
    # 4+ areas today (learning, habits, health, + reflection) -> balance bonus appears.
    api("POST", "/memories", {"content": "Weekly review (this week). Changes for next week: 1) sleep earlier", "category": "decision"}, 201)
    g = api("GET", "/game", expect=200).json()
    assert len(g["today"]["areas"]) >= 4 and g["today"]["bonus"] > 0
    assert g["today"]["points"] <= g["daily_cap"]


def test_focus_points_scale_with_minutes(fresh):
    api = fresh  # new user, so earlier tests' points don't hit today's cap
    s = api("POST", "/focus/sessions", {"minutes": 50}, 201).json()
    with SessionLocal() as db:
        row = db.get(FocusSession, uuid.UUID(s["id"]))
        row.started_at = datetime.now(timezone.utc) - timedelta(minutes=50)
        db.commit()
    api("PATCH", f"/focus/sessions/{s['id']}/finish", {"distractions": 0}, 200)
    focus = [r for r in api("GET", "/game/ledger", expect=200).json() if r["event_type"] == "focus"]
    assert focus and focus[0]["points"] in (19, 20)            # 10 per 25 minutes


def test_pause_quests_and_treats(api):
    api("PATCH", "/game/settings", {"paused": True}, 200)
    t = api("POST", "/tasks", {"title": "While paused"}, 201).json()
    api("PATCH", f"/tasks/{t['id']}/complete", expect=200)
    assert not any("While paused" in r["reason"] for r in api("GET", "/game/ledger", expect=200).json())
    api("PATCH", "/game/settings", {"paused": False}, 200)
    for i in range(3):
        api("POST", "/game/quests", {"title": f"Q{i}", "event_type": "workout", "target_count": 5, "period": "week"}, 201)
    api("POST", "/game/quests", {"title": "Too many", "event_type": "habit", "target_count": 1}, 409)
    bal = api("GET", "/game", expect=200).json()["balance"]
    treat = api("POST", "/game/treats", {"name": "Movie night", "cost_points": bal + 1000}, 201).json()
    api("POST", f"/game/treats/{treat['id']}/redeem", {"confirm": True}, 409)               # not enough points
    cheap = api("POST", "/game/treats", {"name": "Fancy tea", "cost_points": 10, "money_cost": "1500", "currency": "LKR"}, 201).json()
    api("POST", f"/game/treats/{cheap['id']}/redeem", {}, 422)                               # must confirm
    r = api("POST", f"/game/treats/{cheap['id']}/redeem", {"confirm": True}, 409)            # no fun-money envelope
    assert "fun" in r.json()["detail"]
    done = api("POST", f"/game/treats/{cheap['id']}/redeem", {"confirm": True, "over_budget_ok": True}, 200).json()
    assert done["balance"] == bal - 10
    api("PATCH", "/game/rules/task", {"points": 20, "daily_cap": 100}, 200)
    rule = next(r for r in api("GET", "/game", expect=200).json()["rules"] if r["event_type"] == "task")
    assert (rule["points"], rule["daily_cap"]) == (20, 100)
    api("PATCH", "/game/rules/nonsense", {"points": 1}, 404)
