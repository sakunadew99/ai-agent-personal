import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.services import roleplay


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"rp.{uuid.uuid4().hex[:8]}@example.com", "password": "Role-test-pass-one", "full_name": "R"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_rubric_rewards_good_negotiation_and_penalises_blame():
    sc = roleplay.BY_ID["salary"]
    good = [{"role": "them", "text": sc["opening"]},
            {"role": "user", "text": "Thank you for the time. This year I delivered the churn model that reduced cancellations by 12%, "
                                     "and market data for my role shows a 20% gap. I'd like to discuss a 20% raise. What would make that possible?"},
            {"role": "user", "text": "I understand budgets are tight. If 20% is hard now, could we do 12% now and a review in six months?"}]
    weak = [{"role": "them", "text": sc["opening"]}, {"role": "user", "text": "I want more money, whatever."}]
    g, w = roleplay.score(sc, good), roleplay.score(sc, weak)
    assert g["score"] >= 90 and all(c["ok"] for c in g["criteria"])
    assert w["score"] < 30 and w["tips"]


def test_every_scenario_is_complete():
    for sc in roleplay.SCENARIOS:
        assert sc["opening"] and len(sc["script"]) >= 3 and sum(p for _, _, p in sc["rubric"]) == 100, sc["id"]


def test_roleplay_flow_logs_skill_practice_and_is_private():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        sid = a("POST", "/skills", {"name": "Leadership", "category": "soft"}).json()["skills"][0]["id"]
        cat = a("GET", "/roleplay").json()
        assert len(cat["scenarios"]) == 12 and cat["ai_partner"] is False
        s = a("POST", "/roleplay", {"scenario": "late_teammate"}).json()
        assert s["messages"][0]["role"] == "them" and s["rubric"]
        assert b("POST", f"/roleplay/{s['id']}/reply", {"text": "hi"}).status_code == 404
        assert a("POST", f"/roleplay/{s['id']}/finish").status_code == 422                       # reply first
        r1 = a("POST", f"/roleplay/{s['id']}/reply", {"text": "Hi Kasun, how are you? Is everything ok? I noticed the last tasks slipped."}).json()
        assert r1["messages"][-1]["role"] == "them" and r1["messages"][-1]["text"] == roleplay.BY_ID["late_teammate"]["script"][0]
        a("POST", f"/roleplay/{s['id']}/reply", {"text": "I understand. Let me talk to the other leads and take one project off your plate. Can we agree the report by Friday?"})
        fin = a("POST", f"/roleplay/{s['id']}/finish?ai=true").json()
        assert fin["score"] >= 70 and fin["ai"] is None and fin["criteria"]
        assert a("POST", f"/roleplay/{s['id']}/reply", {"text": "more"}).status_code == 409              # finished
        cat = a("GET", "/roleplay").json()
        assert next(x for x in cat["scenarios"] if x["id"] == "late_teammate")["best"] == fin["score"]
        assert next(k for k in cat["skills"] if k["skill"] == "leadership")["done"] == 1
        sk = next(k for k in a("GET", "/skills").json()["skills"] if k["id"] == sid)
        assert sk["recent"][0]["metrics"]["kind"] == "roleplay"
        assert all(x["attempts"] == 0 for x in b("GET", "/roleplay").json()["scenarios"])
        assert b("POST", f"/roleplay/{s['id']}/finish").status_code == 404
        assert a("POST", "/roleplay", {"scenario": "nope"}).status_code == 404
