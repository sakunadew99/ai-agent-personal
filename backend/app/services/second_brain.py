"""Second brain (Phase 2): memory types, duplicate detection and gentle resurfacing.

Everything here is plain code (no LLM), so it is cheap, testable and cannot be talked into things.
An interest or intention is NEVER turned into a task silently: "Plan it" creates a proposal that
goes through the normal approval flow (queue_or_run).
"""
import re
from datetime import datetime, timedelta
from difflib import SequenceMatcher

from sqlalchemy import select

from app.core.clock import now_utc
from app.core.config import settings
from app.models.entities import Memory

INTENT_TYPES = ("fact", "preference", "interest", "intention", "commitment")
RESURFACE_TYPES = ("interest", "intention")
BACKOFF_DAYS = (7, 14, 30)          # wait between prompts for the same item
ASK_KEEP_AFTER = 3                  # after this many "Later"s, ask once: keep or drop?
MAX_PROMPTS = 2                     # at most this many prompts at a time

# Order matters: the first matching rule wins.
_RULES: list[tuple[str, re.Pattern]] = [
    ("commitment", re.compile(r"\b(i will|i'll|i must|i have to|i need to|i promised|i committed|i've committed|deadline)\b", re.I)),
    ("preference", re.compile(r"\b(i prefer|i'd rather|i would rather|i hate|i dislike|i don't like|i do not like|my favou?rite)\b", re.I)),
    ("intention", re.compile(r"\b(i want to|i'd like to|i would like to|i plan to|i'm planning to|i am planning to|i hope to|i'm going to try|i should try|someday|one day i)\b", re.I)),
    ("interest", re.compile(r"\b(i like|i love|i enjoy|i'm interested in|i am interested in|interested in|i'm into|i am into|i'm curious about)\b", re.I)),
]
_TIME_TAIL = re.compile(r"\s+(next|this|in a|someday|one day|soon|tomorrow|later)\b.*$", re.I)
_LEAD = re.compile(r"^(try|start|do|learn|get into|take up|go to|practi[cs]e)\s+", re.I)


def classify(text: str) -> tuple[str, str | None]:
    """Return (intent_type, topic). 'I want to try yoga next month' -> ('intention', 'yoga')."""
    for intent, pattern in _RULES:
        match = pattern.search(text)
        if match:
            rest = text[match.end():].strip()
            rest = re.split(r"[.,;!?\n]| because | but | and then ", rest, maxsplit=1)[0]
            rest = _TIME_TAIL.sub("", rest).strip()
            rest = _LEAD.sub("", rest).strip()
            topic = " ".join(rest.split()[:6]).strip(" '\"") or None
            return intent, topic
    return "fact", None


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text.lower())).strip()


def find_duplicate(db, user_id, content: str, threshold: float = 0.88) -> Memory | None:
    """A near-identical active memory, if any (normalized text similarity)."""
    target = _normalized(content)
    if not target:
        return None
    rows = db.scalars(
        select(Memory).where(Memory.user_id == user_id, Memory.deleted_at.is_(None)).order_by(Memory.updated_at.desc()).limit(300)
    ).all()
    for row in rows:
        candidate = _normalized(row.content)
        if candidate == target or SequenceMatcher(None, candidate, target).ratio() >= threshold:
            return row
    return None


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        from datetime import timezone
        return value.replace(tzinfo=timezone.utc)
    return value


def is_due(row: Memory, now: datetime | None = None) -> bool:
    """Should this memory be resurfaced now?"""
    now = now or now_utc()
    if row.intent_type not in RESURFACE_TYPES or row.deleted_at or row.dismissed_at or row.planned_at:
        return False
    if (_aware(row.created_at) or now) > now - timedelta(days=settings.resurface_min_age_days):
        return False
    snooze = _aware(row.snooze_until)
    return snooze is None or snooze <= now


def resurface_candidates(db, user_id, now: datetime | None = None, limit: int = MAX_PROMPTS) -> list[Memory]:
    now = now or now_utc()
    rows = db.scalars(
        select(Memory).where(
            Memory.user_id == user_id, Memory.deleted_at.is_(None), Memory.dismissed_at.is_(None),
            Memory.planned_at.is_(None), Memory.intent_type.in_(RESURFACE_TYPES),
        ).order_by(Memory.created_at.asc()).limit(200)
    ).all()
    due = [row for row in rows if is_due(row, now)]
    # Oldest, least-prompted first.
    due.sort(key=lambda r: (r.surface_count, _aware(r.created_at)))
    return due[:limit]


def snooze(row: Memory, now: datetime | None = None) -> None:
    now = now or now_utc()
    days = BACKOFF_DAYS[min(row.surface_count, len(BACKOFF_DAYS) - 1)]
    row.surface_count += 1
    row.last_surfaced_at = now
    row.snooze_until = now + timedelta(days=days)
    row.updated_at = now


def keep(row: Memory, now: datetime | None = None) -> None:
    """User said 'keep' after ignoring it a few times: start the back-off again, a month from now."""
    now = now or now_utc()
    row.surface_count = 0
    row.last_surfaced_at = now
    row.snooze_until = now + timedelta(days=BACKOFF_DAYS[-1])
    row.updated_at = now


def dismiss(row: Memory, now: datetime | None = None) -> None:
    now = now or now_utc()
    row.dismissed_at = now
    row.updated_at = now


def first_step_title(row: Memory) -> str:
    topic = row.topic or row.content.strip()[:60]
    return f"First small step: {topic}"[:200]
