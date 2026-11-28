"""Money plan: setup with salary, boarding and a credit card; debt advice; payday split; streams; sprint; money hour; check-in;
afford / $1M answers; idea check with scam signs; ownership on every new route."""
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.main import app

TZ = ZoneInfo("Asia/Colombo")
SETUP = {"salary": 100000, "currency": "LKR", "payday": 25, "fixed": {"boarding": 6500}, "food_transport": 30000,
         "debts": [{"name": "Credit card", "balance": 40000}]}


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"mp.{uuid.uuid4().hex[:8]}@example.com", "password": "Money-test-pass-one", "full_name": "M"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_setup_debt_payday_roadmap_and_snapshot():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        v = a("POST", "/money/setup", SETUP).json()
        assert v["setup_done"] and v["income_month"] == 100000 and v["needs_month"] == 36500
        d = v["debt"]
        assert d["debts"][0]["apr_assumed"] and d["debts"][0]["apr_pct"] == 28 and "clear all LKR 40,000 this month" in d["advice"]
        labels = [p["label"] for p in v["payday"]["parts"]]
        assert "debt (extra)" in labels and v["payday"]["free_after_needs"] == 61500           # high-interest debt first
        assert [p["phase"] for p in v["roadmap"]] == ["This month", "Months 1-3", "Months 3-6", "Months 6-12", "Years 1-3"]
        assert v["net_worth"]["history"][-1]["net_worth"] == -40000 and v["emergency"]["status"] == "start"
        assert len(v["milestones"]) == 9 and v["skills"]["salary_ladder"]
        envs = a("GET", "/money/envelopes").json() if a("GET", "/money/envelopes").status_code == 200 else None
        assert envs is None or any(e["name"] == "Needs" for e in (envs if isinstance(envs, list) else envs.get("envelopes", [])))
        # B sees nothing of A
        vb = b("GET", "/money/plan").json()
        assert not vb["setup_done"] and vb["debt"]["debts"] == []
        # set the real card rate and minimum; another user can't change it
        lid = d["debts"][0]["id"]
        assert b("PATCH", f"/finance/liabilities/{lid}", {"apr_pct": 1}).status_code == 404
        r = a("PATCH", f"/finance/liabilities/{lid}", {"apr_pct": 26, "min_payment": 2000, "due_day": 5}).json()
        assert r["apr_pct"] == 26 and r["due_day"] == 5
        assert not a("GET", "/money/plan").json()["debt"]["debts"][0]["apr_assumed"]
        assert b("DELETE", f"/finance/liabilities/{lid}").status_code == 404


def test_debt_payoff_avalanche_vs_minimums():
    from app.services.money_plan import payoff
    debts = [{"name": "Card", "balance": 200000, "apr_pct": 28, "min_payment": 10000}, {"name": "Loan", "balance": 100000, "apr_pct": 14, "min_payment": 5000}]
    av, mn = payoff(debts, 40000, "avalanche"), payoff(debts, 15000, "avalanche")
    assert av["ok"] and av["months"] < mn["months"] and av["interest"] < mn["interest"] and av["order"][0] == "Card"
    assert payoff(debts, 40000, "snowball")["order"][0] == "Loan"


def test_streams_hours_sprint_money_hour_checkin_and_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        a("POST", "/money/setup", SETUP)
        s = a("POST", "/money/streams", {"name": "Power BI gigs", "kind": "freelance"}).json()
        assert a("POST", "/money/streams", {"name": "Power BI gigs"}).status_code == 409
        assert b("POST", f"/money/streams/{s['id']}/logs", {"minutes": 60}).status_code == 404
        assert b("PATCH", f"/money/streams/{s['id']}", {"status": "paused"}).status_code == 404
        a("POST", f"/money/streams/{s['id']}/logs", {"minutes": 240, "earned": 8000})
        st = a("GET", "/money/plan").json()["streams"]["streams"][0]
        assert st["per_hour"] == 2000 and st["verdict"].startswith("scale")
        assert b("GET", "/money/streams").json() == []
        sp = a("POST", "/money/sprint", {"idea_id": "data_freelance"}).json()
        assert sp["week_now"] == 1 and len(sp["weeks"]) == 13 and "3 sample" in sp["weeks"][0]["goal"]
        assert a("PATCH", "/money/sprint/week", {"week": 1, "done": True}).json()["done_count"] == 1
        assert b("PATCH", "/money/sprint/week", {"week": 1}).status_code == 404
        t = a("POST", "/money/money-hour", {"weekday": "SA", "time": "10:00"}).json()
        task = next(x for x in a("GET", "/tasks").json() if x["id"] == t["id"])
        assert task["title"].startswith("💰 Money hour") and "BYDAY=SA" in task["recurrence"]
        c = a("POST", "/money/checkin", {"spent": 1200, "income_action": True}).json()
        assert c["done_today"] and c["streak"] == 1 and c["income_actions_week"] == 1
        assert not b("GET", "/money/plan").json()["checkin"]["done_today"]
        assert a("DELETE", f"/money/streams/{s['id']}").status_code == 204


def test_afford_million_scam_and_idea_check():
    with TestClient(app) as client:
        a = _user(client)
        a("POST", "/money/setup", SETUP)
        ans = a("GET", "/money/afford?price=150000").json()["answer"]
        assert ans.startswith("Not yet") and "high-interest debt" in ans
        chat = a("POST", "/chat", {"message": "Can I afford a phone for 150k?"}).json()["reply"]
        assert "Not yet" in chat
        r = a("POST", "/chat", {"message": "How do I reach $1M in 15 years?"}).json()["reply"]
        assert "a month to start" in r and "LKR" in r
        r = a("POST", "/chat", {"message": "should I join this investment plan with guaranteed returns and recruit 5 people"}).json()["reply"]
        assert "scam" in r.lower()
        v = a("POST", "/money/validate", {"idea": "Forex signals group with guaranteed profit, pay a fee to join", "cost_lkr": 20000, "hours_week": 2}).json()
        assert v["verdict"] == "weak or risky" and v["warnings"]
        good = a("POST", "/money/validate", {"idea": "Power BI dashboards for small business clients online", "cost_lkr": 0, "hours_week": 8}).json()
        assert good["score"] > v["score"] and not good["warnings"]
        week = a("GET", "/review/week").json()["money"]
        assert week["debt"] == 40000 and "statement in full" in week["focus"]
        assert datetime.now(TZ)
