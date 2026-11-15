"""Game and rewards (guide 30). Plain code, rules are data, the ledger is append-only.

Principles: reward balance (rest, sleep, health) and effort, not outcomes you can't control; forgiving streaks; a daily
cap so nothing can be farmed; no guilt, no punishments, no loot boxes; a Pause switch; treats are yours, and money
treats check your fun-money envelope first. Points are recorded only after the underlying action was saved, and each
(event, reference) can earn points once, so retries and re-completions never double count.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import as_utc, zone
from app.models.entities import (
    GameSettings, PointRule, PointsLedger, Quest, Redemption, Treat, UserProfile,
)
from app.services.audit import audit

log = logging.getLogger(__name__)

# event_type: (points, per-event daily cap, life area). Starter table from guide 30.2; tune in the app.
DEFAULT_RULES: dict[str, tuple[int, int, str]] = {
    "focus": (10, 80, "work"),            # per 25 focused minutes
    "task": (10, 60, "work"),             # 5-20 by size (this is the "medium" value); area = task category
    "habit": (5, 30, "habits"),
    "routine": (15, 60, "habits"),
    "study": (10, 40, "learning"),        # exam study: 10 per 20 minutes        # a routine finished (full 15, short version 8)
    "sleep": (15, 15, "rest"),            # slept within your target window
    "steps": (10, 10, "health"),          # daily steps target reached
    "workout": (20, 20, "health"),
    "weekly_review": (50, 50, "reflection"),
    "quest": (30, 90, "quest"),           # bonus for finishing a quest (quest sets the amount)
}
BONUS_EVENT = "balance_bonus"
NON_AREA_EVENTS = {BONUS_EVENT, "quest"}
MAX_ACTIVE_QUESTS = 3


def _tz(db: Session, user_id):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(profile.timezone if profile else None)


def settings_for(db: Session, user_id) -> GameSettings:
    row = db.scalar(select(GameSettings).where(GameSettings.user_id == user_id))
    if row is None:
        row = GameSettings(user_id=user_id)
        db.add(row)
        db.flush()
    return row


def rules_for(db: Session, user_id) -> dict[str, PointRule]:
    rules = {r.event_type: r for r in db.scalars(select(PointRule).where(PointRule.user_id == user_id)).all()}
    for event, (points, cap, area) in DEFAULT_RULES.items():
        if event not in rules:
            rules[event] = PointRule(user_id=user_id, event_type=event, points=points, daily_cap=cap, area=area, active=True)
            db.add(rules[event])
    db.flush()
    return rules


def _today_sum(db: Session, user_id, day: date, event_type: str | None = None) -> int:
    statement = select(func.coalesce(func.sum(PointsLedger.points), 0)).where(PointsLedger.user_id == user_id, PointsLedger.local_date == day)
    if event_type:
        statement = statement.where(PointsLedger.event_type == event_type)
    return int(db.scalar(statement) or 0)


def _insert(db: Session, user_id, event_type: str, ref_id: str, points: int, area: str, reason: str, day: date) -> bool:
    if db.scalar(select(PointsLedger.id).where(PointsLedger.user_id == user_id, PointsLedger.event_type == event_type,
                                               PointsLedger.ref_id == ref_id)) is not None:
        return False
    try:
        with db.begin_nested():
            db.add(PointsLedger(user_id=user_id, event_type=event_type, ref_id=ref_id[:100], points=points, area=area,
                                reason=reason[:200], local_date=day))
    except IntegrityError:  # a concurrent retry got there first
        return False
    return True


def award(db: Session, user_id, event_type: str, ref_id: str, reason: str, points: int | None = None, area: str | None = None) -> int:
    """Record points for something that already happened. Returns the points actually added (0 if paused, capped or duplicate)."""
    settings = settings_for(db, user_id)
    if settings.paused:
        return 0
    rules = rules_for(db, user_id)
    rule = rules.get(event_type)
    if rule is None or not rule.active:
        return 0
    day = datetime.now(_tz(db, user_id)).date()
    wanted = max(0, rule.points if points is None else points)
    room_event = max(0, rule.daily_cap - _today_sum(db, user_id, day, event_type))
    room_all = max(0, settings.daily_cap - _today_sum(db, user_id, day))
    given = min(wanted, room_event, room_all)
    note = reason if given == wanted else f"{reason} (daily cap reached)"
    if not _insert(db, user_id, event_type, ref_id, given, area or rule.area, note, day):
        return 0
    total = given + _balance_bonus(db, user_id, day, settings)
    if event_type != "quest":
        total += _check_quests(db, user_id, event_type, day)
    return total


def award_safely(db: Session, user_id, event_type: str, ref_id: str, reason: str, points: int | None = None, area: str | None = None) -> int:
    """For hooks inside other actions: the game must never break the action itself."""
    try:
        return award(db, user_id, event_type, ref_id, reason, points, area)
    except Exception:  # noqa: BLE001 - deliberately broad; the underlying action already succeeded
        log.exception("game award failed for %s", event_type)
        return 0


def _balance_bonus(db: Session, user_id, day: date, settings: GameSettings) -> int:
    """x1.2 on the day once at least four life areas received points (paid as a top-up entry, within the daily cap)."""
    rows = db.execute(select(PointsLedger.area, PointsLedger.points, PointsLedger.event_type).where(
        PointsLedger.user_id == user_id, PointsLedger.local_date == day)).all()
    areas = {a for a, p, e in rows if p > 0 and e not in NON_AREA_EVENTS}
    if len(areas) < 4:
        return 0
    base = sum(p for _, p, e in rows if e != BONUS_EVENT)
    paid = sum(p for _, p, e in rows if e == BONUS_EVENT)
    due = int(round(base * 0.2)) - paid
    room = max(0, settings.daily_cap - _today_sum(db, user_id, day))
    give = min(due, room)
    if give <= 0:
        return 0
    seq = sum(1 for *_, e in rows if e == BONUS_EVENT) + 1
    return give if _insert(db, user_id, BONUS_EVENT, f"{day.isoformat()}:{seq}", give, "balance",
                           f"Balance bonus: {len(areas)} life areas today", day) else 0


def _period(quest: Quest, day: date) -> tuple[date, date, str]:
    if quest.period == "week":
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6), f"{start.isocalendar()[0]}-W{start.isocalendar()[1]:02d}"
    return day, day, day.isoformat()


def quest_progress(db: Session, quest: Quest, day: date) -> dict:
    start, end, key = _period(quest, day)
    count = int(db.scalar(select(func.count()).select_from(PointsLedger).where(
        PointsLedger.user_id == quest.user_id, PointsLedger.event_type == quest.event_type,
        PointsLedger.local_date >= start, PointsLedger.local_date <= end)) or 0)
    done = db.scalar(select(PointsLedger.id).where(PointsLedger.user_id == quest.user_id, PointsLedger.event_type == "quest",
                                                   PointsLedger.ref_id == f"{quest.id}:{key}")) is not None
    return {"count": min(count, quest.target_count), "target": quest.target_count, "done": done, "period_key": key}


def _check_quests(db: Session, user_id, event_type: str, day: date) -> int:
    total = 0
    for quest in db.scalars(select(Quest).where(Quest.user_id == user_id, Quest.status == "active", Quest.event_type == event_type)).all():
        progress = quest_progress(db, quest, day)
        if progress["count"] >= quest.target_count and not progress["done"]:
            total += award(db, user_id, "quest", f"{quest.id}:{progress['period_key']}", f"Quest done: {quest.title}", points=quest.bonus_points)
    return total


# ---------- hooks: called right after the real action was saved ----------

def task_points(duration_minutes: int | None, rule_points: int) -> int:
    minutes = duration_minutes or 30
    size = 5 if minutes <= 30 else 10 if minutes <= 60 else 15 if minutes <= 120 else 20
    return round(size * rule_points / 10)


def on_task_done(db: Session, task) -> int:
    rule = rules_for(db, task.user_id).get("task")
    if rule is None:
        return 0
    area = task.category if task.category in ("work", "personal", "learning", "health", "business") else "work"
    return award_safely(db, task.user_id, "task", str(task.id), f"Finished: {task.title}"[:200],
                        points=task_points(task.duration_minutes, rule.points), area=area)


def on_focus_finished(db: Session, session) -> int:
    minutes = (as_utc(session.ended_at) - as_utc(session.started_at)).total_seconds() / 60
    if minutes < 10:  # a few seconds of "focus" is not a focus block
        return 0
    rule = rules_for(db, session.user_id).get("focus")
    pts = round(rule.points * min(minutes, 180) / 25) if rule else 0
    return award_safely(db, session.user_id, "focus", str(session.id), f"Focus block: {int(minutes)} min", points=pts)


def on_habit_logged(db: Session, habit, day: date) -> int:
    return award_safely(db, habit.user_id, "habit", f"{habit.id}:{day.isoformat()}", f"Habit: {habit.name}"[:200])


def on_workout(db: Session, workout) -> int:
    if (workout.duration_minutes or 0) < 15:
        return 0
    # Never reward extreme exercise: one workout's worth per day (rule cap), however long.
    return award_safely(db, workout.user_id, "workout", str(workout.id), f"Workout: {workout.activity}"[:200])


def _clock_gap(a: time, b: time) -> int:
    x, y = a.hour * 60 + a.minute, b.hour * 60 + b.minute
    d = abs(x - y)
    return min(d, 1440 - d)


def on_sleep(db: Session, record) -> int:
    """Points for sleeping within your target window (±60 min of your sleep and wake times, at least 6 hours)."""
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == record.user_id))
    if profile is None or (record.duration_minutes or 0) < 360:
        return 0
    tz = zone(profile.timezone)
    start, end = as_utc(record.start_at).astimezone(tz), as_utc(record.end_at).astimezone(tz)
    if _clock_gap(start.time(), profile.sleep_time) > 60 or _clock_gap(end.time(), profile.wake_time) > 60:
        return 0
    return award_safely(db, record.user_id, "sleep", end.date().isoformat(), "Slept within your target window")


def on_health_record(db: Session, record) -> int:
    if record.metric != "steps":
        return 0
    target = settings_for(db, record.user_id).steps_target
    if Decimal(record.value) < target:
        return 0
    day = as_utc(record.recorded_at).astimezone(_tz(db, record.user_id)).date()
    return award_safely(db, record.user_id, "steps", day.isoformat(), f"Steps target reached ({int(record.value):,})")


def on_memory_saved(db: Session, memory) -> int:
    if memory.category != "decision" or not str(memory.content).startswith("Weekly review"):
        return 0
    day = datetime.now(_tz(db, memory.user_id)).date()
    iso = day.isocalendar()
    return award_safely(db, memory.user_id, "weekly_review", f"{iso[0]}-W{iso[1]:02d}", "Weekly review done")


# ---------- summary, levels, streaks ----------

def level_for(total: int) -> dict:
    level, need, left = 1, 100, max(0, total)
    while left >= need:
        left -= need
        level += 1
        need = 100 + 50 * (level - 1)
    return {"level": level, "into_level": left, "next_level_at": need}


def streak(days_with_points: set[date], today: date) -> int:
    """Forgiving streak: a single missed day doesn't reset it; two missed days in a row do. Today can still be earned."""
    cursor = today if today in days_with_points else today - timedelta(days=1)
    count, misses = 0, 0
    while misses < 2 and cursor > today - timedelta(days=400):
        if cursor in days_with_points:
            count += 1
            misses = 0
        else:
            misses += 1
        cursor -= timedelta(days=1)
    return count


