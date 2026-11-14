import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.clock import now_utc
from app.main import app
from app.models.entities import Memory
from app.services import second_brain
from app.services.second_brain import classify


@pytest.mark.parametrize(("text", "intent", "topic"), [
    ("I want to try yoga next month", "intention", "yoga"),
    ("I like yoga", "interest", "yoga"),
    ("I'm interested in photography, especially film", "interest", "photography"),
    ("I prefer deep work before 11am", "preference", "deep work before 11am"),
    ("I promised mum I'd call on Sunday", "commitment", "mum I'd call on Sunday"),
    ("My passport expires in March 2027", "fact", None),
])
def test_classify(text, intent, topic):
    assert classify(text) == (intent, topic)


def _memory(**overrides) -> Memory:
    base = dict(intent_type="interest", content="I like yoga", topic="yoga", surface_count=0, created_at=now_utc() - timedelta(days=10),
                deleted_at=None, dismissed_at=None, planned_at=None, snooze_until=None)
    base.update(overrides)
    return Memory(**base)


def test_due_rules():
    assert second_brain.is_due(_memory())
    assert not second_brain.is_due(_memory(created_at=now_utc() - timedelta(days=2)))      # too new
    assert not second_brain.is_due(_memory(intent_type="fact"))                             # facts never resurface
    assert not second_brain.is_due(_memory(dismissed_at=now_utc()))                         # "not interested"
    assert not second_brain.is_due(_memory(planned_at=now_utc()))                           # already planned
    assert not second_brain.is_due(_memory(snooze_until=now_utc() + timedelta(days=1)))     # snoozed


def test_backoff_grows_7_14_30():
    row = _memory()
    waits = []
    for _ in range(4):
        start = now_utc()
        second_brain.snooze(row, start)
        waits.append(round((row.snooze_until - start).total_seconds() / 86400))
    assert waits == [7, 14, 30, 30]
    assert row.surface_count == 4


def _client_user(client: TestClient) -> dict:
    email = f"brain.{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/v1/auth/register", json={"email": email, "password": "Brain-test-pass-1", "full_name": "Brain"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_api_types_duplicates_and_resurfacing(monkeypatch):
    with TestClient(app) as client:
        h = _client_user(client)
        r = client.post("/api/v1/memories", json={"content": "I want to try yoga next month"}, headers=h)
        assert r.status_code == 201, r.text
        memory = r.json()
        assert (memory["intent_type"], memory["topic"]) == ("intention", "yoga")

        # Near-identical memory is flagged, and can be saved deliberately.
        dup = client.post("/api/v1/memories", json={"content": "I want to try yoga next month!"}, headers=h)
        assert dup.status_code == 409 and "duplicate" in dup.json()["detail"].lower()
        assert client.post("/api/v1/memories", json={"content": "I want to try yoga next month!", "allow_duplicate": True}, headers=h).status_code == 201

        # Brand-new memories are not resurfaced; with the minimum age at 0 they are.
        assert client.get("/api/v1/memories/resurface", headers=h).json() == []
        monkeypatch.setattr(second_brain.settings, "resurface_min_age_days", 0)
        due = client.get("/api/v1/memories/resurface", headers=h).json()
        assert memory["id"] in {d["id"] for d in due} and len(due) <= 2

        # Later -> snoozed (no longer due); Plan it -> an approval proposal, not a silent task.
        later = client.post(f"/api/v1/memories/{memory['id']}/resurface", json={"action": "later"}, headers=h).json()
        assert later["memory"]["surface_count"] == 1 and later["memory"]["snooze_until"]
        assert memory["id"] not in {d["id"] for d in client.get("/api/v1/memories/resurface", headers=h).json()}

        other = client.post("/api/v1/memories", json={"content": "I love bouldering"}, headers=h).json()
        planned = client.post(f"/api/v1/memories/{other['id']}/resurface", json={"action": "plan"}, headers=h).json()
        assert planned["outcome"]["status"] == "proposed" and planned["memory"]["planned_at"]
        tasks = client.get("/api/v1/tasks", headers=h).json()
        assert not any("bouldering" in t["title"] for t in tasks)  # nothing created until approved
        approvals = client.get("/api/v1/approvals", headers=h).json()
        assert any(a["status"] == "pending" and "bouldering" in str(a["payload"]) for a in approvals)

        gone = client.post(f"/api/v1/memories/{other['id']}/resurface", json={"action": "dismiss"}, headers=h).json()
        assert gone["memory"]["dismissed_at"]
