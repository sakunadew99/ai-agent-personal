"""Phase 3 read models and milestone rules: upcoming reminders, the month view, goal milestones. All user-scoped."""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import CheckinSetting, Goal, GoalMilestone, Task, UserProfile
from app.schemas.dto import MilestoneIn, MilestoneUpdate
from app.services.audit import audit
from app.services.recurrence import occurrences, parse_rule, respect_quiet_hours

OPEN = ("inbox", "todo", "in_progress")


def _tz(db: Session, user_id):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(profile.timezone if profile else None)


def upcoming_reminders(db: Session, user_id, days: int = 7, lead_minutes: int = 10) -> dict:
    """Open tasks due in the next `days`, with a notify time that respects quiet hours. The phone schedules these locally."""
    tz = _tz(db, user_id)
    setting = db.scalar(select(CheckinSetting).where(CheckinSetting.user_id == user_id))
    quiet_start = setting.quiet_start if setting else None
    quiet_end = setting.quiet_end if setting else None
    now = now_utc()
    rows = db.scalars(select(Task).where(
        Task.user_id == user_id, Task.status.in_(OPEN), Task.due_at.is_not(None),
        Task.due_at > now, Task.due_at <= now + timedelta(days=days),
    ).order_by(Task.due_at).limit(200)).all()
    items = []
    for row in rows:
        due = as_utc(row.due_at)
        wanted = max(due - timedelta(minutes=lead_minutes), now + timedelta(minutes=1))
        notify = respect_quiet_hours(wanted, tz, quiet_start, quiet_end).astimezone(timezone.utc)
        items.append({"task_id": row.id, "title": row.title, "due_at": due, "notify_at": notify,
                      "moved_for_quiet_hours": notify != wanted})
    return {"timezone": str(tz), "quiet_start": quiet_start, "quiet_end": quiet_end, "items": items}


def month_view(db: Session, user_id, month: str | None) -> dict:
    """Tasks (with future repeats projected), goal deadlines and milestones, grouped by local date."""
    tz = _tz(db, user_id)
    if month:
        try:
            year, mon = (int(part) for part in month.split("-"))
            first = date(year, mon, 1)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "month must look like 2026-11") from exc
    else:
        first = datetime.now(tz).date().replace(day=1)
    following = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    start = datetime.combine(first, time.min, tzinfo=tz).astimezone(timezone.utc)
    end = datetime.combine(following, time.min, tzinfo=tz).astimezone(timezone.utc)
    days: dict[str, list[dict]] = {}

    def put(day: date, entry: dict) -> None:
        days.setdefault(day.isoformat(), []).append(entry)

    tasks = db.scalars(select(Task).where(Task.user_id == user_id, Task.due_at.is_not(None),
                                          Task.due_at >= start, Task.due_at < end, Task.status != "cancelled")).all()
    for row in tasks:
        due = as_utc(row.due_at)
        put(due.astimezone(tz).date(), {"kind": "task", "id": str(row.id), "title": row.title, "at": due.isoformat(),
                                        "status": row.status, "repeat": bool(row.recurrence)})
    # Show the future of each open repeating series as "planned repeats" (not stored until the previous one is done).
    series = db.scalars(select(Task).where(Task.user_id == user_id, Task.recurrence.is_not(None),
                                           Task.status.in_(OPEN), Task.due_at.is_not(None), Task.due_at < end)).all()
    for row in series:
        try:
            rule = parse_rule(row.recurrence or "")
        except ValueError:
            continue
        anchor = as_utc(row.due_at)
        after = max(anchor, now_utc(), start - timedelta(microseconds=1))  # same rule as spawning: never in the past
        for moment in occurrences(rule, anchor, tz, after, end, limit=62):
            put(moment.date(), {"kind": "repeat", "id": str(row.id), "title": row.title,
                                "at": moment.astimezone(timezone.utc).isoformat(), "status": "planned", "repeat": True})
    goals = db.scalars(select(Goal).where(Goal.user_id == user_id, Goal.due_date >= first, Goal.due_date < following)).all()
    for goal in goals:
        put(goal.due_date, {"kind": "goal", "id": str(goal.id), "title": goal.title, "at": None, "status": goal.status})
    stones = db.scalars(select(GoalMilestone).where(GoalMilestone.user_id == user_id, GoalMilestone.due_date >= first,
                                                    GoalMilestone.due_date < following)).all()
    for stone in stones:
        put(stone.due_date, {"kind": "milestone", "id": str(stone.id), "goal_id": str(stone.goal_id), "title": stone.title,
                             "at": None, "status": "done" if stone.done_at else "open"})
    for entries in days.values():
        entries.sort(key=lambda e: (e["at"] is None, e["at"] or "", e["title"]))
    return {"month": first.strftime("%Y-%m"), "timezone": str(tz), "first_weekday": 0, "days": dict(sorted(days.items()))}


def _goal(db: Session, user_id, goal_id: uuid.UUID) -> Goal:
    goal = db.get(Goal, goal_id)
    if goal is None or goal.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return goal


def list_milestones(db: Session, user_id, goal_id: uuid.UUID | None = None) -> list[GoalMilestone]:
    statement = select(GoalMilestone).where(GoalMilestone.user_id == user_id)
    if goal_id is not None:
        _goal(db, user_id, goal_id)
        statement = statement.where(GoalMilestone.goal_id == goal_id)
    return list(db.scalars(statement.order_by(GoalMilestone.position, GoalMilestone.due_date.asc().nullslast(),
                                              GoalMilestone.created_at)).all())


def create_milestone(db: Session, user_id, goal_id: uuid.UUID, data: MilestoneIn) -> GoalMilestone:
    _goal(db, user_id, goal_id)
    row = GoalMilestone(user_id=user_id, goal_id=goal_id, **data.model_dump())
    db.add(row)
    db.flush()
    audit(db, user_id, "milestone.create", "goal_milestone", row.id, {"goal_id": str(goal_id)})
    return row


def update_milestone(db: Session, row: GoalMilestone, data: MilestoneUpdate) -> GoalMilestone:
    changes = data.model_dump(exclude_unset=True)
    done = changes.pop("done", None)
    for key, value in changes.items():
        if key == "title" and value is None:
            continue
        setattr(row, key, value)
    if done is True and row.done_at is None:
        row.done_at = now_utc()
    elif done is False:
        row.done_at = None
    row.updated_at = now_utc()
    audit(db, row.user_id, "milestone.update", "goal_milestone", row.id)
    return row
