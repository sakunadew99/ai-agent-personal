"""One request for the whole Home screen (8 parts), so the phone doesn't fire 8 requests at a small free server."""
import logging

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.entities import User
from app.schemas import dto

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/home")
def home_bundle(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything Home shows, keyed by the path the app would otherwise call. A part that fails is null; the rest still load."""
    from app.api.v1.router import dashboard, finance_get, health_summary, health_trends, life_overview
    from app.api.v1.routes_lifeos import routines_today
    from app.api.v1.routes_tracking import nudge, today_plan
    parts = {
        "/dashboard": lambda: dashboard(db=db, user=user),
        "/finance/summary": lambda: finance_get(month=None, db=db, user=user),
        "/health/summary": lambda: health_summary(db=db, user=user),
        "/life/overview": lambda: life_overview(db=db, user=user),
        "/nudge": lambda: nudge(db=db, user=user),
        "/today/plan": lambda: today_plan(db=db, user=user),
        "/routines/today": lambda: routines_today(day=None, db=db, user=user),
        "/health/trends?days=14": lambda: health_trends(days=14, db=db, user=user),
    }
    out = {}
    for path, fn in parts.items():
        try:
            out[path] = jsonable_encoder(fn())
        except Exception:  # noqa: BLE001 - one broken card must not blank the whole Home screen
            logger.exception("home part failed: %s", path)
            db.rollback()
            out[path] = None
    return out


# ---------------- 2-minute morning and evening rituals

@router.get("/ritual/morning")
def ritual_morning(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Today's plan, medicines due, top 3 tasks and last night's sleep, to start the day."""
    from app.services import rituals
    return rituals.morning(db, user.id)


@router.post("/ritual/morning")
def ritual_morning_save(data: dto.MorningIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import rituals
    rituals.save_morning(db, user.id, data.energy, data.mood, data.focus); db.commit(); return rituals.morning(db, user.id)


@router.get("/ritual/evening")
def ritual_evening(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """What today looked like (tasks done, focus, steps, practice, medicines, spending) to close the day."""
    from app.services import rituals
    return rituals.evening(db, user.id)


@router.post("/ritual/evening")
def ritual_evening_save(data: dto.EveningIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Mood, wins and a lesson go to today's journal; tomorrow's top 3 become tasks (you typed them)."""
    from app.services import rituals
    out = rituals.save_evening(db, user.id, data.mood, data.wins, data.lesson, data.tomorrow); db.commit(); return out



# ---------------- dreams -> plans, and the proactive companion

@router.post("/dreams/propose")
def dream_propose(data: dto.DreamIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A proposal only: why, success, skills, resources, milestones, challenges and a first step. Nothing is saved."""
    from app.services import dreams
    out = dreams.propose(db, user.id, data.dream, data.horizon, data.ai); db.commit(); return out


@router.post("/dreams/accept", status_code=201)
def dream_accept(data: dto.DreamAccept, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """You approved the plan (after editing it if you liked): the goal, its milestones and one first task are created."""
    from app.services import dreams
    goal = dreams.accept(db, user.id, data.model_dump()); db.commit()
    return {"goal_id": goal.id, **dreams.ladder(db, user.id)}


@router.get("/dreams/ladder")
def dream_ladder(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Goals by horizon (today .. 10 years) with milestone progress, and today's tasks that move them."""
    from app.services import dreams
    return dreams.ladder(db, user.id)


@router.get("/companion")
def companion_question(force: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One useful question with buttons, or none (frequency, quiet hours, sleep). force=true asks now."""
    from app.services import companion
    out = companion.question(db, user.id, force); db.commit(); return out


@router.post("/companion/answer")
def companion_answer(data: dto.CompanionAnswer, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import companion
    out = companion.answer(db, user.id, data.choice, data.goal_id); db.commit(); return out


@router.put("/companion/frequency")
def companion_frequency(data: dto.CompanionFrequency, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Ask me daily, a few times a week, only when useful, or never."""
    from app.services import companion
    out = companion.set_frequency(db, user.id, data.frequency); db.commit(); return out


# ---------------- $1M journey and the opportunity finder

@router.get("/money/million")
def money_million(monthly_saving_lkr: float | None = Query(default=None, ge=0, le=100_000_000), usd_lkr: float | None = Query(default=None, gt=1, le=10000),
                  target_usd: float = Query(default=1_000_000, ge=1000, le=100_000_000), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Where you are on the way to $1M: three scenarios, years to target and the monthly saving needed for 10/15/20 years."""
    from app.services import wealth
    return wealth.million(db, user.id, monthly_saving_lkr, usd_lkr, target_usd)


@router.get("/opportunities")
def money_opportunities(hours: int = Query(default=8, ge=1, le=80), budget_lkr: int = Query(default=10000, ge=0, le=10_000_000),
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Income ideas ranked by fit with your skills, time and starting budget, with risks and a first action."""
    from app.services import wealth
    return wealth.opportunities(db, user.id, hours, budget_lkr)
