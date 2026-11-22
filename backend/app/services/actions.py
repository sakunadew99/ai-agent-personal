import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import (
    Approval,
    DailyPlan,
    Expense,
    Goal,
    Income,
    PlanItem,
    Task,
    User,
    UserProfile,
)
from app.schemas.dto import ExpenseIn, GoalIn, GoalUpdate, IncomeIn, TaskIn, TaskUpdate
from app.services import game
from app.services.audit import audit
from app.services.memory import save_memory
from app.services.planner import SchedTask, build_day
from app.services.recurrence import next_occurrence
from app.services.permissions import mode_for


def _profile(db: Session, user_id) -> UserProfile:
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return profile


def _goal_owned(db: Session, user_id, goal_id: uuid.UUID | None) -> None:
    if goal_id is None:
        return
    goal = db.get(Goal, goal_id)
    if goal is None or goal.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")


def create_task(db: Session, user_id, data: TaskIn) -> Task:
    _goal_owned(db, user_id, data.goal_id)
    row = Task(user_id=user_id, **data.model_dump())
    if row.due_at is not None:
        row.due_at = as_utc(row.due_at)  # store UTC (project rule); display converts to the user's timezone
    db.add(row)
    db.flush()
    audit(db, user_id, "task.create", "task", row.id, {"title": row.title})
    return row


def _spawn_next(db: Session, row: Task) -> Task | None:
    """Repeating task finished: create the next occurrence in the user's timezone. Plain code, no AI."""
    if not row.recurrence:
        return None
    tz = zone(_profile(db, row.user_id).timezone)
    now = now_utc()
    anchor = as_utc(row.due_at) if row.due_at else now
    due = next_occurrence(row.recurrence, anchor, tz, now)
    if due is None:  # series ended (UNTIL passed)
        return None
    nxt = Task(user_id=row.user_id, goal_id=row.goal_id, title=row.title, notes=row.notes, category=row.category,
               priority=row.priority, status="todo", due_at=due.astimezone(timezone.utc),
               duration_minutes=row.duration_minutes, recurrence=row.recurrence,
               calendar_event_id=row.calendar_event_id)  # one recurring Google event covers the series
    db.add(nxt)
    db.flush()
    audit(db, row.user_id, "task.repeat", "task", nxt.id, {"from": str(row.id), "due_at": nxt.due_at.isoformat()})
    return nxt


def update_task(db: Session, row: Task, data: TaskUpdate) -> Task:
    changes = data.model_dump(exclude_unset=True)
    was_done = row.status == "done"
    if "goal_id" in changes:
        _goal_owned(db, row.user_id, changes["goal_id"])
    if changes.get("due_at") is not None:
        changes["due_at"] = as_utc(changes["due_at"])
    for key, value in changes.items():
        setattr(row, key, value)
    if changes.get("status") == "done" and row.completed_at is None:
        row.completed_at = now_utc()
    if changes.get("status") not in (None, "done"):
        row.completed_at = None
    row.updated_at = now_utc()
    audit(db, row.user_id, "task.update", "task", row.id)
    if row.status == "done" and not was_done:
        _spawn_next(db, row)
        game.on_task_done(db, row)
    return row


def complete_task(db: Session, row: Task) -> Task:
    """Mark done. Completing an already-done task changes nothing (so a double tap never spawns two repeats)."""
    if row.status == "done":
        return row
    row.status = "done"
    row.completed_at = now_utc()
    row.updated_at = now_utc()
    audit(db, row.user_id, "task.complete", "task", row.id)
    _spawn_next(db, row)
    game.on_task_done(db, row)
    return row


def create_goal(db: Session, user_id, data: GoalIn) -> Goal:
    from app.services.goal_engine import validate_metric
    values = data.model_dump()
    values["metric_currency"] = validate_metric(data.metric, data.metric_currency)
    _goal_owned(db, user_id, data.parent_id)          # a sub-goal can only hang under your own goal
    row = Goal(user_id=user_id, **values)
    db.add(row)
    db.flush()
    audit(db, user_id, "goal.create", "goal", row.id, {"title": row.title})
    return row


def update_goal(db: Session, row: Goal, data: GoalUpdate) -> Goal:
    from app.services.goal_engine import validate_metric
    changes = data.model_dump(exclude_unset=True)
    if "metric" in changes or "metric_currency" in changes:
        if changes.get("metric") is None:
            changes.pop("metric", None)
        changes["metric_currency"] = validate_metric(changes.get("metric", row.metric), changes.get("metric_currency", row.metric_currency))
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = now_utc()
    audit(db, row.user_id, "goal.update", "goal", row.id)
    return row


