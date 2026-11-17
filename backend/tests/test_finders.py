"""Job finder and learning radar with faked feeds (no network): ranking, summary, skills gap, links, save to tracker."""
import json
import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import jobs_finder, learn_radar

TODAY = date.today().isoformat()
OLD = (date.today() - timedelta(days=200)).isoformat()


def fake_jobs(url):
    if "arbeitnow" in url:
        if "page=1" not in url:
            return json.dumps({"data": []})
        return json.dumps({"data": [
            {"slug": "py-berlin", "company_name": "Acme GmbH", "title": "Python Developer (m/w/d)", "description": "<p>Python, Docker, SQL. Visa sponsorship.</p>",
             "remote": False, "url": "https://www.arbeitnow.com/jobs/py-berlin", "tags": ["Python"], "job_types": ["full time"], "location": "Berlin, Germany", "created_at": TODAY},
            {"slug": "sales", "company_name": "Stripe", "title": "Account Executive", "description": "Sales", "remote": False,
             "url": "https://www.arbeitnow.com/jobs/sales", "tags": [], "job_types": [], "location": "Munich", "created_at": TODAY},
            {"slug": "old", "company_name": "Old", "title": "Python Engineer", "description": "python", "remote": True,
             "url": "https://www.arbeitnow.com/jobs/old", "tags": [], "job_types": [], "location": "Remote", "created_at": OLD}]})
    if "remotive" in url:
        return json.dumps({"jobs": [{"id": 7, "title": "Senior Python Engineer", "company_name": "RemoteCo", "candidate_required_location": "Worldwide",
                                     "tags": ["python", "aws"], "category": "Software Development", "url": "https://remotive.com/jobs/7",
                                     "publication_date": f"{TODAY}T10:00:00", "description": "Python and AWS and Kubernetes", "salary": "$90k"}]})
    if "remoteok" in url:
        return json.dumps([{"legal": "link back"}, {"id": "9", "position": "Python Developer (m/w/d)", "company": "Acme GmbH", "location": "Berlin",
                                                    "tags": ["python"], "url": "https://remoteok.com/9", "epoch": 1794556821, "description": "dup"}])
    if "jobicy" in url:
        return json.dumps({"jobs": []})
    if "topjobs" in url:
        return "<html></html>"
    raise AssertionError(url)


def fake_learn(url):
    if "algolia" in url:
        return json.dumps({"hits": [{"title": "uv is fast", "url": "https://example.com/uv", "points": 300, "num_comments": 80, "objectID": "1", "created_at": f"{TODAY}T00:00:00Z"}]})
    if "dev.to" in url:
        return json.dumps([{"title": "FastAPI tips", "url": "https://dev.to/x/fastapi", "description": "tips", "public_reactions_count": 120,
                            "tag_list": ["python", "fastapi"], "published_at": f"{TODAY}T00:00:00Z", "reading_time_minutes": 4}])
    if "api.github.com" in url:
        return json.dumps({"items": [{"full_name": "a/agent-kit", "html_url": "https://github.com/a/agent-kit", "description": "agents",
                                      "stargazers_count": 900, "topics": ["llm", "agents"], "language": "Python", "created_at": f"{TODAY}T00:00:00Z"}]})
    if "wikipedia" in url:
        return json.dumps({"tfa": {"normalizedtitle": "Sigiriya", "extract": "An ancient rock fortress.", "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Sigiriya"}}},
                           "onthisday": [{"year": 1990, "text": "Something happened."}]})
    raise AssertionError(url)


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"fd.{uuid.uuid4().hex[:8]}@example.com", "password": "Finder-test-pass-one", "full_name": "F"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None):
        resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


@pytest.fixture()
def client(monkeypatch):
    jobs_finder.clear_cache(); learn_radar.clear_cache()
    monkeypatch.setattr(jobs_finder, "_fetch", fake_jobs)
    monkeypatch.setattr(learn_radar, "_fetch", fake_learn)
    with TestClient(app) as c:
        yield c


def test_job_finder(client):
    api = _user(client)
    r = api("GET", "/career/find?q=Python%20developer&location=Berlin", expect=200).json()
    titles = [j["title"] for j in r["jobs"]]
    assert "Account Executive" not in titles and "Python Engineer" not in titles         # unrelated and too old are dropped
    assert titles.count("Python Developer (m/w/d)") == 1                                     # deduplicated across sources
    assert r["jobs"][0]["company"] == "Acme GmbH" and r["summary"]["germany"] == 1 and r["summary"]["visa_or_relocation"] >= 1
    assert any(s == "python" for s, _ in r["summary"]["skills"]) and "aws" in r["summary"]["skills_to_learn"]
    assert any(link["name"] == "LinkedIn" and "keywords=Python" in link["url"] for link in r["links"])
    job = r["jobs"][0]
    api("POST", "/career/jobs", {"company": job["company"], "role": job["title"], "url": job["url"], "status": "draft"}, 201)
    assert api("GET", "/career/find?q=Python%20developer", expect=200).json()["jobs"][0]["saved"] is True
    remote = api("GET", "/career/find?q=Python&remote=true", expect=200).json()
    assert all(j["remote"] for j in remote["jobs"])
    assert _user(client)("GET", "/career/find?q=Python%20developer", expect=200).json()["jobs"][0]["saved"] is False   # private


def test_job_feed_down_is_reported(client, monkeypatch):
    import httpx

    def down(url):
        raise httpx.ConnectError("down")
    jobs_finder.clear_cache()
    monkeypatch.setattr(jobs_finder, "_fetch", down)
    r = _user(client)("GET", "/career/find?q=python", expect=200).json()
    assert r["jobs"] == [] and len(r["errors"]) == len(jobs_finder.SOURCES) and r["links"]


def test_learning_radar(client):
    r = _user(client)("GET", "/learning/radar?topics=python", expect=200).json()
    assert {i["source"] for i in r["items"]} == {"Hacker News", "dev.to", "GitHub"}
    assert r["items"][0]["score"] == 900 and r["today"]["title"] == "Sigiriya"
    assert any(t == "fastapi" for t, _ in r["summary"]["hot_tags"]) and {t["key"] for t in r["tracks"]} >= {"se", "cs", "life"}
