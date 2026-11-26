"""Water and the Mindset studio: affirmations, scripting (incl. 55x5), gratitude and WOOP plans. Plain code.

Evidence-minded: affirmations are value-based ("I take care of my body"), not promises; scripting is paired with
WOOP (Wish, Outcome, Obstacle, Plan) because picturing the obstacle and an if-then plan works better than positive
fantasy alone. Optional: an emotion model (free, HF) reads the mood of what you write, only if you turn it on.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from urllib.parse import quote_plus

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc
from app.models.entities import Affirmation, BodyMeasurement, MindsetEntry, WaterLog, Workout

# ------------------------------------------------------------------ water

DEFAULT_ML = 2500


def water(db: Session, user_id, today: date, day_start_utc: datetime) -> dict:
    w = db.scalar(select(BodyMeasurement.weight_kg).where(BodyMeasurement.user_id == user_id, BodyMeasurement.weight_kg.is_not(None))
                  .order_by(BodyMeasurement.measured_on.desc()).limit(1))
    base = int(round(float(w) * 35 / 50) * 50) if w else DEFAULT_ML
    base = max(1500, min(4500, base))
    trained = db.scalar(select(Workout.id).where(Workout.user_id == user_id, Workout.started_at >= day_start_utc).limit(1)) is not None
    target = base + (500 if trained else 0)
    rows = db.scalars(select(WaterLog).where(WaterLog.user_id == user_id, WaterLog.local_date >= today - timedelta(days=13)).order_by(WaterLog.created_at)).all()
    by_day = Counter()
    for r in rows:
        by_day[r.local_date] += r.ml
    today_rows = [r for r in rows if r.local_date == today]
    total = by_day[today]
    streak, d = 0, today - timedelta(days=1)
    if total >= target:
        streak = 1
    while by_day[d] >= base:
        streak += 1
        d -= timedelta(days=1)
    return {"target_ml": target, "base_ml": base, "today_ml": total, "percent": min(100, round(total / target * 100)), "left_ml": max(0, target - total),
            "glasses": round(total / 250, 1), "trained_today": trained, "streak": streak,
            "entries": [{"id": r.id, "ml": r.ml, "at": as_utc(r.created_at).isoformat()} for r in reversed(today_rows)][:20],
            "week": [{"date": today - timedelta(days=i), "ml": by_day[today - timedelta(days=i)]} for i in range(6, -1, -1)],
            "how": (f"35 ml per kg of your latest weight ({float(w):.0f} kg)" if w else "2.5 L default; add your weight in Body measurements for a personal target")
                   + (" + 500 ml because you trained today." if trained else ".") + " Drink more in hot weather; follow your doctor if you have kidney or heart conditions."}


def add_water(db: Session, user_id, today: date, ml: int, day_start_utc: datetime | None = None) -> WaterLog:
    row = WaterLog(user_id=user_id, local_date=today, ml=ml)
    db.add(row); db.flush()
    if day_start_utc is not None:
        w = water(db, user_id, today, day_start_utc)
        if w["today_ml"] >= w["target_ml"]:
            from app.services import game
            game.award_safely(db, user_id, "water", f"water:{today}", "Daily water goal reached")
    return row


# ------------------------------------------------------------------ affirmations

CATS = {"confidence": "💪 Confidence", "discipline": "🎯 Discipline", "health": "🥗 Health", "money": "💰 Money mindset", "calm": "🌿 Calm",
        "study": "📚 Study", "custom": "✍️ My own"}
STARTER = {
    "confidence": ["I keep promises to myself, so I trust myself more each day.", "I can learn hard things one step at a time.",
                   "My worth isn't decided by one bad day."],
    "discipline": ["I do the important thing first, even when I don't feel like it.", "When I slip, I restart quickly without guilt.",
                   "Small actions, repeated, are building the person I want to be."],
    "health": ["I take care of my body because I want energy for my life.", "I move my body every day, even a little.",
               "I choose sleep over scrolling."],
    "money": ["I spend on what matters to me and save on what doesn't.", "Every skill I learn raises what I can earn.",
              "I build wealth slowly and steadily, not by luck."],
    "calm": ["I can pause, breathe and choose my next step.", "I don't have to solve everything today.", "My feelings are information, not orders."],
    "study": ["Focused practice today makes the exam easier tomorrow.", "Mistakes show me exactly what to learn next.",
              "I study in short, focused blocks and rest without guilt."],
}
VIDEOS = [("🌅 Morning affirmations", "morning affirmations positive mindset"), ("🌙 Sleep affirmations", "sleep affirmations calm"),
          ("🧘 Guided meditation (10 min)", "10 minute guided meditation"), ("🎯 Discipline & motivation", "discipline motivation speech"),
          ("🙏 Gratitude meditation", "gratitude meditation")]
WOOP_STEPS = {"wish": "Wish: what do you want? (challenging but possible)", "outcome": "Outcome: the best result, and how it would feel",
              "obstacle": "Obstacle: what inside you could stop you? (an emotion, habit or belief)", "plan": "Plan: If <obstacle>, then I will <action>."}


def ensure_starter(db: Session, user_id) -> None:
    if db.scalar(select(Affirmation.id).where(Affirmation.user_id == user_id).limit(1)) is None:
        for cat, texts in STARTER.items():
            for t in texts:
                db.add(Affirmation(user_id=user_id, text=t, category=cat))
        db.flush()


def _streak(days: set[date], today: date) -> int:
    n, d = 0, today if today in days else today - timedelta(days=1)
    while d in days:
        n += 1
        d -= timedelta(days=1)
    return n


def overview(db: Session, user_id, today: date) -> dict:
    ensure_starter(db, user_id)
    affs = db.scalars(select(Affirmation).where(Affirmation.user_id == user_id, Affirmation.active.is_(True)).order_by(Affirmation.created_at)).all()
    entries = db.scalars(select(MindsetEntry).where(MindsetEntry.user_id == user_id, MindsetEntry.local_date >= today - timedelta(days=90))
                         .order_by(MindsetEntry.created_at.desc())).all()
    days = lambda k: {e.local_date for e in entries if e.kind == k}  # noqa: E731
    favs = [a for a in affs if a.favorite] or affs
    pick = favs[today.toordinal() % len(favs)] if favs else None
    s55 = [e for e in entries if e.kind == "scripting" and (e.data or {}).get("mode") == "55x5"]
    s55_days = sorted({e.local_date for e in s55}, reverse=True)
    run = 0
    for i, d in enumerate(s55_days):
        if d == today - timedelta(days=i) or (i == 0 and d == today - timedelta(days=1)):
            run += 1
        else:
            break
    week = today - timedelta(days=6)
    return {"affirmation_of_the_day": {"id": pick.id, "text": pick.text, "category": pick.category} if pick else None,
            "affirmations": [{"id": a.id, "text": a.text, "category": a.category, "favorite": a.favorite} for a in affs],
            "categories": CATS, "read_today": today in days("affirm_read"), "read_streak": _streak(days("affirm_read"), today),
            "scripting_streak": _streak(days("scripting"), today), "gratitude_week": sum(1 for d in days("gratitude") if d >= week),
            "fifty_five": {"active": bool(s55_days) and s55_days[0] >= today - timedelta(days=1), "day": min(run, 5), "of": 5,
                           "statement": (s55[0].data or {}).get("statement") if s55 else None, "done_today": bool(s55_days) and s55_days[0] == today},
            "woop": [{"id": e.id, "date": e.local_date, **(e.data or {})} for e in entries if e.kind == "woop"][:10],
            "journal": [{"id": e.id, "kind": e.kind, "date": e.local_date, "body": e.body, "mood": (e.data or {}).get("mood"),
                         "items": (e.data or {}).get("items")} for e in entries if e.kind in ("scripting", "gratitude")][:20],
            "videos": [{"title": t, "url": f"https://www.youtube.com/results?search_query={quote_plus(q)}"} for t, q in VIDEOS],
            "woop_steps": WOOP_STEPS,
            "scripting_prompts": ["Write your ideal day one year from now, in the present tense: “I wake up at…”",
                                  "Describe yourself after reaching your top goal: how you think, act and spend your time.",
                                  "Write a thank-you letter from your future self to today's you, for the work you're putting in."],
            "honest": "Affirmations and scripting help focus, mood and planning; they don't make things happen by themselves. "
                      "Pair each one with an action: that's what WOOP plans are for."}


def add_entry(db: Session, user_id, today: date, kind: str, body: str | None, data: dict | None, ai_mood: bool = False) -> MindsetEntry:
    data = dict(data or {})
    if kind == "woop":
        for k in ("wish", "outcome", "obstacle", "plan"):
            if not str(data.get(k) or "").strip():
                raise HTTPException(422, f"WOOP needs a {k}")
            data[k] = str(data[k]).strip()[:300]
    elif kind == "gratitude":
        items = [str(x).strip()[:200] for x in (data.get("items") or []) if str(x).strip()][:5]
        if not items:
            raise HTTPException(422, "Write at least one thing you're grateful for")
        data = {"items": items}
        body = "\n".join(items)
    elif kind == "scripting":
        if not (body or "").strip():
            raise HTTPException(422, "Write something first")
        if data.get("mode") == "55x5":
            st = str(data.get("statement") or "").strip()[:200]
            if not st:
                raise HTTPException(422, "55x5 needs the statement you're writing")
            data = {"mode": "55x5", "statement": st, "lines": min(55, sum(1 for line in (body or "").splitlines() if line.strip()))}
        else:
            data = {"mode": "free"}
    elif kind == "affirm_read":
        if db.scalar(select(MindsetEntry.id).where(MindsetEntry.user_id == user_id, MindsetEntry.kind == "affirm_read", MindsetEntry.local_date == today)):
            return db.scalar(select(MindsetEntry).where(MindsetEntry.user_id == user_id, MindsetEntry.kind == "affirm_read", MindsetEntry.local_date == today))
        data, body = {}, None
    if ai_mood and body and kind in ("scripting", "gratitude"):
        from app.services import hf
        mood = hf.emotion(body)
        if mood:
            data["mood"] = mood
    row = MindsetEntry(user_id=user_id, kind=kind, local_date=today, body=(body or "").strip()[:20000] or None, data=data)
    db.add(row); db.flush()
    from app.services import game
    game.award_safely(db, user_id, "mindset", f"mindset:{kind}:{today}", {"affirm_read": "Affirmations read", "scripting": "Scripting",
                      "gratitude": "Gratitude", "woop": "WOOP plan"}.get(kind, kind))
    return row
