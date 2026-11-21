"""Morning and evening rituals (2 minutes each). Plain code gathers your day; nothing is decided for you.

Morning: today's plan, medicines, top tasks, last night's sleep -> you pick energy, mood and one focus (saved as the daily check-in).
Evening: what the day looked like (tasks done, focus, steps, practice, medicines, spending) -> mood, wins, one lesson
(saved in the journal) and tomorrow's top 3 (saved as tasks for tomorrow, because you typed them).
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import (DailyCheckin, Expense, FocusSession, HealthRecord, JournalEntry, SkillSession, SleepRecord, Task,
                                 UserProfile)
from app.schemas.dto import TaskIn
from app.services import actions


def _tz(db: Session, user_id):
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(p.timezone if p else "Asia/Colombo")


def _bounds(db: Session, user_id):
    tz = _tz(db, user_id)
    today = now_utc().astimezone(tz).date()
    start = datetime.combine(today, time.min, tz)
    return tz, today, start, start + timedelta(days=1)


def _open_tasks(db: Session, user_id, limit: int = 5) -> list[Task]:
    rank = {"high": 0, "medium": 1, "low": 2}
    rows = db.scalars(select(Task).where(Task.user_id == user_id, Task.status.in_(["todo", "in_progress"]))).all()
    far = datetime.max.replace(tzinfo=None)
    rows = sorted(rows, key=lambda t: (as_utc(t.due_at).replace(tzinfo=None) if t.due_at else far, rank.get(t.priority, 1)))
    return rows[:limit]


def morning(db: Session, user_id) -> dict:
    from app.services import smart, wellbeing
    tz, today, start, end = _bounds(db, user_id)
    plan = smart.today_plan(db, user_id)
    meds = wellbeing.medicines_today(db, user_id)
    sleep = db.scalars(select(SleepRecord).where(SleepRecord.user_id == user_id, SleepRecord.end_at >= start - timedelta(hours=14),
                                                SleepRecord.end_at < end).order_by(SleepRecord.end_at.desc()).limit(1)).first()
    done = db.scalar(select(DailyCheckin).where(DailyCheckin.user_id == user_id, DailyCheckin.local_date == today))
    tasks = _open_tasks(db, user_id, 3)
    hour = now_utc().astimezone(tz).hour
    return {"date": today, "greeting": "Good morning" if hour < 12 else "Good afternoon" if hour < 17 else "Good evening",
            "sleep_hours": round(sleep.duration_minutes / 60, 1) if sleep and sleep.duration_minutes else None,
            "blocks": [{"start": b["start"], "end": b["end"], "title": b["title"]} for b in plan.get("blocks", [])][:6],
            "doses": [d for d in meds["doses"] if d["status"] in ("due", "later")][:6],
            "tasks": [{"id": t.id, "title": t.title, "priority": t.priority} for t in tasks],
            "suggested_focus": tasks[0].title if tasks else None,
            "done": done is not None, "saved": {"energy": done.energy, "mood": done.mood, "focus": (done.note or "").removeprefix("Focus: ")} if done else None}


def save_morning(db: Session, user_id, energy: int, mood: int, focus: str | None) -> DailyCheckin:
    _, today, _, _ = _bounds(db, user_id)
    row = db.scalar(select(DailyCheckin).where(DailyCheckin.user_id == user_id, DailyCheckin.local_date == today))
    note = f"Focus: {focus.strip()}" if focus and focus.strip() else None
    if row is None:
        row = DailyCheckin(user_id=user_id, local_date=today, energy=energy, mood=mood, note=note)
        db.add(row)
    else:
        row.energy, row.mood, row.updated_at = energy, mood, now_utc()
        if note:
            row.note = note
    db.flush()
    return row


def evening(db: Session, user_id) -> dict:
    from app.services import wellbeing
    tz, today, start, end = _bounds(db, user_id)
    done = db.scalars(select(Task).where(Task.user_id == user_id, Task.status == "done", Task.completed_at >= start, Task.completed_at < end)).all()
    focus = sum(int(((as_utc(f.ended_at) - as_utc(f.started_at)).total_seconds()) // 60) for f in db.scalars(select(FocusSession).where(
        FocusSession.user_id == user_id, FocusSession.started_at >= start, FocusSession.started_at < end, FocusSession.ended_at.is_not(None))).all())
    steps = db.scalar(select(func.max(HealthRecord.value)).where(HealthRecord.user_id == user_id, HealthRecord.metric == "steps",
                                                               HealthRecord.recorded_at >= start, HealthRecord.recorded_at < end))
    practice = db.scalar(select(func.coalesce(func.sum(SkillSession.minutes), 0)).where(SkillSession.user_id == user_id, SkillSession.local_date == today))
    spent = db.scalars(select(Expense).where(Expense.user_id == user_id, Expense.spent_at >= start, Expense.spent_at < end)).all()
    by_cur: dict[str, Decimal] = {}
    for e in spent:
        by_cur[e.currency] = by_cur.get(e.currency, Decimal(0)) + Decimal(e.amount)
    meds = wellbeing.medicines_today(db, user_id)
    journal = db.scalar(select(JournalEntry).where(JournalEntry.user_id == user_id, JournalEntry.local_date == today))
    checkin = db.scalar(select(DailyCheckin).where(DailyCheckin.user_id == user_id, DailyCheckin.local_date == today))
    focus_goal = (checkin.note or "").removeprefix("Focus: ") if checkin and checkin.note else None
    return {"date": today, "tasks_done": [t.title for t in done][:10], "focus_minutes": focus, "steps": int(steps) if steps else 0,
            "practice_minutes": int(practice or 0), "spent": {k: str(v.quantize(Decimal("0.01"))) for k, v in by_cur.items()},
            "doses_taken": sum(1 for d in meds["doses"] if d["status"] == "taken"), "doses_total": len(meds["doses"]),
            "morning_focus": focus_goal, "open_tasks": [{"id": t.id, "title": t.title} for t in _open_tasks(db, user_id, 6)],
            "done": journal is not None and bool(journal.mood),
            "saved": {"mood": journal.mood, "wins": journal.positives or [], "lesson": journal.lesson} if journal else None}


def save_evening(db: Session, user_id, mood: int, wins: list[str], lesson: str | None, tomorrow: list[str]) -> dict:
    tz, today, _, _ = _bounds(db, user_id)
    row = db.scalar(select(JournalEntry).where(JournalEntry.user_id == user_id, JournalEntry.local_date == today))
    wins = [w.strip()[:200] for w in wins if w and w.strip()][:5]
    if row is None:
        row = JournalEntry(user_id=user_id, local_date=today, mood=mood, positives=wins, lesson=(lesson or "").strip() or None,
                           negatives=[], gratitude=[], tags=["evening"])
        db.add(row)
    else:
        row.mood = mood
        row.positives = list(dict.fromkeys([*(row.positives or []), *wins]))[:10]
        if lesson and lesson.strip():
            row.lesson = lesson.strip()
        row.updated_at = now_utc()
    open_titles = {t.title.strip().lower() for t in db.scalars(select(Task).where(Task.user_id == user_id, Task.status.in_(["todo", "in_progress"]))).all()}
    due = datetime.combine(today + timedelta(days=1), time(9, 0), tz)
    created = []
    for i, title in enumerate([t.strip() for t in tomorrow if t and t.strip()][:3]):
        if title.lower() in open_titles:
            continue
        task = actions.create_task(db, user_id, TaskIn(title=title[:200], priority="high" if i == 0 else "medium", due_at=due + timedelta(hours=i)))
        created.append(task.title)
    db.flush()
    return {"saved": True, "tasks_created": created}
