"""Life OS Phase 1: routines, checklists, meals, and the day / week / month view of them.

Plain code, no AI. Days are 1 = Monday ... 7 = Sunday in the user's timezone.
No stress by design: every routine has a short version (its essential steps), skipping is allowed and never
penalised, and a finished short version still counts as done.
"""
from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_utc, zone
from app.models.entities import MealLog, Routine, RoutineRun, RoutineStep, UserProfile
from app.services.audit import audit

ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]
DEFAULT_GYM_DAYS = [1, 2, 4, 5]
FULL_POINTS, SHORT_POINTS = 15, 8

EATING_RULES = {
    "while": ["Eat slowly: chew each bite 20–30 times", "Focus on your food: no phone, TV or laptop",
              "Sit upright (90°)", "Eat calmly", "Stop at 80% full"],
    "after_0_10": ["Sit upright, don't lie down", "Relax: no stress or heavy thinking", "A small sip of water, not too much"],
    "after_10_20": ["Light walk, 5–10 minutes", "Meditation", "No phone scrolling"],
}

# Your notebook, ready to load. (title, essential?)  Essential steps make the 3-minute "short version".
STARTER: list[dict] = [
    {"name": "Morning", "icon": "☀️", "start": None, "minutes": 120, "rule": "fixed", "days": ALL_DAYS, "steps": [
        ("Wake up — no phone for 30 minutes", True), ("Wash room", False), ("Drinking water · Tripala", True), ("Brush", True),
        ("Warm-ups · push-ups · plank · squats · abs", False), ("Kegel exercise", False), ("Face and eye exercise", False),
        ("Yoga", False), ("Bath · body scrub · face scrub · trim · mouth exercise", False),
        ("Cleanser · moisturiser · Minoxidil · The Ordinary", False), ("Vitamin D · vitamin C · B12 · Hathiya", True),
        ("Meditation", True), ("Hair wax · hair oil", False), ("Perfume · deodorant", False), ("Mouth wash", False),
        ("Affirmation · journal · day plan · scripting · gratitude", False), ("Motivation video · important video", False),
        ("Book reading · e-book", False), ("Breakfast: smoothie · meal plan", False), ("Drink: Iramusu · Ranawara", False)]},
    {"name": "After gym", "icon": "🏋️", "start": time(11, 0), "minutes": 120, "rule": "gym", "days": [], "steps": [
        ("Drink 700 ml water", True), ("Rest", False), ("Face wash", False), ("Clothes washing", False), ("Bath", True),
        ("Wear dress · iron dress", False), ("Dryer hair", False), ("Cleanser · sun cream", False), ("Perfume · deodorant", False),
        ("Hair wax · hair setting", False), ("Fill water bottle", False), ("Shoes and socks", False), ("Mouth wash", False),
        ("Foot medicine", False), ("Lunch and fruits (banana, papaya)", True), ("Hathiya kudu", False)]},
    {"name": "Office evening", "icon": "💼", "start": time(18, 0), "minutes": 300, "rule": "work", "days": [], "steps": [
        ("Zinc after meal", True), ("Journalling", False), ("Day planning · priority goals", True),
        ("Athikkramana video", False), ("Motivation video", False), ("Book reading", False)]},
    {"name": "Weekend evening", "icon": "🌿", "start": time(18, 0), "minutes": 180, "rule": "off", "days": [], "steps": [
        ("Zinc after meal", True), ("Journalling", False), ("Plan tomorrow · priority goals", True), ("Book reading", False),
        ("Time with family or friends", False), ("Something fun, no screens", False)]},
    {"name": "Sunday reset", "icon": "🔄", "start": time(17, 0), "minutes": 45, "rule": "fixed", "days": [7], "steps": [
        ("Look back: 3 wins and 1 lesson from this week", True), ("Check gym days done this week", False),
        ("Pick next week's top 3 goals", True), ("Choose next week's gym days", False), ("Check exam study plan", False),
        ("Clean room · wash clothes", False), ("Pack gym bag and office bag", False), ("Add missing things to the buy list", False)]},
    {"name": "Night", "icon": "🌙", "start": time(23, 0), "minutes": 90, "rule": "fixed", "days": ALL_DAYS, "steps": [
        ("Brush", True), ("Bath · face clean · body clean · mouth exercise", False), ("Clothes wash", False),
        ("Mg medicine", True), ("Tripala medicine", False), ("Pimple treatment · foot medicine", False),
        ("Deodorant · perfume", False), ("Phone and laptop charging", False), ("Bed prepare", False),
        ("Affirmation · nature sound", False), ("Sleep yoga", False), ("Smart watch on", False), ("No phone after 00:00", True)]},
    {"name": "Gym bag", "icon": "🎒", "kind": "checklist", "start": None, "minutes": 10, "rule": "gym", "days": [], "steps": [
        ("Towel", True), ("Extra T-shirt", False), ("Water bottle", True), ("Band or hair clip", False), ("Gloves", False),
        ("Shoes and socks", True), ("T-shirt", False), ("Short or bottom", False), ("Underwear", False), ("Supporter", False),
        ("Watch", False), ("Purse", False)]},
    {"name": "Office bag", "icon": "👜", "kind": "checklist", "start": None, "minutes": 10, "rule": "work", "days": [], "steps": [
        ("ID", True), ("Perfume", False), ("Water bottle", True), ("Tissue", False), ("Watch", False), ("Face towel", False),
        ("Mouth wash", False), ("Journal", False), ("Notebooks", False), ("Umbrella and shopping bag", False),
        ("Phone charger", True), ("Cap", False), ("Hair wax", False), ("Coffee · green tea · Iramusu", False), ("Purse", True),
        ("Face wash (cleanser)", False), ("Comb", False), ("Medicine · foot medicine", False)]},
]


