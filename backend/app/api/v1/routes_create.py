"""Content studio and travel guide."""
import uuid
from datetime import date

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


# ---------------- Ask Sakuna (plain code) + plan check that only proposes

@router.get("/ask")
def ask_questions():
    from app.services import ask
    return {"questions": [{"key": k, "text": v} for k, v in ask.QUESTIONS.items()]}


@router.get("/ask/{question}")
def ask_answer(question: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """What should I do today / most important task / this week's progress / what am I neglecting / what next."""
    from app.services import ask
    if question not in ask.QUESTIONS:
        raise HTTPException(404, "Unknown question")
    return ask.answer(db, user, question, _today(db, user))


@router.post("/plan/check")
def plan_check(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Proposes moving overdue tasks to tomorrow. Nothing changes until you approve each proposal."""
    from app.services import ask
    out = ask.plan_check(db, user, _today(db, user))
    db.commit()
    return out


@router.post("/approvals/{approval_id}/cancel")
def approval_cancel(approval_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Withdraw a pending proposal without rejecting it (e.g. you already did it another way)."""
    from app.core.clock import now_utc
    from app.models.entities import Approval
    from app.services.audit import audit
    row = owned(db, Approval, user.id, approval_id)
    if row.status != "pending":
        raise HTTPException(409, "Approval is already resolved")
    row.status = "cancelled"; row.resolved_at = now_utc()
    audit(db, user.id, "approval.cancel", "approval", row.id, {"tool": row.tool_name})
    db.commit()
    return {"id": row.id, "status": row.status}


@router.get("/progress")
def progress_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Every active goal with %, pace against its start/target dates, tasks and milestones."""
    from app.services import ask
    return ask.progress(db, user, _today(db, user))


@router.get("/reports/weekly")
def report_weekly(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import ask
    return ask.weekly_report(db, user, _today(db, user))


# ---------------- sports pathways, English check, freelancing (plain code)

@router.get("/sports")
def sports_list(user: User = Depends(get_current_user)):
    from app.services import sports
    return {"sports": sports.catalogue(), "safety": sports.COMMON_SAFETY}


@router.get("/sports/{key}")
def sports_pathway(key: str, city: str = Query(default="Colombo", max_length=60), user: User = Depends(get_current_user)):
    """Stages, weekly schedule, equipment and LKR costs, safety, online vs instructor, how to choose a club, nearby search."""
    from app.services import sports
    out = sports.pathway(key, city.strip() or "Colombo")
    if out is None:
        raise HTTPException(404, "Unknown sport")
    return out


@router.post("/english/check")
def english_check(data: dto.EnglishCheckIn, user: User = Depends(get_current_user)):
    """Grammar suggestions with a corrected version. Built-in rules always; deep=true also asks LanguageTool."""
    from app.services import english
    return english.check(data.text, data.deep, data.lang)


@router.post("/freelance/estimate")
def freelance_estimate(data: dto.FreelanceEstimateIn, user: User = Depends(get_current_user)):
    from app.services import freelance, wealth
    return freelance.estimate(data.hours, data.rate_usd, data.level, data.platform, data.complexity, data.revisions, wealth._usd_lkr()[0], data.buffer_pct)


@router.post("/freelance/proposal")
def freelance_proposal(data: dto.FreelanceProposalIn, user: User = Depends(get_current_user)):
    """A proposal draft for you to edit and send yourself. Nothing is sent from Sakuna."""
    from app.services import freelance
    return freelance.proposal(data.job, [s.strip()[:40] for s in data.skills if s.strip()], data.name, data.experience, data.days, data.price_usd, data.tone)


# ---------------- body measurements

def _profile_row(db: Session, user: User):
    from app.models.entities import UserProfile
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    if p is None:
        p = UserProfile(user_id=user.id); db.add(p); db.flush()
    return p


@router.get("/body")
def body_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Measurements with change since start and last month, waist-to-height ratio and a body-fat estimate."""
    from app.services import body
    p = _profile_row(db, user)
    out = body.overview(db, user.id, _today(db, user), p.height_cm, p.sex)
    db.commit()
    return {**out, "height_cm": p.height_cm, "sex": p.sex}


@router.put("/body/profile")
def body_profile(data: dto.BodyProfileIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = _profile_row(db, user)
    p.height_cm, p.sex = data.height_cm, data.sex
    db.commit()
    return {"height_cm": p.height_cm, "sex": p.sex}


@router.post("/body/measurements", status_code=201)
def body_add(data: dto.BodyMeasurementIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One check-in per day: saving again on the same day updates it."""
    from app.core.clock import now_utc
    from app.models.entities import BodyMeasurement
    from app.services import body
    values = data.model_dump(exclude={"measured_on"})
    if all(values[k] is None for k in body.FIELDS):
        raise HTTPException(422, "Enter at least one measurement")
    day = data.measured_on or _today(db, user)
    if day > _today(db, user):
        raise HTTPException(422, "The date can't be in the future")
    row = db.scalar(select(BodyMeasurement).where(BodyMeasurement.user_id == user.id, BodyMeasurement.measured_on == day))
    if row is None:
        row = BodyMeasurement(user_id=user.id, measured_on=day); db.add(row)
    for k, v in values.items():
        if v is not None:
            setattr(row, k, v)
    row.updated_at = now_utc()
    db.commit(); db.refresh(row)
    return body.row_out(row)


@router.delete("/body/measurements/{row_id}", status_code=204)
def body_delete(row_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import BodyMeasurement
    db.delete(owned(db, BodyMeasurement, user.id, row_id)); db.commit()


# ---------------- learning feed: only educational, motivational and psychology content

@router.get("/learn-feed")
def learn_feed(channels: str = Query(default="", max_length=600), shorts: bool = False, ai: bool = False,
               only: str | None = Query(default=None, pattern="^(technology|educational|motivational|psychology)$"), user: User = Depends(get_current_user)):
    """Latest videos from trusted channels (+ yours), auto-filtered to learning topics, with what was hidden and why."""
    from app.services import learn_feed as lf
    return lf.feed([c.strip() for c in channels.split(",") if c.strip()], shorts, ai, only)


@router.post("/learn-feed/link", status_code=201)
def learn_link(data: dto.LearnLinkIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Save a TikTok / Facebook / YouTube / Instagram link if its caption is educational, motivational or psychology."""
    from app.models.entities import MediaItem
    from app.services import learn_feed as lf
    url = data.url.strip()
    plat = lf.platform_of(url)
    if not url.lower().startswith("https://") or plat is None:
        raise HTTPException(422, "Paste an https link from LinkedIn, TikTok, Facebook, YouTube, Instagram, TED, Vimeo, Coursera or Khan Academy")
    c = lf.classify(data.title)
    if not c["category"] and not c["blocked"] and data.ai:
        lab = lf.ai_classify([data.title])[0]
        if lab in lf.CATS:
            c = {"category": lab, "why": "AI check: " + lf.AI_LABELS[lab], "blocked": False, "method": "ai"}
    if not c["category"] and not data.save_anyway:
        return {"saved": False, "category": None, "why": c["why"], "platform": plat,
                "hint": "Add a few words about what it teaches (e.g. 'how to stop overthinking'), or save it anyway."}
    if c["blocked"]:
        return {"saved": False, "category": None, "why": c["why"], "platform": plat, "hint": "This looks like entertainment, so it isn't saved to learning."}
    folder = lf.FOLDER.get(c["category"] or "", "Learning · Other")
    row = MediaItem(user_id=user.id, title=f"[{plat}] {data.title.strip()}"[:200], url=url, provider="youtube" if plat == "YouTube" else "web", folder=folder)
    db.add(row); db.commit(); db.refresh(row)
    return {"saved": True, "id": row.id, "category": c["category"], "folder": folder, "why": c["why"] if c["category"] else "Saved anyway", "platform": plat}


# ---------------- learning reels ("For you")

@router.get("/reels")
def reels_feed(channels: str = Query(default="", max_length=600), ai: bool = False, limit: int = Query(default=20, ge=5, le=40),
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Ranked learning reels with a reason for each, plus this week's learning minutes."""
    from app.services import reels
    return reels.reels(db, user.id, [c.strip() for c in channels.split(",") if c.strip()], _today(db, user), ai, limit)


@router.post("/reels/events", status_code=201)
def reels_events(data: dto.ReelEventsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """What you watched (seconds), finished, liked, saved, skipped or hid. Only used to rank your own feed."""
    from app.services import reels
    n = reels.record(db, user.id, [e.model_dump() for e in data.events])
    db.commit()
    return {"recorded": n}



@router.get("/hub")
def learning_hub(channels: str = Query(default="", max_length=600), only: str | None = Query(default=None, pattern="^(technology|educational|motivational|psychology)$"),
                 exclude: str = Query(default="", max_length=3000), limit: int = Query(default=24, ge=6, le=48),
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Learning hub: posts + videos + your saved clips, ranked for you. `exclude` = ids already shown (for "load more")."""
    from app.services import reels
    return reels.hub(db, user.id, [c.strip() for c in channels.split(",") if c.strip()], _today(db, user), only,
                     {e.strip() for e in exclude.split(",") if e.strip()}, limit)


# ---------------- sleep from phone use + "what did you do this hour?" gaps

@router.post("/sleep/phone", status_code=201)
def sleep_phone(data: dto.PhoneSleepIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The phone's estimate for one night (longest screen-off stretch). A Mi Band record for the same night wins in reports."""
    from app.services import sleep_day
    out = sleep_day.save_phone_sleep(db, user.id, data.night, data.last_use, data.first_use, [i.model_dump(mode="json") for i in data.interruptions], data.core_minutes)
    db.commit()
    return out


@router.get("/sleep/insights")
def sleep_insights(days: int = Query(default=14, ge=3, le=60), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import sleep_day
    return sleep_day.nights(db, user.id, days, _today(db, user))


@router.get("/day/gaps")
def day_gaps(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Waking hours with nothing logged, each with phone minutes, top apps and a suggested answer."""
    from app.services import sleep_day
    return sleep_day.gaps(db, user.id, day or _today(db, user))


@router.post("/day/gaps/fill", status_code=201)
def day_gaps_fill(data: dto.GapFillIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import sleep_day
    if data.day > _today(db, user):
        raise HTTPException(422, "Can't fill in the future")
    n = sleep_day.fill(db, user.id, data.day, [a.model_dump() for a in data.answers])
    db.commit()
    return {"saved": n}


# ---------------- water + mindset studio

def _day_start_utc(db: Session, user: User):
    from datetime import datetime, time
    from app.core.clock import zone
    from app.models.entities import UserProfile
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    return datetime.combine(_today(db, user), time.min, zone(p.timezone if p else "Asia/Colombo"))


@router.get("/water")
def water_today(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import mindset
    return mindset.water(db, user.id, _today(db, user), _day_start_utc(db, user))


@router.post("/water", status_code=201)
def water_add(data: dto.WaterIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import mindset
    mindset.add_water(db, user.id, _today(db, user), data.ml, _day_start_utc(db, user))
    db.commit()
    return mindset.water(db, user.id, _today(db, user), _day_start_utc(db, user))


@router.delete("/water/{log_id}", status_code=204)
def water_delete(log_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import WaterLog
    db.delete(owned(db, WaterLog, user.id, log_id)); db.commit()


@router.get("/mindset")
def mindset_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Affirmation of the day, your cards, streaks, 55x5 progress, WOOP plans, journal, videos."""
    from app.services import mindset
    out = mindset.overview(db, user.id, _today(db, user))
    db.commit()
    return out


@router.post("/affirmations", status_code=201)
def affirmation_add(data: dto.AffirmationIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import Affirmation
    from app.services import mindset
    mindset.ensure_starter(db, user.id)
    row = Affirmation(user_id=user.id, text=data.text.strip(), category=data.category, favorite=True)
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "text": row.text, "category": row.category, "favorite": row.favorite}


@router.patch("/affirmations/{aff_id}")
def affirmation_update(aff_id: uuid.UUID, data: dto.AffirmationUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import Affirmation
    row = owned(db, Affirmation, user.id, aff_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return {"id": row.id, "text": row.text, "category": row.category, "favorite": row.favorite, "active": row.active}


@router.delete("/affirmations/{aff_id}", status_code=204)
def affirmation_delete(aff_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import Affirmation
    db.delete(owned(db, Affirmation, user.id, aff_id)); db.commit()


@router.post("/mindset/entries", status_code=201)
def mindset_entry(data: dto.MindsetEntryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import mindset
    row = mindset.add_entry(db, user.id, _today(db, user), data.kind, data.body, data.data, data.ai_mood)
    db.commit()
    return {"id": row.id, "kind": row.kind, "date": row.local_date, "data": row.data}


@router.delete("/mindset/entries/{entry_id}", status_code=204)
def mindset_entry_delete(entry_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import MindsetEntry
    db.delete(owned(db, MindsetEntry, user.id, entry_id)); db.commit()


# ---------------- consistency coach, Today ring, weekly review

@router.get("/consistency")
def consistency_view(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Habit strength (0-100), never-miss-twice nudges, tiny versions, 66-day journey and habit-stacking ideas."""
    from app.services import consistency
    return consistency.consistency(db, user.id, _today(db, user))


@router.get("/today")
def today_view(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything for the Today screen: 24-hour ring, sleep, water, top task, habits, affirmation, hours to fill in."""
    from app.services import consistency
    out = consistency.today(db, user, _today(db, user))
    db.commit()
    return out


@router.get("/review/week")
def review_week(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import consistency
    return consistency.weekly_review(db, user.id, _today(db, user))


# ---------------- settings hub, app preferences, briefs

@router.get("/settings")
def settings_hub(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything for the Settings & profile screen: account, profile, schedule and app preferences."""
    from app.services import app_settings
    from app.models.entities import UserProfile
    out = app_settings.prefs(db, user.id)
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    t = lambda v: v.strftime("%H:%M") if v else None  # noqa: E731
    db.commit()
    return {"user": {"email": user.email, "full_name": user.full_name},
            "profile": {"timezone": p.timezone, "currency": p.currency, "location": p.location, "bio": p.bio, "height_cm": p.height_cm, "sex": p.sex,
                        "wake_time": t(p.wake_time), "sleep_time": t(p.sleep_time), "work_start": t(p.work_start), "work_end": t(p.work_end),
                        "gym_time": t(p.gym_time), "work_days": p.work_days, "gym_days": p.gym_days},
            "prefs": out}


@router.patch("/settings/prefs")
def settings_prefs(data: dto.PrefsPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import app_settings
    out = app_settings.update_prefs(db, user.id, data.model_dump(exclude_unset=True))
    db.commit()
    return out


@router.get("/brief/{kind}")
def brief(kind: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Morning brief (sleep, affirmation, first tasks, water) or night review (hours to fill, habits left, tomorrow, bedtime)."""
    from app.services import app_settings
    if kind not in ("morning", "night"):
        raise HTTPException(404, "Unknown brief")
    out = app_settings.brief(db, user, kind, _today(db, user))
    db.commit()
    return out


# ---------------- in-app nudges, daily goals, Gmail inbox

@router.get("/nudges")
def nudges_view(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Friendly in-app prompts with one-tap actions, plus the 5 daily goals."""
    from app.services import nudges
    out = nudges.nudges(db, user, _today(db, user))
    db.commit()
    return out


@router.post("/nudges/claim")
def nudges_claim(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Daily-goals bonus: only when all 5 are really done today (checked here)."""
    from app.services import nudges
    out = nudges.claim(db, user, _today(db, user))
    db.commit()
    return out


@router.get("/gmail/inbox")
def gmail_inbox(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Latest unread primary emails (read-only: sender, subject, snippet)."""
    from app.services import gmail
    out = gmail.inbox(db, user.id, 5)
    db.commit()
    return out
