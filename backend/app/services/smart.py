"""Smarter days from the data Sakuna already has. Plain code; nothing here calls an AI or acts on its own.

- today_plan: one timeline for today from work hours, routines, gym days, exam study time, language minutes,
  tasks with a time, and your best focus hours (top tasks go there).
- week_insights: where the week's time went, worst hours and apps, and links like "you study more on gym days".
- auto_entries: time blocks Sakuna can fill in for the day tracker from workouts, finished routines and focus sessions.
- nudge: a gentle note when distracting phone time is already high today.
- all_in_net_worth, export_all, purge_old: money overview, a full data export, and keeping tracking data only as long as you want.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import (
    DeviceUsage, FocusSession, Goal, HabitLog, Routine, RoutineRun, Subscription, Task, TimeEntry, UserProfile, Workout,
)

COLORS = {"work": "#5aa8ff", "routine": "#4fd1c5", "gym": "#e6e15a", "study": "#b48cff", "language": "#f5b65b", "task": "#3ee08f",
          "focus": "#3ee08f", "bill": "#ff7a8a", "goal": "#b48cff", "meal": "#ff9f5a"}


def _profile(db: Session, user_id) -> UserProfile | None:
    return db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))


def _mins(t: time) -> int:
    return t.hour * 60 + t.minute


def _hm(m: int) -> str:
    m = max(0, min(24 * 60 - 1, m))
    return f"{m // 60:02d}:{m % 60:02d}"


def today_plan(db: Session, user_id, day: date | None = None) -> dict:
    from app.services import exams, language, routines, you
    p = _profile(db, user_id)
    tz = zone(p.timezone if p else "Asia/Colombo")
    day = day or now_utc().astimezone(tz).date()
    wd = day.isoweekday()
    blocks: list[dict] = []

    def add(start: int, minutes: int, title: str, kind: str, note: str = "", ref: str | None = None):
        blocks.append({"start": _hm(start), "end": _hm(start + minutes), "start_min": start, "minutes": minutes, "title": title, "kind": kind,
                       "color": COLORS.get(kind, "#8a9b92"), "note": note, "ref": ref})

    work = p and wd in routines.work_days(p)
    if work and p.work_start and p.work_end:
        add(_mins(p.work_start), max(30, _mins(p.work_end) - _mins(p.work_start)), "💼 Work / office", "work")
    for r in db.scalars(select(Routine).where(Routine.user_id == user_id, Routine.active.is_(True))).all():
        if p and routines.runs_on(r, p, day) and r.kind == "routine":
            st = routines._resolved_start(r, p)
            if st:
                add(_mins(st), r.duration_minutes, f"{r.icon} {r.name}", "routine", ref=str(r.id))
    if p and wd in routines.gym_days(p):
        add(_mins(p.gym_time) if p.gym_time else 18 * 60, 75, "🏋️ Gym", "gym", "Log your sets in Gym")
    lang_minutes = 0
    try:
        lang = language.today_plan(db, user_id, day)
        lang_minutes = sum(int(x["minutes"]) for x in lang["languages"] if x["lang"] == "german")
    except Exception:  # noqa: BLE001 - the plan still works without it
        lang = None
    for plan in exams.ensure_defaults(db, user_id):
        if not plan.active or wd not in (plan.study_days or []):
            continue
        mins = int(plan.daily_minutes or 30)
        add(_mins(plan.study_time) if plan.study_time else 20 * 60, mins, f"📚 {'IELTS' if plan.exam == 'ielts' else 'Goethe German'} study", "study", "Exam coach blocks")
    if lang_minutes:
        add(21 * 60, min(30, lang_minutes), "🗣 German words + video", "language", "Learning → Lang")
    start, end = datetime.combine(day, time.min, tz), datetime.combine(day + timedelta(days=1), time.min, tz)
    timed = db.scalars(select(Task).where(Task.user_id == user_id, Task.status.in_(["todo", "in_progress"]), Task.due_at >= start, Task.due_at < end)).all()
    for t in timed:
        local = as_utc(t.due_at).astimezone(tz)
        add(local.hour * 60 + local.minute, t.duration_minutes or 30, f"✓ {t.title}", "task", t.priority, ref=str(t.id))
    # Best focus hours (from your own last 4 weeks) get the most important open tasks without a time.
    best = None
    try:
        best = you.profile(db, user_id, day)["focus"]["best_hours"]
    except Exception:  # noqa: BLE001
        best = None
    focus_start = int(best["from"][:2]) * 60 if best else (_mins(p.work_start) if work and p and p.work_start else 9 * 60)
    open_tasks = db.scalars(select(Task).where(Task.user_id == user_id, Task.status.in_(["todo", "in_progress"]), Task.due_at.is_(None))).all()
    pr = {"high": 0, "medium": 1, "low": 2}
    top = sorted(open_tasks, key=lambda t: (pr.get(t.priority, 1), t.created_at))[:2]
    for i, t in enumerate(top):
        add(focus_start + i * 55, 50, f"🎯 Deep work: {t.title}", "focus", "your best focus hour" if best else "first thing", ref=str(t.id))
    for s in db.scalars(select(Subscription).where(Subscription.user_id == user_id, Subscription.active.is_(True), Subscription.next_due == day)).all():
        add(9 * 60, 5, f"💳 Pay / renew {s.name}", "bill")
    blocks.sort(key=lambda b: (b["start_min"], -b["minutes"]))
    # Free gaps in the waking day (07:00-22:00), so you can see room for more.
    busy, gaps, cur = sorted((b["start_min"], b["start_min"] + b["minutes"]) for b in blocks if b["kind"] != "work"), [], 7 * 60
    for a, b in busy:
        if a - cur >= 45:
            gaps.append({"start": _hm(cur), "end": _hm(a), "minutes": a - cur})
        cur = max(cur, b)
    if 22 * 60 - cur >= 45:
        gaps.append({"start": _hm(cur), "end": _hm(22 * 60), "minutes": 22 * 60 - cur})
    clashes = [f"{x['title']} overlaps {y['title']}" for i, x in enumerate(blocks) for y in blocks[i + 1:]
               if x["kind"] not in ("work",) and y["kind"] not in ("work",) and y["start_min"] < x["start_min"] + x["minutes"]][:3]
    return {"date": day, "weekday": wd, "work_day": bool(work), "blocks": blocks, "gaps": gaps[:5], "clashes": clashes,
            "best_focus": best, "planned_minutes": sum(b["minutes"] for b in blocks if b["kind"] != "work")}


def auto_entries(db: Session, user_id, day: date) -> list[dict]:
    """Blocks Sakuna knows happened (not saved, shown in the day report): workouts, finished routines, focus sessions."""
    p = _profile(db, user_id)
    tz = zone(p.timezone if p else "Asia/Colombo")
    start, end = datetime.combine(day, time.min, tz), datetime.combine(day + timedelta(days=1), time.min, tz)
    out = []
    for w in db.scalars(select(Workout).where(Workout.user_id == user_id, Workout.started_at >= start, Workout.started_at < end)).all():
        s = as_utc(w.started_at).astimezone(tz)
        out.append({"start": s.strftime("%H:%M"), "minutes": w.duration_minutes, "category": "exercise", "note": f"🏋️ {w.activity}", "source": "gym"})
    for f in db.scalars(select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.started_at >= start, FocusSession.started_at < end)).all():
        s = as_utc(f.started_at).astimezone(tz)
        mins = f.minutes_planned if f.ended_at is None else max(1, int((as_utc(f.ended_at) - as_utc(f.started_at)).total_seconds() // 60))
        out.append({"start": s.strftime("%H:%M"), "minutes": mins, "category": "deep_work", "note": f"🎯 {f.target or 'Focus session'}", "source": "focus"})
    runs = db.execute(select(RoutineRun, Routine).join(Routine, Routine.id == RoutineRun.routine_id)
                      .where(Routine.user_id == user_id, RoutineRun.run_date == day, RoutineRun.status == "done")).all()
    from app.services import routines
    for run, r in runs:
        st = routines._resolved_start(r, p) if p else None
        if st and r.kind == "routine":
            cat = "exercise" if "gym" in r.name.lower() else "chores" if r.icon in ("🔄", "🧹") else "rest"
            out.append({"start": st.strftime("%H:%M"), "minutes": r.duration_minutes, "category": cat, "note": f"{r.icon} {r.name}", "source": "routine"})
    return sorted(out, key=lambda x: x["start"])


def week_insights(db: Session, user_id, today: date | None = None) -> dict:
    p = _profile(db, user_id)
    tz = zone(p.timezone if p else "Asia/Colombo")
    today = today or now_utc().astimezone(tz).date()
    first = today - timedelta(days=6)
    days = [first + timedelta(days=i) for i in range(7)]
    entries = db.scalars(select(TimeEntry).where(TimeEntry.user_id == user_id, TimeEntry.local_date >= first, TimeEntry.local_date <= today)).all()
    usage = db.scalars(select(DeviceUsage).where(DeviceUsage.user_id == user_id, DeviceUsage.local_date >= first, DeviceUsage.local_date <= today)).all()
    gym_days = {as_utc(w.started_at).astimezone(tz).date() for w in db.scalars(select(Workout).where(
        Workout.user_id == user_id, Workout.started_at >= datetime.combine(first, time.min, tz))).all()}
    from app.services.tracking import PRODUCTIVE, WASTE, _minutes
    per_day = {d: defaultdict(int) for d in days}
    waste_hours: Counter = Counter()
    for e in entries:
        m = _minutes(e.start_time, e.end_time)
        per_day[e.local_date][e.category] += m
        if e.category in WASTE:
            waste_hours[e.start_time.hour] += m
    phone_hours: Counter = Counter()
    apps: Counter = Counter()
    for u in usage:
        for h, m in enumerate(u.hourly or []):
            phone_hours[h] += int(m)
        for a in u.apps or []:
            if a.get("mark") == "distracting":
                apps[a.get("label") or a.get("package")] += int(a.get("minutes", 0))
    rows = [{"date": d.isoformat(), "label": d.strftime("%a"), "productive": sum(v for k, v in per_day[d].items() if k in PRODUCTIVE),
             "wasted": sum(v for k, v in per_day[d].items() if k in WASTE) + next((u.distracting_minutes for u in usage if u.local_date == d), 0),
             "study": per_day[d].get("study", 0), "gym": d in gym_days} for d in days]
    found: list[str] = []
    worst = (phone_hours + waste_hours).most_common(1)
    if worst and worst[0][1] >= 60:
        h = worst[0][0]
        found.append(f"Most time is lost between {h:02d}:00 and {h + 1:02d}:00 ({worst[0][1]} min this week). Plan something fixed there.")
    if apps:
        top = apps.most_common(2)
        found.append("Top time-sinks: " + ", ".join(f"{a} {m // 60} h {m % 60} min" for a, m in top) + ".")
    g = [r["study"] for r in rows if r["gym"]]
    ng = [r["study"] for r in rows if not r["gym"]]
    if len(g) >= 2 and len(ng) >= 2 and sum(g) / len(g) > sum(ng) / len(ng) * 1.2:
        found.append(f"You study more on gym days ({round(sum(g) / len(g))} vs {round(sum(ng) / len(ng))} min). Keep the gym on study days.")
    best_day = max(rows, key=lambda r: r["productive"])
    if best_day["productive"] >= 120:
        found.append(f"Best day: {best_day['label']} with {best_day['productive'] // 60} h {best_day['productive'] % 60} min productive. Copy its shape.")
    if not entries and not usage:
        found.append("No tracking yet this week. Turn on hourly check-ins in Day tracker to get insights.")
    return {"from": first, "to": today, "days": rows, "insights": found,
            "totals": {"productive": sum(r["productive"] for r in rows), "wasted": sum(r["wasted"] for r in rows), "gym_days": sum(1 for r in rows if r["gym"])},
            "waste_by_hour": [{"hour": h, "minutes": (phone_hours + waste_hours).get(h, 0)} for h in range(24)],
            "top_apps": [{"label": a, "minutes": m} for a, m in apps.most_common(6)]}


def nudge(db: Session, user_id) -> dict | None:
    p = _profile(db, user_id)
    tz = zone(p.timezone if p else "Asia/Colombo")
    u = db.scalar(select(DeviceUsage).where(DeviceUsage.user_id == user_id, DeviceUsage.local_date == now_utc().astimezone(tz).date()))
    if not u or u.distracting_minutes < 45:
        return None
    top = sorted((a for a in (u.apps or []) if a.get("mark") == "distracting"), key=lambda a: -int(a.get("minutes", 0)))[:2]
    names = " and ".join(a.get("label", "") for a in top) or "distracting apps"
    level = "high" if u.distracting_minutes >= 120 else "medium"
    return {"level": level, "minutes": u.distracting_minutes, "text": f"{u.distracting_minutes} min on {names} today. Back to one small task? A 25-min focus block resets the day.",
            "action": "open:Focus"}


def all_in_net_worth(db: Session, user_id) -> dict:
    """Money everywhere in one view, per currency: accounts, assets, debts, and the CSE portfolio (LKR)."""
    from app.models.entities import Asset, FinancialAccount, Liability
    from app.services import invest
    by: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for a in db.scalars(select(FinancialAccount).where(FinancialAccount.user_id == user_id)).all():
        by[a.currency]["accounts"] += Decimal(a.balance or 0)
    for a in db.scalars(select(Asset).where(Asset.user_id == user_id)).all():
        by[a.currency]["assets"] += Decimal(a.value or 0)
    for d in db.scalars(select(Liability).where(Liability.user_id == user_id)).all():
        by[d.currency]["debts"] -= Decimal(d.balance or 0)
    try:
        port = invest.holdings(db, user_id)
        if port.get("value"):
            by["LKR"]["shares (CSE)"] += Decimal(str(port["value"]))
    except Exception:  # noqa: BLE001 - no portfolio is fine
        pass
    subs = db.scalars(select(Subscription).where(Subscription.user_id == user_id, Subscription.active.is_(True))).all()
    out = []
    for cur, parts in by.items():
        total = sum(parts.values(), Decimal(0))
        out.append({"currency": cur, "total": total.quantize(Decimal("0.01")), "parts": [{"label": k, "amount": v.quantize(Decimal("0.01"))} for k, v in parts.items() if v],
                    "monthly_subscriptions": sum((Decimal(s.amount or 0) * {"weekly": Decimal("4.33"), "monthly": 1, "quarterly": Decimal(1) / 3, "yearly": Decimal(1) / 12}[s.cycle]
                                                 for s in subs if s.currency == cur), Decimal(0)).quantize(Decimal("0.01"))})
    return {"currencies": sorted(out, key=lambda x: -abs(x["total"])), "note": "Each currency is shown on its own; nothing is converted by guess."}


SECRET_COLUMNS = {"password_hash", "number_enc", "token_hash", "access_token_enc", "refresh_token_enc", "key_hash", "code_verifier", "state"}
SKIP_TABLES = {"refresh_tokens", "oauth_states", "idempotency_keys", "ai_cache", "memory_embeddings", "audit_logs"}


def export_all(db: Session, user_id) -> dict:
    """Every row you own, as plain JSON (secrets and encrypted fields left out). For your own backup."""
    from app.core.database import Base
    out: dict[str, list] = {}
    for table in Base.metadata.sorted_tables:
        if table.name in SKIP_TABLES or "user_id" not in table.c:
            continue
        rows = db.execute(select(table).where(table.c.user_id == user_id)).mappings().all()
        if rows:
            out[table.name] = [{k: v for k, v in r.items() if k not in SECRET_COLUMNS} for r in rows]
    return {"exported_at": now_utc(), "tables": out, "counts": {k: len(v) for k, v in out.items()}}


def purge_old(db: Session) -> int:
    """Delete time entries and phone usage older than each user's 'keep for' setting (if they set one)."""
    from app.models.entities import AiSettings
    n = 0
    for s in db.scalars(select(AiSettings).where(AiSettings.keep_activity_days.is_not(None))).all():
        cutoff = date.today() - timedelta(days=int(s.keep_activity_days))
        for model in (TimeEntry, DeviceUsage):
            for row in db.scalars(select(model).where(model.user_id == s.user_id, model.local_date < cutoff)).all():
                db.delete(row); n += 1
    return n


__all__ = ["today_plan", "auto_entries", "week_insights", "nudge", "all_in_net_worth", "export_all", "purge_old", "Goal", "HabitLog"]
