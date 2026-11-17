import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from app.services.recurrence import normalize_rule

Priority = Literal["low", "medium", "high"]
TaskStatus = Literal["inbox", "todo", "in_progress", "done", "cancelled"]
GoalStatus = Literal["active", "paused", "completed", "archived"]
# Where goal progress comes from (services/goal_engine.py). Money metrics need metric_currency.
GoalMetric = Literal["manual", "savings_balance", "all_accounts", "income_since_start", "focus_hours", "tasks_done", "milestones_done"]
RecordKind = Literal["actual", "estimated", "projected"]
ExpenseCategory = Literal[
    "food", "transport", "housing", "subscriptions", "shopping", "health", "education", "business", "savings", "other"
]
IncomeSource = Literal["salary", "freelance", "business", "other"]
ToolMode = Literal["allow", "approval", "deny"]
# Repeat rule such as "FREQ=WEEKLY;BYDAY=MO,TH"; empty string clears it. Validated and normalized (services/recurrence.py).
Recurrence = Annotated[str | None, Field(default=None, max_length=200), AfterValidator(normalize_rule)]


def _currency(value: str) -> str:
    code = value.strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise ValueError("currency must be a 3-letter code")
    return code


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(ORMModel):
    id: uuid.UUID
    email: str
    full_name: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class RegisterIn(BaseModel):
    email: str
    password: str
    full_name: str = Field(min_length=1, max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        from email_validator import EmailNotValidError, validate_email

        try:
            return validate_email(value, check_deliverability=False).normalized.lower()
        except EmailNotValidError as exc:
            raise ValueError("invalid email") from exc


class LoginIn(BaseModel):
    email: str
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class ProfileOut(ORMModel):
    timezone: str
    currency: str
    wake_time: time
    sleep_time: time
    work_start: time | None
    work_end: time | None
    gym_time: time | None
    work_days: list[int] | None = None
    gym_days: list[int] | None = None
    financial_target_amount: Decimal | None
    financial_target_currency: str
    financial_target_date: date | None
    automation_policy: str
    bio: str | None
    location: str | None


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    timezone: str | None = None
    currency: str | None = None
    wake_time: time | None = None
    sleep_time: time | None = None
    work_start: time | None = None
    work_end: time | None = None
    gym_time: time | None = None
    work_days: list[int] | None = None
    gym_days: list[int] | None = None
    financial_target_amount: Decimal | None = None
    financial_target_currency: str | None = None
    financial_target_date: date | None = None
    automation_policy: Literal["confirm", "auto"] | None = None
    bio: str | None = None
    location: str | None = None

    @field_validator("currency", "financial_target_currency")
    @classmethod
    def _cur(cls, value: str | None) -> str | None:
        return None if value is None else _currency(value)

    @field_validator("work_days", "gym_days")
    @classmethod
    def _days(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        if any(d not in range(1, 8) for d in value):
            raise ValueError("days are 1 (Monday) to 7 (Sunday)")
        return sorted(set(value))

    @field_validator("timezone")
    @classmethod
    def _tz(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("unknown timezone") from exc
        return value


class MeOut(BaseModel):
    user: UserOut
    profile: ProfileOut


class PermissionOut(ORMModel):
    tool_name: str
    mode: str


class PermissionUpdate(BaseModel):
    mode: ToolMode


class GoalIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category: str = Field(default="personal", max_length=32)
    target_value: Decimal | None = None
    current_value: Decimal = Decimal("0")
    unit: str | None = Field(default=None, max_length=32)
    due_date: date | None = None
    status: GoalStatus = "active"
    metric: GoalMetric = "manual"
    metric_currency: str | None = Field(default=None, pattern=r"^[A-Za-z]{3}$")


class GoalUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = Field(default=None, max_length=32)
    target_value: Decimal | None = None
    current_value: Decimal | None = None
    unit: str | None = None
    due_date: date | None = None
    status: GoalStatus | None = None
    metric: GoalMetric | None = None
    metric_currency: str | None = Field(default=None, pattern=r"^[A-Za-z]{3}$")


class GoalOut(ORMModel):
    id: uuid.UUID
    title: str
    description: str | None
    category: str
    status: str
    target_value: Decimal | None
    current_value: Decimal
    unit: str | None
    due_date: date | None
    metric: str = "manual"
    metric_currency: str | None = None
    created_at: datetime


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    notes: str | None = None
    category: str = Field(default="personal", max_length=32)
    priority: Priority = "medium"
    status: TaskStatus = "todo"
    due_at: datetime | None = None
    duration_minutes: int | None = Field(default=30, ge=5, le=1440)
    goal_id: uuid.UUID | None = None
    recurrence: Recurrence = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = None
    category: str | None = None
    priority: Priority | None = None
    status: TaskStatus | None = None
    due_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=1440)
    goal_id: uuid.UUID | None = None
    recurrence: Recurrence = None


class TaskOut(ORMModel):
    id: uuid.UUID
    goal_id: uuid.UUID | None
    title: str
    notes: str | None
    category: str
    status: str
    priority: str
    due_at: datetime | None
    duration_minutes: int | None
    recurrence: str | None = None
    calendar_event_id: str | None = None
    completed_at: datetime | None
    created_at: datetime


class MilestoneIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_date: date | None = None
    position: int = Field(default=0, ge=0, le=1000)


class MilestoneUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    due_date: date | None = None
    position: int | None = Field(default=None, ge=0, le=1000)
    done: bool | None = None


class MilestoneOut(ORMModel):
    id: uuid.UUID
    goal_id: uuid.UUID
    title: str
    due_date: date | None
    position: int
    done_at: datetime | None
    created_at: datetime


class ReminderOut(BaseModel):
    task_id: uuid.UUID
    title: str
    due_at: datetime
    notify_at: datetime
    moved_for_quiet_hours: bool


class PlanItemOut(ORMModel):
    id: uuid.UUID
    task_id: uuid.UUID | None
    title: str
    starts_at: datetime
    ends_at: datetime
    kind: str
    status: str


class PlanItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    status: Literal["planned", "done", "skipped"] | None = None


class DailyPlanOut(BaseModel):
    id: uuid.UUID
    plan_date: date
    summary: str | None
    conflicts: list[str]
    unscheduled: list[str]
    items: list[PlanItemOut]


class GeneratePlanIn(BaseModel):
    plan_date: date | None = None
    scope: Literal["day", "week"] = "day"


class CaptureIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class CaptureOut(BaseModel):
    id: uuid.UUID
    raw_text: str
    classified_type: str
    extracted: dict
    status: str
    task_id: uuid.UUID | None
    created_at: datetime


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    conversation_id: uuid.UUID | None = None


class ActionRef(BaseModel):
    tool: str
    status: Literal["proposed", "completed", "refused"]
    summary: str
    approval_id: uuid.UUID | None = None
    resource_id: uuid.UUID | None = None


class ChatOut(BaseModel):
    conversation_id: uuid.UUID
    reply: str
    actions_proposed: list[ActionRef]
    actions_completed: list[ActionRef]
    relevant_memories: list[str] = Field(default_factory=list)


class ConversationOut(ORMModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime


class MessageOut(ORMModel):
    id: uuid.UUID
    role: str
    content: str
    actions: dict
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


IntentType = Literal["fact", "preference", "interest", "intention", "commitment"]


class MemoryIn(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    category: str = Field(default="note", max_length=32)
    allow_sensitive: bool = False
    pinned: bool = False
    intent_type: IntentType | None = None      # detected automatically when omitted
    allow_duplicate: bool = False              # save even if a near-identical memory exists


class MemoryUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=8000)
    category: str | None = None
    pinned: bool | None = None
    allow_sensitive: bool = False
    intent_type: IntentType | None = None


class MemoryOut(ORMModel):
    id: uuid.UUID
    category: str
    content: str
    source: str
    sensitivity: str
    pinned: bool
    created_at: datetime
    updated_at: datetime
    intent_type: str = "fact"
    topic: str | None = None
    surface_count: int = 0
    snooze_until: datetime | None = None
    dismissed_at: datetime | None = None
    planned_at: datetime | None = None


class ResurfaceAction(BaseModel):
    action: Literal["plan", "later", "dismiss", "keep"]


class MemorySearchIn(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=8, ge=1, le=30)


class IncomeIn(BaseModel):
    amount: Decimal = Field(gt=0)
    currency: str = "USD"
    source: IncomeSource
    record_kind: RecordKind = "actual"
    received_at: datetime | None = None
    notes: str | None = None

    @field_validator("currency")
    @classmethod
    def _cur(cls, value: str) -> str:
        return _currency(value)


class ExpenseIn(BaseModel):
    amount: Decimal = Field(gt=0)
    currency: str = "USD"
    category: ExpenseCategory
    scope: Literal["personal", "business"] = "personal"
    record_kind: RecordKind = "actual"
    merchant: str | None = None
    spent_at: datetime | None = None
    notes: str | None = None

    @field_validator("currency")
    @classmethod
    def _cur(cls, value: str) -> str:
        return _currency(value)


class MoneyOut(BaseModel):
    id: uuid.UUID
    amount: Decimal
    currency: str
    record_kind: str
    notes: str | None
    occurred_at: datetime
    label: str


class BalanceIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(default="other", max_length=32)
    amount: Decimal
    currency: str = "USD"
    record_kind: RecordKind = "actual"
    account_type: str | None = None

    @field_validator("currency")
    @classmethod
    def _cur(cls, value: str) -> str:
        return _currency(value)


class BalanceOut(BaseModel):
    id: uuid.UUID
    name: str
    category: str
    amount: Decimal
    currency: str
    record_kind: str


class FinanceSummary(BaseModel):
    currency: str
    month: str
    total_income: Decimal
    total_expenses: Decimal
    total_savings: Decimal
    savings_basis: str
    savings_rate: Decimal | None
    net_income: Decimal
    net_worth: Decimal
    business_revenue: Decimal
    business_expenses: Decimal
    business_profit: Decimal
    salary_income: Decimal
    freelance_income: Decimal
    other_income: Decimal
    pending_receivables: Decimal
    expense_by_category: dict[str, Decimal]
    totals_by_kind: dict[str, dict[str, Decimal]]
    target_amount: Decimal | None
    target_progress_percent: Decimal | None
    excluded_currencies: list[str]
    notice: str


class HealthMetricIn(BaseModel):
    metric: Literal["steps", "heart_rate", "calories", "activity", "other"]
    value: Decimal
    unit: str = Field(min_length=1, max_length=32)
    recorded_at: datetime | None = None
    source: str = Field(default="manual", max_length=32)


class SleepIn(BaseModel):
    start_at: datetime
    end_at: datetime
    stages: dict | None = None
    source: str = "manual"


class WorkoutIn(BaseModel):
    activity: str = Field(min_length=1, max_length=100)
    duration_minutes: int = Field(ge=1, le=1440)
    calories: Decimal | None = None
    started_at: datetime | None = None
    notes: str | None = None
    source: str = "manual"


class CareerProfileIn(BaseModel):
    headline: str | None = Field(default=None, max_length=200)
    summary: str | None = None
    skills: list[str] = Field(default_factory=list)


JobStage = Literal["draft", "applied", "interview", "offer", "accepted", "rejected", "withdrawn"]


class JobIn(BaseModel):
    company: str = Field(min_length=1, max_length=200)
    role: str = Field(min_length=1, max_length=200)
    status: JobStage = "draft"
    url: str | None = Field(default=None, max_length=500)
    applied_at: date | None = None
    notes: str | None = None
    next_step: str | None = Field(default=None, max_length=200)
    follow_up_on: date | None = None


class JobUpdate(BaseModel):
    company: str | None = Field(default=None, min_length=1, max_length=200)
    role: str | None = Field(default=None, min_length=1, max_length=200)
    status: JobStage | None = None
    url: str | None = Field(default=None, max_length=500)
    applied_at: date | None = None
    notes: str | None = None
    next_step: str | None = Field(default=None, max_length=200)
    follow_up_on: date | None = None


class JobOut(ORMModel):
    id: uuid.UUID
    company: str
    role: str
    status: str
    url: str | None
    applied_at: date | None
    notes: str | None
    next_step: str | None = None
    follow_up_on: date | None = None
    created_at: datetime
    updated_at: datetime | None = None


Grade = Literal["again", "hard", "good", "easy"]


class FlashcardIn(BaseModel):
    deck: str = Field(default="german", min_length=1, max_length=64)
    front: str = Field(min_length=1, max_length=500)
    back: str = Field(min_length=1, max_length=1000)
    example: str | None = Field(default=None, max_length=1000)


class FlashcardUpdate(BaseModel):
    deck: str | None = Field(default=None, min_length=1, max_length=64)
    front: str | None = Field(default=None, min_length=1, max_length=500)
    back: str | None = Field(default=None, min_length=1, max_length=1000)
    example: str | None = Field(default=None, max_length=1000)
    suspended: bool | None = None


class FlashcardImport(BaseModel):
    deck: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=100_000)


class FlashcardOut(ORMModel):
    id: uuid.UUID
    deck: str
    front: str
    back: str
    example: str | None
    ease: float
    interval_days: int
    repetitions: int
    lapses: int
    due_at: datetime
    last_reviewed_at: datetime | None
    suspended: bool
    created_at: datetime


class ReviewIn(BaseModel):
    grade: Grade


MistakeSubject = Literal["german", "english", "coding", "work", "money", "health", "life", "other"]


class MistakeIn(BaseModel):
    subject: MistakeSubject = "german"
    what_happened: str = Field(min_length=1, max_length=1000)
    correction: str = Field(min_length=1, max_length=1000)
    lesson: str | None = Field(default=None, max_length=2000)


class MistakeUpdate(BaseModel):
    subject: MistakeSubject | None = None
    what_happened: str | None = Field(default=None, min_length=1, max_length=1000)
    correction: str | None = Field(default=None, min_length=1, max_length=1000)
    lesson: str | None = Field(default=None, max_length=2000)
    resolved: bool | None = None


class MistakeOut(ORMModel):
    id: uuid.UUID
    subject: str
    what_happened: str
    correction: str
    lesson: str | None
    occurrences: int
    last_seen_at: datetime
    card_id: uuid.UUID | None
    resolved_at: datetime | None
    created_at: datetime


class ToCardIn(BaseModel):
    deck: str | None = Field(default=None, min_length=1, max_length=64)


class ProjectIn(BaseModel):
    client_name: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)
    status: str = Field(default="lead", max_length=32)
    deadline: date | None = None
    value: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    currency: str = "USD"
    notes: str | None = None

    @field_validator("currency")
    @classmethod
    def _cur(cls, value: str) -> str:
        return _currency(value)


class HabitIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    schedule: str = Field(default="daily", max_length=32)
    kind: Literal["build", "avoid"] = "build"
    icon: str | None = Field(default=None, max_length=8)
    reminder_time: time | None = None
    target_per_week: int | None = Field(default=None, ge=1, le=7)


class HabitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    schedule: str | None = Field(default=None, max_length=32)
    kind: Literal["build", "avoid"] | None = None
    icon: str | None = Field(default=None, max_length=8)
    reminder_time: time | None = None
    target_per_week: int | None = Field(default=None, ge=1, le=7)


class HabitLogIn(BaseModel):
    logged_on: date | None = None
    completed: bool = True


class LifeIn(BaseModel):
    entry_type: Literal["travel", "place", "event", "hobby", "social", "date", "journal", "experience"]
    title: str = Field(min_length=1, max_length=200)
    details: str | None = None
    occurred_on: date | None = None


class FocusIn(BaseModel):
    minutes: int = Field(default=25, ge=5, le=180)
    mode: Literal["pomodoro", "focus", "deep"] = "pomodoro"   # pomodoro 25/5, deep 50/10, focus = free length
    task_id: uuid.UUID | None = None
    target: str | None = Field(default=None, max_length=200)
    break_minutes: int | None = Field(default=None, ge=0, le=30)


class FocusFinish(BaseModel):
    distractions: int = Field(default=0, ge=0, le=100)
    notes: str | None = Field(default=None, max_length=4000)    # what got done
    next_step: str | None = Field(default=None, max_length=300)
    rating: int | None = Field(default=None, ge=1, le=5)
    task_done: bool = False                                      # also mark the session's task done
    next_as_task: bool = False                                   # turn the next step into a new task


class CheckinSettingsIn(BaseModel):
    interval_minutes: int = Field(default=30, ge=5, le=240)
    enabled: bool = True
    quiet_start: time | None = None
    quiet_end: time | None = None


class CheckinIn(BaseModel):
    note: str | None = None
    mood: str | None = Field(default=None, max_length=32)


class AuditIn(BaseModel):
    action: str = Field(min_length=1, max_length=64)
    resource: str = Field(min_length=1, max_length=64)
    resource_id: str | None = None
    details: dict = Field(default_factory=dict)


class Recommendation(BaseModel):
    title: str
    detail: str


# ---------- Phase 5: money lists, balances, envelopes (guide section 36) ----------

Currency = Annotated[str, AfterValidator(_currency)]
Money = Annotated[Decimal, Field(ge=0, max_digits=16, decimal_places=2)]
AccountType = Literal["cash", "bank", "wallet", "savings", "other"]
EnvelopeKind = Literal["needs", "savings", "fun", "goal", "other"]


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    account_type: AccountType = "bank"
    currency: Currency = "LKR"
    balance: Decimal = Field(default=Decimal("0"), max_digits=16, decimal_places=2)


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    account_type: AccountType | None = None
    archived: bool | None = None


class ReconcileIn(BaseModel):
    balance: Decimal = Field(max_digits=16, decimal_places=2)
    note: str | None = Field(default=None, max_length=500)
    reason: Literal["reconcile", "correction"] = "reconcile"


class AccountOut(ORMModel):
    id: uuid.UUID
    name: str
    account_type: str
    balance: Decimal
    currency: str
    balance_as_of: datetime | None = None
    archived_at: datetime | None = None
    created_at: datetime


class AdjustmentOut(ORMModel):
    id: uuid.UUID
    account_id: uuid.UUID
    previous_balance: Decimal
    new_balance: Decimal
    difference: Decimal
    reason: str
    note: str | None
    created_at: datetime


class EnvelopeIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    kind: EnvelopeKind = "needs"
    currency: Currency = "LKR"
    monthly_amount: Money
    categories: list[ExpenseCategory] = Field(default_factory=list, max_length=12)


class EnvelopeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    kind: EnvelopeKind | None = None
    monthly_amount: Money | None = None
    categories: list[ExpenseCategory] | None = Field(default=None, max_length=12)


class WishIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    price: Money | None = None
    currency: Currency = "LKR"
    priority: int = Field(default=2, ge=1, le=3)
    category: ExpenseCategory = "shopping"
    link: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    target_date: date | None = None
    cooling_days: int = Field(default=7, ge=0, le=365)


class WishUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    price: Money | None = None
    priority: int | None = Field(default=None, ge=1, le=3)
    category: ExpenseCategory | None = None
    link: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    target_date: date | None = None


class WishDecision(BaseModel):
    action: Literal["bought", "skipped", "reopen"]
    record_expense: bool = True       # "bought": also log it as an expense (one tap)
    amount: Money | None = None       # actual price paid, defaults to the wish price


class WishOut(ORMModel):
    id: uuid.UUID
    name: str
    price: Decimal | None
    currency: str
    priority: int
    category: str
    link: str | None
    notes: str | None
    target_date: date | None
    status: str
    state: str = "waiting"            # waiting | ready | bought | skipped (computed)
    cooling_days: int
    cooling_until: datetime
    days_left: int = 0
    decided_at: datetime | None
    expense_id: uuid.UUID | None
    created_at: datetime


class BuyItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    qty: Decimal = Field(default=Decimal("1"), gt=0, max_digits=10, decimal_places=2)
    unit: str | None = Field(default=None, max_length=16)
    list_name: str = Field(default="groceries", min_length=1, max_length=32)
    store: str | None = Field(default=None, max_length=100)
    est_price: Money | None = None
    currency: Currency = "LKR"
    staple: bool = False
    need_by: date | None = None


class BuyItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    qty: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    unit: str | None = Field(default=None, max_length=16)
    list_name: str | None = Field(default=None, min_length=1, max_length=32)
    store: str | None = Field(default=None, max_length=100)
    est_price: Money | None = None
    staple: bool | None = None
    checked: bool | None = None
    need_by: date | None = None


class BuyItemOut(ORMModel):
    id: uuid.UUID
    name: str
    qty: Decimal
    unit: str | None
    list_name: str
    store: str | None
    est_price: Decimal | None
    currency: str
    staple: bool
    need_by: date | None = None
    checked_at: datetime | None
    expense_id: uuid.UUID | None
    created_at: datetime


class CheckoutIn(BaseModel):
    item_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    amount: Money | None = None       # what you actually paid; defaults to the sum of estimates
    currency: Currency = "LKR"
    category: ExpenseCategory = "food"
    merchant: str | None = Field(default=None, max_length=200)


class CalendarAddIn(BaseModel):
    popup_minutes: int | None = Field(default=10, ge=0, le=40320)    # phone/browser pop-up before start; None = none
    email_minutes: int | None = Field(default=None, ge=0, le=40320)  # Google emails your Gmail this long before; None = none


class ConnectIn(BaseModel):
    write: bool = False  # Calendar only: also allow adding events you confirm (calendar.events instead of calendar.readonly)


# ---------- Goal engine (guide 29) and game (guide 30) ----------

class GoalLevelIn(BaseModel):
    level: Literal["floor", "realistic", "stretch"]
    target_value: Decimal = Field(max_digits=16, decimal_places=2)
    target_date: date | None = None


class GoalLevelsIn(BaseModel):
    levels: list[GoalLevelIn] = Field(max_length=3)


class GameSettingsIn(BaseModel):
    paused: bool | None = None
    daily_cap: int | None = Field(default=None, ge=50, le=300)
    steps_target: int | None = Field(default=None, ge=1000, le=40000)


class PointRuleUpdate(BaseModel):
    points: int | None = Field(default=None, ge=0, le=100)
    daily_cap: int | None = Field(default=None, ge=0, le=300)
    active: bool | None = None


QuestEvent = Literal["focus", "task", "habit", "sleep", "steps", "workout", "weekly_review"]


class QuestIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    event_type: QuestEvent
    target_count: int = Field(ge=1, le=50)
    period: Literal["day", "week"] = "day"
    bonus_points: int = Field(default=30, ge=0, le=100)


class TreatIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    cost_points: int = Field(ge=1, le=100000)
    money_cost: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2)
    currency: str | None = Field(default=None, pattern=r"^[A-Za-z]{3}$")
    wish_id: uuid.UUID | None = None


class TreatUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    cost_points: int | None = Field(default=None, ge=1, le=100000)
    money_cost: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2)
    active: bool | None = None


class RedeemIn(BaseModel):
    confirm: bool = False            # redeeming always needs an explicit yes
    over_budget_ok: bool = False     # money treat when fun money is short: only if you say so


# ---------- "Say it once" commands (guide 34) and AI controls (guide 27) ----------

class CommandIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    source: Literal["voice", "text"] = "text"
    idempotency_key: str | None = Field(default=None, max_length=100)


class CommandAnswerIn(BaseModel):
    answer: str = Field(min_length=1, max_length=200)


AiGroup = Literal["chat", "summary", "memory", "transcription", "voice_parse", "exam", "workers"]


class AiSettingsIn(BaseModel):
    ai_off: bool | None = None
    daily_token_cap: int | None = Field(default=None, ge=0, le=10_000_000)      # 0 = no cap
    monthly_token_cap: int | None = Field(default=None, ge=0, le=500_000_000)   # 0 = no cap
    monthly_cost_cap_usd: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=4)  # 0 = no cap
    disabled_features: list[AiGroup] | None = Field(default=None, max_length=7)
    share_money: bool | None = None
    share_health: bool | None = None


# ---------- Study abroad (guide 39) and coach (guide 26) ----------

