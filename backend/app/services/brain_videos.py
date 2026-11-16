"""Brain gym (BrainGymmer games, linked) and Watch (YouTube channel feeds: tech, AI, motivation, German).

Games open on braingymmer.com; Sakuna only links to them and logs "I played" as a habit (so streaks and points work).
Videos come from YouTube's public per-channel RSS feeds (no API key), cached 6 hours. Titles are untrusted data.
"""
from __future__ import annotations

import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Habit, HabitLog

USER_AGENT = "Mozilla/5.0 (Sakuna personal app; one user, cached)"
BG = "https://www.braingymmer.com/en/brain-games"

GAMES: list[tuple[str, str, str]] = [  # slug, name, skill (as BrainGymmer groups them)
    ("flip", "Flip", "Concentration"), ("post", "Post", "Concentration"), ("fin", "Fin", "Concentration"), ("shopshift", "ShopShift", "Concentration"),
    ("brainfreeze", "Brainfreeze", "Concentration"), ("bunny", "Bunny", "Concentration"),
    ("dolly", "Dolly", "Logic"), ("mastermind", "Mastermind", "Logic"), ("patterned_logic", "Patterned Logic", "Logic"),
    ("out_of_order", "Out of order", "Logic"), ("square_logic", "Square logic", "Logic"),
    ("digit", "Digit", "Memory"), ("pengo", "Pengo", "Memory"), ("mentile", "Mentile", "Memory"), ("moving_memory", "Moving Memory", "Memory"),
    ("n_back", "N Back", "Memory"), ("barista", "Barista", "Memory"), ("formix", "Formix", "Memory"), ("code", "Code", "Memory"), ("multi_memory", "Multi Memory", "Memory"),
    ("bubl", "Bubl", "Speed"), ("operator", "Operator", "Speed"), ("wordbird", "Wordbird", "Speed"), ("scale", "Scale", "Speed"),
    ("line_it_up", "Line it up", "Speed"), ("sliding_search", "Sliding Search", "Speed"),
    ("pattern_matrix", "Pattern Matrix", "Perception"), ("fuzzle", "Fuzzle", "Perception"), ("bait", "Bait", "Perception"), ("birdz", "Birdz", "Perception"),
    ("drumsolo", "Drumsolo", "Perception"), ("totem", "Totem", "Perception"), ("trail", "Trail", "Perception"),
]
SKILLS = {"Memory": ("🧠", "Remember more: names, numbers, vocabulary"), "Concentration": ("🎯", "Stay on one thing longer"),
          "Logic": ("🧩", "Plan and solve problems"), "Speed": ("⚡", "Think and react faster"), "Perception": ("👁", "Notice details and patterns")}
HABIT_NAME = "Brain games"


def game_out(slug: str, name: str, skill: str) -> dict:
    return {"slug": slug, "name": name, "skill": skill, "icon": SKILLS[skill][0], "url": f"{BG}/{slug}/play/"}


def todays_workout(day: date) -> list[dict]:
    """One game per skill, rotating by date, so every day is a new 5-game workout."""
    out = []
    for i, skill in enumerate(SKILLS):
        pool = [g for g in GAMES if g[2] == skill]
        out.append(game_out(*pool[(day.toordinal() + i) % len(pool)]))
    return out


def _habit(db: Session, user_id, create: bool) -> Habit | None:
    h = db.scalar(select(Habit).where(Habit.user_id == user_id, Habit.name == HABIT_NAME))
    if h is None and create:
        h = Habit(user_id=user_id, name=HABIT_NAME, schedule="daily", kind="build", icon="🧠", target_per_week=5)
        db.add(h); db.flush()
    elif h is not None and not h.active and create:
        h.active = True
    return h


def brain_view(db: Session, user_id, today: date) -> dict:
    h = _habit(db, user_id, create=False)
    days: set[date] = set()
    if h:
        days = set(db.scalars(select(HabitLog.logged_on).where(HabitLog.habit_id == h.id, HabitLog.completed.is_(True), HabitLog.logged_on >= today - timedelta(days=60))).all())
    streak, d = 0, today if today in days else today - timedelta(days=1)
    while d in days:
        streak += 1
        d -= timedelta(days=1)
    monday = today - timedelta(days=today.weekday())
    return {
        "skills": [{"skill": k, "icon": v[0], "why": v[1], "games": [game_out(*g) for g in GAMES if g[2] == k]} for k, v in SKILLS.items()],
        "workout": todays_workout(today), "played_today": today in days, "streak": streak,
        "week": [(monday + timedelta(days=i)) in days for i in range(7)], "days_30": sum(1 for x in days if x > today - timedelta(days=30)),
        "source": "Games by BrainGymmer (braingymmer.com). They open on their site; some games need a free account.",
    }


