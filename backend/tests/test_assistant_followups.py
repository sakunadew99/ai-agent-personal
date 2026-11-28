import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.main import app

TZ = ZoneInfo("Asia/Colombo")


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"fu.{uuid.uuid4().hex[:8]}@example.com", "password": "Follow-test-pass-one", "full_name": "F"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def _task(a, title):
    return next(t for t in a("GET", "/tasks").json() if t["title"] == title)


def test_yes_approves_then_move_it_and_make_it_high():
    with TestClient(app) as client:
        a = _user(client)
        r = a("POST", "/chat", {"message": "remind me to call the bank tomorrow at 10am"}).json()
        assert r["actions_proposed"] and r["actions_proposed"][0]["tool"] == "create_task"     # tasks still ask first
        cid = r["conversation_id"]
        r = a("POST", "/chat", {"message": "yes", "conversation_id": cid}).json()
        assert r["actions_completed"][0]["tool"] == "approval" and "Approved" in r["actions_completed"][0]["summary"]
        task = next(t for t in a("GET", "/tasks").json() if "bank" in t["title"].lower())
        assert task["title"] == "Call the bank"
        # follow-ups work on the task the assistant just created (needs it in the last answer: make a new one directly)
        a("PATCH", "/profile", {})
        r = a("POST", "/chat", {"message": f"move {task['title']} to friday 5pm"}).json()
        assert r["actions_completed"][0]["tool"] == "edit_task", r
        raw = datetime.fromisoformat(_task(a, task["title"])["due_at"].replace("Z", "+00:00"))
        due = (raw if raw.tzinfo else raw.replace(tzinfo=ZoneInfo("UTC"))).astimezone(TZ)
        assert due.weekday() == 4 and due.hour == 17
        cid2 = r["conversation_id"]
        r = a("POST", "/chat", {"message": "make it high priority", "conversation_id": cid2}).json()
        assert r["actions_completed"][0]["tool"] == "edit_task" and _task(a, task["title"])["priority"] == "high"


def test_undo_that_and_delete_by_name_needs_approval_and_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        r = a("POST", "/chat", {"message": "Drank 500 ml water"}).json()
        r = a("POST", "/chat", {"message": "undo that", "conversation_id": r["conversation_id"]}).json()
        assert r["actions_completed"][0]["tool"] == "undo" and a("GET", "/water").json()["today_ml"] == 0
        a("POST", "/tasks", {"title": "Dentist appointment"})
        r = a("POST", "/chat", {"message": "delete the dentist appointment task"}).json()
        assert r["actions_proposed"][0]["tool"] == "delete_task"                                 # deleting asks first
        assert _task(a, "Dentist appointment")
        # another account can't use A's conversation for follow-ups
        assert b("POST", "/chat", {"message": "yes", "conversation_id": r["conversation_id"]}).status_code == 404
        a("POST", "/chat", {"message": "yes", "conversation_id": r["conversation_id"]})
        assert not [t for t in a("GET", "/tasks").json() if t["title"] == "Dentist appointment"]


def test_repeating_task_rename_habit_and_quick_answers():
    with TestClient(app) as client:
        a = _user(client)
        r = a("POST", "/chat", {"message": "every Monday at 7 pm: team call"}).json()
        prop = (r["actions_proposed"] + r["actions_completed"])[0]
        assert prop["tool"] == "create_task" and "Team call" in prop["summary"] and "weekly mo" in prop["summary"]
        a("POST", "/habits", {"name": "Gym"})
        r = a("POST", "/chat", {"message": "rename my gym habit to Morning gym"}).json()
        assert r["actions_completed"][0]["tool"] == "rename_habit"
        assert any(h["name"] == "Morning gym" for h in a("GET", "/habits").json())
        a("POST", "/chat", {"message": "did my morning gym"})
        assert "today" in a("POST", "/chat", {"message": "When did I last go to the gym?"}).json()["reply"]
        a("POST", "/water", {"ml": 750})
        assert "750 ml" in a("POST", "/chat", {"message": "How much water today?"}).json()["reply"]
        a("POST", "/finance/expenses", {"amount": "1200", "currency": "LKR", "category": "food", "spent_at": (datetime.now(TZ) - timedelta(minutes=5)).isoformat()})
        assert "LKR 1,200.00" in a("POST", "/chat", {"message": "How much did I spend on food this month?"}).json()["reply"]


def test_streak_freeze_costs_points_once_a_week_and_ownership():
    from app.core.database import SessionLocal
    from app.models.entities import HabitLog, PointsLedger
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        h = a("POST", "/habits", {"name": "Read 10 pages"}).json()
        me = h["user_id"]
        today = datetime.now(TZ).date()
        with SessionLocal() as db:
            for k in (2, 3):
                db.add(HabitLog(habit_id=uuid.UUID(h["id"]), user_id=uuid.UUID(me), logged_on=today - timedelta(days=k)))
            db.add(PointsLedger(user_id=uuid.UUID(me), event_type="test", ref_id="seed", points=60, area="habits", reason="seed", local_date=today))
            db.commit()
        hv = next(x for x in a("GET", "/consistency").json()["habits"] if x["id"] == h["id"])
        assert hv["can_freeze"] and hv["status"] == "must"
        assert b("POST", f"/habits/{h['id']}/freeze").status_code == 404                  # not yours
        r = a("POST", f"/habits/{h['id']}/freeze").json()
        assert r["ok"] and r["streak"] == 3 and r["balance"] == 10, r
        hv = next(x for x in a("GET", "/consistency").json()["habits"] if x["id"] == h["id"])
        assert not hv["can_freeze"] and hv["status"] == "todo"
        assert a("POST", f"/habits/{h['id']}/freeze").status_code == 409                  # once a week
