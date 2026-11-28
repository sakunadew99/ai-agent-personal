"""Consistency coach, the 24-hour Today ring and the weekly review. Plain code, no AI.

Habit strength (0-100) is an exponential average of the scheduled days you did it: recent days count more, one miss
only dents it, and it climbs back fast; the same idea as the open-source Loop Habit Tracker, written from scratch.
"Never miss twice": a miss yesterday turns today into a must-do (tiny version allowed). Habits get automatic around
day 66 on average (Lally et al., 2009), so each habit shows its day out of 66.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import (DeviceUsage, FocusSession, Habit, HabitLog, MindsetEntry, Task, TimeEntry, UserProfile, WaterLog)

ALPHA_DAY = 1 - 0.5 ** (1 / 13)          # a day's weight halves after ~2 weeks
ALPHA_WEEK = 1 - 0.5 ** (1 / 3)          # a week's weight halves after ~3 weeks
TINY = [("gym", "10 minutes or one set"), ("workout", "10 minutes or one set"), ("run", "5-minute walk-run"), ("walk", "5-minute walk"),
        ("read", "1 page"), ("book", "1 page"), ("german", "5 words"), ("english", "1 sentence out loud"), ("study", "10 minutes"),
        ("meditat", "1 minute of breathing"), ("yoga", "1 pose"), ("journal", "1 line"), ("affirm", "1 affirmation"), ("water", "1 glass"),
        ("code", "1 small commit"), ("python", "1 exercise"), ("sleep", "phone outside the bedroom"), ("push", "5 push-ups"), ("stretch", "2 minutes")]
ANCHORS = ["After I brush my teeth in the morning", "After I make my morning tea/coffee", "After lunch", "When I get home from work",
           "After dinner", "When I get into bed"]
COLORS = {"sleep": "#7c4dff", "work": "#42a5f5", "deep_work": "#1e88e5", "meeting": "#64b5f6", "study": "#43a047", "exercise": "#ff9800",
          "commute": "#8d6e63", "chores": "#78909c", "family": "#ec407a", "social": "#f06292", "rest": "#26a69a", "entertainment": "#ffca28",
          "wasted": "#ef5350", "other": "#9e9e9e", "unknown": "#37474f", "focus": "#00c853", "calendar": "#29b6f6"}
PRODUCTIVE = {"work", "deep_work", "meeting", "study", "exercise", "focus"}


def tiny_version(name: str) -> str:
    n = name.lower()
    return next((t for k, t in TINY if k in n), "the 2-minute version")


def strength(done: set[date], start: date, today: date, per_week: int | None) -> int:
    s = 0.0
    if per_week and per_week < 7:
        wk = start - timedelta(days=start.weekday())
        while wk <= today:
            n = sum(1 for i in range(7) if wk + timedelta(days=i) in done)
            full = wk + timedelta(days=6) < today
            if full or n >= per_week:                                 # don't punish a week that isn't over yet
                s = s * (1 - ALPHA_WEEK) + ALPHA_WEEK * min(1.0, n / per_week)
            wk += timedelta(days=7)
    else:
        d = start
        while d <= today:
            if d < today or d in done:                                 # today only counts once it's done
                s = s * (1 - ALPHA_DAY) + ALPHA_DAY * (1.0 if d in done else 0.0)
            d += timedelta(days=1)
    return round(s * 100)


def habits_view(db: Session, user_id, today: date) -> list[dict]:
    habits = db.scalars(select(Habit).where(Habit.user_id == user_id, Habit.active.is_(True)).order_by(Habit.created_at)).all()
    out = []
    for h in habits:
        logs = db.scalars(select(HabitLog.logged_on).where(HabitLog.habit_id == h.id, HabitLog.completed.is_(True), HabitLog.logged_on >= today - timedelta(days=180))).all()
        done = set(logs)
        created = as_utc(h.created_at).date() if h.created_at else today
        start = max(today - timedelta(days=120), min([created, *done]) if done else created)
        st = strength(done, start, today, h.target_per_week)
        streak, d = 0, today if today in done else today - timedelta(days=1)
        while d in done:
            streak += 1
            d -= timedelta(days=1)
        daily = not h.target_per_week or h.target_per_week >= 7
        missed_y = daily and start < today and (today - timedelta(days=1)) not in done
        missed_2 = missed_y and start < today - timedelta(days=1) and (today - timedelta(days=2)) not in done
        week_n = sum(1 for i in range(7) if today - timedelta(days=today.weekday()) + timedelta(days=i) in done)
        first = min(done) if done else None
        journey = min(66, (today - first).days + 1) if first else 0
        if today in done:
            status, nudge = "done", "Done today ✓"
        elif missed_2:
            status, nudge = "restart", f"Missed 2 days. No guilt: restart today with {tiny_version(h.name)}."
        elif missed_y:
            status, nudge = "must", f"Never miss twice: do it today, even just {tiny_version(h.name)}."
        else:
            status, nudge = "todo", f"Tiny version if you're busy: {tiny_version(h.name)}."
        out.append({"id": h.id, "name": h.name, "icon": h.icon or ("🚫" if h.kind == "avoid" else "✅"), "kind": h.kind, "strength": st, "streak": streak,
                    "done_today": today in done, "status": status, "nudge": nudge, "tiny": tiny_version(h.name),
                    "week_done": week_n, "week_target": h.target_per_week or 7, "journey_day": journey,
                    "level": "automatic" if st >= 80 and journey >= 66 else "strong" if st >= 60 else "growing" if st >= 30 else "new"})
    return out


def consistency(db: Session, user_id, today: date) -> dict:
    hv = habits_view(db, user_id, today)
    must = [h for h in hv if h["status"] in ("must", "restart")]
    avg = round(sum(h["strength"] for h in hv) / len(hv)) if hv else None
    names = [h["name"] for h in hv if not h["done_today"]][:3]
    stack = [{"anchor": ANCHORS[i % len(ANCHORS)], "habit": n, "text": f"{ANCHORS[i % len(ANCHORS)]}, I will {n.lower()}."} for i, n in enumerate(names)]
    return {"habits": hv, "average_strength": avg, "must_do": [h["name"] for h in must], "stacking": stack,
            "tips": ["Never miss twice: one miss is normal, two starts a new habit.", "On low days do the tiny version; keeping the chain matters more than intensity.",
                     "Same time, same place: link each habit to something you already do.", "Habits take about 66 days on average to feel automatic; be patient."],
            "how": __doc__.split("\n\n", 1)[1].strip() if __doc__ else ""}


def _tz(db: Session, user_id):
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(p.timezone if p else "Asia/Colombo")


def ring(db: Session, user_id, day: date, now_local: datetime | None = None) -> list[dict]:
    """96 quarter-hour slots for a day, each labelled by what you logged, focus sessions, or sleep; 'unknown' otherwise."""
    from app.services import sleep_day
    tz = _tz(db, user_id)
    now_local = now_local or now_utc().astimezone(tz)
    slots = ["unknown"] * 96
    for n in sleep_day.nights(db, user_id, 2, day)["nights"]:
        if n["night"] == day:                                           # this morning's sleep: from midnight (or bedtime) to wake
            bh, bm = int(n["bed"][:2]), int(n["bed"][3:])
            wh, wm = int(n["wake"][:2]), int(n["wake"][3:])
            lo = bh * 4 + bm // 15 if bh < 12 else 0
            for i in range(lo, min(96, wh * 4 + wm // 15)):
                slots[i] = "sleep"
        if n["night"] == day + timedelta(days=1):                       # tonight's bedtime, if already known
            bh, bm = int(n["bed"][:2]), int(n["bed"][3:])
            if bh >= 12:
                for i in range(bh * 4 + bm // 15, 96):
                    slots[i] = "sleep"
    start = datetime.combine(day, time.min, tz)
    for f in db.scalars(select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.started_at >= start, FocusSession.started_at < start + timedelta(days=1))).all():
        s = as_utc(f.started_at).astimezone(tz)
        mins = int((as_utc(f.ended_at) - as_utc(f.started_at)).total_seconds() // 60) if f.ended_at else int(f.minutes_planned or 25)
        for i in range(s.hour * 4 + s.minute // 15, min(96, (s.hour * 60 + s.minute + mins) // 15)):
            slots[i] = "focus"
    for e in db.scalars(select(TimeEntry).where(TimeEntry.user_id == user_id, TimeEntry.local_date == day)).all():
        a = e.start_time.hour * 4 + e.start_time.minute // 15
        b = e.end_time.hour * 4 + (e.end_time.minute + 1) // 15
        if b <= a:
            b = 96
        for i in range(a, min(96, b)):
            slots[i] = e.category
    try:
        from app.services import gcalendar
        evs, _st = gcalendar.list_events(db, user_id, start, start + timedelta(days=1))
        for ev in evs:
            if ev["all_day"] or not ev["busy"]:
                continue
            s2, e2 = as_utc(ev["start"]).astimezone(tz), as_utc(ev["end"]).astimezone(tz)
            a = s2.hour * 4 + s2.minute // 15 if s2.date() == day else 0
            b = (e2.hour * 4 + (e2.minute + 14) // 15) if e2.date() == day else 96
            for i in range(a, min(96, b)):
                if slots[i] == "unknown":
                    slots[i] = "calendar"
    except Exception:  # the calendar is optional; never break the ring
        pass
    if day == now_local.date():
        cut = now_local.hour * 4 + now_local.minute // 15
        for i in range(cut + 1, 96):
            if slots[i] == "unknown":
                slots[i] = "future"
    # compress into segments
    segs: list[dict] = []
    for i, c in enumerate(slots):
        if segs and segs[-1]["category"] == c:
            segs[-1]["slots"] += 1
        else:
            segs.append({"category": c, "start": f"{i // 4:02d}:{(i % 4) * 15:02d}", "slots": 1})
    for s in segs:
        s["minutes"] = s["slots"] * 15
        s["color"] = COLORS.get(s["category"], "#263238" if s["category"] == "future" else "#9e9e9e")
    return segs


def today(db: Session, user, day: date) -> dict:
    from app.services import ask, mindset, sleep_day
    segs = ring(db, user.id, day)
    totals = Counter()
    for s in segs:
        totals[s["category"]] += s["minutes"]
    gaps = sleep_day.gaps(db, user.id, day)
    from app.models.entities import UserProfile as UP
    p = db.scalar(select(UP).where(UP.user_id == user.id))
    tz = zone(p.timezone if p else "Asia/Colombo")
    w = mindset.water(db, user.id, day, datetime.combine(day, time.min, tz))
    m = mindset.overview(db, user.id, day)
    top = ask.answer(db, user, "important", day)
    hv = habits_view(db, user.id, day)
    last = next((n for n in sleep_day.nights(db, user.id, 2, day)["nights"] if n["night"] == day), None)
    from app.services import gcalendar, nudges
    start = datetime.combine(day, time.min, tz)
    evs, cal_state = gcalendar.list_events(db, user.id, start, start + timedelta(days=1))
    events = []
    for e in evs:
        s, en = as_utc(e["start"]).astimezone(tz), as_utc(e["end"]).astimezone(tz)
        events.append({"title": e["title"], "start": "all day" if e["all_day"] else s.strftime("%H:%M"), "end": "" if e["all_day"] else en.strftime("%H:%M"),
                       "all_day": e["all_day"], "minutes": 0 if e["all_day"] else int((en - s).total_seconds() // 60), "from_sakuna": e["from_sakuna"],
                       "upcoming": as_utc(e["start"]) > now_utc()})
    now_l = now_utc().astimezone(tz)
    nxt = next((x for x in events if x["upcoming"] and not x["all_day"]), None)
    if nxt:
        eh, em = int(nxt["start"][:2]), int(nxt["start"][3:])
        nxt = {**nxt, "in_minutes": max(0, (eh * 60 + em) - (now_l.hour * 60 + now_l.minute))}
    return {"day": day, "ring": segs, "totals": dict(totals), "events": events, "next_event": nxt, "calendar": cal_state,
            "tasks_today": nudges.today_tasks(db, user.id, day, tz),
            "productive_minutes": sum(v for k, v in totals.items() if k in PRODUCTIVE), "wasted_minutes": totals.get("wasted", 0),
            "unknown_minutes": totals.get("unknown", 0), "gaps": len(gaps["gaps"]),
            "sleep": last, "water": {k: w[k] for k in ("today_ml", "target_ml", "percent", "left_ml")},
            "top_task": top["tasks"][0] if top.get("tasks") else None, "top_task_answer": top["answer"],
            "habits": [{k: h[k] for k in ("id", "name", "icon", "done_today", "status", "strength", "streak", "tiny")} for h in hv],
            "affirmation": m["affirmation_of_the_day"], "affirm_read": m["read_today"], "colors": COLORS}


def weekly_review(db: Session, user_id, day: date) -> dict:
    from app.services import sleep_day
    start = day - timedelta(days=6)
    entries = db.scalars(select(TimeEntry).where(TimeEntry.user_id == user_id, TimeEntry.local_date >= start, TimeEntry.local_date <= day)).all()
    mins = Counter()
    for e in entries:
        a = e.start_time.hour * 60 + e.start_time.minute
        b = e.end_time.hour * 60 + e.end_time.minute + (1 if e.end_time.minute == 59 else 0)
        mins[e.category] += (b - a) if b > a else (b + 1440 - a)
    usage = db.scalars(select(DeviceUsage).where(DeviceUsage.user_id == user_id, DeviceUsage.local_date >= start, DeviceUsage.local_date <= day)).all()
    waste_apps = Counter()
    for u in usage:
        for a in u.apps or []:
            if a.get("mark") == "distracting":
                waste_apps[a.get("label") or a.get("package")] += int(a.get("minutes") or 0)
    water = db.scalars(select(WaterLog).where(WaterLog.user_id == user_id, WaterLog.local_date >= start, WaterLog.local_date <= day)).all()
    wd = Counter()
    for r in water:
        wd[r.local_date] += r.ml
    from app.services import mindset
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    tz = zone(p.timezone if p else "Asia/Colombo")
    base = mindset.water(db, user_id, day, datetime.combine(day, time.min, tz))["base_ml"]
    sl = sleep_day.nights(db, user_id, 7, day)
    hv = habits_view(db, user_id, day)
    done_tasks = db.scalar(select(Task.id).where(Task.user_id == user_id, Task.status == "done").limit(1))
    tasks_n = len(db.scalars(select(Task.id).where(Task.user_id == user_id, Task.status == "done", Task.completed_at >= datetime.combine(start, time.min, tz))).all()) if done_tasks else 0
    mind = db.scalars(select(MindsetEntry.kind).where(MindsetEntry.user_id == user_id, MindsetEntry.local_date >= start)).all()
    prod = sum(v for k, v in mins.items() if k in PRODUCTIVE)
    wins, fixes = [], []
    if prod >= 20 * 60:
        wins.append(f"{prod // 60} productive hours logged")
    if sl["avg_minutes_week"] and sl["avg_minutes_week"] >= 420:
        wins.append(f"Good sleep: {sl['avg_minutes_week'] / 60:.1f} h average")
    elif sl["avg_minutes_week"]:
        fixes.append(f"Sleep averaged {sl['avg_minutes_week'] / 60:.1f} h; aim for 7+ with an earlier, steadier bedtime")
    if mins["wasted"] >= 5 * 60:
        fixes.append(f"{mins['wasted'] // 60} h logged as time waste" + (f", mostly {waste_apps.most_common(1)[0][0]}" if waste_apps else "") + "; schedule Shield for those hours")
    strong = [h["name"] for h in hv if h["strength"] >= 60]
    if strong:
        wins.append(f"Strong habits: {', '.join(strong[:3])}")
    weak = [h["name"] for h in hv if h["status"] in ("must", "restart")]
    if weak:
        fixes.append(f"Restart: {', '.join(weak[:3])} (tiny version counts)")
    return {"from": start, "to": day, "productive_minutes": prod, "wasted_minutes": mins["wasted"], "by_category": dict(mins),
            "sleep_avg_minutes": sl["avg_minutes_week"], "sleep_debt_minutes": sl["debt_minutes_week"],
            "water_days_met": sum(1 for d, v in wd.items() if v >= base), "top_waste_apps": [{"app": k, "minutes": v} for k, v in waste_apps.most_common(3)],
            "habits_avg_strength": round(sum(h["strength"] for h in hv) / len(hv)) if hv else None, "tasks_done": tasks_n,
            "mindset": {"affirm_days": mind.count("affirm_read"), "scripting": mind.count("scripting"), "gratitude": mind.count("gratitude")},
            "wins": wins, "fixes": fixes, "one_change": fixes[0] if fixes else "Keep the same plan; it's working.",
            "score": max(0, min(100, round(prod / 60 * 1.5 + (sl["avg_minutes_week"] or 0) / 60 * 4 - mins["wasted"] / 60 * 2 + len(strong) * 5)))}


def checkin_plan(db: Session, user_id, today: date) -> dict:
    """Which hours (8:00-21:00) still need a 'what did you do?' check-in, today and tomorrow.

    Skipped: hours already logged or filled (sleep, focus, entries, gym/routines), Google Calendar meetings, your gym hour,
    and your sleep window. Hour h = the hour from h:00 to h+1:00 (the check-in is sent at h+1:00). Plain code.
    """
    from app.services import gcalendar, smart
    from app.services.routines import gym_days
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    tz = _tz(db, user_id)
    out = {}
    for d in (today, today + timedelta(days=1)):
        known: dict[int, str] = {}
        slots: list[str] = []
        for s in ring(db, user_id, d):
            slots += [s["category"]] * int(s["slots"])
        for h in range(24):
            q = slots[h * 4:h * 4 + 4]
            if q and all(c not in ("unknown", "future") for c in q):
                known[h] = q[0]
        for a in smart.auto_entries(db, user_id, d) if d == today else []:
            h = int(a["start"][:2])
            for k in range(h, min(24, h + max(1, round(a["minutes"] / 60)))):
                known.setdefault(k, a["category"])
        start = datetime.combine(d, time.min, tz)
        evs, _st = gcalendar.list_events(db, user_id, start, start + timedelta(days=1))
        for e in evs:
            if e["all_day"] or not e["busy"]:
                continue
            s2, e2 = as_utc(e["start"]).astimezone(tz), as_utc(e["end"]).astimezone(tz)
            for h in range(24):
                lo, hi = datetime.combine(d, time(h), tz), datetime.combine(d, time(h), tz) + timedelta(hours=1)
                if (min(hi, e2) - max(lo, s2)).total_seconds() >= 1800:
                    known.setdefault(h, "calendar")
        if p and p.gym_time and (p.gym_days is None or d.weekday() in gym_days(p)):
            known.setdefault(p.gym_time.hour, "exercise")
        wake = p.wake_time if p and p.wake_time else time(6, 30)
        bed = p.sleep_time if p and p.sleep_time else time(22, 30)
        for h in range(24):
            if h < wake.hour or (bed.hour >= 12 and h > bed.hour):
                known.setdefault(h, "sleep")
        hours = range(8, 21)
        out[d.isoformat()] = {"ask": [h for h in hours if h not in known], "skip": {str(h): known[h] for h in hours if h in known}}
    return out