# ---------- helpers ----------

def _profile(db: Session, user_id) -> UserProfile:
    row = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    if row is None:
        raise HTTPException(404, "Profile not found")
    return row


def today_for(db: Session, user_id) -> date:
    return datetime.now(zone(_profile(db, user_id).timezone)).date()


def work_days(profile: UserProfile) -> list[int]:
    return list(profile.work_days) if profile.work_days is not None else DEFAULT_WORK_DAYS


def gym_days(profile: UserProfile) -> list[int]:
    return list(profile.gym_days) if profile.gym_days is not None else DEFAULT_GYM_DAYS


def runs_on(routine: Routine, profile: UserProfile, day: date) -> bool:
    wd = day.isoweekday()
    if routine.day_rule == "gym":
        return wd in gym_days(profile)
    if routine.day_rule == "work":
        return wd in work_days(profile)
    if routine.day_rule == "off":
        return wd not in work_days(profile)
    return wd in (routine.days or [])


def day_type(profile: UserProfile, day: date) -> dict:
    """A friendly label for the kind of day, used by the week and month views."""
    wd = day.isoweekday()
    work, gym = wd in work_days(profile), wd in gym_days(profile)
    if wd == 7 and not work:
        label, icon, theme = "Reset day", "🔄", "Rest, review the week, plan the next"
    elif work and gym:
        label, icon, theme = "Gym + office", "🏋️💼", "Train in the morning, deep work in the evening"
    elif work:
        label, icon, theme = "Office day", "💼", "Protect the evening focus block"
    elif gym:
        label, icon, theme = "Gym day off", "🏋️🌿", "Train, then recharge"
    else:
        label, icon, theme = "Free day", "🌿", "Recharge: family, nature, a good book"
    return {"label": label, "icon": icon, "theme": theme, "work": work, "gym": gym}


def _steps(db: Session, routine_id) -> list[RoutineStep]:
    return list(db.scalars(select(RoutineStep).where(RoutineStep.routine_id == routine_id).order_by(RoutineStep.position)).all())


def _routines(db: Session, user_id, active_only: bool = True) -> list[Routine]:
    q = select(Routine).where(Routine.user_id == user_id)
    if active_only:
        q = q.where(Routine.active.is_(True))
    return list(db.scalars(q.order_by(Routine.position, Routine.name)).all())


