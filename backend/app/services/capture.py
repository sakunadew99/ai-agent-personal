import re
from datetime import date, timedelta

SENSITIVE = re.compile(
    r"\b(password|passcode|api[_ ]?key|secret|private key|otp|seed phrase|cvv|card number)\b",
    re.IGNORECASE,
)
CARD_LIKE = re.compile(r"(?:\d[ -]?){13,19}")
DURATION = re.compile(r"(\d+)\s*(hours|hour|hrs|hr|minutes|minute|mins|min)\b", re.IGNORECASE)
CLOCK = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", re.IGNORECASE)
ISO_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
SUBJECT = re.compile(r"(?:study|learn|practice)\s+([A-Za-z][A-Za-z \-]{1,40})", re.IGNORECASE)
AMOUNT = re.compile(r"(\d+(?:\.\d{1,2})?)")
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
EXPENSE_WORDS = ("spent", "paid", "expense", "bought")
CATEGORIES = {
    "food": ("food", "lunch", "dinner", "breakfast", "grocery", "groceries"),
    "transport": ("transport", "uber", "bus", "taxi", "fuel"),
    "housing": ("rent", "housing", "mortgage"),
    "subscriptions": ("subscription", "netflix", "spotify"),
    "shopping": ("shopping", "clothes"),
    "health": ("pharmacy", "medicine", "doctor"),
    "education": ("course", "tuition", "book"),
    "business": ("business", "client", "invoice"),
}


def sensitivity_of(text: str) -> str:
    if SENSITIVE.search(text) or CARD_LIKE.search(text):
        return "sensitive"
    return "normal"


def _duration(text: str) -> int | None:
    match = DURATION.search(text)
    if not match:
        return None
    value = int(match.group(1))
    unit = match.group(2).lower()
    return value * 60 if unit.startswith("h") else value


def _clock(text: str) -> str | None:
    match = CLOCK.search(text)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridian = match.group(3).lower()
    if meridian == "pm" and hour < 12:
        hour += 12
    if meridian == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def _day(text: str, today: date) -> date | None:
    if "tomorrow" in text:
        return today + timedelta(days=1)
    if "today" in text:
        return today
    match = ISO_DATE.search(text)
    if match:
        return date.fromisoformat(match.group(1))
    for index, name in enumerate(WEEKDAYS):
        if name in text:
            ahead = (index - today.weekday()) % 7
            return today + timedelta(days=ahead or 7)
    return None


def _category(text: str) -> str:
    for category, words in CATEGORIES.items():
        if any(word in text for word in words):
            return category
    return "other"


def parse_capture(text: str, today: date) -> dict:
    raw = text.strip()
    lowered = raw.lower()
    when = _day(lowered, today)
    duration = _duration(lowered)
    clock = _clock(lowered)

    if any(word in lowered for word in EXPENSE_WORDS):
        amount_match = AMOUNT.search(lowered)
        amount = amount_match.group(1) if amount_match else None
        return {
            "classified_type": "expense",
            "ambiguous": amount is None,
            "title": "Expense",
            "category": _category(lowered),
            "amount": amount,
            "currency": "lkr" if "lkr" in lowered else "usd" if "usd" in lowered or "$" in lowered else None,
            "date": when.isoformat() if when else today.isoformat(),
            "suggested_time": clock or "12:00",
            "duration_minutes": None,
            "subject": None,
        }

    subject = None
    subject_match = SUBJECT.search(raw)
    if subject_match:
        subject = re.split(r"\bfor\b", subject_match.group(1), flags=re.IGNORECASE)[0].strip(" .")

    if any(word in lowered for word in ("study", "learn", "practice", "read")):
        kind = "learning_task"
        category = "learning"
        title = f"Study {subject}" if subject else "Study"
    elif any(word in lowered for word in ("gym", "workout", "run")):
        kind = "health_task"
        category = "health"
        title = "Workout" if "gym" not in lowered else "Gym"
    elif lowered.startswith("idea") or "note:" in lowered:
        kind = "note"
        category = "personal"
        title = raw[:80]
    else:
        kind = "task"
        category = "personal"
        title = raw[:120]

    ambiguous = when is None and kind != "note"
    if kind == "note":
        ambiguous = False
    return {
        "classified_type": kind,
        "ambiguous": ambiguous,
        "title": title,
        "category": category,
        "amount": None,
        "currency": None,
        "date": when.isoformat() if when else None,
        "suggested_time": clock or ("11:00" if category == "learning" else "09:00"),
        "duration_minutes": duration or (30 if kind != "note" else None),
        "subject": subject,
    }
