"""FSRS-4.5 spaced repetition (free, open algorithm by Jarrett Ye / open-spaced-repetition). Plain maths, no AI.

Each card keeps stability S (days until recall drops to 90%) and difficulty D (1-10). Reviews are scheduled for when
you would just reach 90% recall, so you study less and forget less than with fixed SM-2 steps.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755]
DECAY, FACTOR = -0.5, 19 / 81
RETENTION = 0.9
MAX_DAYS = 365 * 3
G = {"again": 1, "hard": 2, "good": 3, "easy": 4}


@dataclass(frozen=True)
class Next:
    stability: float
    difficulty: float
    interval_days: int
    due_at: datetime
    retrievability: float | None


def _clamp_d(d: float) -> float:
    return min(10.0, max(1.0, d))


def init_difficulty(g: int) -> float:
    return _clamp_d(W[4] - (g - 3) * W[5])


def retrievability(elapsed_days: float, stability: float) -> float:
    return (1 + FACTOR * max(0.0, elapsed_days) / max(0.01, stability)) ** DECAY


def interval_for(stability: float) -> int:
    days = stability / FACTOR * (RETENTION ** (1 / DECAY) - 1)
    return int(min(MAX_DAYS, max(1, round(days))))


def from_sm2(ease: float, interval_days: int, repetitions: int) -> tuple[float | None, float | None]:
    """Start values for a card reviewed before FSRS: its old interval as stability, its ease mapped to difficulty."""
    if repetitions <= 0:
        return None, None
    return float(max(1, interval_days)), _clamp_d(11 - (ease - 1.3) * 5)


def review(stability: float | None, difficulty: float | None, elapsed_days: float, grade: str, now: datetime) -> Next:
    if grade not in G:
        raise ValueError("grade must be again, hard, good or easy")
    g = G[grade]
    if stability is None or difficulty is None:                       # first time this card is seen
        s, d = W[g - 1], init_difficulty(g)
        if g == 1:
            return Next(s, d, 0, now + timedelta(minutes=10), None)
        days = interval_for(s)
        return Next(s, d, days, now + timedelta(days=days), None)
    r = retrievability(elapsed_days, stability)
    d = _clamp_d(W[7] * init_difficulty(4) + (1 - W[7]) * (difficulty - W[6] * (g - 3)))
    if g == 1:
        s = W[11] * difficulty ** (-W[12]) * ((stability + 1) ** W[13] - 1) * math.exp(W[14] * (1 - r))
        s = min(s, stability)                                          # forgetting never raises stability
        return Next(s, d, 0, now + timedelta(minutes=10), r)
    bonus = W[15] if g == 2 else W[16] if g == 4 else 1.0
    s = stability * (math.exp(W[8]) * (11 - difficulty) * stability ** (-W[9]) * (math.exp(W[10] * (1 - r)) - 1) * bonus + 1)
    days = interval_for(s)
    return Next(s, d, days, now + timedelta(days=days), r)
