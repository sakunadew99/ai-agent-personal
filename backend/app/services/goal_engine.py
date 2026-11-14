"""Goal engine (guide 29): floor / realistic / stretch levels, progress from your own records, and a forecast range.

All arithmetic is plain code:
    required_per_month = (target - current) / months_remaining
    projected_end      = current + rate_per_month * months_remaining   (conservative / trend / optimistic)
    status             = achieved | ahead (> +10%) | on_track (within 10%) | behind (< -10%) | missed | no_deadline
Less than 3 months of history is labelled low confidence. Money goals are information, not financial advice.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import (
    FinancialAccount, FocusSession, Goal, GoalLevel, GoalMilestone, GoalSnapshot, Income, Task, UserProfile,
)

DAYS_PER_MONTH = 30.4375
WINDOWS = (30, 90, 180)
LOW_CONFIDENCE_DAYS = 90
MONEY_METRICS = ("savings_balance", "all_accounts", "income_since_start")
DERIVED = ("income_since_start", "focus_hours", "tasks_done", "milestones_done")  # history can be rebuilt from records
LEVELS = ("floor", "realistic", "stretch")
CENT = Decimal("0.01")


def q(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def _tz(db: Session, user_id):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(profile.timezone if profile else None)


def _start(goal: Goal) -> datetime:
    return as_utc(goal.created_at) if goal.created_at else now_utc()


def value_at(db: Session, goal: Goal, when: datetime) -> Decimal:
    """Goal progress at a moment, computed from records. Manual and balance metrics only know 'now'."""
    m, cur = goal.metric or "manual", (goal.metric_currency or "").upper()
    if m == "savings_balance" or m == "all_accounts":
        statement = select(func.coalesce(func.sum(FinancialAccount.balance), 0)).where(
            FinancialAccount.user_id == goal.user_id, FinancialAccount.currency == cur, FinancialAccount.archived_at.is_(None))
        if m == "savings_balance":
            statement = statement.where(FinancialAccount.account_type == "savings")
        return q(db.scalar(statement) or 0)
    if m == "income_since_start":
        total = db.scalar(select(func.coalesce(func.sum(Income.amount), 0)).where(
            Income.user_id == goal.user_id, Income.currency == cur, Income.record_kind == "actual",
            Income.received_at >= _start(goal), Income.received_at <= when))
        return q(total or 0)
    if m == "focus_hours":
        rows = db.execute(select(FocusSession.started_at, FocusSession.ended_at).where(
            FocusSession.user_id == goal.user_id, FocusSession.ended_at.is_not(None),
            FocusSession.started_at >= _start(goal), FocusSession.ended_at <= when)).all()
        minutes = sum(max(0.0, (as_utc(e) - as_utc(s)).total_seconds() / 60) for s, e in rows)
        return q(minutes / 60)
    if m == "tasks_done":
        return q(db.scalar(select(func.count()).select_from(Task).where(
            Task.user_id == goal.user_id, Task.goal_id == goal.id, Task.status == "done", Task.completed_at <= when)) or 0)
    if m == "milestones_done":
        return q(db.scalar(select(func.count()).select_from(GoalMilestone).where(
            GoalMilestone.user_id == goal.user_id, GoalMilestone.goal_id == goal.id, GoalMilestone.done_at.is_not(None),
            GoalMilestone.done_at <= when)) or 0)
    return q(goal.current_value or 0)


def snapshot(db: Session, goal: Goal, today: date, value: Decimal | None = None) -> Decimal:
    """Upsert today's value (one row per goal per day)."""
    value = q(value if value is not None else value_at(db, goal, now_utc()))
    row = db.scalar(select(GoalSnapshot).where(GoalSnapshot.goal_id == goal.id, GoalSnapshot.snapshot_date == today))
    if row is None:
        db.add(GoalSnapshot(user_id=goal.user_id, goal_id=goal.id, snapshot_date=today, value=value))
    else:
        row.value = value
    return value


def snapshot_all(db: Session) -> int:
    """Called by the worker tick: today's snapshot for every active goal (cheap, idempotent)."""
    count = 0
    for goal in db.scalars(select(Goal).where(Goal.status == "active")).all():
        snapshot(db, goal, datetime.now(_tz(db, goal.user_id)).date())
        count += 1
    db.commit()
    return count


def _history(db: Session, goal: Goal, tz, today: date) -> list[tuple[date, Decimal]]:
    """(date, value) points, oldest first. Derived metrics rebuild history from records; others use snapshots."""
    start_day = _start(goal).astimezone(tz).date()
    if (goal.metric or "manual") in DERIVED:
        points = []
        for days in sorted(WINDOWS, reverse=True):
            day = today - timedelta(days=days)
            if day >= start_day:
                when = datetime.combine(day, time.max, tzinfo=tz).astimezone(timezone.utc)
                points.append((day, value_at(db, goal, when)))
        if start_day < today and all(d != start_day for d, _ in points):
            points.append((start_day, value_at(db, goal, _start(goal))))
        return sorted(points)
    rows = db.execute(select(GoalSnapshot.snapshot_date, GoalSnapshot.value).where(GoalSnapshot.goal_id == goal.id)
                      .order_by(GoalSnapshot.snapshot_date)).all()
    return [(d, q(v)) for d, v in rows if d < today]


