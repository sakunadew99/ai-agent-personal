"""Life OS Phase 1: routines, checklists, short version, points, day/week/month views, day plan, meals, ownership."""
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app

MON, WED, SAT, SUN = date(2026, 11, 16), date(2026, 11, 18), date(2026, 11, 21), date(2026, 11, 22)


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"rt.{uuid.uuid4().hex[:8]}@example.com", "password": "Routine-pass-1", "full_name": "R"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None):
        resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def api(client):
    call = _user(client)
    call("POST", "/routines/starter", expect=201)
    return call


def _by_name(items):
    return {i["name"]: i for i in items}


def test_starter_loads_notebook_once(api):
    names = {r["name"] for r in api("GET", "/routines", expect=200).json()}
    assert {"Morning", "After gym", "Office evening", "Weekend evening", "Sunday reset", "Night", "Gym bag", "Office bag"} <= names
    again = api("POST", "/routines/starter", expect=201).json()
    assert again["added"] == 0                                                          # loading twice adds nothing
    me = api("GET", "/me", expect=200).json()
    profile = me.get("profile", me)
    assert profile["work_days"] == [1, 2, 3, 4, 5] and profile["gym_days"] == [1, 2, 4, 5]


def test_weekday_weekend_and_gym_days(api):
    mon = _by_name(api("GET", f"/routines/today?day={MON}", expect=200).json()["items"])
    assert {"Morning", "After gym", "Office evening", "Night", "Gym bag", "Office bag"} <= set(mon) and "Weekend evening" not in mon
    wed = api("GET", f"/routines/today?day={WED}", expect=200).json()
    assert "After gym" not in _by_name(wed["items"]) and wed["day_type"]["label"] == "Office day"
    sat = api("GET", f"/routines/today?day={SAT}", expect=200).json()
    assert "Weekend evening" in _by_name(sat["items"]) and "Office evening" not in _by_name(sat["items"])
    assert "Sunday reset" in _by_name(api("GET", f"/routines/today?day={SUN}", expect=200).json()["items"])
    # Change the gym days to Wed + Sat: the after-gym routine and the gym bag follow.
    api("PATCH", "/profile", {"gym_days": [3, 6, 6]}, 200)
    assert "After gym" in _by_name(api("GET", f"/routines/today?day={WED}", expect=200).json()["items"])
    assert "Gym bag" not in _by_name(api("GET", f"/routines/today?day={MON}", expect=200).json()["items"])
    api("PATCH", "/profile", {"gym_days": [0, 8]}, 422)


def test_tick_finish_short_version_skip_and_points(api):
    night = _by_name(api("GET", f"/routines/today?day={MON}", expect=200).json()["items"])["Night"]
    rid, steps = night["id"], night["steps"]
    before = api("GET", "/game", expect=200).json()["balance"] if api("GET", "/game").status_code == 200 else None
    out = api("POST", f"/routines/{rid}/days/{MON}/mode", {"mode": "short"}, 200).json()
    essential = [s for s in steps if s["essential"]]
    assert set(out["needed_step_ids"]) == {s["id"] for s in essential} and out["status"] == "open"
    for s in essential:
        out = api("POST", f"/routines/{rid}/days/{MON}/steps/{s['id']}", {"done": True}, 200).json()
    assert out["status"] == "done" and out["progress"] == 1.0
    if before is not None:
        assert api("GET", "/game", expect=200).json()["balance"] > before                # short version still earns points
    # Untick: back to open; switching to full needs every step.
    out = api("POST", f"/routines/{rid}/days/{MON}/steps/{essential[0]['id']}", {"done": False}, 200).json()
    assert out["status"] == "open"
    out = api("POST", f"/routines/{rid}/days/{MON}/mode", {"mode": "full"}, 200).json()
    assert len(out["needed_step_ids"]) == len(steps)
    morning = _by_name(api("GET", f"/routines/today?day={MON}", expect=200).json()["items"])["Morning"]
    assert api("POST", f"/routines/{morning['id']}/days/{MON}/skip", expect=200).json()["status"] == "skipped"
    api("POST", f"/routines/{rid}/days/{MON}/steps/{uuid.uuid4()}", {"done": True}, 404)