StudyStage = Literal["explore", "shortlist", "requirements", "prepare", "apply", "offer", "visa", "move", "dropped"]
Money2 = Annotated[Decimal, Field(ge=0, max_digits=16, decimal_places=2)]


class ProgramIn(BaseModel):
    country: str = Field(min_length=1, max_length=80)
    university: str = Field(min_length=1, max_length=200)
    course: str = Field(min_length=1, max_length=200)
    language: str | None = Field(default=None, max_length=40)
    stage: StudyStage = "explore"
    deadline: date | None = None
    deadline_note: str | None = Field(default=None, max_length=200)
    language_test: str | None = Field(default=None, max_length=80)
    currency: Currency = "EUR"
    application_fee: Money2 | None = None
    tuition_per_year: Money2 | None = None
    living_per_month: Money2 | None = None
    fx_rate_to_lkr: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    fx_rate_date: date | None = None
    link: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=4000)


class ProgramUpdate(BaseModel):
    country: str | None = Field(default=None, min_length=1, max_length=80)
    university: str | None = Field(default=None, min_length=1, max_length=200)
    course: str | None = Field(default=None, min_length=1, max_length=200)
    language: str | None = Field(default=None, max_length=40)
    stage: StudyStage | None = None
    deadline: date | None = None
    deadline_note: str | None = Field(default=None, max_length=200)
    language_test: str | None = Field(default=None, max_length=80)
    application_fee: Money2 | None = None
    tuition_per_year: Money2 | None = None
    living_per_month: Money2 | None = None
    fx_rate_to_lkr: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    fx_rate_date: date | None = None
    link: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=4000)
    verified: bool | None = None   # true = "I checked the official page today"


