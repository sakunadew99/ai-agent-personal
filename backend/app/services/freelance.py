"""Freelancing helper: proposal drafts and price estimates. Plain code, no AI, no automation.

You copy a draft and send it yourself; nothing is ever sent, submitted or accepted for you (no Fiverr/Upwork automation).
Prices are estimates from your own hours and rate, plus the platform's fee and a safety buffer.
"""
from __future__ import annotations

import math
import re
from decimal import ROUND_HALF_UP, Decimal

PLATFORM_FEE = {"fiverr": Decimal("0.20"), "upwork": Decimal("0.10"), "direct": Decimal("0")}   # seller-side fee you lose
LEVEL_RATE_USD = {"beginner": (8, 15), "intermediate": (15, 35), "expert": (35, 80)}               # typical hourly ranges, guidance only
COMPLEXITY = {"simple": Decimal("1.0"), "standard": Decimal("1.25"), "complex": Decimal("1.6")}


def _money(x: Decimal) -> Decimal:
    return x.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def estimate(hours: float, rate_usd: float | None, level: str, platform: str, complexity: str, revisions: int, usd_lkr: float, buffer_pct: int = 15) -> dict:
    lo, hi = LEVEL_RATE_USD[level]
    rate = Decimal(str(rate_usd)) if rate_usd else Decimal(str((lo + hi) / 2))
    h = Decimal(str(hours)) * COMPLEXITY[complexity] + Decimal(revisions) * Decimal("0.75")
    h = h * (1 + Decimal(buffer_pct) / 100)
    take_home = h * rate
    fee = PLATFORM_FEE[platform]
    price = take_home / (1 - fee) if fee < 1 else take_home
    days = math.ceil(float(h) / 4)                     # about 4 focused hours a day next to a job
    tiers = {name: _money(price * Decimal(m)) for name, m in (("basic", "0.6"), ("standard", "1"), ("premium", "1.6"))}
    return {"hours": float(round(h, 1)), "rate_usd": float(rate), "rate_range_usd": {"min": lo, "max": hi}, "platform": platform,
            "platform_fee_pct": int(fee * 100), "price_usd": _money(price), "you_receive_usd": _money(take_home),
            "price_lkr": _money(price * Decimal(str(usd_lkr))), "you_receive_lkr": _money(take_home * Decimal(str(usd_lkr))), "usd_lkr": usd_lkr,
            "delivery_days": max(1, days), "packages_usd": tiers,
            "explain": [f"{hours} h of work × {COMPLEXITY[complexity]} for {complexity} work, + {revisions} revision(s) × 0.75 h, + {buffer_pct}% buffer = {round(h, 1)} h",
                        f"{round(h, 1)} h × ${rate}/h = ${_money(take_home)} you keep",
                        f"{platform.capitalize()} keeps {int(fee * 100)}%, so the client price is ${_money(price)}" if fee else "No platform fee for direct clients"],
            "note": "Estimate only. Check what similar sellers charge, and start lower while you have no reviews."}


def _keywords(text: str) -> list[str]:
    stop = set("the a an and or to of for in on with i we you our your is are be will need looking someone who can this that it my me".split())
    words = re.findall(r"[a-zA-Z][a-zA-Z+#.]{2,}", text.lower())
    seen: dict[str, int] = {}
    for w in words:
        if w not in stop:
            seen[w] = seen.get(w, 0) + 1
    return [w for w, _ in sorted(seen.items(), key=lambda kv: -kv[1])][:8]


def proposal(job: str, skills: list[str], name: str, experience: str | None, days: int | None, price_usd: float | None, tone: str = "friendly") -> dict:
    kw = _keywords(job)
    matched = [s for s in skills if any(s.lower() in k or k in s.lower() for k in kw)] or skills[:3]
    first_line = job.strip().split("\n")[0][:120]
    hello = "Hi there," if tone == "friendly" else "Hello,"
    lines = [hello, "",
             f"I read your request about “{first_line}”. I can help with this using {', '.join(matched[:4]) if matched else 'the skills you listed'}.",
             ""]
    if experience:
        lines += [f"Relevant experience: {experience.strip()}", ""]
    lines += ["How I'd do it:",
              "1. Confirm the exact goal, inputs and what “done” looks like.",
              f"2. Deliver a first version{f' within {days} days' if days else ''} for your feedback.",
              "3. Revise and hand over the final files with short notes.", ""]
    if price_usd:
        lines += [f"Price: ${price_usd:,.0f} for the scope above.", ""]
    lines += ["A quick question so I get it right: what is the most important result for you?", "", "Thanks,", name or "—"]
    text = "\n".join(lines)
    checklist = ["Mention one detail from their request so it doesn't look copy-pasted.", "Attach or link one relevant sample.",
                 "Keep it under 150 words if the platform shows only a preview.", "Don't share contact details or ask to move off-platform (against platform rules).",
                 "Review and send it yourself; Sakuna never sends anything."]
    return {"text": text, "words": len(text.split()), "keywords": kw, "matched_skills": matched, "checklist": checklist}
