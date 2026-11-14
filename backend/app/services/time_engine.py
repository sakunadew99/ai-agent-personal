"""Phase 5 time engine (guide section 37). Plain code from data you already have: task estimates, focus sessions, routine.

- Planning multiplier: how long finished tasks really took (focus sessions) vs. your estimate.
- Capacity: waking hours - meals/breaks - buffer; work hours are capacity too (tasks include work).
- Load: open tasks due each day, estimate x multiplier. Warnings are informational only.
- Deep-work window: the hours where your focus sessions most often finish with few distractions.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import FocusSession, Task, UserProfile

DEFAULT_ESTIMATE = 30
MEALS_AND_BREAKS = 90       # minutes per day
BUFFER_SHARE = 0.15         # unscheduled share of the day (guide: 10-20%)
MIN_SAMPLES = 3
OPEN = ("inbox", "todo", "in_progress")
PRIORITY_RANK = {"high": 0, "medium": 1, "low": 2}


def _minutes_between(start: time, end: time) -> int:
    a, b = start.hour * 60 + start.minute, end.hour * 60 + end.minute
    return (b - a) % (24 * 60) or 24 * 60


def daily_capacity(wake: time | None, sleep: time | None) -> dict:
    waking = _minutes_between(wake or time(7, 0), sleep or time(23, 30))
    usable = max(0, waking - MEALS_AND_BREAKS)
    buffer = int(usable * BUFFER_SHARE)
    return {"waking_minutes": waking, "meals_and_breaks": MEALS_AND_BREAKS, "buffer_minutes": buffer, "plannable_minutes": usable - buffer}


def planning_multiplier(pairs: list[tuple[int, int]]) -> dict:
    """pairs = (estimate_minutes, actual_minutes) for finished tasks. Weighted ratio, clamped to 0.5-3x."""
    usable = [(e, a) for e, a in pairs if e > 0 and a > 0]
    if len(usable) < MIN_SAMPLES:
        return {"multiplier": 1.0, "sample_size": len(usable), "enough_data": False}
    ratio = sum(a for _, a in usable) / sum(e for e, _ in usable)
    return {"multiplier": round(min(3.0, max(0.5, ratio)), 2), "sample_size": len(usable), "enough_data": True}


def insights(db: Session, user_id, days: int = 7) -> dict:
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    tz = zone(profile.timezone if profile else None)
    now = now_utc()
    today = datetime.now(tz).date()

    # 1. Multiplier from the last 90 days of finished tasks that have timed focus sessions.
    sessions = db.scalars(select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.ended_at.is_not(None),
                                                     FocusSession.started_at >= now - timedelta(days=90))).all()
    actual_by_task: dict = defaultdict(int)
    for s in sessions:
        if s.task_id:
            actual_by_task[s.task_id] += max(0, int((as_utc(s.ended_at) - as_utc(s.started_at)).total_seconds() // 60))
    done = db.scalars(select(Task).where(Task.user_id == user_id, Task.id.in_(list(actual_by_task)),
                                         Task.status == "done")).all() if actual_by_task else []
    mult = planning_multiplier([(t.duration_minutes or DEFAULT_ESTIMATE, actual_by_task[t.id]) for t in done])
    m = mult["multiplier"]

    # 2. Capacity vs. load for the next `days` days.
    cap = daily_capacity(profile.wake_time if profile else None, profile.sleep_time if profile else None)
    horizon_end = datetime.combine(today + timedelta(days=days), time.min, tzinfo=tz).astimezone(timezone.utc)
    open_tasks = db.scalars(select(Task).where(Task.user_id == user_id, Task.status.in_(OPEN))).all()
    load: dict[date, int] = defaultdict(int)
    for t in open_tasks:
        if t.due_at is None:
            continue
        due = as_utc(t.due_at)
        if due >= horizon_end:
            continue
        day = max(today, due.astimezone(tz).date())  # overdue work lands on today
        load[day] += round((t.duration_minutes or DEFAULT_ESTIMATE) * m)
    # Busy time from Google Calendar (meetings, classes) reduces each day's capacity. Optional; ignored if not connected.
    from app.services.gcalendar import busy_minutes_by_day, list_events
    day_list = [today + timedelta(days=i) for i in range(days)]
    horizon_start = datetime.combine(today, time.min, tzinfo=tz).astimezone(timezone.utc)
    events, calendar_status = list_events(db, user_id, horizon_start, horizon_end)
    busy = busy_minutes_by_day([e for e in events if not e["from_sakuna"]], tz, day_list) if events else {}
    week = []
    warnings = []
    for day in day_list:
        planned = load.get(day, 0)
        capacity = max(0, cap["plannable_minutes"] - busy.get(day, 0))
        week.append({"date": day.isoformat(), "planned_minutes": planned, "calendar_busy_minutes": busy.get(day, 0),
                     "capacity_minutes": capacity, "free_minutes": capacity - planned, "overbooked": planned > capacity})
        if planned > capacity:
            warnings.append({"kind": "overbooked", "date": day.isoformat(),
                             "message": f"{day.strftime('%a %d %b')} is overbooked by {planned - capacity} min (after your x{m} multiplier"
                                        + (f" and {busy.get(day, 0)} min of calendar events" if busy.get(day) else "") + "). Move, shrink or drop something."})

    # 3. Deadline risk: high-priority work due within 48 h whose (adjusted) time exceeds what is free before it.
    soon = [t for t in open_tasks if t.due_at and now < as_utc(t.due_at) <= now + timedelta(hours=48)]
    for t in sorted(soon, key=lambda t: as_utc(t.due_at)):
        need = round((t.duration_minutes or DEFAULT_ESTIMATE) * m)
        if t.priority == "high" and need >= 120:
            warnings.append({"kind": "deadline_risk", "task_id": str(t.id),
                             "message": f"“{t.title}” is due {as_utc(t.due_at).astimezone(tz).strftime('%a %H:%M')} and likely needs ~{need} min. Block time for it today."})
    overdue = [t for t in open_tasks if t.due_at and as_utc(t.due_at) < now]
    if overdue:
        warnings.append({"kind": "overdue", "message": f"{len(overdue)} task(s) are overdue. Move, split or drop them, so nothing rolls over forever."})

    # 4. Deep-work window: start hours of focus sessions that ran >= 80% of plan with <= 1 distraction.
    good_hours: dict[int, int] = defaultdict(int)
    for s in sessions:
        length = (as_utc(s.ended_at) - as_utc(s.started_at)).total_seconds() / 60
        if s.minutes_planned and length >= 0.8 * s.minutes_planned and (s.distractions or 0) <= 1:
            good_hours[as_utc(s.started_at).astimezone(tz).hour] += 1
    deep = None
    if sum(good_hours.values()) >= MIN_SAMPLES:
        best = max(range(24), key=lambda h: (good_hours.get(h, 0) + good_hours.get((h + 1) % 24, 0), -h))
        deep = {"start": f"{best:02d}:00", "end": f"{(best + 2) % 24:02d}:00", "sessions": good_hours.get(best, 0) + good_hours.get((best + 1) % 24, 0)}

    # 5. Suggested top 3 for today: overdue/due today first, then priority, then soonest due.
    end_today = datetime.combine(today + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    def rank(t: Task):
        due = as_utc(t.due_at) if t.due_at else None
        return (0 if due and due < end_today else 1, PRIORITY_RANK.get(t.priority, 1), due or datetime.max.replace(tzinfo=timezone.utc))
    top = sorted(open_tasks, key=rank)[:3]

    # 6. Focus minutes by area this week (task category), and areas with open tasks but no focus time.
    week_start = datetime.combine(today - timedelta(days=today.weekday()), time.min, tzinfo=tz).astimezone(timezone.utc)
    task_cat = {t.id: t.category for t in db.scalars(select(Task).where(Task.user_id == user_id)).all()} if sessions else {}
    by_area: dict[str, int] = defaultdict(int)
    for s in sessions:
        if as_utc(s.started_at) >= week_start:
            by_area[task_cat.get(s.task_id, "unlinked") if s.task_id else "unlinked"] += max(0, int((as_utc(s.ended_at) - as_utc(s.started_at)).total_seconds() // 60))
    idle = sorted({t.category for t in open_tasks} - set(by_area))
    if idle and today.weekday() >= 3:
        warnings.append({"kind": "area_at_zero", "message": f"No focus time yet this week for: {', '.join(idle)}."})

    return {
        "timezone": str(tz), "multiplier": mult, "capacity": cap, "days": week, "calendar": calendar_status, "warnings": warnings, "deep_work_window": deep,
        "top3": [{"id": str(t.id), "title": t.title, "priority": t.priority, "due_at": t.due_at,
                  "estimate_minutes": t.duration_minutes or DEFAULT_ESTIMATE,
                  "adjusted_minutes": round((t.duration_minutes or DEFAULT_ESTIMATE) * m)} for t in top],
        "focus_minutes_by_area_this_week": dict(sorted(by_area.items())),
        "how": "Multiplier = time your finished tasks really took (focus sessions) ÷ your estimates. Needs 3+ finished tasks with timed focus.",
    }