def create_income(db: Session, user_id, data: IncomeIn) -> Income:
    row = Income(
        user_id=user_id,
        amount=data.amount,
        currency=data.currency,
        source=data.source,
        record_kind=data.record_kind,
        received_at=as_utc(data.received_at or now_utc()),
        notes=data.notes,
    )
    db.add(row)
    db.flush()
    audit(db, user_id, "income.create", "income", row.id, {"amount": str(row.amount), "kind": row.record_kind})
    return row


def create_expense(db: Session, user_id, data: ExpenseIn) -> Expense:
    row = Expense(
        user_id=user_id,
        amount=data.amount,
        currency=data.currency,
        category=data.category,
        scope=data.scope,
        record_kind=data.record_kind,
        merchant=data.merchant,
        spent_at=as_utc(data.spent_at or now_utc()),
        notes=data.notes,
    )
    db.add(row)
    db.flush()
    audit(db, user_id, "expense.create", "expense", row.id, {"amount": str(row.amount), "kind": row.record_kind})
    return row


def _tasks_for_day(db: Session, user_id, plan_date: date, tz) -> list[SchedTask]:
    rows = db.scalars(
        select(Task).where(Task.user_id == user_id, Task.status.notin_(["done", "cancelled"]))
    ).all()
    selected = []
    for row in rows:
        if row.due_at is not None and as_utc(row.due_at).astimezone(tz).date() > plan_date:
            continue
        selected.append(
            SchedTask(str(row.id), row.title, row.duration_minutes or 30, row.priority)
        )
    return selected


def create_daily_plan(db: Session, user: User, plan_date: date) -> DailyPlan:
    from app.services.exams import study_blocks
    from app.services.routines import gym_days, routine_blocks, work_days
    profile = _profile(db, user.id)
    tz = zone(profile.timezone)
    weekday = plan_date.isoweekday()
    is_work = profile.work_days is None or weekday in work_days(profile)   # no work days set = old behaviour (every day)
    is_gym = profile.gym_days is None or weekday in gym_days(profile)
    draft = build_day(
        plan_date,
        tz,
        profile.wake_time,
        profile.sleep_time,
        profile.work_start if is_work else None,
        profile.work_end if is_work else None,
        profile.gym_time if is_gym else None,
        _tasks_for_day(db, user.id, plan_date, tz),
        routine_blocks(db, user.id, plan_date, tz) + study_blocks(db, user.id, plan_date, tz),
    )
    plan = db.scalar(select(DailyPlan).where(DailyPlan.user_id == user.id, DailyPlan.plan_date == plan_date))
    if plan is None:
        plan = DailyPlan(user_id=user.id, plan_date=plan_date)
        db.add(plan)
        db.flush()
    else:
        db.execute(delete(PlanItem).where(PlanItem.plan_id == plan.id))
    plan.summary = _summary(draft)
    plan.meta = {"conflicts": draft.conflicts, "unscheduled": draft.unscheduled}
    for block in draft.blocks:
        db.add(
            PlanItem(
                plan_id=plan.id,
                user_id=user.id,
                task_id=uuid.UUID(block.task_id) if block.task_id else None,
                title=block.title,
                starts_at=block.starts_at,
                ends_at=block.ends_at,
                kind=block.kind,
            )
        )
    audit(db, user.id, "plan.create", "daily_plan", plan.id, {"date": plan_date.isoformat()})
    db.flush()
    return plan


def create_daily_plans(db: Session, user: User, start: date, days: int) -> list[DailyPlan]:
    return [create_daily_plan(db, user, start + timedelta(days=offset)) for offset in range(days)]


def _summary(draft) -> str:
    parts = [f"{len(draft.blocks)} blocks"]
    if draft.conflicts:
        parts.append(f"{len(draft.conflicts)} conflicts")
    if draft.unscheduled:
        parts.append(f"{len(draft.unscheduled)} unscheduled")
    return ", ".join(parts)


