import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.services import brain_videos, hf, learn_feed, reels

T = date.today()


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"rl.{uuid.uuid4().hex[:8]}@example.com", "password": "Reel-test-pass-one", "full_name": "R"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def _v(vid, title, cid, days=2, views=1000):
    return {"id": vid, "title": title, "channel": cid, "channel_id": cid, "url": f"https://www.youtube.com/watch?v={vid}", "thumb": "",
            "published": (T - timedelta(days=days)).isoformat(), "views": views, "short": False, "about": ""}


EDU, MOT, PSY = (learn_feed.LEARN_CHANNELS[0][0], learn_feed.LEARN_CHANNELS[7][0], learn_feed.LEARN_CHANNELS[10][0])
FEEDS = {
    EDU: [_v("e1", "What is a black hole? Explained", EDU), _v("e2", "How German grammar works", EDU, 5), _v("e3", "Chemistry of cooking explained", EDU, 3)],
    MOT: [_v("m1", "Build discipline with tiny habits", MOT), _v("m2", "Morning routine for focus", MOT, 4)],
    PSY: [_v("p1", "Why overthinking happens: psychology", PSY), _v("p2", "Anxiety and the brain", PSY, 6), _v("p3", "Attachment styles in relationships", PSY, 1)],
}


def _fake(cid):
    if cid in FEEDS:
        return FEEDS[cid]
    raise brain_videos.FeedDown("down")


def test_reels_learn_from_likes_skips_and_goals(monkeypatch):
    monkeypatch.setattr(brain_videos, "_feed", _fake)
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        first = a("GET", "/reels").json()
        ids = [i["id"] for i in first["items"]]
        assert set(ids) == {"e1", "e2", "e3", "m1", "m2", "p1", "p2", "p3"} and first["shield"]
        assert all(first["items"][k]["channel_id"] != first["items"][k + 1]["channel_id"] for k in range(len(ids) - 1) if k < 4)   # mixed channels at the top
        ev = [{"video_id": "p1", "channel_id": PSY, "category": "psychology", "title": "Why overthinking happens: psychology", "action": "like"},
              {"video_id": "p1", "channel_id": PSY, "category": "psychology", "title": "Why overthinking happens: psychology", "action": "view", "seconds": 240},
              {"video_id": "e3", "channel_id": EDU, "category": "educational", "title": "Chemistry of cooking explained", "action": "skip", "seconds": 2},
              {"video_id": "m2", "channel_id": MOT, "category": "motivational", "title": "Morning routine for focus", "action": "hide"}]
        assert a("POST", "/reels/events", {"events": ev}).json()["recorded"] == 4
        nxt = a("GET", "/reels").json()
        ids = [i["id"] for i in nxt["items"]]
        assert not {"p1", "e3", "m2"} & set(ids)                                   # seen, skipped and hidden don't come back
        assert ids[0] in ("p2", "p3")                                                # liked psychology rises to the top
        assert nxt["items"][0]["reason"] in ("From a channel you enjoy", "Similar to videos you liked", "Because you like psychology")
        assert nxt["stats"]["minutes_week"] == 4 and nxt["stats"]["by_category"] == {"psychology": 4}
        a("POST", "/goals", {"title": "Learn German to B1"})
        g = a("GET", "/reels").json()["items"]
        e2 = next(i for i in g if i["id"] == "e2")
        assert e2["reason"] == "Supports your goal: Learn German to B1"
        assert {i["id"] for i in b("GET", "/reels").json()["items"]} >= {"p1", "e3", "m2"}      # user B's feed is separate
        assert a("POST", "/reels/events", {"events": [{"video_id": "x", "action": "dance"}]}).status_code == 422
        assert a("POST", "/reels/events", {"events": []}).status_code == 422


def test_hiding_a_channel_twice_removes_it_and_saved_clips_mix_in(monkeypatch):
    monkeypatch.setattr(brain_videos, "_feed", _fake)
    with TestClient(app) as client:
        a = _user(client)
        a("POST", "/learn-feed/link", {"url": "https://www.tiktok.com/@coach/video/7300000000000000001", "title": "How to stop overthinking (psychology)"})
        a("POST", "/reels/events", {"events": [{"video_id": v, "channel_id": MOT, "category": "motivational", "action": "hide"} for v in ("m1", "m2")]})
        items = a("GET", "/reels").json()["items"]
        assert all(i["channel_id"] != MOT for i in items)
        tk = next(i for i in items if i["kind"] == "tiktok")
        assert tk["embed"] == "https://www.tiktok.com/player/v1/7300000000000000001" and tk["category"] == "psychology"


def test_embedding_similarity_used_when_available(monkeypatch):
    monkeypatch.setattr(hf, "enabled", lambda: True)
    vec = {"liked one": [1.0, 0.0], "close": [0.9, 0.1], "far": [0.0, 1.0]}
    monkeypatch.setattr(hf, "embed", lambda texts: [vec[t] for t in texts])
    reels._emb_cache.clear()
    sims = reels._embed_sim(["close", "far"], ["liked one"])
    assert sims[0] > 0.9 and sims[1] < 0.1
    monkeypatch.setattr(hf, "enabled", lambda: False)
    assert reels._embed_sim(["close"], ["liked one"]) is None
