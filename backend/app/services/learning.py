"""Phase 4: flashcards with spaced repetition (SM-2), the mistake notebook and job-tracker rules. Plain code, no AI."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import Flashcard, FlashcardReview, JobApplication, Mistake, UserProfile
from app.services.audit import audit

GRADES = ("again", "hard", "good", "easy")
MIN_EASE, MAX_INTERVAL = 1.3, 730
RELEARN_MINUTES = 10
JOB_OPEN = ("draft", "applied", "interview", "offer")


# ---------- SM-2 scheduling ----------

@dataclass(frozen=True)
class Schedule:
    ease: float
    interval_days: int
    repetitions: int
    lapses: int
    due_at: datetime


def schedule(ease: float, interval_days: int, repetitions: int, lapses: int, grade: str, now: datetime) -> Schedule:
    """Next review for a card. 'again' relearns in 10 minutes; others grow the interval (SM-2, Anki-style hard/easy)."""
    if grade not in GRADES:
        raise ValueError("grade must be again, hard, good or easy")
    if grade == "again":
        return Schedule(max(MIN_EASE, round(ease - 0.2, 2)), 0, 0, lapses + 1, now + timedelta(minutes=RELEARN_MINUTES))
    q = {"hard": 3, "good": 4, "easy": 5}[grade]
    new_ease = max(MIN_EASE, round(ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), 2))
    if repetitions == 0:
        interval = {"hard": 1, "good": 1, "easy": 4}[grade]
    elif repetitions == 1:
        interval = {"hard": 3, "good": 6, "easy": 8}[grade]
    else:
        factor = {"hard": 1.2, "good": new_ease, "easy": new_ease * 1.3}[grade]
        interval = max(interval_days + 1, round(interval_days * factor))
    interval = min(interval, MAX_INTERVAL)
    return Schedule(new_ease, interval, repetitions + 1, lapses, now + timedelta(days=interval))


def _tz(db: Session, user_id):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(profile.timezone if profile else None)


def _local_day_bounds(tz, day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)
    return start, start + timedelta(days=1)


def clean_deck(name: str) -> str:
    deck = " ".join(name.strip().lower().split())[:64]
    if not deck:
        raise HTTPException(422, "Deck name is required")
    return deck


# ---------- cards ----------

def create_card(db: Session, user_id, deck: str, front: str, back: str, example: str | None = None) -> Flashcard:
    deck, front, back = clean_deck(deck), front.strip(), back.strip()
    if not front or not back:
        raise HTTPException(422, "Both sides of the card are needed")
    exists = db.scalar(select(Flashcard).where(Flashcard.user_id == user_id, Flashcard.deck == deck, Flashcard.front == front))
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"“{front}” is already in the {deck} deck")
    row = Flashcard(user_id=user_id, deck=deck, front=front, back=back, example=(example or "").strip() or None, due_at=now_utc())
    db.add(row)
    db.flush()
    audit(db, user_id, "flashcard.create", "flashcard", row.id, {"deck": deck})
    return row


def parse_import(text: str, limit: int = 500) -> list[tuple[str, str, str | None]]:
    """Lines like 'der Hund ; the dog ; Der Hund bellt.' (also tab or ' - ' separated). Untrusted text: data only."""
    cards: list[tuple[str, str, str | None]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        for sep in (";", "\t", " - ", " = "):
            if sep in line:
                parts = [p.strip() for p in line.split(sep)]
                break
        else:
            continue
        if len(parts) >= 2 and parts[0] and parts[1]:
            cards.append((parts[0][:500], parts[1][:1000], (parts[2][:1000] if len(parts) > 2 and parts[2] else None)))
        if len(cards) >= limit:
            break
    return cards


def import_cards(db: Session, user_id, deck: str, text: str) -> dict:
    deck = clean_deck(deck)
    parsed = parse_import(text)
    existing = set(db.scalars(select(Flashcard.front).where(Flashcard.user_id == user_id, Flashcard.deck == deck)).all())
    added = skipped = 0
    now = now_utc()
    for front, back, example in parsed:
        if front in existing:
            skipped += 1
            continue
        existing.add(front)
        db.add(Flashcard(user_id=user_id, deck=deck, front=front, back=back, example=example, due_at=now))
        added += 1
    db.flush()
    audit(db, user_id, "flashcard.import", "flashcard", None, {"deck": deck, "added": added, "skipped": skipped})
    return {"deck": deck, "added": added, "skipped_duplicates": skipped, "lines_read": len(parsed)}


def due_cards(db: Session, user_id, deck: str | None, limit: int) -> list[Flashcard]:
    statement = select(Flashcard).where(Flashcard.user_id == user_id, Flashcard.suspended.is_(False), Flashcard.due_at <= now_utc())
    if deck:
        statement = statement.where(Flashcard.deck == clean_deck(deck))
    return list(db.scalars(statement.order_by(Flashcard.due_at).limit(limit)).all())


def review_card(db: Session, row: Flashcard, grade: str) -> Flashcard:
    """FSRS scheduling (free spaced-repetition algorithm): the card comes back just before you'd forget it."""
    from app.services import fsrs
    now = now_utc()
    s, d = row.stability, row.difficulty
    if s is None and row.repetitions:                       # reviewed before FSRS: start from its SM-2 history
        s, d = fsrs.from_sm2(row.ease, row.interval_days, row.repetitions)
    elapsed = (now - as_utc(row.last_reviewed_at)).total_seconds() / 86400 if row.last_reviewed_at else 0.0
    try:
        nxt = fsrs.review(s, d, elapsed, grade, now)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    row.stability, row.difficulty = round(nxt.stability, 4), round(nxt.difficulty, 4)
    row.interval_days, row.due_at = nxt.interval_days, nxt.due_at
    row.repetitions = 0 if grade == "again" else row.repetitions + 1
    if grade == "again":
        row.lapses += 1
    row.last_reviewed_at = row.updated_at = now
    db.add(FlashcardReview(user_id=row.user_id, card_id=row.id, grade=grade, interval_days=nxt.interval_days, reviewed_at=now))
    return row


