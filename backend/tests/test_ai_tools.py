import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.models.entities import TextVector
from app.services import hf, portfolio_ai, speaking


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"ai.{uuid.uuid4().hex[:8]}@example.com", "password": "Tools-test-pass-one", "full_name": "T"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def fake_hf(model, payload, suffix=""):
    texts = payload["inputs"]
    if "feature-extraction" in suffix:     # tiny "meaning": counts of a few topic words
        topics = [("shoe", "sneaker", "running", "run"), ("money", "bank", "salary", "cash"), ("german", "deutsch", "goethe")]
        return [[float(sum(t.lower().count(w) for w in group)) + 0.01 for group in topics] for t in texts]
    return [[{"label": "negative" if "loss" in t.lower() else "positive" if "profit" in t.lower() else "neutral", "score": 0.93},
             {"label": "neutral", "score": 0.05}] for t in texts]


@pytest.fixture()
def hf_on(monkeypatch):
    monkeypatch.setattr(settings, "hf_token", "test-token")
    monkeypatch.setattr(hf, "_post", fake_hf)
    monkeypatch.setattr(hf, "_down_until", 0.0)
    hf._tone_cache.clear()


def test_speaking_analysis_counts_fillers_and_pace():
    a = speaking.analyse("Um so I think this is, um, basically my plan. I I want to run every day.", 10, "en")
    assert a["words"] == 17 and a["wpm"] == 102
    assert a["details"]["filler_words"]["um"] == 2 and a["details"]["filler_words"]["basically"] == 1 and a["details"]["repeats"] == 1
    assert 0 <= a["score"] <= 100 and any("slow" in t for t in a["details"]["tips"])
    de = speaking.analyse("Also ähm ich wohne in Colombo und ähm ich arbeite viel", 6, "de")
    assert de["details"]["filler_words"]["ähm"] == 2


def test_speaking_routes_and_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        s = a("POST", "/speaking/sessions", {"transcript": "Hello, my name is Sam and I like running in the morning.", "seconds": 20, "lang": "en", "topic": "Intro"})
        assert s.status_code == 201, s.text
        sid = s.json()["id"]
        ov = a("GET", "/speaking").json()
        assert ov["sessions"][0]["id"] == sid and ov["prompts"]["de"] and ov["whisper_available"] is False
        assert a("POST", f"/speaking/{sid}/feedback").status_code == 503             # no AI key: scores still work
        assert a("POST", "/speaking/sessions", {"transcript": "hi", "seconds": 6}).status_code == 422
        assert b("GET", "/speaking").json()["sessions"] == []
        assert b("POST", f"/speaking/{sid}/feedback").status_code == 404
        assert b("DELETE", f"/speaking/{sid}").status_code == 404
        assert a("DELETE", f"/speaking/{sid}").status_code == 204


def test_search_by_words_and_private():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        assert a("POST", "/tasks", {"title": "Buy running shoes", "priority": "medium"}).status_code in (200, 201)
        r = a("GET", "/search?q=shoes").json()
        assert r["mode"] == "keyword" and r["results"][0]["title"] == "Buy running shoes" and r["results"][0]["screen"] == "Life"
        assert b("GET", "/search?q=shoes").json()["results"] == []


def test_search_by_meaning_caches_vectors(hf_on):
    with TestClient(app) as client:
        a = _user(client)
        a("POST", "/tasks", {"title": "Buy running shoes", "priority": "medium"})
        a("POST", "/tasks", {"title": "Transfer salary to bank", "priority": "low"})
        r = a("GET", "/search?q=sneaker").json()          # no shared word, same meaning
        assert r["mode"] == "meaning" and r["results"][0]["title"] == "Buy running shoes" and r["results"][0]["why"] == "similar meaning"
        with SessionLocal() as db:
            assert db.query(TextVector).count() >= 2
        assert a("GET", "/search?q=cash").json()["results"][0]["title"] == "Transfer salary to bank"


def test_finbert_news_tone(hf_on):
    tones = hf.finbert(["JKH profit up 20%", "Bank reports loss", "Board meeting today"])
    assert [t["label"] for t in tones] == ["positive", "negative", "neutral"]
    with SessionLocal() as db:
        news = [{"title": "Bank reports loss", "url": "u1"}, {"title": "Bank reports loss again", "url": "u2"}]
        mood = portfolio_ai.news_mood(db, uuid.uuid4(), news)
    assert news[0]["tone"] == "negative" and news[0]["tone_model"] == "FinBERT" and mood["model"] == "FinBERT"
    sug = portfolio_ai._suggest({"news": news, "unrealised_pct": 5}, {"enough_data": False}, {"news_mood": mood})
    assert any("negative headlines" in r for r in sug["reasons"])
