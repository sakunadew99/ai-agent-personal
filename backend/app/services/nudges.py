"""In-app nudges and daily goals: short, friendly prompts with one-tap actions (water, tasks, habits, hours, events).

Plain code, ranked by urgency. Daily goals: 5 small wins a day; finishing all of them earns a bonus (checked here, on the
server, so it can't be claimed early). Calendar and approvals are included when available.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import Approval, PointsLedger, Task, UserProfile

OPEN = ("inbox", "todo", "in_progress")


def _profile(db: Session, user_id) -> UserProfile | None:
    return db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))


def today_tasks(db: Session, user_id, day: date, tz) -> dict:
    start = datetime.combine(day, time.min, tz)
    end = start + timedelta(days=1)
    rows = db.scalars(select(Task).where(Task.user_id == user_id, Task.status.in_(OPEN),
                                         ((Task.due_at < end) | (Task.status == "in_progress")))).all()
    done = db.scalars(select(Task).where(Task.user_id == user_id, Task.status == "done", Task.completed_at >= start, Task.completed_at < end)
                      .order_by(Task.completed_at.desc()).limit(8)).all()
    prio = {"high": 0, "medium": 1, "low": 2}

    def out(t: Task) -> dict:
        due = as_utc(t.due_at).astimezone(tz) if t.due_at else None
        return {"id": t.id, "title": t.title, "priority": t.priority, "status": t.status, "minutes": t.duration_minutes, "category": t.category,
                "due": due.strftime("%H:%M") if due and due.date() == day else None, "overdue": bool(due and due < now_utc().astimezone(tz)),
                "overdue_days": (day - due.date()).days if due and due.date() < day else 0, "on_calendar": bool(t.calendar_event_id)}
    rows = sorted(rows, key=lambda t: (prio.get(t.priority, 1), as_utc(t.due_at) if t.due_at else datetime.max.replace(tzinfo=start.tzinfo)))
    open_ = [out(t) for t in rows[:15]]
    return {"open": open_, "done": [{"id": t.id, "title": t.title} for t in done], "done_count": len(done), "total": len(open_) + len(done)}


def goals(db: Session, user, day: date) -> dict:
    from app.services import consistency, mindset, sleep_day
    p = _profile(db, user.id)
    tz = zone(p.timezone if p else "Asia/Colombo")
    w = mindset.water(db, user.id, day, datetime.combine(day, time.min, tz))
    tt = today_tasks(db, user.id, day, tz)
    hv = consistency.habits_view(db, user.id, day)
    m = mindset.overview(db, user.id, day)
    g = sleep_day.gaps(db, user.id, day)
    habits_done = sum(1 for h in hv if h["done_today"])
    items = [
        {"key": "water", "icon": "💧", "label": "Water goal", "done": w["today_ml"] >= w["target_ml"], "progress": f"{w['percent']}%"},
        {"key": "tasks", "icon": "✅", "label": "3 tasks done", "done": tt["done_count"] >= 3, "progress": f"{min(3, tt['done_count'])}/3"},
        {"key": "habits", "icon": "🔁", "label": "Habits", "done": bool(hv) and habits_done >= max(1, min(3, len(hv))), "progress": f"{habits_done}/{max(1, min(3, len(hv)))}" if hv else "add one"},
        {"key": "affirm", "icon": "✨", "label": "Affirmations", "done": bool(m["read_today"]), "progress": "✓" if m["read_today"] else "1 min"},
        {"key": "hours", "icon": "🧩", "label": "Hours logged", "done": len(g["gaps"]) <= 1, "progress": f"{len(g['gaps'])} left"},
    ]
    n = sum(1 for i in items if i["done"])
    claimed = db.scalar(select(func.count()).select_from(PointsLedger).where(PointsLedger.user_id == user.id, PointsLedger.event_type == "daily_combo",
                                                                             PointsLedger.ref_id == f"combo:{day}")) or 0
    return {"items": items, "done": n, "total": len(items), "complete": n == len(items), "claimed": bool(claimed), "bonus": 30,
            "_water": w, "_tasks": tt, "_habits": hv, "_mindset": m, "_gaps": g, "_tz": tz, "_profile": p}


def claim(db: Session, user, day: date) -> dict:
    from app.services import game
    g = goals(db, user, day)
    if not g["complete"]:
        return {"ok": False, "message": f"{g['total'] - g['done']} goal(s) to go"}
    pts = game.award_safely(db, user.id, "daily_combo", f"combo:{day}", "All 5 daily goals done")
    return {"ok": True, "points": pts, "message": "🎉 All daily goals done! +30 bonus" if pts else "Bonus already claimed today"}


def nudges(db: Session, user, day: date, now_local: datetime | None = None) -> dict:
    from app.services import gcalendar
    g = goals(db, user, day)
    tz, p = g["_tz"], g["_profile"]
    now_local = now_local or now_utc().astimezone(tz)
    out: list[dict] = []
    w = g["_water"]
    wake = p.wake_time if p and p.wake_time else time(7, 0)
    bed = p.sleep_time if p and p.sleep_time else time(22, 30)
    span = max(1, (bed.hour * 60 + bed.minute) - (wake.hour * 60 + wake.minute))
    gone = min(1.0, max(0.0, ((now_local.hour * 60 + now_local.minute) - (wake.hour * 60 + wake.minute)) / span))
    expected = int(w["target_ml"] * gone)
    if w["today_ml"] < expected - 300 and w["left_ml"] > 0:
        behind = expected - w["today_ml"]
        out.append({"id": f"water-{day}-{now_local.hour}", "icon": "💧", "tone": "blue", "priority": 70,
                    "title": f"You're {round(behind, -2):.0f} ml behind on water", "body": "A glass now keeps your energy and focus up.",
                    "action": {"label": "+250 ml", "kind": "water", "ml": 250}})
    for t in g["_tasks"]["open"][:3]:
        if t["overdue"] or (t["due"] and (int(t["due"][:2]) * 60 + int(t["due"][3:])) - (now_local.hour * 60 + now_local.minute) <= 90):
            out.append({"id": f"task-{t['id']}-{day}", "icon": "⏰", "tone": "red" if t["overdue"] else "amber", "priority": 90 if t["overdue"] else 80,
                        "title": (f"Overdue: {t['title']}" if t["overdue"] else f"Due at {t['due']}: {t['title']}")[:90],
                        "body": "Finish it now and keep your day on track (+points).", "action": {"label": "✓ Done", "kind": "task_done", "id": str(t["id"])}})
            break
    must = [h for h in g["_habits"] if h["status"] in ("must", "restart")]
    if must:
        h = must[0]
        out.append({"id": f"habit-{h['id']}-{day}", "icon": "🔥", "tone": "orange", "priority": 75, "title": f"Never miss twice: {h['name']}",
                    "body": f"Even the tiny version counts: {h['tiny']}.", "action": {"label": "✓ Did it", "kind": "habit_done", "id": str(h["id"])}})
    if not g["complete"]:
        left = g["total"] - g["done"]
        out.append({"id": f"combo-{day}-{g['done']}", "icon": "🎁", "tone": "purple", "priority": 60 if g["done"] >= 3 else 40,
                    "title": f"{g['done']}/{g['total']} daily goals: {left} more for +{g['bonus']} bonus",
                    "body": " · ".join(f"{i['icon']} {i['label']}" for i in g["items"] if not i["done"]), "action": {"label": "See goals", "kind": "open", "target": "Today"}})
    elif not g["claimed"]:
        out.append({"id": f"claim-{day}", "icon": "🏆", "tone": "gold", "priority": 95, "title": "All 5 daily goals done!", "body": f"Claim your +{g['bonus']} bonus.",
                    "action": {"label": "Claim 🎉", "kind": "claim"}})
    if len(g["_gaps"]["gaps"]) >= 3:
        out.append({"id": f"gaps-{day}-{len(g['_gaps']['gaps'])}", "icon": "🧩", "tone": "teal", "priority": 50, "title": f"{len(g['_gaps']['gaps'])} hours not logged",
                    "body": "30 seconds: tap what you did, suggestions are ready.", "action": {"label": "Fill in", "kind": "open", "target": "Today"}})
    if not g["_mindset"]["read_today"] and now_local.hour < 14:
        out.append({"id": f"affirm-{day}", "icon": "✨", "tone": "purple", "priority": 45, "title": "Today's affirmation is waiting",
                    "body": str((g["_mindset"]["affirmation_of_the_day"] or {}).get("text", ""))[:120], "action": {"label": "Read (+5)", "kind": "open", "target": "Mindset"}})
    events, state = gcalendar.list_events(db, user.id, now_utc(), now_utc() + timedelta(hours=2))
    soon = next((e for e in events if not e["all_day"] and as_utc(e["start"]) > now_utc()), None)
    if soon:
        mins = int((as_utc(soon["start"]) - now_utc()).total_seconds() // 60)
        if mins <= 60:
            out.append({"id": f"event-{soon['id']}", "icon": "📅", "tone": "blue", "priority": 85, "title": f"{soon['title']} in {mins} min",
                        "body": f"Starts {as_utc(soon['start']).astimezone(tz).strftime('%H:%M')}.", "action": {"label": "Plan", "kind": "open", "target": "Plan"}})
    pending = db.scalar(select(func.count()).select_from(Approval).where(Approval.user_id == user.id, Approval.status == "pending")) or 0
    if pending:
        out.append({"id": f"approvals-{day}-{pending}", "icon": "🛡", "tone": "teal", "priority": 65, "title": f"{pending} approval{'s' if pending > 1 else ''} waiting",
                    "body": "Sakuna only proposes; you decide.", "action": {"label": "Review", "kind": "open", "target": "Approvals"}})
    if now_local.time() >= time(max(0, bed.hour - 1), bed.minute):
        out.append({"id": f"wind-{day}", "icon": "🌙", "tone": "purple", "priority": 55, "title": "Time to wind down",
                    "body": f"Phone away by {bed.strftime('%H:%M')}; tomorrow-you will thank you.", "action": {"label": "Night review", "kind": "open", "target": "Today"}})
    out.sort(key=lambda x: -x["priority"])
    return {"nudges": out[:6], "goals": {k: v for k, v in g.items() if not k.startswith("_")}, "calendar": state}
