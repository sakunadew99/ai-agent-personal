"""Food diary, journal, and the per-user response cache (fast pages that never go stale after your own changes)."""
import uuid
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.core import cache
from app.main import app
from app.services import ai_client

TZ = ZoneInfo("Asia/Colombo")


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"jf.{uuid.uuid4().hex[:8]}@example.com", "password": "Diary-test-pass-one", "full_name": "J"})
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


def test_food_diary(client):
    api = _user(client)
    api("POST", "/meals", {"meal": "breakfast", "foods": "string hoppers, dhal, tea", "eaten_time": "07:30", "slow": True}, 201)
    lunch = api("POST", "/meals", {"meal": "lunch", "foods": "rice and curry", "eaten_time": "13:10"}, 201).json()
    assert lunch["foods"] == "rice and curry" and lunch["eaten_time"].startswith("13:10")
    day = api("GET", "/routines/today", expect=200).json()
    assert [m["meal"] for m in day["meals"]] == ["breakfast", "lunch"]                         # ordered by time eaten
    api("DELETE", f"/meals/{lunch['id']}", expect=200)
    assert len(api("GET", "/meals", expect=200).json()) == 1
    api("POST", "/meals", {"meal": "supper", "foods": "x"}, 422)


def test_journal_full_day(client, monkeypatch):
    api = _user(client)
    today = date.fromisoformat(api("GET", "/journal", expect=200).json()["today"])
    empty = api("GET", "/journal", expect=200).json()
    assert empty["entry"] is None and len(empty["prompts"]) == 3 and empty["streak"] == 0
    page = api("PUT", f"/journal/{today}", {"mood": 4, "did": "Gym, office, 45 min IELTS", "positives": ["Finished the essay", " "],
                                            "negatives": ["Scrolled after midnight"], "gratitude": ["Amma's cooking", "Good health"],
                                            "lesson": "Phone in the other room at night", "tags": ["gym", "study"]}, 200).json()
    e = page["entry"]
    assert e["mood_icon"] == "🙂" and e["positives"] == ["Finished the essay"] and len(e["gratitude"]) == 2 and page["streak"] == 1
    api("PUT", f"/journal/{today - timedelta(days=1)}", {"gratitude": ["Rain"]}, 200)
    api("PUT", f"/journal/{today - timedelta(days=7)}", {"mood": 3, "gratitude": ["Old friend called"]}, 200)
    page = api("GET", "/journal", expect=200).json()
    assert page["streak"] == 2 and page["on_this_day"][0]["label"] == "A week ago" and page["on_this_day"][0]["line"] == "Old friend called"
    assert str(today) in page["month"]["written"] or today.month != (today - timedelta(days=1)).month
    api("PUT", f"/journal/{today + timedelta(days=5)}", {"did": "future"}, 422)
    api("PUT", f"/journal/{today}", {"mood": 9}, 422)
    # Reflection: rules without AI, AI when allowed (on request only).
    out = api("POST", f"/journal/{today}/reflect", expect=200).json()
    assert "Question for tomorrow" in out["ai_reflection"]
    monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai_client, "chat_complete", lambda *a, **k: "You kept your promise to study. What will you do with your phone tonight?")
    out = api("POST", f"/journal/{today}/reflect", expect=200).json()
    assert out["ai_reflection"].startswith("You kept your promise")
    # The compass counts a journal day as reflection.
    growth = next(a for a in api("GET", "/compass", expect=200).json()["areas"] if a["key"] == "growth")
    assert any(s["label"] == "Reflection" and s["actual"] >= 1 for s in growth["signals"])
    api("DELETE", f"/journal/{today}", expect=200)
    assert api("GET", "/journal", expect=200).json()["entry"] is None


def test_response_cache_is_fast_and_never_stale_after_your_changes(client, monkeypatch):
    monkeypatch.setattr(cache, "TTL_SECONDS", 120)
    api = _user(client)
    calls = []
    from app.services import compass
    real = compass.view

    def counting(db, user_id, today=None):
        calls.append(1)
        return real(db, user_id, today)
    monkeypatch.setattr(compass, "view", counting)
    first = api("GET", "/compass", expect=200).json()
    api("GET", "/compass", expect=200)
    assert len(calls) == 1                                                                    # second open served from cache
    api("POST", "/compass/family/log", {}, 201)                                               # any change of yours clears it
    after = api("GET", "/compass", expect=200).json()
    fam = lambda v: next(a for a in v["areas"] if a["key"] == "family")["percent"]  # noqa: E731
    assert fam(after) > fam(first) and len(calls) >= 3
    other = _user(client)
    other("GET", "/compass", expect=200)
    assert fam(other("GET", "/compass", expect=200).json()) == 0                              # never shared between users


def test_ownership(client):
    a, b = _user(client), _user(client)
    today = date.fromisoformat(a("GET", "/journal", expect=200).json()["today"])
    a("PUT", f"/journal/{today}", {"did": "private"}, 200)
    assert b("GET", "/journal", expect=200).json()["entry"] is None
    b("DELETE", f"/journal/{today}", expect=404)
    meal = a("POST", "/meals", {"meal": "dinner", "foods": "kottu"}, 201).json()
    b("DELETE", f"/meals/{meal['id']}", expect=404)
