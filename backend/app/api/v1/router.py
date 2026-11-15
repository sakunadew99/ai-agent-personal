import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import hmac
from typing import Literal

from fastapi.responses import RedirectResponse
from fastapi import APIRouter, Depends, Header, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, owned, query_user
from app.core.security import (
    create_access_token, hash_password, hash_token, new_refresh_token, verify_password,
)
from app.models.entities import (
    Approval, Asset, CaptureItem, CheckinLog, CheckinSetting, Conversation,
    Expense, FocusSession, FreelanceProject, Goal, Habit, HabitLog, HealthRecord,
    Income, JobApplication, Liability, LifeEntry, Memory, Message, Notification,
    PlanItem, RefreshToken, SleepRecord, Task, User, UserProfile, Workout, CareerProfile, GoalMilestone,
    Flashcard, Mistake, Quest, Treat, CapturedCommand, StudyProgram, ProgramRequirement, StudyCost, Scholarship, CoachSuggestion, LifeArea, AreaEntry, VaultDocument, FinancialAccount, AccountAdjustment, Envelope, WishlistItem, PriceNote, BuyListItem,
)
from app.schemas import dto
from app.services.actions import (
    complete_task, create_daily_plan, create_expense, create_goal, create_income,
    create_task, resolve_approval, update_goal, update_task,
)
from app.services.assistant import converse
from app.services.capture import parse_capture
from app.services.finance import Flow, Balance, month_bounds, summarize
from app.services.memory import delete_memory, save_memory, search_memories, update_memory
from app.services.ai_client import transcribe_audio
from app.services.permissions import seed_user_defaults
from app.services.learning import (
    clean_deck, create_card, due_cards, import_cards, job_summary, learning_stats, mistake_again, mistake_to_card, review_card,
)
from app.services import balance, coach, commands, game, gcalendar, goal_engine, google_oauth, study, vault
from app.services import focus as focus_svc
from app.services.audit import audit
from app.services import money as money_svc
from app.services.time_engine import insights as time_insights
from app.services.schedule import create_milestone, list_milestones, month_view, update_milestone, upcoming_reminders
from app.core.clock import as_utc, now_utc, zone

router = APIRouter()


def commit(db: Session):
    db.commit()


def profile_for(db: Session, user: User) -> UserProfile:
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    if profile is None:
        raise HTTPException(500, "User profile is missing")
    return profile


def finance_summary(db: Session, user: User, month: str | None = None):
    profile = profile_for(db, user)
    tz = zone(profile.timezone)
    start, end, month_name = month_bounds(month, tz)
    income_rows = db.scalars(select(Income).where(Income.user_id == user.id, Income.received_at >= start, Income.received_at < end)).all()
    expense_rows = db.scalars(select(Expense).where(Expense.user_id == user.id, Expense.spent_at >= start, Expense.spent_at < end)).all()
    assets = db.scalars(select(Asset).where(Asset.user_id == user.id)).all()
    # Assets/liabilities can be recorded independently; this project currently exposes
    # asset and liability creation through the balance endpoints below.
    from app.models.entities import Liability
    liabilities = db.scalars(select(Liability).where(Liability.user_id == user.id)).all()
    values = summarize(
        [Flow(r.amount, r.currency, r.record_kind, r.source) for r in income_rows],
        [Flow(r.amount, r.currency, r.record_kind, category=r.category, scope=r.scope) for r in expense_rows],
        [Balance(r.value, r.currency, r.record_kind) for r in assets],
        [Balance(r.balance, r.currency, r.record_kind) for r in liabilities],
        profile.currency,
    )
    target = profile.financial_target_amount
    progress = None if not target else (values["net_worth"] / target * Decimal(100)).quantize(Decimal("0.01"))
    return {**values, "month": month_name, "target_amount": target, "target_progress_percent": progress,
            "notice": "Amounts in other currencies are excluded; no exchange rates are applied."}


@router.post("/auth/register", response_model=dto.TokenPair, status_code=201)
def register(data: dto.RegisterIn, db: Session = Depends(get_db)):
    if not settings.registration_open:
        raise HTTPException(403, "New sign-ups are closed on this server. Sign in with your existing account.")
    if db.scalar(select(User).where(User.email == data.email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=data.email, full_name=data.full_name.strip(), password_hash=hash_password(data.password))
    db.add(user)
    db.flush()
    seed_user_defaults(db, user)
    token = new_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=hash_token(token), expires_at=now_utc() + timedelta(days=14)))
    db.commit()
    db.refresh(user)
    return dto.TokenPair(access_token=create_access_token(user.id), refresh_token=token, user=user)


@router.post("/auth/login", response_model=dto.TokenPair)
def login(data: dto.LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.strip().lower()))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    refresh = new_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=hash_token(refresh), expires_at=now_utc() + timedelta(days=14)))
    db.commit()
    return dto.TokenPair(access_token=create_access_token(user.id), refresh_token=refresh, user=user)


@router.post("/auth/refresh", response_model=dto.TokenPair)
def refresh_token(data: dto.RefreshIn, db: Session = Depends(get_db)):
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(data.refresh_token)))
    if row is None or row.revoked_at is not None or as_utc(row.expires_at) <= now_utc():
        raise HTTPException(401, "Invalid or expired refresh token")
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise HTTPException(401, "Invalid refresh token")
    row.revoked_at = now_utc()
    replacement = new_refresh_token()
    new_row = RefreshToken(user_id=user.id, token_hash=hash_token(replacement), expires_at=now_utc() + timedelta(days=14))
    db.add(new_row)
    db.flush()
    row.replaced_by = new_row.id
    db.commit()
    return dto.TokenPair(access_token=create_access_token(user.id), refresh_token=replacement, user=user)


@router.post("/auth/logout", status_code=204)
def logout(data: dto.RefreshIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = db.scalar(select(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.token_hash == hash_token(data.refresh_token)))
    if row:
        row.revoked_at = now_utc()
        db.commit()


@router.get("/me", response_model=dto.MeOut)
def me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"user": user, "profile": profile_for(db, user)}


