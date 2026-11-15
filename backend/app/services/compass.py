"""Life Compass: every feature read as one picture of the seven life areas, plus the next best actions.

  health   sleep (7-9 h), active days, mindful meals, clean avoid-list days
  work     focus hours on work, work tasks finished
  family   time with family (you log it, or tell the assistant "called my mother")
  social   friends and community (logged)
  money    days you tracked money, envelopes within budget
  leisure  hobby / rest blocks (logged) and weekend-evening routines done
  growth   learning days (flashcards, exam study, learning focus) and reflection days (morning routine, check-in, prayer)

Plain code, no AI, no new tables: it reuses the life-balance areas for targets and manual logs. Each signal shows what
was counted, so the number can be checked. Percent is of the weekly target; "behind" compares with where the week should
be by today. Not medical, financial or therapy advice.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, zone
from app.models.entities import (
    AreaEntry, DailyCheckin, ExamLog, ExamPlan, Expense, Habit, HabitLog, HealthRecord, LifeArea, MealLog, Routine, RoutineRun, SleepRecord,
    Task, UserProfile, Workout,
)
from app.services import balance

AREAS = [  # key, name, icon
    ("health", "Health", "💪"), ("work", "Work & career", "💼"), ("family", "Family & relationships", "❤️"),
    ("social", "Social & community", "🤝"), ("money", "Finances", "💰"), ("leisure", "Leisure & hobbies", "🌿"),
    ("growth", "Growth & spirit", "🌱"),
]
# Compass area -> the life-balance area that stores its manual logs: (key, name, unit, weekly target, button label)
MANUAL = {
    "family": ("relationships", "Relationships", "check-ins", Decimal("3"), "Time with family"),
    "social": ("social", "Social & community", "times", Decimal("2"), "Met or called a friend"),
    "leisure": ("rest", "Rest & hobbies", "blocks", Decimal("3"), "Hobby or rest block"),
    "growth": ("spirit", "Reflection & spirit", "times", Decimal("3"), "Prayer, meditation or reflection"),
}
OPEN = ("inbox", "todo", "in_progress")
SUGGEST = {
    "health": ("Protect tonight's sleep: start the Night routine on time.", "Plan"),
    "work": ("Book one 50-minute focus block on your most important work task.", "Focus"),
    "family": ("Call or sit with someone in your family for 15 minutes today.", None),
    "social": ("Message one friend and fix a time to meet this week.", None),
    "money": ("Take 2 minutes to record today's spending.", "Money"),
    "leisure": ("Plan one hour for something you enjoy, with no screens.", None),
    "growth": ("Do 15 minutes of study, or 5 quiet minutes of reflection.", "Exams"),
}


def _profile(db: Session, user_id) -> UserProfile:
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    if p is None:
        raise HTTPException(404, "Profile not found")
    return p


def manual_area(db: Session, user_id, key: str) -> LifeArea:
    """The life-balance row behind a compass area's manual logs (created the first time it's needed)."""
    if key not in MANUAL:
        raise HTTPException(422, "This area is measured from your data; it has no manual log.")
    bkey, name, unit, target, _ = MANUAL[key]
    rows = {a.key: a for a in balance.areas_for(db, user_id)}
    if bkey not in rows:
        rows[bkey] = LifeArea(user_id=user_id, key=bkey, name=name, metric="manual", unit=unit, weekly_target=target, position=len(rows))
        db.add(rows[bkey])
        db.flush()
    return rows[bkey]


def log(db: Session, user_id, key: str, amount: Decimal = Decimal("1"), note: str | None = None) -> AreaEntry:
    return balance.log_entry(db, manual_area(db, user_id, key), amount, note)


def _signal(label: str, actual, target, unit: str, cumulative: bool = True, note: str | None = None) -> dict:
    return {"label": label, "actual": actual, "target": target, "unit": unit, "cumulative": cumulative, "note": note}


def _days(rows, tz) -> set[date]:
    return {as_utc(d).astimezone(tz).date() for d in rows if d is not None}


def view(db: Session, user_id, today: date | None = None) -> dict:
    profile = _profile(db, user_id)
    tz = zone(profile.timezone)
    now_local = datetime.now(tz)
    today = today or now_local.date()
    start = balance.week_start(today)
    lo, hi = balance._bounds(tz, start)
    frac = ((today - start).days + 1) / 7          # how much of the week has passed, including today
    barea = {a.key: a for a in balance.areas_for(db, user_id)}
    target_of = lambda key, default: float(barea[key].weekly_target) if key in barea and barea[key].weekly_target else default  # noqa: E731
    manual = lambda key: float(balance._manual(db, manual_area(db, user_id, key).id, start))  # noqa: E731

    # ----- health
    sleep = db.scalars(select(SleepRecord.duration_minutes).where(SleepRecord.user_id == user_id, SleepRecord.end_at >= lo, SleepRecord.end_at < hi)).all()
    avg_sleep = round(sum(sleep) / len(sleep) / 60, 1) if sleep else None
    from app.models.entities import GameSettings
    steps_target = db.scalar(select(GameSettings.steps_target).where(GameSettings.user_id == user_id)) or 8000
    active = _days(db.scalars(select(Workout.started_at).where(Workout.user_id == user_id, Workout.duration_minutes >= 15, Workout.started_at >= lo,
                                                               Workout.started_at < hi)).all(), tz)
    active |= _days(db.scalars(select(HealthRecord.recorded_at).where(HealthRecord.user_id == user_id, HealthRecord.metric == "steps",
                                                                      HealthRecord.value >= steps_target, HealthRecord.recorded_at >= lo,
                                                                      HealthRecord.recorded_at < hi)).all(), tz)
    routines = {r.id: r for r in db.scalars(select(Routine).where(Routine.user_id == user_id, Routine.active.is_(True))).all()}
    runs = db.scalars(select(RoutineRun).where(RoutineRun.user_id == user_id, RoutineRun.status == "done", RoutineRun.run_date >= start,
                                               RoutineRun.run_date <= start + timedelta(days=6))).all()
    active |= {r.run_date for r in runs if r.routine_id in routines and routines[r.routine_id].day_rule == "gym" and routines[r.routine_id].kind == "routine"}
    from app.services.routines import gym_days
    meals = db.scalars(select(MealLog).where(MealLog.user_id == user_id, MealLog.local_date >= start, MealLog.local_date <= start + timedelta(days=6))).all()
    mindful = sum(1 for m in meals if sum([m.slow, m.no_screen, m.upright, m.stopped_80, m.walked_after]) >= 4)
    avoid_ids = [h.id for h in db.scalars(select(Habit).where(Habit.user_id == user_id, Habit.kind == "avoid", Habit.active.is_(True))).all()]
    avoid_logs = db.scalars(select(HabitLog).where(HabitLog.habit_id.in_(avoid_ids or [None]), HabitLog.logged_on >= start,
                                                   HabitLog.logged_on <= start + timedelta(days=6))).all() if avoid_ids else []
    health = [_signal("Sleep (average)", avg_sleep, 7, "h", cumulative=False,
                      note=f"{len(sleep)} night{'s' if len(sleep) != 1 else ''} logged; 7-9 h is the healthy range" if sleep else "No sleep logged this week (sync your Mi Band)"),
              _signal("Active days", len(active), len(gym_days(profile)) or 4, "days", note="Workout 15+ min, steps target, or After-gym routine done")]
    if meals:
        health.append(_signal("Mindful meals", mindful, 5, "meals"))
    if avoid_logs:
        health.append(_signal("Clean avoid-list logs", round(100 * sum(1 for x in avoid_logs if x.completed) / len(avoid_logs)), 80, "%", cumulative=False))

    # ----- work
    work_hours = float(balance._measure(db, user_id, "focus_hours_work", tz, lo, hi))
    work_tasks = db.scalar(select(func.count()).select_from(Task).where(Task.user_id == user_id, Task.category.in_(("work", "business")), Task.status == "done",
                                                                         Task.completed_at >= lo, Task.completed_at < hi)) or 0
    work = [_signal("Focus hours on work", work_hours, target_of("work", 15.0), "h"), _signal("Work tasks finished", int(work_tasks), 5, "tasks")]

    # ----- money
    money_days = float(balance._measure(db, user_id, "money_days", tz, lo, hi))
    money = [_signal("Days you tracked money", int(money_days), target_of("money", 4.0), "days")]
    try:
        from app.services.money import envelope_status
        envs = envelope_status(db, user_id)
        if envs:
            over = [e["name"] for e in envs if e.get("over")]
            money.append(_signal("Envelopes within budget", len(envs) - len(over), len(envs), "envelopes", cumulative=False,
                                 note=("Over: " + ", ".join(over[:3])) if over else "All within budget this month"))
    except Exception:  # noqa: BLE001 - optional signal
        pass

    # ----- leisure
    off_done = sum(1 for r in runs if r.routine_id in routines and routines[r.routine_id].day_rule == "off")
    leisure = [_signal("Hobby / rest blocks", manual("leisure") + off_done, target_of("rest", 3.0), "blocks",
                       note="Logged blocks" + (f" + {off_done} weekend evening routine{'s' if off_done != 1 else ''}" if off_done else ""))]

    # ----- growth
    learn = balance._measure(db, user_id, "learning_days", tz, lo, hi)
    plan_ids = [p.id for p in db.scalars(select(ExamPlan).where(ExamPlan.user_id == user_id)).all()]
    study_days = {lg.local_date for lg in db.scalars(select(ExamLog).where(ExamLog.plan_id.in_(plan_ids or [None]), ExamLog.local_date >= start,
                                                                           ExamLog.local_date <= start + timedelta(days=6), ExamLog.minutes > 0)).all()} if plan_ids else set()
    study_minutes = sum(lg.minutes for lg in db.scalars(select(ExamLog).where(ExamLog.plan_id.in_(plan_ids or [None]), ExamLog.local_date >= start,
                                                                              ExamLog.local_date <= start + timedelta(days=6))).all()) if plan_ids else 0
    reflect = {r.run_date for r in runs if r.routine_id in routines and routines[r.routine_id].name in ("Morning", "Sunday reset")}
    reflect |= {c.local_date for c in db.scalars(select(DailyCheckin).where(DailyCheckin.user_id == user_id, DailyCheckin.local_date >= start,
                                                                            DailyCheckin.local_date <= start + timedelta(days=6))).all()}
    growth = [_signal("Learning days", max(int(learn), len(study_days)), target_of("learning", 4.0), "days",
                      note=f"{study_minutes} min of exam study this week" if study_minutes else "Flashcards, exam study or learning focus"),
              _signal("Reflection", len(reflect) + manual("growth"), 4, "times", note="Morning routine, daily check-in, or logged prayer / meditation")]

    signals = {"health": health, "work": work, "family": [_signal("Time with family", manual("family"), target_of("relationships", 3.0), "check-ins")],
               "social": [_signal("Friends and community", manual("social"), target_of("social", 2.0), "times")], "money": money, "leisure": leisure,
               "growth": growth}
    areas = []
    for key, name, icon in AREAS:
        pcts, paces = [], []
        for s in signals[key]:
            if s["actual"] is None or not s["target"]:
                s["percent"] = None
                continue
            if s["unit"] == "h" and not s["cumulative"]:      # sleep: 7-9 h is 100%, above 9 isn't "more"
                ratio = 1.0 if 7 <= s["actual"] <= 9 else min(1.0, s["actual"] / 7)
            else:
                ratio = min(1.0, float(s["actual"]) / float(s["target"]))
            s["percent"] = round(ratio * 100)
            pcts.append(ratio)
            paces.append(min(1.0, float(s["actual"]) / (float(s["target"]) * frac)) if s["cumulative"] else ratio)
        pct = round(100 * sum(pcts) / len(pcts)) if pcts else None
        pace = sum(paces) / len(paces) if paces else None
        status = "no_data" if pct is None else "done" if pct >= 100 else "on_track" if pace >= 0.8 else "behind"
        areas.append({"key": key, "name": name, "icon": icon, "percent": pct, "pace": round(pace, 2) if pace is not None else None, "status": status,
                      "signals": signals[key], "can_log": key in MANUAL, "log_label": MANUAL[key][4] if key in MANUAL else None,
                      "suggestion": SUGGEST[key][0], "open": SUGGEST[key][1]})
    scored = [a for a in areas if a["pace"] is not None]
    weakest = min(scored, key=lambda a: a["pace"]) if scored else None
    strongest = max(scored, key=lambda a: a["percent"]) if scored else None
    overall = round(sum(a["percent"] for a in scored) / len(scored)) if scored else None
    work_area = next(a for a in areas if a["key"] == "work")
    behind = [a["name"] for a in areas if a["status"] == "behind"]
    if work_hours > float(target_of("work", 15.0)) * 1.3 and len(behind) >= 2:
        message = f"Work is well past its target while {', '.join(behind[:3])} are behind. Rest and people count as progress too."
    elif weakest and weakest["status"] == "behind":
        message = f"{weakest['icon']} {weakest['name']} needs you most this week. {weakest['suggestion']}"
    elif scored and all(a["status"] in ("done", "on_track") for a in scored):
        message = "Your week is balanced so far. Keep the rhythm, and rest on purpose."
    else:
        message = "A new week: small, steady steps in each area."
    return {"week_start": start, "today": today, "week_fraction": round(frac, 2), "overall": overall, "areas": areas,
            "weakest": weakest["key"] if weakest and weakest["status"] == "behind" else None, "strongest": strongest["key"] if strongest else None,
            "message": message, "work_percent": work_area["percent"], "day": day_numbers(db, user_id, profile, tz, today, now_local),
            "actions": next_actions(db, user_id, profile, tz, today, now_local, areas, avg_sleep),
            "note": "Percent is of your weekly target; 'behind' compares with where the week should be by today. Tracking only, not medical or financial advice."}


def day_numbers(db: Session, user_id, profile: UserProfile, tz, today: date, now_local: datetime) -> dict:
    """Today in numbers, from what was actually logged."""
    from app.services import focus, routines
    lo = datetime.combine(today, time.min, tzinfo=tz).astimezone(timezone.utc)
    hi = lo + timedelta(days=1)
    last_sleep = db.scalar(select(SleepRecord).where(SleepRecord.user_id == user_id, SleepRecord.end_at >= lo, SleepRecord.end_at < hi)
                           .order_by(SleepRecord.end_at.desc()).limit(1))
    day = routines.day_view(db, user_id, today)
    f = focus.today_view(db, user_id) if today == now_local.date() else {"minutes": 0, "sessions": 0}
    plan_ids = [p.id for p in db.scalars(select(ExamPlan).where(ExamPlan.user_id == user_id)).all()]
    study = sum(lg.minutes for lg in db.scalars(select(ExamLog).where(ExamLog.plan_id.in_(plan_ids or [None]), ExamLog.local_date == today)).all()) if plan_ids else 0
    tasks_done = db.scalar(select(func.count()).select_from(Task).where(Task.user_id == user_id, Task.status == "done", Task.completed_at >= lo,
                                                                         Task.completed_at < hi)) or 0
    spent = db.scalar(select(func.coalesce(func.sum(Expense.amount), 0)).where(Expense.user_id == user_id, Expense.spent_at >= lo, Expense.spent_at < hi,
                                                                              Expense.currency == profile.currency, Expense.record_kind == "actual")) or 0
    sleep_at = datetime.combine(today, profile.sleep_time, tzinfo=tz)
    if profile.sleep_time <= profile.wake_time:      # bedtime after midnight belongs to tomorrow's date
        sleep_at += timedelta(days=1)
    left = max(0, int((sleep_at - now_local).total_seconds() // 60)) if today == now_local.date() else 0
    return {"sleep_hours": round(last_sleep.duration_minutes / 60, 1) if last_sleep else None, "focus_minutes": f["minutes"], "focus_sessions": f["sessions"],
            "study_minutes": study, "routines_done": day["done"], "routines_total": day["total"], "tasks_done": int(tasks_done),
            "spent_today": float(spent), "currency": profile.currency, "awake_minutes_left": left, "day_type": day["day_type"]["label"]}


def next_actions(db: Session, user_id, profile: UserProfile, tz, today: date, now_local: datetime, areas: list[dict], avg_sleep) -> list[dict]:
    """Up to four nudges, most time-critical first. Each one opens a screen or logs with one tap."""
    from app.services import exams, focus, routines
    out: list[dict] = []
    is_today = today == now_local.date()
    now_min = now_local.hour * 60 + now_local.minute
    if is_today:
        for item in routines.day_view(db, user_id, today)["items"]:
            st = item.get("starts")
            if item["kind"] != "routine" or item["status"] != "open" or st is None:
                continue
            begin = st.hour * 60 + st.minute
            if begin <= now_min < begin + item["duration_minutes"]:
                left = len([s for s in item["needed_step_ids"] if s not in item["done_step_ids"]])
                out.append({"icon": item["icon"], "title": f"Continue {item['name']}", "detail": f"{left} step{'s' if left != 1 else ''} left; short version if you're busy",
                            "open": "Plan", "area": None})
                break
        for plan in db.scalars(select(ExamPlan).where(ExamPlan.user_id == user_id, ExamPlan.active.is_(True))).all():
            t = exams.today_plan(db, plan, today)
            left = t["minutes"] - t["done_minutes"]
            if t["study_day"] and left > 0 and now_local.hour >= 12:
                out.append({"icon": "🎓", "title": f"{exams.CATALOG[plan.exam]['name']}: {left} min left today",
                            "detail": "Skipped minutes come back as catch-up tomorrow", "open": "Exams", "area": "growth"})
                break
    overdue = db.scalar(select(func.count()).select_from(Task).where(Task.user_id == user_id, Task.status.in_(OPEN), Task.priority == "high",
                                                                      Task.due_at.is_not(None), Task.due_at < datetime.now(timezone.utc))) or 0
    if overdue:
        out.append({"icon": "🔴", "title": f"{overdue} high-priority task{'s' if overdue != 1 else ''} overdue", "detail": "Do one now, or move it to a real date",
                    "open": "Life", "area": "work"})
    behind = sorted((a for a in areas if a["status"] == "behind"), key=lambda a: a["pace"])
    for a in behind[:2]:
        out.append({"icon": a["icon"], "title": f"{a['name']} is behind this week", "detail": a["suggestion"], "open": a["open"],
                    "area": a["key"], "log": a["key"] if a["can_log"] else None, "log_label": a["log_label"]})
    if avg_sleep is not None and avg_sleep < 6.5:
        bed = (datetime.combine(today, profile.sleep_time) - timedelta(minutes=30)).strftime("%H:%M")
        out.append({"icon": "🌙", "title": f"Sleep is averaging {avg_sleep} h", "detail": f"Start winding down by {bed} tonight", "open": "Plan", "area": "health"})
    if is_today and now_local.hour >= 20:
        unlogged = [h["name"] for h in focus.avoid_view(db, user_id) if h["today"] == "none"]
        if unlogged:
            out.append({"icon": "📝", "title": "Log today's avoid list", "detail": ", ".join(unlogged[:3]), "open": "Focus", "area": "health"})
    return out[:4]


def summary_text(db: Session, user_id) -> str:
    """Plain facts for the assistant and the Life navigator's note."""
    v = view(db, user_id)
    parts = [f"{a['name']} {a['percent']}% ({a['status'].replace('_', ' ')})" if a["percent"] is not None else f"{a['name']} not tracked yet" for a in v["areas"]]
    d = v["day"]
    lines = [f"Life compass, week from {v['week_start']} (day {round(v['week_fraction'] * 7)} of 7): " + "; ".join(parts) + ".",
             f"Today ({d['day_type']}): routines {d['routines_done']}/{d['routines_total']}, focus {d['focus_minutes']} min, study {d['study_minutes']} min, "
             f"tasks done {d['tasks_done']}" + (f", slept {d['sleep_hours']} h" if d["sleep_hours"] is not None else "") + ".",
             v["message"]]
    if v["actions"]:
        lines.append("Next best actions: " + " | ".join(f"{a['title']}: {a['detail']}" for a in v["actions"]))
    return "\n".join(lines)


