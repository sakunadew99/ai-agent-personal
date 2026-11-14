"""Google Calendar: read events (month plan, busy time for the time engine) and, only if you allowed it, add a task you
choose as an event with Google's own reminders (phone pop-up and/or an email to your Gmail).

Nothing is written unless you press the button for that task. Only events Sakuna created can be removed by Sakuna.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import Task, UserProfile
from app.services import google_oauth as g
from app.services.audit import audit

MAX_PAGES = 4


def _conn(db: Session, user_id):
    conn = g.get_connection(db, user_id, "calendar")
    return conn if conn is not None and conn.status == "connected" else None


def _parse(value: dict) -> tuple[datetime | None, bool]:
    if value.get("dateTime"):
        return as_utc(datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))), False
    if value.get("date"):
        return datetime.combine(date.fromisoformat(value["date"]), time.min, tzinfo=timezone.utc), True
    return None, False


def list_events(db: Session, user_id, start: datetime, end: datetime) -> tuple[list[dict], str]:
    """Events on the primary calendar between start and end. Returns (events, status) where status is
    connected | not_connected | expired | error. Never raises: the planner keeps working without the calendar."""
    conn = _conn(db, user_id)
    if conn is None:
        existing = g.get_connection(db, user_id, "calendar")
        return [], ("expired" if existing is not None and existing.status == "expired" else "not_connected")
    items: list[dict] = []
    params = {"timeMin": as_utc(start).isoformat(), "timeMax": as_utc(end).isoformat(), "singleEvents": "true",
              "orderBy": "startTime", "maxResults": 250}
    try:
        for _ in range(MAX_PAGES):
            code, data = g.call(db, conn, "GET", f"{g.CALENDAR_API}/calendars/primary/events", params)
            if code != 200:
                return [], "error"
            items.extend(data.get("items", []))
            if not data.get("nextPageToken"):
                break
            params = {**params, "pageToken": data["nextPageToken"]}
    except g.Expired:
        return [], "expired"
    except httpx.HTTPError:
        return [], "error"
    events = []
    for item in items:
        if item.get("status") == "cancelled":
            continue
        s, all_day = _parse(item.get("start", {}))
        e, _ = _parse(item.get("end", {}))
        if s is None or e is None:
            continue
        events.append({
            "id": str(item.get("id", ""))[:1024], "title": str(item.get("summary") or "(busy)")[:200], "start": s, "end": e,
            "all_day": all_day, "busy": item.get("transparency") != "transparent",
            "from_sakuna": bool(item.get("extendedProperties", {}).get("private", {}).get("sakuna_task_id")),
            "start_date": item.get("start", {}).get("date"),
        })
    return events, "connected"


def busy_minutes_by_day(events: list[dict], tz, days: list[date]) -> dict[date, int]:
    """Busy timed events merged (overlaps counted once) and clipped to each local day. All-day events don't count."""
    out: dict[date, int] = {}
    for day in days:
        lo = datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)
        hi = lo + timedelta(days=1)
        spans = sorted((max(e["start"], lo), min(e["end"], hi)) for e in events if e["busy"] and not e["all_day"] and e["start"] < hi and e["end"] > lo)
        total, cur_s, cur_e = 0, None, None
        for s, e in spans:
            if cur_e is None or s > cur_e:
                if cur_e is not None:
                    total += int((cur_e - cur_s).total_seconds() // 60)
                cur_s, cur_e = s, e
            else:
                cur_e = max(cur_e, e)
        if cur_e is not None:
            total += int((cur_e - cur_s).total_seconds() // 60)
        out[day] = total
    return out


def _rrule_for_google(rule: str) -> str:
    """Our rules use UNTIL=YYYYMMDD; Google wants a UTC date-time when DTSTART has a time."""
    parts = []
    for part in rule.split(";"):
        if part.startswith("UNTIL=") and len(part) == 14:
            part = f"{part}T235959Z"
        parts.append(part)
    return "RRULE:" + ";".join(parts)


def add_task(db: Session, user_id, task: Task, popup_minutes: int | None, email_minutes: int | None) -> dict:
    conn = _conn(db, user_id)
    if conn is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Connect Google Calendar first (Settings > Connected accounts).")
    if g.CAL_EVENTS not in conn.scopes.split():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Calendar is connected read-only. Reconnect and allow adding events.")
    if task.due_at is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give the task a date and time first.")
    if task.calendar_event_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This task is already in your Google Calendar.")
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    tz_name = profile.timezone if profile else "UTC"
    tz = zone(tz_name)
    start = as_utc(task.due_at).astimezone(tz)
    end = start + timedelta(minutes=task.duration_minutes or 30)
    overrides = [{"method": "popup", "minutes": popup_minutes}] if popup_minutes is not None else []
    if email_minutes is not None:
        overrides.append({"method": "email", "minutes": email_minutes})
    body = {
        "summary": task.title,
        "description": "Added from Sakuna AI. Edit or complete the task in Sakuna.",
        "start": {"dateTime": start.replace(tzinfo=None).isoformat(), "timeZone": tz_name},
        "end": {"dateTime": end.replace(tzinfo=None).isoformat(), "timeZone": tz_name},
        "reminders": {"useDefault": not overrides, "overrides": overrides} if overrides else {"useDefault": True},
        "extendedProperties": {"private": {"sakuna_task_id": str(task.id)}},
    }
    if task.recurrence:
        body["recurrence"] = [_rrule_for_google(task.recurrence)]
    try:
        code, data = g.call(db, conn, "POST", f"{g.CALENDAR_API}/calendars/primary/events", body=body)
    except g.Expired as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Google Calendar connection expired. Reconnect in Settings.") from exc
    if code not in (200, 201) or not data.get("id"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Google Calendar did not accept the event ({data.get('error', {}).get('message', code) if isinstance(data.get('error'), dict) else code})")
    task.calendar_event_id = str(data["id"])[:1024]
    task.updated_at = now_utc()
    audit(db, user_id, "calendar.event_added", "task", task.id, {"repeat": bool(task.recurrence), "email_reminder": email_minutes is not None})
    return {"event_id": task.calendar_event_id, "link": data.get("htmlLink"), "reminders": overrides or "calendar default"}


def remove_task(db: Session, user_id, task: Task) -> dict:
    if not task.calendar_event_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This task is not in Google Calendar.")
    conn = _conn(db, user_id)
    if conn is None or g.CAL_EVENTS not in conn.scopes.split():
        raise HTTPException(status.HTTP_409_CONFLICT, "Reconnect Google Calendar with permission to manage events.")
    event_id = task.calendar_event_id
    try:
        code, _ = g.call(db, conn, "DELETE", f"{g.CALENDAR_API}/calendars/primary/events/{event_id}")
    except g.Expired as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Google Calendar connection expired. Reconnect in Settings.") from exc
    if code not in (200, 204, 404, 410):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Google Calendar did not remove the event ({code})")
    # Repeating tasks share one recurring event: clear it from every copy.
    db.execute(update(Task).where(Task.user_id == user_id, Task.calendar_event_id == event_id).values(calendar_event_id=None))
    audit(db, user_id, "calendar.event_removed", "task", task.id)
    return {"removed": True}
