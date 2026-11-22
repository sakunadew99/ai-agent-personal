import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import wealth


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"wl.{uuid.uuid4().hex[:8]}@example.com", "password": "Wealth-test-pass-one", "full_name": "W"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_projection_matches_hand_calculation():
    # no return, no growth: 1,000 a month reaches 12,000 in exactly 12 months
    assert wealth.project(0, 1000, 0, 0, 12000)["months_to_target"] == 12
    # 12% a year = 1% a month: 10,000 with no saving grows to 10,000 * 1.01^12 after one year
    p = wealth.project(10000, 0, 12, 0, 10**9, years=1)
    assert p["path"][1]["value"] == round(10000 * 1.01 ** 12)
    # savings growing 10% a year: year 2 adds 12 * 1,100
    assert wealth.project(0, 1000, 0, 10, 10**9, years=2)["path"][2]["value"] == 12000 + 13200
    assert wealth.project(0, 0, 0, 0, 1000)["months_to_target"] is None                      # never reached


def test_needed_monthly_is_just_enough():
    need = wealth.needed_monthly(0, 1_000_000, 20, 8, 7)
    assert wealth.project(0, need, 8, 7, 1_000_000, 20)["months_to_target"] <= 240
    assert wealth.project(0, need * 0.97, 8, 7, 1_000_000, 20)["months_to_target"] > 240
    assert wealth.needed_monthly(0, 120, 1, 0, 0) == pytest.approx(10, abs=0.01)


def test_million_uses_my_money_and_rate_and_is_private():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        assert a("POST", "/money/accounts", {"name": "Savings", "currency": "LKR", "balance": 3000000}).status_code == 201
        m = a("GET", "/money/million?usd_lkr=300&monthly_saving_lkr=60000").json()
        assert m["current_usd"] == pytest.approx(10000) and m["monthly_saving_usd"] == pytest.approx(200) and m["rate_source"] == "your rate"
        assert [s["key"] for s in m["scenarios"]] == ["conservative", "realistic", "ambitious"]
        years = [s["years_to_target"] for s in m["scenarios"]]
        assert years[0] > years[1] > years[2]                                                  # better assumptions, sooner
        assert next(x for x in m["milestones"] if x["label"] == "$10k")["reached"] is True and m["disclaimer"]
        assert b("GET", "/money/million?usd_lkr=300").json()["current_usd"] == 0


def test_opportunities_rank_by_my_skills_time_and_budget():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        a("PUT", "/career/profile", {"headline": "Data scientist", "skills": ["Python", "SQL", "Power BI", "FastAPI", "RAG", "LLM"]})
        o = a("GET", "/opportunities?hours=10&budget_lkr=5000").json()
        top = [x["id"] for x in o["items"][:3]]
        assert "data_freelance" in top or "ai_automation" in top
        assert all(0 <= x["fit"] <= 100 for x in o["items"]) and o["items"] == sorted(o["items"], key=lambda x: -x["fit"])
        saas = next(x for x in o["items"] if x["id"] == "saas")
        assert "Within your starting budget" not in saas["why"]                                # costs 20,000 > 5,000
        assert all("not a promise" in x["income"] or "Indirect" in x["income"] for x in o["items"])
        assert b("GET", "/opportunities").json()["known_skills"] == []                          # private
