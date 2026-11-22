"""Ask Sakuna: plain-code answers to the five everyday questions, plus a plan check that only *proposes* fixes.

- What should I do today?      -> overdue + due today + today's plan, best first
- What is my most important task? -> one task, with the reasons it won
- What progress did I make this week? -> finished tasks, goal movement, life areas
- What am I neglecting?        -> behind life areas, goals with no recent work, stale tasks
- What should I focus on next? -> the next action of your top goal, or the next task

Works without any AI key. The plan check never changes anything itself: it creates pending approvals
(the same records MCP proposals use), which you approve, reject or cancel.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import Approval, Goal, Task, User, UserProfile
from app.services.audit import audit

OPEN = ("inbox", "todo", "in_progress")
PRIO = {"high": 30, "medium": 15, "low": 5}
QUESTIONS = {"today": "What should I do today?", "important": "What is my most important task?", "week": "What progress did I make this week?",
             "neglecting": "What am I neglecting?", "next": "What should I focus on next?"}


def _tz(db: Session, user_id):
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(p.timezone if p else "Asia/Colombo")


def _local_day(dt: datetime | None, tz) -> date | None:
    return as_utc(dt).astimezone(tz).date() if dt else None


def score(t: Task, today: date, tz, goal_ids: set) -> tuple[int, list[str]]:
    """Plain scoring: priority + deadline pressure + linked to an active goal + already started."""
    s, why = PRIO.get(t.priority, 10), [f"{t.priority} priority"]
    d = _local_day(t.due_at, tz)
    if d is not None:
        if d < today:
            late = (today - d).days
            s += 25 + min(late, 10) * 2; why.append(f"overdue by {late} day{'s' if late != 1 else ''}")
        elif d == today:
            s += 25; why.append("due today")
        elif d <= today + timedelta(days=2):
            s += 12; why.append("due in the next 2 days")
    if t.goal_id and t.goal_id in goal_ids:
        s += 10; why.append("moves an active goal")
    if t.status == "in_progress":
        s += 6; why.append("already started")
    return s, why


def _task(t: Task, tz, s: int | None = None, why: list[str] | None = None) -> dict:
    out = {"id": t.id, "title": t.title, "priority": t.priority, "status": t.status, "due": _local_day(t.due_at, tz), "minutes": t.duration_minutes}
    if s is not None:
        out["score"], out["why"] = s, why
    return out


def _ranked(db: Session, user_id, today: date, tz):
    goals = db.scalars(select(Goal).where(Goal.user_id == user_id, Goal.status == "active")).all()
    gids = {g.id for g in goals}
    tasks = db.scalars(select(Task).where(Task.user_id == user_id, Task.status.in_(OPEN))).all()
    ranked = sorted(((t, *score(t, today, tz, gids)) for t in tasks), key=lambda x: (-x[1], x[0].title.lower()))
    return goals, ranked


def answer(db: Session, user: User, q: str, today: date | None = None) -> dict:
    tz = _tz(db, user.id)
    today = today or now_utc().astimezone(tz).date()
    goals, ranked = _ranked(db, user.id, today, tz)
    if q == "today":
        due = [(t, s, w) for t, s, w in ranked if (d := _local_day(t.due_at, tz)) is not None and d <= today]
        pick = due[:5] or ranked[:3]
        mins = sum(t.duration_minutes or 30 for t, _, _ in pick)
        text = (f"{len(due)} task{'s' if len(due) != 1 else ''} due today or overdue. Start with “{pick[0][0].title}”." if due
                else f"Nothing is due today. Good picks: {', '.join('“' + t.title + '”' for t, _, _ in pick)}." if pick
                else "Your task list is clear. Add one thing that moves a goal forward.")
        return {"question": QUESTIONS[q], "answer": text, "tasks": [_task(t, tz, s, w) for t, s, w in pick], "minutes": mins}
    if q == "important":
        if not ranked:
            return {"question": QUESTIONS[q], "answer": "No open tasks. Pick one goal and write its next action as a task.", "tasks": []}
        t, s, w = ranked[0]
        return {"question": QUESTIONS[q], "answer": f"“{t.title}”: {', '.join(w)}.", "tasks": [_task(t, tz, s, w)]}
    if q == "week":
        start = today - timedelta(days=today.weekday())
        lo = as_utc(datetime.combine(start, time.min, tzinfo=tz))
        done = db.scalars(select(Task).where(Task.user_id == user.id, Task.status == "done", Task.completed_at.is_not(None), Task.completed_at >= lo)).all()
        from app.services import compass
        try:
            areas = compass.view(db, user.id, today)["areas"]
        except Exception:  # life areas are optional; never break the answer
            areas = []
        good = [a["name"] for a in areas if a.get("status") in ("on_track", "done", "ahead")]
        moved = [g.title for g in goals if any(t.goal_id == g.id for t in done)]
        parts = [f"You finished {len(done)} task{'s' if len(done) != 1 else ''} since Monday"]
        if moved:
            parts.append(f"moving {', '.join(moved[:3])}")
        text = ", ".join(parts) + "." + (f" On track: {', '.join(good[:4])}." if good else "")
        return {"question": QUESTIONS[q], "answer": text, "done": [_task(t, tz) for t in done[:20]], "goals_moved": moved,
                "areas": [{"name": a["name"], "percent": a.get("percent"), "status": a.get("status")} for a in areas]}
    if q == "neglecting":
        items: list[dict] = []
        from app.services import compass
        try:
            for a in compass.view(db, user.id, today)["areas"]:
                if a.get("status") == "behind":
                    items.append({"kind": "area", "title": f"{a['name']} is behind this week", "detail": a.get("suggestion")})
        except Exception:
            pass
        since = now_utc() - timedelta(days=14)
        for g in goals:
            recent = db.scalar(select(Task.id).where(Task.user_id == user.id, Task.goal_id == g.id, Task.status == "done", Task.completed_at >= since).limit(1))
            if not recent:
                items.append({"kind": "goal", "id": g.id, "title": f"No progress on “{g.title}” in 2 weeks",
                              "detail": f"Next action: {g.next_action}" if g.next_action else "Add one small next action"})
        stale = [t for t, _, _ in ranked if (d := _local_day(t.due_at, tz)) is not None and d < today - timedelta(days=7)]
        if stale:
            items.append({"kind": "tasks", "title": f"{len(stale)} task{'s' if len(stale) != 1 else ''} overdue by more than a week",
                          "detail": "Do it, move it to a real date, or drop it. Run a plan check to get proposals."})
        text = items[0]["title"] + "." if items else "Nothing stands out as neglected. Nice balance."
        return {"question": QUESTIONS[q], "answer": text, "items": items[:8]}
    if q == "next":
        g = sorted((g for g in goals if g.next_action), key=lambda g: (g.due_date or date.max, g.title))
        nxt = ranked[:3]
        if g:
            text = f"For “{g[0].title}”: {g[0].next_action}."
        elif nxt:
            text = f"Next up: “{nxt[0][0].title}”."
        else:
            text = "Set a next action on your most important goal; I'll keep it in front of you."
        return {"question": QUESTIONS[q], "answer": text, "tasks": [_task(t, tz, s, w) for t, s, w in nxt],
                "goal": {"id": g[0].id, "title": g[0].title, "next_action": g[0].next_action} if g else None}
    raise ValueError(q)


def plan_check(db: Session, user: User, today: date | None = None) -> dict:
    """Find overdue open tasks and propose moving each to tomorrow (same local time). Creates pending approvals only."""
    tz = _tz(db, user.id)
    today = today or now_utc().astimezone(tz).date()
    pending = db.scalars(select(Approval).where(Approval.user_id == user.id, Approval.status == "pending", Approval.tool_name == "update_task")).all()
    already = {str((a.payload.get("body") or {}).get("id")) for a in pending}
    created = []
    tasks = db.scalars(select(Task).where(Task.user_id == user.id, Task.status.in_(OPEN), Task.due_at.is_not(None)).order_by(Task.due_at)).all()
    for t in tasks:
        local = as_utc(t.due_at).astimezone(tz)
        if local.date() >= today or str(t.id) in already:
            continue
        new = as_utc(datetime.combine(today + timedelta(days=1), local.timetz().replace(tzinfo=None), tzinfo=tz))
        body = {"id": str(t.id), "due_at": new.isoformat()}
        row = Approval(user_id=user.id, tool_name="update_task", status="pending",
                       payload={"action": "update_task", "body": body, "source": "plan_check",
                                "preview": f"Move “{t.title}” from {local.date().isoformat()} to {(today + timedelta(days=1)).isoformat()} {local.strftime('%H:%M')}",
                                "reason": f"Overdue by {(today - local.date()).days} day(s)"})
        db.add(row); db.flush()
        audit(db, user.id, "approval.create", "approval", row.id, {"tool": "update_task", "source": "plan_check"}, actor="planner")
        created.append({"id": row.id, "preview": row.payload["preview"], "reason": row.payload["reason"]})
        if len(created) >= 10:
            break
    return {"proposals": created, "skipped_already_pending": len(already),
            "message": f"{len(created)} proposal{'s' if len(created) != 1 else ''} waiting in Approvals." if created else "Your plan looks fine: nothing overdue to move."}
