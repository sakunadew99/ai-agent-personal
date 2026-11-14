"""Phase 5: accounts + reconcile, balance view, envelopes, wish list cooling-off, buy list, affordability, time engine."""
import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.entities import WishlistItem
from app.services.money import wish_state
from app.services.time_engine import daily_capacity, planning_multiplier


# ---------- pure rules ----------

def test_wish_state_cooling_off():
    now = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
    row = WishlistItem(status="active", cooling_until=now + timedelta(days=6, hours=1))
    assert wish_state(row, now) == ("waiting", 7)
    row.cooling_until = now - timedelta(seconds=1)
    assert wish_state(row, now) == ("ready", 0)
    row.status = "skipped"
    assert wish_state(row, now) == ("skipped", 0)


def test_planning_multiplier():
    assert planning_multiplier([(30, 45), (60, 80)]) == {"multiplier": 1.0, "sample_size": 2, "enough_data": False}
    assert planning_multiplier([(30, 45), (60, 90), (30, 45)])["multiplier"] == 1.5
    assert planning_multiplier([(10, 300), (10, 300), (10, 300)])["multiplier"] == 3.0   # clamped
    assert planning_multiplier([(0, 30), (30, 0), (30, 30)])["sample_size"] == 1          # ignores bad pairs


def test_daily_capacity():
    cap = daily_capacity(time(7, 0), time(23, 0))          # 16 h awake
    assert cap["waking_minutes"] == 960 and cap["plannable_minutes"] == 960 - 90 - int((960 - 90) * 0.15)
    assert daily_capacity(time(22, 0), time(6, 0))["waking_minutes"] == 480   # night shift crosses midnight


# ---------- API ----------

@pytest.fixture(scope="module")
def api():
    with TestClient(app) as client:
        email = f"p5.{uuid.uuid4().hex[:8]}@example.com"
        r = client.post("/api/v1/auth/register", json={"email": email, "password": "Phase5-test-pass-1", "full_name": "P5"})
        assert r.status_code == 201, r.text
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        def call(method, path, body=None, expect=None):
            resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
            if expect is not None:
                assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
            return resp
        yield call


def D(value) -> Decimal:
    return Decimal(str(value))


def test_accounts_reconcile_and_balance(api):
    bank = api("POST", "/money/accounts", {"name": "BOC savings", "account_type": "savings", "currency": "lkr", "balance": "100000"}, 201).json()
    wallet = api("POST", "/money/accounts", {"name": "Wallet", "account_type": "cash", "currency": "LKR", "balance": "20000.50"}, 201).json()
    api("POST", "/money/accounts", {"name": "Wise", "account_type": "bank", "currency": "EUR", "balance": "300"}, 201)
    assert bank["currency"] == "LKR"
    adj = api("POST", f"/money/accounts/{wallet['id']}/reconcile", {"balance": "18000", "note": "counted cash"}, 201).json()
    assert D(adj["difference"]) == D("-2000.50") and D(adj["previous_balance"]) == D("20000.50")
    history = api("GET", f"/money/accounts/{wallet['id']}/adjustments", expect=200).json()
    assert [h["reason"] for h in history] == ["reconcile", "opening"]
    # A projected bill in the next 30 days counts as committed.
    api("POST", "/finance/expenses", {"amount": "5000", "currency": "LKR", "category": "housing", "record_kind": "projected",
                                     "spent_at": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()}, 201)
    view = {c["currency"]: c for c in api("GET", "/money/balance", expect=200).json()["currencies"]}
    lkr = view["LKR"]
    assert D(lkr["have_now"]) == D("118000.00") and D(lkr["in_savings"]) == D("100000.00")
    assert D(lkr["spendable"]) == D("18000.00") and D(lkr["committed_bills"]) == D("5000.00")
    assert D(lkr["safe_to_spend"]) == D("13000.00")
    assert D(view["EUR"]["have_now"]) == D("300.00")                      # never mixed with LKR
    api("PATCH", f"/money/accounts/{wallet['id']}", {"archived": True}, 200)
    assert all(a["id"] != wallet["id"] for a in api("GET", "/money/accounts", expect=200).json())


def test_envelopes_track_spending(api):
    env = api("POST", "/money/envelopes", {"name": "Fun", "kind": "fun", "currency": "LKR", "monthly_amount": "10000",
                                          "categories": ["shopping"]}, 201).json()
    api("POST", "/money/envelopes", {"name": "Fun", "kind": "fun", "currency": "LKR", "monthly_amount": "1"}, 409)
    api("POST", "/finance/expenses", {"amount": "12500", "currency": "LKR", "category": "shopping"}, 201)
    api("POST", "/finance/expenses", {"amount": "999", "currency": "USD", "category": "shopping"}, 201)   # other currency ignored
    status = next(e for e in api("GET", "/money/envelopes", expect=200).json() if e["id"] == env["id"])
    assert D(status["spent"]) == D("12500.00") and D(status["left"]) == D("-2500.00") and status["over"] is True


