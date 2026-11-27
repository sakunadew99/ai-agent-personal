"""Settings hub data (profile + app preferences) and the morning / night briefs. Plain code.

App preferences live in one JSON field on the profile: the notification centre, onboarding status, the order and
visibility of Today cards and pinned screens. Only known keys are stored, with bounded values.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import zone
from app.models.entities import Task, UserProfile

NOTIFY = {   # key: (label, default on, default time HH:MM or None)
    "checkins": ("⏱ Hourly check-ins (what did you do?)", False, None),
    "water": ("💧 Water reminders every 2 hours", False, None),
    "tasks": ("✅ Task reminders", True, None),
    "habits": ("🔁 Habit reminders", True, None),
    "medicines": ("💊 Medicine reminders", True, None),
    "approvals": ("🛡 Approvals waiting (approve / reject from the notification)", True, None),
    "morning": ("🌅 Morning brief", True, "07:00"),
    "night": ("🌙 Night review", True, "21:30"),
    "affirmation": ("✨ Affirmation of the day", False, "08:00"),
    "weekly": ("🗓 Sunday weekly report", True, "19:00"),
    "backup": ("💾 Sunday backup reminder", True, "20:00"),
}
CARDS = ["brief", "goals", "tasks", "next_event", "ring", "gaps", "sleep_water", "affirmation", "inbox", "top_task", "habits", "stacking", "week", "more"]
MAX_PINNED = 8


def defaults() -> dict:
    return {"onboarding_done": False, "notifications": {k: {"on": on, "time": t} for k, (_l, on, t) in NOTIFY.items()},
            "cards": CARDS[:], "hidden_cards": [], "pinned": ["Today", "Water", "Mindset", "Reels"]}


def _profile(db: Session, user_id) -> UserProfile:
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    if p is None:
        p = UserProfile(user_id=user_id)
        db.add(p); db.flush()
    return p


def prefs(db: Session, user_id) -> dict:
    p = _profile(db, user_id)
    out = defaults()
    saved = p.app_prefs or {}
    out["onboarding_done"] = bool(saved.get("onboarding_done", False))
    for k, v in (saved.get("notifications") or {}).items():
        if k in NOTIFY and isinstance(v, dict):
            out["notifications"][k] = {"on": bool(v.get("on", out["notifications"][k]["on"])), "time": v.get("time", out["notifications"][k]["time"])}
    if isinstance(saved.get("cards"), list):
        order = [c for c in saved["cards"] if c in CARDS]
        out["cards"] = order + [c for c in CARDS if c not in order]
    if isinstance(saved.get("hidden_cards"), list):
        out["hidden_cards"] = [c for c in saved["hidden_cards"] if c in CARDS]
    if isinstance(saved.get("pinned"), list):
        out["pinned"] = [str(x)[:24] for x in saved["pinned"]][:MAX_PINNED]
    out["labels"] = {k: v[0] for k, v in NOTIFY.items()}
    return out


def _hhmm(v) -> str | None:
    if v is None:
        return None
    try:
        h, m = str(v).split(":")[:2]
        return time(int(h), int(m)).strftime("%H:%M")
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, "Times must look like 07:30") from exc


def update_prefs(db: Session, user_id, patch: dict) -> dict:
    cur = prefs(db, user_id)
    saved = {k: cur[k] for k in ("onboarding_done", "notifications", "cards", "hidden_cards", "pinned")}
    if "onboarding_done" in patch:
        saved["onboarding_done"] = bool(patch["onboarding_done"])
    for k, v in (patch.get("notifications") or {}).items():
        if k not in NOTIFY or not isinstance(v, dict):
            raise HTTPException(422, f"Unknown notification: {k}")
        if "on" in v:
            saved["notifications"][k]["on"] = bool(v["on"])
        if "time" in v and NOTIFY[k][2] is not None:
            saved["notifications"][k]["time"] = _hhmm(v["time"])
    if "cards" in patch:
        saved["cards"] = [c for c in patch["cards"] if c in CARDS] + [c for c in CARDS if c not in patch["cards"]]
    if "hidden_cards" in patch:
        saved["hidden_cards"] = [c for c in patch["hidden_cards"] if c in CARDS]
    if "pinned" in patch:
        saved["pinned"] = list(dict.fromkeys(str(x)[:24] for x in patch["pinned"]))[:MAX_PINNED]
    _profile(db, user_id).app_prefs = saved
    db.flush()
    return prefs(db, user_id)


# ------------------------------------------------------------------ morning / night briefs

def brief(db: Session, user, kind: str, day: date) -> dict:
    from app.services import ask, consistency, mindset, sleep_day
    p = _profile(db, user.id)
    tz = zone(p.timezone or "Asia/Colombo")
    w = mindset.water(db, user.id, day, datetime.combine(day, time.min, tz))
    hv = consistency.habits_view(db, user.id, day)
    if kind == "morning":
        sl = next((n for n in sleep_day.nights(db, user.id, 2, day)["nights"] if n["night"] == day), None)
        aff = mindset.overview(db, user.id, day)["affirmation_of_the_day"]
        tasks = ask.answer(db, user, "today", day)
        steps = [f"Drink a glass of water now ({w['target_ml']} ml today)."]
        if aff:
            steps.append(f"Read your affirmation: “{aff['text']}”")
        if tasks["tasks"]:
            steps.append(f"First task: {tasks['tasks'][0]['title']}")
        must = [h["name"] for h in hv if h["status"] in ("must", "restart")]
        if must:
            steps.append(f"Never miss twice: {', '.join(must[:2])}")
        from app.services import gcalendar, gmail
        start = datetime.combine(day, time.min, tz)
        evs, _st = gcalendar.list_events(db, user.id, start, start + timedelta(days=1))
        timed = [e for e in evs if not e["all_day"]]
        if timed:
            steps.append(f"{len(timed)} event(s) today, first “{timed[0]['title']}” at {timed[0]['start'].astimezone(tz).strftime('%H:%M')}.")
        mail = gmail.inbox(db, user.id, 3)
        if mail["emails"]:
            steps.append(f"{mail['unread']} unread email(s); top: “{mail['emails'][0]['subject'][:60]}”.")
        return {"kind": "morning", "title": "🌅 Good morning", "sleep": sl, "emails": mail["emails"], "events": len(timed), "affirmation": aff, "tasks": tasks["tasks"][:3], "water_target_ml": w["target_ml"],
                "habits_today": [h["name"] for h in hv if not h["done_today"]][:5], "steps": steps,
                "line": (f"You slept {sl['hours']} h. " if sl else "") + tasks["answer"]}
    tomorrow = day + timedelta(days=1)
    start = datetime.combine(tomorrow, time.min, tz)
    tmr = db.scalars(select(Task).where(Task.user_id == user.id, Task.status.in_(("inbox", "todo", "in_progress")), Task.due_at >= start,
                                        Task.due_at < start + timedelta(days=1)).order_by(Task.due_at)).all()
    gaps = sleep_day.gaps(db, user.id, day)
    done_h = sum(1 for h in hv if h["done_today"])
    bed = p.sleep_time.strftime("%H:%M") if p.sleep_time else "22:30"
    steps = []
    if gaps["gaps"]:
        steps.append(f"Fill in {len(gaps['gaps'])} unlogged hour(s) (one tap each).")
    if w["left_ml"] > 0:
        steps.append(f"Water: {w['left_ml']} ml left; a glass now, then stop an hour before bed.")
    left = [h["name"] for h in hv if not h["done_today"]]
    if left:
        steps.append(f"Still possible today (tiny version counts): {', '.join(left[:3])}")
    steps.append("Write 3 things you're grateful for.")
    steps.append(f"Phone away and lights down by {bed}.")
    return {"kind": "night", "title": "🌙 Night review", "habits_done": done_h, "habits_total": len(hv), "gaps": len(gaps["gaps"]),
            "water_left_ml": w["left_ml"], "tomorrow": [{"id": t.id, "title": t.title} for t in tmr[:3]], "bedtime": bed, "steps": steps}
