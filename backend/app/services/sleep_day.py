"""Sleep from phone use, and "what did you do this hour?" gaps pre-filled from screen time. Plain code, no AI.

Sleep: the phone sends the longest screen-off stretch between 20:00 and 12:00 (short night check-ins merged). It's
saved as a sleep record with source "phone"; a Mi Band / Health Connect record for the same night always wins.
Gaps: waking hours with no time entry; each comes with the phone minutes and top apps for that hour and a suggested
answer (mostly distracting apps -> time waste, productive/education apps -> study or work, in work hours -> work).
"""
from __future__ import annotations

import statistics
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import DeviceUsage, SleepRecord, TimeEntry, UserProfile

LABELS = {"work": "💼 Work", "deep_work": "🎯 Deep work", "meeting": "👥 Meeting", "study": "📚 Study", "exercise": "🏋️ Exercise", "commute": "🚌 Travel",
          "chores": "🧹 Chores", "family": "👨‍👩‍👧 Family", "social": "🗣 Friends", "rest": "😌 Rest", "entertainment": "🎬 Fun", "wasted": "📱 Time waste",
          "sleep": "😴 Sleep", "other": "✍️ Other"}
QUICK = ["work", "study", "exercise", "family", "rest", "entertainment", "wasted", "commute", "chores", "other"]


def _profile(db: Session, user_id) -> UserProfile | None:
    return db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))


def _tz(db: Session, user_id):
    p = _profile(db, user_id)
    return zone(p.timezone if p else "Asia/Colombo")


def _target_minutes(p: UserProfile | None) -> int:
    if not p or not p.sleep_time or not p.wake_time:
        return 450
    m = (p.wake_time.hour * 60 + p.wake_time.minute) - (p.sleep_time.hour * 60 + p.sleep_time.minute)
    m = m if m > 0 else m + 1440
    return m if 300 <= m <= 660 else 450


