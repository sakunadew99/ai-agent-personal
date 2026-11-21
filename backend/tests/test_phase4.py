"""Phase 4: flashcards (SM-2), mistake notebook, job tracker."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.clock import as_utc
from app.main import app
from app.services.learning import parse_import, schedule

NOW = datetime(2026, 11, 14, 8, 0, tzinfo=timezone.utc)


# ---------- pure rules ----------

def test_new_card_good_then_good_then_good():
    s1 = schedule(2.5, 0, 0, 0, "good", NOW)
    assert (s1.interval_days, s1.repetitions) == (1, 1) and s1.due_at == NOW + timedelta(days=1)
    s2 = schedule(s1.ease, s1.interval_days, s1.repetitions, 0, "good", NOW)
    assert s2.interval_days == 6
    s3 = schedule(s2.ease, s2.interval_days, s2.repetitions, 0, "good", NOW)
    assert s3.interval_days == round(6 * s3.ease) and s3.ease == 2.5


def test_again_relearns_in_minutes_and_lowers_ease():
    s = schedule(2.5, 20, 5, 0, "again", NOW)
    assert (s.interval_days, s.repetitions, s.lapses) == (0, 0, 1)
    assert s.due_at == NOW + timedelta(minutes=10) and s.ease == 2.3


def test_ease_never_below_floor_and_interval_capped():
    s = schedule(1.3, 10, 4, 0, "hard", NOW)
    assert s.ease == 1.3 and s.interval_days >= 11  # always grows by at least a day
    assert schedule(2.5, 700, 9, 0, "easy", NOW).interval_days == 730


def test_easy_beats_good_beats_hard():
    hard, good, easy = (schedule(2.5, 10, 3, 0, g, NOW).interval_days for g in ("hard", "good", "easy"))
    assert hard < good < easy


def test_bad_grade():
    with pytest.raises(ValueError):
        schedule(2.5, 0, 0, 0, "perfect", NOW)


def test_parse_import():
    text = "# German basics\nder Hund ; the dog ; Der Hund bellt.\ndie Katze\tthe cat\nlaufen - to run\nno separator here\n ; empty front\n"
    assert parse_import(text) == [("der Hund", "the dog", "Der Hund bellt."), ("die Katze", "the cat", None), ("laufen", "to run", None)]


# ---------- API ----------

@pytest.fixture(scope="module")
def api():
    with TestClient(app) as client:
        email = f"p4.{uuid.uuid4().hex[:8]}@example.com"
        r = client.post("/api/v1/auth/register", json={"email": email, "password": "Phase4-test-pass-1", "full_name": "P4"})
        assert r.status_code == 201, r.text
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        def call(method, path, body=None, expect=None):
            resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
            if expect is not None:
                assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
            return resp
        yield call


def test_cards_review_flow_and_stats(api):
    card = api("POST", "/learning/cards", {"deck": " German ", "front": "der Apfel", "back": "the apple"}, 201).json()
    assert card["deck"] == "german" and card["repetitions"] == 0
    api("POST", "/learning/cards", {"deck": "german", "front": "der Apfel", "back": "dup"}, 409)
    assert card["id"] in [c["id"] for c in api("GET", "/learning/review?deck=german", expect=200).json()]
    reviewed = api("POST", f"/learning/cards/{card['id']}/review", {"grade": "good"}, 200).json()
    assert reviewed["interval_days"] == 4 and reviewed["stability"] > 3          # FSRS: first "good" = about 4 days
    assert as_utc(datetime.fromisoformat(reviewed["due_at"].replace("Z", "+00:00"))) > datetime.now(timezone.utc) + timedelta(days=3)
    assert card["id"] not in [c["id"] for c in api("GET", "/learning/review", expect=200).json()]
    api("POST", f"/learning/cards/{card['id']}/review", {"grade": "perfect"}, 422)
    stats = api("GET", "/learning/stats", expect=200).json()
    assert stats["reviewed_today"] == 1 and stats["streak_days"] == 1
    assert {"deck": "german", "total": 1, "due_now": 0, "learned": 0} in stats["decks"]


def test_import_skips_duplicates(api):
    first = api("POST", "/learning/cards/import", {"deck": "english", "text": "ubiquitous ; everywhere\nmeticulous ; very careful"}, 200).json()
    assert (first["added"], first["skipped_duplicates"]) == (2, 0)
    again = api("POST", "/learning/cards/import", {"deck": "english", "text": "ubiquitous ; everywhere\nfrugal ; careful with money"}, 200).json()
    assert (again["added"], again["skipped_duplicates"]) == (1, 1)
    assert len(api("GET", "/learning/cards?deck=english", expect=200).json()) == 3


def test_card_edit_suspend_delete(api):
    card = api("POST", "/learning/cards", {"deck": "german", "front": "schnell", "back": "fast"}, 201).json()
    edited = api("PATCH", f"/learning/cards/{card['id']}", {"back": "fast, quick", "suspended": True}, 200).json()
    assert edited["back"] == "fast, quick" and edited["suspended"] is True
    assert card["id"] not in [c["id"] for c in api("GET", "/learning/review", expect=200).json()]
    api("DELETE", f"/learning/cards/{card['id']}", expect=204)


def test_mistake_notebook_flow(api):
    m = api("POST", "/mistakes", {"subject": "german", "what_happened": "Ich bin 25 Jahre", "correction": "Ich bin 25 Jahre alt",
                                  "lesson": "Age needs 'alt'"}, 201).json()
    assert m["occurrences"] == 1
    card = api("POST", f"/mistakes/{m['id']}/card", {}, 201).json()
    assert (card["deck"], card["front"], card["back"]) == ("german", "Ich bin 25 Jahre", "Ich bin 25 Jahre alt")
    assert api("POST", f"/mistakes/{m['id']}/card", {}, 201).json()["id"] == card["id"]  # no second card
    api("POST", f"/learning/cards/{card['id']}/review", {"grade": "easy"}, 200)
    again = api("POST", f"/mistakes/{m['id']}/again", expect=200).json()
    assert again["occurrences"] == 2 and again["card_id"] == card["id"]
    assert card["id"] in [c["id"] for c in api("GET", "/learning/review", expect=200).json()]  # card is due again
    api("PATCH", f"/mistakes/{m['id']}", {"resolved": True}, 200)
    assert m["id"] not in [x["id"] for x in api("GET", "/mistakes", expect=200).json()]
    assert m["id"] in [x["id"] for x in api("GET", "/mistakes?include_resolved=true", expect=200).json()]
    api("POST", "/mistakes", {"subject": "astrology", "what_happened": "x", "correction": "y"}, 422)


def test_job_tracker(api):
    job = api("POST", "/career/jobs", {"company": "Acme", "role": "Data Engineer", "url": "https://example.com/job"}, 201).json()
    assert job["status"] == "draft" and job["applied_at"] is None
    moved = api("PATCH", f"/career/jobs/{job['id']}", {"status": "applied", "next_step": "Follow up with recruiter",
                                                     "follow_up_on": (date.today() - timedelta(days=1)).isoformat()}, 200).json()
    assert moved["status"] == "applied" and moved["applied_at"] is not None
    api("PATCH", f"/career/jobs/{job['id']}", {"status": "hired!"}, 422)
    summary = api("GET", "/career/jobs/summary", expect=200).json()
    assert summary["by_stage"].get("applied") == 1 and summary["open"] == 1
    assert [f["id"] for f in summary["follow_ups_due"]] == [job["id"]]
    api("PATCH", f"/career/jobs/{job['id']}", {"status": "interview"}, 200)
    assert api("GET", "/career/jobs/summary", expect=200).json()["interview_rate_percent"] == 100
    api("DELETE", f"/career/jobs/{job['id']}", expect=204)