def learning_stats(db: Session, user_id) -> dict:
    tz = _tz(db, user_id)
    today = datetime.now(tz).date()
    _start, end_today = _local_day_bounds(tz, today)
    now = now_utc()
    decks = []
    rows = db.execute(select(Flashcard.deck, func.count(), func.sum(case((Flashcard.due_at <= now, 1), else_=0)),
                             func.sum(case((Flashcard.repetitions >= 3, 1), else_=0)))
                      .where(Flashcard.user_id == user_id, Flashcard.suspended.is_(False)).group_by(Flashcard.deck).order_by(Flashcard.deck)).all()
    for deck, total, due, learned in rows:
        decks.append({"deck": deck, "total": int(total or 0), "due_now": int(due or 0), "learned": int(learned or 0)})
    due_today = db.scalar(select(func.count()).select_from(Flashcard).where(
        Flashcard.user_id == user_id, Flashcard.suspended.is_(False), Flashcard.due_at < end_today)) or 0
    # Streak: consecutive local days (ending today or yesterday) with at least one review. Reads at most ~400 days.
    since = now - timedelta(days=400)
    times = db.scalars(select(FlashcardReview.reviewed_at).where(FlashcardReview.user_id == user_id, FlashcardReview.reviewed_at >= since)).all()
    days = {as_utc(t).astimezone(tz).date() for t in times}
    reviewed_today = sum(1 for t in times if as_utc(t).astimezone(tz).date() == today)
    streak, cursor = 0, today if today in days else today - timedelta(days=1)
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return {"decks": decks, "due_today": int(due_today), "reviewed_today": reviewed_today, "streak_days": streak}


# ---------- mistakes ----------

def mistake_again(db: Session, row: Mistake) -> Mistake:
    row.occurrences += 1
    row.last_seen_at = row.updated_at = now_utc()
    row.resolved_at = None
    if row.card_id is not None:  # bring its card back for review today
        card = db.get(Flashcard, row.card_id)
        if card is not None and card.user_id == row.user_id:
            card.due_at = now_utc()
            card.suspended = False
    audit(db, row.user_id, "mistake.again", "mistake", row.id)
    return row


def mistake_to_card(db: Session, row: Mistake, deck: str | None) -> Flashcard:
    if row.card_id is not None and (card := db.get(Flashcard, row.card_id)) is not None and card.user_id == row.user_id:
        return card
    card = create_card(db, row.user_id, deck or row.subject, row.what_happened, row.correction, row.lesson)
    row.card_id = card.id
    row.updated_at = now_utc()
    return card


# ---------- jobs ----------

def job_summary(db: Session, user_id) -> dict:
    tz = _tz(db, user_id)
    today = datetime.now(tz).date()
    rows = db.scalars(select(JobApplication).where(JobApplication.user_id == user_id)).all()
    by_stage: dict[str, int] = {}
    for row in rows:
        by_stage[row.status] = by_stage.get(row.status, 0) + 1
    follow_ups = sorted((r for r in rows if r.status in JOB_OPEN and r.follow_up_on and r.follow_up_on <= today),
                        key=lambda r: r.follow_up_on)
    applied = sum(by_stage.get(s, 0) for s in ("applied", "interview", "offer", "accepted", "rejected"))
    interviews = sum(by_stage.get(s, 0) for s in ("interview", "offer", "accepted"))
    return {
        "by_stage": by_stage, "total": len(rows), "open": sum(by_stage.get(s, 0) for s in JOB_OPEN),
        "interview_rate_percent": round(interviews / applied * 100) if applied else None,
        "follow_ups_due": [{"id": str(r.id), "company": r.company, "role": r.role, "follow_up_on": r.follow_up_on.isoformat(),
                            "next_step": r.next_step} for r in follow_ups],
    }

