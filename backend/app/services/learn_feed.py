"""Learning feed: auto-selects only educational, motivational and psychology videos.

YouTube: latest uploads from trusted channels (+ yours) via the public channel RSS feeds (no key, no scraping).
Every video is classified by plain keyword rules; anything matching a "not for learning" rule (pranks, gossip,
reactions, gaming, music videos...) is hidden. Videos from your own channels must match a learning topic. If you
turn on the AI check and HF_TOKEN is set, unclear titles get a free zero-shot classification as a second opinion.
TikTok / Facebook have no feed API: you paste a link (with its caption or a note) and it's checked the same way.
Titles and captions are untrusted data, only ever classified, never followed.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone

import httpx

from app.services import brain_videos

CATS = {"technology": "💻 Technology", "educational": "📚 Educational", "motivational": "🔥 Motivation", "psychology": "🧠 Psychology"}
FOLDER = {"technology": "Learning · Technology", "educational": "Learning · Educational", "motivational": "Learning · Motivation",
          "psychology": "Learning · Psychology"}

# Verified channel ids (checked against YouTube's channel feeds).
LEARN_CHANNELS: list[tuple[str, str, str]] = [
    ("UCsXVk37bltHxD1rDPwtNM8Q", "Kurzgesagt", "educational"), ("UCX6b17PVsYBQ0ip5gyeme-Q", "CrashCourse", "educational"),
    ("UCsooa4yRKGN_zEE8iknghZA", "TED-Ed", "educational"), ("UCHnyfMqiRRG1u-2MsSQLbXA", "Veritasium", "educational"),
    ("UCZYTClx2T1of7BRZ86-8fow", "SciShow", "educational"), ("UC6nSFpj9HTCZ5t-N3Rm3-HA", "Vsauce", "educational"),
    ("UCtYLUTtgS3k1Fg4y5tAhLbw", "StatQuest", "educational"),
    ("UCG-KntY7aVnIGXYEBQvmBAQ", "Thomas Frank", "motivational"), ("UCtUId5WFnN82GdDy7DgaQ7w", "Better Ideas", "motivational"),
    ("UCBIt1VN5j37PVM8LLSuTTlw", "Improvement Pill", "motivational"),
    ("UC7IcJI8PUf5Z3zKxnZvTBog", "The School of Life", "psychology"), ("UCkJEpR7JmS36tajD34Gp4VA", "Psych2Go", "psychology"),
    ("UClHVl2N3jPEbkNJVx-ItQIQ", "HealthyGamerGG", "psychology"), ("UCUdettijNYvLAm4AixZv4RA", "SciShow Psych", "psychology"),
    ("UCpuqYFKLkcEryEieomiAv3Q", "Therapy in a Nutshell", "psychology"),
]
SHELF_CAT = {"tech": "technology", "ai": "technology", "german": "educational", "motivation": "motivational"}

KEYWORDS = {
    "technology": ["ai", "artificial intelligence", "llm", "gpt", "chatgpt", "claude", "gemini", "openai", "machine learning", "deep learning",
                   "robot", "robotics", "software", "developer", "programming", "python", "javascript", "typescript", "react", "cloud", "aws",
                   "kubernetes", "docker", "open source", "github", "startup", "chip", "chips", "semiconductor", "quantum", "cybersecurity",
                   "security", "data", "database", "api", "app", "apps", "smartphone", "tech", "technology", "engineering", "launch", "released",
                   "electric", "battery", "space", "nasa", "spacex", "computing", "computer", "agents", "automation", "framework", "linux"],
    "educational": ["learn", "explained", "explain", "how to", "how does", "how do", "why do", "why does", "what is", "what are", "tutorial", "course",
                    "lesson", "guide", "science", "history", "physics", "chemistry", "biology", "math", "mathematics", "economics", "engineering",
                    "programming", "python", "sql", "data", "ai", "machine learning", "coding", "lecture", "beginner", "crash course", "study",
                    "german", "english", "grammar", "language", "space", "universe", "brain", "research", "documentary", "skills", "finance", "investing",
                    "startup", "founder", "founders", "entrepreneur", "business", "career", "lessons", "case study"],
    "motivational": ["motivation", "motivational", "discipline", "habit", "habits", "productivity", "productive", "focus", "goal", "goals", "success",
                     "mindset", "self improvement", "self-improvement", "improve your life", "confidence", "consistency", "routine", "morning routine",
                     "inspiring", "inspiration", "never give up", "hard work", "life advice", "growth", "dopamine detox", "procrastination", "change your life"],
    "psychology": ["psychology", "psychologist", "anxiety", "depression", "mental health", "therapy", "therapist", "emotions", "emotional",
                   "relationships", "attachment", "trauma", "self-esteem", "self esteem", "personality", "introvert", "loneliness", "stress", "mindfulness",
                   "overthinking", "behavior", "behaviour", "cognitive", "narcissist", "burnout", "adhd", "motivation science", "body language", "social skills"],
}
BLOCK = {
    "prank": "prank", "reaction": "reaction video", "reacts": "reaction video", "gossip": "gossip", "drama": "drama", "exposed": "drama / exposé",
    "beef": "drama", "diss": "drama", "roast": "roast", "mukbang": "mukbang", "asmr": "ASMR", "unboxing": "unboxing", "haul": "shopping haul",
    "gameplay": "gaming", "let's play": "gaming", "fortnite": "gaming", "minecraft": "gaming", "gta": "gaming", "free fire": "gaming", "pubg": "gaming",
    "official music video": "music video", "lyric video": "music video", "trailer": "trailer", "epic fails": "fails compilation", "fails compilation": "fails compilation", "fail compilation": "fails compilation", "funny moments": "comedy clips",
    "you won't believe": "clickbait", "gone wrong": "clickbait", "celebrity": "celebrity news", "tiktok compilation": "compilation", "meme": "memes",
    "giveaway": "giveaway", "sexy": "adult",
    "hot girls": "adult", "18+": "adult", "nsfw": "adult", "betting": "gambling", "casino": "gambling",
}
# hidden unless the title is clearly about learning or psychology ("gaming addiction" stays, a game ad goes)
SOFT_BLOCK = {"gaming": "gaming", "game": "gaming", "sponsored": "advert", "#ad": "advert"}


def _has(text: str, phrase: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(phrase) + r"(?![a-z0-9])", text) is not None


def classify(title: str, about: str = "", trusted: str | None = None) -> dict:
    """Plain rules: block words first, then topic keywords (title counts double), then the channel's own topic if trusted."""
    t, a = title.lower(), (about or "").lower()[:400]
    for w, why in BLOCK.items():
        if _has(t, w):
            return {"category": None, "why": f"Hidden: {why}", "blocked": True, "method": "rules"}
    scores = {c: sum(2 for k in ks if _has(t, k)) + sum(1 for k in ks if _has(a, k)) for c, ks in KEYWORDS.items()}
    best = max(scores, key=lambda c: scores[c])
    for w, why in SOFT_BLOCK.items():
        if _has(t, w) and not (scores["psychology"] >= 2 or scores["educational"] >= 2 or trusted == "educational"):
            return {"category": None, "why": f"Hidden: {why}", "blocked": True, "method": "rules"}
    if scores[best] >= 2 or (scores[best] and trusted == best):
        hits = [k for k in KEYWORDS[best] if _has(t, k)][:3] or [k for k in KEYWORDS[best] if _has(a, k)][:3]
        return {"category": best, "why": f"Matched: {', '.join(hits)}", "blocked": False, "method": "rules"}
    if trusted:
        return {"category": trusted, "why": f"Trusted {CATS[trusted].split(' ', 1)[1].lower()} channel", "blocked": False, "method": "channel"}
    return {"category": None, "why": "Not clearly educational, motivational or psychology", "blocked": False, "method": "rules"}


