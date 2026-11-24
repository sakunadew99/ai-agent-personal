import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.services import brain_videos, learn_feed, posts, reels

T = date.today()
RSS = f"""<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>New open source AI model beats GPT on coding</title><link>https://example.org/ai-model</link>
<description>&lt;p&gt;Researchers released a model&lt;/p&gt;</description><pubDate>{(T - timedelta(days=1)).strftime('%a, %d %b %Y')} 10:00:00 GMT</pubDate>
<media:content url="https://example.org/img.jpg" medium="image"/></item>
<item><title>Celebrity gossip of the week</title><link>https://example.org/gossip</link><pubDate>{T.strftime('%a, %d %b %Y')} 10:00:00 GMT</pubDate></item>
<item><title>How habits shape your brain</title><link>https://example.org/habits</link>
<content:encoded>&lt;img src="https://example.org/h.png"&gt; Small habits compound.</content:encoded><pubDate>{T.strftime('%a, %d %b %Y')} 09:00:00 GMT</pubDate></item>
<item><title>Insecure link</title><link>http://example.org/x</link></item>
</channel></rss>""".encode()


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"hb.{uuid.uuid4().hex[:8]}@example.com", "password": "Hub-test-pass-one", "full_name": "H"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_parse_extracts_images_and_skips_insecure_links():
    items = posts.parse(RSS)
    assert [i["title"] for i in items] == ["New open source AI model beats GPT on coding", "Celebrity gossip of the week", "How habits shape your brain"]
    assert items[0]["image"] == "https://example.org/img.jpg" and items[0]["excerpt"] == "Researchers released a model"
    assert items[2]["image"] == "https://example.org/h.png" and items[0]["published"] == (T - timedelta(days=1)).isoformat()


def test_hub_mixes_filtered_posts_and_videos(monkeypatch):
    monkeypatch.setattr(posts, "SOURCES", [("Tech Daily", "https://example.org/tech", "technology"), ("Habit Lab", "https://example.org/habit", "motivational")])
    monkeypatch.setattr(posts, "_download", lambda url: RSS)
    edu = learn_feed.LEARN_CHANNELS[0][0]
    vids = [{"id": f"v{i}", "title": t, "channel": "K", "channel_id": edu, "url": f"https://www.youtube.com/watch?v=v{i}", "thumb": "",
             "published": T.isoformat(), "views": 500, "short": False, "about": ""} for i, t in enumerate(["What is gravity? Explained", "Why stars shine: science"])]
    monkeypatch.setattr(brain_videos, "_feed", lambda cid: vids if cid == edu else (_ for _ in ()).throw(brain_videos.FeedDown("x")))
    with TestClient(app) as client:
        a = _user(client)
        h = a("GET", "/hub").json()
        kinds = [i["kind"] for i in h["items"]]
        titles = [i["title"] for i in h["items"]]
        assert "Celebrity gossip of the week" not in titles and h["hidden_count"] >= 2           # gossip filtered out of both sources
        assert kinds[:3] == ["post", "post", "youtube"]                                          # two posts, then a video
        ai = next(i for i in h["items"] if i["title"].startswith("New open source AI"))
        assert ai["category"] == "technology" and ai["thumb"] == "https://example.org/img.jpg"
        assert {r["kind"] for r in h["reels"]} == {"youtube"} and h["linkedin"][0]["url"].startswith("https://www.linkedin.com/search/results/content/")
        only = a("GET", "/hub?only=motivational").json()["items"]
        assert only and all(i["category"] == "motivational" for i in only)
        a("POST", "/reels/events", {"events": [{"video_id": ai["id"], "channel_id": ai["channel_id"], "category": "technology", "title": ai["title"], "action": "view", "seconds": 90}]})
        assert ai["id"] not in [i["id"] for i in a("GET", "/hub").json()["items"]]                # read posts don't repeat
        ex = ",".join(i["id"] for i in h["items"][:2])
        assert not {i["id"] for i in a("GET", f"/hub?exclude={ex}").json()["items"]} & set(ex.split(","))
        assert a("GET", "/hub?only=sports").status_code == 422


def test_linkedin_and_other_links_get_official_embeds():
    assert reels._embed_url("LinkedIn", "https://www.linkedin.com/posts/someone_ai-learning-activity-7265432109876543210-AbCd") == \
        "https://www.linkedin.com/embed/feed/update/urn:li:activity:7265432109876543210"
    assert reels._embed_url("TED", "https://www.ted.com/talks/brene_brown_the_power_of_vulnerability") == "https://embed.ted.com/talks/brene_brown_the_power_of_vulnerability"
    assert reels._embed_url("Vimeo", "https://vimeo.com/76979871") == "https://player.vimeo.com/video/76979871"
    with TestClient(app) as client:
        a = _user(client)
        r = a("POST", "/learn-feed/link", {"url": "https://www.linkedin.com/posts/coach_activity-7265432109876543210-x", "title": "Python tips for data analysis"}).json()
        assert r["saved"] and r["platform"] == "LinkedIn" and r["category"] in ("technology", "educational")
        assert a("POST", "/learn-feed/link", {"url": "https://www.khanacademy.org/math/algebra", "title": "Algebra lesson explained"}).json()["saved"]
