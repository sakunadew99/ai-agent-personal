"""Repeating tasks, phone reminders and the month view (Phase 3). Plain code: no AI, no external library.

Recurrence uses a small, safe subset of iCalendar RRULE, so it stays readable and portable:
    FREQ=DAILY|WEEKLY|MONTHLY|YEARLY   (required)
    INTERVAL=n                         (1-365, default 1)
    BYDAY=MO,TU,...                    (WEEKLY only)
    UNTIL=YYYYMMDD                     (last allowed date, inclusive, in the user's timezone)
Occurrences are computed on the user's local wall clock, so "every Monday 7 pm" stays 7 pm across DST changes.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

DAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
FREQS = ("DAILY", "WEEKLY", "MONTHLY", "YEARLY")
MAX_STEPS = 2000  # hard stop for any search loop


@dataclass(frozen=True)
class Rule:
    freq: str
    interval: int = 1
    byday: tuple[int, ...] = ()
    until: date | None = None

    def text(self) -> str:
        parts = [f"FREQ={self.freq}"]
        if self.interval != 1:
            parts.append(f"INTERVAL={self.interval}")
        if self.byday:
            parts.append("BYDAY=" + ",".join(DAYS[d] for d in self.byday))
        if self.until:
            parts.append("UNTIL=" + self.until.strftime("%Y%m%d"))
        return ";".join(parts)


def parse_rule(value: str) -> Rule:
    """Parse and validate a rule. Raises ValueError with a readable message."""
    fields: dict[str, str] = {}
    for part in value.strip().upper().removeprefix("RRULE:").split(";"):
        if not part:
            continue
        key, sep, val = part.partition("=")
        if not sep or not val:
            raise ValueError(f"Bad repeat rule part: {part!r}")
        if key not in ("FREQ", "INTERVAL", "BYDAY", "UNTIL"):
            raise ValueError(f"Unsupported repeat option {key}")
        fields[key] = val
    freq = fields.get("FREQ")
    if freq not in FREQS:
        raise ValueError("Repeat rule needs FREQ=DAILY, WEEKLY, MONTHLY or YEARLY")
    try:
        interval = int(fields.get("INTERVAL", "1"))
    except ValueError as exc:
        raise ValueError("INTERVAL must be a number") from exc
    if not 1 <= interval <= 365:
        raise ValueError("INTERVAL must be between 1 and 365")
    byday: tuple[int, ...] = ()
    if "BYDAY" in fields:
        if freq != "WEEKLY":
            raise ValueError("BYDAY is only supported with FREQ=WEEKLY")
        names = fields["BYDAY"].split(",")
        if any(name not in DAYS for name in names):
            raise ValueError("BYDAY uses MO,TU,WE,TH,FR,SA,SU")
        byday = tuple(sorted({DAYS.index(name) for name in names}))
    until = None
    if "UNTIL" in fields:
        try:
            until = datetime.strptime(fields["UNTIL"][:8], "%Y%m%d").date()
        except ValueError as exc:
            raise ValueError("UNTIL must look like 20271231") from exc
    return Rule(freq, interval, byday, until)


def normalize_rule(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return parse_rule(value).text()


def _add_months(day: date, months: int, anchor_day: int) -> date:
    total = day.month - 1 + months
    year, month = day.year + total // 12, total % 12 + 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def _candidates(rule: Rule, start: date):
    """Yield occurrence dates in order, starting at the series anchor `start` (inclusive)."""
    if rule.freq == "DAILY":
        for step in range(MAX_STEPS):
            yield start + timedelta(days=step * rule.interval)
    elif rule.freq == "WEEKLY":
        days = rule.byday or (start.weekday(),)
        week0 = start - timedelta(days=start.weekday())
        for step in range(MAX_STEPS):
            monday = week0 + timedelta(weeks=step * rule.interval)
            for d in days:
                candidate = monday + timedelta(days=d)
                if candidate >= start:
                    yield candidate
    else:
        months = 12 if rule.freq == "YEARLY" else 1
        for step in range(MAX_STEPS):
            yield _add_months(start, step * rule.interval * months, start.day)


def occurrences(rule: Rule, anchor: datetime, tz: ZoneInfo, after: datetime, before: datetime, limit: int = 400) -> list[datetime]:
    """Occurrences strictly after `after` and before `before` (UTC-aware), at the anchor's local time of day."""
    local_anchor = anchor.astimezone(tz)
    wall = local_anchor.timetz().replace(tzinfo=None)
    found: list[datetime] = []
    for day in _candidates(rule, local_anchor.date()):
        if rule.until and day > rule.until:
            break
        moment = datetime.combine(day, wall, tzinfo=tz)
        if moment >= before:
            break
        if moment > after:
            found.append(moment)
            if len(found) >= limit:
                break
    return found


def next_occurrence(rule_text: str, anchor: datetime, tz: ZoneInfo, now: datetime) -> datetime | None:
    """Next due time after both the current due time and now, so overdue series skip ahead instead of piling up."""
    rule = parse_rule(rule_text)
    after = max(anchor, now)
    found = occurrences(rule, anchor, tz, after, after + timedelta(days=366 * 5 * rule.interval), limit=1)
    return found[0] if found else None


def in_quiet(moment: time, start: time | None, end: time | None) -> bool:
    if start is None or end is None or start == end:
        return False
    if start < end:
        return start <= moment < end
    return moment >= start or moment < end  # window crosses midnight, e.g. 22:00-07:00


def respect_quiet_hours(at: datetime, tz: ZoneInfo, start: time | None, end: time | None) -> datetime:
    """Move a notification that falls inside quiet hours to the moment quiet hours end."""
    local = at.astimezone(tz)
    if not in_quiet(local.time(), start, end):
        return at
    end_day = local.date() if local.time() < end else local.date() + timedelta(days=1)
    return datetime.combine(end_day, end, tzinfo=tz)
