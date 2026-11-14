"""Coach moments (guide 26): observe and diagnose in plain code, offer 1-3 options with evidence, you decide.

- Morning brief, evening wrap-up, daily check-in, and pattern rules with a daily cap, one per kind per day, mute per kind,
  and "ignored 3 times -> ask once whether to keep it".
- Wellbeing guard: low sleep produces "slow down", never "work harder".
- Distress in a check-in note stops productivity coaching for the day and responds with care and where to get help.
- Not a doctor, therapist or financial adviser: it describes patterns in your own records and suggests small habits.
Options are code-defined actions (create a small task, move overdue tasks, mute), so the coach cannot be talked into
anything else. Works with no AI key.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import (
    CoachSettings, CoachSuggestion, DailyCheckin, FocusSession, Habit, HabitLog, HealthRecord, SleepRecord, Task, UserProfile, Workout,
)
from app.services.audit import audit

KINDS = ("low_sleep", "document_expiring", "overdue_pileup", "overloaded", "focus_drop", "no_exercise", "habit_slipping", "goal_behind", "envelope_over")
OPEN = ("inbox", "todo", "in_progress")
DISTRESS = re.compile(r"\b(suicid\w*|kill myself|end (?:my|it all)|self[- ]?harm|hurt myself|want to die|don'?t want to (?:live|be here)|"
                      r"no reason to live|can'?t go on|hopeless|better off dead)\b", re.I)
CARE = {
    "message": ("I'm really sorry you're feeling this way. You don't have to handle it alone. I've paused all productivity "
                "suggestions for today. Please reach out to someone now: a person you trust, or a professional."),
    "help": [
        {"label": "Sri Lanka mental health helpline (National Institute of Mental Health)", "phone": "1926"},
        {"label": "Ambulance (Suwa Seriya, Sri Lanka)", "phone": "1990"},
        {"label": "If you are in danger right now", "phone": "your local emergency number"},
    ],
    "note": "Sakuna is not a therapist or crisis service. If you're outside Sri Lanka, contact your local emergency services.",
}


@dataclass
class Finding:
    kind: str
    message: str
    evidence: dict
    options: list[dict] = field(default_factory=list)


def is_distress(text: str | None) -> bool:
    return bool(text and DISTRESS.search(text))


def settings_for(db: Session, user_id) -> CoachSettings:
    row = db.scalar(select(CoachSettings).where(CoachSettings.user_id == user_id))
    if row is None:
        row = CoachSettings(user_id=user_id, muted_kinds=[])
        db.add(row)
        db.flush()
    return row


def _profile(db: Session, user_id) -> UserProfile | None:
    return db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))


def _opt(option_id: str, label: str, action: str) -> dict:
    return {"id": option_id, "label": label, "action": action}


# ---------- rules (plain code; each returns a Finding or None) ----------

def rule_low_sleep(db: Session, user_id, tz, today: date, gentle: bool) -> Finding | None:
    rows = db.scalars(select(SleepRecord).where(SleepRecord.user_id == user_id, SleepRecord.end_at >= now_utc() - timedelta(days=4))
                      .order_by(SleepRecord.end_at.desc()).limit(3)).all()
    if len(rows) < 3:
        return None
    avg = sum(r.duration_minutes for r in rows) / len(rows) / 60
    if avg >= 6:
        return None
    lead = "Your body is asking for rest. " if gentle else ""
    return Finding("low_sleep", f"{lead}You slept {avg:.1f} h a night over the last 3 nights. Go easy today and protect an early night.",
                   {"avg_sleep_hours_3_nights": round(avg, 1), "nights": len(rows)},
                   [_opt("early_night", "Remind me to wind down tonight", "task_today:Wind down for an early night:SLEEP-30:20"),
                    _opt("lighter", "Move my overdue low-priority tasks to next week", "move_overdue_low"),
                    _opt("dismiss", "Not now", "none")])


def rule_overdue(db: Session, user_id, tz, today: date, gentle: bool) -> Finding | None:
    overdue = db.scalars(select(Task).where(Task.user_id == user_id, Task.status.in_(OPEN), Task.due_at.is_not(None),
                                            Task.due_at < now_utc() - timedelta(hours=1))).all()
    if len(overdue) < 5:
        return None
    low = sum(1 for t in overdue if t.priority != "high")
    return Finding("overdue_pileup", f"{len(overdue)} tasks are overdue ({low} not high priority). Moving, splitting or dropping some will make today clearer.",
                   {"overdue": len(overdue), "not_high_priority": low},
                   [_opt("move", f"Move the {low} non-urgent ones to next Monday", "move_overdue_low"),
                    _opt("review", "I'll review them myself", "open:My life"), _opt("dismiss", "Not now", "none")])


def rule_overloaded(db: Session, user_id, tz, today: date, gentle: bool) -> Finding | None:
    from app.services.time_engine import insights
    data = insights(db, user_id, days=3)
    over = [d for d in data["days"] if d["overbooked"]]
    if not over:
        return None
    d = over[0]
    return Finding("overloaded", f"{d['date']} is planned for {d['planned_minutes'] // 60} h {d['planned_minutes'] % 60} m but you have about "
                   f"{d['capacity_minutes'] // 60} h free. Pick one thing to move or shrink.",
                   {"date": d["date"], "planned_minutes": d["planned_minutes"], "capacity_minutes": d["capacity_minutes"],
                    "multiplier": data["multiplier"]["multiplier"]},
                   [_opt("plan", "Open the planner", "open:Planner"), _opt("dismiss", "It's fine", "none")])


def _focus_minutes(db: Session, user_id, since: datetime, until: datetime) -> float:
    rows = db.execute(select(FocusSession.started_at, FocusSession.ended_at).where(
        FocusSession.user_id == user_id, FocusSession.ended_at.is_not(None), FocusSession.started_at >= since, FocusSession.started_at < until)).all()
    return sum(max(0.0, (as_utc(e) - as_utc(s)).total_seconds() / 60) for s, e in rows)


def rule_focus_drop(db: Session, user_id, tz, today: date, gentle: bool) -> Finding | None:
    now = now_utc()
    last7 = _focus_minutes(db, user_id, now - timedelta(days=7), now) / 7 / 60
    before = _focus_minutes(db, user_id, now - timedelta(days=35), now - timedelta(days=7)) / 28 / 60
    if before < 0.5 or last7 >= before * 0.5:
        return None
    return Finding("focus_drop", f"Focus averaged {last7:.1f} h/day this week vs {before:.1f} h/day the 4 weeks before. One 25-minute block tomorrow morning is enough to restart.",
                   {"focus_hours_per_day_last_7": round(last7, 2), "focus_hours_per_day_prev_28": round(before, 2)},
                   [_opt("block", "Plan a 25-min focus block tomorrow 09:00", "task_tomorrow:Focus block (25 min):09:00:25"),
                    _opt("dismiss", "Not now", "none")])


def rule_no_exercise(db: Session, user_id, tz, today: date, gentle: bool) -> Finding | None:
    last = db.scalar(select(func.max(Workout.started_at)).where(Workout.user_id == user_id))
    ever_steps = db.scalar(select(func.count()).select_from(HealthRecord).where(HealthRecord.user_id == user_id, HealthRecord.metric == "steps")) or 0
    if last is None and not ever_steps:
        return None  # never tracked exercise: don't nag
    days = (now_utc() - as_utc(last)).days if last else None
    if days is not None and days < 7:
        return None
    text = f"No workout logged in {days} days." if days is not None else "No workout logged yet (you do track steps)."
    return Finding("no_exercise", f"{text} A short walk counts.",
                   {"days_since_last_workout": days} if days is not None else {"workouts_logged": 0},
                   [_opt("walk", "Add a 20-min walk tomorrow 07:30", "task_tomorrow:20-minute walk:07:30:20"), _opt("dismiss", "Not now", "none")])


def rule_habit_slipping(db: Session, user_id, tz, today: date, gentle: bool) -> Finding | None:
    for habit in db.scalars(select(Habit).where(Habit.user_id == user_id, Habit.active.is_(True))).all():
        logs = set(db.scalars(select(HabitLog.logged_on).where(HabitLog.habit_id == habit.id, HabitLog.completed.is_(True),
                                                               HabitLog.logged_on >= today - timedelta(days=10))).all())
        recent = any(today - timedelta(days=i) in logs for i in range(3))
        before = sum(1 for i in range(3, 10) if today - timedelta(days=i) in logs)
        if not recent and before >= 4:
            name = habit.name.replace(":", " ")[:60]
            return Finding("habit_slipping", f"“{habit.name}” was done {before} of 7 days, but not in the last 3. A tiny version today keeps it alive.",
                           {"habit": habit.name, "done_days_previous_week": before},
                           [_opt("tiny", f"Remind me to do a tiny {name} today", f"task_today:Tiny {name}:NOW+60:10"),
                            _opt("dismiss", "Not now", "none")])
    return None


def rule_goal_behind(db: Session, user_id, tz, today: date, gentle: bool) -> Finding | None:
    from app.models.entities import Goal
    from app.services.goal_engine import forecast
    for goal in db.scalars(select(Goal).where(Goal.user_id == user_id, Goal.status == "active")).all():
        f = forecast(db, goal)
        behind = [lv for lv in f["levels"] if lv["status"] == "behind" and lv["level"] in ("floor", "realistic")]
        if behind and f["confidence"] != "low":
            lv = behind[0]
            return Finding("goal_behind", f"“{goal.title}” is behind its {lv['level']} level: it needs {lv['required_per_month']}/month, "
                           f"current pace is {f['rate_per_month']['trend']}/month.",
                           {"goal": goal.title, "level": lv["level"], "required_per_month": str(lv["required_per_month"]),
                            "trend_per_month": str(f["rate_per_month"]["trend"]), "data_days": f["data_days"]},
                           [_opt("review", "Review the goal and its levels", "open:My life"), _opt("dismiss", "Not now", "none")])
    return None


def rule_envelope_over(db: Session, user_id, tz, today: date, gentle: bool) -> Finding | None:
    from app.services.money import envelope_status
    over = [e for e in envelope_status(db, user_id) if e["over"]]
    if not over:
        return None
    e = over[0]
    return Finding("envelope_over", f"The “{e['name']}” envelope is over by {e['currency']} {abs(e['left']):,} this month. That's information, not a judgement.",
                   {"envelope": e["name"], "spent": str(e["spent"]), "budget": str(e["monthly_amount"])},
                   [_opt("look", "Open the Money hub", "open:Finance"), _opt("dismiss", "Okay", "none")])


def rule_document_expiring(db: Session, user_id, tz, today: date, gentle: bool) -> Finding | None:
    from app.models.entities import VaultDocument
    from app.services.vault import status_of
    for doc in db.scalars(select(VaultDocument).where(VaultDocument.user_id == user_id, VaultDocument.expires_on.is_not(None))
                          .order_by(VaultDocument.expires_on)).all():
        state, days = status_of(doc, today)
        if state in ("renew_now", "expired") and doc.reminder_task_id is None:
            when = f"expired {-days} days ago" if state == "expired" else f"expires in {days} days"
            return Finding("document_expiring", f"Your {doc.name} {when}. Renewals can take weeks, so it's worth starting now.",
                           {"document": doc.name, "expires_on": doc.expires_on.isoformat(), "days_left": days},
                           [_opt("remind", "Add a renewal task", f"doc_reminder:{doc.id}"), _opt("dismiss", "Not now", "none")])
    return None


RULES = {"low_sleep": rule_low_sleep, "document_expiring": rule_document_expiring, "overdue_pileup": rule_overdue, "overloaded": rule_overloaded, "focus_drop": rule_focus_drop,
         "no_exercise": rule_no_exercise, "habit_slipping": rule_habit_slipping, "goal_behind": rule_goal_behind, "envelope_over": rule_envelope_over}


# ---------- generation, decisions, brief ----------

def _ignored_three_times(db: Session, user_id, kind: str) -> bool:
    last = db.scalars(select(CoachSuggestion).where(CoachSuggestion.user_id == user_id, CoachSuggestion.kind == kind,
                                                    CoachSuggestion.status.in_(("dismissed", "expired", "accepted")))
                      .order_by(CoachSuggestion.created_at.desc()).limit(3)).all()
    return len(last) == 3 and all(s.status in ("dismissed", "expired") and s.choice != "keep" for s in last)


def generate(db: Session, user_id, today: date, tz) -> list[CoachSuggestion]:
    cfg = settings_for(db, user_id)
    for old in db.scalars(select(CoachSuggestion).where(CoachSuggestion.user_id == user_id, CoachSuggestion.status == "proposed",
                                                        CoachSuggestion.local_date < today)).all():
        old.status = "expired"
    existing = {s.kind: s for s in db.scalars(select(CoachSuggestion).where(CoachSuggestion.user_id == user_id, CoachSuggestion.local_date == today)).all()}
    count = len(existing)
    gentle = cfg.tone != "direct"
    for kind in KINDS:  # ordered by importance: rest first
        if count >= cfg.daily_cap or kind in existing or kind in (cfg.muted_kinds or []):
            continue
        try:
            finding = RULES[kind](db, user_id, tz, today, gentle)
        except Exception:  # noqa: BLE001 - one broken rule must not block the others
            finding = None
        if finding is None:
            continue
        options = finding.options
        if _ignored_three_times(db, user_id, kind):
            options = [_opt("keep", "Keep these suggestions", "keep"), _opt("mute", "Stop this kind", "mute")] + options[:1]
            finding.message = "You've passed on this kind of suggestion a few times. Keep it, or stop it? " + finding.message
        row = CoachSuggestion(user_id=user_id, kind=kind, local_date=today, message=finding.message[:500], evidence=finding.evidence, options=options)
        db.add(row)
        db.flush()
        existing[kind] = row
        count += 1
    return [s for s in existing.values() if s.status == "proposed"]


def _when(spec: str, day: date, tz, profile: UserProfile | None) -> datetime:
    if spec.startswith("SLEEP-"):
        sleep = profile.sleep_time if profile else time(23)
        base = datetime.combine(day, sleep, tzinfo=tz) - timedelta(minutes=int(spec[6:]))
        return base
    if spec.startswith("NOW+"):
        return datetime.now(tz) + timedelta(minutes=int(spec[4:]))
    return datetime.combine(day, time.fromisoformat(spec), tzinfo=tz)


def decide(db: Session, row: CoachSuggestion, option_id: str, helpful: bool | None) -> dict:
    if row.status != "proposed":
        raise HTTPException(status.HTTP_409_CONFLICT, "This suggestion was already handled.")
    option = next((o for o in row.options if o["id"] == option_id), None)
    if option is None:
        raise HTTPException(422, "Unknown option")
    profile = _profile(db, row.user_id)
    tz = zone(profile.timezone if profile else None)
    today = datetime.now(tz).date()
    action = option["action"]
    result: dict = {"done": option["label"]}
    if action.startswith(("task_today:", "task_tomorrow:")):
        from app.schemas.dto import TaskIn
        from app.services.actions import create_task
        parts = action.split(":")  # task_<day>:<title>:<HH:MM | SLEEP-n | NOW+n>:<minutes>; titles never contain ":"
        title, when_spec, minutes = parts[1], ":".join(parts[2:-1]), int(parts[-1])
        day = today if action.startswith("task_today:") else today + timedelta(days=1)
        task = create_task(db, row.user_id, TaskIn(title=title[:200], category="health" if row.kind in ("low_sleep", "no_exercise") else "personal",
                                                   due_at=_when(when_spec, day, tz, profile), duration_minutes=minutes, notes="Suggested by the coach; you chose it."))
        result["task_id"] = str(task.id)
    elif action == "move_overdue_low":
        monday = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
        moved = 0
        for task in db.scalars(select(Task).where(Task.user_id == row.user_id, Task.status.in_(OPEN), Task.priority != "high",
                                                  Task.due_at.is_not(None), Task.due_at < now_utc())).all():
            task.due_at = datetime.combine(monday, time(9), tzinfo=tz).astimezone(timezone.utc)
            task.updated_at = now_utc()
            moved += 1
        result["moved"] = moved
    elif action.startswith("doc_reminder:"):
        import uuid as _uuid
        from app.models.entities import VaultDocument
        from app.services.vault import add_reminder
        doc = db.get(VaultDocument, _uuid.UUID(action.split(":", 1)[1]))
        if doc is not None and doc.user_id == row.user_id:
            result["task_id"] = str(add_reminder(db, doc).id)
    elif action == "mute":
        cfg = settings_for(db, row.user_id)
        cfg.muted_kinds = sorted(set(cfg.muted_kinds or []) | {row.kind})
        cfg.updated_at = now_utc()
    elif action.startswith("open:"):
        result["open"] = action[5:]
    row.status = "dismissed" if action == "none" or action == "mute" else "accepted"
    row.choice = option_id
    row.helpful = helpful
    row.decided_at = now_utc()
    audit(db, row.user_id, "coach.decision", "coach_suggestion", row.id, {"kind": row.kind, "choice": option_id})
    return result


def checkin(db: Session, user_id, energy: int, mood: int, win: str | None, note: str | None) -> tuple[DailyCheckin, bool]:
    profile = _profile(db, user_id)
    today = datetime.now(zone(profile.timezone if profile else None)).date()
    row = db.scalar(select(DailyCheckin).where(DailyCheckin.user_id == user_id, DailyCheckin.local_date == today))
    if row is None:
        row = DailyCheckin(user_id=user_id, local_date=today, energy=energy, mood=mood)
        db.add(row)
    row.energy, row.mood, row.win, row.note, row.updated_at = energy, mood, (win or "").strip() or None, (note or "").strip() or None, now_utc()
    db.flush()
    distress = is_distress(row.note) or is_distress(row.win)
    if distress:
        for s in db.scalars(select(CoachSuggestion).where(CoachSuggestion.user_id == user_id, CoachSuggestion.local_date == today,
                                                          CoachSuggestion.status == "proposed")).all():
            s.status = "expired"
    return row, distress


def today_view(db: Session, user_id) -> dict:
    profile = _profile(db, user_id)
    tz = zone(profile.timezone if profile else None)
    now_local = datetime.now(tz)
    today = now_local.date()
    check = db.scalar(select(DailyCheckin).where(DailyCheckin.user_id == user_id, DailyCheckin.local_date == today))
    distress = bool(check and (is_distress(check.note) or is_distress(check.win)))
    cfg = settings_for(db, user_id)
    suggestions = [] if distress else generate(db, user_id, today, tz)
    from app.services.time_engine import insights
    t = insights(db, user_id, days=1)
    last_sleep = db.scalar(select(SleepRecord).where(SleepRecord.user_id == user_id).order_by(SleepRecord.end_at.desc()).limit(1))
    steps = db.scalar(select(func.max(HealthRecord.value)).where(HealthRecord.user_id == user_id, HealthRecord.metric == "steps",
                                                                  HealthRecord.recorded_at >= datetime.combine(today, time.min, tzinfo=tz).astimezone(timezone.utc)))
    balance_note = None
    if last_sleep and as_utc(last_sleep.end_at) > now_utc() - timedelta(hours=20):
        balance_note = f"You slept {last_sleep.duration_minutes // 60} h {last_sleep.duration_minutes % 60} m last night."
    elif steps:
        balance_note = f"{int(steps):,} steps so far today."
    end_today = datetime.combine(today + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    start_today = datetime.combine(today, time.min, tzinfo=tz).astimezone(timezone.utc)
    wrap = db.scalars(select(Task).where(Task.user_id == user_id, Task.status.in_(OPEN), Task.due_at >= start_today, Task.due_at < end_today)
                      .order_by(Task.due_at)).all()
    moment = "morning" if now_local.hour < 12 else "evening" if now_local.hour >= 18 else "day"
    return {
        "moment": moment, "date": today, "tone": cfg.tone, "daily_cap": cfg.daily_cap, "muted_kinds": cfg.muted_kinds or [],
        "checkin": {"energy": check.energy, "mood": check.mood, "win": check.win, "note": check.note} if check else None,
        "care": CARE if distress else None,
        "brief": None if distress else {"top3": t["top3"], "focus_window": t["deep_work_window"], "balance_note": balance_note,
                                        "today_capacity": t["days"][0] if t["days"] else None},
        "wrap_up": [] if distress else [{"id": str(w.id), "title": w.title, "due_at": w.due_at, "priority": w.priority} for w in wrap],
        "suggestions": [{"id": s.id, "kind": s.kind, "message": s.message, "evidence": s.evidence, "options": s.options} for s in suggestions],
        "about": "The coach notices patterns in your own records and offers small options. It is not a doctor, therapist or financial adviser.",
    }


def history(db: Session, user_id, days: int = 30) -> dict:
    since = date.today() - timedelta(days=days)
    checks = db.scalars(select(DailyCheckin).where(DailyCheckin.user_id == user_id, DailyCheckin.local_date >= since).order_by(DailyCheckin.local_date)).all()
    sugg = db.scalars(select(CoachSuggestion).where(CoachSuggestion.user_id == user_id, CoachSuggestion.local_date >= since)).all()
    by_kind: dict[str, dict] = {}
    for s in sugg:
        k = by_kind.setdefault(s.kind, {"shown": 0, "accepted": 0, "helpful": 0})
        k["shown"] += 1
        k["accepted"] += s.status == "accepted"
        k["helpful"] += bool(s.helpful)
    return {"checkins": [{"date": c.local_date, "energy": c.energy, "mood": c.mood, "win": c.win} for c in checks],
            "avg_energy": round(sum(c.energy for c in checks) / len(checks), 1) if checks else None,
            "avg_mood": round(sum(c.mood for c in checks) / len(checks), 1) if checks else None,
            "suggestions_by_kind": by_kind}
