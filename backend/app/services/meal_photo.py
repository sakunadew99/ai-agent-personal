"""Food photo -> what's on the plate (a suggestion you confirm). Uses your configured AI model (vision); the photo is not stored.

The answer only fills the meal form on your phone; nothing is logged until you press Save. The calorie and protein
numbers are rough guesses from a photo, shown as a hint only.
"""
from __future__ import annotations

import base64
import binascii
import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

MAX_BYTES = 4 * 1024 * 1024
MIMES = {"image/jpeg", "image/png", "image/webp"}


def estimate(db: Session, user_id, data_b64: str, mime: str) -> dict:
    from app.services.ai_client import ai_enabled, chat_complete, gate, model_for
    if mime not in MIMES:
        raise HTTPException(422, "Use a JPG, PNG or WebP photo.")
    try:
        raw = base64.b64decode(data_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "That photo couldn't be read.") from None
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "Photo is over 4 MB; pick a smaller one.")
    if not ai_enabled():
        raise HTTPException(503, "Food photos need the AI key on the server. You can still type what you ate.")
    blocked = gate(db, user_id, "meal_photo")
    if blocked:
        raise HTTPException(403, blocked)
    reply = chat_complete(db, user_id, "meal_photo", model_for("conversation"), [
        {"role": "system", "content": "You look at one photo of a meal (often Sri Lankan food). Reply with JSON only: "
                                      '{"foods": ["short food names"], "calories": int, "protein_g": int, "confidence": "low"|"medium"|"high", '
                                      '"note": "one short, kind tip"}. If it is not food, reply {"foods": []}. Never give medical advice.'},
        {"role": "user", "content": [
            {"type": "text", "text": "What is on this plate? Estimate roughly for one person."},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data_b64}", "detail": "low"}},
        ]},
    ], temperature=0)
    if not reply:
        raise HTTPException(502, "The AI couldn't read the photo just now. Try again, or type what you ate.")
    try:
        out = json.loads(reply.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip())
    except (ValueError, AttributeError):
        raise HTTPException(502, "The AI answer wasn't clear. Try another photo.") from None
    foods = [str(f).strip()[:60] for f in (out.get("foods") or []) if str(f).strip()][:12] if isinstance(out, dict) else []
    if not foods:
        return {"foods": [], "foods_text": "", "calories": None, "protein_g": None, "confidence": "low", "note": "I couldn't see food in that photo."}

    def num(k, hi):
        try:
            v = int(out.get(k))
            return v if 0 < v <= hi else None
        except (TypeError, ValueError):
            return None
    return {"foods": foods, "foods_text": ", ".join(foods)[:1000], "calories": num("calories", 4000), "protein_g": num("protein_g", 300),
            "confidence": out.get("confidence") if out.get("confidence") in ("low", "medium", "high") else "low",
            "note": str(out.get("note") or "")[:200], "stored_photo": False}