def _rates(history: list[tuple[date, Decimal]], current: Decimal, today: date) -> dict[int, Decimal]:
    """Change per month over each window that has data at or before its start."""
    out: dict[int, Decimal] = {}
    for window in WINDOWS:
        cutoff = today - timedelta(days=window)
        older = [(d, v) for d, v in history if d <= cutoff]
        base = older[-1] if older else (history[0] if history and window == WINDOWS[0] and (today - history[0][0]).days >= 7 else None)
        if base is None:
            continue
        days = (today - base[0]).days
        if days <= 0:
            continue
        out[window] = q((current - base[1]) / Decimal(str(days / DAYS_PER_MONTH)))
    return out


def _status(current: Decimal, target: Decimal, projected: Decimal | None, deadline: date | None, today: date) -> str:
    if current >= target:
        return "achieved"
    if deadline is None:
        return "no_deadline"
    if deadline < today:
        return "missed"
    if projected is None:
        return "not_enough_data"
    ratio = projected / target if target > 0 else Decimal("1")
    return "ahead" if ratio > Decimal("1.1") else "on_track" if ratio >= Decimal("0.9") else "behind"


def forecast(db: Session, goal: Goal) -> dict:
    tz = _tz(db, goal.user_id)
    today = datetime.now(tz).date()
    current = value_at(db, goal, now_utc())
    snapshot(db, goal, today, current)
    history = _history(db, goal, tz, today)
    rates = _rates(history, current, today)
    data_days = (today - history[0][0]).days if history else 0
    trend = rates[max(rates)] if rates else None
    if rates and len(rates) > 1:
        conservative, optimistic = min(rates.values()), max(rates.values())
    elif trend is not None:
        conservative, optimistic = q(trend - abs(trend) * Decimal("0.25")), q(trend + abs(trend) * Decimal("0.25"))
    else:
        conservative = optimistic = None
    levels = {row.level: row for row in db.scalars(select(GoalLevel).where(GoalLevel.goal_id == goal.id)).all()}
    targets = [(lvl, q(levels[lvl].target_value), levels[lvl].target_date) for lvl in LEVELS if lvl in levels]
    if not targets and goal.target_value is not None:
        targets = [("stretch", q(goal.target_value), goal.due_date)]
    out_levels = []
    for lvl, target, deadline in targets:
        months = Decimal(str(max(0, (deadline - today).days) / DAYS_PER_MONTH)) if deadline else None
        def project(rate):
            return q(current + rate * months) if rate is not None and months is not None else None
        projected = project(trend)
        required = q((target - current) / months) if months and months > 0 and target > current else (Decimal("0") if target <= current else None)
        eta = None
        if trend is not None and trend > 0 and target > current:
            eta = (today + timedelta(days=int(float((target - current) / trend) * DAYS_PER_MONTH))).isoformat()
        out_levels.append({
            "level": lvl, "target": target, "target_date": deadline, "months_left": float(round(months, 1)) if months is not None else None,
            "required_per_month": required, "required_per_week": q(required / Decimal("4.345")) if required is not None else None,
            "projected": {"conservative": project(conservative), "trend": projected, "optimistic": project(optimistic)},
            "status": _status(current, target, projected, deadline, today), "eta": eta,
            "percent": int(min(100, current / target * 100)) if target > 0 else None,
        })
    notes = []
    if data_days < LOW_CONFIDENCE_DAYS:
        notes.append(f"Low confidence: based on {data_days} day(s) of history. It gets better after 3 months.")
    if goal.metric in MONEY_METRICS:
        notes.append("Information, not financial advice. Review big money decisions with a qualified adviser.")
    if goal.metric == "manual":
        notes.append("Progress is what you enter. Update it regularly, or switch the goal to an automatic source.")
    return {"goal_id": goal.id, "title": goal.title, "metric": goal.metric, "currency": goal.metric_currency, "unit": goal.unit,
            "current": current, "rate_per_month": {"trend": trend, "conservative": conservative, "optimistic": optimistic,
                                                    "windows": {str(k): v for k, v in rates.items()}},
            "data_days": data_days, "confidence": "low" if data_days < LOW_CONFIDENCE_DAYS else "normal",
            "levels": out_levels, "notes": notes}


def set_levels(db: Session, goal: Goal, levels: list) -> list[GoalLevel]:
    if len({lv.level for lv in levels}) != len(levels):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Each level can appear once")
    by = {lv.level: lv for lv in levels}
    if "floor" in by and "stretch" in by and by["floor"].target_value > by["stretch"].target_value:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Floor should not be above stretch")
    existing = {row.level: row for row in db.scalars(select(GoalLevel).where(GoalLevel.goal_id == goal.id)).all()}
    for name, row in existing.items():
        if name not in by:
            db.delete(row)
    now = now_utc()
    for name, lv in by.items():
        row = existing.get(name) or GoalLevel(user_id=goal.user_id, goal_id=goal.id, level=name, created_at=now)
        row.target_value, row.target_date, row.updated_at = lv.target_value, lv.target_date, now
        db.add(row)
    db.flush()
    return list(db.scalars(select(GoalLevel).where(GoalLevel.goal_id == goal.id)).all())


def validate_metric(metric: str | None, currency: str | None) -> str | None:
    if metric in MONEY_METRICS and not currency:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Money goals need a currency, e.g. LKR or USD")
    return currency.upper() if currency else None
