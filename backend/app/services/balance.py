"""Whole-life balance (guide 20): weekly target vs actual per life area, from data you already log. No single "life score".

Areas and how 'actual' is measured (plain code; manual logs always add on top):
  work          focus hours on work/business (and unlinked) sessions
  money         days you recorded money (expense, income or a balance check)
  health        active days: a workout of 15+ min or your steps target
  learning      days with any learning: flashcard reviews, learning tasks done or learning focus
  relationships manual check-ins (until the relationships feature exists)
  rest          manual rest blocks / free evenings
  home          personal/home tasks finished
Health numbers are for tracking, not medical advice.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import (
    AccountAdjustment, AreaEntry, Expense, FlashcardReview, FocusSession, HealthRecord, Income, LifeArea, SleepRecord, Task, UserProfile, Workout,
)

DEFAULT_AREAS = [  # key, name, metric, unit, weekly target
    ("work", "Work", "focus_hours_work", "hours", Decimal("15")),
    ("money", "Money", "money_days", "days", Decimal("4")),
    ("health", "Health", "active_days", "days", Decimal("4")),
    ("learning", "Learning", "learning_days", "days", Decimal("4")),
    ("relationships", "Relationships", "manual", "check-ins", Decimal("3")),
    ("rest", "Rest & hobbies", "manual", "blocks", Decimal("3")),
    ("home", "Home & admin", "tasks_done_personal", "tasks", Decimal("4")),
]
METRICS = ("focus_hours_work", "money_days", "active_days", "learning_days", "tasks_done_personal", "manual")


def _tz(db: Session, user_id):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(profile.timezone if profile else None)


def areas_for(db: Session, user_id) -> list[LifeArea]:
    rows = list(db.scalars(select(LifeArea).where(LifeArea.user_id == user_id).order_by(LifeArea.position, LifeArea.created_at)).all())
    if not rows:
        for pos, (key, name, metric, unit, target) in enumerate(DEFAULT_AREAS):
            db.add(LifeArea(user_id=user_id, key=key, name=name, metric=metric, unit=unit, weekly_target=target, position=pos))
        db.flush()
        rows = list(db.scalars(select(LifeArea).where(LifeArea.user_id == user_id).order_by(LifeArea.position)).all())
    return rows


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _bounds(tz, start: date) -> tuple[datetime, datetime]:
    lo = datetime.combine(start, time.min, tzinfo=tz).astimezone(timezone.utc)
    return lo, lo + timedelta(days=7)


def _measure(db: Session, user_id, metric: str, tz, lo: datetime, hi: datetime) -> Decimal:
    local = lambda dt: as_utc(dt).astimezone(tz).date()  # noqa: E731
    if metric == "focus_hours_work":
        rows = db.execute(select(FocusSession.started_at, FocusSession.ended_at, Task.category).outerjoin(Task, Task.id == FocusSession.task_id)
                          .where(FocusSession.user_id == user_id, FocusSession.ended_at.is_not(None), FocusSession.started_at >= lo, FocusSession.started_at < hi)).all()
        minutes = sum(max(0.0, (as_utc(e) - as_utc(s)).total_seconds() / 60) for s, e, cat in rows if cat in (None, "work", "business"))
        return Decimal(str(round(minutes / 60, 1)))
    if metric == "money_days":
        days = {local(d) for d in db.scalars(select(Expense.created_at).where(Expense.user_id == user_id, Expense.created_at >= lo, Expense.created_at < hi)).all()}
        days |= {local(d) for d in db.scalars(select(Income.created_at).where(Income.user_id == user_id, Income.created_at >= lo, Income.created_at < hi)).all()}
        days |= {local(d) for d in db.scalars(select(AccountAdjustment.created_at).where(AccountAdjustment.user_id == user_id, AccountAdjustment.created_at >= lo,
                                                                                        AccountAdjustment.created_at < hi)).all()}
        return Decimal(len(days))
    if metric == "active_days":
        from app.models.entities import GameSettings
        target = db.scalar(select(GameSettings.steps_target).where(GameSettings.user_id == user_id)) or 8000
        days = {local(d) for d in db.scalars(select(Workout.started_at).where(Workout.user_id == user_id, Workout.duration_minutes >= 15,
                                                                            Workout.started_at >= lo, Workout.started_at < hi)).all()}
        days |= {local(d) for d in db.scalars(select(HealthRecord.recorded_at).where(HealthRecord.user_id == user_id, HealthRecord.metric == "steps",
                                                                                   HealthRecord.value >= target, HealthRecord.recorded_at >= lo,
                                                                                   HealthRecord.recorded_at < hi)).all()}
        return Decimal(len(days))
    if metric == "learning_days":
        days = {local(d) for d in db.scalars(select(FlashcardReview.reviewed_at).where(FlashcardReview.user_id == user_id, FlashcardReview.reviewed_at >= lo,
                                                                                     FlashcardReview.reviewed_at < hi)).all()}
        days |= {local(d) for d in db.scalars(select(Task.completed_at).where(Task.user_id == user_id, Task.category == "learning", Task.status == "done",
                                                                            Task.completed_at >= lo, Task.completed_at < hi)).all()}
        days |= {local(s) for s, in db.execute(select(FocusSession.started_at).join(Task, Task.id == FocusSession.task_id).where(
            FocusSession.user_id == user_id, Task.category == "learning", FocusSession.started_at >= lo, FocusSession.started_at < hi)).all()}
        return Decimal(len(days))
    if metric == "tasks_done_personal":
        return Decimal(db.scalar(select(func.count()).select_from(Task).where(Task.user_id == user_id, Task.category == "personal", Task.status == "done",
                                                                                Task.completed_at >= lo, Task.completed_at < hi)) or 0)
    return Decimal("0")


def _manual(db: Session, area_id, start: date) -> Decimal:
    return Decimal(db.scalar(select(func.coalesce(func.sum(AreaEntry.amount), 0)).where(
        AreaEntry.area_id == area_id, AreaEntry.local_date >= start, AreaEntry.local_date < start + timedelta(days=7))) or 0)


def view(db: Session, user_id, week: date | None = None) -> dict:
    tz = _tz(db, user_id)
    today = datetime.now(tz).date()
    start = week_start(week or today)
    areas = [a for a in areas_for(db, user_id) if a.active]
    out = []
    for area in areas:
        history = []
        for back in range(3, -1, -1):  # 3 previous weeks + this one
            ws = start - timedelta(weeks=back)
            lo, hi = _bounds(tz, ws)
            history.append(float(_measure(db, user_id, area.metric, tz, lo, hi) + _manual(db, area.id, ws)))
        actual = Decimal(str(history[-1]))
        target = Decimal(area.weekly_target or 0)
        pct = int(min(999, actual / target * 100)) if target > 0 else None
        out.append({"id": area.id, "key": area.key, "name": area.name, "metric": area.metric, "unit": area.unit, "target": target,
                    "actual": actual, "percent": pct, "status": "met" if pct is not None and pct >= 100 else "zero" if actual == 0 else "partial",
                    "manual_only": area.metric == "manual", "last_weeks": history[:-1]})
    lo, hi = _bounds(tz, start)
    sleep = db.scalars(select(SleepRecord.duration_minutes).where(SleepRecord.user_id == user_id, SleepRecord.end_at >= lo, SleepRecord.end_at < hi)).all()
    signals = {"avg_sleep_hours": round(sum(sleep) / len(sleep) / 60, 1) if sleep else None, "sleep_nights_logged": len(sleep)}
    warnings = []
    zero = [a["name"] for a in out if a["status"] == "zero"]
    heavy = [a for a in out if a["percent"] is not None and a["percent"] >= 100 and a["key"] == "work"]
    if heavy and zero:
        warnings.append(f"Work is at {heavy[0]['percent']}% of its target while {', '.join(zero[:3])} {'is' if len(zero) == 1 else 'are'} at 0 this week.")
    elif len(zero) >= 3 and today.weekday() >= 3:
        warnings.append(f"{len(zero)} areas have nothing logged yet this week: {', '.join(zero[:4])}.")
    if signals["avg_sleep_hours"] is not None and signals["avg_sleep_hours"] < 6:
        warnings.append(f"Sleep averaged {signals['avg_sleep_hours']} h this week. Rest counts as progress too.")
    return {"week_start": start, "week_end": start + timedelta(days=6), "is_current_week": start == week_start(today), "areas": out,
            "signals": signals, "warnings": warnings, "met": sum(1 for a in out if a["status"] == "met"), "total": len(out),
            "note": "Target vs actual per area, not one life score. Health numbers are for tracking, not medical advice."}


def log_entry(db: Session, area: LifeArea, amount: Decimal, note: str | None) -> AreaEntry:
    tz = _tz(db, area.user_id)
    row = AreaEntry(user_id=area.user_id, area_id=area.id, local_date=datetime.now(tz).date(), amount=amount, note=(note or "").strip() or None)
    db.add(row)
    db.flush()
    return row


def add_area(db: Session, user_id, name: str, unit: str, target: Decimal) -> LifeArea:
    areas_for(db, user_id)
    key = "custom_" + "".join(ch for ch in name.lower() if ch.isalnum())[:20]
    if db.scalar(select(LifeArea).where(LifeArea.user_id == user_id, LifeArea.key == key)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have an area with that name")
    position = (db.scalar(select(func.max(LifeArea.position)).where(LifeArea.user_id == user_id)) or 0) + 1
    row = LifeArea(user_id=user_id, key=key, name=name.strip()[:60], metric="manual", unit=unit.strip()[:20] or "times", weekly_target=target, position=position)
    db.add(row)
    db.flush()
    return row


def touch(row) -> None:
    row.updated_at = now_utc()
