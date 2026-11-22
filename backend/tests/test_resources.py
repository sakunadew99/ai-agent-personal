import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import resources


def fake_get(url):
    if "opensearch" in url:
        return json.dumps(["swimming", ["Swimming"], [""], ["https://en.wikipedia.org/wiki/Swimming"]])
    if "page/summary/Swimming" in url:
        return json.dumps({"title": "Swimming", "extract": "Swimming is the self-propulsion of a person through water.",
                           "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Swimming"}}})
    raise AssertionError(url)


@pytest.mark.parametrize("topic,cat", [("Python pandas", "coding"), ("learn German grammar", "language"), ("swimming for adults", "health"),
                                       ("stock market investing", "money"), ("public speaking", "soft"), ("guitar chords", "music"), ("Roman history", "general")])
def test_categories(topic, cat):
    assert resources.category(topic) == cat


def test_links_are_real_searches_never_invented_titles():
    r = resources.find("machine learning", "beginner")
    assert [i["kind"] for i in r["items"]][:4] == ["Best beginner video", "Best practical tutorial", "Best educational post", "Best free resource"]
    assert r["items"][0]["url"] == "https://www.youtube.com/results?search_query=machine+learning+for+beginners"
    assert r["items"][2]["url"] == "https://www.freecodecamp.org/news/search/?query=machine+learning"
    assert all(i["url"].startswith("https://") for i in r["items"]) and r["next_action"]
    assert r["summary"] is None                                                   # offline in tests: no made-up summary


def test_wikipedia_summary_is_real_and_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(resources, "_http_get", lambda u: (calls.append(u), fake_get(u))[1])
    s = resources.wikipedia("swimming")
    assert s == {"title": "Swimming", "summary": "Swimming is the self-propulsion of a person through water.",
                 "url": "https://en.wikipedia.org/wiki/Swimming", "source": "Wikipedia"}
    n = len(calls)
    resources.wikipedia("Swimming ")
    assert len(calls) == n                                                        # second time from cache


def test_route_requires_sign_in_and_validates():
    with TestClient(app) as client:
        assert client.get("/api/v1/resources?topic=python").status_code == 401
        r = client.post("/api/v1/auth/register", json={"email": f"rs.{uuid.uuid4().hex[:8]}@example.com", "password": "Res-test-pass-one", "full_name": "R"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        out = client.get("/api/v1/resources?topic=kegel exercises&ai=true", headers=h).json()
        assert out["category"] == "health" and out["items"][2]["url"].startswith("https://www.nhs.uk/search/results?q=") and out["ai_note"] is None
        assert client.get("/api/v1/resources?topic=x", headers=h).status_code == 422
        assert client.get("/api/v1/resources?topic=python&level=expert", headers=h).status_code == 422
