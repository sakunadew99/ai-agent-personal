from datetime import datetime, timezone

import pytest

from app.services import fsrs

NOW = datetime(2026, 11, 22, tzinfo=timezone.utc)


def run(grades):
    s = d = None
    out = []
    for g in grades:
        n = fsrs.review(s, d, out[-1] if out else 0, g, NOW)
        s, d = n.stability, n.difficulty
        out.append(n.interval_days)
    return out, d


def test_good_reviews_grow_and_easy_grows_faster_than_hard():
    good, _ = run(["good"] * 4)
    assert good == sorted(good) and good[0] == 4 and good[-1] > 100
    assert run(["easy"] * 3)[0][-1] > good[2] > run(["hard"] * 3)[0][-1]


def test_again_relearns_soon_and_raises_difficulty():
    out, d = run(["good", "good", "again"])
    assert out[-1] == 0 and d > run(["good", "good"])[1]
    n = fsrs.review(None, None, 0, "again", NOW)
    assert (n.due_at - NOW).total_seconds() == 600


def test_old_sm2_cards_carry_over_and_bad_grade_rejected():
    assert fsrs.from_sm2(2.5, 10, 3) == (10.0, 5.0) and fsrs.from_sm2(2.5, 0, 0) == (None, None)
    with pytest.raises(ValueError):
        fsrs.review(None, None, 0, "perfect", NOW)
