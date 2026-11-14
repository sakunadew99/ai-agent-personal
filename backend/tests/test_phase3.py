"""Phase 3: repeating tasks, milestones, phone reminders (quiet hours), month view."""
import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.core.clock import as_utc
from app.main import app
from app.services.recurrence import next_occurrence, parse_rule, respect_quiet_hours

COLOMBO = ZoneInfo("Asia/Colombo")
BERLIN = ZoneInfo("Europe/Berlin")


def local(y, m, d, hh=19, mm=0, tz=COLOMBO):
    return datetime(y, m, d, hh, mm, tzinfo=tz)


# ---------- pure rules ----------

@pytest.mark.parametrize("bad", ["", "FREQ=HOURLY", "FREQ=DAILY;COUNT=3", "FREQ=DAILY;BYDAY=MO", "FREQ=WEEKLY;BYDAY=XX",
                                 "FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;UNTIL=2027"])
def test_bad_rules_rejected(bad):
    with pytest.raises(ValueError):
        parse_rule(bad)


def test_weekly_mon_thu_from_monday():
    # Mon 16 Nov 2026 7pm -> Thu 19 Nov 7pm -> Mon 23 Nov 7pm (local wall clock)
    rule = "FREQ=WEEKLY;BYDAY=MO,TH"
    first = local(2026, 11, 16)
    nxt = next_occurrence(rule, first, COLOMBO, first - timedelta(days=1))
    assert nxt == local(2026, 11, 19)
    assert next_occurrence(rule, nxt, COLOMBO, nxt) == local(2026, 11, 23)


def test_overdue_series_skips_ahead_instead_of_piling_up():
    due = local(2026, 11, 1, 7)
    now = local(2026, 11, 14, 12)
    assert next_occurrence("FREQ=DAILY", due, COLOMBO, now) == local(2026, 11, 15, 7)


def test_monthly_on_31st_clamps_and_keeps_anchor_day():
    jan31 = local(2027, 1, 31, 9)
    feb = next_occurrence("FREQ=MONTHLY", jan31, COLOMBO, jan31)
    assert feb == local(2027, 2, 28, 9)
    # Computed from the series anchor, so March is back on the 31st.
    assert next_occurrence("FREQ=MONTHLY", jan31, COLOMBO, feb) == local(2027, 3, 31, 9)


def test_interval_and_until():
    start = local(2026, 11, 16)
    assert next_occurrence("FREQ=WEEKLY;INTERVAL=2", start, COLOMBO, start) == local(2026, 11, 30)
    assert next_occurrence("FREQ=DAILY;UNTIL=20261116", start, COLOMBO, start) is None


def test_wall_clock_kept_across_dst():
    # Berlin leaves DST on 25 Oct 2026; a 19:00 daily task stays at 19:00 local.
    before = local(2026, 10, 24, tz=BERLIN)
    after = next_occurrence("FREQ=DAILY;INTERVAL=2", before, BERLIN, before)
    assert after == local(2026, 10, 26, tz=BERLIN) and after.astimezone(BERLIN).hour == 19


def test_quiet_hours_across_midnight():
    q0, q1 = time(22, 0), time(7, 0)
    late = local(2026, 11, 14, 23, 30).astimezone(timezone.utc)
    early = local(2026, 11, 15, 5, 0).astimezone(timezone.utc)
    day = local(2026, 11, 15, 12, 0).astimezone(timezone.utc)
    assert respect_quiet_hours(late, COLOMBO, q0, q1) == local(2026, 11, 15, 7, 0)
    assert respect_quiet_hours(early, COLOMBO, q0, q1) == local(2026, 11, 15, 7, 0)
    assert respect_quiet_hours(day, COLOMBO, q0, q1) == day
    assert respect_quiet_hours(late, COLOMBO, None, None) == late


# ---------- API ----------

@pytest.fixture(scope="module")
def api():
    with TestClient(app) as client:
        email = f"p3.{uuid.uuid4().hex[:8]}@example.com"
        r = client.post("/api/v1/auth/register", json={"email": email, "password": "Phase3-test-pass-1", "full_name": "P3"})
        assert r.status_code == 201, r.text
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        def call(method, path, body=None, expect=None):
            resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
            if expect is not None:
                assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
            return resp
        yield call


def _soon(hours=24):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).replace(microsecond=0)


def test_completing_repeating_task_creates_next_once(api):
    due = _soon(2)
    task = api("POST", "/tasks", {"title": "German class", "due_at": due.isoformat(), "recurrence": "freq=daily"}, 201).json()
    assert task["recurrence"] == "FREQ=DAILY"
    api("PATCH", f"/tasks/{task['id']}/complete", expect=200)
    api("PATCH", f"/tasks/{task['id']}/complete", expect=200)  # double tap: no second copy
    copies = [t for t in api("GET", "/tasks", expect=200).json() if t["title"] == "German class" and t["status"] == "todo"]
    assert len(copies) == 1
    nxt = as_utc(datetime.fromisoformat(copies[0]["due_at"].replace("Z", "+00:00")))  # SQLite returns naive UTC
    assert nxt - due == timedelta(days=1) and copies[0]["recurrence"] == "FREQ=DAILY"