def owned_routine(db: Session, user_id, routine_id) -> Routine:
    row = db.get(Routine, routine_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(404, "Routine not found")
    return row


def routine_out(db: Session, r: Routine) -> dict:
    steps = _steps(db, r.id)
    return {"id": r.id, "name": r.name, "kind": r.kind, "icon": r.icon, "start_time": r.start_time, "duration_minutes": r.duration_minutes,
            "day_rule": r.day_rule, "days": list(r.days or []), "position": r.position, "active": r.active,
            "steps": [{"id": s.id, "title": s.title, "detail": s.detail, "essential": s.essential, "position": s.position} for s in steps]}


# ---------- setup and editing ----------

def load_starter(db: Session, user_id) -> list[Routine]:
    """Adds the notebook routines once. Existing routines with the same name are left alone."""
    existing = {r.name for r in _routines(db, user_id, active_only=False)}
    added = []
    for pos, spec in enumerate(STARTER):
        if spec["name"] in existing:
            continue
        r = Routine(user_id=user_id, name=spec["name"], kind=spec.get("kind", "routine"), icon=spec["icon"], start_time=spec["start"],
                    duration_minutes=spec["minutes"], day_rule=spec["rule"], days=list(spec["days"]), position=pos)
        db.add(r)
        db.flush()
        for i, (title, essential) in enumerate(spec["steps"]):
            db.add(RoutineStep(user_id=user_id, routine_id=r.id, position=i, title=title, essential=essential))
        added.append(r)
    profile = _profile(db, user_id)
    if profile.work_days is None:
        profile.work_days = list(DEFAULT_WORK_DAYS)
    if profile.gym_days is None:
        profile.gym_days = list(DEFAULT_GYM_DAYS)
    db.flush()
    audit(db, user_id, "routine.starter", "routine", added[0].id if added else None, {"added": len(added)})
    return added


def save_routine(db: Session, user_id, data, routine: Routine | None = None) -> Routine:
    """Create or replace a routine and its steps. Steps keep their ids when given, so today's ticks survive edits."""
    creating = routine is None
    if creating:
        routine = Routine(user_id=user_id, position=len(_routines(db, user_id, active_only=False)))
        db.add(routine)
    for key, value in data.model_dump(exclude={"steps"}, exclude_unset=not creating).items():
        setattr(routine, key, value)
    routine.updated_at = now_utc()
    db.flush()
    if data.steps is not None:
        old = {s.id: s for s in _steps(db, routine.id)}
        keep = set()
        for i, step in enumerate(data.steps):
            row = old.get(step.id) if step.id else None
            if row is None:
                row = RoutineStep(user_id=user_id, routine_id=routine.id)
                db.add(row)
            row.position, row.title, row.detail, row.essential = i, step.title.strip(), step.detail, step.essential
            db.flush()
            keep.add(row.id)
        for sid, row in old.items():
            if sid not in keep:
                db.delete(row)
    db.flush()
    audit(db, user_id, "routine.save", "routine", routine.id)
    return routine


# ---------- doing a routine ----------

def _run(db: Session, routine: Routine, day: date, create: bool = True) -> RoutineRun | None:
    run = db.scalar(select(RoutineRun).where(RoutineRun.routine_id == routine.id, RoutineRun.run_date == day))
    if run is None and create:
        run = RoutineRun(user_id=routine.user_id, routine_id=routine.id, run_date=day, mode="full", status="open", done_step_ids=[])
        db.add(run)
        db.flush()
    return run


def _needed(steps: list[RoutineStep], mode: str) -> list[RoutineStep]:
    if mode == "short":
        essential = [s for s in steps if s.essential]
        return essential or steps[:3]
    return steps


def run_out(db: Session, routine: Routine, run: RoutineRun | None, day: date) -> dict:
    steps = _steps(db, routine.id)
    mode = run.mode if run else "full"
    needed = _needed(steps, mode)
    done = set(run.done_step_ids or []) if run else set()
    needed_done = sum(1 for s in needed if str(s.id) in done)
    return {**routine_out(db, routine), "date": day, "mode": mode, "status": run.status if run else "open",
            "done_step_ids": sorted(done), "needed_step_ids": [str(s.id) for s in needed],
            "progress": round(needed_done / len(needed), 2) if needed else 1.0, "finished_at": run.finished_at if run else None}


def tick(db: Session, routine: Routine, day: date, step_id: uuid.UUID, done: bool) -> dict:
    steps = {str(s.id): s for s in _steps(db, routine.id)}
    if str(step_id) not in steps:
        raise HTTPException(404, "Step not found")
    run = _run(db, routine, day)
    ids = set(run.done_step_ids or [])
    (ids.add if done else ids.discard)(str(step_id))
    run.done_step_ids = sorted(ids)  # new list, so the JSON change is saved
    if run.status == "skipped" and done:
        run.status = "open"
    _maybe_finish(db, routine, run)
    run.updated_at = now_utc()
    db.flush()
    return run_out(db, routine, run, day)


def set_mode(db: Session, routine: Routine, day: date, mode: str) -> dict:
    run = _run(db, routine, day)
    run.mode = mode
    if run.status == "skipped":
        run.status = "open"
    _maybe_finish(db, routine, run)
    run.updated_at = now_utc()
    db.flush()
    return run_out(db, routine, run, day)


def skip(db: Session, routine: Routine, day: date) -> dict:
    """Skipping is allowed. It is recorded so the week view is honest, and never costs points."""
    run = _run(db, routine, day)
    if run.status != "done":
        run.status = "skipped"
        run.updated_at = now_utc()
    db.flush()
    return run_out(db, routine, run, day)


def _maybe_finish(db: Session, routine: Routine, run: RoutineRun) -> None:
    needed = _needed(_steps(db, routine.id), run.mode)
    done = set(run.done_step_ids or [])
    complete = bool(needed) and all(str(s.id) in done for s in needed)
    if complete and run.status != "done":
        run.status, run.finished_at = "done", now_utc()
        from app.services.game import award_safely
        points = FULL_POINTS if run.mode == "full" else SHORT_POINTS
        award_safely(db, run.user_id, "routine", f"{routine.id}:{run.run_date.isoformat()}",
                     f"{routine.name} ({'short version' if run.mode == 'short' else 'done'})"[:200], points)
    elif not complete and run.status == "done":
        run.status, run.finished_at = "open", None  # un-ticked a step; points already given stay (no punishment)


# ---------- day / week / month ----------

def _resolved_start(routine: Routine, profile: UserProfile) -> time | None:
    if routine.start_time is not None:
        return routine.start_time
    return profile.wake_time if routine.kind == "routine" else None


def day_view(db: Session, user_id, day: date) -> dict:
    profile = _profile(db, user_id)
    items = []
    all_routines = _routines(db, user_id)
    for r in all_routines:
        if runs_on(r, profile, day):
            out = run_out(db, r, _run(db, r, day, create=False), day)
            out["starts"] = _resolved_start(r, profile)
            items.append(out)
    items.sort(key=lambda x: (x["kind"] != "checklist", x["starts"] or time(0, 0)))
    routines = [i for i in items if i["kind"] == "routine"]
    done = sum(1 for i in routines if i["status"] == "done")
    meals = list(db.scalars(select(MealLog).where(MealLog.user_id == user_id, MealLog.local_date == day).order_by(MealLog.eaten_time, MealLog.created_at)).all())
    return {"date": day, "day_type": day_type(profile, day), "items": items, "has_routines": bool(all_routines),
            "score": round(done / len(routines), 2) if routines else None, "done": done, "total": len(routines),
            "meals": [meal_out(m) for m in meals], "eating_rules": EATING_RULES}


def routine_blocks(db: Session, user_id, day: date, tz) -> list[tuple[str, datetime, datetime]]:
    """Timed routines for the day plan (checklists are not time blocks)."""
    profile = _profile(db, user_id)
    out = []
    for r in _routines(db, user_id):
        if r.kind != "routine" or not runs_on(r, profile, day):
            continue
        start = _resolved_start(r, profile)
        if start is None:
            continue
        begin = datetime.combine(day, start, tzinfo=tz)
        out.append((f"{r.icon} {r.name}", begin, begin + timedelta(minutes=r.duration_minutes)))
    return out


def _runs_between(db: Session, user_id, first: date, last: date) -> dict[tuple[uuid.UUID, date], RoutineRun]:
    rows = db.scalars(select(RoutineRun).where(RoutineRun.user_id == user_id, RoutineRun.run_date >= first, RoutineRun.run_date <= last)).all()
    return {(r.routine_id, r.run_date): r for r in rows}


def _day_summary(routines: list[Routine], profile: UserProfile, runs: dict, day: date) -> dict:
    due = [r for r in routines if r.kind == "routine" and runs_on(r, profile, day)]
    entries = []
    for r in due:
        run = runs.get((r.id, day))
        entries.append({"id": r.id, "name": r.name, "icon": r.icon, "status": run.status if run else "open", "mode": run.mode if run else "full"})
    done = sum(1 for e in entries if e["status"] == "done")
    gym_routine = next((r for r in due if r.day_rule == "gym"), None)
    gym_done = bool(gym_routine and runs.get((gym_routine.id, day)) and runs[(gym_routine.id, day)].status == "done")
    return {"date": day, "day_type": day_type(profile, day), "routines": entries, "done": done, "total": len(entries),
            "score": round(done / len(entries), 2) if entries else None, "gym_done": gym_done}


def week_view(db: Session, user_id, start: date | None = None) -> dict:
    """Monday-to-Sunday week: day types, routines per day, gym target, and a gentle weekly score."""
    profile = _profile(db, user_id)
    today = today_for(db, user_id)
    monday = (start or today) - timedelta(days=(start or today).weekday())
    sunday = monday + timedelta(days=6)
    routines = _routines(db, user_id)
    runs = _runs_between(db, user_id, monday, sunday)
    days = [_day_summary(routines, profile, runs, monday + timedelta(days=i)) for i in range(7)]
    past = [d for d in days if d["date"] <= today and d["score"] is not None]
    gym_target = len(gym_days(profile))
    gym_done = sum(1 for d in days if d["gym_done"])
    score = round(sum(d["score"] for d in past) / len(past), 2) if past else None
    perfect = [d["date"] for d in past if d["score"] == 1.0]
    return {"start": monday, "end": sunday, "today": today, "days": days, "work_days": work_days(profile), "gym_days": gym_days(profile),
            "gym": {"target": gym_target, "done": gym_done, "planned_left": sum(1 for d in days if d["day_type"]["gym"] and d["date"] > today)},
            "score": score, "perfect_days": perfect, "message": _week_message(score, gym_done, gym_target, len(perfect))}


def _week_message(score: float | None, gym_done: int, gym_target: int, perfect: int) -> str:
    if score is None:
        return "A fresh week. Start with the short version if the day is busy."
    parts = []
    if perfect:
        parts.append(f"{perfect} perfect day{'s' if perfect > 1 else ''} 🌟")
    if gym_done >= gym_target and gym_target:
        parts.append("gym target reached 💪")
    if score >= 0.8:
        parts.append("strong week, keep the rhythm")
    elif score >= 0.5:
        parts.append("good progress; the short version keeps streaks alive on busy days")
    else:
        parts.append("tough week; pick one routine to protect tomorrow, that's enough")
    return " · ".join(parts).capitalize()


def month_view(db: Session, user_id, month: str | None = None) -> dict:
    profile = _profile(db, user_id)
    today = today_for(db, user_id)
    if month:
        try:
            year, mon = (int(x) for x in month.split("-"))
            first = date(year, mon, 1)
        except ValueError as exc:
            raise HTTPException(422, "month must look like 2026-11") from exc
    else:
        first = today.replace(day=1)
    last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
    routines = _routines(db, user_id)
    runs = _runs_between(db, user_id, first, last)
    days = []
    for n in range(last.day):
        d = _day_summary(routines, profile, runs, first + timedelta(days=n))
        days.append({"date": d["date"], "score": d["score"], "done": d["done"], "total": d["total"], "gym_done": d["gym_done"],
                     "icon": d["day_type"]["icon"], "label": d["day_type"]["label"], "future": d["date"] > today})
    past = [d for d in days if not d["future"] and d["score"] is not None]
    streak = best = 0
    for d in past:  # a day counts toward the streak when at least half its routines are done (forgiving)
        streak = streak + 1 if d["score"] >= 0.5 else 0
        best = max(best, streak)
    per_routine = []
    for r in [r for r in routines if r.kind == "routine"]:
        due = [d for d in past if runs_on(r, profile, d["date"])]
        done = sum(1 for d in due if runs.get((r.id, d["date"])) and runs[(r.id, d["date"])].status == "done")
        per_routine.append({"id": r.id, "name": r.name, "icon": r.icon, "done": done, "due": len(due)})
    return {"month": first.strftime("%Y-%m"), "first_weekday": first.isoweekday(), "days": days,
            "score": round(sum(d["score"] for d in past) / len(past), 2) if past else None,
            "gym_sessions": sum(1 for d in past if d["gym_done"]), "best_streak": best, "current_streak": streak, "routines": per_routine}


# ---------- meals ----------

def meal_out(m: MealLog) -> dict:
    checks = [m.slow, m.no_screen, m.upright, m.stopped_80, m.walked_after]
    return {"id": m.id, "meal": m.meal, "local_date": m.local_date, "slow": m.slow, "no_screen": m.no_screen, "upright": m.upright,
            "stopped_80": m.stopped_80, "walked_after": m.walked_after, "note": m.note, "mindful": sum(checks), "created_at": m.created_at,
            "foods": m.foods, "eaten_time": m.eaten_time}


def log_meal(db: Session, user_id, data) -> MealLog:
    row = MealLog(user_id=user_id, local_date=data.local_date or today_for(db, user_id), **data.model_dump(exclude={"local_date"}))
    db.add(row)
    db.flush()
    if sum([row.slow, row.no_screen, row.upright, row.stopped_80, row.walked_after]) >= 4:
        from app.services.game import award_safely
        award_safely(db, user_id, "habit", f"meal:{row.id}", f"Mindful {row.meal}", 5, "health")
    return row