class ProgramOut(ORMModel):
    id: uuid.UUID
    country: str
    university: str
    course: str
    language: str | None
    stage: str
    deadline: date | None
    deadline_note: str | None
    language_test: str | None
    currency: str
    application_fee: Decimal | None
    tuition_per_year: Decimal | None
    living_per_month: Decimal | None
    fx_rate_to_lkr: Decimal | None
    fx_rate_date: date | None
    link: str | None
    notes: str | None
    last_verified_at: datetime | None
    created_at: datetime


class DaadExplainIn(BaseModel):
    fields: str = Field(min_length=2, max_length=300)
    lang: Literal["en", "de", "any"] = "en"
    free: bool = False


class ChecklistIn(BaseModel):
    create_tasks: bool = True
    portfolio: bool = False


class RequirementUpdate(BaseModel):
    status: Literal["todo", "done", "na"] | None = None
    due_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class RequirementOut(ORMModel):
    id: uuid.UUID
    program_id: uuid.UUID
    kind: str
    title: str
    due_date: date | None
    status: str
    task_id: uuid.UUID | None
    notes: str | None


class StudyCostIn(BaseModel):
    item: Literal["application_fee", "test_fee", "translation", "travel", "visa_fee", "deposit", "first_month", "tuition", "living", "insurance", "other"]
    amount: Money2
    currency: Currency
    note: str | None = Field(default=None, max_length=200)


class ScholarshipIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    provider: str | None = Field(default=None, max_length=200)
    link: str | None = Field(default=None, max_length=500)
    deadline: date | None = None
    amount: Money2 | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Za-z]{3}$")
    eligibility_notes: str | None = Field(default=None, max_length=4000)
    status: Literal["researching", "preparing", "applied", "won", "lost", "dropped"] = "researching"
    program_id: uuid.UUID | None = None


class ScholarshipUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    deadline: date | None = None
    amount: Money2 | None = None
    eligibility_notes: str | None = Field(default=None, max_length=4000)
    status: Literal["researching", "preparing", "applied", "won", "lost", "dropped"] | None = None
    verified: bool | None = None


class ScholarshipOut(ORMModel):
    id: uuid.UUID
    program_id: uuid.UUID | None
    name: str
    provider: str | None
    link: str | None
    deadline: date | None
    amount: Decimal | None
    currency: str | None
    eligibility_notes: str | None
    status: str
    last_verified_at: datetime | None


class DailyCheckinIn(BaseModel):
    energy: int = Field(ge=1, le=5)
    mood: int = Field(ge=1, le=5)
    win: str | None = Field(default=None, max_length=300)
    note: str | None = Field(default=None, max_length=2000)


class CoachDecideIn(BaseModel):
    option_id: str = Field(min_length=1, max_length=40)
    helpful: bool | None = None