def played(db: Session, user_id, today: date) -> dict:
    h = _habit(db, user_id, create=True)
    exists = db.scalar(select(HabitLog).where(HabitLog.habit_id == h.id, HabitLog.logged_on == today))
    if exists is None or not exists.completed:
        if exists is None:
            db.add(HabitLog(habit_id=h.id, user_id=user_id, logged_on=today, completed=True))
        else:
            exists.completed = True
        db.flush()
        from app.services import game
        game.on_habit_logged(db, h, today)
    return brain_view(db, user_id, today)


# ---------- Watch: YouTube channel feeds ----------

CHANNELS: list[tuple[str, str, str]] = [  # channel id, name, shelf
    ("UCsBjURrPoezykLs9EqgamOA", "Fireship", "tech"), ("UCZgt6AzoyjslHTC9dz0UoTw", "ByteByteGo", "tech"),
    ("UC8butISFwT-Wl7EV0hUK0BQ", "freeCodeCamp", "tech"), ("UCdngmbVKX1Tgre699-XLlUA", "TechWorld with Nana", "tech"),
    ("UC9x0AN7BWHpCDHSm9NiJFJQ", "NetworkChuck", "tech"), ("UC9-y-6csu5WGm29I7JiwpnA", "Computerphile", "tech"),
    ("UCbfYPyITQ-7l4upoX8nvctg", "Two Minute Papers", "ai"), ("UCXUPKJO5MZQN11PqgIvyuvQ", "Andrej Karpathy", "ai"),
    ("UCYO_jab_esuFRV4b17AJtAw", "3Blue1Brown", "ai"),
    ("UCAuUUnT6oDeKwE6v1NGQxug", "TED", "motivation"), ("UCoOae5nYA7VqaXzerajD0lg", "Ali Abdaal", "motivation"),
    ("UCJ24N4O0bP7LGLBDvye7oCA", "Matt D'Avella", "motivation"), ("UCvQECJukTDE2i6aCoMnS-Vg", "Big Think", "motivation"),
    ("UC2D2CMWXMOVWx7giW1n3LIg", "Huberman Lab", "motivation"),
]
SHELVES = {"tech": "💻 Technology", "ai": "🤖 AI & science", "motivation": "🔥 Motivation & growth", "german": "🇩🇪 German", "mine": "⭐ Your channels"}
TTL = 6 * 3600
_cache: dict[str, tuple[float, object]] = {}
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "media": "http://search.yahoo.com/mrss/"}


def _fetch(url: str) -> str:
    """One GET (tests replace this)."""
    with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": USER_AGENT, "Accept-Language": "en"}) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.text


def clear_cache() -> None:
    _cache.clear()


class FeedDown(Exception):
    pass


def _feed(channel_id: str) -> list[dict]:
    hit = _cache.get(channel_id)
    if hit and hit[0] > time.time():
        if isinstance(hit[1], FeedDown):
            raise hit[1]
        return hit[1]  # type: ignore[return-value]
    text = None
    for attempt in range(2):                      # YouTube's feed service sometimes answers 404/5xx for a moment
        try:
            text = _fetch(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}")
            break
        except httpx.HTTPError:
            if attempt:
                down = FeedDown("feed unavailable")
                _cache[channel_id] = (time.time() + 600, down)    # don't ask again for 10 minutes
                raise down from None
            time.sleep(0.8)
    root = ET.fromstring(text or "")
    author = root.findtext("a:title", default="", namespaces=NS)
    out = []
    for e in root.findall("a:entry", NS)[:12]:
        vid = e.findtext("yt:videoId", default="", namespaces=NS)
        title = (e.findtext("a:title", default="", namespaces=NS) or "").strip()[:200]
        stats = e.find("media:group/media:community/media:statistics", NS)
        desc = (e.findtext("media:group/media:description", default="", namespaces=NS) or "").strip()
        if not vid or not title:
            continue
        out.append({"id": vid, "title": title, "channel": author, "channel_id": channel_id, "url": f"https://www.youtube.com/watch?v={vid}",
                    "thumb": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg", "published": (e.findtext("a:published", default="", namespaces=NS) or "")[:10],
                    "views": int(stats.get("views", "0")) if stats is not None and stats.get("views", "0").isdigit() else 0,
                    "short": "#shorts" in (title + desc).lower(), "about": re.sub(r"\s+", " ", desc)[:200]})
    if len(_cache) > 200:
        _cache.clear()
    _cache[channel_id] = (time.time() + TTL, out)
    return out


