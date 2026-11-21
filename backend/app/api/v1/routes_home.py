"""One request for the whole Home screen (8 parts), so the phone doesn't fire 8 requests at a small free server."""
import logging

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.entities import User

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
