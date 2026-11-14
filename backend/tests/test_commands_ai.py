"""'Say it once' commands (parse, one question, create, undo, safety) and AI controls (off switch, caps, privacy, meter)."""
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import AiSettings, AiUsage
from app.services import ai_client
from app.services.commands import parse, parse_date, parse_time

SUNDAY = date(2026, 11, 15)
TZ = ZoneInfo("Asia/Colombo")


# ---------- parser (pure) ----------

@pytest.mark.parametrize(("text", "expect"), [
    ("Add dentist next Tuesday at 3", {"title": "Dentist", "date": "2026-11-17", "time": "03:00", "ambiguity": ["meridian"], "duration_minutes": 60}),
    ("remind me to pay the electricity bill on Friday", {"title": "Pay the electricity bill", "kind": "reminder", "date": "2026-11-20", "time": None}),
    ("German class every Monday and Thursday at 7 pm", {"title": "German class", "date": "2026-11-16", "time": "19:00", "recurrence": "FREQ=WEEKLY;BYDAY=MO,TH"}),
    ("call mum tomorrow at 6 in the evening for 20 minutes", {"title": "Call mum", "date": "2026-11-16", "time": "18:00", "duration_minutes": 20}),
    ("Meeting with client on 20 Nov at 14:30 for 1 hour", {"title": "Meeting with client", "date": "2026-11-20", "time": "14:30", "duration_minutes": 60}),
    ("submit report in two weeks", {"title": "Submit report", "date": "2026-11-29", "kind": "task"}),
    ("study German every weekday at 7am until 2026-12-31", {"recurrence": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261231", "time": "07:00"}),
    ("create event birthday party on 3rd december at 7pm", {"title": "Birthday party", "date": "2026-12-03", "time": "19:00"}),
    ("Pay rent end of month", {"title": "Pay rent", "date": "2026-11-30", "money": True}),
    ("email John the invoice tomorrow", {"people": True, "date": "2026-11-16"}),
])
def test_parse(text, expect):
    got = parse(text, SUNDAY)
    for key, value in expect.items():
        assert got[key] == value, f"{text!r}: {key} = {got[key]!r}"


def test_parse_edges():
    assert parse_date("gym sunday", SUNDAY) == (SUNDAY, ["sunday"], "weekday_today")          # said on a Sunday: ask
    assert parse_date("next sunday", SUNDAY)[0] == date(2026, 11, 22)
    assert parse_date("on the 10th", SUNDAY)[0] == date(2026, 12, 10)                         # 10th already passed -> next month
    assert parse_time("at 15")[0].hour == 15 and parse_time("at noon")[0].hour == 12
    assert parse_time("at 9 in the morning")[0].hour == 9 and parse_time("at 9")[2] == "meridian"


# ---------- API ----------

def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"cmd.{uuid.uuid4().hex[:8]}@example.com", "password": "Command-pass-1", "full_name": "C"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None, extra=None):
        resp = client.request(method, "/api/v1" + path, headers={**headers, **(extra or {})}, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


@pytest.fixture()
def api():
    with TestClient(app) as client:
        yield _user(client)


def _local(task):
    return datetime.fromisoformat(task["due_at"].replace("Z", "+00:00")).replace(tzinfo=ZoneInfo("UTC")).astimezone(TZ) \
        if task["due_at"].endswith("Z") or "+" not in task["due_at"][10:] else datetime.fromisoformat(task["due_at"]).astimezone(TZ)


def test_clear_command_creates_task_and_undo(api):
    out = api("POST", "/commands", {"text": "German class every Monday and Thursday at 7 pm", "source": "voice"}, 201).json()
    assert out["status"] == "created" and out["summary"].startswith("German class ·") and "repeats weekly on mo,th" in out["summary"]
    task = next(t for t in api("GET", "/tasks", expect=200).json() if t["id"] == out["task_id"])
    assert task["recurrence"] == "FREQ=WEEKLY;BYDAY=MO,TH" and _local(task).hour == 19 and task["category"] == "learning"
    assert task["notes"] == "Added by voice command"                                            # raw words not copied
    undone = api("POST", f"/commands/{out['id']}/undo", expect=200).json()
    assert undone["status"] == "undone" and out["task_id"] not in [t["id"] for t in api("GET", "/tasks", expect=200).json()]
    api("POST", f"/commands/{out['id']}/undo", expect=409)


def test_idempotency_key_prevents_duplicates(api):
    a = api("POST", "/commands", {"text": "submit report in two weeks"}, 201, extra={"Idempotency-Key": "k-123"}).json()
    b = api("POST", "/commands", {"text": "submit report in two weeks"}, 201, extra={"Idempotency-Key": "k-123"}).json()
    assert a["id"] == b["id"]
    assert sum(1 for t in api("GET", "/tasks", expect=200).json() if t["title"] == "Submit report") == 1


def test_one_question_for_am_pm_then_created(api):
    out = api("POST", "/commands", {"text": "Add dentist next Tuesday at 3"}, 201).json()
    assert out["status"] == "needs_answer" and out["question"] == "Morning or afternoon?"
    assert [o["label"] for o in out["options"]] == ["3 am", "3 pm"]
    done = api("POST", f"/commands/{out['id']}/answer", {"answer": "15:00"}, 200).json()
    assert done["status"] == "created" and "15:00–16:00" in done["summary"]
    api("POST", f"/commands/{out['id']}/answer", {"answer": "15:00"}, 409)                      # already answered


def test_people_and_money_need_a_yes(api):
    out = api("POST", "/commands", {"text": "email John the invoice tomorrow"}, 201).json()
    assert out["status"] == "needs_answer" and "never sends" in out["question"]
    assert api("POST", f"/commands/{out['id']}/answer", {"answer": "no"}, 200).json()["status"] == "cancelled"
    out = api("POST", "/commands", {"text": "buy rice"}, 201).json()
    assert "never pays" in out["question"] and "buylist" in [o["value"] for o in out["options"]]
    done = api("POST", f"/commands/{out['id']}/answer", {"answer": "buylist"}, 200).json()
    assert done["status"] == "created" and "buy list" in done["summary"]
    assert [i["name"] for i in api("GET", "/money/buy-list", expect=200).json()] == ["Rice"]
    api("POST", f"/commands/{out['id']}/undo", expect=200)
    assert api("GET", "/money/buy-list", expect=200).json() == []


def test_sleep_window_and_clash_protection(api):
    out = api("POST", "/commands", {"text": "call the bank tomorrow at 2am"}, 201).json()
    assert out["status"] == "needs_answer" and "sleep time" in out["question"]
    tomorrow = (datetime.now(TZ) + timedelta(days=1)).date()
    api("POST", "/tasks", {"title": "Doctor", "due_at": datetime.combine(tomorrow, datetime.min.time(), TZ).replace(hour=15).isoformat(),
                           "duration_minutes": 60}, 201)
    out = api("POST", "/commands", {"text": "meeting tomorrow at 15:00"}, 201).json()
    assert out["status"] == "needs_answer" and "Doctor" in out["question"]
    move = next(o for o in out["options"] if o["value"].count(":") == 1)
    assert move["value"] == "16:00"
    done = api("POST", f"/commands/{out['id']}/answer", {"answer": move["value"]}, 200).json()
    assert done["status"] == "created" and "16:00–16:30" in done["summary"]


def test_forget_text_and_ownership(api):
    out = api("POST", "/commands", {"text": "submit taxes in two weeks"}, 201).json()
    api("DELETE", f"/commands/{out['id']}/text", expect=200)
    assert next(c for c in api("GET", "/commands", expect=200).json() if c["id"] == out["id"])["raw_text"] is None
    with TestClient(app) as client:
        other = _user(client)
        other("POST", f"/commands/{out['id']}/undo", expect=404)
        other("POST", f"/commands/{out['id']}/answer", {"answer": "yes"}, 404)
        other("DELETE", f"/commands/{out['id']}/text", expect=404)
        assert other("GET", "/commands", expect=200).json() == []


# ---------- AI controls ----------

@pytest.fixture()
def fake_key(monkeypatch):
    monkeypatch.setattr(ai_client, "_api_key", lambda: "test-key")
    calls = []

    def boom(*a, **k):
        calls.append(a)
        raise AssertionError("AI provider must not be called")
    monkeypatch.setattr(ai_client.httpx, "post", boom)
    return calls


def _uid(api):
    me = api("GET", "/me", expect=200).json()
    return uuid.UUID(str(me.get("id") or me.get("user", {}).get("id")))


def test_ai_off_switch_blocks_and_explains(api, fake_key):
    view = api("PATCH", "/ai/settings", {"ai_off": True}, 200).json()
    assert view["status"] == "blocked" and "switched off" in view["blocked_reason"]
    reply = api("POST", "/chat", {"message": "help me plan my week"}, 200).json()
    assert "switched off" in reply["reply"] and not fake_key                                  # told why; nothing sent
    view = api("PATCH", "/ai/settings", {"ai_off": False, "disabled_features": ["chat"]}, 200).json()
    assert "assistant chat" in view["blocked_reason"]


def test_money_stays_private_unless_shared(api, fake_key):
    reply = api("POST", "/chat", {"message": "how much money did I save this month?"}, 200).json()
    assert "Answered privately" in reply["reply"]
    assert not [c for c in fake_key if "chat/completions" in str(c[0])]   # nothing about money went to the chat model


def test_daily_token_cap(api):
    view = api("PATCH", "/ai/settings", {"daily_token_cap": 1000}, 200).json()
    assert view["settings"]["daily_token_cap"] == 1000 and view["status"] in ("on", "no_key")
    with SessionLocal() as db:
        uid = db.query(AiSettings).order_by(AiSettings.created_at.desc()).first().user_id
        db.add(AiUsage(user_id=uid, feature="general", model="m", input_tokens=800, output_tokens=300))
        db.commit()
        assert "Today's AI limit" in ai_client.gate(db, uid, "general")
        assert ai_client.gate(db, uid, "embedding") is not None
    view = api("GET", "/ai/usage", expect=200).json()
    assert view["today"]["tokens"] == 1100 and view["by_feature"]["chat"]["tokens"] == 1100
    assert any("NOT shared" in line for line in view["what_ai_can_see"])
    assert api("PATCH", "/ai/settings", {"daily_token_cap": 0}, 200).json()["settings"]["daily_token_cap"] is None   # 0 clears
