"""Medicines, skills practice (with pitch and pose trainers), Mi Band multi-day sync, health advice."""
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, owned
from app.models.entities import Medicine, Skill, SkillSession, User
from app.schemas import dto
from app.services import wellbeing as wb

router = APIRouter()


# ---------------- medicines

@router.get("/medicines")
def medicines(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Today's doses (taken / due / later), every medicine, 7-day adherence and refill warnings."""
    return wb.medicines_today(db, user.id)


@router.post("/medicines", status_code=201)
def medicine_create(data: dto.MedicineIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = Medicine(user_id=user.id, **data.model_dump())
    row.times = sorted(set(row.times))
    db.add(row); db.commit(); db.refresh(row); return wb.med_out(row)


@router.patch("/medicines/{medicine_id}")
def medicine_update(medicine_id: uuid.UUID, data: dto.MedicineUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Medicine, user.id, medicine_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, k, sorted(set(v)) if k == "times" else v)
    db.commit(); db.refresh(row); return wb.med_out(row)


@router.delete("/medicines/{medicine_id}", status_code=204)
def medicine_delete(medicine_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Medicine, user.id, medicine_id)); db.commit()


@router.post("/medicines/{medicine_id}/log")
def medicine_log(medicine_id: uuid.UUID, data: dto.DoseLogIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Mark one dose taken or skipped (status null = undo). Stock goes down when taken."""
    row = owned(db, Medicine, user.id, medicine_id)
    wb.check_slot(row, data.slot)
    wb.log_dose(db, user.id, row, data.on or wb._today(db, user.id), data.slot, data.status)
    db.commit(); return wb.medicines_today(db, user.id)


@router.get("/medicines/reminders")
def medicine_reminders(days: int = Query(default=2, ge=1, le=7), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Upcoming doses for phone notifications (doses already marked are left out)."""
    return {"items": wb.medicine_reminders(db, user.id, days)}


# ---------------- skills

@router.get("/skills")
def skills(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return wb.skills_overview(db, user.id)


@router.post("/skills", status_code=201)
def skill_create(data: dto.SkillIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.add(Skill(user_id=user.id, **data.model_dump())); db.commit(); return wb.skills_overview(db, user.id)


@router.patch("/skills/{skill_id}")
def skill_update(skill_id: uuid.UUID, data: dto.SkillUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Skill, user.id, skill_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit(); return wb.skills_overview(db, user.id)


@router.delete("/skills/{skill_id}", status_code=204)
def skill_delete(skill_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Skill, user.id, skill_id)); db.commit()


@router.post("/skills/{skill_id}/sessions", status_code=201)
def skill_session_create(skill_id: uuid.UUID, data: dto.SkillSessionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Log practice (by hand, or from the pitch / pose trainer with its scores)."""
    row = owned(db, Skill, user.id, skill_id)
    db.add(SkillSession(user_id=user.id, skill_id=row.id, local_date=data.on or wb._today(db, user.id), minutes=data.minutes, rating=data.rating,
                        note=data.note, metrics=data.metrics, source=data.source))
    db.commit(); return wb.skills_overview(db, user.id)


@router.delete("/skills/sessions/{session_id}", status_code=204)
def skill_session_delete(session_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, SkillSession, user.id, session_id)); db.commit()


@router.post("/skills/{skill_id}/plan")
def skill_plan(skill_id: uuid.UUID, ai: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Today's practice plan: built-in steps, or an AI coach plan from your recent sessions when AI is on."""
    out = wb.practice_plan(db, user.id, owned(db, Skill, user.id, skill_id), ai); db.commit(); return out


# ---------------- Mi Band (Health Connect) and advice

@router.post("/health/sync")
def health_sync(data: dto.HealthSyncIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Several days at once from the phone: one steps / heart-rate value per day (updated, not duplicated) and new sleep."""
    out = wb.health_sync(db, user.id, [d.model_dump() for d in data.days], [s.model_dump() for s in data.sleep]); db.commit(); return out


@router.get("/health/advice")
def health_advice(ai: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Tips from your last two weeks (plain code), plus AI advice when AI is on and you allow health data."""
    out = wb.health_advice(db, user.id, ai); db.commit(); return out