class CoachSettingsIn(BaseModel):
    tone: Literal["gentle", "direct"] | None = None
    daily_cap: int | None = Field(default=None, ge=0, le=8)
    muted_kinds: list[Literal["low_sleep", "document_expiring", "overdue_pileup", "overloaded", "focus_drop", "no_exercise", "habit_slipping", "goal_behind", "envelope_over"]] | None = None


# ---------- Life balance (guide 20) and document vault ----------

class AreaIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    unit: str = Field(default="times", max_length=20)
    weekly_target: Decimal = Field(default=Decimal("3"), ge=0, le=1000, max_digits=8, decimal_places=2)


class AreaUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    unit: str | None = Field(default=None, min_length=1, max_length=20)
    weekly_target: Decimal | None = Field(default=None, ge=0, le=1000, max_digits=8, decimal_places=2)
    active: bool | None = None


class AreaLogIn(BaseModel):
    amount: Decimal = Field(default=Decimal("1"), gt=0, le=100, max_digits=6, decimal_places=2)
    note: str | None = Field(default=None, max_length=200)


DocKind = Literal["passport", "visa", "national_id", "driving_license", "insurance", "warranty", "certificate", "transcript", "language_test", "other"]


class DocumentIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: DocKind = "other"
    number: str | None = Field(default=None, max_length=60)
    issued_on: date | None = None
    expires_on: date | None = None
    renew_lead_days: int | None = Field(default=None, ge=0, le=730)
    location_note: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=2000)


class DocumentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: DocKind | None = None
    number: str | None = Field(default=None, max_length=60)   # "" removes it
    issued_on: date | None = None
    expires_on: date | None = None
    renew_lead_days: int | None = Field(default=None, ge=0, le=730)
    location_note: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=2000)


# ---------- Life OS Phase 1: routines, checklists, meals ----------

class RoutineStepIn(BaseModel):
    id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=120)
    detail: str | None = Field(default=None, max_length=200)
    essential: bool = False


