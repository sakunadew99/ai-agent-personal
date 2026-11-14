import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Priority = Literal["low", "medium", "high"]
TaskStatus = Literal["inbox", "todo", "in_progress", "done", "cancelled"]
GoalStatus = Literal["active", "paused", "completed", "archived"]
RecordKind = Literal["actual", "estimated", "projected"]
ExpenseCategory = Literal[
    "food", "transport", "housing", "subscriptions", "shopping", "health", "education", "business", "savings", "other"
]
IncomeSource = Literal["salary", "freelance", "business", "other"]
ToolMode = Literal["allow", "approval", "deny"]


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


class GoalUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = Field(default=None, max_length=32)
    target_value: Decimal | None = None
    current_value: Decimal | None = None
    unit: str | None = None
    due_date: date | None = None
    status: GoalStatus | None = None


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


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = None
    category: str | None = None
    priority: Priority | None = None
    status: TaskStatus | None = None
    due_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=1440)
    goal_id: uuid.UUID | None = None


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
    completed_at: datetime | None
    created_at: datetime


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


class MemoryIn(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    category: str = Field(default="note", max_length=32)
    allow_sensitive: bool = False
    pinned: bool = False


class MemoryUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=8000)
    category: str | None = None
    pinned: bool | None = None
    allow_sensitive: bool = False


class MemoryOut(ORMModel):
    id: uuid.UUID
    category: str
    content: str
    source: str
    sensitivity: str
    pinned: bool
    created_at: datetime
    updated_at: datetime


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


class JobIn(BaseModel):
    company: str = Field(min_length=1, max_length=200)
    role: str = Field(min_length=1, max_length=200)
    status: str = Field(default="draft", max_length=32)
    url: str | None = Field(default=None, max_length=500)
    applied_at: date | None = None
    notes: str | None = None


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
    mode: Literal["pomodoro", "focus"] = "pomodoro"
    task_id: uuid.UUID | None = None


class FocusFinish(BaseModel):
    distractions: int = Field(default=0, ge=0, le=100)
    notes: str | None = None


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
