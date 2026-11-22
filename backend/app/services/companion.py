"""Proactive companion: one useful question at a time, with buttons, at a frequency you choose.

Plain rules pick the question from your data (a goal you haven't touched, free time in today's plan, a skill behind its
weekly target, the weekend). It never asks during your quiet hours or sleep, and "off" means it never asks.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import CheckinSetting, Goal, Task, UserProfile

FOCUS = [
    {"key": "skills", "label": "🎯 Improve my skills"}, {"key": "money", "label": "💰 Earn more money"},
    {"key": "health", "label": "💪 Improve my health"}, {"key": "learn", "label": "📚 Learn something new"},
    {"key": "relax", "label": "🌿 Relax and enjoy life"}, {"key": "plan", "label": "🗓 Show my daily plan"},
]
FREQ = ("daily", "few_weekly", "useful", "off")


def _settings(db: Session, user_id) -> CheckinSetting:
    row = db.scalar(select(CheckinSetting).where(CheckinSetting.user_id == user_id))
    if row is None:
        row = CheckinSetting(user_id=user_id, interval_minutes=30, enabled=True, ask_frequency="useful")
        db.add(row); db.flush()
    return row


def _quiet(now_local: datetime, s: CheckinSetting, p: UserProfile | None) -> bool:
    t = now_local.time()

    def inside(a, b):
        return a <= t < b if a <= b else (t >= a or t < b)
    if s.quiet_start and s.quiet_end and inside(s.quiet_start, s.quiet_end):
        return True
    if p and p.sleep_time and p.wake_time and inside(p.sleep_time, p.wake_time):
        return True
    return False


def question(db: Session, user_id, force: bool = False) -> dict:
    s = _settings(db, user_id)
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    tz = zone(p.timezone if p else "Asia/Colombo")
    now_local = now_utc().astimezone(tz)
    today = now_local.date()
    base = {"frequency": s.ask_frequency, "frequencies": list(FREQ)}
    if not force:
        if s.ask_frequency == "off":
            return {**base, "question": None, "why_none": "You turned proactive questions off."}
        if _quiet(now_local, s, p):
            return {**base, "question": None, "why_none": "Quiet hours: I'll ask later."}
        if s.last_question_on == today and s.ask_frequency != "useful":
            return {**base, "question": None, "why_none": "Already asked today."}
        if s.ask_frequency == "few_weekly" and today.isoweekday() not in (1, 3, 5):
            return {**base, "question": None, "why_none": "I ask on Monday, Wednesday and Friday."}
    q = _pick(db, user_id, now_local)
    if s.ask_frequency == "useful" and not force and q["kind"] == "focus" and s.last_question_on == today:
        return {**base, "question": None, "why_none": "Nothing especially useful to ask right now."}
    return {**base, "question": q}


def _pick(db: Session, user_id, now_local: datetime) -> dict:
    from app.services import smart, wellbeing
    week_ago = now_utc() - timedelta(days=7)
    goals = db.scalars(select(Goal).where(Goal.user_id == user_id, Goal.status == "active")).all()
    recent_task_goals = {t.goal_id for t in db.scalars(select(Task).where(Task.user_id == user_id, Task.goal_id.is_not(None))).all()
                         if (t.completed_at and as_utc(t.completed_at) >= week_ago) or (t.created_at and as_utc(t.created_at) >= week_ago)}
    stale = [g for g in goals if g.id not in recent_task_goals and as_utc(g.created_at) < week_ago]
    if stale:
        g = stale[0]
        return {"kind": "stale_goal", "goal_id": str(g.id), "text": f"You haven't worked on “{g.title}” this week. Would you like to take one small step today?",
                "choices": [{"key": "step", "label": "✅ Yes, one small step"}, {"key": "later", "label": "⏰ Later this week"}, {"key": "pause", "label": "⏸ Pause this goal"}]}
    try:
        skills = wellbeing.skills_overview(db, user_id)["skills"]
        behind = [k for k in skills if k["active"] and k["weekly_minutes"] and (k["week_pct"] or 0) < 50 and now_local.weekday() >= 3]
        if behind:
            k = behind[0]
            return {"kind": "skill", "skill_id": str(k["id"]), "text": f"{k['icon']} {k['name']} is at {k['week_minutes']}/{k['weekly_minutes']} minutes this week. 15 minutes now?",
                    "choices": [{"key": "practice", "label": "▶ Practise now"}, {"key": "later", "label": "Tomorrow"}]}
    except Exception:  # noqa: BLE001 - skills are optional here
        pass
    try:
        plan = smart.today_plan(db, user_id)
        now_min = now_local.hour * 60 + now_local.minute
        for gap in plan.get("gaps", []):
            start = int(gap["start"][:2]) * 60 + int(gap["start"][3:5]) if isinstance(gap, dict) and gap.get("start") else None
            end = int(gap["end"][:2]) * 60 + int(gap["end"][3:5]) if isinstance(gap, dict) and gap.get("end") else None
            if start is not None and end is not None and start <= now_min and end - now_min >= 30:
                return {"kind": "free_time", "text": f"You're free until {gap['end']}. Would you like to practise English or German for 15 minutes?",
                        "choices": [{"key": "english", "label": "🇬🇧 English"}, {"key": "german", "label": "🇩🇪 German"}, {"key": "rest", "label": "🌿 Just rest"}]}
    except Exception:  # noqa: BLE001 - the plan is optional here
        pass
    if now_local.isoweekday() in (5, 6) and now_local.hour >= 12:
        return {"kind": "weekend", "text": "The weekend is here. Would you like to plan something enjoyable?",
                "choices": [{"key": "trip", "label": "🏞 A short trip"}, {"key": "friends", "label": "👫 Time with people"}, {"key": "rest", "label": "🛋 Proper rest"}]}
    return {"kind": "focus", "text": "What would you like to focus on today?", "choices": FOCUS}


ANSWERS = {
    "skills": ("Great. Pick one skill and do a 15-minute session; small reps every day beat long sessions once a week.", [("🎯 Open Skills", "Skills"), ("🎙 Speaking coach", "Speak")]),
    "money": ("Let's do one income step: improve one gig or send one tailored proposal today.", [("💼 Jobs & freelancing", "Jobs"), ("📈 Invest", "Invest"), ("👛 Money", "Finance")]),
    "health": ("A 30-minute walk or a gym session, plus water and an early night, is a strong health day.", [("🏋️ Gym", "Gym"), ("❤️ Health", "Health"), ("💊 Medicines", "Meds")]),
    "learn": ("Choose one topic and finish one small unit today: 15 focused minutes.", [("📚 Learning", "Learning"), ("🎯 Say it", "Learning"), ("🎬 My videos", "Videos")]),
    "relax": ("Good choice. Rest is part of progress. Put the phone down for a bit and do something you enjoy.", [("🧘 Pose coach (yoga)", "Skills"), ("✍️ Journal", "Journal")]),
    "plan": ("Here's your day.", [("🗓 Open my plan", "Plan")]),
    "step": ("Pick the smallest action that moves it forward. I've opened your goals so you can choose.", [("🎯 Dreams & goals", "Dreams")]),
    "later": ("No problem. I'll ask again another day.", []),
    "pause": ("Paused. You can resume it any time from Dreams & goals.", [("🎯 Dreams & goals", "Dreams")]),
    "practice": ("Let's go. Open the skill and log it when you're done.", [("🎯 Skills", "Skills")]),
    "english": ("Try 3 sentences in Say it, then a 1-minute talk in Speaking coach.", [("🎯 Say it", "Learning"), ("🎙 Speaking coach", "Speak")]),
    "german": ("Try 5 sentences in Say it and review your German cards.", [("🎯 Say it", "Learning"), ("🎓 Cards", "Learning")]),
    "rest": ("Enjoy the break. Short real breaks keep you sharp.", []),
    "trip": ("Pick a place within 3 hours, set a budget, and add it to your wish list.", [("👛 Money wish list", "Finance")]),
    "friends": ("Message one person now and fix a time; plans that are booked happen.", []),
}


def answer(db: Session, user_id, choice: str, goal_id: str | None = None) -> dict:
    s = _settings(db, user_id)
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    s.last_question_on = now_utc().astimezone(zone(p.timezone if p else "Asia/Colombo")).date()
    if choice == "pause" and goal_id:
        try:
            g = db.get(Goal, uuid.UUID(str(goal_id)))
        except ValueError:
            g = None
        if g is not None and g.user_id == user_id:                   # only your own goal
            g.status = "paused"
    text, actions = ANSWERS.get(choice, ("Okay.", []))
    db.flush()
    return {"text": text, "actions": [{"label": lbl, "open": target} for lbl, target in actions]}


def set_frequency(db: Session, user_id, freq: str) -> dict:
    s = _settings(db, user_id)
    s.ask_frequency = freq
    db.flush()
    return {"frequency": freq}