def test_wishlist_cooling_affordability_and_buy(api):
    wish = api("POST", "/money/wishlist", {"name": "Headphones", "price": "8000", "currency": "LKR", "cooling_days": 7}, 201).json()
    assert wish["state"] == "waiting" and wish["days_left"] == 7
    now_ready = api("POST", "/money/wishlist", {"name": "Book", "price": "1500", "currency": "LKR", "cooling_days": 0}, 201).json()
    assert now_ready["state"] == "ready"
    api("PATCH", f"/money/wishlist/{wish['id']}", {"price": "7500"}, 200)
    prices = api("GET", f"/money/wishlist/{wish['id']}/prices", expect=200).json()
    assert [D(p["price"]) for p in prices] == [D("8000.00"), D("7500.00")]
    check = api("GET", f"/money/wishlist/{wish['id']}/affordability", expect=200).json()
    assert check["decision"] == "yours" and D(check["price"]) == D("7500.00")
    assert D(check["safe_after"]) == D(check["safe_to_spend"]) - D("7500")
    assert any("Cooling-off" in line for line in check["lines"])
    bought = api("POST", f"/money/wishlist/{now_ready['id']}/decide", {"action": "bought", "amount": "1400"}, 200).json()
    assert bought["state"] == "bought" and bought["expense_id"]
    api("POST", f"/money/wishlist/{wish['id']}/decide", {"action": "skipped"}, 200)
    assert api("GET", "/money/wishlist", expect=200).json() == []
    assert len(api("GET", "/money/wishlist?include_closed=true", expect=200).json()) == 2
    no_price = api("POST", "/money/wishlist", {"name": "Trip", "currency": "LKR"}, 201).json()
    api("GET", f"/money/wishlist/{no_price['id']}/affordability", expect=422)


def test_buy_list_checkout_and_restock(api):
    rice = api("POST", "/money/buy-list", {"name": "Rice", "qty": "5", "unit": "kg", "est_price": "1200", "currency": "LKR", "staple": True}, 201).json()
    eggs = api("POST", "/money/buy-list", {"name": "Eggs", "est_price": "600", "currency": "LKR"}, 201).json()
    result = api("POST", "/money/buy-list/checkout", {"item_ids": [rice["id"], eggs["id"]], "currency": "LKR"}, 200).json()
    assert D(result["amount"]) == D("1800.00") and result["expense_id"] and result["checked"] == 2
    items = {i["name"]: i for i in api("GET", "/money/buy-list", expect=200).json()}
    assert items["Rice"]["checked_at"] and items["Rice"]["expense_id"] == result["expense_id"]
    assert api("POST", "/money/buy-list/restock", expect=200).json() == {"restocked": 1}
    items = {i["name"]: i for i in api("GET", "/money/buy-list", expect=200).json()}
    assert items["Rice"]["checked_at"] is None and items["Eggs"]["checked_at"] is not None
    api("POST", "/money/buy-list/checkout", {"item_ids": [str(uuid.uuid4())], "currency": "LKR"}, 404)


def test_time_insights(api):
    # Three finished tasks that took 1.5x their estimate, timed with focus sessions.
    for i in range(3):
        task = api("POST", "/tasks", {"title": f"Write report {i}", "duration_minutes": 40}, 201).json()
        session = api("POST", "/focus/sessions", {"minutes": 60, "task_id": task["id"]}, 201).json()
        from app.core.database import SessionLocal
        from app.models.entities import FocusSession
        with SessionLocal() as db:  # make the session exactly 60 minutes long
            row = db.get(FocusSession, uuid.UUID(session["id"]))
            row.started_at = datetime.now(timezone.utc) - timedelta(minutes=60)
            row.ended_at = datetime.now(timezone.utc)
            db.commit()
        api("PATCH", f"/tasks/{task['id']}/complete", expect=200)
    api("POST", "/tasks", {"title": "Huge job", "priority": "high", "duration_minutes": 1440,
                          "due_at": (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()}, 201)
    data = api("GET", "/time/insights", expect=200).json()
    assert data["multiplier"] == {"multiplier": 1.5, "sample_size": 3, "enough_data": True}
    assert data["top3"][0]["title"] == "Huge job" and data["top3"][0]["adjusted_minutes"] == 2160
    kinds = {w["kind"] for w in data["warnings"]}
    assert "overbooked" in kinds and "deadline_risk" in kinds
    assert len(data["days"]) == 7
