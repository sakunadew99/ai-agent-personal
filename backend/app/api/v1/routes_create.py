"""Content studio and travel guide."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, owned
from app.models.entities import ContentItem, TravelWish, User
from app.schemas import dto

router = APIRouter()


def _today(db: Session, user: User):
    from app.services.wellbeing import _today as today
    return today(db, user.id)


# ---------------- content studio

@router.get("/content")
def content_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Your content pipeline, fresh ideas from your goals and skills, this week's schedule and streak."""
    from app.services import content
    return content.overview(db, user.id, _today(db, user))


@router.post("/content", status_code=201)
def content_create(data: dto.ContentIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import content
    row = ContentItem(user_id=user.id, title=data.title.strip(), platform=data.platform, topic=data.topic, scheduled_on=data.scheduled_on, status="idea",
                      script=content.script_template(data.title, data.platform, data.topic))
    db.add(row); db.commit(); db.refresh(row); return content.item_out(row)


@router.patch("/content/{item_id}")
def content_update(item_id: uuid.UUID, data: dto.ContentUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import content
    row = owned(db, ContentItem, user.id, item_id)
    changes = data.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(row, k, v)
    if changes.get("status") == "published" and not row.published_on:
        row.published_on = _today(db, user)
    db.commit(); db.refresh(row); return content.item_out(row)


@router.delete("/content/{item_id}", status_code=204)
def content_delete(item_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, ContentItem, user.id, item_id)); db.commit()


@router.post("/content/{item_id}/script")
def content_script(item_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Write the script with AI (when on). Without AI you keep the structured template to fill in."""
    from app.services import content
    row = owned(db, ContentItem, user.id, item_id)
    text = content.ai_script(db, user.id, row.title, row.platform, row.topic)
    if not text:
        raise HTTPException(503, "AI writing needs AI switched on; the template is ready to fill in.")
    row.script = text.strip()
    if row.status == "idea":
        row.status = "scripted"
    db.commit(); db.refresh(row); return content.item_out(row)


# ---------------- travel guide

@router.get("/travel")
def travel_overview(month: int | None = Query(default=None, ge=1, le=12), interest: str | None = Query(default=None, max_length=20),
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Destinations (Sri Lanka first, good-this-month first), your wish list and progress."""
    from app.services import travel
    wishes = db.scalars(select(TravelWish).where(TravelWish.user_id == user.id).order_by(TravelWish.created_at.desc())).all()
    m = month or _today(db, user).month
    return {"month": m, "destinations": travel.destinations(m, interest), "wishes": [_wish_out(w) for w in wishes],
            "done": sum(1 for w in wishes if w.status == "done"), "interests": ["nature", "culture", "beach", "adventure", "relax"]}


@router.get("/travel/plan")
def travel_plan(key: str = Query(max_length=32), days: int = Query(default=3, ge=1, le=30), tier: dto.TravelTier = "budget",
                people: int = Query(default=1, ge=1, le=20), usd_lkr: float | None = Query(default=None, gt=1, le=10000), user: User = Depends(get_current_user)):
    """A day-by-day itinerary and an LKR budget (stay, food, transport, activities); estimates to plan with."""
    from app.services import travel, wealth
    rate = usd_lkr or wealth._usd_lkr()[0]
    try:
        return travel.plan(key, days, tier, people, rate)
    except KeyError as exc:
        raise HTTPException(404, "Unknown destination") from exc


def _wish_out(w: TravelWish) -> dict:
    return {"id": w.id, "destination": w.destination, "key": w.key, "status": w.status, "planned_on": w.planned_on, "days": w.days,
            "people": w.people, "tier": w.tier, "budget_lkr": w.budget_lkr, "notes": w.notes}


@router.post("/travel/wishes", status_code=201)
def travel_wish_create(data: dto.TravelWishIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = TravelWish(user_id=user.id, **data.model_dump())
    db.add(row); db.commit(); db.refresh(row); return _wish_out(row)


@router.patch("/travel/wishes/{wish_id}")
def travel_wish_update(wish_id: uuid.UUID, data: dto.TravelWishUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, TravelWish, user.id, wish_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit(); db.refresh(row); return _wish_out(row)


@router.delete("/travel/wishes/{wish_id}", status_code=204)
def travel_wish_delete(wish_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, TravelWish, user.id, wish_id)); db.commit()
