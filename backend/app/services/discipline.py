"""Personal discipline & digital wellbeing: commitments, urge check-ins, triggers, replacements, insights.

Supportive and private by design: plain code only (never sent to AI), not part of "search everything", neutral labels
on shared screens. A slip is a "reset", not a failure: your best streak and total clean days are kept.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import DisciplineEvent, DisciplineGoal

KINDS = {"porn_free": "Porn-free", "nofap": "No-fap", "screen": "Less late-night scrolling", "custom": "My own goal"}
TRIGGERS = {"boredom": "Boredom", "stress": "Stress", "loneliness": "Loneliness", "late_night": "Late night / in bed", "tired": "Tired",
            "social_media": "Social media / scrolling", "anxiety": "Anxiety or low mood", "habit": "Habit / same time and place", "other": "Something else"}
DEFAULT_REPLACEMENTS = ["10-minute walk", "20 push-ups or squats", "Cold water on face", "Read 10 pages", "Call or message a friend",
                        "Breathing: 4 in, 6 out for 2 minutes", "Say it drill (German / English)", "Shower", "Tidy one small area", "Write 3 lines in the journal"]
BY_TRIGGER = {
    "boredom": ["Start a 25-minute focus task", "Read 10 pages", "Learn 10 German words"],
    "stress": ["Breathing: 4 in, 6 out for 2 minutes", "10-minute walk outside", "Write what's stressing you, then one next step"],
    "loneliness": ["Message or call a friend or family member", "Go somewhere with people (gym, café, library)", "Join a class or group"],
    "late_night": ["Put the phone outside the bedroom now", "Read a paper book", "Lights off and slow breathing"],
    "tired": ["Go to sleep now", "Shower and get into bed without the phone", "Drink water and rest"],
    "social_media": ["Close the app and turn on Focus / Shield", "Move to another room", "Do 20 squats"],
    "anxiety": ["Breathing: 4 in, 6 out for 2 minutes", "Talk to someone you trust", "Walk for 10 minutes"],
    "habit": ["Change the place: leave the room", "Do the planned replacement for this time", "Set Shield for this hour every day"],
    "other": ["Get up and change what you're doing for 10 minutes", "Cold water on face", "10-minute walk"],
}
MILESTONES = [1, 3, 7, 14, 30, 60, 90, 180, 365]
MOTIVATION = [
    "Every urge you ride out makes the next one a little weaker. You've done it before; you can do it now.",
    "Urges rise and then fall, like a wave. Stay busy for 10 minutes and let it pass.",
    "You're not your urges. You choose what to do next.",
    "Progress isn't a perfect streak; it's coming back every time. Keep going.",
    "Think of the person in your goals: healthy, focused, confident. One small choice right now moves you there.",
]
SUPPORT = ("If you ever feel unable to cope, or this is affecting your mood, relationships or work, talking to a doctor or a counsellor "
           "can really help. In Sri Lanka you can call the 1926 National Mental Health Helpline or Sumithrayo on 011 2 696 666.")


def _streak(g: DisciplineGoal, today: date) -> int:
    return max(0, (today - g.streak_start).days)


def goal_out(db: Session, g: DisciplineGoal, today: date) -> dict:
    events = db.scalars(select(DisciplineEvent).where(DisciplineEvent.goal_id == g.id).order_by(DisciplineEvent.created_at.desc())).all()
    streak = _streak(g, today)
    best = max(g.best_streak, streak)
    month = [e for e in events if e.local_date >= today - timedelta(days=30)]
    urges = [e for e in month if e.kind == "urge"]
    handled = [e for e in urges if e.stayed is True]
    trig = Counter(e.trigger for e in urges if e.trigger)
    hours = Counter(e.local_hour for e in urges)
    night = sum(n for h, n in hours.items() if h >= 22 or h < 2)
    insights = []
    if urges:
        insights.append(f"You handled {len(handled)} of {len(urges)} urges in the last 30 days without slipping.")
    if trig:
        top, n = trig.most_common(1)[0]
        insights.append(f"Most common trigger: {TRIGGERS.get(top, top).lower()} ({n} times). Plan a replacement for it in advance.")
    if urges and night >= max(2, len(urges) // 2):
        insights.append("Most urges come late at night: charge the phone outside the bedroom and turn on Shield at 22:00.")
    if g.resets and streak >= 3:
        insights.append(f"You restarted and you're {streak} days in. That's what matters.")
    nxt = next((m for m in MILESTONES if m > streak), None)
    checked_today = any(e.local_date == today and e.kind in ("ok", "urge") for e in events)
    return {"id": g.id, "kind": g.kind, "kind_label": KINDS.get(g.kind, g.kind), "label": g.label, "reasons": g.reasons,
            "replacements": g.replacements or DEFAULT_REPLACEMENTS[:6], "started_on": g.started_on, "streak_days": streak, "best_streak": best,
            "resets": g.resets, "clean_days_total": (today - g.started_on).days - _slip_days(events), "active": g.active,
            "next_milestone": nxt, "milestones": [{"days": m, "reached": best >= m} for m in MILESTONES],
            "checked_in_today": checked_today, "urges_30d": len(urges), "handled_30d": len(handled),
            "triggers_30d": [{"trigger": k, "label": TRIGGERS.get(k, k), "count": v} for k, v in trig.most_common()],
            "late_night_urges_30d": night, "insights": insights,
            "recent": [{"id": e.id, "kind": e.kind, "trigger": e.trigger, "intensity": e.intensity, "action": e.action, "stayed": e.stayed,
                        "note": e.note, "date": e.local_date, "hour": e.local_hour} for e in events[:15]]}


def _slip_days(events) -> int:
    return len({e.local_date for e in events if e.kind == "reset"})


def suggestions(g: DisciplineGoal, trigger: str | None, hour: int) -> list[str]:
    out = list(BY_TRIGGER.get(trigger or "other", BY_TRIGGER["other"]))
    if hour >= 22 or hour < 2:
        out.insert(0, "Put the phone outside the bedroom now")
    for r in g.replacements or []:
        if r not in out:
            out.append(r)
    return list(dict.fromkeys(out))[:6]


def record(db: Session, g: DisciplineGoal, kind: str, today: date, hour: int, trigger: str | None = None, intensity: int | None = None,
           action: str | None = None, stayed: bool | None = None, note: str | None = None) -> dict:
    if trigger and trigger not in TRIGGERS:
        raise HTTPException(422, f"trigger must be one of {', '.join(TRIGGERS)}")
    db.add(DisciplineEvent(user_id=g.user_id, goal_id=g.id, kind=kind, trigger=trigger, intensity=intensity, action=(action or None) and action[:80],
                           stayed=stayed, note=(note or "").strip()[:2000] or None, local_date=today, local_hour=hour))
    reply: dict = {"kind": kind}
    if kind == "reset":
        g.best_streak = max(g.best_streak, _streak(g, today))
        g.resets += 1
        g.streak_start = today
        reply["message"] = ("Thank you for being honest. A reset isn't failure: your best streak and every clean day still count. "
                            "What happened just before? Noticing it is how the next streak gets longer.")
        reply["suggestions"] = suggestions(g, trigger, hour)
    elif kind == "urge":
        reply["message"] = "Good that you checked in. Urges rise and then fall. Pick one thing below and do it for 10 minutes; I'll be here."
        reply["suggestions"] = suggestions(g, trigger, hour)
        reply["timer_minutes"] = 10
    elif kind == "motivation":
        streak = _streak(g, today)
        reply["message"] = MOTIVATION[(streak + g.resets) % len(MOTIVATION)]
        if g.reasons:
            reply["your_why"] = g.reasons
        reply["streak_days"] = streak
    else:
        reply["message"] = "Great. Another day in your favour. Keep your evening plan ready for the tricky hours."
    reply["support"] = SUPPORT
    db.flush()
    return reply
