"""Chart data for the dashboards (money, health, my life). Plain code over the user's own records; nothing is guessed.

Money: only 'actual' records in the display currency are charted (other currencies are counted, never converted).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import Expense, Goal, Habit, HabitLog, HealthRecord, Income, SleepRecord, Task, UserProfile, Workout

STEP_GOAL = 8000
SLEEP_GOAL_H = 7.5


def _profile(db: Session, user_id):
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(p.timezone if p else "Asia/Colombo"), (p.currency if p and p.currency else "USD")


def _local_day(value: datetime, tz) -> date:
    return as_utc(value).astimezone(tz).date()


def _start(day: date, tz) -> datetime:
    return datetime.combine(day, time.min, tz)


def _months_back(today: date, n: int) -> list[date]:
    first = today.replace(day=1)
    out = []
    for _ in range(n):
        out.append(first)
        first = (first - timedelta(days=1)).replace(day=1)
    return list(reversed(out))


def _f(v: Decimal) -> float:
    return float(round(v, 2))


def finance_trends(db: Session, user_id, months: int = 6) -> dict:
    tz, cur = _profile(db, user_id)
    today = now_utc().astimezone(tz).date()
    firsts = _months_back(today, max(2, min(months, 12)))
    since = _start(firsts[0], tz)
    incomes = db.scalars(select(Income).where(Income.user_id == user_id, Income.received_at >= since)).all()
    expenses = db.scalars(select(Expense).where(Expense.user_id == user_id, Expense.spent_at >= since)).all()
    inc, exp = defaultdict(Decimal), defaultdict(Decimal)
    daily = defaultdict(Decimal)
    cats_now, cats_prev = defaultdict(Decimal), defaultdict(Decimal)
    sources = defaultdict(Decimal)
    other_currency = 0
    this_m, prev_m = firsts[-1], firsts[-2]
    biggest = []
    for r in incomes:
        if r.record_kind != "actual":
            continue
        if r.currency != cur:
            other_currency += 1
            continue
        d = _local_day(r.received_at, tz)
        inc[d.replace(day=1)] += r.amount
        if d.replace(day=1) == this_m:
            sources[r.source] += r.amount
    for r in expenses:
        if r.record_kind != "actual" or r.category == "savings":
            continue
        if r.currency != cur:
            other_currency += 1
            continue
        d = _local_day(r.spent_at, tz)
        m = d.replace(day=1)
        exp[m] += r.amount
        if m == this_m:
            daily[d] += r.amount
            cats_now[r.category] += r.amount
            biggest.append(r)
        elif m == prev_m:
            cats_prev[r.category] += r.amount
    month_rows = [{"month": m.strftime("%Y-%m"), "label": m.strftime("%b"), "income": _f(inc[m]), "expenses": _f(exp[m]), "net": _f(inc[m] - exp[m])}
                  for m in firsts]
    days_in = [this_m + timedelta(days=i) for i in range((today - this_m).days + 1)]
    spent_now, spent_prev = exp[this_m], exp[prev_m]
    # Same point last month, for a fair comparison mid-month.
    prev_same = sum((r.amount for r in expenses if r.record_kind == "actual" and r.category != "savings" and r.currency == cur
                     and _local_day(r.spent_at, tz).replace(day=1) == prev_m and _local_day(r.spent_at, tz).day <= today.day), Decimal(0))
    change = None if not prev_same else round(float((spent_now - prev_same) / prev_same * 100), 1)
    income_now = inc[this_m]
    rate = None if not income_now else round(float((income_now - spent_now) / income_now * 100), 1)
    avg_day = spent_now / max(1, len(days_in))
    import calendar
    month_days = calendar.monthrange(today.year, today.month)[1]
    biggest.sort(key=lambda r: r.amount, reverse=True)
    return {
        "currency": cur, "months": month_rows,
        "days": [{"date": d.isoformat(), "label": str(d.day), "spent": _f(daily[d])} for d in days_in],
        "categories": [{"category": k, "amount": _f(v), "previous": _f(cats_prev.get(k, Decimal(0)))}
                       for k, v in sorted(cats_now.items(), key=lambda kv: kv[1], reverse=True)],
        "income_sources": [{"source": k, "amount": _f(v)} for k, v in sorted(sources.items(), key=lambda kv: kv[1], reverse=True)],
        "this_month": {"income": _f(income_now), "spent": _f(spent_now), "net": _f(income_now - spent_now), "savings_rate": rate,
                       "avg_per_day": _f(avg_day), "projected_spend": _f(avg_day * month_days), "change_vs_last_month_pct": change,
                       "last_month_spent": _f(spent_prev)},
        "biggest": [{"id": str(r.id), "category": r.category, "amount": _f(r.amount), "merchant": r.merchant, "notes": r.notes,
                     "date": _local_day(r.spent_at, tz).isoformat()} for r in biggest[:5]],
        "other_currency_records": other_currency,
    }


def health_trends(db: Session, user_id, days: int = 14) -> dict:
    tz, _ = _profile(db, user_id)
    days = max(7, min(days, 60))
    today = now_utc().astimezone(tz).date()
    first = today - timedelta(days=days - 1)
    since = _start(first, tz)
    recs = db.scalars(select(HealthRecord).where(HealthRecord.user_id == user_id, HealthRecord.recorded_at >= since)).all()
    sleeps = db.scalars(select(SleepRecord).where(SleepRecord.user_id == user_id, SleepRecord.end_at >= since)).all()
    works = db.scalars(select(Workout).where(Workout.user_id == user_id, Workout.started_at >= since)).all()
    steps, hr, cal, weight = defaultdict(float), defaultdict(list), defaultdict(float), {}
    for r in recs:
        d = _local_day(r.recorded_at, tz)
        v = float(r.value)
        m = r.metric.lower()
        if m == "steps":
            steps[d] = max(steps[d], v) if r.source != "manual" else steps[d] + v  # synced totals are daily totals
        elif m in ("heart_rate", "resting_heart_rate", "heart rate"):
            hr[d].append(v)
        elif m in ("calories", "active_calories"):
            cal[d] += v
        elif m == "weight":
            weight[d] = v
    sleep_h = defaultdict(float)
    for s in sleeps:
        sleep_h[_local_day(s.end_at, tz)] += s.duration_minutes / 60
    work_min = defaultdict(int)
    for w in works:
        work_min[_local_day(w.started_at, tz)] += w.duration_minutes
    rows = []
    for i in range(days):
        d = first + timedelta(days=i)
        rows.append({"date": d.isoformat(), "label": d.strftime("%a")[:2] if days <= 14 else str(d.day), "steps": round(steps.get(d, 0)),
                     "sleep_hours": round(sleep_h.get(d, 0), 2), "workout_minutes": work_min.get(d, 0),
                     "heart_rate": round(sum(hr[d]) / len(hr[d])) if hr.get(d) else None, "calories": round(cal.get(d, 0)) or None,
                     "weight": weight.get(d)})
    week = rows[-7:]
    def avg(key, src):
        vals = [r[key] for r in src if r[key]]
        return round(sum(vals) / len(vals), 1) if vals else None
    steps_days = sum(1 for r in week if r["steps"] >= STEP_GOAL)
    sleep_days = sum(1 for r in week if r["sleep_hours"] >= SLEEP_GOAL_H)
    active_days = sum(1 for r in week if r["workout_minutes"] > 0)
    t = rows[-1]
    score_parts = [min(1, t["steps"] / STEP_GOAL) if t["steps"] else 0, min(1, (rows[-1]["sleep_hours"] or rows[-2]["sleep_hours"]) / SLEEP_GOAL_H),
                   1 if any(r["workout_minutes"] for r in rows[-2:]) else 0.4]
    return {
        "days": rows, "goals": {"steps": STEP_GOAL, "sleep_hours": SLEEP_GOAL_H},
        "today": t, "score": round(sum(score_parts) / len(score_parts) * 100),
        "week": {"avg_steps": avg("steps", week), "avg_sleep_hours": avg("sleep_hours", week), "workout_minutes": sum(r["workout_minutes"] for r in week),
                 "avg_heart_rate": avg("heart_rate", week), "step_goal_days": steps_days, "sleep_goal_days": sleep_days, "active_days": active_days},
        "has_data": bool(recs or sleeps or works),
        "note": "From Health Connect (Mi Fitness / Zepp sync) and what you log. Not medical advice.",
    }


def life_overview(db: Session, user_id) -> dict:
    tz, _ = _profile(db, user_id)
    today = now_utc().astimezone(tz).date()
    monday = today - timedelta(days=today.weekday())
    first = today - timedelta(days=13)
    tasks = db.scalars(select(Task).where(Task.user_id == user_id)).all()
    open_tasks = [t for t in tasks if t.status not in ("done", "cancelled")]
    done_by_day = defaultdict(int)
    for t in tasks:
        if t.status == "done" and t.completed_at:
            d = _local_day(t.completed_at, tz)
            if d >= first:
                done_by_day[d] += 1
    end_today = _start(today + timedelta(days=1), tz)
    overdue = sum(1 for t in open_tasks if t.due_at and as_utc(t.due_at) < _start(today, tz))
    due_today = sum(1 for t in open_tasks if t.due_at and _start(today, tz) <= as_utc(t.due_at) < end_today)
    by_priority = {p: sum(1 for t in open_tasks if t.priority == p) for p in ("high", "medium", "low")}
    by_category = defaultdict(int)
    for t in open_tasks:
        by_category[t.category] += 1
    habits = db.scalars(select(Habit).where(Habit.user_id == user_id, Habit.active.is_(True)).order_by(Habit.name)).all()
    logs = db.scalars(select(HabitLog).where(HabitLog.user_id == user_id, HabitLog.logged_on >= min(monday, first), HabitLog.completed.is_(True))).all()
    logged = defaultdict(set)
    for log in logs:
        logged[log.habit_id].add(log.logged_on)
    habit_rows = []
    for h in habits:
        days = logged.get(h.id, set())
        streak, d = 0, today if today in days else today - timedelta(days=1)
        while d in days:
            streak += 1
            d -= timedelta(days=1)
        habit_rows.append({"id": str(h.id), "name": h.name, "kind": h.kind, "week": [(monday + timedelta(days=i)) in days for i in range(7)],
                           "done_today": today in days, "streak": streak, "last_14": sum(1 for x in days if x >= first)})
    goals = db.scalars(select(Goal).where(Goal.user_id == user_id, Goal.status == "active")).all()
    goal_rows = [{"id": str(g.id), "title": g.title, "category": g.category,
                  "percent": round(min(100.0, float(g.current_value or 0) / float(g.target_value) * 100), 1) if g.target_value else None,
                  "current": float(g.current_value or 0), "target": float(g.target_value) if g.target_value else None, "unit": g.unit,
                  "due_date": g.due_date.isoformat() if g.due_date else None} for g in goals]
    done_14 = [{"date": (first + timedelta(days=i)).isoformat(), "label": (first + timedelta(days=i)).strftime("%a")[:2],
                "done": done_by_day.get(first + timedelta(days=i), 0)} for i in range(14)]
    week_done = sum(r["done"] for r in done_14[-7:])
    habit_today = sum(1 for h in habit_rows if h["done_today"])
    with_pct = [g["percent"] for g in goal_rows if g["percent"] is not None]
    score_parts = [min(1, week_done / 10), habit_today / len(habit_rows) if habit_rows else 0.5, (sum(with_pct) / len(with_pct) / 100) if with_pct else 0.5,
                   0 if overdue > 3 else 1 - overdue / 4]
    return {
        "today": today.isoformat(), "weekday": today.weekday(),
        "tasks": {"open": len(open_tasks), "overdue": overdue, "due_today": due_today, "done_this_week": week_done,
                  "by_priority": by_priority, "by_category": dict(by_category)},
        "done_14_days": done_14, "habits": habit_rows, "habits_done_today": habit_today, "goals": goal_rows,
        "score": round(sum(score_parts) / len(score_parts) * 100),
    }
