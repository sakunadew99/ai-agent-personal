"""Learning radar: what's new and worth learning, from public APIs (Hacker News, dev.to, GitHub, Wikipedia).

Read at most every 6 hours per topic (cached). Titles and summaries are untrusted data: shown, never followed.
Saving something is a normal task or memory the user creates from the page.
"""
from __future__ import annotations

import html
import json
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote_plus

import httpx

USER_AGENT = "Mozilla/5.0 (Sakuna personal learning radar; one user, cached)"
TTL = 6 * 3600
_cache: dict[str, tuple[float, object]] = {}


def _fetch(url: str) -> str:
    """One GET (tests replace this)."""
    with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.text


def clear_cache() -> None:
    _cache.clear()


def _cached(key: str, compute):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    value = compute()
    if len(_cache) > 300:
        _cache.clear()
    _cache[key] = (time.time() + TTL, value)
    return value


def _t(raw, limit=300) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(str(raw or "")))).strip()[:limit]


def _item(source, title, url, summary="", score=0, tags=None, when=None, kind="article") -> dict:
    return {"source": source, "title": _t(title, 200), "url": str(url or "")[:500], "summary": _t(summary), "score": int(score or 0),
            "tags": [str(x).lower()[:30] for x in (tags or []) if x][:8], "date": when, "kind": kind}


def _hn(topic: str) -> list[dict]:
    since = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp())
    data = json.loads(_fetch(f"https://hn.algolia.com/api/v1/search?tags=story&query={quote_plus(topic)}&numericFilters=points%3E40,created_at_i%3E{since}&hitsPerPage=12"))
    return [_item("Hacker News", h.get("title"), h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}",
                  f"{h.get('num_comments', 0)} comments", h.get("points"), [topic], (h.get("created_at") or "")[:10], "discussion")
            for h in data.get("hits", []) if h.get("title")]


def _devto(topic: str) -> list[dict]:
    tag = re.sub(r"[^a-z0-9]", "", topic.lower()) or "programming"
    data = json.loads(_fetch(f"https://dev.to/api/articles?tag={tag}&top=30&per_page=12"))
    return [_item("dev.to", a.get("title"), a.get("url"), a.get("description"), a.get("public_reactions_count"), a.get("tag_list"),
                  (a.get("published_at") or "")[:10], f"{a.get('reading_time_minutes', 5)} min read") for a in data if isinstance(a, dict)]


def _github(topic: str) -> list[dict]:
    since = (date.today() - timedelta(days=30)).isoformat()
    q = quote_plus(f"{topic} created:>{since}")
    data = json.loads(_fetch(f"https://api.github.com/search/repositories?q={q}&sort=stars&order=desc&per_page=8"))
    return [_item("GitHub", r.get("full_name"), r.get("html_url"), r.get("description"), r.get("stargazers_count"), (r.get("topics") or [])[:6] + [r.get("language") or ""],
                  (r.get("created_at") or "")[:10], "new repo") for r in data.get("items", [])]


SOURCES = {"Hacker News": _hn, "dev.to": _devto, "GitHub": _github}


def today_fact(day: date | None = None) -> dict | None:
    """Wikipedia's featured article and 'on this day' (learn one new thing about the world)."""
    d = day or date.today()

    def compute():
        data = json.loads(_fetch(f"https://en.wikipedia.org/api/rest_v1/feed/featured/{d.year}/{d.month:02d}/{d.day:02d}"))
        tfa = data.get("tfa") or {}
        onthisday = [{"year": e.get("year"), "text": _t(e.get("text"), 220)} for e in (data.get("onthisday") or [])[:3]]
        return {"title": _t(tfa.get("normalizedtitle") or tfa.get("title"), 120), "summary": _t(tfa.get("extract"), 600),
                "url": ((tfa.get("content_urls") or {}).get("desktop") or {}).get("page"), "on_this_day": onthisday}
    try:
        return _cached(f"wiki|{d.isoformat()}", compute)
    except (httpx.HTTPError, ValueError, KeyError):
        return None


