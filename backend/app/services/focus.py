"""Life OS Phase 2: the focus engine ("1 hour, 1 task") and avoid-habits. Plain code, no AI.

Flow (the notebook method): clear target -> one task -> distractions blocked (on the phone) -> 50/10 or 25/5 ->
2-minute review (what got done, next step) -> break. Avoid-habits are things an app can't block (oversleeping, sugar,
gossip...): you log honestly, clean days earn points, a slip costs nothing.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import FocusSession, Habit, HabitLog, Task, UserProfile
from app.services.audit import audit

AVOID_STARTER = ["Oversleeping", "Sugar and oily food", "Gossip (wela kadha)", "Scrolling before or after sleep", "WhatsApp status"]


def _tz(db: Session, user_id):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(profile.timezone if profile else None)


def session_out(row: FocusSession) -> dict:
    minutes = None
    if row.ended_at is not None:
        minutes = round((as_utc(row.ended_at) - as_utc(row.started_at)).total_seconds() / 60, 1)
    return {"id": row.id, "task_id": row.task_id, "mode": row.mode, "minutes_planned": row.minutes_planned, "started_at": row.started_at,
            "ended_at": row.ended_at, "distractions": row.distractions, "notes": row.notes, "target": row.target,
            "break_minutes": row.break_minutes, "next_step": row.next_step, "rating": row.rating, "minutes": minutes,
            "ends_at": as_utc(row.started_at) + timedelta(minutes=row.minutes_planned)}


def finish(db: Session, row: FocusSession, data) -> dict:
    """The 2-minute review. Optionally marks the task done and turns the next step into a task."""
    from app.services import game
    from app.services.actions import complete_task, create_task
    from app.schemas.dto import TaskIn
    row.ended_at = now_utc()
    row.distractions, row.notes = data.distractions, data.notes
    row.next_step, row.rating = data.next_step, data.rating
    points = game.on_focus_finished(db, row)
    task = db.get(Task, row.task_id) if row.task_id else None
    if task is not None and task.user_id != row.user_id:
        task = None
    if task is not None and data.task_done:
        complete_task(db, task)
    created = None
    if data.next_step and data.next_as_task:
        created = create_task(db, row.user_id, TaskIn(title=data.next_step[:200], category=task.category if task else "work",
                                                       notes=f"Next step from focus session: {row.target or ''}".strip()[:2000]))
    audit(db, row.user_id, "focus.finish", "focus_session", row.id, {"task_done": bool(task and data.task_done)})
    db.flush()
    return {**session_out(row), "points": points, "next_task_id": created.id if created else None,
            "task_done": bool(task is not None and task.status == "done")}


def today_view(db: Session, user_id) -> dict:
    """Today's focus, plus your best focus hours from the last 14 days."""
    tz = _tz(db, user_id)
    today = datetime.now(tz).date()
    since = datetime.combine(today - timedelta(days=13), time.min, tzinfo=tz).astimezone(timezone.utc)
    rows = list(db.scalars(select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.started_at >= since)
                           .order_by(FocusSession.started_at)).all())
    active = next((r for r in rows if r.ended_at is None), None)
    if active is None:
        active = db.scalar(select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.ended_at.is_(None)))
    done = [r for r in rows if r.ended_at is not None]

    def minutes(r: FocusSession) -> float:
        return max(0.0, (as_utc(r.ended_at) - as_utc(r.started_at)).total_seconds() / 60)

    todays = [r for r in done if as_utc(r.started_at).astimezone(tz).date() == today]
    by_hour: Counter = Counter()
    by_day: Counter = Counter()
    for r in done:
        local = as_utc(r.started_at).astimezone(tz)
        by_hour[local.hour] += minutes(r)
        by_day[local.date()] += minutes(r)
    best = None
    if by_hour:
        start_hour = max(range(24), key=lambda h: by_hour[h] + by_hour[(h + 1) % 24])
        if by_hour[start_hour] + by_hour[(start_hour + 1) % 24] >= 20:
            best = {"from": f"{start_hour:02d}:00", "to": f"{(start_hour + 2) % 24:02d}:00",
                    "minutes": round(by_hour[start_hour] + by_hour[(start_hour + 1) % 24])}
    ratings = [r.rating for r in todays if r.rating]
    return {
        "date": today,
        "active": session_out(active) if active else None,
        "sessions": len(todays),
        "minutes": round(sum(minutes(r) for r in todays)),
        "longest": round(max((minutes(r) for r in todays), default=0)),
        "avg_rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
        "distractions": sum(r.distractions for r in todays),
        "last_sessions": [session_out(r) for r in reversed(todays[-5:])],
        "best_hours": best,
        "week": [{"date": d, "minutes": round(by_day[d])} for d in (today - timedelta(days=n) for n in range(6, -1, -1))],
    }


# ---------- avoid-habits ----------

def setup_avoid(db: Session, user_id) -> int:
    existing = {h.name.lower() for h in db.scalars(select(Habit).where(Habit.user_id == user_id)).all()}
    added = 0
    for name in AVOID_STARTER:
        if name.lower() not in existing:
            db.add(Habit(user_id=user_id, name=name, schedule="daily", kind="avoid", active=True))
            added += 1
    db.flush()
    audit(db, user_id, "habit.avoid_starter", "habit", None, {"added": added})
    return added


def avoid_view(db: Session, user_id) -> list[dict]:
    """Each avoid-habit: today (clean / slipped / not logged), the clean-day streak, and the last 7 days."""
    today = datetime.now(_tz(db, user_id)).date()
    habits = list(db.scalars(select(Habit).where(Habit.user_id == user_id, Habit.kind == "avoid", Habit.active.is_(True)).order_by(Habit.name)).all())
    out = []
    for h in habits:
        logs = {lg.logged_on: lg.completed for lg in db.scalars(select(HabitLog).where(
            HabitLog.habit_id == h.id, HabitLog.logged_on >= today - timedelta(days=90))).all()}
        # Today not logged yet doesn't break the streak; a slip today resets it (honest, but it costs no points).
        streak, day = 0, today if today in logs else today - timedelta(days=1)
        while logs.get(day) is True:
            streak += 1
            day -= timedelta(days=1)
        week = [{"date": d, "state": "clean" if logs.get(d) is True else "slipped" if logs.get(d) is False else "none"}
                for d in (today - timedelta(days=n) for n in range(6, -1, -1))]
        state = "clean" if logs.get(today) is True else "slipped" if logs.get(today) is False else "none"
        out.append({"id": h.id, "name": h.name, "today": state, "streak": streak, "week": week})
    return out


def local_today(db: Session, user_id) -> date:
    return datetime.now(_tz(db, user_id)).date()
