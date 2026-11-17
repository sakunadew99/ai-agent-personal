"""Gym log: exercises, sets (kg x reps), time spent, personal records and weekly volume. Plain code."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import UserProfile, Workout, WorkoutSet

EXERCISES: dict[str, list[str]] = {
    "Chest": ["Bench press", "Incline dumbbell press", "Dumbbell fly", "Cable crossover", "Push-up", "Chest press machine", "Dips"],
    "Back": ["Deadlift", "Pull-up", "Lat pulldown", "Barbell row", "Seated cable row", "One-arm dumbbell row", "Face pull"],
    "Legs": ["Squat", "Leg press", "Romanian deadlift", "Lunges", "Leg extension", "Leg curl", "Calf raise", "Hip thrust"],
    "Shoulders": ["Overhead press", "Dumbbell shoulder press", "Lateral raise", "Rear delt fly", "Upright row", "Shrugs"],
    "Arms": ["Barbell curl", "Dumbbell curl", "Hammer curl", "Triceps pushdown", "Skull crusher", "Overhead triceps extension"],
    "Core": ["Plank", "Crunches", "Hanging leg raise", "Russian twist", "Cable crunch", "Ab wheel"],
    "Cardio": ["Treadmill", "Cycling", "Rowing machine", "Elliptical", "Stair climber", "Skipping rope"],
}
GROUP_OF = {e.lower(): g for g, items in EXERCISES.items() for e in items}
TEMPLATES = {
    "Push day": ["Bench press", "Overhead press", "Incline dumbbell press", "Lateral raise", "Triceps pushdown"],
    "Pull day": ["Deadlift", "Lat pulldown", "Barbell row", "Face pull", "Barbell curl"],
    "Leg day": ["Squat", "Romanian deadlift", "Leg press", "Leg curl", "Calf raise"],
    "Full body": ["Squat", "Bench press", "Barbell row", "Overhead press", "Plank"],
    "Upper body": ["Bench press", "Pull-up", "Dumbbell shoulder press", "Seated cable row", "Dumbbell curl", "Triceps pushdown"],
}


def _tz(db: Session, user_id):
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(p.timezone if p else "Asia/Colombo")


def e1rm(weight: Decimal | None, reps: int | None) -> float | None:
    """Estimated one-rep max (Epley). Only for 1-12 reps, where it is reasonable."""
    if weight is None or not reps or reps > 12:
        return None
    return round(float(weight) * (1 + reps / 30), 1)


def log_workout(db: Session, user_id, data) -> Workout:
    if not data.sets and not data.duration_minutes:
        raise HTTPException(422, "Add at least one set or the minutes you trained")
    started = as_utc(data.started_at) if data.started_at else now_utc()
    minutes = data.duration_minutes or max(10, len(data.sets) * 3)
    w = Workout(user_id=user_id, activity=(data.title or "Gym").strip()[:100], duration_minutes=minutes, calories=data.calories,
                started_at=started, notes=data.notes, source="manual")
    db.add(w); db.flush()
    counters: dict[str, int] = defaultdict(int)
    for s in data.sets[:120]:
        name = s.exercise.strip()[:80]
        counters[name.lower()] += 1
        db.add(WorkoutSet(user_id=user_id, workout_id=w.id, exercise=name, set_no=counters[name.lower()], weight_kg=s.weight_kg, reps=s.reps, seconds=s.seconds))
    db.flush()
    return w


def workout_out(w: Workout, sets: list[WorkoutSet], tz) -> dict:
    by_ex: dict[str, list[dict]] = defaultdict(list)
    for s in sorted(sets, key=lambda x: (x.created_at, x.set_no)):
        by_ex[s.exercise].append({"set_no": s.set_no, "weight_kg": float(s.weight_kg) if s.weight_kg is not None else None, "reps": s.reps, "seconds": s.seconds})
    volume = sum(float(s.weight_kg or 0) * (s.reps or 0) for s in sets)
    return {"id": w.id, "title": w.activity, "date": as_utc(w.started_at).astimezone(tz).date(), "started_at": w.started_at, "minutes": w.duration_minutes,
            "calories": w.calories, "notes": w.notes, "volume_kg": round(volume), "set_count": len(sets),
            "exercises": [{"exercise": k, "group": GROUP_OF.get(k.lower(), "Other"), "sets": v} for k, v in by_ex.items()]}


def overview(db: Session, user_id) -> dict:
    tz = _tz(db, user_id)
    today = now_utc().astimezone(tz).date()
    since = today - timedelta(days=90)
    works = db.scalars(select(Workout).where(Workout.user_id == user_id, Workout.started_at >= datetime.combine(since, datetime.min.time(), tz))
                       .order_by(Workout.started_at.desc())).all()
    sets = db.scalars(select(WorkoutSet).where(WorkoutSet.user_id == user_id, WorkoutSet.workout_id.in_([w.id for w in works] or [None]))).all()
    by_w: dict = defaultdict(list)
    for s in sets:
        by_w[s.workout_id].append(s)
    monday = today - timedelta(days=today.weekday())
    weeks = []
    for i in range(7, -1, -1):
        start = monday - timedelta(weeks=i)
        ws = [w for w in works if start <= as_utc(w.started_at).astimezone(tz).date() < start + timedelta(days=7)]
        weeks.append({"week": start.isoformat(), "label": start.strftime("%d %b"), "sessions": len(ws), "minutes": sum(w.duration_minutes for w in ws),
                      "volume_kg": round(sum(float(s.weight_kg or 0) * (s.reps or 0) for w in ws for s in by_w[w.id]))})
    prs: dict[str, dict] = {}
    last: dict[str, dict] = {}
    for w in sorted(works, key=lambda x: x.started_at):
        d = as_utc(w.started_at).astimezone(tz).date().isoformat()
        for s in by_w[w.id]:
            k = s.exercise
            est = e1rm(s.weight_kg, s.reps)
            cur = prs.get(k)
            if s.weight_kg is not None and (cur is None or float(s.weight_kg) > cur["weight_kg"] or (float(s.weight_kg) == cur["weight_kg"] and (s.reps or 0) > (cur["reps"] or 0))):
                prs[k] = {"exercise": k, "weight_kg": float(s.weight_kg), "reps": s.reps, "date": d, "e1rm": est}
            last[k] = {"exercise": k, "weight_kg": float(s.weight_kg) if s.weight_kg is not None else None, "reps": s.reps, "date": d}
    muscle = defaultdict(int)
    for w in works:
        if as_utc(w.started_at).astimezone(tz).date() >= today - timedelta(days=30):
            for s in by_w[w.id]:
                muscle[GROUP_OF.get(s.exercise.lower(), "Other")] += 1
    this_week = weeks[-1]
    return {
        "today": today, "exercises": EXERCISES, "templates": TEMPLATES,
        "recent": [workout_out(w, by_w[w.id], tz) for w in works[:12]],
        "weeks": weeks, "this_week": this_week, "month_minutes": sum(w.duration_minutes for w in works if as_utc(w.started_at).astimezone(tz).date() >= today - timedelta(days=30)),
        "prs": sorted(prs.values(), key=lambda p: -(p["e1rm"] or p["weight_kg"]))[:12], "last": last,
        "sets_by_muscle_30d": dict(sorted(muscle.items(), key=lambda kv: -kv[1])),
        "trained_today": any(as_utc(w.started_at).astimezone(tz).date() == today for w in works),
    }
