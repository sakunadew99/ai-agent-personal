import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import exercises, nutrition


def test_targets_mifflin_and_simple():
    t = nutrition.targets(78, "lose", 172, 27, "male")
    bmr = 10 * 78 + 6.25 * 172 - 5 * 27 + 5
    assert t["maintenance_kcal"] == round(bmr * 1.45) and t["kcal"] == round(bmr * 1.45 - 450) and t["method"] == "Mifflin-St Jeor"
    assert nutrition.targets(70, "maintain") == {"kcal": 2100, "protein_g": 84, "maintenance_kcal": 2100, "method": "about 30 kcal per kg"}
    low = nutrition.targets(50, "lose")                                          # 1,500 - 450 would be 1,050: kept at a safe floor
    assert low["kcal"] == 1400 and "floor_note" in low and nutrition.targets(50, "lose", 160, 30, "female")["kcal"] >= 1200
    assert nutrition.targets(70, "gain")["protein_g"] == 112


@pytest.mark.parametrize("weight,goal,diet", [(78, "lose", []), (65, "gain", ["vegetarian"]), (90, "maintain", ["no_egg"]), (55, "lose", ["pescatarian"])])
def test_week_plan_hits_targets(weight, goal, diet):
    p = nutrition.week_plan(weight, goal, diet=diet)
    t = p["targets"]
    assert abs(p["avg_kcal"] - t["kcal"]) <= t["kcal"] * 0.08                   # weekly average within 8% of the calorie target
    assert p["avg_protein_g"] >= t["protein_g"] - 6                             # protein close to (or above) target
    assert all(abs(d["kcal"] - t["kcal"]) <= t["kcal"] * 0.15 for d in p["days"])
    assert len(p["days"]) == 7 and p["shopping"] and p["week_cost_lkr"] == sum(d["cost_lkr"] for d in p["days"])
    banned = set().union(*(nutrition.EXCLUDE[x] for x in diet)) if diet else set()
    assert not any(nutrition.FOODS[i["key"]][5] & banned for d in p["days"] for m in d["meals"] for i in m["items"])


def test_budget_makes_it_cheaper_and_is_honest():
    free, tight = nutrition.week_plan(78, "lose"), nutrition.week_plan(78, "lose", budget_lkr_day=900)
    assert tight["avg_day_cost_lkr"] < free["avg_day_cost_lkr"]
    over = [d for d in tight["days"] if d["within_budget"] is False]
    assert (tight["budget_note"] is not None) == bool(over)
    roomy = nutrition.week_plan(78, "lose", budget_lkr_day=2000)
    assert all(d["within_budget"] for d in roomy["days"]) and roomy["budget_note"] is None


def test_exercise_library_and_plans():
    assert len(exercises.EXERCISES) >= 25
    for e in exercises.EXERCISES:
        assert e["muscles"] and e["technique"] and e["mistakes"] and e["easier"] and e["video_search"].startswith("https://www.youtube.com/results?search_query=")
    for p in exercises.PLANS.values():                                          # every planned exercise exists in the library
        assert all(n in exercises.BY_NAME for w in p["workouts"].values() for n in w)
    assert {e["name"] for e in exercises.library(muscle="chest")} >= {"Bench press", "Push-up"}
    assert all(e["equipment"] == "none" for e in exercises.library(equipment="none"))
    assert exercises.today("full_body", 1)["workout"] == "A" and exercises.today("full_body", 2)["rest_day"] is True


def test_routes_need_sign_in_and_validate():
    with TestClient(app) as client:
        assert client.post("/api/v1/nutrition/plan", json={"weight_kg": 70}).status_code == 401
        r = client.post("/api/v1/auth/register", json={"email": f"nx.{uuid.uuid4().hex[:8]}@example.com", "password": "Meal-test-pass-one", "full_name": "N"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        assert client.post("/api/v1/nutrition/plan", headers=h, json={"weight_kg": 70, "goal": "gain", "diet": ["vegetarian"]}).json()["targets"]["kcal"] == 2400
        assert client.post("/api/v1/nutrition/plan", headers=h, json={"weight_kg": 5}).status_code == 422
        assert client.post("/api/v1/nutrition/plan", headers=h, json={"weight_kg": 70, "diet": ["carnivore"]}).status_code == 422
        assert client.get("/api/v1/exercises?muscle=back", headers=h).json()["items"]
        assert "exercises" in client.get("/api/v1/exercises/today?plan=home", headers=h).json()