AI_LABELS = {"educational": "education and learning", "motivational": "motivation and self-improvement", "psychology": "psychology and mental health",
             "other": "entertainment, gaming, gossip or news"}


def ai_classify(titles: list[str]) -> list[str | None]:
    """Second opinion for unclear titles (free HF zero-shot model). None when AI is off or unsure."""
    from app.services import hf
    return hf.zero_shot(titles, AI_LABELS)


def feed(my_channels: list[str], shorts: bool = False, ai: bool = False, only: str | None = None, limit: int = 90) -> dict:
    mine = [c for c in my_channels if re.fullmatch(r"UC[A-Za-z0-9_-]{22}", c)][:15]
    plan: dict[str, tuple[str, str | None]] = {cid: (name, cat) for cid, name, cat in LEARN_CHANNELS}
    for cid, name, shelf in brain_videos.CHANNELS:
        plan.setdefault(cid, (name, SHELF_CAT.get(shelf)))
    for cid in mine:
        plan.setdefault(cid, ("", None))             # your channels: not trusted for a topic, each video must match one

    def run(cid: str):
        try:
            return cid, brain_videos._feed(cid)
        except (httpx.HTTPError, ET.ParseError, brain_videos.FeedDown):
            return cid, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, plan))
    kept: list[dict] = []
    hidden: list[dict] = []
    unclear: list[dict] = []
    down = 0
    for cid, items in results:
        if items is None:
            down += 1
            continue
        for v in items:
            if v["short"] and not shorts:
                continue
            c = classify(v["title"], v.get("about", ""), plan[cid][1])
            row = {**v, "category": c["category"], "why": c["why"], "method": c["method"]}
            if c["category"]:
                kept.append(row)
            elif c["blocked"]:
                hidden.append(row)
            else:
                unclear.append(row)
    if ai and unclear:
        labels = ai_classify([u["title"] for u in unclear[:20]])
        for u, lab in zip(unclear[:20], labels):
            if lab in CATS:
                kept.append({**u, "category": lab, "why": "AI check: " + AI_LABELS[lab], "method": "ai"})
            else:
                hidden.append({**u, "why": "AI check: not a learning video" if lab == "other" else u["why"]})
        hidden += unclear[20:]
    else:
        hidden += unclear
    if only in CATS:
        kept = [k for k in kept if k["category"] == only]
    seen, uniq = set(), []
    for k in sorted(kept, key=lambda v: v["published"], reverse=True):
        if k["id"] not in seen:
            seen.add(k["id"]); uniq.append(k)
    today = datetime.now(timezone.utc).date()

    def heat(v):
        age = max(1, (today - date.fromisoformat(v["published"])).days) if v["published"] else 30
        return v["views"] / age

    picks = []
    for cat in CATS:
        fresh = [v for v in uniq if v["category"] == cat and v["published"] and (today - date.fromisoformat(v["published"])).days <= 14]
        picks += sorted(fresh, key=heat, reverse=True)[:1]
    return {"videos": uniq[:limit], "picks": picks, "counts": {c: sum(1 for v in uniq if v["category"] == c) for c in CATS},
            "hidden_count": len(hidden), "hidden": [{"title": h["title"], "channel": h["channel"], "why": h["why"]} for h in hidden[:12]],
            "categories": CATS, "channels": [{"channel_id": c, "name": n, "category": cat} for c, n, cat in LEARN_CHANNELS],
            "errors": [f"{down} channel feed(s) didn't answer right now."] if down else [],
            "how": "Only videos that match educational, motivational or psychology topics are shown; pranks, gossip, drama, gaming, "
                   "music videos, clickbait and adult content are hidden. Trusted channels count unless a video matches a hidden topic; "
                   "your own channels must match a topic." + (" Unclear titles got an AI second opinion." if ai else "")}


PLATFORMS = {"tiktok.com": "TikTok", "facebook.com": "Facebook", "fb.watch": "Facebook", "youtube.com": "YouTube", "youtu.be": "YouTube",
             "instagram.com": "Instagram", "linkedin.com": "LinkedIn", "ted.com": "TED", "vimeo.com": "Vimeo", "coursera.org": "Coursera",
             "khanacademy.org": "Khan Academy"}


def platform_of(url: str) -> str | None:
    host = re.sub(r"^https?://", "", url.strip().lower()).split("/")[0]
    for dom, name in PLATFORMS.items():
        if host == dom or host.endswith("." + dom):
            return name
    return None