def test_week_and_month_views(api):
    week = api("GET", f"/routines/week?start={WED}", expect=200).json()
    assert week["start"] == str(MON) and len(week["days"]) == 7
    assert [d["day_type"]["label"] for d in week["days"]] == [
        "Gym + office", "Gym + office", "Office day", "Gym + office", "Gym + office", "Free day", "Reset day"]
    assert week["gym"]["target"] == 4
    after_gym = _by_name(api("GET", f"/routines/today?day={MON}", expect=200).json()["items"])["After gym"]
    api("POST", f"/routines/{after_gym['id']}/days/{MON}/mode", {"mode": "short"}, 200)
    for s in [s for s in after_gym["steps"] if s["essential"]]:
        api("POST", f"/routines/{after_gym['id']}/days/{MON}/steps/{s['id']}", {"done": True}, 200)
    week = api("GET", f"/routines/week?start={MON}", expect=200).json()
    assert week["gym"]["done"] == 1 and week["days"][0]["gym_done"] is True
    month = api("GET", "/routines/month?month=2026-11", expect=200).json()
    assert len(month["days"]) == 30 and month["first_weekday"] == 7                      # 1 Nov 2026 is a Sunday
    assert any(r["name"] == "Night" for r in month["routines"])
    api("GET", "/routines/month?month=2026-13", expect=422)


def test_day_plan_uses_routines_and_work_days(api):
    api("PATCH", "/profile", {"work_start": "18:00", "work_end": "23:00", "gym_time": "10:00", "wake_time": "06:00", "sleep_time": "00:30"}, 200)
    mon = api("POST", "/planner/generate", {"plan_date": str(MON)}, 200).json()
    titles = [i["title"] for i in mon["items"]]
    assert "Work" in titles and "Gym" in titles and any("After gym" in t for t in titles) and any("Night" in t for t in titles)
    assert "Morning routine" not in titles and any("Morning" in t for t in titles)          # the real routine replaces the generic block
    assert any(i["kind"] == "routine" for i in mon["items"])
    sat = api("POST", "/planner/generate", {"plan_date": str(SAT)}, 200).json()
    sat_titles = [i["title"] for i in sat["items"]]
    assert "Work" not in sat_titles and "Gym" not in sat_titles and any("Weekend evening" in t for t in sat_titles)


def test_edit_routine_keeps_ticks_and_custom_routine(api):
    gym_bag = _by_name(api("GET", "/routines", expect=200).json())["Gym bag"]
    first = gym_bag["steps"][0]
    api("POST", f"/routines/{gym_bag['id']}/days/{MON}/steps/{first['id']}", {"done": True}, 200)
    steps = [{"id": s["id"], "title": s["title"], "essential": s["essential"]} for s in gym_bag["steps"]] + [{"title": "Protein shake"}]
    edited = api("PATCH", f"/routines/{gym_bag['id']}", {"steps": steps}, 200).json()
    assert edited["steps"][-1]["title"] == "Protein shake" and edited["kind"] == "checklist"   # partial update keeps other fields
    today = _by_name(api("GET", f"/routines/today?day={MON}", expect=200).json()["items"])["Gym bag"]
    assert first["id"] in today["done_step_ids"]
    made = api("POST", "/routines", {"name": "Study German", "icon": "🇩🇪", "start_time": "07:30", "duration_minutes": 45, "days": [6, 7],
                                     "steps": [{"title": "Flashcards", "essential": True}, {"title": "Listening 15 min"}]}, 201).json()
    assert made["day_rule"] == "fixed" and made["days"] == [6, 7]
    assert "Study German" in _by_name(api("GET", f"/routines/today?day={SAT}", expect=200).json()["items"])
    api("POST", "/routines", {"name": "Bad", "days": [9]}, 422)
    api("DELETE", f"/routines/{made['id']}", expect=200)
    assert "Study German" not in _by_name(api("GET", "/routines", expect=200).json())


def test_meal_log(api):
    out = api("POST", "/meals", {"meal": "lunch", "slow": True, "no_screen": True, "upright": True, "stopped_80": True}, 201).json()
    assert out["mindful"] == 4
    day = api("GET", "/routines/today", expect=200).json()
    assert day["meals"] and day["eating_rules"]["while"]
    api("POST", "/meals", {"meal": "brunch"}, 422)


def test_ownership(client):
    a, b = _user(client), _user(client)
    a("POST", "/routines/starter", expect=201)
    routine = a("GET", "/routines", expect=200).json()[0]
    step = routine["steps"][0]["id"]
    assert b("GET", "/routines", expect=200).json() == []
    b("PATCH", f"/routines/{routine['id']}", {"name": "Mine now"}, 404)
    b("DELETE", f"/routines/{routine['id']}", expect=404)
    b("POST", f"/routines/{routine['id']}/days/{MON}/steps/{step}", {"done": True}, 404)
    b("POST", f"/routines/{routine['id']}/days/{MON}/mode", {"mode": "short"}, 404)
    b("POST", f"/routines/{routine['id']}/days/{MON}/skip", expect=404)
    assert b("GET", f"/routines/today?day={MON}", expect=200).json()["items"] == []
    a("GET", f"/routines/{routine['id']}", expect=405)                                     # no single-get route; nothing leaks