# ---------- "called my mother", "met friends", "log hobby" -> a life-area log ----------

_PEOPLE_FAMILY = r"(?:mother|father|mom|mum|dad|parents?|family|wife|husband|girlfriend|boyfriend|partner|brother|sister|son|daughter|amma|thaththa|aiya|akka|nangi|malli|grand\w+|uncle|aunt\w*|cousins?)"
_CONTACT = r"(?:spent time with|called|visited|met|saw|talked (?:to|with)|had (?:dinner|lunch|tea|breakfast) with|went out with|hung out with)"
LIFE_LOG = [
    ("family", re.compile(rf"\b{_CONTACT} (?:my |the )?{_PEOPLE_FAMILY}\b|\blog (?:a )?family(?: time)?\b|\bfamily time\b", re.I)),
    ("social", re.compile(rf"\b{_CONTACT} (?:a |an |my |some |old |the )*(?:friends?|neighbou?rs?|colleagues?|classmates?|team ?mates?)\b|\blog (?:a )?social\b|\bvolunteer(?:ed|ing)\b", re.I)),
    ("growth", re.compile(r"\blog (?:a )?(?:prayer|reflection|meditation)\b|\b(?:prayed|meditated|worshipp?ed)\b|\bwent to (?:the )?(?:temple|church|mosque|kovil|pansala)\b", re.I)),
    ("leisure", re.compile(r"\blog (?:a |an )?(?:hobby|leisure|rest)(?: block)?\b|\b(?:played (?:cricket|football|badminton|chess|guitar|music|games?)|watched a (?:movie|film|match)|"
                           r"went (?:hiking|swimming|fishing|cycling|to the beach|for a walk))\b", re.I)),
]


def parse_life_log(text: str) -> dict | None:
    t = re.sub(r"\s+", " ", text.strip())
    if re.search(r"\b(remind me|i need to|add a task|create a task|tomorrow|next week|should i|will i|going to)\b|\?$", t, re.I):
        return None            # plans and questions are not something that already happened
    for key, pattern in LIFE_LOG:
        if pattern.search(t):
            return {"area": key, "note": t[:200]}
    return None