def _week_days(value: list[int] | None) -> list[int] | None:
    if value is None:
        return None
    if any(d not in range(1, 8) for d in value):
        raise ValueError("days are 1 (Monday) to 7 (Sunday)")
    return sorted(set(value))


class RoutineIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["routine", "checklist"] = "routine"
    icon: str = Field(default="✨", min_length=1, max_length=8)
    start_time: time | None = None
    duration_minutes: int = Field(default=30, ge=5, le=720)
    day_rule: Literal["fixed", "gym", "work", "off"] = "fixed"
    days: Annotated[list[int], AfterValidator(_week_days)] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6, 7])
    active: bool = True
    steps: list[RoutineStepIn] | None = Field(default=None, max_length=60)


class RoutineUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    kind: Literal["routine", "checklist"] | None = None
    icon: str | None = Field(default=None, min_length=1, max_length=8)
    start_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=720)
    day_rule: Literal["fixed", "gym", "work", "off"] | None = None
    days: Annotated[list[int] | None, AfterValidator(_week_days)] = None
    active: bool | None = None
    steps: list[RoutineStepIn] | None = Field(default=None, max_length=60)


class StepTickIn(BaseModel):
    done: bool = True


class RunModeIn(BaseModel):
    mode: Literal["full", "short"]


class MealIn(BaseModel):
    meal: Literal["breakfast", "lunch", "dinner", "snack"]
    local_date: date | None = None
    slow: bool = False
    no_screen: bool = False
    upright: bool = False
    stopped_80: bool = False
    walked_after: bool = False
    note: str | None = Field(default=None, max_length=200)
    foods: str | None = Field(default=None, max_length=1000)
    eaten_time: time | None = None


# ---------- Life OS Phase 3: exam coach ----------

class ExamPlanUpdate(BaseModel):
    variant: str | None = Field(default=None, max_length=16)
    target_score: Decimal | None = Field(default=None, ge=0, le=100)
    exam_date: date | None = None
    date_is_estimate: bool | None = None
    daily_minutes: int | None = Field(default=None, ge=10, le=240)
    study_days: Annotated[list[int] | None, AfterValidator(_week_days)] = None
    study_time: time | None = None
    active: bool | None = None


class ExamLogIn(BaseModel):
    skill: str = Field(min_length=2, max_length=16)
    minutes: int = Field(ge=1, le=600)
    kind: Literal["practice", "vocab", "mock"] = "practice"
    note: str | None = Field(default=None, max_length=500)
    local_date: date | None = None


class ExamScoreIn(BaseModel):
    skill: str = Field(min_length=2, max_length=16)
    score: Decimal = Field(ge=0, le=100)
    taken_on: date | None = None
    source: Literal["mock", "practice", "real"] = "mock"
    note: str | None = Field(default=None, max_length=200)


class ExamFeedbackIn(BaseModel):
    mode: Literal["writing", "speaking"]
    prompt: str = Field(min_length=3, max_length=4000)
    answer: str = Field(min_length=10, max_length=12000)
    task: Literal["task1", "task2"] = "task2"
    seconds: int = Field(default=0, ge=0, le=900)


# ---------- Life OS Phase 4: AI workers ----------

class WorkerUpdate(BaseModel):
    enabled: bool | None = None
    run_time: time | None = None
    days: Annotated[list[int] | None, AfterValidator(_week_days)] = None
    use_ai: bool | None = None
    daily_token_budget: int | None = Field(default=None, ge=0, le=100000)


class WorkerActIn(BaseModel):
    action_id: str = Field(min_length=1, max_length=40)


class WorkerFeedbackIn(BaseModel):
    feedback: Literal["up", "down"] | None = None


# ---------- Life OS Phase 6: news digest ----------

class NewsInterestsIn(BaseModel):
    interests: list[Annotated[str, Field(min_length=2, max_length=40)]] = Field(max_length=25)


class NewsSourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=10, max_length=500)
    topic: Literal["ai", "tech", "sri_lanka", "markets", "learning", "other"] = "tech"


class NewsSourceUpdate(BaseModel):
    active: bool


# ---------- Life OS Phase 7: CSE investing ----------

class StockTradeIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    trade_date: date
    side: Literal["buy", "sell", "dividend"]
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    price: Decimal = Field(ge=0, max_digits=14, decimal_places=4)
    fees: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)
    note: str | None = Field(default=None, max_length=200)


class WatchIn(BaseModel):
    sector: str | None = Field(default=None, max_length=60)
    target_buy: Decimal | None = Field(default=None, ge=0)
    stop_loss: Decimal | None = Field(default=None, ge=0)
    take_profit: Decimal | None = Field(default=None, ge=0)
    max_pe: Decimal | None = Field(default=None, ge=0, le=1000)
    min_yield: Decimal | None = Field(default=None, ge=0, le=100)
    eps: Decimal | None = None
    dps: Decimal | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=2000)


class ManualPriceIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    close: Decimal = Field(gt=0)
    trade_date: date | None = None


class ImportTextIn(BaseModel):
    text: str = Field(min_length=5, max_length=500000)
    kind: Literal["auto", "prices", "trades"] = "auto"
    trade_date: date | None = None


# ---------- Life Compass ----------