TRACKS = [
    {"key": "se", "title": "Software engineer", "icon": "💻", "items": [
        ("Developer roadmaps (backend, frontend, DevOps, AI)", "https://roadmap.sh/"),
        ("System design primer", "https://github.com/donnemartin/system-design-primer"),
        ("The Missing Semester (shell, git, tools)", "https://missing.csail.mit.edu/"),
        ("Full Stack Open (React, Node, TypeScript)", "https://fullstackopen.com/en/"),
        ("Docker & Kubernetes basics", "https://kubernetes.io/docs/tutorials/kubernetes-basics/"),
        ("Clean code: refactoring.guru patterns", "https://refactoring.guru/design-patterns")]},
    {"key": "cs", "title": "Computer science", "icon": "🧠", "items": [
        ("Harvard CS50 (free)", "https://cs50.harvard.edu/x/"),
        ("Teach Yourself CS (curriculum)", "https://teachyourselfcs.com/"),
        ("MIT 6.006 Algorithms (OCW)", "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/"),
        ("NeetCode 150 (interview problems)", "https://neetcode.io/practice"),
        ("Operating Systems: Three Easy Pieces", "https://pages.cs.wisc.edu/~remzi/OSTEP/")]},
    {"key": "ai", "title": "AI and data", "icon": "🤖", "items": [
        ("fast.ai Practical Deep Learning", "https://course.fast.ai/"),
        ("Hugging Face LLM course", "https://huggingface.co/learn/llm-course"),
        ("Google ML crash course", "https://developers.google.com/machine-learning/crash-course"),
        ("Kaggle Learn (pandas, SQL, ML)", "https://www.kaggle.com/learn"),
        ("Anthropic prompt engineering guide", "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview")]},
    {"key": "life", "title": "Day-to-day life", "icon": "🌿", "items": [
        ("Personal finance basics (Khan Academy)", "https://www.khanacademy.org/college-careers-more/personal-finance"),
        ("First aid basics (Red Cross)", "https://www.redcross.org/take-a-class/first-aid"),
        ("Learning how to learn (Coursera, free audit)", "https://www.coursera.org/learn/learning-how-to-learn"),
        ("Cooking skills: Budget Bytes", "https://www.budgetbytes.com/"),
        ("Public speaking: TED Masterclass tips", "https://www.ted.com/read/ted-masterclass"),
        ("German daily phrases: DW Nicos Weg", "https://learngerman.dw.com/en/nicos-weg/c-36519789")]},
]


def radar(topics: list[str]) -> dict:
    topics = [t.strip()[:40] for t in topics if t and t.strip()][:6] or ["python", "ai", "web development"]
    errors: list[str] = []

    def run(pair):
        name, topic = pair
        try:
            return _cached(f"{name}|{topic.lower()}", lambda: SOURCES[name](topic))
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            errors.append(f"{name} ({topic}) didn't answer ({type(exc).__name__})")
            return []
    pairs = [(name, t) for t in topics for name in SOURCES]
    with ThreadPoolExecutor(max_workers=6) as pool:
        items = [i for chunk in pool.map(run, pairs) for i in chunk]
    seen, uniq = set(), []
    for i in sorted(items, key=lambda x: x["score"], reverse=True):
        if not i["url"].startswith("http") or i["url"] in seen:
            continue
        seen.add(i["url"])
        uniq.append(i)
    tags = Counter(t for i in uniq for t in i["tags"] if t and t not in {x.lower() for x in topics})
    return {
        "topics": topics, "items": uniq[:90],
        "summary": {"total": len(uniq), "by_source": Counter(i["source"] for i in uniq).most_common(), "hot_tags": tags.most_common(12),
                    "top": uniq[:3]},
        "today": today_fact(), "tracks": [{**t, "items": [{"title": a, "url": b} for a, b in t["items"]]} for t in TRACKS],
        "errors": errors, "source_note": "From Hacker News, dev.to, GitHub and Wikipedia public APIs. Links open the original page.",
    }
