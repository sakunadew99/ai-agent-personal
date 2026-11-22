import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.services import body, nutrition, wealth


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"rbm.{uuid.uuid4().hex[:8]}@example.com", "password": "Rbm-test-pass-one", "full_name": "R"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_roadmap_checkpoints_follow_the_projection():
    r = wealth.roadmap(0, 100, 300, 1_000_000, 15)
    assert [s["year"] for s in r["steps"]] == [1, 3, 5, 10]
    path = {p["year"]: p["value"] for p in wealth.project(0, r["needed_monthly_usd"], 8.0, 7.0, 1_000_000, 10)["path"]}
    assert all(s["on_track_usd"] == path[s["year"]] for s in r["steps"])
    assert all(s["status"] == "behind" and s["gap_usd"] > 0 for s in r["steps"])               # $100/month is far from $1M in 15 years
    assert r["steps"][0]["on_track_lkr"] == round(r["steps"][0]["on_track_usd"] * 300)
    assert r["steps"][3]["save_per_month_usd"] > r["steps"][0]["save_per_month_usd"]           # savings grow every year
    rich = wealth.roadmap(0, r["needed_monthly_usd"] * 1.1, 300, 1_000_000, 15)
    assert all(s["status"] == "on track" for s in rich["steps"])


def test_million_api_has_roadmap_and_income_ideas_have_risk_fields():
    with TestClient(app) as client:
        a = _user(client)
        m = a("GET", "/money/million?monthly_saving_lkr=60000&usd_lkr=300&target_years=20").json()
        assert m["roadmap"]["target_years"] == 20 and len(m["roadmap"]["steps"]) == 4
        assert a("GET", "/money/million?target_years=1").status_code == 422
        o = a("GET", "/opportunities").json()
        first = o["items"][0]
        assert {"competition", "learn_weeks", "first_income_weeks", "risk"} <= set(first)
        assert "saas" in o["high_risk"] and "tutoring" in o["beginner"]


def test_meal_plan_respects_allergies_and_uses_what_you_have():
    plan = nutrition.week_plan(70, "maintain", allergies=["peanut", "egg", "milk"], have=["chickpeas", "rice"])
    used = {i["key"] for d in plan["days"] for m in d["meals"] for i in m["items"]}
    assert not used & (nutrition.ALLERGENS["peanut"] | nutrition.ALLERGENS["egg"] | nutrition.ALLERGENS["milk"])
    assert plan["allergy_note"] and "Chickpeas (kadala)" in plan["using_from_home"]
    assert any(s["at_home"] for s in plan["shopping"])
    coconut = nutrition.week_plan(70, "maintain", allergies=["coconut", "fish"])
    used = {i["key"] for d in coconut["days"] for m in d["meals"] for i in m["items"]}
    assert not used & (nutrition.ALLERGENS["coconut"] | nutrition.ALLERGENS["fish"])
    with TestClient(app) as client:
        a = _user(client)
        assert a("POST", "/nutrition/plan", {"weight_kg": 70, "allergies": ["shellfish"]}).status_code == 422
        r = a("POST", "/nutrition/plan", {"weight_kg": 70, "allergies": ["soy"], "have": ["eggs"]}).json()
        assert "Boiled egg" in r["using_from_home"]


def test_navy_formula_matches_reference_values():
    assert abs(body.navy_body_fat("male", 178, 86, 38, None) - 17.4) < 0.6          # reference ≈ 17 %
    assert abs(body.navy_body_fat("female", 165, 76, 33, 100) - 29.7) < 0.8
    assert body.navy_body_fat("male", 178, 30, 38, None) is None and body.navy_body_fat(None, 178, 86, 38, None) is None


def test_body_measurements_flow_and_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        assert a("POST", "/body/measurements", {}).status_code == 422
        old = (date.today() - timedelta(days=40)).isoformat()
        a("POST", "/body/measurements", {"measured_on": old, "weight_kg": 80, "waist_cm": 92, "neck_cm": 38})
        r = a("POST", "/body/measurements", {"weight_kg": 79.6, "waist_cm": 88}).json()
        same = a("POST", "/body/measurements", {"neck_cm": 38}).json()                         # same day -> same row, merged
        assert same["id"] == r["id"] and same["waist_cm"] == 88 and same["neck_cm"] == 38
        assert a("POST", "/body/measurements", {"measured_on": (date.today() + timedelta(days=2)).isoformat(), "weight_kg": 70}).status_code == 422
        ov = a("GET", "/body").json()
        assert ov["changes"]["waist_cm"]["since_start"] == -4 and ov["changes"]["waist_cm"]["since_month"] == -4
        assert any("muscle" in i for i in ov["insights"]) and ov["body_fat_estimate"] is None and ov["missing_for_fat"]
        assert a("PUT", "/body/profile", {"height_cm": 178, "sex": "male"}).json()["height_cm"] == 178
        ov = a("GET", "/body").json()
        assert ov["waist_to_height"] == round(88 / 178, 2) and ov["body_fat_estimate"] and "Navy" in ov["body_fat_method"]
        assert b("GET", "/body").json()["items"] == []
        assert b("DELETE", f"/body/measurements/{r['id']}").status_code == 404
        assert a("DELETE", f"/body/measurements/{r['id']}").status_code == 204