def test_status_done_via_patch_also_repeats_and_plain_task_does_not(api):
    rep = api("POST", "/tasks", {"title": "Weekly review", "due_at": _soon(3).isoformat(), "recurrence": "FREQ=WEEKLY"}, 201).json()
    api("PATCH", f"/tasks/{rep['id']}", {"status": "done"}, 200)
    plain = api("POST", "/tasks", {"title": "One-off", "due_at": _soon(3).isoformat()}, 201).json()
    api("PATCH", f"/tasks/{plain['id']}/complete", expect=200)
    titles = [t["title"] for t in api("GET", "/tasks?status=todo", expect=200).json()]
    assert "Weekly review" in titles and "One-off" not in titles


def test_bad_rule_is_422_and_empty_clears(api):
    api("POST", "/tasks", {"title": "x", "recurrence": "FREQ=SECONDLY"}, 422)
    t = api("POST", "/tasks", {"title": "y", "recurrence": "FREQ=DAILY"}, 201).json()
    assert api("PATCH", f"/tasks/{t['id']}", {"recurrence": ""}, 200).json()["recurrence"] is None


def test_milestones_crud(api):
    goal = api("POST", "/goals", {"title": "Pass German A2"}, 201).json()
    stone = api("POST", f"/goals/{goal['id']}/milestones", {"title": "Finish A1 book", "due_date": "2026-12-15"}, 201).json()
    assert stone["done_at"] is None
    done = api("PATCH", f"/milestones/{stone['id']}", {"done": True}, 200).json()
    assert done["done_at"] is not None
    assert api("PATCH", f"/milestones/{stone['id']}", {"done": False}, 200).json()["done_at"] is None
    assert [m["id"] for m in api("GET", f"/goals/{goal['id']}/milestones", expect=200).json()] == [stone["id"]]
    assert stone["id"] in [m["id"] for m in api("GET", "/milestones", expect=200).json()]
    api("DELETE", f"/milestones/{stone['id']}", expect=204)
    assert api("GET", f"/goals/{goal['id']}/milestones", expect=200).json() == []


def test_reminders_respect_quiet_hours(api):
    # Make the whole day quiet except a 1-minute gap, so any reminder lands at quiet_end.
    now_local = datetime.now(COLOMBO)
    q_end = (now_local + timedelta(hours=30)).time().replace(second=0, microsecond=0)
    q_start = (datetime.combine(date.today(), q_end) + timedelta(minutes=1)).time()
    api("POST", "/checkins/settings", {"interval_minutes": 30, "enabled": True,
                                        "quiet_start": q_start.isoformat(), "quiet_end": q_end.isoformat()}, 200)
    api("POST", "/tasks", {"title": "Call bank", "due_at": _soon(5).isoformat()}, 201)
    data = api("GET", "/reminders/upcoming?days=2", expect=200).json()
    item = next(i for i in data["items"] if i["title"] == "Call bank")
    assert item["moved_for_quiet_hours"] is True
    assert as_utc(datetime.fromisoformat(item["notify_at"].replace("Z", "+00:00"))).astimezone(COLOMBO).time().replace(second=0) == q_end
    api("POST", "/checkins/settings", {"interval_minutes": 30, "enabled": True, "quiet_start": None, "quiet_end": None}, 200)
    item = next(i for i in api("GET", "/reminders/upcoming", expect=200).json()["items"] if i["title"] == "Call bank")
    assert item["moved_for_quiet_hours"] is False


def test_month_view(api):
    due = local(2027, 3, 1, 19)  # Monday
    api("POST", "/tasks", {"title": "Gym", "due_at": due.isoformat(), "recurrence": "FREQ=WEEKLY;BYDAY=MO,TH"}, 201)
    goal = api("POST", "/goals", {"title": "Spring goal", "due_date": "2027-03-20"}, 201).json()
    api("POST", f"/goals/{goal['id']}/milestones", {"title": "Halfway", "due_date": "2027-03-10"}, 201)
    month = api("GET", "/planner/monthly?month=2027-03", expect=200).json()
    days = month["days"]
    assert [e["kind"] for e in days["2027-03-01"] if e["title"] == "Gym"] == ["task"]
    assert any(e["kind"] == "repeat" for e in days["2027-03-04"])          # Thursday projection
    assert any(e["kind"] == "repeat" for e in days["2027-03-29"])          # last Monday
    assert "2027-03-02" not in days or not any(e["title"] == "Gym" for e in days["2027-03-02"])
    assert any(e["kind"] == "goal" for e in days["2027-03-20"])
    assert any(e["kind"] == "milestone" for e in days["2027-03-10"])
    api("GET", "/planner/monthly?month=2027-13", expect=422)
    api("GET", "/planner/monthly?month=march", expect=422)
