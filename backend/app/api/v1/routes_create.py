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


# ---------------- best learning resources for any topic (real search links + a real Wikipedia summary)

@router.get("/resources")
def resources_find(topic: str = Query(min_length=2, max_length=120), level: str = Query(default="beginner", pattern="^(beginner|intermediate|advanced)$"),
                   ai: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Best beginner video, practical tutorial, educational post, free resource and next action for a topic. Nothing invented."""
    from app.services import resources
    out = resources.find(topic, level)
    if ai:
        out["ai_note"] = resources.ai_note(db, user.id, out["topic"])
        db.commit()
    return out


# ---------------- notes notebook

NoteColor = ("default", "green", "blue", "amber", "red", "violet", "pink", "teal")


def _note_out(n) -> dict:
    lines = (n.body or "").splitlines()
    todo = [ln for ln in lines if ln.strip().startswith(("- [ ]", "- [x]", "- [X]"))]
    done = [ln for ln in todo if ln.strip()[3:4].lower() == "x"]
    return {"id": n.id, "title": n.title, "body": n.body, "tags": n.tags or [], "color": n.color, "pinned": n.pinned,
            "checklist": {"done": len(done), "total": len(todo)} if todo else None, "created_at": n.created_at, "updated_at": n.updated_at}


@router.get("/notes")
def notes_list(q: str | None = Query(default=None, max_length=100), tag: str | None = Query(default=None, max_length=40),
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Your notes, pinned first then newest; filter by words or a tag."""
    from app.models.entities import Note
    rows = db.scalars(select(Note).where(Note.user_id == user.id).order_by(Note.pinned.desc(), Note.updated_at.desc())).all()
    if q:
        words = q.lower().split()
        rows = [n for n in rows if all(w in f"{n.title} {n.body} {' '.join(n.tags or [])}".lower() for w in words)]
    if tag:
        rows = [n for n in rows if tag.lower() in [t.lower() for t in (n.tags or [])]]
    tags = sorted({t for n in db.scalars(select(Note).where(Note.user_id == user.id)).all() for t in (n.tags or [])}, key=str.lower)
    return {"items": [_note_out(n) for n in rows], "tags": tags, "colors": list(NoteColor)}


@router.post("/notes", status_code=201)
def note_create(data: dto.NoteIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import Note
    if not (data.title.strip() or data.body.strip()):
        raise HTTPException(422, "Write a title or some text")
    n = Note(user_id=user.id, title=data.title.strip(), body=data.body, tags=_clean_tags(data.tags), color=data.color, pinned=data.pinned)
    db.add(n); db.commit(); db.refresh(n); return _note_out(n)


def _clean_tags(tags: list[str] | None) -> list[str]:
    out: list[str] = []
    for t in tags or []:
        t = t.strip().lstrip("#")[:40]
        if t and t.lower() not in [x.lower() for x in out]:
            out.append(t)
    return out[:12]


@router.patch("/notes/{note_id}")
def note_update(note_id: uuid.UUID, data: dto.NoteUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.core.clock import now_utc
    from app.models.entities import Note
    n = owned(db, Note, user.id, note_id)
    changes = data.model_dump(exclude_unset=True)
    if "tags" in changes:
        changes["tags"] = _clean_tags(changes["tags"])
    for k, v in changes.items():
        setattr(n, k, v.strip() if k == "title" and isinstance(v, str) else v)
    n.updated_at = now_utc()
    db.commit(); db.refresh(n); return _note_out(n)


@router.post("/notes/{note_id}/toggle/{line}")
def note_toggle(note_id: uuid.UUID, line: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Tick or untick one checklist line ("- [ ]" / "- [x]")."""
    from app.core.clock import now_utc
    from app.models.entities import Note
    n = owned(db, Note, user.id, note_id)
    lines = (n.body or "").splitlines()
    if not 0 <= line < len(lines) or not lines[line].lstrip().startswith(("- [ ]", "- [x]", "- [X]")):
        raise HTTPException(404, "Not a checklist line")
    s = lines[line]
    i = s.index("- [") + 3
    lines[line] = s[:i] + (" " if s[i].lower() == "x" else "x") + s[i + 1:]
    n.body, n.updated_at = "\n".join(lines), now_utc()
    db.commit(); db.refresh(n); return _note_out(n)


@router.delete("/notes/{note_id}", status_code=204)
def note_delete(note_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import Note
    db.delete(owned(db, Note, user.id, note_id)); db.commit()


# ---------------- pelvic floor (Kegel) trainer

@router.get("/wellness/kegel")
def kegel_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Your level, today's sets, the week, streak, level-up readiness, the guide and checked reliable resources."""
    from app.services import kegel
    return kegel.overview(db, user.id, _today(db, user))


@router.post("/wellness/kegel/sessions", status_code=201)
def kegel_log(data: dto.KegelSessionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import WellnessSession
    from app.services import kegel
    cfg = kegel.LEVELS[data.level]
    db.add(WellnessSession(user_id=user.id, kind="kegel", level=data.level, sets=data.sets, reps=data.reps or cfg["reps"],
                           hold_s=data.hold_s or cfg["hold_s"], local_date=_today(db, user)))
    db.commit()
    return kegel.overview(db, user.id, _today(db, user))


# ---------------- personal discipline & digital wellbeing (private; plain code only)

def _hour(db: Session, user: User) -> int:
    from app.core.clock import now_utc, zone
    from app.models.entities import UserProfile
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    return now_utc().astimezone(zone(p.timezone if p else "Asia/Colombo")).hour


@router.get("/discipline")
def discipline_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Your commitments with streaks, milestones, triggers and insights; check-in options; blocking help. Never shared with AI."""
    from app.models.entities import DisciplineGoal
    from app.services import discipline as d
    today = _today(db, user)
    goals = db.scalars(select(DisciplineGoal).where(DisciplineGoal.user_id == user.id).order_by(DisciplineGoal.created_at)).all()
    return {"goals": [d.goal_out(db, g, today) for g in goals], "kinds": d.KINDS, "triggers": d.TRIGGERS, "default_replacements": d.DEFAULT_REPLACEMENTS,
            "blocking": {"shield": "Use Focus → Shield on the phone to block distracting apps at set hours.",
                         "dns": [{"name": "CleanBrowsing Adult Filter", "host": "adult-filter-dns.cleanbrowsing.org"},
                                 {"name": "AdGuard Family", "host": "family.adguard-dns.com"}],
                         "dns_how": "Android: Settings → Network & internet → Private DNS → Private DNS provider hostname → paste one of these hosts. "
                                    "It filters adult websites on the whole phone; turn it off the same way."},
            "privacy": "Private: this section is never sent to AI, isn't in search, and shows a neutral name on shared screens.",
            "support": d.SUPPORT}


@router.post("/discipline/goals", status_code=201)
def discipline_goal_create(data: dto.DisciplineGoalIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import DisciplineGoal
    from app.services import discipline as d
    today = _today(db, user)
    start = data.started_on or today
    if start > today:
        raise HTTPException(422, "The start date can't be in the future")
    g = DisciplineGoal(user_id=user.id, kind=data.kind, label=(data.label or "Self-control").strip()[:80], reasons=data.reasons,
                       replacements=[r.strip()[:80] for r in data.replacements if r.strip()][:12] or None, started_on=start, streak_start=start)
    db.add(g); db.commit(); db.refresh(g)
    return d.goal_out(db, g, today)


@router.patch("/discipline/goals/{goal_id}")
def discipline_goal_update(goal_id: uuid.UUID, data: dto.DisciplineGoalUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import DisciplineGoal
    from app.services import discipline as d
    g = owned(db, DisciplineGoal, user.id, goal_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(g, k, [r.strip()[:80] for r in v if r.strip()][:12] if k == "replacements" and v is not None else v)
    db.commit(); db.refresh(g)
    return d.goal_out(db, g, _today(db, user))


@router.delete("/discipline/goals/{goal_id}", status_code=204)
def discipline_goal_delete(goal_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import DisciplineGoal
    db.delete(owned(db, DisciplineGoal, user.id, goal_id)); db.commit()


@router.post("/discipline/goals/{goal_id}/checkin")
def discipline_checkin(goal_id: uuid.UUID, data: dto.DisciplineCheckinIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """I'm doing well / I'm having an urge / I need motivation / I want to reset. Returns a supportive reply and ideas."""
    from app.models.entities import DisciplineGoal
    from app.services import discipline as d
    g = owned(db, DisciplineGoal, user.id, goal_id)
    today = _today(db, user)
    reply = d.record(db, g, data.kind, today, _hour(db, user), data.trigger, data.intensity, data.action, data.stayed, data.note)
    db.commit(); db.refresh(g)
    return {**reply, "goal": d.goal_out(db, g, today)}


@router.patch("/discipline/events/{event_id}")
def discipline_event_update(event_id: uuid.UUID, data: dto.DisciplineEventUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """After an urge: record what you did and whether you stayed on track."""
    from app.models.entities import DisciplineEvent
    e = owned(db, DisciplineEvent, user.id, event_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    db.commit()
    return {"id": e.id, "stayed": e.stayed, "action": e.action}
