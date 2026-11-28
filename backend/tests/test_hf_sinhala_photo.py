import base64
import json
import uuid

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import ai_client, hf

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 200).decode()


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"hs.{uuid.uuid4().hex[:8]}@example.com", "password": "Sinhala-test-pass-one", "full_name": "S"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_meal_photo_suggests_and_saves_nothing(monkeypatch):
    seen = {}

    def fake(db, uid, feature, model, messages, temperature=0.2):
        seen["content"] = messages[-1]["content"]
        return json.dumps({"foods": ["Rice", "Dhal curry", "Chicken curry"], "calories": 720, "protein_g": 34, "confidence": "medium", "note": "Add some greens."})
    with TestClient(app) as client:
        a = _user(client)
        assert a("POST", "/meals/photo", {"image_base64": PNG, "mime": "image/png"}).status_code == 503        # no AI key: clear message
        monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
        monkeypatch.setattr(ai_client, "chat_complete", fake)
        r = a("POST", "/meals/photo", {"image_base64": PNG, "mime": "image/png"}).json()
        assert r["foods_text"] == "Rice, Dhal curry, Chicken curry" and r["calories"] == 720 and r["stored_photo"] is False
        assert seen["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
        assert a("GET", "/meals").json() in ([], {"meals": []}) or not a("GET", "/meals").json().get("meals")    # nothing logged
        assert a("POST", "/meals/photo", {"image_base64": PNG, "mime": "image/gif"}).status_code == 422
        assert a("POST", "/meals/photo", {"image_base64": "!" * 200, "mime": "image/png"}).status_code == 422


def test_sinhala_message_runs_the_same_tools_and_replies_in_sinhala(monkeypatch):
    calls = []

    def fake(db, uid, feature, model, messages, temperature=0.2):
        calls.append(feature)
        if feature == "translate":
            return "Drank 500 ml water" if "Sinhala (or mixed" in messages[0]["content"] else "කළා ✓ වතුර 500 ml"
        return "හරි, වතුර 500 ml සටහන් කළා."
    monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai_client, "chat_complete", fake)
    with TestClient(app) as client:
        a = _user(client)
        r = a("POST", "/chat", {"message": "මම වතුර 500 ml බිව්වා"}).json()
        assert [x["tool"] for x in r["actions_completed"]] == ["log_water"] and "වතුර" in r["reply"]
        assert "translate" in calls and a("GET", "/water").json()["today_ml"] == 500


def test_sinhala_without_ai_key_uses_hf_translation(monkeypatch):
    monkeypatch.setattr(settings, "hf_token", "hf_test")
    monkeypatch.setattr(hf, "_post", lambda model, payload, suffix="": [{"translation_text": "Drank 2 glasses of water" if payload["parameters"]["tgt_lang"] == "eng_Latn" else "කළා ✓"}])
    with TestClient(app) as client:
        a = _user(client)
        r = a("POST", "/chat", {"message": "මම වතුර වීදුරු 2ක් බිව්වා"}).json()
        assert [x["tool"] for x in r["actions_completed"]] == ["log_water"] and r["reply"] == "කළා ✓"


def test_sinhala_search_uses_the_multilingual_model(monkeypatch):
    used = []

    def fake(model, payload, suffix=""):
        used.append(model)
        return [[1.0, 0.0, 0.0] for _ in payload["inputs"]]
    monkeypatch.setattr(settings, "hf_token", "hf_test")
    monkeypatch.setattr(hf, "_post", fake)
    with TestClient(app) as client:
        a = _user(client)
        a("POST", "/notes", {"title": "වතුර බොන්න", "body": "දවසට ලීටර් 2.5"})
        r = a("GET", "/search?q=වතුර").json()
        assert r["mode"] == "meaning" and set(used) == {settings.hf_multilingual_model}