def execute_action(db: Session, user: User, action: str, body: dict) -> dict:
    if action == "create_task":
        row = create_task(db, user.id, TaskIn.model_validate(body))
        return {"id": str(row.id), "title": row.title}
    if action == "update_task":
        task_id = uuid.UUID(body["id"])
        task = db.get(Task, task_id)
        if task is None or task.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
        changes = {key: value for key, value in body.items() if key != "id"}
        row = update_task(db, task, TaskUpdate.model_validate(changes))
        return {"id": str(row.id), "title": row.title, "status": row.status}
    if action == "create_goal":
        row = create_goal(db, user.id, GoalIn.model_validate(body))
        return {"id": str(row.id), "title": row.title}
    if action == "save_memory":
        row = save_memory(
            db,
            user.id,
            body["content"],
            body.get("category", "note"),
            "assistant",
            bool(body.get("allow_sensitive", False)),
        )
        return {"id": str(row.id), "category": row.category}
    if action == "create_daily_plan":
        plan_date = date.fromisoformat(body["plan_date"]) if body.get("plan_date") else _today(db, user.id)
        row = create_daily_plan(db, user, plan_date)
        return {"id": str(row.id), "plan_date": row.plan_date.isoformat()}
    if action == "create_expense":
        row = create_expense(db, user.id, ExpenseIn.model_validate(body))
        return {"id": str(row.id), "amount": str(row.amount), "category": row.category}
    if action == "log_life_area":
        from app.services import compass
        row = compass.log(db, user.id, str(body.get("area")), note=str(body.get("note") or "")[:200] or None)
        return {"id": str(row.id), "area": body.get("area")}
    if action == "exam_update":
        from app.services.exams import apply_command
        out = apply_command(db, user.id, {k: body[k] for k in ("action", "exam", "skill", "minutes", "score", "source", "field", "value") if k in body})
        return {"id": out.get("plan_id"), "summary": out["summary"]}
    if action in ("add_to_buy_list", "add_to_wishlist"):
        from app.services.commands import add_list_items
        items = [str(i)[:200] for i in (body.get("items") or [])][:20]
        list_name = (str(body.get("list_name") or "groceries").strip().lower() or "groceries")[:32]
        added = add_list_items(db, user.id, "buy" if action == "add_to_buy_list" else "wish", list_name, items, _profile(db, user.id).currency)
        ids = added["buy_item_ids"] + added["wish_ids"]
        return {"id": ids[0] if ids else None, "ids": ids, "summary": added["summary"]}
    if action == "create_note":
        from app.models.entities import Note
        from app.schemas.dto import NoteIn
        data = NoteIn.model_validate(body)
        if not (data.title.strip() or data.body.strip()):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Write a title or some text")
        tags = list(dict.fromkeys(t.strip().lstrip("#").lower()[:32] for t in data.tags if t.strip()))[:12]
        row = Note(user_id=user.id, title=data.title.strip(), body=data.body, tags=tags, color=data.color, pinned=data.pinned)
        db.add(row); db.flush()
        audit(db, user.id, "note.create", "note", row.id)
        return {"id": str(row.id), "title": row.title}
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown action")


def queue_or_run(db: Session, user: User, tool: str, body: dict, summary: str) -> dict:
    mode = mode_for(db, user.id, tool)
    profile = _profile(db, user.id)
    auto = profile.automation_policy == "auto" and tool != "create_expense"
    if mode == "deny":
        return {"status": "refused", "summary": f"Permission denies {tool}", "tool": tool}
    if mode == "approval" and not auto:
        approval = Approval(user_id=user.id, tool_name=tool, payload={"action": tool, "body": body}, status="pending")
        db.add(approval)
        db.flush()
        audit(db, user.id, "approval.create", "approval", approval.id, {"tool": tool}, actor="assistant")
        return {
            "status": "proposed",
            "summary": summary,
            "tool": tool,
            "approval_id": str(approval.id),
        }
    result = execute_action(db, user, tool, body)
    return {
        "status": "completed",
        "summary": summary,
        "tool": tool,
        "resource_id": result.get("id"),
    }


def resolve_approval(db: Session, user: User, approval: Approval, accept: bool) -> Approval:
    if approval.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "Approval is already resolved")
    approval.resolved_at = now_utc()
    if not accept:
        approval.status = "rejected"
        audit(db, user.id, "approval.reject", "approval", approval.id)
        return approval
    result = execute_action(db, user, approval.payload["action"], approval.payload.get("body") or {})
    approval.status = "approved"
    approval.result = result
    audit(db, user.id, "approval.approve", "approval", approval.id, {"tool": approval.tool_name})
    return approval


def _today(db: Session, user_id) -> date:
    profile = _profile(db, user_id)
    return datetime.now(zone(profile.timezone)).date()


def combine_local(db: Session, user_id, day: date, clock: str) -> datetime:
    profile = _profile(db, user_id)
    hour, minute = (int(part) for part in clock.split(":"))
    local = datetime.combine(day, time(hour, minute), tzinfo=zone(profile.timezone))
    return as_utc(local)