def balance(db: Session, user_id) -> int:
    earned = int(db.scalar(select(func.coalesce(func.sum(PointsLedger.points), 0)).where(PointsLedger.user_id == user_id)) or 0)
    spent = int(db.scalar(select(func.coalesce(func.sum(Redemption.points_spent), 0)).where(Redemption.user_id == user_id)) or 0)
    return earned - spent


def summary(db: Session, user_id) -> dict:
    settings = settings_for(db, user_id)
    rules = rules_for(db, user_id)
    tz = _tz(db, user_id)
    today = datetime.now(tz).date()
    earned = int(db.scalar(select(func.coalesce(func.sum(PointsLedger.points), 0)).where(PointsLedger.user_id == user_id)) or 0)
    rows_today = db.execute(select(PointsLedger.area, PointsLedger.points, PointsLedger.event_type).where(
        PointsLedger.user_id == user_id, PointsLedger.local_date == today)).all()
    days = set(db.scalars(select(PointsLedger.local_date).where(PointsLedger.user_id == user_id, PointsLedger.points > 0,
                                                                PointsLedger.local_date >= today - timedelta(days=400))).all())
    recent = db.scalars(select(PointsLedger).where(PointsLedger.user_id == user_id).order_by(PointsLedger.created_at.desc()).limit(20)).all()
    quests = db.scalars(select(Quest).where(Quest.user_id == user_id, Quest.status == "active").order_by(Quest.created_at)).all()
    treats = db.scalars(select(Treat).where(Treat.user_id == user_id, Treat.active.is_(True)).order_by(Treat.cost_points)).all()
    areas_today = sorted({a for a, p, e in rows_today if p > 0 and e not in NON_AREA_EVENTS})
    points_balance = balance(db, user_id)
    return {
        "paused": settings.paused, "daily_cap": settings.daily_cap, "steps_target": settings.steps_target,
        "total_earned": earned, "balance": points_balance, **level_for(earned),
        "today": {"points": sum(p for _, p, _ in rows_today), "cap": settings.daily_cap, "areas": areas_today,
                  "bonus": sum(p for _, p, e in rows_today if e == BONUS_EVENT), "areas_for_bonus": 4},
        "streak_days": streak(days, today),
        "recent": [{"event_type": r.event_type, "points": r.points, "reason": r.reason, "area": r.area, "at": r.created_at} for r in recent],
        "rules": [{"event_type": r.event_type, "points": r.points, "daily_cap": r.daily_cap, "area": r.area, "active": r.active}
                  for r in sorted(rules.values(), key=lambda r: r.event_type)],
        "quests": [{"id": qst.id, "title": qst.title, "event_type": qst.event_type, "period": qst.period, "bonus_points": qst.bonus_points,
                    **quest_progress(db, qst, today)} for qst in quests],
        "treats": [{"id": t.id, "name": t.name, "cost_points": t.cost_points, "money_cost": t.money_cost, "currency": t.currency,
                    "wish_id": t.wish_id, "affordable": points_balance >= t.cost_points} for t in treats],
    }


