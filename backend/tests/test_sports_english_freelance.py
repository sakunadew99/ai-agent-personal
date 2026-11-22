import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.services import english, freelance, travel


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"sef.{uuid.uuid4().hex[:8]}@example.com", "password": "Sef-test-pass-one", "full_name": "S"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_sports_pathways():
    with TestClient(app) as client:
        a = _user(client)
        keys = {s["key"] for s in a("GET", "/sports").json()["sports"]}
        assert {"karate", "kickboxing", "muay_thai", "boxing", "swimming"} <= keys
        p = a("GET", "/sports/muay_thai?city=Kandy").json()
        assert len(p["stages"]) == 4 and p["links"]["find_near_you"].startswith("https://www.google.com/maps/search/") and "Kandy" in p["links"]["find_near_you"]
        day_one = [e for e in p["equipment"] if e["needed_from_day_one"]]
        assert p["first_month_cost_lkr"]["min"] == sum(e["lkr_min"] for e in day_one) + p["monthly_fee_lkr"]["min"]
        assert any("doctor" in s for s in p["safety"]) and p["goal_plan"]["title"] == "Learn Muay Thai"
        assert a("GET", "/sports/sumo").status_code == 404
        assert client.get("/api/v1/sports").status_code == 401


def test_travel_safety_is_sourced_not_scored():
    sl = travel.plan("ella", 3, "budget", 2, 300)
    s = sl["safety"]
    assert {"label": "Police", "number": "119"} in s["emergency"] and s["official_advice"].startswith("https://www.gov.uk/foreign-travel-advice/")
    assert s["checked"] and "FCDO" in s["method"] and "score" not in s
    assert sl["stay_type"]["label"] == "Budget" and set(sl["stay_types"]) == {"budget", "mid", "luxury"}
    jp = travel.plan("japan", 5, "mid", 1, 300)["safety"]
    assert jp["country"] == "Japan" and {"label": "Fire & ambulance", "number": "119"} in jp["emergency"]


def test_english_offline_rules_and_corrected_text():
    out = english.check("i didn't went to a university since 3 years and he don't know . we discuss about it it")
    msgs = " ".join(i["message"] for i in out["issues"])
    assert "capital" in msgs and "base verb" in msgs and "'for'" in msgs and "doesn't" in msgs and "Repeated" in msgs
    assert not any(i["text"] == "a" and "an" == i["suggestion"] for i in out["issues"])          # "a university" is correct
    c = out["corrected"]
    assert c.startswith("I didn't go") and "for 3 years" in c and "he doesn't know." in c and "discuss it" in c
    assert english.check("I waited for an hour and ate a apple.")["corrected"] == "I waited for an hour and ate an apple."


def test_english_deep_check_merges_and_falls_back(monkeypatch):
    with TestClient(app) as client:
        a = _user(client)
        r = a("POST", "/english/check", {"text": "She go to school every days.", "deep": True}).json()
        assert r["note"] and r["deep"] is True                                                    # network blocked in tests -> rules only
        monkeypatch.setattr(english, "_http", lambda text, lang: {"matches": [
            {"offset": 4, "length": 2, "message": "Use 'goes' with 'she'.", "replacements": [{"value": "goes"}], "rule": {"category": {"name": "Grammar"}}}]})
        r = a("POST", "/english/check", {"text": "She go to school every day.", "deep": True}).json()
        assert r["corrected"] == "She goes to school every day." and r["issues"][0]["source"] == "languagetool" and r["note"] is None
        assert a("POST", "/english/check", {"text": ""}).status_code == 422


def test_freelance_estimate_math_and_proposal_draft():
    e = freelance.estimate(10, 20, "beginner", "fiverr", "simple", 0, 300.0, buffer_pct=0)
    assert e["you_receive_usd"] == 200 and e["price_usd"] == 250 and e["price_lkr"] == 75000 and e["platform_fee_pct"] == 20
    d = freelance.estimate(10, 20, "beginner", "direct", "complex", 2, 300.0, buffer_pct=10)
    assert d["hours"] == round((10 * 1.6 + 1.5) * 1.1, 1) and d["price_usd"] == d["you_receive_usd"]
    with TestClient(app) as client:
        a = _user(client)
        assert a("POST", "/freelance/estimate", {"hours": 5, "platform": "ebay"}).status_code == 422
        r = a("POST", "/freelance/estimate", {"hours": 5}).json()
        assert r["packages_usd"]["basic"] < r["packages_usd"]["premium"]
        p = a("POST", "/freelance/proposal", {"job": "Need a Power BI dashboard for sales data from Excel", "skills": ["Power BI", "SQL", "Excel"],
                                              "name": "Sakuna", "days": 3, "price_usd": 60}).json()
        assert "Power BI" in p["matched_skills"] and "within 3 days" in p["text"] and "$60" in p["text"] and p["text"].endswith("Sakuna")
        assert any("send it yourself" in c for c in p["checklist"])


def test_sports_goal_plan_is_accepted_as_a_goal():
    with TestClient(app) as client:
        a = _user(client)
        plan = a("GET", "/sports/swimming").json()["goal_plan"]
        r = a("POST", "/dreams/accept", plan)
        assert r.status_code == 201, r.text
        assert any(g["title"] == "Learn Swimming" for g in a("GET", "/goals").json())
