"""Gym, courses and coding profiles, languages, day tracker, smarter days, export, brain gym, watch, LinkedIn."""
import uuid
from datetime import date, datetime


from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, owned
from app.models.entities import (
    JobApplication, User, Workout,
)
from app.schemas import dto
from app.services.learning import (
    job_summary,
)
from app.services import game
from app.services.audit import audit
from app.core.clock import now_utc, zone

from app.api.v1.router import profile_for  # noqa: E402  (shared helpers)

router = APIRouter()


# ---------- Gym log ----------

@router.get("/gym")
def gym_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Exercises, templates, recent workouts with sets, weekly time and volume, personal records, last numbers per exercise."""
    from app.services import gym
    return gym.overview(db, user.id)


@router.post("/gym/workouts", status_code=201)
def gym_log(data: dto.GymWorkoutIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import gym
    w = gym.log_workout(db, user.id, data)
    game.on_workout(db, w); db.commit()
    return gym.overview(db, user.id)


@router.delete("/gym/workouts/{workout_id}", status_code=204)
def gym_delete(workout_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Workout, user.id, workout_id)); db.commit()


# ---------- Courses and coding profiles ----------

@router.get("/learning/tracker")
def learning_tracker(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Your courses (Coursera, Udemy, …) and LeetCode / HackerRank / GitHub / Codeforces stats."""
    from app.models.entities import CodingProfile, Course
    from app.services import tracking
    courses = db.scalars(select(Course).where(Course.user_id == user.id).order_by(Course.status, Course.updated_at.desc())).all()
    profiles = db.scalars(select(CodingProfile).where(CodingProfile.user_id == user.id).order_by(CodingProfile.platform)).all()
    return {"courses": [{c.name: getattr(row, c.name) for c in row.__table__.columns} for row in courses],
            "profiles": [tracking.profile_out(p) for p in profiles],
            "hours_total": float(sum(c.hours_spent for c in courses)), "done": sum(1 for c in courses if c.status == "done"),
            "active": sum(1 for c in courses if c.status == "active")}


