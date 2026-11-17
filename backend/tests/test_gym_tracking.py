"""Gym log, course + coding trackers, daily German/English cards and plan, hour-by-hour day report, phone usage; ownership."""
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import jobs_finder, tracking


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"gt.{uuid.uuid4().hex[:8]}@example.com", "password": "Gym-test-pass-one", "full_name": "G"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None):
        resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


def fake_sites(url, body=None):
    if "leetcode.com/graphql" in url:
        user = body["variables"]["u"]
        if user == "nobody":
            return json.dumps({"data": {"matchedUser": None}})
        return json.dumps({"data": {"matchedUser": {"username": user, "profile": {"ranking": 12345}, "submitStats": {"acSubmissionNum": [
            {"difficulty": "All", "count": 120}, {"difficulty": "Easy", "count": 70}, {"difficulty": "Medium", "count": 45}, {"difficulty": "Hard", "count": 5}]}}}})
    if "hackerrank.com" in url:
        return json.dumps({"status": True, "models": [{"badge_name": "Python", "total_stars": 5, "solved": 40}, {"badge_name": "SQL", "total_stars": 3, "solved": 20}]})
    raise AssertionError(url)


@pytest.fixture()
def client(monkeypatch):
    tracking.clear_cache()
    monkeypatch.setattr(tracking, "_get", fake_sites)
    with TestClient(app) as c:
        yield c


def test_gym_log_prs_and_ownership(client):
    a, b = _user(client), _user(client)
    v = a("GET", "/gym", expect=200).json()
    assert "Bench press" in v["exercises"]["Chest"] and "Push day" in v["templates"] and v["trained_today"] is False
    out = a("POST", "/gym/workouts", {"title": "Push day", "duration_minutes": 55, "sets": [
        {"exercise": "Bench press", "weight_kg": 60, "reps": 8}, {"exercise": "Bench press", "weight_kg": 65, "reps": 6},
        {"exercise": "Lateral raise", "weight_kg": 8, "reps": 15}, {"exercise": "Plank", "seconds": 60}]}, 201).json()
    w = out["recent"][0]
    assert w["minutes"] == 55 and w["set_count"] == 4 and w["volume_kg"] == 60 * 8 + 65 * 6 + 8 * 15
    bench = next(e for e in w["exercises"] if e["exercise"] == "Bench press")
    assert [s["set_no"] for s in bench["sets"]] == [1, 2] and bench["group"] == "Chest"
    pr = next(p for p in out["prs"] if p["exercise"] == "Bench press")
    assert pr["weight_kg"] == 65 and pr["e1rm"] == 78.0 and out["last"]["Bench press"]["weight_kg"] == 65
    assert out["this_week"]["sessions"] == 1 and out["trained_today"] is True
    a("POST", "/gym/workouts", {"sets": []}, 422)
    assert b("GET", "/gym", expect=200).json()["recent"] == []
    b("DELETE", f"/gym/workouts/{w['id']}", expect=404)
    a("DELETE", f"/gym/workouts/{w['id']}", expect=204)


def test_courses_and_coding_profiles(client):
    a, b = _user(client), _user(client)
    c = a("POST", "/learning/courses", {"platform": "Coursera", "title": "Machine Learning Specialization", "progress_pct": 30}, 201).json()
    up = a("PATCH", f"/learning/courses/{c['id']}", {"add_hours": 1.5, "progress_pct": 100}, 200).json()
    assert float(up["hours_spent"]) == 1.5 and up["status"] == "done"
    p = a("PUT", "/learning/profiles", {"platform": "leetcode", "username": "sakuna"}, 200).json()
    assert p["stats"]["solved"] == 120 and p["stats"]["medium"] == 45 and p["history"][-1]["solved"] == 120
    a("PUT", "/learning/profiles", {"platform": "hackerrank", "username": "sakuna"}, 200)
    a("PUT", "/learning/profiles", {"platform": "leetcode", "username": "nobody"}, 404)
    a("PUT", "/learning/profiles", {"platform": "leetcode", "username": "bad name!"}, 422)
    t = a("GET", "/learning/tracker", expect=200).json()
    assert t["done"] == 1 and {x["platform"] for x in t["profiles"]} == {"leetcode", "hackerrank"}
    assert next(x for x in t["profiles"] if x["platform"] == "hackerrank")["stats"]["solved"] == 60
    assert a("POST", "/learning/profiles/refresh", expect=200).json()["errors"] == []
    # ownership
    other = b("GET", "/learning/tracker", expect=200).json()
    assert other["courses"] == [] and other["profiles"] == []
    b("PATCH", f"/learning/courses/{c['id']}", {"progress_pct": 1}, 404)
    b("DELETE", f"/learning/courses/{c['id']}", expect=404)
    b("DELETE", f"/learning/profiles/{p['id']}", expect=404)
    a("DELETE", f"/learning/profiles/{p['id']}", expect=204)


