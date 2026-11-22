import uuid
from datetime import date

from fastapi.testclient import TestClient

from app.main import app
from app.services import content, travel


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"ct.{uuid.uuid4().hex[:8]}@example.com", "password": "Create-test-pass-one", "full_name": "C"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_sri_lanka_budget_adds_up_exactly():
    p = travel.plan("ella", 3, "budget", 2, 300)
    b = p["budget_lkr"]
    assert b["transport_to_and_back"] == round(2 * 6.5 * 400 * 2)                 # both ways, per person per hour
    assert b["stay"] == 7000 * 2 * 1                                              # 2 nights, 1 room for 2 people
    assert b["food"] == 2500 * 3 * 2 and b["local_transport"] == 1500 * 3 * 2
    assert b["total"] == sum(v for k, v in b.items() if k != "total") and p["per_person_lkr"] == round(b["total"] / 2)
    assert p["itinerary"][0]["plan"][0].startswith("Travel from Colombo") and p["itinerary"][-1]["plan"][-1] == "Travel back to Colombo"
    assert p["maps"]["directions"].startswith("https://www.google.com/maps/dir/?api=1&origin=Colombo&destination=6.8667,81.0466")
    one = travel.plan("kandy", 1, "mid", 3, 300)
    assert one["nights"] == 0 and one["budget_lkr"]["stay"] == 0 and one["rooms"] == 2


def test_abroad_uses_flights_rate_and_official_advice():
    p = travel.plan("japan", 7, "mid", 1, 300)
    assert p["budget_usd"] == {"flights": 900, "stay_food_transport_activities": 150 * 7, "total": 900 + 1050}
    assert p["total_lkr"] == 1950 * 300 and p["advisory"] == "https://www.gov.uk/foreign-travel-advice/japan"
    assert p["local_currency"]["code"] == "JPY" and p["local_currency"]["note"] == "approximate reference rate"


def test_destinations_filter_by_month_and_interest():
    may = travel.destinations(5)
    good = [d for d in may if d["good_now"]]
    assert {d["key"] for d in good} >= {"trincomalee", "arugam_bay"} and "mirissa" not in {d["key"] for d in good}
    assert all("beach" in d["tags"] for d in travel.destinations(5, "beach"))
    assert may.index(next(d for d in may if d["key"] == "trincomalee")) < may.index(next(d for d in may if d["key"] == "mirissa"))


def test_content_ideas_use_my_topics_and_flow_is_private():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        a("POST", "/skills", {"name": "Kickboxing", "category": "fight"})
        ov = a("GET", "/content").json()
        assert "Kickboxing" in ov["topics"] and len(ov["ideas"]) == 8 and len(ov["schedule"]) == 4
        item = a("POST", "/content", {"title": "3 mistakes I made learning Kickboxing", "platform": "short", "topic": "Kickboxing"}).json()
        assert item["status"] == "idea" and "HOOK" in item["script"]
        assert a("POST", f"/content/{item['id']}/script").status_code == 503                     # no AI key: template stays
        up = a("PATCH", f"/content/{item['id']}", {"status": "published", "url": "https://youtube.com/shorts/x"}).json()
        assert up["published_on"] is not None and a("GET", "/content").json()["stats"]["published_this_week"] == 1
        assert a("PATCH", f"/content/{item['id']}", {"url": "javascript:alert(1)"}).status_code == 422
        assert b("GET", "/content").json()["items"] == []
        assert b("PATCH", f"/content/{item['id']}", {"status": "idea"}).status_code == 404
        assert b("DELETE", f"/content/{item['id']}").status_code == 404
        assert a("DELETE", f"/content/{item['id']}").status_code == 204


def test_travel_routes_and_wish_list_privacy():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        ov = a("GET", "/travel?month=1").json()
        assert ov["destinations"] and ov["wishes"] == []
        assert a("GET", "/travel/plan?key=ella&days=3&tier=budget&people=2&usd_lkr=300").json()["budget_lkr"]["total"] > 0
        assert a("GET", "/travel/plan?key=atlantis").status_code == 404
        w = a("POST", "/travel/wishes", {"destination": "Ella", "key": "ella", "days": 3, "people": 2}).json()
        assert a("PATCH", f"/travel/wishes/{w['id']}", {"status": "planned", "planned_on": date(2027, 2, 14).isoformat()}).json()["status"] == "planned"
        assert b("GET", "/travel").json()["wishes"] == []
        assert b("PATCH", f"/travel/wishes/{w['id']}", {"status": "done"}).status_code == 404
        assert b("DELETE", f"/travel/wishes/{w['id']}").status_code == 404
        a("PATCH", f"/travel/wishes/{w['id']}", {"status": "done"})
        assert a("GET", "/travel").json()["done"] == 1
        assert a("POST", "/travel/wishes", {"destination": "X", "tier": "platinum"}).status_code == 422


def test_script_template_has_every_part():
    t = content.script_template("Title", "linkedin", "AI")
    for part in ("HOOK", "PROBLEM", "POINT 1", "PROOF", "CALL TO ACTION", "120-200 words"):
        assert part in t
