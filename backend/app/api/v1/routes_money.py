"""Money plan routes: real numbers, debt, income streams, payday split, sprint, money hour, check-in, idea check, roadmap.
Everything is your own records; nothing here moves, pays or invests money."""
import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_utc, zone
from app.core.database import get_db
from app.core.deps import get_current_user, owned
from app.models.entities import IncomeStream, Liability, StreamLog, User, UserProfile
from app.schemas import dto

router = APIRouter()


def _today(db: Session, user: User):
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    return datetime.now(zone(p.timezone if p else "Asia/Colombo")).date()


@router.get("/money/plan")
def money_plan(usd_lkr: float | None = Query(default=None, gt=1, lt=10000), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Your whole money picture and plan: net worth to $1M, savings rate, emergency fund, leaks, debt payoff, payday split, income,
    skills and salary ladder, investing steps, rupee view, freedom number, milestones, check-in, sprint and the life roadmap."""
    from app.services import money_plan as mp
    out = mp.plan(db, user, usd_lkr); db.commit(); return out


@router.post("/money/setup")
def money_setup(data: dto.MoneySetupIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Salary, payday, fixed costs (e.g. boarding) and debts (e.g. a credit card): saved as your own records."""
    from app.services import money_plan as mp
    out = mp.setup(db, user, data.model_dump(mode="json")); db.commit(); return out


@router.post("/money/checkin")
def money_checkin(data: dto.MoneyCheckinIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import money_plan as mp
    out = mp.checkin(db, user.id, _today(db, user), data.spent, data.income_action, data.note); db.commit(); return out


@router.post("/money/sprint")
def money_sprint(data: dto.SprintIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import money_plan as mp
    out = mp.start_sprint(db, user.id, data.idea_id, _today(db, user)); db.commit(); return out


@router.patch("/money/sprint/week")
def money_sprint_week(data: dto.SprintWeekIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import money_plan as mp
    out = mp.tick_sprint(db, user.id, data.week, data.done, _today(db, user)); db.commit(); return out


@router.post("/money/money-hour", status_code=201)
def money_hour(data: dto.MoneyHourIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A weekly repeating 1-hour task for your income idea (you asked for it by pressing the button)."""
    from app.services import money_plan as mp
    out = mp.money_hour_task(db, user, data.weekday, data.time); db.commit(); return out


@router.post("/money/validate")
def money_validate(data: dto.IdeaCheckIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import money_plan as mp
    out = mp.validate_idea(db, user.id, data.idea, data.cost_lkr, data.hours_week, data.ai); db.commit(); return out


@router.get("/money/afford")
def money_afford(price: Decimal = Query(gt=0, lt=Decimal("1000000000")), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import money_plan as mp
    out = {"answer": mp.afford(db, user, price)}; db.commit(); return out


# ---------------- debts: interest, minimum, due day

@router.patch("/finance/liabilities/{liability_id}")
def liability_update(liability_id: uuid.UUID, data: dto.LiabilityUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Liability, user.id, liability_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, "balance" if k == "amount" else k, v)
    db.commit(); db.refresh(row)
    return {"id": row.id, "name": row.name, "balance": row.balance, "apr_pct": row.apr_pct, "min_payment": row.min_payment, "due_day": row.due_day}


@router.delete("/finance/liabilities/{liability_id}", status_code=204)
def liability_delete(liability_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Liability, user.id, liability_id)); db.commit()


# ---------------- income streams

def _stream_out(s: IncomeStream) -> dict:
    return {"id": s.id, "name": s.name, "kind": s.kind, "status": s.status, "income_source": s.income_source, "currency": s.currency}


@router.get("/money/streams")
def streams_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [_stream_out(s) for s in db.scalars(select(IncomeStream).where(IncomeStream.user_id == user.id).order_by(IncomeStream.created_at)).all()]


@router.post("/money/streams", status_code=201)
def streams_create(data: dto.StreamIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if db.scalar(select(IncomeStream.id).where(IncomeStream.user_id == user.id, IncomeStream.name == data.name.strip())):
        raise HTTPException(409, "You already have a stream with that name")
    row = IncomeStream(user_id=user.id, **{**data.model_dump(), "name": data.name.strip()})
    db.add(row); db.commit(); db.refresh(row); return _stream_out(row)


@router.patch("/money/streams/{stream_id}")
def streams_update(stream_id: uuid.UUID, data: dto.StreamUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, IncomeStream, user.id, stream_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    row.updated_at = now_utc(); db.commit(); db.refresh(row); return _stream_out(row)


@router.delete("/money/streams/{stream_id}", status_code=204)
def streams_delete(stream_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, IncomeStream, user.id, stream_id)); db.commit()


@router.post("/money/streams/{stream_id}/logs", status_code=201)
def streams_log(stream_id: uuid.UUID, data: dto.StreamLogIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = owned(db, IncomeStream, user.id, stream_id)
    row = StreamLog(user_id=user.id, stream_id=s.id, local_date=data.local_date or _today(db, user), minutes=data.minutes, earned=data.earned, note=data.note)
    db.add(row); db.commit()
    return {"id": row.id, "stream_id": s.id, "minutes": row.minutes, "earned": row.earned, "local_date": row.local_date}
