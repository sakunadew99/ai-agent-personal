"""Habit edit/archive, buy-list dates, subscriptions & renewals, and the inbox that moves items anywhere (with ownership)."""
import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.subscriptions import add_cycle


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"ls.{uuid.uuid4().hex[:8]}@example.com", "password": "Lists-test-pass-one", "full_name": "L"})
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


def test_add_cycle():
    assert add_cycle(date(2026, 1, 31), "monthly") == date(2026, 2, 28)
    assert add_cycle(date(2026, 11, 30), "quarterly") == date(2027, 2, 28)
    assert add_cycle(date(2026, 3, 1), "yearly") == date(2027, 3, 1)
    assert add_cycle(date(2026, 3, 1), "weekly") == date(2026, 3, 8)


def test_habit_edit_and_archive(client):
    a, b = _user(client), _user(client)
    h = a("POST", "/habits", {"name": "Read", "icon": "📚", "reminder_time": "21:00", "target_per_week": 5}, 201).json()
    assert h["icon"] == "📚" and h["reminder_time"].startswith("21:00") and h["target_per_week"] == 5
    up = a("PATCH", f"/habits/{h['id']}", {"name": "Read 20 pages", "reminder_time": "20:30"}, 200).json()
    assert up["name"] == "Read 20 pages" and up["reminder_time"].startswith("20:30") and up["icon"] == "📚"
    b("PATCH", f"/habits/{h['id']}", {"name": "x"}, 404)
    b("DELETE", f"/habits/{h['id']}", expect=404)
    a("DELETE", f"/habits/{h['id']}", expect=204)
    assert all(x["id"] != h["id"] for x in a("GET", "/habits", expect=200).json())


def test_buy_list_need_by(client):
    a = _user(client)
    day = (date.today() + timedelta(days=3)).isoformat()
    item = a("POST", "/money/buy-list", {"name": "Rice 5kg", "need_by": day}, 201).json()
    assert item["need_by"] == day
    assert a("PATCH", f"/money/buy-list/{item['id']}", {"need_by": None}, 200).json()["need_by"] is None


def test_subscriptions(client):
    a, b = _user(client), _user(client)
    due = (date.today() + timedelta(days=2)).isoformat()
    s = a("POST", "/subscriptions", {"name": "Netflix", "amount": 1500, "currency": "lkr", "cycle": "monthly", "next_due": due, "remind_days": 3}, 201).json()
    assert s["state"] == "due_soon" and s["currency"] == "LKR" and float(s["per_month"]) == 1500
    a("POST", "/subscriptions", {"name": "Insurance", "category": "insurance", "amount": 24000, "cycle": "yearly", "next_due": (date.today() + timedelta(days=200)).isoformat()}, 201)
    ov = a("GET", "/subscriptions", expect=200).json()
    assert float(ov["per_month"]["LKR"]) == 3500 and ov["due_soon"] == 1 and len(ov["due_30_days"]) == 1
    paid = a("POST", f"/subscriptions/{s['id']}/paid", {"record_expense": True}, 200).json()
    assert paid["expense_id"] and paid["subscription"]["next_due"] > due and paid["subscription"]["last_paid_on"]
    task = a("POST", f"/subscriptions/{s['id']}/remind", expect=201).json()
    assert task["task_id"]
    a("PATCH", f"/subscriptions/{s['id']}", {"active": False, "amount": 1700}, 200)
    # ownership
    assert b("GET", "/subscriptions", expect=200).json()["items"] == []
    for method, path, body in [("PATCH", f"/subscriptions/{s['id']}", {"name": "x"}), ("DELETE", f"/subscriptions/{s['id']}", None),
                               ("POST", f"/subscriptions/{s['id']}/paid", {}), ("POST", f"/subscriptions/{s['id']}/remind", None)]:
        b(method, path, body, 404)
    a("DELETE", f"/subscriptions/{s['id']}", expect=204)


def test_inbox_moves_items_anywhere(client):
    a, b = _user(client), _user(client)
    def cap(text):
        return a("POST", "/capture", {"text": text}, 201).json()["id"]
    t = a("POST", f"/capture/{cap('call the bank')}/move", {"target": "task", "priority": "high"}, 200).json()
    assert t["status"] == "moved" and t["moved_to"]["target"] == "task"
    assert any(x["title"] == "call the bank" for x in a("GET", "/tasks", expect=200).json())
    a("POST", f"/capture/{cap('new headphones')}/move", {"target": "wish", "price": 25000, "due_date": "2027-01-10"}, 200)
    assert any(w["name"] == "new headphones" for w in a("GET", "/money/wishlist", expect=200).json())
    a("POST", f"/capture/{cap('milk')}/move", {"target": "buy", "due_date": (date.today() + timedelta(days=1)).isoformat()}, 200)
    assert any(x["name"] == "milk" and x["need_by"] for x in a("GET", "/money/buy-list", expect=200).json())
    a("POST", f"/capture/{cap('Run 5k')}/move", {"target": "goal", "target_value": 5, "unit": "km"}, 200)
    a("POST", f"/capture/{cap('Stretch')}/move", {"target": "habit", "icon": "🧘"}, 200)
    assert any(h["name"] == "Stretch" for h in a("GET", "/habits", expect=200).json())
    m = cap("I prefer studying in the morning")
    a("POST", f"/capture/{m}/move", {"target": "memory", "category": "preference"}, 200)
    a("POST", f"/capture/{m}/move", {"target": "task"}, 409)          # already sorted
    other = cap("secret item")
    b("POST", f"/capture/{other}/move", {"target": "task"}, 404)
    b("DELETE", f"/capture/{other}", expect=404)
    a("DELETE", f"/capture/{other}", expect=204)