def resolve_channel(text: str) -> dict:
    """'@fireship', a channel URL or a UC… id -> channel id and name (reads the public channel page once)."""
    t = text.strip()
    m = re.search(r"(UC[A-Za-z0-9_-]{22})", t)
    if m:
        cid = m.group(1)
    else:
        handle = re.sub(r"^https?://(www\.)?youtube\.com/", "", t).strip("/").lstrip("@").split("/")[0]
        if not re.fullmatch(r"[A-Za-z0-9._-]{2,60}", handle or ""):
            raise HTTPException(422, "Paste a YouTube channel link or @handle")
        try:
            page = _fetch(f"https://www.youtube.com/@{handle}")
        except httpx.HTTPError as exc:
            raise HTTPException(404, "YouTube didn't find that channel") from exc
        m = re.search(r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[A-Za-z0-9_-]{22})', page) or re.search(r'"channelId":"(UC[A-Za-z0-9_-]{22})"', page)
        if not m:
            raise HTTPException(404, "Couldn't read that channel; paste its channel link instead")
        cid = m.group(1)
    try:
        items = _feed(cid)
    except (httpx.HTTPError, ET.ParseError, FeedDown):
        items = []                                # the feed may be briefly down; the channel id is still right
    return {"channel_id": cid, "name": items[0]["channel"] if items else cid}


def watch(my_channels: list[str], skip_shorts: bool = True) -> dict:
    mine = [c for c in my_channels if re.fullmatch(r"UC[A-Za-z0-9_-]{22}", c)][:15]
    plan = [(cid, name, shelf) for cid, name, shelf in CHANNELS] + [(cid, "", "mine") for cid in mine if cid not in {c[0] for c in CHANNELS}]
    errors: list[str] = []

    def run(row):
        try:
            return row, _feed(row[0])
        except (httpx.HTTPError, ET.ParseError, FeedDown):
            errors.append(row[1] or row[0])
            return row, []
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(run, plan))
    now = datetime.now(timezone.utc).date()
    shelves: dict[str, list[dict]] = {k: [] for k in SHELVES}
    for (cid, name, shelf), items in results:
        for v in items:
            if skip_shorts and v["short"]:
                continue
            shelves[shelf].append({**v, "shelf": shelf})
    picks = []
    for shelf, vids in shelves.items():
        fresh = [v for v in vids if v["published"] and (now - date.fromisoformat(v["published"])).days <= 21]
        vids.sort(key=lambda v: v["published"], reverse=True)
        # "Must watch": the most-viewed recent video per shelf (views per day since publishing).
        def heat(v):
            age = max(1, (now - date.fromisoformat(v["published"])).days) if v["published"] else 30
            return v["views"] / age
        picks += sorted(fresh, key=heat, reverse=True)[:2]
    by_shelf: dict[str, list[dict]] = {k: [] for k in SHELVES}
    for (cid, name, shelf), _items in results:
        by_shelf[shelf].append({"channel_id": cid, "name": name or (_items[0]["channel"] if _items else cid),
                                "url": f"https://www.youtube.com/channel/{cid}/videos", "ok": bool(_items)})
    return {"shelves": [{"key": k, "title": SHELVES[k], "videos": shelves[k][:24], "channels": by_shelf[k]} for k in SHELVES if by_shelf[k]],
            "must_watch": picks, "channels": [{"channel_id": c, "name": n, "shelf": s} for c, n, s in CHANNELS],
            "errors": [f"{len(errors)} channel feed(s) didn't answer right now; their channel links still work."] if errors else [],
            "source": "Latest uploads from YouTube channel feeds. Videos play on YouTube."}


# ---------- LinkedIn: search links only (LinkedIn doesn't allow scraping) ----------

def linkedin_links(keywords: str) -> list[dict]:
    from urllib.parse import quote_plus
    k = quote_plus(keywords)
    return [
        {"name": "LinkedIn posts", "url": f"https://www.linkedin.com/search/results/content/?keywords={k}&sortBy=%22date_posted%22"},
        {"name": "LinkedIn jobs (last 24 h)", "url": f"https://www.linkedin.com/jobs/search/?keywords={k}&f_TPR=r86400"},
        {"name": "LinkedIn hiring posts", "url": f"https://www.linkedin.com/search/results/content/?keywords={quote_plus(keywords + ' hiring')}&sortBy=%22date_posted%22"},
        {"name": "LinkedIn people", "url": f"https://www.linkedin.com/search/results/people/?keywords={k}"},
        {"name": "Google: LinkedIn posts this week", "url": f"https://www.google.com/search?q=site%3Alinkedin.com%2Fposts+{k}&tbs=qdr%3Aw"},
    ]
