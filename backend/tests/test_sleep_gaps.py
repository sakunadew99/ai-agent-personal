import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import SleepRecord, User
from app.services import sleep_day

TZ = ZoneInfo("Asia/Colombo")
TODAY = datetime.now(TZ).date()


def _user(client):
    email = f"sg.{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/v1/auth/register", json={"email": email, "password": "Sleep-test-pass-one", "full_name": "S"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return (lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))), email


def _at(d: date, hh: int, mm: int = 0) -> str:
    return datetime.combine(d, time(hh, mm), TZ).isoformat()


def test_phone_sleep_saved_upserted_and_band_wins():
    with TestClient(app) as client:
        (a, email), (b, _) = _user(client), _user(client)
        night = TODAY - timedelta(days=1)
        assert a("POST", "/sleep/phone", {"night": night.isoformat(), "last_use": _at(night, 2), "first_use": _at(night, 4)}).status_code == 422   # 2 h: not sleep
        r = a("POST", "/sleep/phone", {"night": night.isoformat(), "last_use": _at(night - timedelta(days=1), 23, 40), "first_use": _at(night, 6, 40),
                                       "core_minutes": 300, "interruptions": [{"at": _at(night, 3), "minutes": 4}]})
        assert r.status_code == 201 and r.json()["minutes"] == 7 * 60 - 4
        again = a("POST", "/sleep/phone", {"night": night.isoformat(), "last_use": _at(night - timedelta(days=1), 23, 30), "first_use": _at(night, 6, 30)}).json()
        assert again["id"] == r.json()["id"] and again["minutes"] == 420                                   # same night -> updated, not duplicated
        ins = a("GET", "/sleep/insights").json()
        n = next(x for x in ins["nights"] if x["night"] == night.isoformat())
        assert n["bed"] == "23:30" and n["wake"] == "06:30" and n["source"].startswith("phone")
        with SessionLocal() as db:                                                                         # a Mi Band record for the same night wins
            uid = db.query(User).filter(User.email == email).one().id
            db.add(SleepRecord(user_id=uid, start_at=datetime.combine(night - timedelta(days=1), time(23, 50), TZ), end_at=datetime.combine(night, time(6, 10), TZ),
                               duration_minutes=380, source="health_connect"))
            db.commit()
        n = next(x for x in a("GET", "/sleep/insights").json()["nights"] if x["night"] == night.isoformat())
        assert n["minutes"] == 380 and "Mi Band" in n["source"]
        assert b("GET", "/sleep/insights").json()["nights"] == []


def test_sleep_insights_flag_short_and_late_nights():
    with TestClient(app) as client:
        a, _ = _user(client)
        for k in range(1, 5):
            d = TODAY - timedelta(days=k)
            a("POST", "/sleep/phone", {"night": d.isoformat(), "last_use": _at(d, 1, 30), "first_use": _at(d, 6)})
        ins = a("GET", "/sleep/insights").json()
        text = " ".join(ins["insights"])
        assert "past midnight on 4 nights" in text and "Averaging 4.5 h" in text and ins["debt_minutes_week"] >= 120


def test_gaps_prefilled_from_screen_time_and_filled():
    with TestClient(app) as client:
        a, _ = _user(client)
        day = TODAY - timedelta(days=1)
        hourly = [0] * 24
        hourly[21], hourly[10] = 50, 30
        hours = [[] for _ in range(24)]
        hours[21] = [{"package": "com.google.android.youtube", "label": "YouTube", "category": "entertainment", "mark": "distracting", "minutes": 44}]
        hours[10] = [{"package": "org.khanacademy", "label": "Khan Academy", "category": "education", "mark": "productive", "minutes": 28}]
        assert a("PUT", "/day/usage", {"local_date": day.isoformat(), "total_minutes": 80, "hourly": hourly, "hourly_apps": hours}).status_code in (200, 201)
        a("POST", "/day/entries", {"local_date": day.isoformat(), "start_time": "12:00", "end_time": "13:00", "category": "family", "source": "manual"})
        g = a("GET", f"/day/gaps?day={day.isoformat()}").json()
        by = {x["hour"]: x for x in g["gaps"]}
        assert 12 not in by and by[21]["suggestion"] == "wasted" and by[21]["apps"][0]["label"] == "YouTube"
        assert by[10]["suggestion"] == "study" and by[23]["hour"] == 23 if 23 in by else True
        assert a("POST", "/day/gaps/fill", {"day": day.isoformat(), "answers": [{"hour": 21, "category": "wasted"}, {"hour": 10, "category": "study"}]}).json()["saved"] == 2
        g2 = {x["hour"] for x in a("GET", f"/day/gaps?day={day.isoformat()}").json()["gaps"]}
        assert 21 not in g2 and 10 not in g2
        assert a("POST", "/day/gaps/fill", {"day": day.isoformat(), "answers": [{"hour": 9, "category": "dancing"}]}).status_code == 422
        assert a("POST", "/day/gaps/fill", {"day": (TODAY + timedelta(days=2)).isoformat(), "answers": [{"hour": 9, "category": "work"}]}).status_code == 422


def test_covered_minutes():
    class E:
        def __init__(self, s, e):
            self.start_time, self.end_time = s, e
    assert sleep_day._covered([E(time(9, 0), time(9, 59))], 9) == 60
    assert sleep_day._covered([E(time(9, 30), time(10, 30))], 9) == 30
    assert sleep_day._covered([E(time(23, 30), time(0, 30))], 23) == 30