class CompassLogIn(BaseModel):
    amount: Decimal = Field(default=Decimal("1"), gt=0, le=24, max_digits=6, decimal_places=2)
    note: str | None = Field(default=None, max_length=200)


# ---------- Journal ----------

_Line = Annotated[str, Field(max_length=300)]


class JournalIn(BaseModel):
    mood: int | None = Field(default=None, ge=1, le=5)
    did: str | None = Field(default=None, max_length=4000)
    positives: list[_Line] | None = Field(default=None, max_length=10)
    negatives: list[_Line] | None = Field(default=None, max_length=10)
    gratitude: list[_Line] | None = Field(default=None, max_length=5)
    lesson: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=8000)
    tags: list[Annotated[str, Field(max_length=30)]] | None = Field(default=None, max_length=10)


class SubscriptionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: Literal["subscription", "bill", "insurance", "loan", "rent", "membership", "other"] = "subscription"
    amount: Money | None = None
    currency: Currency = "LKR"
    cycle: Literal["weekly", "monthly", "quarterly", "yearly"] = "monthly"
    next_due: date
    remind_days: int = Field(default=3, ge=0, le=60)
    auto_renews: bool = True
    link: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)


class SubscriptionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: Literal["subscription", "bill", "insurance", "loan", "rent", "membership", "other"] | None = None
    amount: Money | None = None
    currency: Currency | None = None
    cycle: Literal["weekly", "monthly", "quarterly", "yearly"] | None = None
    next_due: date | None = None
    remind_days: int | None = Field(default=None, ge=0, le=60)
    auto_renews: bool | None = None
    active: bool | None = None
    link: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)


class SubscriptionPaidIn(BaseModel):
    record_expense: bool = False
    amount: Money | None = None


class CaptureMoveIn(BaseModel):
    """Where an inbox item goes. Only `target` is required; the rest fill in the new record."""
    target: Literal["task", "goal", "habit", "wish", "buy", "memory"]
    title: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, max_length=32)
    priority: Priority | None = None
    due_at: datetime | None = None
    due_date: date | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=1440)
    recurrence: Recurrence = None
    target_value: Decimal | None = None
    unit: str | None = Field(default=None, max_length=32)
    price: Money | None = None
    currency: Currency | None = None
    list_name: str | None = Field(default=None, max_length=32)
    icon: str | None = Field(default=None, max_length=8)
    reminder_time: time | None = None


class SetIn(BaseModel):
    exercise: str = Field(min_length=1, max_length=80)
    weight_kg: Decimal | None = Field(default=None, ge=0, le=1000, max_digits=6, decimal_places=2)
    reps: int | None = Field(default=None, ge=0, le=1000)
    seconds: int | None = Field(default=None, ge=0, le=36000)


class GymWorkoutIn(BaseModel):
    title: str | None = Field(default=None, max_length=100)
    started_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    calories: Decimal | None = Field(default=None, ge=0, le=10000)
    notes: str | None = Field(default=None, max_length=2000)
    sets: list[SetIn] = Field(default_factory=list, max_length=120)


class CourseIn(BaseModel):
    platform: str = Field(default="Coursera", min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=500)
    status: Literal["planned", "active", "paused", "done"] = "active"
    progress_pct: int = Field(default=0, ge=0, le=100)
    hours_spent: Decimal = Field(default=Decimal("0"), ge=0, le=10000)
    target_date: date | None = None
    certificate_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)


class CourseUpdate(BaseModel):
    platform: str | None = Field(default=None, min_length=1, max_length=40)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=500)
    status: Literal["planned", "active", "paused", "done"] | None = None
    progress_pct: int | None = Field(default=None, ge=0, le=100)
    hours_spent: Decimal | None = Field(default=None, ge=0, le=10000)
    add_hours: Decimal | None = Field(default=None, gt=0, le=24)
    target_date: date | None = None
    certificate_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)


class CodingProfileIn(BaseModel):
    platform: Literal["leetcode", "hackerrank", "github", "codeforces"]
    username: str = Field(min_length=1, max_length=60, pattern=r"^[A-Za-z0-9_.-]+$")


TimeCategory = Literal["work", "deep_work", "meeting", "study", "exercise", "commute", "chores", "family", "social", "rest", "entertainment", "wasted", "sleep", "other"]


class TimeEntryIn(BaseModel):
    local_date: date
    start_time: time
    end_time: time
    category: TimeCategory
    note: str | None = Field(default=None, max_length=300)
    source: Literal["manual", "prompt", "focus", "routine"] = "manual"


class UsageApp(BaseModel):
    package: str = Field(max_length=200)
    label: str = Field(max_length=120)
    category: str = Field(default="other", max_length=32)
    mark: Literal["distracting", "neutral", "productive"] = "neutral"
    minutes: int = Field(ge=0, le=1440)


class DeviceUsageIn(BaseModel):
    local_date: date
    total_minutes: int = Field(ge=0, le=1440)
    distracting_minutes: int = Field(default=0, ge=0, le=1440)
    productive_minutes: int = Field(default=0, ge=0, le=1440)
    pickups: int = Field(default=0, ge=0, le=5000)
    apps: list[UsageApp] = Field(default_factory=list, max_length=40)
    hourly: list[int] = Field(default_factory=list, max_length=24)
