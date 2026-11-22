"""Body measurements: trends, change since start / last month, waist-to-height ratio and a US Navy body-fat estimate.

Plain maths, no AI. The Navy formula is an estimate (about ±3-4 %); waist-to-height ratio guidance (under 0.5 is the
usual healthy-range target for adults) comes from NICE / NHS. Not a diagnosis.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import BodyMeasurement

FIELDS = ("weight_kg", "waist_cm", "chest_cm", "hips_cm", "neck_cm", "arm_cm", "thigh_cm", "body_fat_pct")
LABELS = {"weight_kg": "Weight (kg)", "waist_cm": "Waist (cm)", "chest_cm": "Chest (cm)", "hips_cm": "Hips (cm)", "neck_cm": "Neck (cm)",
          "arm_cm": "Arm (cm)", "thigh_cm": "Thigh (cm)", "body_fat_pct": "Body fat (%)"}
HOW = {"waist_cm": "At the navel (belly button), relaxed, after breathing out.", "chest_cm": "Around the fullest part, under the armpits.",
       "hips_cm": "Around the widest part of the buttocks.", "neck_cm": "Just below the Adam's apple, tape sloping slightly down at the front.",
       "arm_cm": "Around the biggest part of the upper arm, relaxed.", "thigh_cm": "Around the thickest part, standing.",
       "weight_kg": "Same scale, morning, after the toilet, before eating."}


def navy_body_fat(sex: str | None, height_cm: float | None, waist: float | None, neck: float | None, hips: float | None) -> float | None:
    """US Navy circumference method (metric form)."""
    if not (height_cm and waist and neck) or sex not in ("male", "female"):
        return None
    try:
        if sex == "male":
            if waist <= neck:
                return None
            bf = 495 / (1.0324 - 0.19077 * math.log10(waist - neck) + 0.15456 * math.log10(height_cm)) - 450
        else:
            if not hips or waist + hips <= neck:
                return None
            bf = 495 / (1.29579 - 0.35004 * math.log10(waist + hips - neck) + 0.22100 * math.log10(height_cm)) - 450
    except ValueError:
        return None
    return round(bf, 1) if 2 <= bf <= 70 else None


def _f(v: Decimal | None) -> float | None:
    return float(v) if v is not None else None


def row_out(r: BodyMeasurement) -> dict:
    return {"id": r.id, "measured_on": r.measured_on, **{k: _f(getattr(r, k)) for k in FIELDS}, "note": r.note}


def overview(db: Session, user_id, today: date, height_cm: float | None = None, sex: str | None = None) -> dict:
    rows = db.scalars(select(BodyMeasurement).where(BodyMeasurement.user_id == user_id).order_by(BodyMeasurement.measured_on)).all()
    items = [row_out(r) for r in rows]
    changes = {}
    for k in FIELDS:
        vals = [(r["measured_on"], r[k]) for r in items if r[k] is not None]
        if not vals:
            continue
        latest = vals[-1][1]
        month = [v for d, v in vals if d <= today - timedelta(days=28)]
        changes[k] = {"label": LABELS[k], "latest": latest, "first": vals[0][1], "since_start": round(latest - vals[0][1], 1),
                      "since_month": round(latest - month[-1], 1) if month else None,
                      "series": [{"date": d, "value": v} for d, v in vals[-24:]]}
    last = items[-1] if items else None
    whtr = round(last["waist_cm"] / height_cm, 2) if last and last.get("waist_cm") and height_cm else None
    fat = None
    if last:
        fat = last.get("body_fat_pct") or navy_body_fat(sex, height_cm, last.get("waist_cm"), last.get("neck_cm"), last.get("hips_cm"))
    insights = []
    w, wa = changes.get("weight_kg"), changes.get("waist_cm")
    if wa and wa["since_start"] < 0 and (not w or abs(w["since_start"]) < 1):
        insights.append(f"Waist is down {abs(wa['since_start'])} cm while weight barely moved: likely losing fat and keeping muscle.")
    if w and wa and w["since_start"] > 0 and wa["since_start"] <= 0:
        insights.append("Weight is up but waist isn't: probably muscle gain (or water). Keep training.")
    if whtr is not None:
        insights.append(f"Waist-to-height ratio {whtr}: " + ("in the healthy range (under 0.5)." if whtr < 0.5 else
                        "above 0.5; reducing waist size lowers health risk." if whtr < 0.6 else "0.6 or more is linked to high health risk; talk to a doctor."))
    due = (today - last["measured_on"]).days >= 14 if last else True
    return {"items": list(reversed(items))[:60], "changes": changes, "waist_to_height": whtr, "body_fat_estimate": fat,
            "body_fat_method": "your entry" if last and last.get("body_fat_pct") else ("US Navy tape method (estimate ±3-4%)" if fat else None),
            "insights": insights, "due": due, "how_to_measure": HOW, "labels": LABELS,
            "missing_for_fat": None if fat or not last else "Add height and sex in your profile, plus waist and neck (and hips for women), for a body-fat estimate.",
            "note": "Measure every 2 weeks, same time and conditions. Estimates, not a diagnosis."}
