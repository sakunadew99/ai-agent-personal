"""Learning posts: articles from trusted public feeds (technology, educational, psychology, motivation), filtered and ranked.

Feeds are fetched with the News digest's safe fetcher (HTTPS only, public addresses, size and time limits, defusedxml)
and cached for 2 hours. Every post goes through the same learning filter as videos; feed text is untrusted data.
All sources were checked to answer with a valid feed. LinkedIn has no public feed and forbids scraping, so LinkedIn
posts come in only as links you share (with LinkedIn's official embed) plus search links for your goals.
"""
from __future__ import annotations

import hashlib
import html
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import quote_plus

from app.services import learn_feed

SOURCES: list[tuple[str, str, str]] = [   # name, feed url, topic
    ("MIT Technology Review", "https://www.technologyreview.com/feed/", "technology"),
    ("Hacker News", "https://hnrss.org/frontpage?points=150", "technology"),
    ("The GitHub Blog", "https://github.blog/feed/", "technology"),
    ("DEV Community", "https://dev.to/feed", "technology"),
    ("Quanta Magazine", "https://www.quantamagazine.org/feed/", "educational"),
    ("ScienceDaily", "https://www.sciencedaily.com/rss/top/science.xml", "educational"),
    ("The Conversation", "https://theconversation.com/global/articles.atom", "educational"),
    ("Smithsonian", "https://www.smithsonianmag.com/rss/latest_articles/", "educational"),
    ("Aeon", "https://aeon.co/feed.rss", "educational"),
    ("Psyche", "https://psyche.co/feed", "psychology"),
    ("Greater Good (UC Berkeley)", "https://greatergood.berkeley.edu/site/rss/articles", "psychology"),
    ("James Clear", "https://jamesclear.com/feed", "motivational"),
    ("Zen Habits", "https://zenhabits.net/feed/", "motivational"),
    ("Farnam Street", "https://fs.blog/feed/", "motivational"),
    ("Mark Manson", "https://markmanson.net/feed", "motivational"),
    ("Big Think", "https://bigthink.com/feed/", "motivational"),
]
TTL = 2 * 3600
_cache: dict[str, tuple[float, list[dict]]] = {}


def _download(url: str) -> bytes:
    """Safe fetch (tests replace this)."""
    from app.services import news
    return news._download(news.check_url(url))


def _text(v: str | None, limit: int) -> str:
    t = re.sub(r"<[^>]+>", " ", html.unescape(v or ""))
    return re.sub(r"\s+", " ", t).strip()[:limit]


def _date(v: str | None) -> str:
    from app.services import news
    d = news._date(v)
    return d.astimezone(timezone.utc).date().isoformat() if d else ""


def parse(data: bytes) -> list[dict]:
    """RSS / Atom items with title, link, summary, date and an image (media:content, media:thumbnail, enclosure or first <img>)."""
    from defusedxml.ElementTree import fromstring
    root = fromstring(data)
    local = lambda el: el.tag.rsplit("}", 1)[-1].lower()  # noqa: E731
    out = []
    for el in root.iter():
        if local(el) not in ("item", "entry"):
            continue
        f: dict[str, str] = {}
        link = image = None
        for c in el.iter():
            n = local(c)
            if c is el:
                continue
            if n == "link":
                href = c.attrib.get("href")
                if href and c.attrib.get("rel", "alternate") == "alternate":
                    link = link or href
                elif (c.text or "").strip():
                    link = link or c.text.strip()
            elif n in ("content", "thumbnail") and c.attrib.get("url") and (c.attrib.get("medium") in (None, "image") or n == "thumbnail"):
                image = image or c.attrib["url"]
            elif n == "enclosure" and str(c.attrib.get("type", "")).startswith("image") and c.attrib.get("url"):
                image = image or c.attrib["url"]
            elif n not in f and (c.text or "").strip():
                f[n] = c.text
        title = _text(f.get("title"), 200)
        if not title or not link or not link.startswith("https://"):
            continue
        body = f.get("encoded") or f.get("content") or f.get("description") or f.get("summary") or ""
        if not image:
            m = re.search(r'<img[^>]+src="(https://[^"]+)"', html.unescape(body))
            image = m.group(1) if m else None
        out.append({"title": title, "url": link[:600], "excerpt": _text(f.get("description") or f.get("summary") or body, 280),
                    "image": image if image and image.startswith("https://") else None,
                    "published": _date(f.get("pubdate") or f.get("published") or f.get("updated") or f.get("date"))})
    return out


def _source(name: str, url: str, topic: str) -> list[dict]:
    hit = _cache.get(url)
    if hit and hit[0] > time.time():
        return hit[1]
    try:
        items = parse(_download(url))[:15]
    except Exception:                       # one broken feed never breaks the hub
        items = []
    out = []
    for it in items:
        pid = "p:" + hashlib.sha1(it["url"].encode()).hexdigest()[:16]
        out.append({**it, "id": pid, "kind": "post", "channel": name, "channel_id": "src:" + re.sub(r"[^a-z0-9]+", "-", name.lower())[:30],
                    "source_topic": topic, "views": 0, "thumb": it["image"] or ""})
    _cache[url] = (time.time() + (TTL if out else 600), out)
    return out


def fetch_all() -> tuple[list[dict], int, int]:
    """(learning posts, hidden count, feeds that didn't answer)."""
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda s: (s, _source(*s)), SOURCES))
    kept, hidden, down = [], 0, 0
    for (name, _url, topic), items in results:
        if not items:
            down += 1
        for it in items:
            c = learn_feed.classify(it["title"], it["excerpt"], topic)
            if c["category"]:
                kept.append({**it, "category": c["category"], "why": c["why"]})
            else:
                hidden += 1
    return kept, hidden, down


def linkedin_links(goal_words: list[str]) -> list[dict]:
    """LinkedIn search links (no scraping): learning posts about your goals and topics."""
    topics = list(dict.fromkeys([*goal_words[:3], "artificial intelligence", "career growth", "productivity"]))[:5]
    return [{"title": f"LinkedIn posts: {t}", "url": f"https://www.linkedin.com/search/results/content/?keywords={quote_plus(t)}&sortBy=%22date_posted%22"}
            for t in topics]


def clear_cache() -> None:
    _cache.clear()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
