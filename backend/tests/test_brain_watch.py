"""Brain gym (linked games, daily workout, played -> habit + streak), Watch (YouTube feeds, faked), LinkedIn links; ownership."""
import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import brain_videos

RECENT = (date.today() - timedelta(days=2)).isoformat()


def feed(channel_id, name, vids):
    entries = "".join(f"""<entry><yt:videoId>{v}</yt:videoId><title>{t}</title><published>{RECENT}T10:00:00+00:00</published>
      <media:group><media:description>{d}</media:description><media:community><media:statistics views="{views}"/></media:community></media:group></entry>"""
                      for v, t, d, views in vids)
    return f"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"><title>{name}</title>{entries}</feed>"""


def fake(url):
    if "feeds/videos.xml" in url:
        cid = url.split("channel_id=")[1]
        if cid == "UCsBjURrPoezykLs9EqgamOA":
            return feed(cid, "Fireship", [("aaaaaaaaaaa", "Rust in 100 seconds", "code", 900000), ("bbbbbbbbbbb", "quick tip", "#shorts", 5)])
        if cid == "UCmine000000000000000001":
            return feed(cid, "My Channel", [("ccccccccccc", "My video", "", 10)])
        return feed(cid, "Other", [])
    if "youtube.com/@mychannel" in url:
        return '<link rel="canonical" href="https://www.youtube.com/channel/UCmine000000000000000001">'
    raise AssertionError(url)


@pytest.fixture()
def client(monkeypatch):
    brain_videos.clear_cache()
    monkeypatch.setattr(brain_videos, "_fetch", fake)
    with TestClient(app) as c:
        yield c


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"bw.{uuid.uuid4().hex[:8]}@example.com", "password": "Brain-test-pass-one", "full_name": "B"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None):
        resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


def test_workout_rotates_and_covers_every_skill():
    a, b = brain_videos.todays_workout(date(2026, 11, 16)), brain_videos.todays_workout(date(2026, 11, 17))
    assert {g["skill"] for g in a} == set(brain_videos.SKILLS) and a != b
    assert all(g["url"].startswith("https://www.braingymmer.com/en/brain-games/") for g in a)


def test_brain_played_logs_habit_and_streak(client):
    a, b = _user(client), _user(client)
    v = a("GET", "/brain", expect=200).json()
    assert len(v["workout"]) == 5 and sum(len(s["games"]) for s in v["skills"]) == 33 and v["played_today"] is False
    after = a("POST", "/brain/played", expect=200).json()
    assert after["played_today"] and after["streak"] == 1 and sum(after["week"]) == 1
    assert a("POST", "/brain/played", expect=200).json()["streak"] == 1          # twice a day still counts once
    assert any(h["name"] == "Brain games" for h in a("GET", "/habits", expect=200).json())
    assert b("GET", "/brain", expect=200).json()["played_today"] is False          # private
    assert all(h["name"] != "Brain games" for h in b("GET", "/habits", expect=200).json())


def test_watch_and_channels(client):
    api = _user(client)
    found = api("GET", "/watch/channel?q=%40mychannel", expect=200).json()
    assert found == {"channel_id": "UCmine000000000000000001", "name": "My Channel"}
    w = api("GET", f"/watch?channels={found['channel_id']}", expect=200).json()
    shelves = {s["key"]: s for s in w["shelves"]}
    assert [v["title"] for v in shelves["tech"]["videos"]] == ["Rust in 100 seconds"]       # shorts hidden by default
    assert shelves["mine"]["videos"][0]["title"] == "My video" and w["must_watch"][0]["title"] == "Rust in 100 seconds"
    with_shorts = api("GET", "/watch?shorts=true", expect=200).json()
    assert len({s["key"]: s for s in with_shorts["shelves"]}["tech"]["videos"]) == 2
    api("GET", "/watch/channel?q=%3Cscript%3E", expect=422)


def test_linkedin_links(client):
    links = _user(client)("GET", "/career/linkedin?q=python%20developer", expect=200).json()["links"]
    assert links[0]["url"].startswith("https://www.linkedin.com/jobs/search/?keywords=python+developer&location=Sri%20Lanka")
    assert any(link["url"].startswith("https://www.linkedin.com/search/results/content/?keywords=python+developer") for link in links)
