import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.services import brain_videos, hf, learn_feed

MY = "UC" + "m" * 22


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"lf.{uuid.uuid4().hex[:8]}@example.com", "password": "Learn-test-pass-one", "full_name": "L"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def _v(vid, title, cid, about=""):
    return {"id": vid, "title": title, "channel": "C", "channel_id": cid, "url": f"https://www.youtube.com/watch?v={vid}", "thumb": "",
            "published": "2026-11-20", "views": 1000, "short": "#shorts" in title, "about": about}


def test_classify_rules():
    assert learn_feed.classify("How Does the Brain Store Memories? Explained")["category"] == "educational"
    assert learn_feed.classify("5 habits that build discipline and focus")["category"] == "motivational"
    assert learn_feed.classify("Why overthinking and anxiety feel the same")["category"] == "psychology"
    p = learn_feed.classify("Crazy PRANK on my brother", trusted="educational")
    assert p["category"] is None and p["blocked"] and "prank" in p["why"]
    assert learn_feed.classify("Minecraft gameplay how to build a house")["blocked"]                 # gaming beats "how to"
    assert learn_feed.classify("Vlog: my weekend")["category"] is None
    assert learn_feed.classify("Vlog: my weekend", trusted="psychology")["category"] == "psychology"   # trusted channel
    assert learn_feed.classify("Daily updates")["method"] == "rules"
    assert learn_feed.classify("the gossip girl")["blocked"] and not learn_feed.classify("Dramatic chemistry experiments")["blocked"]


def test_feed_keeps_learning_hides_the_rest(monkeypatch):
    trusted = learn_feed.LEARN_CHANNELS[0][0]                      # Kurzgesagt, educational
    feeds = {trusted: [_v("a1", "What is a black hole?", trusted), _v("a2", "Our merch giveaway", trusted)],
             MY: [_v("b1", "Stop procrastination: build habits that stick", MY), _v("b2", "My vlog in Paris", MY), _v("b3", "Quick tip #shorts", MY)]}

    def fake(cid):
        if cid in feeds:
            return feeds[cid]
        raise brain_videos.FeedDown("down")

    monkeypatch.setattr(brain_videos, "_feed", fake)
    with TestClient(app) as client:
        a = _user(client)
        r = a("GET", f"/learn-feed?channels={MY},not-a-channel").json()
        ids = {v["id"]: v for v in r["videos"]}
        assert set(ids) == {"a1", "b1"} and ids["a1"]["category"] == "educational" and ids["b1"]["category"] == "motivational"
        assert r["hidden_count"] == 2 and {h["title"] for h in r["hidden"]} == {"Our merch giveaway", "My vlog in Paris"}
        assert r["errors"] and r["counts"]["educational"] == 1
        assert [v["id"] for v in a("GET", f"/learn-feed?channels={MY}&only=motivational").json()["videos"]] == ["b1"]
        assert a("GET", "/learn-feed?only=gaming").status_code == 422
        # AI second opinion only for unclear titles
        monkeypatch.setattr(hf, "enabled", lambda: True)
        monkeypatch.setattr(hf, "_post", lambda model, payload, suffix="": {"labels": ["psychology and mental health", "other"], "scores": [0.8, 0.2]})
        r = a("GET", f"/learn-feed?channels={MY}&ai=true").json()
        b2 = next(v for v in r["videos"] if v["id"] == "b2")
        assert b2["category"] == "psychology" and b2["method"] == "ai"
        assert all(h["title"] != "My vlog in Paris" for h in r["hidden"]) and any(h["title"] == "Our merch giveaway" for h in r["hidden"])


def test_save_social_links_only_when_learning():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        assert a("POST", "/learn-feed/link", {"url": "https://evil.example.com/x", "title": "how to study"}).status_code == 422
        assert a("POST", "/learn-feed/link", {"url": "http://www.tiktok.com/@x/video/1", "title": "how to study"}).status_code == 422
        ok = a("POST", "/learn-feed/link", {"url": "https://www.tiktok.com/@coach/video/123", "title": "How to stop overthinking and anxiety"}).json()
        assert ok["saved"] and ok["category"] == "psychology" and ok["folder"] == "Learning · Psychology" and ok["platform"] == "TikTok"
        no = a("POST", "/learn-feed/link", {"url": "https://www.facebook.com/watch/?v=9", "title": "funny prank compilation"}).json()
        assert not no["saved"] and "prank" in no["why"]
        assert not a("POST", "/learn-feed/link", {"url": "https://www.facebook.com/watch/?v=9", "title": "funny prank", "save_anyway": True}).json()["saved"]
        unclear = a("POST", "/learn-feed/link", {"url": "https://fb.watch/abc", "title": "nice one"}).json()
        assert not unclear["saved"] and unclear["hint"]
        forced = a("POST", "/learn-feed/link", {"url": "https://fb.watch/abc", "title": "nice one", "save_anyway": True}).json()
        assert forced["saved"] and forced["folder"] == "Learning · Other"
        folders = a("GET", "/media").json()["folders"]
        assert "Learning · Psychology" in folders and b("GET", "/media").json()["items"] == []


def test_soft_block_keeps_psychology_about_gaming():
    assert learn_feed.classify("If you've been gaming a lot lately, try this", trusted="motivational")["blocked"]
    assert learn_feed.classify("Gaming addiction and anxiety: the psychology")["category"] == "psychology"
    assert learn_feed.classify("Engineers make great founders")["category"] == "educational"


def test_fails_only_blocks_fail_compilations():
    assert learn_feed.classify("When the 80/20 Rule Fails: the downside of being effective", trusted="motivational")["category"] == "motivational"
    assert learn_feed.classify("Epic fails 2026")["blocked"]