# ---------- quests and treats ----------

def add_quest(db: Session, user_id, data) -> Quest:
    active = db.scalar(select(func.count()).select_from(Quest).where(Quest.user_id == user_id, Quest.status == "active")) or 0
    if active >= MAX_ACTIVE_QUESTS:
        raise HTTPException(status.HTTP_409_CONFLICT, "Keep it small: at most three active quests. Finish or remove one first.")
    row = Quest(user_id=user_id, **data.model_dump())
    db.add(row)
    db.flush()
    return row


def redeem(db: Session, user_id, treat: Treat, confirm: bool, over_budget_ok: bool) -> dict:
    if not confirm:
        raise HTTPException(422, "Please confirm the redemption.")
    if not treat.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "This treat is not active.")
    have = balance(db, user_id)
    if have < treat.cost_points:
        raise HTTPException(status.HTTP_409_CONFLICT, f"You have {have} points; this treat costs {treat.cost_points}.")
    fun_left = None
    if treat.money_cost and treat.money_cost > 0:
        from app.services.money import envelope_status
        fun = [e for e in envelope_status(db, user_id) if e["kind"] == "fun" and e["currency"] == treat.currency]
        fun_left = sum((e["left"] for e in fun), Decimal("0")) if fun else None
        if (fun_left is None or fun_left < treat.money_cost) and not over_budget_ok:
            where = "you have no fun-money envelope in this currency" if fun_left is None else f"fun money left is {treat.currency} {fun_left:,}"
            raise HTTPException(status.HTTP_409_CONFLICT, f"This treat costs {treat.currency} {treat.money_cost:,} and {where}. Confirm again to go ahead anyway.")
    row = Redemption(user_id=user_id, treat_id=treat.id, treat_name=treat.name, points_spent=treat.cost_points,
                     money_cost=treat.money_cost, currency=treat.currency)
    db.add(row)
    db.flush()
    audit(db, user_id, "game.redeem", "treat", treat.id, {"points": treat.cost_points})
    return {"redeemed": treat.name, "points_spent": treat.cost_points, "balance": have - treat.cost_points, "fun_money_left_before": fun_left,
            "note": "Enjoy it! Sakuna never buys anything: log the expense in Finance if you spend money."}