def test_daily_language_cards_and_plan(client):
    a, b = _user(client), _user(client)
    first = a("POST", "/language/daily-cards", expect=200).json()["decks"]
    assert [d["added"] for d in first] == [5, 5] and first[0]["words"][0]["front"] == "der Termin"
    again = a("POST", "/language/daily-cards", expect=200).json()["decks"]
    assert [d["added"] for d in again] == [0, 0]                              # once a day
    cards = a("GET", "/learning/cards?deck=german-daily", expect=200).json()
    assert len(cards) >= 5
    plan = a("GET", "/language/today", expect=200).json()
    assert [x["lang"] for x in plan["languages"]] == ["german", "english"] and plan["total_minutes"] > 0
    assert plan["languages"][0]["cards_due"] == 5 and any(s["kind"] == "video" for s in plan["languages"][1]["steps"])
    assert b("GET", "/language/today", expect=200).json()["languages"][0]["cards_total"] == 0     # private


def test_day_report_entries_usage_and_block_suggestion(client):
    a, b = _user(client), _user(client)
    today = a("GET", "/day/report", expect=200).json()["date"]
    e = a("POST", "/day/entries", {"local_date": today, "start_time": "09:00", "end_time": "12:00", "category": "work", "note": "API work"}, 201).json()
    a("POST", "/day/entries", {"local_date": today, "start_time": "20:00", "end_time": "21:30", "category": "wasted", "note": "scrolling"}, 201)
    a("POST", "/day/entries", {"local_date": today, "start_time": "10:00", "end_time": "10:00", "category": "work"}, 422)
    a("PUT", "/day/usage", {"local_date": today, "total_minutes": 240, "distracting_minutes": 130, "productive_minutes": 30, "pickups": 80,
                           "apps": [{"package": "com.instagram.android", "label": "Instagram", "mark": "distracting", "minutes": 90},
                                    {"package": "com.google.android.youtube", "label": "YouTube", "mark": "distracting", "minutes": 40}],
                           "hourly": [0] * 20 + [60, 30, 0, 0]}, 200)
    r = a("GET", "/day/report", expect=200).json()
    t = r["totals"]
    assert t["logged"] == 270 and t["productive"] == 180 and t["wasted"] == 90 and t["phone_distracting"] == 130 and t["waste_total"] == 220
    assert r["hours"][9]["category"] == "work" and r["hours"][20]["phone_minutes"] == 60
    blk = r["block_suggestion"]
    assert blk["apps"] == ["com.instagram.android", "com.google.android.youtube"] and blk["strict"] is True
    assert any("distracting apps" in tip for tip in r["tomorrow"])
    assert "Phone: 240 min" in a("POST", "/day/report/explain", expect=200).json()["text"]
    # ownership
    other = b("GET", "/day/report", expect=200).json()
    assert other["entries"] == [] and other["usage"] is None
    b("DELETE", f"/day/entries/{e['id']}", expect=404)
    a("DELETE", f"/day/entries/{e['id']}", expect=204)


def test_jobs_include_roles_and_sri_lanka(client, monkeypatch):
    page = ('<a href="JavaScript:openSizeWindow(\'employer/JobAdvertismentServlet?ac=DEFZZZ&ec=DEFZZZ&jc=0001570199&pg=index.jsp\',1,1,\'t\')">'
            'Intern - Software Engineer<h5>Akhtari Trades (Pvt) Ltd</h5></a>')

    def fake(url):
        if "topjobs" in url:
            return page
        if "arbeitnow" in url:
            return json.dumps({"data": []})
        if "remoteok" in url:
            return json.dumps([{"legal": "x"}])
        return json.dumps({"jobs": []})
    jobs_finder.clear_cache()
    monkeypatch.setattr(jobs_finder, "_fetch", fake)
    r = _user(client)("GET", "/career/find?q=Software%20Engineer&location=Sri%20Lanka", expect=200).json()
    assert r["jobs"][0]["source"] == "topjobs.lk" and r["summary"]["sri_lanka"] == 1 and "Software Engineer" in r["roles"]
    assert r["jobs"][0]["url"].endswith("jc=0001570199")
