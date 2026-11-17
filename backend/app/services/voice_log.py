"""Understand spoken or typed logs for the gym and the day tracker. Plain rules, no AI.

  "bench 60 kg x 8"                       -> gym: Bench press 60 kg x 8 (one set)
  "squat 80kg 3x5", "3 sets of 10 pull ups" -> gym: several sets
  "gym 45 minutes", "did legs for an hour" -> gym: a workout with time only
  "wasted an hour on tiktok"               -> day tracker: 1 h 'wasted' ending now
  "studied german 2 hours", "worked from 9 to 12" -> day tracker entries
"""
from __future__ import annotations

import re
from datetime import datetime, time, timedelta

from app.services.gym import EXERCISES

ALIASES = {"bench": "Bench press", "bench press": "Bench press", "squat": "Squat", "squats": "Squat", "deadlift": "Deadlift", "deadlifts": "Deadlift",
           "pull up": "Pull-up", "pull ups": "Pull-up", "pullups": "Pull-up", "pull-up": "Pull-up", "chin ups": "Pull-up", "push up": "Push-up", "push ups": "Push-up",
           "pushups": "Push-up", "ohp": "Overhead press", "overhead press": "Overhead press", "shoulder press": "Dumbbell shoulder press", "curl": "Barbell curl",
           "curls": "Barbell curl", "bicep curl": "Dumbbell curl", "biceps curl": "Dumbbell curl", "row": "Barbell row", "rows": "Barbell row", "lat pulldown": "Lat pulldown",
           "leg press": "Leg press", "lunges": "Lunges", "plank": "Plank", "dips": "Dips", "lateral raise": "Lateral raise", "lateral raises": "Lateral raise",
           "triceps pushdown": "Triceps pushdown", "calf raise": "Calf raise", "hip thrust": "Hip thrust", "rdl": "Romanian deadlift"}
for _items in EXERCISES.values():
    for _name in _items:
        ALIASES.setdefault(_name.lower(), _name)
NAMES = sorted(ALIASES, key=len, reverse=True)
NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "half an": 0.5, "half a": 0.5}
TIME_WORDS = {
    "wasted": ["wasted", "scroll", "tiktok", "instagram", "facebook", "reels", "shorts", "doomscroll"],
    "study": ["studied", "study", "learned", "learning", "ielts", "german", "revision", "course", "lecture"],
    "work": ["worked", "work", "office", "meeting", "coding", "coded", "client"],
    "exercise": ["gym", "workout", "ran", "running", "walk", "walked", "exercise", "trained"],
    "entertainment": ["watched", "movie", "netflix", "series", "youtube", "gaming", "played games"],
    "family": ["family", "mum", "mom", "dad", "kids"], "commute": ["commute", "bus", "train", "traffic", "drove"],
    "chores": ["cleaned", "cooking", "cooked", "laundry", "shopping"], "rest": ["napped", "nap", "rested", "relaxed"],
}


def _duration(text: str) -> int | None:
    t = text.lower()
    m = re.search(r"(\d+(?:\.\d+)?|a|an|one|two|three|four|five|half an|half a)\s*(hours?|hrs?|h)\b(?:\s*(?:and)?\s*(\d+)\s*(?:minutes?|mins?|m)\b)?", t)
    if m:
        n = NUM.get(m.group(1)) if m.group(1) in NUM else float(m.group(1))
        return int(round(float(n) * 60)) + int(m.group(3) or 0)
    m = re.search(r"(\d+)\s*(?:minutes?|mins?|m)\b", t)
    return int(m.group(1)) if m else None


def parse_gym(text: str) -> dict | None:
    t = " " + re.sub(r"[×*]", "x", text.lower()) + " "
    sets = []
    for name in NAMES:
        for m in re.finditer(rf"(?<![a-z]){re.escape(name)}(?![a-z])", t):
            tail = re.split(r"\s(?:and|then)\s|[,;]", t[m.end():m.end() + 40])[0]
            head = t[max(0, m.start() - 25):m.start()]
            weight = re.search(r"(\d+(?:\.\d+)?)\s*(?:kg|kilos?)", tail)
            sx = re.search(r"(\d+)\s*x\s*(\d+)", tail)                       # 3x5 (sets x reps)
            single = re.search(r"(?:kg|kilos?)\s*(?:x|for)?\s*(\d+)(?:\s*reps?)?", tail)
            sets_of = re.search(r"(\d+)\s*sets?\s*of\s*(\d+)\s*$", head)      # "3 sets of 10 pull ups"
            reps_only = re.search(r"^\s*(?:x|for)?\s*(\d+)\s*reps?", tail)
            w = float(weight.group(1)) if weight else None
            if sets_of:
                n, reps = int(sets_of.group(1)), int(sets_of.group(2))
            elif sx and (not weight or sx.start() > weight.start()):
                n, reps = int(sx.group(1)), int(sx.group(2))
            elif single:
                n, reps = 1, int(single.group(1))
            elif reps_only:
                n, reps = 1, int(reps_only.group(1))
            else:
                continue
            if 0 < n <= 10 and 0 < reps <= 100:
                sets += [{"exercise": ALIASES[name], "weight_kg": w, "reps": reps}] * n
            t = t[:m.start()] + " " * (m.end() - m.start()) + t[m.end():]    # don't match the same words twice
            break
    minutes = _duration(text)
    if sets:
        return {"sets": sets, "minutes": minutes}
    if re.search(r"\b(gym|workout|trained|lifted|did (?:legs|chest|back|arms|shoulders))\b", text.lower()) and minutes:
        return {"sets": [], "minutes": minutes}
    return None


def parse_time_log(text: str, now: datetime) -> dict | None:
    t = text.lower()
    if not re.search(r"\b(wasted|spent|worked|studied|did|was|scroll|watched|learned|played|commute|cleaned|cooked|napped|rested|from)\b", t):
        return None
    cat = next((c for c, words in TIME_WORDS.items() if any(re.search(rf"\b{re.escape(w)}", t) for w in words)), None)
    if not cat:
        return None
    rng = re.search(r"from\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|till|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", t)
    if rng:
        def hh(h, ap):
            h = int(h)
            return h + 12 if ap == "pm" and h < 12 else (0 if ap == "am" and h == 12 else h)
        s = time(hh(rng.group(1), rng.group(3) or rng.group(6)) % 24, int(rng.group(2) or 0))
        e = time(hh(rng.group(4), rng.group(6)) % 24, int(rng.group(5) or 0))
        if not rng.group(3) and not rng.group(6) and e <= s and e.hour < 12:
            e = time(e.hour + 12, e.minute)
    else:
        minutes = _duration(t)
        if not minutes or minutes > 16 * 60:
            return None
        end = now.replace(second=0, microsecond=0)
        start = end - timedelta(minutes=minutes)
        if start.date() != end.date():
            start = end.replace(hour=0, minute=0)
        s, e = start.time(), end.time()
    if s == e:
        return None
    return {"category": {"study": "study", "work": "work", "exercise": "exercise"}.get(cat, cat), "start_time": s, "end_time": e, "note": text.strip()[:300]}
