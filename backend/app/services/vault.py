"""Document vault: which documents you have, where they are, when they expire, and what your plans still need.

- No files are uploaded or stored (free hosting is not a safe file store). You note where the copy lives.
- A document number is optional and encrypted with TOKEN_ENCRYPTION_KEY (outside the database); only the last 3
  characters are kept in clear so you can recognise it. Revealing it is audit-logged.
- Renew reminders are counted back from the expiry date (e.g. passports 9 months, since many countries require
  6 months of validity on arrival: check the rule for your destination).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_utc, zone
from app.models.entities import StudyProgram, Task, UserProfile, VaultDocument
from app.services.audit import audit

LEAD_DAYS = {"passport": 270, "visa": 60, "national_id": 90, "driving_license": 30, "insurance": 30, "warranty": 14,
             "certificate": 0, "transcript": 0, "language_test": 60, "other": 30}
KIND_LABEL = {"passport": "Passport", "visa": "Visa / residence permit", "national_id": "National ID", "driving_license": "Driving licence",
              "insurance": "Insurance", "warranty": "Warranty", "certificate": "Certificate", "transcript": "Transcript",
              "language_test": "Language test result", "other": "Other"}


def _tz(db: Session, user_id):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return zone(profile.timezone if profile else None)


def _crypto():
    from app.services import google_oauth
    if not google_oauth.settings.token_encryption_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Document numbers need TOKEN_ENCRYPTION_KEY on the server. Save the document without the number.")
    return google_oauth


def set_number(row: VaultDocument, number: str | None) -> None:
    if number is None:
        return
    number = number.strip()
    if not number:
        row.number_enc, row.number_hint = None, None
        return
    row.number_enc = _crypto().encrypt(number)
    row.number_hint = number[-3:]


def reveal(db: Session, row: VaultDocument) -> str:
    if not row.number_enc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No number saved for this document")
    crypto = _crypto()
    try:
        value = crypto.decrypt(row.number_enc)
    except crypto.Expired as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "The number can't be decrypted with the current key (it was changed). Re-enter it.") from exc
    audit(db, row.user_id, "vault.reveal", "vault_document", row.id)
    return value


def status_of(row: VaultDocument, today: date) -> tuple[str, int | None]:
    if row.expires_on is None:
        return "no_expiry", None
    days = (row.expires_on - today).days
    if days < 0:
        return "expired", days
    if days <= row.renew_lead_days:
        return "renew_now", days
    return "valid", days


def out(row: VaultDocument, today: date) -> dict:
    state, days = status_of(row, today)
    return {"id": row.id, "name": row.name, "kind": row.kind, "kind_label": KIND_LABEL.get(row.kind, row.kind),
            "has_number": bool(row.number_enc), "number_hint": f"•••{row.number_hint}" if row.number_hint else None,
            "issued_on": row.issued_on, "expires_on": row.expires_on, "renew_lead_days": row.renew_lead_days,
            "renew_from": (row.expires_on - timedelta(days=row.renew_lead_days)) if row.expires_on else None,
            "status": state, "days_left": days, "location_note": row.location_note, "notes": row.notes,
            "reminder_task_id": row.reminder_task_id, "updated_at": row.updated_at}


def add_reminder(db: Session, row: VaultDocument) -> Task:
    if row.expires_on is None:
        raise HTTPException(422, "This document has no expiry date.")
    if row.reminder_task_id:
        task = db.get(Task, row.reminder_task_id)
        if task is not None and task.status != "done":
            return task
    tz = _tz(db, row.user_id)
    today = datetime.now(tz).date()
    when = max(today, row.expires_on - timedelta(days=row.renew_lead_days))
    from app.schemas.dto import TaskIn
    from app.services.actions import create_task
    task = create_task(db, row.user_id, TaskIn(title=f"Renew {row.name} (expires {row.expires_on:%d %b %Y})"[:200], category="personal", priority="high",
                                               due_at=datetime.combine(when, time(9), tzinfo=tz), duration_minutes=60,
                                               notes="From your document vault. Check the official renewal steps and processing times."))
    row.reminder_task_id = task.id
    row.updated_at = now_utc()
    audit(db, row.user_id, "vault.reminder", "vault_document", row.id)
    return task


def needed_for_plans(db: Session, user_id, docs: list[VaultDocument], today: date) -> list[dict]:
    """What your active study plans need, and whether the vault has a usable one."""
    programs = db.scalars(select(StudyProgram).where(StudyProgram.user_id == user_id, StudyProgram.stage.in_(
        ("shortlist", "requirements", "prepare", "apply", "offer", "visa", "move")))).all()
    if not programs:
        return []
    have = {}
    for d in docs:
        state, _ = status_of(d, today)
        if state != "expired":
            have[d.kind] = d
    needs = [("passport", "every application and the visa"), ("transcript", "applications (certified copies)")]
    if any(p.language_test for p in programs):
        needs.append(("language_test", ", ".join(sorted({p.language_test for p in programs if p.language_test}))[:120]))
    if any(p.stage in ("offer", "visa", "move") for p in programs):
        needs.append(("visa", "moving after an offer"))
    result = []
    for kind, why in needs:
        doc = have.get(kind)
        warn = None
        if kind == "passport" and doc and doc.expires_on:
            latest = max((p.deadline for p in programs if p.deadline), default=today) + timedelta(days=365 + 180)
            if doc.expires_on < latest:
                warn = "Expires before a full year abroad plus 6 months: many visas need longer validity. Check the rule."
        result.append({"kind": kind, "label": KIND_LABEL[kind], "needed_for": why, "have": doc is not None, "document_id": doc.id if doc else None, "warning": warn})
    return result


def overview(db: Session, user_id) -> dict:
    tz = _tz(db, user_id)
    today = datetime.now(tz).date()
    docs = list(db.scalars(select(VaultDocument).where(VaultDocument.user_id == user_id).order_by(VaultDocument.expires_on.asc().nullslast(), VaultDocument.name)).all())
    items = [out(d, today) for d in docs]
    return {"documents": items, "counts": {s: sum(1 for i in items if i["status"] == s) for s in ("expired", "renew_now", "valid", "no_expiry")},
            "needed_for_plans": needed_for_plans(db, user_id, docs, today),
            "note": "Sakuna stores details, not files. Keep scans in your own secure storage and note where they are."}