def save_phone_sleep(db: Session, user_id, night: date, last_use: datetime, first_use: datetime, interruptions: list[dict], core_minutes: int) -> dict:
    """Upsert the phone estimate for the night ending on `night` (the morning date)."""
    lu, fu = last_use.astimezone(timezone.utc), first_use.astimezone(timezone.utc)
    span = int((fu - lu).total_seconds() // 60)
    if not 180 <= span <= 16 * 60:
        raise HTTPException(422, "A phone-free stretch of 3 to 16 hours is needed to count as sleep")
    tz = _tz(db, user_id)
    if fu.astimezone(tz).date() != night:
        raise HTTPException(422, "first_use must be on the night's morning date")
    rows = db.scalars(select(SleepRecord).where(SleepRecord.user_id == user_id, SleepRecord.source == "phone",
                                                SleepRecord.end_at >= fu - timedelta(hours=14), SleepRecord.end_at <= fu + timedelta(hours=14))).all()
    row = next((r for r in rows if as_utc(r.end_at).astimezone(tz).date() == night), None)
    awake = sum(int(i.get("minutes") or 0) for i in interruptions)
    if row is None:
        row = SleepRecord(user_id=user_id, source="phone", start_at=lu, end_at=fu, duration_minutes=span)
        db.add(row)
    row.start_at, row.end_at, row.duration_minutes = lu, fu, max(0, span - awake)
    row.stages = {"interruptions": interruptions[:20], "core_minutes": core_minutes, "method": "phone screen-off"}
    db.flush()
    return {"id": row.id, "night": night, "minutes": row.duration_minutes}


def nights(db: Session, user_id, days: int = 14, today: date | None = None) -> dict:
    tz = _tz(db, user_id)
    p = _profile(db, user_id)
    today = today or now_utc().astimezone(tz).date()
    since = datetime.combine(today - timedelta(days=days), time.min, tz)
    rows = db.scalars(select(SleepRecord).where(SleepRecord.user_id == user_id, SleepRecord.end_at >= since)).all()
    by_night: dict[date, SleepRecord] = {}
    for r in rows:
        d = as_utc(r.end_at).astimezone(tz).date()
        cur = by_night.get(d)
        band = r.source != "phone"
        if cur is None or (band and cur.source == "phone") or (band == (cur.source != "phone") and r.duration_minutes > cur.duration_minutes):
            by_night[d] = r
    target = _target_minutes(p)
    out = []
    for d in sorted(by_night, reverse=True):
        r = by_night[d]
        s, e = as_utc(r.start_at).astimezone(tz), as_utc(r.end_at).astimezone(tz)
        ints = ((r.stages or {}).get("interruptions") or []) if r.source == "phone" else []
        out.append({"night": d, "bed": s.strftime("%H:%M"), "wake": e.strftime("%H:%M"), "minutes": r.duration_minutes, "hours": round(r.duration_minutes / 60, 1),
                    "source": "Mi Band / Health Connect" if r.source != "phone" else "phone (screen off)", "interruptions": len(ints),
                    "after_midnight": 0 <= s.hour < 5, "vs_target": r.duration_minutes - target})
    week = [n for n in out if n["night"] > today - timedelta(days=7)]
    bed_mins = [(int(n["bed"][:2]) * 60 + int(n["bed"][3:]) + (1440 if int(n["bed"][:2]) < 12 else 0)) for n in week]
    insights = []
    if week:
        avg = sum(n["minutes"] for n in week) / len(week)
        debt = sum(max(0, -n["vs_target"]) for n in week)
        if avg < 420:
            insights.append(f"Averaging {avg / 60:.1f} h a night this week; under 7 h makes focus and discipline harder the next day.")
        if debt >= 120:
            insights.append(f"Sleep debt this week: about {debt // 60} h {debt % 60} min. An earlier night or two pays it back.")
        late = sum(1 for n in week if n["after_midnight"])
        if late >= 2:
            insights.append(f"Phone used past midnight on {late} nights. Try Shield from 22:30 and charging the phone outside the bedroom.")
        if len(bed_mins) >= 3 and statistics.pstdev(bed_mins) > 60:
            insights.append("Bedtime moves by more than an hour night to night; a steady bedtime makes waking up easier.")
    avg_bed = None
    if bed_mins:
        m = round(sum(bed_mins) / len(bed_mins)) % 1440
        avg_bed = f"{m // 60:02d}:{m % 60:02d}"
    return {"nights": out, "target_minutes": target, "avg_minutes_week": round(sum(n["minutes"] for n in week) / len(week)) if week else None,
            "avg_bed_week": avg_bed, "debt_minutes_week": sum(max(0, -n["vs_target"]) for n in week), "insights": insights,
            "how": "Phone: the longest stretch with the screen off between 8 pm and noon (3 h or more); short night check-ins are merged "
                   "and subtracted. A Mi Band / Health Connect record for the same night is used instead when there is one."}


def _covered(entries: list[TimeEntry], hour: int) -> int:
    """Minutes of [hour, hour+1) covered by time entries."""
    lo, hi = hour * 60, hour * 60 + 60
    total = 0
    for e in entries:
        s = e.start_time.hour * 60 + e.start_time.minute
        t = e.end_time.hour * 60 + e.end_time.minute + (1 if e.end_time.minute == 59 else 0)
        if t <= s:
            t += 1440
        total += max(0, min(hi, t) - max(lo, s))
    return min(60, total)


def gaps(db: Session, user_id, day: date, now_local: datetime | None = None) -> dict:
    tz = _tz(db, user_id)
    p = _profile(db, user_id)
    now_local = now_local or now_utc().astimezone(tz)
    entries = db.scalars(select(TimeEntry).where(TimeEntry.user_id == user_id, TimeEntry.local_date == day)).all()
    usage = db.scalar(select(DeviceUsage).where(DeviceUsage.user_id == user_id, DeviceUsage.local_date == day))
    sleep = nights(db, user_id, 2, day)["nights"]
    woke = next((n for n in sleep if n["night"] == day), None)
    start_h = int(woke["wake"][:2]) + (1 if woke and int(woke["wake"][3:]) >= 30 else 0) if woke else (p.wake_time.hour if p and p.wake_time else 7)
    end_h = 23 if day < now_local.date() else now_local.hour - 1
    if p and p.sleep_time and day < now_local.date() and p.sleep_time.hour >= 18:
        end_h = min(end_h, p.sleep_time.hour)
    hourly = list(usage.hourly) if usage and usage.hourly else [0] * 24
    hour_apps = list(usage.hourly_apps) if usage and usage.hourly_apps else [[] for _ in range(24)]
    work = (p.work_start.hour, p.work_end.hour) if p and p.work_start and p.work_end else (9, 17)
    out = []
    for h in range(max(0, start_h), max(0, end_h) + 1):
        if _covered(entries, h) >= 30:
            continue
        apps = hour_apps[h] if h < len(hour_apps) else []
        mins = int(hourly[h]) if h < len(hourly) else 0
        dist = sum(a.get("minutes", 0) for a in apps if a.get("mark") == "distracting")
        prod = sum(a.get("minutes", 0) for a in apps if a.get("mark") == "productive")
        edu = any(a.get("category") == "education" for a in apps)
        weekday = day.weekday() < 5
        if dist >= 20:
            sug, why = "wasted", f"{round(dist)} min on distracting apps"
        elif prod >= 20:
            sug, why = ("study" if edu else "work"), f"{round(prod)} min on productive apps"
        elif weekday and work[0] <= h < work[1]:
            sug, why = "work", "Your work hours"
        elif mins <= 5:
            sug, why = None, "Phone barely used"
        else:
            sug, why = None, f"{mins} min on the phone"
        out.append({"hour": h, "label": f"{h:02d}:00–{(h + 1) % 24:02d}:00", "phone_minutes": mins,
                    "apps": [{"label": a.get("label"), "minutes": round(a.get("minutes", 0)), "mark": a.get("mark")} for a in apps[:3]],
                    "suggestion": sug, "suggestion_label": LABELS.get(sug or "", None), "why": why})
    return {"day": day, "gaps": out[-16:], "choices": [{"key": k, "label": LABELS[k]} for k in QUICK], "slept": woke,
            "message": f"{len(out)} hour{'s' if len(out) != 1 else ''} to fill in" if out else "Every hour is accounted for. Nice."}


def fill(db: Session, user_id, day: date, answers: list[dict]) -> int:
    n = 0
    for a in answers[:24]:
        h = int(a["hour"])
        if a["category"] not in LABELS or not 0 <= h <= 23:
            raise HTTPException(422, "Unknown hour or category")
        db.add(TimeEntry(user_id=user_id, local_date=day, start_time=time(h, 0), end_time=time(h, 59), category=a["category"],
                         note=(a.get("note") or "").strip()[:300] or None, source="prompt"))
        n += 1
    db.flush()
    return n
