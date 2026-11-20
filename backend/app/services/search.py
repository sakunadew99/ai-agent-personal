"""Search everything you saved: keyword ranking always; "by meaning" too when HF_TOKEN is set (all-MiniLM-L6-v2).

Privacy: the journal is sent for meaning vectors only if you allow AI on your journal; documents (vault) and sensitive
memories are never sent (keyword search only). Vectors are cached per text hash, so each text is sent once.
"""
from __future__ import annotations

import hashlib
import math
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import (CaptureItem, Flashcard, Goal, Habit, JobApplication, JournalEntry, LifeEntry, MediaItem, Memory, Mistake,
                                 NewsItem, Task, TextVector, VaultDocument)
from app.services import hf

# model, kind, label, icon, screen, title fields, body fields, newest-first column, cap, may go to the meaning model
SOURCES = [
    (Task, "task", "Task", "☑", "Life", ["title"], ["notes", "category"], 400, True),
    (Goal, "goal", "Goal", "🎯", "Life", ["title"], ["description", "category"], 200, True),
    (Habit, "habit", "Habit", "🔁", "Life", ["name"], [], 100, True),
    (CaptureItem, "capture", "Inbox", "📥", "Capture", ["raw_text"], [], 300, True),
    (JournalEntry, "journal", "Journal", "✍️", "Journal", ["did"], ["lesson", "notes"], 300, "journal"),
    (Memory, "memory", "Memory", "🧩", "Memory", ["content"], ["category", "topic"], 300, "memory"),
    (MediaItem, "video", "Video", "🎬", "Videos", ["title"], ["folder"], 300, True),
    (NewsItem, "news", "News", "📰", "News", ["title"], ["excerpt"], 300, True),
    (Flashcard, "card", "Flashcard", "🗂", "Learning", ["front"], ["back", "example", "deck"], 400, True),
    (Mistake, "mistake", "Mistake note", "📝", "Learning", ["subject"], ["what_happened", "correction", "lesson"], 200, True),
    (JobApplication, "job", "Job", "💼", "Jobs", ["company", "role"], ["notes", "next_step", "status"], 200, True),
    (LifeEntry, "life", "Life entry", "🌱", "Life", ["title"], ["details", "entry_type"], 200, True),
    (VaultDocument, "doc", "Document", "🗂", "Vault", ["name"], ["kind"], 100, False),
]


def _words(s: str) -> list[str]:
    return re.findall(r"[\wäöüß]+", s.lower())


def _items(db: Session, user_id) -> list[dict]:
    from app.services.ai_client import settings_for
    cfg = settings_for(db, user_id)
    share_journal = cfg is None or cfg.share_journal
    out = []
    for model, kind, label, icon, screen, tf, bf, cap, meaning in SOURCES:
        q = select(model).where(model.user_id == user_id)
        if hasattr(model, "created_at"):
            q = q.order_by(model.created_at.desc())
        for r in db.scalars(q.limit(cap)).all():
            title = " · ".join(str(getattr(r, f)) for f in tf if getattr(r, f, None))
            body = " ".join(str(getattr(r, f)) for f in bf if getattr(r, f, None))
            if not title and not body:
                continue
            ok = meaning is True or (meaning == "journal" and share_journal) or (meaning == "memory" and getattr(r, "sensitivity", "normal") in (None, "normal", "low"))
            out.append({"kind": kind, "label": label, "icon": icon, "screen": screen, "id": str(r.id), "title": title[:160] or body[:160],
                        "snippet": body[:220], "text": f"{title}. {body}"[:600], "meaning_ok": bool(ok), "date": getattr(r, "created_at", None),
                        "url": getattr(r, "url", None) if kind in ("news",) else None})
    return out


def _vectors(db: Session, user_id, texts: list[str], budget: int = 160) -> dict[str, list[float]]:
    model = settings.hf_embedding_model
    hashes = {t: hashlib.sha256(f"{model}|{t}".encode()).hexdigest() for t in texts}
    have: dict[str, list[float]] = {}
    hv = list(set(hashes.values()))
    for i in range(0, len(hv), 500):
        for row in db.scalars(select(TextVector).where(TextVector.user_id == user_id, TextVector.model == model, TextVector.text_hash.in_(hv[i:i + 500]))).all():
            have[row.text_hash] = row.vector
    missing = [t for t in texts if hashes[t] not in have][:budget]           # the rest are embedded on later searches
    if missing:
        vecs = hf.embed(missing)
        if vecs:
            for t, v in zip(missing, vecs):
                if hashes[t] not in have:
                    have[hashes[t]] = v
                    db.add(TextVector(user_id=user_id, text_hash=hashes[t], model=model, vector=v))
            db.flush()
    return {t: have[h] for t, h in hashes.items() if h in have}


def search(db: Session, user_id, q: str, limit: int = 25) -> dict:
    q = q.strip()[:200]
    terms = [w for w in _words(q) if len(w) > 1]
    if not terms:
        return {"query": q, "results": [], "mode": "keyword"}
    items = _items(db, user_id)
    n = len(items) or 1
    df = {t: sum(1 for it in items if t in it["text"].lower()) for t in terms}
    for it in items:
        low, title = it["text"].lower(), it["title"].lower()
        s = 0.0
        for t in terms:
            if t in low:
                s += math.log(1 + n / (1 + df[t])) * (2 if t in title else 1)
        if q.lower() in low:
            s += 3
        it["kw"] = s
    mode = "keyword"
    qv = hf.embed([q]) if hf.enabled() else None
    if qv:
        pool = [it for it in items if it["meaning_ok"]]
        vecs = _vectors(db, user_id, [it["text"] for it in pool])
        if vecs:
            mode = "meaning"
            for it in pool:
                v = vecs.get(it["text"])
                it["sim"] = hf.cosine(qv[0], v) if v else 0.0
    top_kw = max((it["kw"] for it in items), default=0) or 1
    for it in items:
        sim = it.get("sim", 0.0)
        it["score"] = round(0.65 * max(0.0, (sim - 0.2) / 0.6) + 0.35 * it["kw"] / top_kw if mode == "meaning" else it["kw"] / top_kw, 3)
        it["why"] = "meaning + words" if sim >= 0.35 and it["kw"] else "similar meaning" if sim >= 0.35 else "words match" if it["kw"] else ""
    hits = [it for it in items if it["kw"] > 0 or it.get("sim", 0) >= 0.35]
    hits.sort(key=lambda it: -it["score"])
    return {"query": q, "mode": mode, "count": len(hits),
            "results": [{k: it[k] for k in ("kind", "label", "icon", "screen", "id", "title", "snippet", "score", "why", "date", "url")} for it in hits[:limit]],
            "note": None if mode == "meaning" else "Word search. Set HF_TOKEN on the server to also find things by meaning."}
