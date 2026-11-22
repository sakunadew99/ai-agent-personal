"""Pelvic floor (Kegel) training: a guided, gradual programme, plain-code progress rules, and reliable reading.

General wellness information, not medical advice. Links were checked to be live official/clinical pages; the video
links are YouTube searches (no invented titles).
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import WellnessSession

LEVELS = {
    1: {"name": "Start", "hold_s": 3, "relax_s": 3, "reps": 10, "sets_per_day": 3, "quick_flicks": 0,
        "goal": "Find the right muscles and do slow squeezes without holding your breath."},
    2: {"name": "Build", "hold_s": 5, "relax_s": 5, "reps": 10, "sets_per_day": 3, "quick_flicks": 0,
        "goal": "Hold longer with full relaxation between squeezes."},
    3: {"name": "Strong", "hold_s": 8, "relax_s": 8, "reps": 10, "sets_per_day": 3, "quick_flicks": 10,
        "goal": "Add quick squeezes (1 second on, 1 off) for fast control."},
    4: {"name": "Maintain", "hold_s": 10, "relax_s": 10, "reps": 10, "sets_per_day": 3, "quick_flicks": 10,
        "goal": "Keep it up for life: a few minutes a day maintains strength."},
}
GUIDE = {
    "what": ("Kegel (pelvic floor) exercises are repeated squeezes and relaxations of the pelvic floor muscles, which support the "
             "bladder, bowel and reproductive organs. They can help bladder and bowel control and pelvic health for men and women."),
    "find": ["Imagine stopping yourself passing wind and stopping the flow of urine at the same time: that lift and squeeze is the pelvic floor.",
             "You can check once by slowing urine flow, but don't exercise while urinating: it can stop the bladder emptying properly.",
             "Your stomach, buttocks and thighs should stay relaxed; only the inside lifts."],
    "how": ["Empty your bladder first, then sit or lie comfortably.", "Squeeze and lift for the hold time, keep breathing normally.",
            "Relax fully for the same time (relaxing matters as much as squeezing).", "Repeat for the reps; do the sets spread across the day."],
    "mistakes": ["Holding your breath", "Squeezing buttocks, thighs or tummy instead", "Bearing down (pushing) instead of lifting",
                 "Not relaxing fully between squeezes", "Overdoing it: more is not better; tired muscles don't work well"],
    "safety": ["Stop if you feel pain and speak to a doctor or a pelvic health physiotherapist.",
               "Ask a professional first after pelvic, prostate or abdominal surgery, during pregnancy or after giving birth, or if you have pelvic pain.",
               "See a doctor for leaking urine, a feeling of heaviness, or any bladder/bowel change; exercises help many people but aren't a diagnosis.",
               "Results usually take a few weeks to a few months of regular practice."],
    "frequency": "3 sets a day, most days. Progress only when the current level feels easy.",
}
RESOURCES = [
    {"kind": "Educational post", "label": "NHS: What are pelvic floor exercises?", "url": "https://www.nhs.uk/common-health-questions/womens-health/what-are-pelvic-floor-exercises/"},
    {"kind": "Educational post", "label": "MedlinePlus (US National Library of Medicine): Kegel exercises, self-care", "url": "https://medlineplus.gov/ency/patientinstructions/000141.htm"},
    {"kind": "Educational post", "label": "Cleveland Clinic: Kegel exercises", "url": "https://my.clevelandclinic.org/health/articles/14611-kegel-exercises"},
    {"kind": "Free app", "label": "Squeezy: the NHS pelvic floor app", "url": "https://www.squeezyapp.com/"},
    {"kind": "Video (search)", "label": "YouTube: guided pelvic floor exercises by physiotherapists", "url": "https://www.youtube.com/results?search_query=pelvic+floor+exercises+physiotherapist+guided"},
    {"kind": "Video (search)", "label": "YouTube: Kegel exercises for men, guided", "url": "https://www.youtube.com/results?search_query=kegel+exercises+for+men+guided+physiotherapist"},
    {"kind": "Video (search)", "label": "YouTube: Kegel exercises for women, guided", "url": "https://www.youtube.com/results?search_query=kegel+exercises+for+women+guided+physiotherapist"},
]


def _streak(days: set[date], today: date) -> int:
    d = today if today in days else today - timedelta(days=1)
    n = 0
    while d in days:
        n += 1
        d -= timedelta(days=1)
    return n


def overview(db: Session, user_id, today: date) -> dict:
    rows = db.scalars(select(WellnessSession).where(WellnessSession.user_id == user_id, WellnessSession.kind == "kegel",
                                                   WellnessSession.local_date >= today - timedelta(days=60)).order_by(WellnessSession.created_at.desc())).all()
    level = rows[0].level if rows else 1
    cfg = LEVELS[level]
    sets_today = sum(r.sets for r in rows if r.local_date == today)
    week = [{"date": today - timedelta(days=k), "sets": sum(r.sets for r in rows if r.local_date == today - timedelta(days=k))} for k in range(6, -1, -1)]
    # level up when, in the last 7 days at this level, you did at least 2 sets on 5 or more days
    good_days = sum(1 for k in range(7) if sum(r.sets for r in rows if r.local_date == today - timedelta(days=k) and r.level == level) >= 2)
    return {"level": level, "levels": LEVELS, "today": {"sets": sets_today, "target": cfg["sets_per_day"], "done": sets_today >= cfg["sets_per_day"]},
            "week": [{"date": w["date"], "label": w["date"].strftime("%a")[:2], "sets": w["sets"]} for w in week],
            "streak": _streak({r.local_date for r in rows}, today), "ready_for_next": level < 4 and good_days >= 5, "good_days_7": good_days,
            "guide": GUIDE, "resources": RESOURCES,
            "disclaimer": "General wellness information, not medical advice. Stop if it hurts and see a doctor or pelvic health physiotherapist."}
