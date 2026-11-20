"""Detect your real office, gym, wake and sleep times from what you logged (plain statistics, no AI).

Sources, last 4 weeks: Day tracker time entries (work / deep work / meeting, exercise), gym workouts and synced sleep.
It only *suggests*: the times change when you confirm them (PATCH /profile).
"""
from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import SleepRecord, TimeEntry, UserProfile, Workout

WORK = ("work", "deep_work", "meeting")
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _m(t: time) -> int:
    return t.hour * 60 + t.minute


def _t(minutes: float) -> time:
    m = int(round(minutes / 15) * 15) % (24 * 60)          # nearest quarter hour
    return time(m // 60, m % 60)


def _hm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t else None


def _days_used(dates: set[date], weeks: int) -> list[int]:
    """Weekdays seen in at least half of the weeks that have any data (min 2)."""
    count: dict[int, int] = defaultdict(int)
    for d in dates:
        count[d.isoweekday()] += 1
    need = max(2, weeks // 2)
    return sorted(wd for wd, n in count.items() if n >= need)


def suggest(db: Session, user_id, days: int = 28) -> dict:
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    tz = zone(p.timezone if p else "Asia/Colombo")
    today = now_utc().astimezone(tz).date()
    since = today - timedelta(days=days)
    weeks = max(1, days // 7)
    entries = db.scalars(select(TimeEntry).where(TimeEntry.user_id == user_id, TimeEntry.local_date >= since)).all()

    first: dict[date, int] = {}
    last: dict[date, int] = {}
    gym_starts: dict[date, int] = {}
    for e in entries:
        s, f = _m(e.start_time), _m(e.end_time) or 24 * 60
        if e.category in WORK:
            first[e.local_date] = min(first.get(e.local_date, s), s)
            last[e.local_date] = max(last.get(e.local_date, f), f)
        elif e.category == "exercise":
            gym_starts[e.local_date] = min(gym_starts.get(e.local_date, s), s)
    for w in db.scalars(select(Workout).where(Workout.user_id == user_id, Workout.started_at >= now_utc() - timedelta(days=days))).all():
        local = as_utc(w.started_at).astimezone(tz)
        gym_starts[local.date()] = min(gym_starts.get(local.date(), local.hour * 60 + local.minute), local.hour * 60 + local.minute)

    wake, bed = [], []
    for s in db.scalars(select(SleepRecord).where(SleepRecord.user_id == user_id, SleepRecord.start_at >= now_utc() - timedelta(days=days))).all():
        st, en = as_utc(s.start_at).astimezone(tz), as_utc(s.end_at).astimezone(tz)
        if s.duration_minutes and s.duration_minutes >= 180:          # skip naps
            m = st.hour * 60 + st.minute
            bed.append(m + 24 * 60 if m < 12 * 60 else m)               # 00:30 counts as after midnight
            wake.append(en.hour * 60 + en.minute)

    current = {"work_start": _hm(p.work_start) if p else None, "work_end": _hm(p.work_end) if p else None, "gym_time": _hm(p.gym_time) if p else None,
               "wake_time": _hm(p.wake_time) if p else None, "sleep_time": _hm(p.sleep_time) if p else None,
               "work_days": (p.work_days if p else None), "gym_days": (p.gym_days if p else None)}
    suggested: dict = {}
    why: dict[str, str] = {}
    if len(first) >= 3:
        suggested["work_start"] = _hm(_t(statistics.median(first.values())))
        suggested["work_end"] = _hm(_t(statistics.median(last.values())))
        wd = _days_used(set(first), weeks)
        if wd:
            suggested["work_days"] = wd
        why["work"] = f"From {len(first)} days you logged work in the Day tracker."
    if len(gym_starts) >= 3:
        suggested["gym_time"] = _hm(_t(statistics.median(gym_starts.values())))
        gd = _days_used(set(gym_starts), weeks)
        if gd:
            suggested["gym_days"] = gd
        why["gym"] = f"From {len(gym_starts)} workouts / exercise blocks."
    if len(wake) >= 4:
        suggested["wake_time"] = _hm(_t(statistics.median(wake)))
        suggested["sleep_time"] = _hm(_t(statistics.median(bed)))
        why["sleep"] = f"From {len(wake)} nights of synced sleep."
    changes = [{"field": k, "from": current.get(k), "to": v} for k, v in suggested.items() if current.get(k) != v]
    return {"current": current, "suggested": suggested, "changes": changes, "why": why, "day_names": DAY_NAMES,
            "enough_data": bool(suggested),
            "tip": "Log a few days in Day tracker (hourly check-ins) and the Gym log, and keep Mi Band sleep syncing; Sakuna then learns your real times."}