@router.patch("/profile", response_model=dto.MeOut)
def update_profile(data: dto.ProfileUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = profile_for(db, user)
    changes = data.model_dump(exclude_unset=True)
    if "full_name" in changes:
        user.full_name = changes.pop("full_name")
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = now_utc()
    db.commit()
    return {"user": user, "profile": row}


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = profile_for(db, user)
    today = datetime.now(zone(profile.timezone)).date()
    tasks = db.scalars(select(Task).where(Task.user_id == user.id, Task.status.notin_(["done", "cancelled"])).order_by(Task.due_at.asc().nullslast()).limit(8)).all()
    goals = db.scalars(select(Goal).where(Goal.user_id == user.id, Goal.status == "active").order_by(Goal.due_date.asc().nullslast()).limit(5)).all()
    habits = db.scalars(select(Habit).where(Habit.user_id == user.id, Habit.active.is_(True)).order_by(Habit.name).limit(12)).all()
    habit_logs = db.scalars(select(HabitLog).where(HabitLog.user_id == user.id, HabitLog.logged_on >= today - timedelta(days=6), HabitLog.completed.is_(True))).all()
    health_records = db.scalars(select(HealthRecord).where(HealthRecord.user_id == user.id).order_by(HealthRecord.recorded_at.desc()).limit(40)).all()
    sleep_records = db.scalars(select(SleepRecord).where(SleepRecord.user_id == user.id).order_by(SleepRecord.start_at.desc()).limit(7)).all()
    workouts = db.scalars(select(Workout).where(Workout.user_id == user.id).order_by(Workout.started_at.desc()).limit(7)).all()
    from app.models.entities import DailyPlan
    plan = db.scalar(select(DailyPlan).where(DailyPlan.user_id == user.id, DailyPlan.plan_date == today))
    day_start = as_utc(datetime.combine(today, datetime.min.time(), tzinfo=zone(profile.timezone)))
    day_end = day_start + timedelta(days=1)
    open_count = db.scalar(select(func.count(Task.id)).where(Task.user_id == user.id, Task.status.notin_(["done", "cancelled"]))) or 0
    completed_today = db.scalar(select(func.count(Task.id)).where(Task.user_id == user.id, Task.status == "done", Task.completed_at >= day_start, Task.completed_at < day_end)) or 0
    return {"date": today, "full_name": user.full_name, "tasks": tasks, "goals": goals, "plan": plan, "finance": finance_summary(db, user),
            "habits": habits, "habit_logs": habit_logs, "health_records": health_records, "sleep": sleep_records, "workouts": workouts,
            "task_counts": {"open": open_count, "completed_today": completed_today}}


@router.get("/dashboard/summary")
def dashboard_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return dashboard(db, user)


@router.post("/tasks", response_model=dto.TaskOut, status_code=201)
def task_create(data: dto.TaskIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = create_task(db, user.id, data); db.commit(); db.refresh(row); return row


@router.get("/tasks", response_model=list[dto.TaskOut])
def task_list(status_filter: str | None = Query(None, alias="status"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = query_user(db, Task, user.id)
    if status_filter: statement = statement.where(Task.status == status_filter)
    return list(db.scalars(statement.order_by(Task.due_at.asc().nullslast(), Task.created_at.desc())).all())


@router.patch("/tasks/{task_id}", response_model=dto.TaskOut)
def task_update(task_id: uuid.UUID, data: dto.TaskUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Task, user.id, task_id); update_task(db, row, data); db.commit(); db.refresh(row); return row


@router.patch("/tasks/{task_id}/complete", response_model=dto.TaskOut)
def task_complete(task_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Task, user.id, task_id); complete_task(db, row); db.commit(); db.refresh(row); return row


@router.delete("/tasks/{task_id}", status_code=204)
def task_delete(task_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Task, user.id, task_id); db.delete(row); db.commit()


@router.post("/goals", response_model=dto.GoalOut, status_code=201)
def goal_create(data: dto.GoalIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = create_goal(db, user.id, data); db.commit(); db.refresh(row); return row


@router.get("/goals", response_model=list[dto.GoalOut])
def goal_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, Goal, user.id).order_by(Goal.due_date.asc().nullslast())).all())


@router.patch("/goals/{goal_id}", response_model=dto.GoalOut)
def goal_update(goal_id: uuid.UUID, data: dto.GoalUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Goal, user.id, goal_id); update_goal(db, row, data); db.commit(); db.refresh(row); return row


@router.delete("/goals/{goal_id}", status_code=204)
def goal_delete(goal_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Goal, user.id, goal_id)); db.commit()


@router.get("/milestones", response_model=list[dto.MilestoneOut])
def milestone_list(goal_id: uuid.UUID | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list_milestones(db, user.id, goal_id)


@router.get("/goals/{goal_id}/milestones", response_model=list[dto.MilestoneOut])
def goal_milestones(goal_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list_milestones(db, user.id, goal_id)


@router.post("/goals/{goal_id}/milestones", response_model=dto.MilestoneOut, status_code=201)
def milestone_create(goal_id: uuid.UUID, data: dto.MilestoneIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = create_milestone(db, user.id, goal_id, data); db.commit(); db.refresh(row); return row


@router.patch("/milestones/{milestone_id}", response_model=dto.MilestoneOut)
def milestone_update(milestone_id: uuid.UUID, data: dto.MilestoneUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, GoalMilestone, user.id, milestone_id); update_milestone(db, row, data); db.commit(); db.refresh(row); return row


@router.delete("/milestones/{milestone_id}", status_code=204)
def milestone_delete(milestone_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, GoalMilestone, user.id, milestone_id)); db.commit()


@router.get("/reminders/upcoming")
def reminders_upcoming(days: int = Query(7, ge=1, le=31), lead_minutes: int = Query(10, ge=0, le=1440),
                       db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    data = upcoming_reminders(db, user.id, days, lead_minutes)
    data["items"] = [dto.ReminderOut(**item) for item in data["items"]]
    return data


@router.post("/memories", response_model=dto.MemoryOut, status_code=201)
def memory_create(data: dto.MemoryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = save_memory(db, user.id, data.content, data.category, "user", data.allow_sensitive, data.pinned,
                      intent_type=data.intent_type, check_duplicates=not data.allow_duplicate)
    game.on_memory_saved(db, row)
    db.commit(); db.refresh(row); return row


@router.get("/memories/resurface")
def memory_resurface_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Interests/intentions worth bringing back gently (at most 2; nothing is changed by reading)."""
    from app.services.second_brain import ASK_KEEP_AFTER, resurface_candidates
    return [{**dto.MemoryOut.model_validate(row).model_dump(mode="json"), "ask_keep": row.surface_count >= ASK_KEEP_AFTER}
            for row in resurface_candidates(db, user.id)]


@router.post("/memories/{memory_id}/resurface")
def memory_resurface_act(memory_id: uuid.UUID, data: dto.ResurfaceAction, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """plan: propose a first small step (approval flow); later: snooze with back-off; dismiss: never ask again; keep: restart."""
    from app.services import second_brain
    from app.services.actions import queue_or_run
    row = owned(db, Memory, user.id, memory_id)
    outcome = None
    if data.action == "plan":
        outcome = queue_or_run(db, user, "create_task", {
            "title": second_brain.first_step_title(row), "priority": "low", "category": "personal", "duration_minutes": 20,
            "notes": f"From your second brain: {row.content[:500]}",
        }, f"Plan a first step for: {row.topic or row.content[:60]}")
        row.planned_at = now_utc()
    elif data.action == "later":
        second_brain.snooze(row)
    elif data.action == "dismiss":
        second_brain.dismiss(row)
    else:
        second_brain.keep(row)
    db.commit(); db.refresh(row)
    return {"memory": dto.MemoryOut.model_validate(row).model_dump(mode="json"), "outcome": outcome}


@router.get("/memories", response_model=list[dto.MemoryOut])
def memory_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, Memory, user.id).order_by(Memory.pinned.desc(), Memory.updated_at.desc())).all())


@router.post("/memories/search", response_model=list[dto.MemoryOut])
def memory_search(data: dto.MemorySearchIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return search_memories(db, user.id, data.query, data.limit)


@router.patch("/memories/{memory_id}", response_model=dto.MemoryOut)
def memory_update(memory_id: uuid.UUID, data: dto.MemoryUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Memory, user.id, memory_id); update_memory(db, row, data.content, data.category, data.pinned, data.allow_sensitive, intent_type=data.intent_type); db.commit(); db.refresh(row); return row


@router.delete("/memories/{memory_id}", status_code=204)
def memory_delete(memory_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    delete_memory(db, owned(db, Memory, user.id, memory_id)); db.commit()


@router.post("/capture", response_model=dto.CaptureOut, status_code=201)
def capture(data: dto.CaptureIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    today = datetime.now(zone(profile_for(db, user).timezone)).date()
    parsed = parse_capture(data.text, today)
    row = CaptureItem(user_id=user.id, raw_text=data.text, classified_type=parsed["classified_type"], extracted=parsed, status="needs_confirmation" if parsed.get("ambiguous") else "pending")
    db.add(row); db.commit(); db.refresh(row); return row


@router.get("/capture", response_model=list[dto.CaptureOut])
def capture_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, CaptureItem, user.id).order_by(CaptureItem.created_at.desc())).all())


@router.post("/capture/{capture_id}/confirm", response_model=dto.CaptureOut)
def capture_confirm(capture_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, CaptureItem, user.id, capture_id)
    if row.status not in {"pending", "needs_confirmation"}:
        raise HTTPException(409, "Capture item has already been processed")
    if row.classified_type == "expense":
        raise HTTPException(422, "Confirm an expense using the finance form so currency and category are explicit")
    if row.classified_type == "note":
        save_memory(db, user.id, row.raw_text, "note", "capture", False)
        row.status = "saved"
        row.task_id = None
    else:
        due = None
        extracted = row.extracted or {}
        if extracted.get("date"):
            due = __import__("app.services.actions", fromlist=["combine_local"]).combine_local(
                db, user.id, date.fromisoformat(extracted["date"]), extracted.get("suggested_time", "09:00")
            )
        task = create_task(db, user.id, dto.TaskIn(
            title=extracted.get("title") or row.raw_text[:200], category=extracted.get("category", "personal"),
            duration_minutes=extracted.get("duration_minutes") or 30, due_at=due, notes=row.raw_text,
        ))
        row.task_id = task.id
        row.status = "processed"
    db.commit(); db.refresh(row); return row


@router.post("/planner/generate", response_model=dto.DailyPlanOut)
def planner_generate(data: dto.GeneratePlanIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    day = data.plan_date or datetime.now(zone(profile_for(db, user).timezone)).date()
    plan = create_daily_plan(db, user, day); db.commit(); db.refresh(plan)
    items = list(db.scalars(select(PlanItem).where(PlanItem.plan_id == plan.id).order_by(PlanItem.starts_at)).all())
    return {"id": plan.id, "plan_date": plan.plan_date, "summary": plan.summary, "conflicts": plan.meta.get("conflicts", []), "unscheduled": plan.meta.get("unscheduled", []), "items": items}


@router.get("/planner/daily", response_model=dto.DailyPlanOut)
def planner_daily(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    selected = day or datetime.now(zone(profile_for(db, user).timezone)).date()
    from app.models.entities import DailyPlan
    plan = db.scalar(select(DailyPlan).where(DailyPlan.user_id == user.id, DailyPlan.plan_date == selected))
    if plan is None: return planner_generate(dto.GeneratePlanIn(plan_date=selected), db, user)
    items = list(db.scalars(select(PlanItem).where(PlanItem.plan_id == plan.id).order_by(PlanItem.starts_at)).all())
    return {"id": plan.id, "plan_date": plan.plan_date, "summary": plan.summary, "conflicts": plan.meta.get("conflicts", []), "unscheduled": plan.meta.get("unscheduled", []), "items": items}


@router.get("/planner/weekly")
def planner_weekly(start: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    start = start or datetime.now(zone(profile_for(db, user).timezone)).date()
    return [planner_daily(start + timedelta(days=i), db, user) for i in range(7)]


@router.get("/planner/monthly")
def planner_monthly(month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return month_view(db, user.id, month)


@router.patch("/planner/items/{item_id}", response_model=dto.PlanItemOut)
def planner_item_update(item_id: uuid.UUID, data: dto.PlanItemUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, PlanItem, user.id, item_id)
    changes = data.model_dump(exclude_unset=True)
    if "starts_at" in changes and "ends_at" not in changes and changes["starts_at"] >= row.ends_at: raise HTTPException(422, "Start must be before end")
    if "ends_at" in changes and changes["ends_at"] <= changes.get("starts_at", row.starts_at): raise HTTPException(422, "End must be after start")
    for key, value in changes.items(): setattr(row, key, value)
    db.commit(); db.refresh(row); return row


@router.post("/finance/income", response_model=dto.MoneyOut, status_code=201)
def income_create(data: dto.IncomeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = create_income(db, user.id, data); db.commit(); db.refresh(row); return {"id": row.id, "amount": row.amount, "currency": row.currency, "record_kind": row.record_kind, "notes": row.notes, "occurred_at": row.received_at, "label": row.source}


@router.post("/finance/expenses", response_model=dto.MoneyOut, status_code=201)
def expense_create(data: dto.ExpenseIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = create_expense(db, user.id, data); db.commit(); db.refresh(row); return {"id": row.id, "amount": row.amount, "currency": row.currency, "record_kind": row.record_kind, "notes": row.notes, "occurred_at": row.spent_at, "label": row.category}


@router.get("/finance/summary", response_model=dto.FinanceSummary)
def finance_get(month: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return finance_summary(db, user, month)


@router.get("/finance/reports")
def finance_reports(month: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return finance_summary(db, user, month)


@router.post("/health/records", status_code=201)
def health_create(data: dto.HealthMetricIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = HealthRecord(user_id=user.id, metric=data.metric, value=data.value, unit=data.unit, recorded_at=as_utc(data.recorded_at or now_utc()), source=data.source)
    db.add(row); db.flush(); game.on_health_record(db, row); db.commit(); db.refresh(row); return row


@router.get("/health/summary")
def health_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    records = db.scalars(select(HealthRecord).where(HealthRecord.user_id == user.id).order_by(HealthRecord.recorded_at.desc()).limit(100)).all()
    workouts = db.scalars(select(Workout).where(Workout.user_id == user.id).order_by(Workout.started_at.desc()).limit(20)).all()
    sleep = db.scalars(select(SleepRecord).where(SleepRecord.user_id == user.id).order_by(SleepRecord.start_at.desc()).limit(14)).all()
    return {"records": records, "workouts": workouts, "sleep": sleep}


@router.post("/health/sleep", status_code=201)
def sleep_create(data: dto.SleepIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if data.end_at <= data.start_at: raise HTTPException(422, "Sleep end must be after start")
    row = SleepRecord(user_id=user.id, start_at=as_utc(data.start_at), end_at=as_utc(data.end_at), duration_minutes=int((data.end_at-data.start_at).total_seconds()/60), stages=data.stages, source=data.source)
    db.add(row); db.flush(); game.on_sleep(db, row); db.commit(); db.refresh(row); return row


@router.post("/health/workouts", status_code=201)
def workout_create(data: dto.WorkoutIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = Workout(user_id=user.id, activity=data.activity, duration_minutes=data.duration_minutes, calories=data.calories, started_at=as_utc(data.started_at or now_utc()), notes=data.notes, source=data.source)
    db.add(row); db.flush(); game.on_workout(db, row); db.commit(); db.refresh(row); return row


@router.get("/health/sleep")
def sleep_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(select(SleepRecord).where(SleepRecord.user_id == user.id).order_by(SleepRecord.start_at.desc()).limit(100)).all())


@router.get("/health/activity")
def activity_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(select(HealthRecord).where(HealthRecord.user_id == user.id).order_by(HealthRecord.recorded_at.desc()).limit(250)).all())


@router.get("/health/workouts")
def workout_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(select(Workout).where(Workout.user_id == user.id).order_by(Workout.started_at.desc()).limit(100)).all())


@router.post("/finance/assets", status_code=201)
def asset_create(data: dto.BalanceIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = Asset(user_id=user.id, name=data.name, category=data.category, value=data.amount, currency=data.currency, record_kind=data.record_kind)
    db.add(row); db.commit(); db.refresh(row); return row


@router.post("/finance/liabilities", status_code=201)
def liability_create(data: dto.BalanceIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = Liability(user_id=user.id, name=data.name, category=data.category, balance=data.amount, currency=data.currency, record_kind=data.record_kind)
    db.add(row); db.commit(); db.refresh(row); return row


@router.get("/career/profile")
def career_profile_get(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalar(select(CareerProfile).where(CareerProfile.user_id == user.id))


@router.put("/career/profile")
def career_profile_update(data: dto.CareerProfileIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = db.scalar(select(CareerProfile).where(CareerProfile.user_id == user.id))
    if row is None: row = CareerProfile(user_id=user.id); db.add(row)
    for key, value in data.model_dump().items(): setattr(row, key, value)
    db.commit(); db.refresh(row); return row


@router.get("/career/jobs", response_model=list[dto.JobOut])
def jobs_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, JobApplication, user.id).order_by(JobApplication.created_at.desc())).all())


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


@router.delete("/career/jobs/{job_id}", status_code=204)
def job_delete(job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, JobApplication, user.id, job_id)); db.commit()


# ---------- Whole-life balance (guide 20): weekly target vs actual per area ----------

@router.get("/balance")
def balance_view(week: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = balance.view(db, user.id, week); db.commit(); return out


@router.post("/balance/areas", status_code=201)
def balance_area_create(data: dto.AreaIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    balance.add_area(db, user.id, data.name, data.unit, data.weekly_target); db.commit(); return balance.view(db, user.id)


@router.patch("/balance/areas/{area_id}")
def balance_area_update(area_id: uuid.UUID, data: dto.AreaUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, LifeArea, user.id, area_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is not None: setattr(row, key, value.strip() if isinstance(value, str) else value)
    balance.touch(row); db.commit(); return balance.view(db, user.id)


@router.post("/balance/areas/{area_id}/log", status_code=201)
def balance_area_log(area_id: uuid.UUID, data: dto.AreaLogIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    entry = balance.log_entry(db, owned(db, LifeArea, user.id, area_id), data.amount, data.note); db.commit()
    return {"id": entry.id, "view": balance.view(db, user.id)}


@router.delete("/balance/entries/{entry_id}", status_code=204)
def balance_entry_delete(entry_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, AreaEntry, user.id, entry_id)); db.commit()


# ---------- Document vault: details and expiry, never files; numbers encrypted ----------

@router.get("/vault")
def vault_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return vault.overview(db, user.id)


@router.post("/vault/documents", status_code=201)
def vault_create(data: dto.DocumentIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    values = data.model_dump(exclude={"number"})
    if values.get("renew_lead_days") is None: values["renew_lead_days"] = vault.LEAD_DAYS.get(data.kind, 30)
    row = VaultDocument(user_id=user.id, **values)
    vault.set_number(row, data.number)
    db.add(row); db.flush(); audit(db, user.id, "vault.create", "vault_document", row.id, {"kind": row.kind})
    db.commit(); db.refresh(row)
    return vault.out(row, datetime.now(zone(profile_for(db, user).timezone)).date())


@router.patch("/vault/documents/{doc_id}")
def vault_update(doc_id: uuid.UUID, data: dto.DocumentUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, VaultDocument, user.id, doc_id)
    changes = data.model_dump(exclude_unset=True)
    if "number" in changes: vault.set_number(row, changes.pop("number") or "")
    for key, value in changes.items():
        if key in ("name", "kind", "renew_lead_days") and value is None: continue
        setattr(row, key, value)
    row.updated_at = now_utc(); db.commit(); db.refresh(row)
    return vault.out(row, datetime.now(zone(profile_for(db, user).timezone)).date())


@router.delete("/vault/documents/{doc_id}", status_code=204)
def vault_delete(doc_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, VaultDocument, user.id, doc_id); audit(db, user.id, "vault.delete", "vault_document", row.id); db.delete(row); db.commit()


@router.post("/vault/documents/{doc_id}/reveal")
def vault_reveal(doc_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    value = vault.reveal(db, owned(db, VaultDocument, user.id, doc_id)); db.commit(); return {"number": value}


@router.post("/vault/documents/{doc_id}/reminder", status_code=201)
def vault_reminder(doc_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = vault.add_reminder(db, owned(db, VaultDocument, user.id, doc_id)); db.commit(); return {"task_id": task.id, "title": task.title, "due_at": task.due_at}


# ---------- Study abroad planner (guide 39). Never submits, pays or contacts anyone. ----------

@router.get("/study")
def study_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return study.overview(db, user.id)


@router.get("/study/programs", response_model=list[dto.ProgramOut])
def study_programs(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, StudyProgram, user.id).order_by(StudyProgram.deadline.asc().nullslast(), StudyProgram.created_at)).all())


@router.post("/study/programs", response_model=dto.ProgramOut, status_code=201)
def study_program_create(data: dto.ProgramIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = StudyProgram(user_id=user.id, **data.model_dump()); db.add(row); db.commit(); db.refresh(row); return row


@router.patch("/study/programs/{program_id}", response_model=dto.ProgramOut)
def study_program_update(program_id: uuid.UUID, data: dto.ProgramUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, StudyProgram, user.id, program_id)
    changes = data.model_dump(exclude_unset=True)
    verified = changes.pop("verified", None)
    for key, value in changes.items():
        if key in ("country", "university", "course", "stage") and value is None: continue
        setattr(row, key, value)
    study.mark_verified(row) if verified else study.touch(row)
    db.commit(); db.refresh(row); return row


@router.delete("/study/programs/{program_id}", status_code=204)
def study_program_delete(program_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, StudyProgram, user.id, program_id)); db.commit()


@router.post("/study/programs/{program_id}/checklist", response_model=list[dto.RequirementOut])
def study_checklist(program_id: uuid.UUID, data: dto.ChecklistIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = study.build_checklist(db, owned(db, StudyProgram, user.id, program_id), data.create_tasks, data.portfolio); db.commit(); return rows


@router.get("/study/programs/{program_id}/requirements", response_model=list[dto.RequirementOut])
def study_requirements(program_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    owned(db, StudyProgram, user.id, program_id)
    return list(db.scalars(select(ProgramRequirement).where(ProgramRequirement.user_id == user.id, ProgramRequirement.program_id == program_id)
                           .order_by(ProgramRequirement.due_date.asc().nullslast())).all())


@router.patch("/study/requirements/{req_id}", response_model=dto.RequirementOut)
def study_requirement_update(req_id: uuid.UUID, data: dto.RequirementUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, ProgramRequirement, user.id, req_id)
    changes = data.model_dump(exclude_unset=True)
    if changes.get("status") in ("done", "todo"): study.requirement_done(db, row, changes["status"] == "done")
    elif changes.get("status") == "na": row.status = "na"
    if "due_date" in changes: row.due_date = changes["due_date"]
    if "notes" in changes: row.notes = changes["notes"]
    study.touch(row); db.commit(); db.refresh(row); return row


@router.get("/study/programs/{program_id}/costs")
def study_costs(program_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return study.cost_plan(db, owned(db, StudyProgram, user.id, program_id))


@router.post("/study/programs/{program_id}/costs", status_code=201)
def study_cost_add(program_id: uuid.UUID, data: dto.StudyCostIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    program = owned(db, StudyProgram, user.id, program_id)
    db.add(StudyCost(user_id=user.id, program_id=program.id, **data.model_dump())); db.commit()
    return study.cost_plan(db, program)


@router.delete("/study/costs/{cost_id}", status_code=204)
def study_cost_delete(cost_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, StudyCost, user.id, cost_id)); db.commit()


@router.post("/study/programs/{program_id}/fund-goal", response_model=dto.GoalOut, status_code=201)
def study_fund_goal(program_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    goal = study.create_fund_goal(db, owned(db, StudyProgram, user.id, program_id)); db.commit(); db.refresh(goal); return goal


@router.get("/study/scholarships", response_model=list[dto.ScholarshipOut])
def study_scholarships(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, Scholarship, user.id).order_by(Scholarship.deadline.asc().nullslast())).all())


@router.post("/study/scholarships", response_model=dto.ScholarshipOut, status_code=201)
def study_scholarship_create(data: dto.ScholarshipIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    values = data.model_dump()
    if values.get("program_id"): owned(db, StudyProgram, user.id, values["program_id"])
    values["currency"] = values["currency"].upper() if values.get("currency") else None
    row = Scholarship(user_id=user.id, **values); db.add(row); db.commit(); db.refresh(row); return row


@router.patch("/study/scholarships/{sch_id}", response_model=dto.ScholarshipOut)
def study_scholarship_update(sch_id: uuid.UUID, data: dto.ScholarshipUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Scholarship, user.id, sch_id)
    changes = data.model_dump(exclude_unset=True)
    verified = changes.pop("verified", None)
    for key, value in changes.items():
        if key in ("name", "status") and value is None: continue
        setattr(row, key, value)
    study.mark_verified(row) if verified else study.touch(row)
    db.commit(); db.refresh(row); return row


@router.delete("/study/scholarships/{sch_id}", status_code=204)
def study_scholarship_delete(sch_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Scholarship, user.id, sch_id)); db.commit()


# ---------- Coach moments (guide 26): code finds patterns, you choose ----------

@router.get("/coach")
def coach_today(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = coach.today_view(db, user.id); db.commit(); return out


@router.post("/coach/checkin")
def coach_checkin(data: dto.DailyCheckinIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _row, distress = coach.checkin(db, user.id, data.energy, data.mood, data.win, data.note); db.commit()
    return {"saved": True, "care": coach.CARE if distress else None}


@router.post("/coach/suggestions/{suggestion_id}/decide")
def coach_decide(suggestion_id: uuid.UUID, data: dto.CoachDecideIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = coach.decide(db, owned(db, CoachSuggestion, user.id, suggestion_id), data.option_id, data.helpful); db.commit(); return result


@router.patch("/coach/settings")
def coach_settings_update(data: dto.CoachSettingsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cfg = coach.settings_for(db, user.id)
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is not None: setattr(cfg, key, sorted(set(value)) if key == "muted_kinds" else value)
    cfg.updated_at = now_utc(); db.commit()
    return {"tone": cfg.tone, "daily_cap": cfg.daily_cap, "muted_kinds": cfg.muted_kinds}


@router.get("/coach/history")
def coach_history(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return coach.history(db, user.id, days)


# ---------- "Say it once" commands (guide 34): text or voice -> task, one question if unclear, Undo ----------

@router.post("/commands", status_code=201)
def command_create(data: dto.CommandIn, idempotency_key: str | None = Header(default=None, max_length=100),
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cmd = commands.start(db, user.id, data.text, data.source, data.idempotency_key or idempotency_key); db.commit(); db.refresh(cmd)
    return commands.to_out(cmd)


@router.get("/commands")
def commands_list(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(query_user(db, CapturedCommand, user.id).order_by(CapturedCommand.created_at.desc()).limit(limit)).all()
    return [commands.to_out(r) for r in rows]


@router.post("/commands/{command_id}/answer")
def command_answer(command_id: uuid.UUID, data: dto.CommandAnswerIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cmd = commands.answer(db, owned(db, CapturedCommand, user.id, command_id), data.answer); db.commit(); db.refresh(cmd)
    return commands.to_out(cmd)


@router.post("/commands/{command_id}/undo")
def command_undo(command_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cmd = commands.undo(db, owned(db, CapturedCommand, user.id, command_id)); db.commit(); db.refresh(cmd)
    return commands.to_out(cmd)


@router.delete("/commands/{command_id}/text")
def command_forget_text(command_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cmd = owned(db, CapturedCommand, user.id, command_id)
    cmd.raw_text = None  # what you said is erased; the task it created stays
    db.commit(); return {"forgotten": True}


# ---------- AI controls and usage meter (guide 27.3-27.4) ----------

def _ai_view(db: Session, user: User) -> dict:
    from app.models.entities import AiUsage
    from app.services import ai_client
    cfg = ai_client.settings_for(db, user.id)
    totals = ai_client.usage_totals(db, user.id)
    month_rows = db.execute(select(AiUsage.feature, func.sum(AiUsage.input_tokens + AiUsage.output_tokens), func.count(),
                                   func.sum(AiUsage.estimated_cost_usd))
                            .where(AiUsage.user_id == user.id, AiUsage.created_at >= totals["month_start"]).group_by(AiUsage.feature)).all()
    by_group: dict[str, dict] = {}
    for feature, tokens, calls, cost in month_rows:
        g = by_group.setdefault(ai_client.feature_group(feature), {"tokens": 0, "calls": 0, "cost_usd": Decimal("0")})
        g["tokens"] += int(tokens or 0); g["calls"] += int(calls or 0); g["cost_usd"] += Decimal(cost or 0)
    days = db.execute(select(AiUsage.created_at, AiUsage.input_tokens + AiUsage.output_tokens)
                      .where(AiUsage.user_id == user.id, AiUsage.created_at >= totals["week_start"])).all()
    series: dict[str, int] = {}
    for when, tokens in days:
        key = as_utc(when).date().isoformat()
        series[key] = series.get(key, 0) + int(tokens or 0)
    settings_out = {
        "ai_off": bool(cfg and cfg.ai_off), "daily_token_cap": cfg.daily_token_cap if cfg else None,
        "monthly_token_cap": cfg.monthly_token_cap if cfg else None, "monthly_cost_cap_usd": cfg.monthly_cost_cap_usd if cfg else None,
        "disabled_features": list(cfg.disabled_features or []) if cfg else [], "share_money": bool(cfg and cfg.share_money),
        "share_health": bool(cfg and cfg.share_health),
    }
    blocked = ai_client.gate(db, user.id, "general")
    return {
        "key_configured": ai_client.ai_enabled(), "settings": settings_out,
        "status": "no_key" if not ai_client.ai_enabled() else "blocked" if blocked else "on", "blocked_reason": blocked,
        "last_block": ai_client.block_reason(user.id),
        "today": totals["today"], "month": totals["month"], "by_feature": by_group, "last_14_days": dict(sorted(series.items())),
        "groups": ai_client.GROUP_LABELS, "cost_known": any(r[3] for r in month_rows),
        "what_ai_can_see": [
            "Your message and recent messages in that chat",
            "Task titles, goal titles and counts",
            "Saved memories marked non-sensitive that match your question",
            "Money totals" + ("" if settings_out["share_money"] else " — NOT shared (answered by rules instead)"),
            "Health data" + (" (only if you ask about it)" if settings_out["share_health"] else " — NOT shared"),
            "Unusual voice-command text, only when the built-in rules can't understand it",
        ],
        "never_sent": ["Passwords, tokens and keys", "Sensitive memories", "Google/Gmail tokens", "Bank details"],
    }


@router.get("/ai/usage")
def ai_usage(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _ai_view(db, user)


@router.patch("/ai/settings")
def ai_settings_update(data: dto.AiSettingsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import AiSettings
    from app.services import ai_client
    cfg = ai_client.settings_for(db, user.id)
    if cfg is None:
        cfg = AiSettings(user_id=user.id, disabled_features=[]); db.add(cfg)
    changes = data.model_dump(exclude_unset=True)
    for key in ("daily_token_cap", "monthly_token_cap", "monthly_cost_cap_usd"):
        if key in changes:
            setattr(cfg, key, changes.pop(key) or None)   # 0 or null = no cap
    for key, value in changes.items():
        if value is not None: setattr(cfg, key, list(dict.fromkeys(value)) if key == "disabled_features" else value)
    cfg.updated_at = now_utc()
    audit(db, user.id, "ai.settings", "ai_settings", None, {k: str(v) for k, v in data.model_dump(exclude_unset=True).items()})
    db.commit(); ai_client.clear_block(user.id); return _ai_view(db, user)


# ---------- Goal engine (guide 29): levels, automatic progress, forecast range ----------

@router.get("/goals/forecasts")
def goal_forecasts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    goals = db.scalars(select(Goal).where(Goal.user_id == user.id, Goal.status == "active").order_by(Goal.due_date.asc().nullslast())).all()
    out = [goal_engine.forecast(db, g) for g in goals]; db.commit(); return out


@router.get("/goals/{goal_id}/forecast")
def goal_forecast(goal_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = goal_engine.forecast(db, owned(db, Goal, user.id, goal_id)); db.commit(); return out


@router.put("/goals/{goal_id}/levels")
def goal_levels_set(goal_id: uuid.UUID, data: dto.GoalLevelsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    goal = owned(db, Goal, user.id, goal_id)
    goal_engine.set_levels(db, goal, data.levels)
    out = goal_engine.forecast(db, goal); db.commit(); return out


# ---------- Game and rewards (guide 30): points after real actions, caps, forgiving streaks, treats ----------

@router.get("/game")
def game_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = game.summary(db, user.id); db.commit(); return out


@router.patch("/game/settings")
def game_settings_update(data: dto.GameSettingsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = game.settings_for(db, user.id)
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is not None: setattr(row, key, value)
    row.updated_at = now_utc(); db.commit(); return game.summary(db, user.id)


@router.patch("/game/rules/{event_type}")
def game_rule_update(event_type: str, data: dto.PointRuleUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rule = game.rules_for(db, user.id).get(event_type)
    if rule is None: raise HTTPException(404, "Unknown rule")
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is not None: setattr(rule, key, value)
    rule.updated_at = now_utc(); db.commit()
    return {"event_type": rule.event_type, "points": rule.points, "daily_cap": rule.daily_cap, "area": rule.area, "active": rule.active}


@router.get("/game/ledger")
def game_ledger(limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import PointsLedger
    rows = db.scalars(select(PointsLedger).where(PointsLedger.user_id == user.id).order_by(PointsLedger.created_at.desc()).limit(limit)).all()
    return [{"event_type": r.event_type, "points": r.points, "reason": r.reason, "area": r.area, "date": r.local_date, "at": r.created_at} for r in rows]


@router.post("/game/quests", status_code=201)
def game_quest_create(data: dto.QuestIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = game.add_quest(db, user.id, data); db.commit()
    return {"id": row.id, "title": row.title, "event_type": row.event_type, "target_count": row.target_count, "period": row.period}


@router.delete("/game/quests/{quest_id}", status_code=204)
def game_quest_delete(quest_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Quest, user.id, quest_id); row.status = "archived"; db.commit()


@router.post("/game/treats", status_code=201)
def game_treat_create(data: dto.TreatIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    values = data.model_dump()
    if values.get("wish_id"): owned(db, WishlistItem, user.id, values["wish_id"])
    if values.get("money_cost") and not values.get("currency"): raise HTTPException(422, "Money treats need a currency")
    values["currency"] = values["currency"].upper() if values.get("currency") else None
    row = Treat(user_id=user.id, **values); db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "name": row.name, "cost_points": row.cost_points, "money_cost": row.money_cost, "currency": row.currency}


@router.patch("/game/treats/{treat_id}")
def game_treat_update(treat_id: uuid.UUID, data: dto.TreatUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Treat, user.id, treat_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        if key in ("name", "cost_points", "active") and value is None: continue
        setattr(row, key, value)
    row.updated_at = now_utc(); db.commit()
    return {"id": row.id, "name": row.name, "cost_points": row.cost_points, "money_cost": row.money_cost, "active": row.active}


@router.delete("/game/treats/{treat_id}", status_code=204)
def game_treat_delete(treat_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Treat, user.id, treat_id)); db.commit()


@router.post("/game/treats/{treat_id}/redeem")
def game_treat_redeem(treat_id: uuid.UUID, data: dto.RedeemIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = game.redeem(db, user.id, owned(db, Treat, user.id, treat_id), data.confirm, data.over_budget_ok); db.commit(); return result


# ---------- Google connections: Gmail read-only (Fiverr F1) and Google Calendar. One OAuth client serves both. ----------

ProviderKey = Literal["gmail", "calendar"]


@router.get("/integrations")
def integrations_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    configured = google_oauth.configured()
    return {
        "gmail": {"configured": configured, "connection": google_oauth.describe(google_oauth.get_connection(db, user.id, "gmail")),
                  "scope": google_oauth.GMAIL_SCOPE},
        "calendar": {"configured": configured, "connection": google_oauth.describe(google_oauth.get_connection(db, user.id, "calendar")),
                     "scope": google_oauth.CAL_READ},
    }


@router.post("/integrations/{provider}/connect")
def integration_connect(provider: ProviderKey, data: dto.ConnectIn | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    url = google_oauth.start_connect(db, user.id, provider, write=bool(data and data.write and provider == "calendar"))
    db.commit(); return {"auth_url": url}


@router.get("/integrations/google/callback", include_in_schema=False)
def google_callback(code: str | None = Query(None, max_length=2048), state: str | None = Query(None, max_length=512),
                    error: str | None = Query(None, max_length=100), db: Session = Depends(get_db)):
    """Google redirects the browser here. Identified only by the one-time state; always lands back on the web app."""
    ok, provider, reason = google_oauth.finish_connect(db, code, state, error)
    db.commit()
    base = settings.web_app_url.rstrip("/") or ""
    key = provider or "google"
    return RedirectResponse(f"{base}/?{key}={'connected' if ok else 'error'}&reason={reason}#settings", status_code=303)


@router.post("/integrations/{provider}/check")
def integration_check(provider: ProviderKey, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conn = google_oauth.get_connection(db, user.id, provider)
    if conn is None: raise HTTPException(404, "Not connected")
    result = google_oauth.check(db, conn); db.commit(); return result


@router.delete("/integrations/{provider}")
def integration_disconnect(provider: ProviderKey, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conn = google_oauth.get_connection(db, user.id, provider)
    if conn is None: raise HTTPException(404, "Not connected")
    result = google_oauth.disconnect(db, conn); db.commit(); return result


@router.get("/calendar/events")
def calendar_events(start: datetime | None = None, end: datetime | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    lo = as_utc(start) if start else now_utc()
    hi = as_utc(end) if end else lo + timedelta(days=7)
    if hi <= lo or hi - lo > timedelta(days=62): raise HTTPException(422, "Choose a range of up to 62 days")
    events, state = gcalendar.list_events(db, user.id, lo, hi); db.commit()
    return {"status": state, "events": events}


@router.post("/tasks/{task_id}/calendar", status_code=201)
def task_to_calendar(task_id: uuid.UUID, data: dto.CalendarAddIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Task, user.id, task_id)
    result = gcalendar.add_task(db, user.id, row, data.popup_minutes, data.email_minutes); db.commit(); return result


@router.delete("/tasks/{task_id}/calendar")
def task_from_calendar(task_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Task, user.id, task_id)
    result = gcalendar.remove_task(db, user.id, row); db.commit(); return result


# ---------- Phase 5: money lists, balances, envelopes (guide 36) and the time engine (guide 37) ----------
# Never buys, pays or transfers. No bank logins. Totals never mix currencies.

@router.get("/money/balance")
def money_balance(currency: str | None = Query(None, pattern=r"^[A-Za-z]{3}$"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return money_svc.balance_view(db, user.id, currency.upper() if currency else None)


@router.get("/money/accounts", response_model=list[dto.AccountOut])
def accounts_list(include_archived: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = query_user(db, FinancialAccount, user.id)
    if not include_archived: statement = statement.where(FinancialAccount.archived_at.is_(None))
    return list(db.scalars(statement.order_by(FinancialAccount.currency, FinancialAccount.name)).all())


@router.post("/money/accounts", response_model=dto.AccountOut, status_code=201)
def account_create(data: dto.AccountIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = money_svc.open_account(db, user.id, data.name, data.account_type, data.currency, data.balance); db.commit(); db.refresh(row); return row


@router.patch("/money/accounts/{account_id}", response_model=dto.AccountOut)
def account_update(account_id: uuid.UUID, data: dto.AccountUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, FinancialAccount, user.id, account_id)
    changes = data.model_dump(exclude_unset=True)
    if changes.get("name"): row.name = changes["name"].strip()
    if changes.get("account_type"): row.account_type = changes["account_type"]
    if "archived" in changes and changes["archived"] is not None:
        row.archived_at = now_utc() if changes["archived"] else None
    row.updated_at = now_utc(); db.commit(); db.refresh(row); return row


@router.post("/money/accounts/{account_id}/reconcile", response_model=dto.AdjustmentOut, status_code=201)
def account_reconcile(account_id: uuid.UUID, data: dto.ReconcileIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, FinancialAccount, user.id, account_id)
    adj = money_svc.reconcile(db, row, data.balance, data.note, data.reason); db.commit(); db.refresh(adj); return adj


@router.get("/money/accounts/{account_id}/adjustments", response_model=list[dto.AdjustmentOut])
def account_adjustments(account_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    owned(db, FinancialAccount, user.id, account_id)
    return list(db.scalars(select(AccountAdjustment).where(AccountAdjustment.user_id == user.id, AccountAdjustment.account_id == account_id)
                           .order_by(AccountAdjustment.created_at.desc()).limit(200)).all())


@router.get("/money/envelopes")
def envelopes_list(month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return money_svc.envelope_status(db, user.id, month)


@router.post("/money/envelopes", status_code=201)
def envelope_create(data: dto.EnvelopeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = Envelope(user_id=user.id, **{**data.model_dump(), "name": data.name.strip()})
    db.add(row)
    try: db.commit()
    except IntegrityError: db.rollback(); raise HTTPException(409, "You already have an envelope with that name")
    return next(e for e in money_svc.envelope_status(db, user.id) if e["id"] == row.id)


@router.patch("/money/envelopes/{envelope_id}")
def envelope_update(envelope_id: uuid.UUID, data: dto.EnvelopeUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Envelope, user.id, envelope_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is None: continue
        setattr(row, key, value.strip() if isinstance(value, str) else value)
    row.updated_at = now_utc()
    try: db.commit()
    except IntegrityError: db.rollback(); raise HTTPException(409, "You already have an envelope with that name")
    return next(e for e in money_svc.envelope_status(db, user.id) if e["id"] == row.id)


@router.delete("/money/envelopes/{envelope_id}", status_code=204)
def envelope_delete(envelope_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Envelope, user.id, envelope_id)); db.commit()


@router.get("/money/wishlist", response_model=list[dto.WishOut])
def wishlist_list(include_closed: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = query_user(db, WishlistItem, user.id)
    if not include_closed: statement = statement.where(WishlistItem.status == "active")
    rows = db.scalars(statement.order_by(WishlistItem.priority, WishlistItem.cooling_until)).all()
    return [money_svc.wish_out(r) for r in rows]


@router.post("/money/wishlist", response_model=dto.WishOut, status_code=201)
def wishlist_create(data: dto.WishIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = money_svc.add_wish(db, user.id, data); db.commit(); db.refresh(row); return money_svc.wish_out(row)


@router.patch("/money/wishlist/{wish_id}", response_model=dto.WishOut)
def wishlist_update(wish_id: uuid.UUID, data: dto.WishUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, WishlistItem, user.id, wish_id)
    money_svc.update_wish(db, row, data.model_dump(exclude_unset=True)); db.commit(); db.refresh(row); return money_svc.wish_out(row)


@router.post("/money/wishlist/{wish_id}/decide", response_model=dto.WishOut)
def wishlist_decide(wish_id: uuid.UUID, data: dto.WishDecision, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, WishlistItem, user.id, wish_id)
    money_svc.decide_wish(db, row, data.action, data.record_expense, data.amount); db.commit(); db.refresh(row); return money_svc.wish_out(row)


@router.get("/money/wishlist/{wish_id}/affordability")
def wishlist_affordability(wish_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return money_svc.affordability(db, user.id, owned(db, WishlistItem, user.id, wish_id))


@router.get("/money/wishlist/{wish_id}/prices")
def wishlist_prices(wish_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    owned(db, WishlistItem, user.id, wish_id)
    rows = db.scalars(select(PriceNote).where(PriceNote.user_id == user.id, PriceNote.wish_id == wish_id).order_by(PriceNote.noted_at)).all()
    return [{"price": r.price, "currency": r.currency, "noted_at": r.noted_at} for r in rows]


@router.delete("/money/wishlist/{wish_id}", status_code=204)
def wishlist_delete(wish_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, WishlistItem, user.id, wish_id)); db.commit()


@router.get("/money/buy-list", response_model=list[dto.BuyItemOut])
def buylist_list(include_checked: bool = True, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = query_user(db, BuyListItem, user.id)
    if not include_checked: statement = statement.where(BuyListItem.checked_at.is_(None))
    return list(db.scalars(statement.order_by(BuyListItem.checked_at.asc().nullsfirst(), BuyListItem.list_name, BuyListItem.created_at)).all())


@router.post("/money/buy-list", response_model=dto.BuyItemOut, status_code=201)
def buylist_create(data: dto.BuyItemIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = BuyListItem(user_id=user.id, **{**data.model_dump(), "name": data.name.strip(), "list_name": data.list_name.strip().lower()})
    db.add(row); db.commit(); db.refresh(row); return row


@router.patch("/money/buy-list/{item_id}", response_model=dto.BuyItemOut)
def buylist_update(item_id: uuid.UUID, data: dto.BuyItemUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, BuyListItem, user.id, item_id)
    changes = data.model_dump(exclude_unset=True)
    checked = changes.pop("checked", None)
    for key, value in changes.items():
        if key in ("name", "qty", "list_name", "staple") and value is None: continue
        setattr(row, key, value)
    if checked is True and row.checked_at is None: row.checked_at = now_utc()
    elif checked is False: row.checked_at = None
    row.updated_at = now_utc(); db.commit(); db.refresh(row); return row


@router.post("/money/buy-list/checkout")
def buylist_checkout(data: dto.CheckoutIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ids = list(dict.fromkeys(data.item_ids))
    items = list(db.scalars(select(BuyListItem).where(BuyListItem.user_id == user.id, BuyListItem.id.in_(ids))).all())
    if len(items) != len(ids): raise HTTPException(404, "Not found")
    result = money_svc.checkout(db, user.id, items, data.amount, data.currency, data.category, data.merchant); db.commit(); return result


@router.post("/money/buy-list/restock")
def buylist_restock(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    count = money_svc.restock_staples(db, user.id); db.commit(); return {"restocked": count}


@router.delete("/money/buy-list/{item_id}", status_code=204)
def buylist_delete(item_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, BuyListItem, user.id, item_id)); db.commit()


@router.get("/time/insights")
def time_engine_insights(days: int = Query(7, ge=1, le=14), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return time_insights(db, user.id, days)


# ---------- Phase 4: learning (flashcards, spaced repetition) and the mistake notebook ----------

@router.get("/learning/stats")
def learning_stats_get(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return learning_stats(db, user.id)


@router.get("/learning/cards", response_model=list[dto.FlashcardOut])
def cards_list(deck: str | None = None, q: str | None = Query(None, max_length=100), limit: int = Query(200, ge=1, le=1000),
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = query_user(db, Flashcard, user.id)
    if deck: statement = statement.where(Flashcard.deck == clean_deck(deck))
    if q: statement = statement.where(Flashcard.front.ilike(f"%{q}%") | Flashcard.back.ilike(f"%{q}%"))
    return list(db.scalars(statement.order_by(Flashcard.created_at.desc()).limit(limit)).all())


@router.post("/learning/cards", response_model=dto.FlashcardOut, status_code=201)
def card_create(data: dto.FlashcardIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = create_card(db, user.id, data.deck, data.front, data.back, data.example); db.commit(); db.refresh(row); return row


@router.post("/learning/cards/import")
def cards_import(data: dto.FlashcardImport, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = import_cards(db, user.id, data.deck, data.text); db.commit(); return result


@router.patch("/learning/cards/{card_id}", response_model=dto.FlashcardOut)
def card_update(card_id: uuid.UUID, data: dto.FlashcardUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Flashcard, user.id, card_id)
    changes = data.model_dump(exclude_unset=True)
    if changes.get("deck") is not None: changes["deck"] = clean_deck(changes["deck"])
    for key, value in changes.items():
        if key in ("deck", "front", "back", "suspended") and value is None: continue
        setattr(row, key, value.strip() if isinstance(value, str) else value)
    row.updated_at = now_utc()
    try:
        db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, "That card already exists in this deck")
    db.refresh(row); return row


@router.delete("/learning/cards/{card_id}", status_code=204)
def card_delete(card_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Flashcard, user.id, card_id)); db.commit()


@router.get("/learning/review", response_model=list[dto.FlashcardOut])
def review_queue(deck: str | None = None, limit: int = Query(20, ge=1, le=200), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return due_cards(db, user.id, deck, limit)


@router.post("/learning/cards/{card_id}/review", response_model=dto.FlashcardOut)
def card_review(card_id: uuid.UUID, data: dto.ReviewIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Flashcard, user.id, card_id); review_card(db, row, data.grade); db.commit(); db.refresh(row); return row


@router.get("/mistakes", response_model=list[dto.MistakeOut])
def mistakes_list(subject: str | None = None, include_resolved: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    statement = query_user(db, Mistake, user.id)
    if subject: statement = statement.where(Mistake.subject == subject)
    if not include_resolved: statement = statement.where(Mistake.resolved_at.is_(None))
    return list(db.scalars(statement.order_by(Mistake.occurrences.desc(), Mistake.last_seen_at.desc()).limit(500)).all())


@router.post("/mistakes", response_model=dto.MistakeOut, status_code=201)
def mistake_create(data: dto.MistakeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = Mistake(user_id=user.id, **data.model_dump()); db.add(row); db.commit(); db.refresh(row); return row


@router.patch("/mistakes/{mistake_id}", response_model=dto.MistakeOut)
def mistake_update(mistake_id: uuid.UUID, data: dto.MistakeUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Mistake, user.id, mistake_id)
    changes = data.model_dump(exclude_unset=True)
    resolved = changes.pop("resolved", None)
    for key, value in changes.items():
        if key != "lesson" and value is None: continue
        setattr(row, key, value)
    if resolved is True and row.resolved_at is None: row.resolved_at = now_utc()
    elif resolved is False: row.resolved_at = None
    row.updated_at = now_utc(); db.commit(); db.refresh(row); return row


@router.post("/mistakes/{mistake_id}/again", response_model=dto.MistakeOut)
def mistake_repeat(mistake_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Mistake, user.id, mistake_id); mistake_again(db, row); db.commit(); db.refresh(row); return row


@router.post("/mistakes/{mistake_id}/card", response_model=dto.FlashcardOut, status_code=201)
def mistake_card(mistake_id: uuid.UUID, data: dto.ToCardIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Mistake, user.id, mistake_id); card = mistake_to_card(db, row, data.deck); db.commit(); db.refresh(card); return card


@router.delete("/mistakes/{mistake_id}", status_code=204)
def mistake_delete(mistake_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Mistake, user.id, mistake_id)); db.commit()


@router.get("/career/projects")
def projects_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, FreelanceProject, user.id).order_by(FreelanceProject.deadline.asc().nullslast())).all())


@router.post("/career/projects", status_code=201)
def project_create(data: dto.ProjectIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = FreelanceProject(user_id=user.id, **data.model_dump()); db.add(row); db.commit(); db.refresh(row); return row


@router.get("/habits")
def habits_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(select(Habit).where(Habit.user_id == user.id, Habit.active.is_(True)).order_by(Habit.name)).all())


@router.post("/habits", status_code=201)
def habit_create(data: dto.HabitIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = Habit(user_id=user.id, **data.model_dump()); db.add(row); db.commit(); db.refresh(row); return row


@router.post("/habits/{habit_id}/logs", status_code=201)
def habit_log(habit_id: uuid.UUID, data: dto.HabitLogIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    habit = db.scalar(select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id))
    if habit is None: raise HTTPException(404, "Habit not found")
    day = data.logged_on or datetime.now(zone(profile_for(db, user).timezone)).date()
    row = db.scalar(select(HabitLog).where(HabitLog.habit_id == habit_id, HabitLog.logged_on == day))
    if row is None: row = HabitLog(habit_id=habit_id, user_id=user.id, logged_on=day); db.add(row)
    row.completed = data.completed
    if data.completed: game.on_habit_logged(db, habit, day)
    db.commit(); db.refresh(row); return row


@router.post("/focus/sessions", status_code=201)
def focus_start(data: dto.FocusIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if data.task_id is not None: owned(db, Task, user.id, data.task_id)
    active = db.scalar(select(FocusSession).where(FocusSession.user_id == user.id, FocusSession.ended_at.is_(None)))
    if active: raise HTTPException(409, "Finish your active focus session first")
    row = FocusSession(user_id=user.id, task_id=data.task_id, mode=data.mode, minutes_planned=data.minutes, started_at=now_utc(),
                       target=data.target, break_minutes=data.break_minutes)
    db.add(row); db.commit(); db.refresh(row); return focus_svc.session_out(row)


@router.get("/focus/sessions")
def focus_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(select(FocusSession).where(FocusSession.user_id == user.id).order_by(FocusSession.started_at.desc()).limit(100)).all())


@router.patch("/focus/sessions/{session_id}/finish")
def focus_finish(session_id: uuid.UUID, data: dto.FocusFinish, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, FocusSession, user.id, session_id)
    if row.ended_at is not None: raise HTTPException(409, "Focus session is already finished")
    out = focus_svc.finish(db, row, data); db.commit(); return out


@router.get("/focus/today")
def focus_today(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return focus_svc.today_view(db, user.id)


@router.get("/focus/avoid")
def focus_avoid(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return focus_svc.avoid_view(db, user.id)


@router.post("/focus/avoid/starter", status_code=201)
def focus_avoid_starter(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    added = focus_svc.setup_avoid(db, user.id); db.commit(); return {"added": added, "habits": focus_svc.avoid_view(db, user.id)}


@router.post("/internal/tick", include_in_schema=False)
def internal_tick(x_service_token: str = Header(default="")):
    """Run one round of the reminder/check-in worker.

    For free hosts where a background process cannot stay up: a scheduler (GitHub Actions) calls this
    every few minutes with the SERVICE_TOKEN. Refused unless a strong token is configured.
    """
    from app.core.config import WEAK_SECRETS
    from app.workers.checkins import process_once
    configured = settings.service_token
    if configured in WEAK_SECRETS or len(configured) < 32 or not hmac.compare_digest(x_service_token.encode(), configured.encode()):
        raise HTTPException(403, "Forbidden")
    process_once()
    from app.core.database import SessionLocal
    from app.services.goal_engine import snapshot_all
    with SessionLocal() as db:
        goals = snapshot_all(db)
    return {"status": "ok", "goal_snapshots": goals}


@router.get("/insights")
def insights(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services.insights import insight_facts
    return insight_facts(db, user)


@router.post("/chat", response_model=dto.ChatOut)
def chat(data: dto.ChatIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return converse(db, user, data.message, data.conversation_id)


@router.get("/assistant/status")
def assistant_status(user: User = Depends(get_current_user)):
    """Whether a language-model provider is configured (never returns the key)."""
    from urllib.parse import urlparse
    from app.services import ai_client
    enabled = ai_client.ai_enabled()
    return {"ai_enabled": enabled, "provider": urlparse(settings.ai_base_url).hostname if enabled else None,
            "model": settings.openai_model_balanced if enabled else None,
            "last_error": ai_client.last_error if enabled else None}


@router.get("/conversations", response_model=list[dto.ConversationOut])
def conversations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, Conversation, user.id).order_by(Conversation.updated_at.desc()).limit(100)).all())


@router.get("/conversations/{conversation_id}", response_model=dto.ConversationDetail)
def conversation_detail(conversation_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Conversation, user.id, conversation_id)
    row.messages = list(db.scalars(select(Message).where(Message.conversation_id == row.id).order_by(Message.created_at)).all())
    return row


@router.post("/voice/transcribe")
async def voice_transcribe(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    content = await file.read(12 * 1024 * 1024 + 1)
    if len(content) > 12 * 1024 * 1024: raise HTTPException(413, "Audio file is too large")
    text = transcribe_audio(db, user.id, file.filename or "audio.webm", content, file.content_type or "application/octet-stream")
    if text is None: raise HTTPException(503, "Voice transcription is unavailable; configure OPENAI_API_KEY")
    db.commit(); return {"text": text}


@router.get("/checkins/settings")
def checkin_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalar(select(CheckinSetting).where(CheckinSetting.user_id == user.id))


@router.post("/checkins/settings")
def checkin_settings_update(data: dto.CheckinSettingsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = db.scalar(select(CheckinSetting).where(CheckinSetting.user_id == user.id))
    if row is None: row = CheckinSetting(user_id=user.id); db.add(row)
    for key, value in data.model_dump().items(): setattr(row, key, value)
    db.commit(); db.refresh(row); return row


@router.get("/checkins/history")
def checkin_history(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(select(CheckinLog).where(CheckinLog.user_id == user.id).order_by(CheckinLog.created_at.desc()).limit(100)).all())


@router.post("/checkins/history", status_code=201)
def checkin_create(data: dto.CheckinIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = CheckinLog(user_id=user.id, note=data.note, mood=data.mood); db.add(row); db.commit(); db.refresh(row); return row


@router.get("/approvals")
def approvals(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(select(Approval).where(Approval.user_id == user.id).order_by(Approval.created_at.desc())).all())


@router.post("/mcp/proposals", status_code=201)
def mcp_proposal(data: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    tool_name = data.get("tool_name")
    payload = data.get("payload") or {}
    supported = {"create_task", "update_task", "create_goal", "save_memory", "create_daily_plan", "create_expense"}
    if tool_name not in supported or not isinstance(payload, dict):
        raise HTTPException(422, "Unsupported MCP write tool or invalid payload")
    # Validate before persisting the proposal; the action is still not executed.
    schemas = {
        "create_task": dto.TaskIn,
        "create_goal": dto.GoalIn,
        "save_memory": dto.MemoryIn,
        "create_daily_plan": dto.GeneratePlanIn,
        "create_expense": dto.ExpenseIn,
    }
    try:
        if tool_name == "update_task":
            task_id = uuid.UUID(payload["id"])
            owned(db, Task, user.id, task_id)
            dto.TaskUpdate.model_validate({key: value for key, value in payload.items() if key != "id"})
            if len(payload) == 1:
                raise ValueError("at least one task field is required")
        else:
            schemas[tool_name].model_validate(payload)
    except Exception as exc:
        raise HTTPException(422, "Tool arguments failed validation") from exc
    row = Approval(user_id=user.id, tool_name=tool_name, payload={"action": tool_name, "body": payload}, status="pending")
    db.add(row)
    from app.services.audit import audit
    audit(db, user.id, "approval.create", "approval", row.id, {"tool": tool_name}, actor="mcp")
    db.commit(); db.refresh(row)
    return row


@router.post("/approvals/{approval_id}/approve")
def approval_accept(approval_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = resolve_approval(db, user, owned(db, Approval, user.id, approval_id), True); db.commit(); return row


@router.post("/approvals/{approval_id}/reject")
def approval_reject(approval_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = resolve_approval(db, user, owned(db, Approval, user.id, approval_id), False); db.commit(); return row


@router.get("/notifications")
def notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(100)).all())


@router.post("/life", status_code=201)
def life_create(data: dto.LifeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = LifeEntry(user_id=user.id, **data.model_dump()); db.add(row); db.commit(); db.refresh(row); return row


@router.get("/life")
def life_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, LifeEntry, user.id).order_by(LifeEntry.occurred_on.desc().nullslast())).all())



# ---------- Life OS Phase 1: routines, checklists, meals, day / week / month ----------
# Static paths come before /routines/{routine_id} so "today", "week" etc. are never read as an id.

from app.services import routines as routine_svc  # noqa: E402


def _day_or_today(db: Session, user: User, day: date | None) -> date:
    return day or routine_svc.today_for(db, user.id)


@router.get("/routines/today")
def routines_today(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return routine_svc.day_view(db, user.id, _day_or_today(db, user, day))


@router.get("/routines/week")
def routines_week(start: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return routine_svc.week_view(db, user.id, start)


@router.get("/routines/month")
def routines_month(month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return routine_svc.month_view(db, user.id, month)


@router.post("/routines/starter", status_code=201)
def routines_starter(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    added = routine_svc.load_starter(db, user.id); db.commit()
    return {"added": len(added), "routines": [routine_svc.routine_out(db, r) for r in routine_svc._routines(db, user.id, active_only=False)]}


@router.get("/routines")
def routines_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [routine_svc.routine_out(db, r) for r in routine_svc._routines(db, user.id, active_only=False)]


@router.post("/routines", status_code=201)
def routines_create(data: dto.RoutineIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = routine_svc.save_routine(db, user.id, data); db.commit(); return routine_svc.routine_out(db, row)


@router.patch("/routines/{routine_id}")
def routines_update(routine_id: uuid.UUID, data: dto.RoutineUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = routine_svc.save_routine(db, user.id, data, routine_svc.owned_routine(db, user.id, routine_id)); db.commit()
    return routine_svc.routine_out(db, row)


@router.delete("/routines/{routine_id}")
def routines_delete(routine_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = routine_svc.owned_routine(db, user.id, routine_id)
    audit(db, user.id, "routine.delete", "routine", row.id); db.delete(row); db.commit(); return {"deleted": True}


@router.post("/routines/{routine_id}/days/{day}/steps/{step_id}")
def routines_tick(routine_id: uuid.UUID, day: date, step_id: uuid.UUID, data: dto.StepTickIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = routine_svc.tick(db, routine_svc.owned_routine(db, user.id, routine_id), day, step_id, data.done); db.commit(); return out


@router.post("/routines/{routine_id}/days/{day}/mode")
def routines_mode(routine_id: uuid.UUID, day: date, data: dto.RunModeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = routine_svc.set_mode(db, routine_svc.owned_routine(db, user.id, routine_id), day, data.mode); db.commit(); return out


@router.post("/routines/{routine_id}/days/{day}/skip")
def routines_skip(routine_id: uuid.UUID, day: date, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = routine_svc.skip(db, routine_svc.owned_routine(db, user.id, routine_id), day); db.commit(); return out


@router.post("/meals", status_code=201)
def meals_create(data: dto.MealIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = routine_svc.log_meal(db, user.id, data); db.commit(); return routine_svc.meal_out(row)


@router.get("/meals")
def meals_list(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import MealLog
    selected = _day_or_today(db, user, day)
    rows = db.scalars(select(MealLog).where(MealLog.user_id == user.id, MealLog.local_date == selected).order_by(MealLog.created_at)).all()
    return [routine_svc.meal_out(r) for r in rows]
