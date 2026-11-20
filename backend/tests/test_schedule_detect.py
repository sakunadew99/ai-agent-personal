import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"sd.{uuid.uuid4().hex[:8]}@example.com", "password": "Sched-test-pass-one", "full_name": "S"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_detects_office_and_gym_times_and_is_private():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        assert a("GET", "/schedule/suggest").json()["enough_data"] is False
        today = date.today()
        for k in range(1, 15):
            d = today - timedelta(days=k)
            if d.isoweekday() <= 5:      # office 10:00-19:00 on weekdays, gym at 06:30
                assert a("POST", "/day/entries", {"local_date": d.isoformat(), "start_time": "10:00", "end_time": "13:00", "category": "work"}).status_code == 201
                assert a("POST", "/day/entries", {"local_date": d.isoformat(), "start_time": "14:00", "end_time": "19:00", "category": "meeting"}).status_code == 201
                assert a("POST", "/day/entries", {"local_date": d.isoformat(), "start_time": "06:30", "end_time": "07:30", "category": "exercise"}).status_code == 201
        s = a("GET", "/schedule/suggest").json()
        assert s["suggested"]["work_start"] == "10:00" and s["suggested"]["work_end"] == "19:00"
        assert s["suggested"]["gym_time"] == "06:30" and s["suggested"]["work_days"] == [1, 2, 3, 4, 5]
        assert any(c["field"] == "work_start" and c["to"] == "10:00" for c in s["changes"])
        assert b("GET", "/schedule/suggest").json()["enough_data"] is False          # user B never sees A's logs
        assert a("PATCH", "/profile", {"work_start": "10:00", "work_end": "19:00"}).status_code == 200
        assert not any(c["field"] == "work_start" for c in a("GET", "/schedule/suggest").json()["changes"])
