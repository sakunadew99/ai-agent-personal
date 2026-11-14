import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
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
    PlanItem, RefreshToken, SleepRecord, Task, User, UserProfile, Workout, CareerProfile,
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


@router.post("/memories", response_model=dto.MemoryOut, status_code=201)
def memory_create(data: dto.MemoryIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = save_memory(db, user.id, data.content, data.category, "user", data.allow_sensitive, data.pinned); db.commit(); db.refresh(row); return row


@router.get("/memories", response_model=list[dto.MemoryOut])
def memory_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, Memory, user.id).order_by(Memory.pinned.desc(), Memory.updated_at.desc())).all())


@router.post("/memories/search", response_model=list[dto.MemoryOut])
def memory_search(data: dto.MemorySearchIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return search_memories(db, user.id, data.query, data.limit)


@router.patch("/memories/{memory_id}", response_model=dto.MemoryOut)
def memory_update(memory_id: uuid.UUID, data: dto.MemoryUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Memory, user.id, memory_id); update_memory(db, row, data.content, data.category, data.pinned, data.allow_sensitive); db.commit(); db.refresh(row); return row


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
    db.add(row); db.commit(); db.refresh(row); return row


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
    db.add(row); db.commit(); db.refresh(row); return row


@router.post("/health/workouts", status_code=201)
def workout_create(data: dto.WorkoutIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = Workout(user_id=user.id, activity=data.activity, duration_minutes=data.duration_minutes, calories=data.calories, started_at=as_utc(data.started_at or now_utc()), notes=data.notes, source=data.source)
    db.add(row); db.commit(); db.refresh(row); return row


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


@router.get("/career/jobs")
def jobs_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(query_user(db, JobApplication, user.id).order_by(JobApplication.created_at.desc())).all())


@router.post("/career/jobs", status_code=201)
def job_create(data: dto.JobIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = JobApplication(user_id=user.id, **data.model_dump()); db.add(row); db.commit(); db.refresh(row); return row


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
    db.commit(); db.refresh(row); return row


@router.post("/focus/sessions", status_code=201)
def focus_start(data: dto.FocusIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if data.task_id is not None: owned(db, Task, user.id, data.task_id)
    active = db.scalar(select(FocusSession).where(FocusSession.user_id == user.id, FocusSession.ended_at.is_(None)))
    if active: raise HTTPException(409, "Finish your active focus session first")
    row = FocusSession(user_id=user.id, task_id=data.task_id, mode=data.mode, minutes_planned=data.minutes, started_at=now_utc())
    db.add(row); db.commit(); db.refresh(row); return row


@router.get("/focus/sessions")
def focus_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(select(FocusSession).where(FocusSession.user_id == user.id).order_by(FocusSession.started_at.desc()).limit(100)).all())


@router.patch("/focus/sessions/{session_id}/finish")
def focus_finish(session_id: uuid.UUID, data: dto.FocusFinish, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, FocusSession, user.id, session_id)
    if row.ended_at is not None: raise HTTPException(409, "Focus session is already finished")
    row.ended_at = now_utc(); row.distractions = data.distractions; row.notes = data.notes
    db.commit(); db.refresh(row); return row


@router.get("/insights")
def insights(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services.insights import insight_facts
    return insight_facts(db, user)


@router.post("/chat", response_model=dto.ChatOut)
def chat(data: dto.ChatIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return converse(db, user, data.message, data.conversation_id)


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