@router.post("/learning/courses", status_code=201)
def course_create(data: dto.CourseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import Course
    row = Course(user_id=user.id, **{**data.model_dump(), "title": data.title.strip(), "updated_at": now_utc()})
    if row.progress_pct >= 100: row.status = "done"
    db.add(row); db.commit(); db.refresh(row); return {c.name: getattr(row, c.name) for c in row.__table__.columns}


@router.patch("/learning/courses/{course_id}")
def course_update(course_id: uuid.UUID, data: dto.CourseUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import Course
    row = owned(db, Course, user.id, course_id)
    changes = data.model_dump(exclude_unset=True)
    add = changes.pop("add_hours", None)
    for key, value in changes.items():
        if key in ("platform", "title", "status", "progress_pct", "hours_spent") and value is None: continue
        setattr(row, key, value)
    if add: row.hours_spent = (row.hours_spent or 0) + add
    if row.progress_pct >= 100: row.status = "done"
    row.updated_at = now_utc(); db.commit(); db.refresh(row); return {c.name: getattr(row, c.name) for c in row.__table__.columns}


@router.delete("/learning/courses/{course_id}", status_code=204)
def course_delete(course_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import Course
    db.delete(owned(db, Course, user.id, course_id)); db.commit()


@router.put("/learning/profiles")
def coding_profile_set(data: dto.CodingProfileIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Link a public username; its stats are read from the site's public data right away."""
    from app.models.entities import CodingProfile
    from app.services import tracking
    row = db.scalar(select(CodingProfile).where(CodingProfile.user_id == user.id, CodingProfile.platform == data.platform))
    if row is None:
        row = CodingProfile(user_id=user.id, platform=data.platform, username=data.username, stats={}, history=[]); db.add(row)
    elif row.username.lower() != data.username.lower():
        row.username, row.history = data.username, []
    tracking.refresh_profile(row, datetime.now(zone(profile_for(db, user).timezone)).date(), force=True)
    db.commit(); db.refresh(row); return tracking.profile_out(row)


@router.post("/learning/profiles/refresh")
def coding_profiles_refresh(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import CodingProfile
    from app.services import tracking
    today = datetime.now(zone(profile_for(db, user).timezone)).date()
    out, errors = [], []
    for row in db.scalars(select(CodingProfile).where(CodingProfile.user_id == user.id)).all():
        try: tracking.refresh_profile(row, today)
        except HTTPException as exc: errors.append(str(exc.detail))
        out.append(tracking.profile_out(row))
    db.commit(); return {"profiles": out, "errors": errors}


@router.delete("/learning/profiles/{profile_id}", status_code=204)
def coding_profile_delete(profile_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import CodingProfile
    db.delete(owned(db, CodingProfile, user.id, profile_id)); db.commit()


# ---------- German & English: daily cards and today's plan ----------

@router.post("/language/daily-cards")
def language_daily_cards(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Add today's 5 new German and 5 new English words to your flashcards (once a day; never repeats a word)."""
    from app.services import language
    today = datetime.now(zone(profile_for(db, user).timezone)).date()
    out = [language.add_daily_cards(db, user.id, lang, today) for lang in ("german", "english")]
    db.commit(); return {"decks": out}


@router.get("/language/today")
def language_today(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """What to do today for German and English, with minutes: cards to review, a video topic, and exam-coach blocks."""
    from app.services import language
    out = language.today_plan(db, user.id, datetime.now(zone(profile_for(db, user).timezone)).date()); db.commit(); return out


# ---------- Day tracker: hour by hour, phone usage, end-of-day report ----------

@router.get("/day/report")
def day_report(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Hour-by-hour view of a day: what you logged, focus, phone usage, tasks/habits/gym, time wasted, and tomorrow's tips."""
    from app.services import smart, tracking
    d = day or datetime.now(zone(profile_for(db, user).timezone)).date()
    out = tracking.day_report(db, user.id, d)
    out["auto"] = smart.auto_entries(db, user.id, d)
    for a in out["auto"]:                     # fill empty hours with what Sakuna already knows happened
        h = int(a["start"][:2])
        for k in range(h, min(24, h + max(1, round(a["minutes"] / 60)))):
            if out["hours"][k]["category"] is None:
                out["hours"][k]["category"], out["hours"][k]["note"] = a["category"], a["note"]
    out["gaps"] = [h["label"] for h in out["hours"] if h["category"] is None and 7 <= h["hour"] <= 21]
    return out


@router.post("/day/report/explain")
def day_report_explain(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import tracking
    from app.services import ai_client
    rep = tracking.day_report(db, user.id, day or datetime.now(zone(profile_for(db, user).timezone)).date())
    cfg = ai_client.settings_for(db, user.id)
    if cfg is not None and not cfg.share_activity:
        return {"text": rep["summary"] + "\n\nTomorrow:\n" + "\n".join(f"- {t}" for t in rep["tomorrow"]) + "\n\n(Your day data isn't shared with AI; written by Sakuna's rules.)"}
    text = tracking.explain_day(db, user.id, rep); db.commit(); return {"text": text}


@router.post("/day/entries", status_code=201)
def day_entry_create(data: dto.TimeEntryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import tracking
    row = tracking.add_entry(db, user.id, data); db.commit(); db.refresh(row)
    return {"id": row.id, "local_date": row.local_date, "start": row.start_time.strftime("%H:%M"), "end": row.end_time.strftime("%H:%M"), "category": row.category, "note": row.note}


@router.delete("/day/entries/{entry_id}", status_code=204)
def day_entry_delete(entry_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import TimeEntry
    db.delete(owned(db, TimeEntry, user.id, entry_id)); db.commit()


@router.put("/day/usage")
def day_usage(data: dto.DeviceUsageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The phone sends one day of screen time (totals and top apps). Replaces that day's numbers."""
    from app.services import tracking
    row = tracking.save_usage(db, user.id, data); db.commit()
    return {"local_date": row.local_date, "total_minutes": row.total_minutes, "distracting_minutes": row.distracting_minutes}


# ---------- Smarter days, money overview, export ----------

@router.get("/today/plan")
def today_plan(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """One plan for today from work hours, routines, gym days, exam study, languages, timed tasks and your best focus hours."""
    from app.core import cache
    from app.services import smart
    return cache.cached(user.id, "today_plan", lambda: smart.today_plan(db, user.id))


@router.get("/insights/week")
def insights_week(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Where the last 7 days went: productive vs wasted per day, worst hours, top time-sink apps, and patterns."""
    from app.services import smart
    return smart.week_insights(db, user.id)


@router.get("/nudge")
def nudge(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A gentle note when today's distracting phone time is high (from the usage the phone sent). Null when all is fine."""
    from app.services import smart
    return {"nudge": smart.nudge(db, user.id)}


@router.get("/finance/all")
def finance_all(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """All-in net worth per currency: accounts, assets, debts and the CSE portfolio, plus monthly subscriptions."""
    from app.services import smart
    return smart.all_in_net_worth(db, user.id)


@router.get("/me/export")
def me_export(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything you've stored, as one JSON file (passwords, tokens and encrypted fields are left out)."""
    from app.services import smart
    audit(db, user.id, "export.all", "user", user.id, {}); out = smart.export_all(db, user.id); db.commit(); return out


@router.get("/brain")
def brain(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Brain gym: BrainGymmer games by skill, today's 5-game workout, and your brain-games streak."""
    from app.services import brain_videos
    return brain_videos.brain_view(db, user.id, datetime.now(zone(profile_for(db, user).timezone)).date())


@router.post("/brain/played")
def brain_played(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """'I played today': logs your Brain games habit (streak + points)."""
    from app.services import brain_videos
    out = brain_videos.played(db, user.id, datetime.now(zone(profile_for(db, user).timezone)).date()); db.commit(); return out


@router.get("/watch")
def watch(channels: str = Query(default="", max_length=600), shorts: bool = False, user: User = Depends(get_current_user)):
    """Latest videos from technology, AI and motivation channels (+ your own), with this week's must-watch picks."""
    from app.services import brain_videos
    return brain_videos.watch([c.strip() for c in channels.split(",") if c.strip()], skip_shorts=not shorts)


@router.get("/watch/channel")
def watch_channel(q: str = Query(min_length=2, max_length=200), user: User = Depends(get_current_user)):
    """Find a YouTube channel id from a link or @handle (to add it to your Watch shelf)."""
    from app.services import brain_videos
    return brain_videos.resolve_channel(q)


@router.get("/career/linkedin")
def career_linkedin(q: str = Query(min_length=2, max_length=200), user: User = Depends(get_current_user)):
    """Ready-made LinkedIn searches (posts, hiring posts, jobs from the last 24 h). LinkedIn doesn't allow scraping."""
    from app.services import brain_videos
    return {"links": brain_videos.linkedin_links(q)}


@router.get("/learning/radar")
def learning_radar(topics: str = Query(default="python,ai,web development", max_length=300), user: User = Depends(get_current_user)):
    """What's new to learn in your topics (Hacker News, dev.to, GitHub), a Wikipedia 'learn today', and free learning tracks."""
    from app.services import learn_radar
    return learn_radar.radar([t for t in topics.replace(";", ",").split(",")])


@router.get("/career/jobs/summary")
def jobs_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return job_summary(db, user.id)


@router.post("/career/jobs", response_model=dto.JobOut, status_code=201)
def job_create(data: dto.JobIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = JobApplication(user_id=user.id, updated_at=now_utc(), **data.model_dump())
    if row.status != "draft" and row.applied_at is None:
        row.applied_at = datetime.now(zone(profile_for(db, user).timezone)).date()
    db.add(row); db.commit(); db.refresh(row); return row


@router.patch("/career/jobs/{job_id}", response_model=dto.JobOut)
def job_update(job_id: uuid.UUID, data: dto.JobUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, JobApplication, user.id, job_id)
    changes = data.model_dump(exclude_unset=True)
    for key, value in changes.items():
        if key in ("company", "role", "status") and value is None:
            continue
        setattr(row, key, value)
    if changes.get("status") == "applied" and row.applied_at is None:
        row.applied_at = datetime.now(zone(profile_for(db, user).timezone)).date()
    row.updated_at = now_utc(); db.commit(); db.refresh(row); return row
