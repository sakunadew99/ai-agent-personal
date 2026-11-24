"""Learning reels: a "For you" ranking over videos that already passed the learning filter.

How a reel is scored (all plain, explainable maths; the AI part is optional):
  0.8 freshness + 0.6 popularity (views per day)
+ 1.2 topic affinity   (what you like / finish / watch long vs skip / hide, per category)
+ 1.0 channel affinity (same signals per channel)
+ 1.5 similarity to videos you liked (free MiniLM embeddings when HF_TOKEN is set, else word overlap)
+ 1.0 goal match       (words from your active goals, e.g. "German", "Python")
Then a diversity pass (no channel twice in a row, mixed topics) and an exploration slot every 5th reel
(a channel you haven't tried yet), so the feed doesn't collapse into one bubble. Seen, skipped and hidden
videos don't come back; a channel you hide twice disappears. Only learning content is ever a candidate.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import FeedEvent, Goal, MediaItem
from app.services import learn_feed

STOP = set("the a an and or of to in on for with is are be you your how why what this that from at by it its into about i my me we our new "
           "video part ep episode official full can will just more most best".split())
W_ACTION = {"like": 3.0, "unlike": -3.0, "save": 3.0, "complete": 2.0, "skip": -1.0, "hide": -4.0}
_emb_cache: dict[str, list[float]] = {}


def tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z][a-z0-9+#]{2,}", (text or "").lower()) if w not in STOP]


def _cos(a: Counter, b: Counter) -> float:
    num = sum(a[k] * b[k] for k in a if k in b)
    den = math.sqrt(sum(v * v for v in a.values())) * math.sqrt(sum(v * v for v in b.values()))
    return num / den if den else 0.0


def profile(events: list[FeedEvent]) -> dict:
    cat, chan, hide_ch = Counter(), Counter(), Counter()
    seen: set[str] = set()
    liked: set[str] = set()
    positive: list[str] = []
    for e in events:
        w = min(e.seconds or 0, 600) / 120 if e.action == "view" else W_ACTION.get(e.action, 0.0)
        if e.category:
            cat[e.category] += w
        if e.channel_id:
            chan[e.channel_id] += w
        if e.action in ("like", "save", "complete") or (e.action == "view" and (e.seconds or 0) >= 60):
            if e.title:
                positive.append(e.title)
        if e.action == "like":
            liked.add(e.video_id)
        elif e.action == "unlike":
            liked.discard(e.video_id)
        if e.action in ("complete", "skip", "hide") or (e.action == "view" and (e.seconds or 0) >= 15):
            seen.add(e.video_id)
        if e.action == "hide" and e.channel_id:
            hide_ch[e.channel_id] += 1
    words = Counter(t for title in positive[-60:] for t in tokens(title))
    return {"cat": {k: math.tanh(v / 5) for k, v in cat.items()}, "chan": {k: math.tanh(v / 5) for k, v in chan.items()},
            "seen": seen, "liked": liked, "words": words, "positive": positive[-30:], "blocked_channels": {c for c, n in hide_ch.items() if n >= 2},
            "events": len(events)}


def _goal_words(db: Session, user_id) -> dict[str, str]:
    out: dict[str, str] = {}
    for g in db.scalars(select(Goal).where(Goal.user_id == user_id, Goal.status == "active")).all():
        for t in tokens(" ".join([g.title, g.next_action or "", " ".join(g.skills or [])])):
            out.setdefault(t, g.title)
    return out


def _embed_sim(titles: list[str], positive: list[str]) -> list[float] | None:
    """Cosine similarity of each title to the centre of the titles you liked (free MiniLM via HF), or None."""
    from app.services import hf
    if not positive or not hf.enabled():
        return None
    todo = [t for t in dict.fromkeys(titles + positive) if t not in _emb_cache]
    if todo:
        vecs = hf.embed(todo)
        if vecs is None:
            return None
        _emb_cache.update(zip(todo, vecs))
        if len(_emb_cache) > 4000:
            _emb_cache.clear()
            return None
    pv = [_emb_cache[p] for p in positive if p in _emb_cache]
    if not pv:
        return None
    centre = [sum(col) / len(pv) for col in zip(*pv)]
    return [max(0.0, hf.cosine(_emb_cache[t], centre)) if t in _emb_cache else 0.0 for t in titles]


def _embed_url(platform: str, url: str) -> str | None:
    if platform == "TikTok":
        m = re.search(r"/video/(\d{6,25})", url)
        return f"https://www.tiktok.com/player/v1/{m.group(1)}" if m else None
    if platform == "Facebook":
        return f"https://www.facebook.com/plugins/video.php?href={quote(url, safe='')}&show_text=false"
    if platform == "YouTube":
        m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
        return f"https://www.youtube.com/embed/{m.group(1)}" if m else None
    if platform == "LinkedIn":                                   # LinkedIn's official post embed
        m = re.search(r"(?:activity[-:]|urn:li:activity:)(\d{15,25})", url)
        if m:
            return f"https://www.linkedin.com/embed/feed/update/urn:li:activity:{m.group(1)}"
        m = re.search(r"urn:li:(share|ugcPost):(\d{15,25})", url)
        return f"https://www.linkedin.com/embed/feed/update/urn:li:{m.group(1)}:{m.group(2)}" if m else None
    if platform == "TED":
        m = re.search(r"ted\.com/talks/([A-Za-z0-9_]+)", url)
        return f"https://embed.ted.com/talks/{m.group(1)}" if m else None
    if platform == "Vimeo":
        m = re.search(r"vimeo\.com/(?:video/)?(\d{5,12})", url)
        return f"https://player.vimeo.com/video/{m.group(1)}" if m else None
    return None


def rank(db: Session, user_id, candidates: list[dict], today: date, limit: int = 20) -> list[dict]:
    events = db.scalars(select(FeedEvent).where(FeedEvent.user_id == user_id, FeedEvent.created_at >= datetime.now(timezone.utc) - timedelta(days=120))
                        .order_by(FeedEvent.created_at)).all()
    p = profile(list(events))
    goals = _goal_words(db, user_id)
    pool = [c for c in candidates if c["id"] not in p["seen"] and c.get("channel_id") not in p["blocked_channels"]]
    sims = _embed_sim([c["title"] for c in pool], p["positive"])
    scored = []
    for i, c in enumerate(pool):
        age = max(1, (today - date.fromisoformat(c["published"])).days) if c.get("published") else 30
        fresh = math.exp(-age / 14)
        pop = min(1.0, math.log1p((c.get("views") or 0) / age) / math.log1p(100_000))
        cat_aff = p["cat"].get(c["category"], 0.0)
        ch_aff = p["chan"].get(c.get("channel_id") or "", 0.0)
        toks = tokens(c["title"])
        sim = sims[i] if sims is not None else (_cos(Counter(toks), p["words"]) if p["words"] else 0.0)
        goal_hit = next((goals[t] for t in toks if t in goals), None)
        s = 0.8 * fresh + 0.6 * pop + 1.2 * cat_aff + 1.0 * ch_aff + 1.5 * sim + (1.0 if goal_hit else 0.0)
        if goal_hit:
            reason = f"Supports your goal: {goal_hit}"
        elif ch_aff > 0.3:
            reason = "From a channel you enjoy"
        elif sim > 0.3:
            reason = "Similar to videos you liked"
        elif cat_aff > 0.3:
            reason = f"Because you like {learn_feed.CATS[c['category']].split(' ', 1)[1].lower()}"
        elif pop > 0.6:
            reason = "Popular this week"
        else:
            reason = f"New in {learn_feed.CATS[c['category']].split(' ', 1)[1].lower()}"
        scored.append({**c, "score": round(s, 3), "reason": reason, "liked": c["id"] in p["liked"], "_aff": ch_aff})
    scored.sort(key=lambda x: -x["score"])
    out: list[dict] = []
    left = scored[:]
    while left and len(out) < limit:
        if p["events"] >= 5 and len(out) % 5 == 4:                     # exploration slot: a channel you haven't engaged with
            new = [x for x in left if x["_aff"] == 0 and x.get("channel_id") not in {o.get("channel_id") for o in out}]
            if new:
                pick = max(new, key=lambda x: x["score"])
                pick = {**pick, "reason": "Something new to explore"}
                out.append(pick); left = [x for x in left if x["id"] != pick["id"]]
                continue
        recent = out[-2:]

        def adjusted(x):
            pen = 0.6 if any(o.get("channel_id") == x.get("channel_id") for o in recent) else 0.0
            pen += 0.3 if len(recent) == 2 and all(o["category"] == x["category"] for o in recent) else 0.0
            return x["score"] - pen
        pick = max(left, key=adjusted)
        out.append(pick); left = [x for x in left if x["id"] != pick["id"]]
    for o in out:
        o.pop("_aff", None)
    return out


def saved_items(db: Session, user_id, seen: set[str]) -> list[dict]:
    rows = db.scalars(select(MediaItem).where(MediaItem.user_id == user_id, MediaItem.folder.like("Learning%")).order_by(MediaItem.created_at.desc()).limit(30)).all()
    cat_of = {v: k for k, v in learn_feed.FOLDER.items()}
    out = []
    for r in rows:
        vid = f"m:{r.id}"
        if vid in seen:
            continue
        plat = learn_feed.platform_of(r.url) or "Link"
        out.append({"id": vid, "kind": plat.lower(), "title": re.sub(r"^\[[^\]]+\]\s*", "", r.title), "channel": f"Saved from {plat}", "channel_id": None,
                    "category": cat_of.get(r.folder, "educational"), "url": r.url, "thumb": "", "embed": _embed_url(plat, r.url), "published": "",
                    "views": 0, "reason": "From your saved clips", "media_id": str(r.id), "liked": False})
    return out


def reels(db: Session, user_id, channels: list[str], today: date, ai: bool = False, limit: int = 20) -> dict:
    feed = learn_feed.feed(channels, shorts=True, ai=ai, limit=200)
    cands = [{**v, "kind": "youtube", "embed": f"https://www.youtube.com/embed/{v['id']}"} for v in feed["videos"]]
    ranked = rank(db, user_id, cands, today, limit)
    events = db.scalars(select(FeedEvent).where(FeedEvent.user_id == user_id)).all()
    seen = profile(list(events))["seen"]
    saved = saved_items(db, user_id, seen)
    for k, s in enumerate(saved[:4]):                                  # your saved TikTok / Facebook clips, mixed in
        ranked.insert(min(len(ranked), 2 + k * 5), s)
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    wk = [e for e in events if e.created_at and (e.created_at if e.created_at.tzinfo else e.created_at.replace(tzinfo=timezone.utc)) >= week_ago]
    mins = Counter()
    for e in wk:
        if e.action == "view" and e.category:
            mins[e.category] += (e.seconds or 0) / 60
    return {"items": ranked, "hidden_count": feed["hidden_count"], "errors": feed["errors"],
            "stats": {"minutes_week": round(sum(mins.values())), "by_category": {k: round(v) for k, v in mins.items()},
                      "likes_week": sum(1 for e in wk if e.action == "like")},
            "how": __doc__.split("\n\n", 1)[1].strip() if __doc__ else "",
            "shield": "Shield can block the YouTube, Facebook and TikTok apps; these reels play inside Sakuna, so they keep working."}


def record(db: Session, user_id, items: list[dict]) -> int:
    n = 0
    for it in items[:50]:
        db.add(FeedEvent(user_id=user_id, video_id=str(it["video_id"])[:40], channel_id=(it.get("channel_id") or None) and str(it["channel_id"])[:40],
                         category=it.get("category") if it.get("category") in learn_feed.CATS else None, title=(it.get("title") or "")[:200] or None,
                         action=it["action"], seconds=max(0, min(int(it.get("seconds") or 0), 86400))))
        n += 1
    db.flush()
    return n



def hub(db: Session, user_id, channels: list[str], today: date, only: str | None = None, exclude: set[str] | None = None, limit: int = 24) -> dict:
    """A Facebook-style learning feed: posts and videos ranked "For you", mixed two posts to one video, plus a reels row."""
    from app.services import posts
    exclude = exclude or set()
    feed = learn_feed.feed(channels, shorts=True, ai=False, limit=200)
    vids = [{**v, "kind": "youtube", "embed": f"https://www.youtube.com/embed/{v['id']}"} for v in feed["videos"]]
    post_items, post_hidden, down = posts.fetch_all()
    if only in learn_feed.CATS:
        vids = [v for v in vids if v["category"] == only]
        post_items = [p for p in post_items if p["category"] == only]
    vids = [v for v in vids if v["id"] not in exclude]
    post_items = [p for p in post_items if p["id"] not in exclude]
    rv = rank(db, user_id, vids, today, limit)
    rp = rank(db, user_id, post_items, today, limit * 2)
    events = db.scalars(select(FeedEvent).where(FeedEvent.user_id == user_id)).all()
    saved = [x for x in saved_items(db, user_id, profile(list(events))["seen"]) if x["id"] not in exclude and (not only or x["category"] == only)]
    items: list[dict] = []
    while (rp or rv) and len(items) < limit:
        for _ in range(2):
            if rp and len(items) < limit:
                items.append(rp.pop(0))
        if rv and len(items) < limit:
            items.append(rv.pop(0))
        if not rp and not rv:
            break
    for k, x in enumerate(saved[:3]):
        items.insert(min(len(items), 4 + k * 7), x)
    goal_words = list(_goal_words(db, user_id))
    return {"items": items, "reels": [v for v in rank(db, user_id, vids, today, 10)], "categories": learn_feed.CATS,
            "hidden_count": feed["hidden_count"] + post_hidden, "errors": (feed["errors"] + ([f"{down} post feed(s) didn't answer right now."] if down else [])),
            "linkedin": posts.linkedin_links(goal_words),
            "sources": [{"name": n, "topic": t} for n, _u, t in posts.SOURCES],
            "how": "Posts from trusted science, technology, psychology and self-improvement publishers and videos from trusted channels; "
                   "everything passes the learning filter, then is ranked by what you read, watch, like and skip, your goals and freshness."}
