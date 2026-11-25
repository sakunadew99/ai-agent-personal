import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.main import app
from app.services import consistency

TODAY = datetime.now(ZoneInfo("Asia/Colombo")).date()


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"ct.{uuid.uuid4().hex[:8]}@example.com", "password": "Cons-test-pass-one", "full_name": "C"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_strength_forgives_one_miss_and_rewards_consistency():
    start = TODAY - timedelta(days=40)
    every = {start + timedelta(days=i) for i in range(41)}
    one_miss = every - {TODAY - timedelta(days=3)}
    half = {d for d in every if d.toordinal() % 2}
    s_all, s_miss, s_half = (consistency.strength(x, start, TODAY, None) for x in (every, one_miss, half))
    assert s_all > 85 and s_all - s_miss < 10 and s_half < 60 and s_miss > s_half
    assert consistency.strength(set(), start, TODAY, None) == 0
    # weekly target: 3 of 3 every week = strong; the current unfinished week doesn't drag it down
    wk = {start + timedelta(days=i) for i in range(41) if (start + timedelta(days=i)).weekday() in (0, 2, 4)}
    assert consistency.strength(wk, start, TODAY, 3) > 65                        # ~6 perfect weeks: strength builds over time
    assert consistency.tiny_version("Gym session") == "10 minutes or one set" and consistency.tiny_version("Paint") == "the 2-minute version"


def test_never_miss_twice_and_today_and_review():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        h = a("POST", "/habits", {"name": "Read 10 pages"}).json()
        for k in (5, 4, 3, 2):
            a("POST", f"/habits/{h['id']}/logs", {"logged_on": (TODAY - timedelta(days=k)).isoformat()})
        c = a("GET", "/consistency").json()
        r = c["habits"][0]
        assert r["status"] == "must" and "Never miss twice" in r["nudge"] and r["tiny"] == "1 page" and r["journey_day"] == 6
        assert c["must_do"] == ["Read 10 pages"] and c["stacking"][0]["text"].endswith("I will read 10 pages.")
        a("POST", f"/habits/{h['id']}/logs", {})
        assert a("GET", "/consistency").json()["habits"][0]["status"] == "done"
        a("POST", "/day/entries", {"local_date": TODAY.isoformat(), "start_time": "00:00", "end_time": "02:00", "category": "study", "source": "manual"})
        a("POST", "/water", {"ml": 500})
        t = a("GET", "/today").json()
        assert t["ring"][0]["category"] == "study" and t["ring"][0]["minutes"] == 120 and t["productive_minutes"] >= 120
        assert t["water"]["today_ml"] == 500 and t["habits"][0]["done_today"] and t["affirmation"]
        assert sum(s["minutes"] for s in t["ring"]) == 24 * 60
        a("POST", "/day/entries", {"local_date": (TODAY - timedelta(days=1)).isoformat(), "start_time": "20:00", "end_time": "23:00", "category": "wasted", "source": "manual"})
        rv = a("GET", "/review/week").json()
        assert rv["wasted_minutes"] == 180 and rv["productive_minutes"] >= 120 and rv["one_change"]
        assert b("GET", "/consistency").json()["habits"] == [] and b("GET", "/today").json()["productive_minutes"] == 0


def test_ring_marks_sleep_from_phone_estimate():
    with TestClient(app) as client:
        a = _user(client)
        tz = ZoneInfo("Asia/Colombo")
        bed = datetime.combine(TODAY - timedelta(days=1), datetime.min.time(), tz).replace(hour=23)
        wake = datetime.combine(TODAY, datetime.min.time(), tz).replace(hour=6, minute=30)
        a("POST", "/sleep/phone", {"night": TODAY.isoformat(), "last_use": bed.isoformat(), "first_use": wake.isoformat()})
        ring = a("GET", "/today").json()["ring"]
        assert ring[0]["category"] == "sleep" and ring[0]["minutes"] == 6 * 60 + 30


def test_date_type():
    assert isinstance(TODAY, date)
