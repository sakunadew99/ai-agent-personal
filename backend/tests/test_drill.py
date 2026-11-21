import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.services.speaking import compare_speech


def test_compare_speech_forgives_umlauts_and_marks_missed_words():
    r = compare_speech("Ich möchte einen Kaffee, bitte.", "ich mochte einen kaffee bitte")
    assert r["accuracy"] == 100 and all(w["ok"] for w in r["words"])
    r = compare_speech("Wo ist der Bahnhof?", "wo ist der banhof")
    assert r["accuracy"] == 75 and [w["word"] for w in r["words"] if not w["ok"]] == ["Bahnhof?"] and "Bahnhof" in r["tip"]
    assert compare_speech("Guten Morgen", "")["accuracy"] == 0


def test_drill_routes_use_my_cards_and_are_private():
    with TestClient(app) as client:
        def user():
            r = client.post("/api/v1/auth/register", json={"email": f"dr.{uuid.uuid4().hex[:8]}@example.com", "password": "Drill-test-pass-one", "full_name": "D"})
            h = {"Authorization": f"Bearer {r.json()['access_token']}"}
            return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))
        a, b = user(), user()
        a("POST", "/learning/cards", {"deck": "german", "front": "der Apfel ist rot", "back": "the apple is red"})
        ph = a("GET", "/speaking/drill?lang=de").json()["phrases"]
        assert ph[0] == {"text": "der Apfel ist rot", "meaning": "the apple is red", "from": "your cards"} and len(ph) > 5
        assert all(p["from"] == "built-in" for p in b("GET", "/speaking/drill?lang=de").json()["phrases"])
        out = a("POST", "/speaking/drill", {"target": "der Apfel ist rot", "heard": "der apfel ist rot", "lang": "de", "seconds": 3})
        assert out.status_code == 201 and out.json()["accuracy"] == 100
        assert a("GET", "/speaking").json()["sessions"][0]["details"]["kind"] == "drill"
        assert b("GET", "/speaking").json()["sessions"] == []
