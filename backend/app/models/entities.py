import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.types import EmbeddingType, JsonDict, utcnow


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def user_fk(nullable: bool = False) -> Mapped[uuid.UUID]:
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=nullable)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Colombo")
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    wake_time: Mapped[time] = mapped_column(Time, default=time(7, 0))
    sleep_time: Mapped[time] = mapped_column(Time, default=time(23, 30))
    work_start: Mapped[time | None] = mapped_column(Time, nullable=True, default=time(9, 0))
    work_end: Mapped[time | None] = mapped_column(Time, nullable=True, default=time(17, 0))
    gym_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    # 1 = Monday ... 7 = Sunday. null = every day (the old behaviour).
    work_days: Mapped[list | None] = mapped_column(JsonDict, nullable=True)
    gym_days: Mapped[list | None] = mapped_column(JsonDict, nullable=True)
    news_interests: Mapped[list | None] = mapped_column(JsonDict, nullable=True)   # Phase 6: topics that rank news higher
    financial_target_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    financial_target_currency: Mapped[str] = mapped_column(String(3), default="USD")
    financial_target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    automation_policy: Mapped[str] = mapped_column(String(16), default="confirm")
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserPermission(Base):
    __tablename__ = "user_permissions"
    __table_args__ = (UniqueConstraint("user_id", "tool_name", name="uq_permission_user_tool"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    tool_name: Mapped[str] = mapped_column(String(64))
    mode: Mapped[str] = mapped_column(String(16), default="approval")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    title: Mapped[str] = mapped_column(String(200), default="New conversation")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = user_fk()
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    actions: Mapped[dict] = mapped_column(JsonDict, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    category: Mapped[str] = mapped_column(String(32), default="note")
    content: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(32), default="user")
    sensitivity: Mapped[str] = mapped_column(String(16), default="normal")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    # Second brain (Phase 2): what kind of memory this is, and gentle resurfacing state.
    intent_type: Mapped[str] = mapped_column(String(16), default="fact", server_default="fact")  # fact|preference|interest|intention|commitment
    topic: Mapped[str | None] = mapped_column(String(120), nullable=True)
    surface_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_surfaced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    snooze_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MemoryEmbedding(Base):
    __tablename__ = "memory_embeddings"

    id: Mapped[uuid.UUID] = pk()
    memory_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[uuid.UUID] = user_fk()
    embedding: Mapped[list] = mapped_column(EmbeddingType(1536))
    model: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(32), default="personal")
    status: Mapped[str] = mapped_column(String(16), default="active")
    target_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    current_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Where progress comes from: manual | savings_balance | all_accounts | income_since_start | focus_hours |
    # tasks_done | milestones_done (see services/goal_engine.py). Money metrics use metric_currency.
    metric: Mapped[str] = mapped_column(String(32), default="manual", server_default="manual")
    metric_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GoalLevel(Base):
    """Floor / realistic / stretch targets for one goal (guide 29.2)."""
    __tablename__ = "goal_levels"
    __table_args__ = (
        UniqueConstraint("goal_id", "level", name="uq_goal_levels_goal_level"),
        CheckConstraint("level IN ('floor','realistic','stretch')", name="ck_goal_levels_level"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    goal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), index=True)
    level: Mapped[str] = mapped_column(String(16))
    target_value: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GoalSnapshot(Base):
    """One value per goal per day, so trends exist even for manual and balance-based goals."""
    __tablename__ = "goal_snapshots"
    __table_args__ = (UniqueConstraint("goal_id", "snapshot_date", name="uq_goal_snapshots_goal_date"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    goal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), index=True)
    snapshot_date: Mapped[date] = mapped_column(Date)
    value: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (Index("ix_tasks_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    goal_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("goals.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(32), default="personal")
    status: Mapped[str] = mapped_column(String(16), default="todo")
    priority: Mapped[str] = mapped_column(String(16), default="medium")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recurrence: Mapped[str | None] = mapped_column(String(200), nullable=True)  # RRULE subset, see services/recurrence.py
    calendar_event_id: Mapped[str | None] = mapped_column(String(1024), nullable=True)  # set when you add it to Google Calendar
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GoalMilestone(Base):
    __tablename__ = "goal_milestones"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    goal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DailyPlan(Base):
    __tablename__ = "daily_plans"
    __table_args__ = (UniqueConstraint("user_id", "plan_date", name="uq_daily_plan_user_date"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    plan_date: Mapped[date] = mapped_column(Date, index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict] = mapped_column(JsonDict, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlanItem(Base):
    __tablename__ = "plan_items"

    id: Mapped[uuid.UUID] = pk()
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("daily_plans.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = user_fk()
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    kind: Mapped[str] = mapped_column(String(16), default="fixed")
    status: Mapped[str] = mapped_column(String(16), default="planned")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CheckinSetting(Base):
    __tablename__ = "checkin_settings"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=30)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    quiet_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    quiet_end: Mapped[time | None] = mapped_column(Time, nullable=True)


class CheckinLog(Base):
    __tablename__ = "checkin_logs"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    mood: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(32), default="info")
    dedupe_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Income(Base):
    __tablename__ = "income"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    source: Mapped[str] = mapped_column(String(32))
    record_kind: Mapped[str] = mapped_column(String(16), default="actual")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    category: Mapped[str] = mapped_column(String(32))
    scope: Mapped[str] = mapped_column(String(16), default="personal")
    record_kind: Mapped[str] = mapped_column(String(16), default="actual")
    merchant: Mapped[str | None] = mapped_column(String(200), nullable=True)
    spent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FinancialAccount(Base):
    __tablename__ = "financial_accounts"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(200))
    account_type: Mapped[str] = mapped_column(String(32))
    balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    record_kind: Mapped[str] = mapped_column(String(16), default="actual")
    balance_as_of: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AccountAdjustment(Base):
    """Every balance change is recorded; balances are never silently overwritten (guide 36.4)."""
    __tablename__ = "account_adjustments"
    __table_args__ = (CheckConstraint("reason IN ('opening','reconcile','correction')", name="ck_account_adjustments_reason"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("financial_accounts.id", ondelete="CASCADE"), index=True)
    previous_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    new_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    difference: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    reason: Mapped[str] = mapped_column(String(16), default="reconcile")
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Envelope(Base):
    __tablename__ = "envelopes"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_envelopes_user_name"),
        CheckConstraint("kind IN ('needs','savings','fun','goal','other')", name="ck_envelopes_kind"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16), default="needs")
    currency: Mapped[str] = mapped_column(String(3))
    monthly_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    categories: Mapped[list] = mapped_column(JsonDict, default=list)  # expense categories counted against it
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (
        CheckConstraint("status IN ('active','bought','skipped')", name="ck_wishlist_items_status"),
        CheckConstraint("priority BETWEEN 1 AND 3", name="ck_wishlist_items_priority"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(200))
    price: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(3))
    priority: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    category: Mapped[str] = mapped_column(String(32), default="shopping")
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    cooling_days: Mapped[int] = mapped_column(Integer, default=7, server_default="7")
    cooling_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expense_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PriceNote(Base):
    __tablename__ = "price_notes"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    wish_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("wishlist_items.id", ondelete="CASCADE"), index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    noted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BuyListItem(Base):
    __tablename__ = "buy_list_items"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(200))
    qty: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1"), server_default="1")
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    list_name: Mapped[str] = mapped_column(String(32), default="groceries", server_default="groceries")
    store: Mapped[str | None] = mapped_column(String(100), nullable=True)
    est_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)  # estimated line total
    currency: Mapped[str] = mapped_column(String(3))
    staple: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expense_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(32), default="other")
    value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    record_kind: Mapped[str] = mapped_column(String(16), default="actual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Liability(Base):
    __tablename__ = "liabilities"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(32), default="other")
    balance: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    record_kind: Mapped[str] = mapped_column(String(16), default="actual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CareerProfile(Base):
    __tablename__ = "career_profiles"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    headline: Mapped[str | None] = mapped_column(String(200), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    skills: Mapped[list] = mapped_column(JsonDict, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JobApplication(Base):
    __tablename__ = "job_applications"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    company: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), default="draft")
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    applied_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_step: Mapped[str | None] = mapped_column(String(200), nullable=True)
    follow_up_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Flashcard(Base):
    """A spaced-repetition card (SM-2). Scheduling is plain code in services/learning.py."""
    __tablename__ = "flashcards"
    __table_args__ = (
        UniqueConstraint("user_id", "deck", "front", name="uq_flashcards_user_deck_front"),
        Index("ix_flashcards_user_due", "user_id", "due_at"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    deck: Mapped[str] = mapped_column(String(64), default="german")
    front: Mapped[str] = mapped_column(String(500))
    back: Mapped[str] = mapped_column(String(1000))
    example: Mapped[str | None] = mapped_column(Text, nullable=True)
    ease: Mapped[float] = mapped_column(Float, default=2.5, server_default="2.5")
    interval_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    repetitions: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    lapses: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    suspended: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FlashcardReview(Base):
    __tablename__ = "flashcard_reviews"
    __table_args__ = (CheckConstraint("grade IN ('again','hard','good','easy')", name="ck_flashcard_reviews_grade"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    card_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("flashcards.id", ondelete="CASCADE"), index=True)
    grade: Mapped[str] = mapped_column(String(8))
    interval_days: Mapped[int] = mapped_column(Integer)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Mistake(Base):
    """Mistake notebook: what went wrong, the right way, and how often it happened."""
    __tablename__ = "mistakes"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    subject: Mapped[str] = mapped_column(String(32), default="german")
    what_happened: Mapped[str] = mapped_column(String(1000))
    correction: Mapped[str] = mapped_column(String(1000))
    lesson: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurrences: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    card_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("flashcards.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FreelanceProject(Base):
    __tablename__ = "freelance_projects"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    client_name: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), default="lead")
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    value: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Habit(Base):
    __tablename__ = "habits"
    __table_args__ = (CheckConstraint("kind IN ('build','avoid')", name="ck_habits_kind"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(200))
    schedule: Mapped[str] = mapped_column(String(32), default="daily")
    # "build" = do it (log = done); "avoid" = stay away from it (log completed = clean day, not completed = slipped).
    kind: Mapped[str] = mapped_column(String(8), default="build", server_default="build")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HabitLog(Base):
    __tablename__ = "habit_logs"
    __table_args__ = (UniqueConstraint("habit_id", "logged_on", name="uq_habit_log_day"),)

    id: Mapped[uuid.UUID] = pk()
    habit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = user_fk()
    logged_on: Mapped[date] = mapped_column(Date)
    completed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HealthRecord(Base):
    __tablename__ = "health_records"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    metric: Mapped[str] = mapped_column(String(32))
    value: Mapped[Decimal] = mapped_column(Numeric(14, 3))
    unit: Mapped[str] = mapped_column(String(32))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(32), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Workout(Base):
    __tablename__ = "workouts"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    activity: Mapped[str] = mapped_column(String(100))
    duration_minutes: Mapped[int] = mapped_column(Integer)
    calories: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SleepRecord(Base):
    __tablename__ = "sleep_records"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[int] = mapped_column(Integer)
    stages: Mapped[dict | None] = mapped_column(JsonDict, nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FocusSession(Base):
    __tablename__ = "focus_sessions"
    __table_args__ = (CheckConstraint("rating IS NULL OR rating BETWEEN 1 AND 5", name="ck_focus_sessions_rating"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    mode: Mapped[str] = mapped_column(String(16), default="pomodoro")
    minutes_planned: Mapped[int] = mapped_column(Integer, default=25)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    distractions: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)          # review: what got done
    # Phase 2 focus engine ("1 hour, 1 task")
    target: Mapped[str | None] = mapped_column(String(200), nullable=True)  # the clear target set before starting
    break_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_step: Mapped[str | None] = mapped_column(String(300), nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)      # 1-5: how focused it felt


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    tool_name: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JsonDict, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    result: Mapped[dict | None] = mapped_column(JsonDict, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    actor: Mapped[str] = mapped_column(String(32), default="user")
    action: Mapped[str] = mapped_column(String(64))
    resource: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict] = mapped_column(JsonDict, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_idempotency_user_key"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    key: Mapped[str] = mapped_column(String(200))
    request_hash: Mapped[str] = mapped_column(String(64))
    response_json: Mapped[dict] = mapped_column(JsonDict, default=dict)
    status_code: Mapped[int] = mapped_column(Integer, default=200)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CaptureItem(Base):
    __tablename__ = "capture_items"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    raw_text: Mapped[str] = mapped_column(Text)
    classified_type: Mapped[str] = mapped_column(String(32))
    extracted: Mapped[dict] = mapped_column(JsonDict, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="pending")  # "needs_confirmation" is 18 chars
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LifeEntry(Base):
    __tablename__ = "life_entries"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    entry_type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(200))
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AiUsage(Base):
    __tablename__ = "ai_usage"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    feature: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(64))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    estimated_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IntegrationConnection(Base):
    """A connected outside account (Phase 5: Gmail read-only). Tokens are Fernet-encrypted; the key lives outside the DB."""
    __tablename__ = "integration_connections"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_integration_connections_user_provider"),
        CheckConstraint("status IN ('connected','expired','error')", name="ck_integration_connections_status"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    provider: Mapped[str] = mapped_column(String(32))
    account_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    scopes: Mapped[str] = mapped_column(String(1000), default="")
    refresh_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="connected")
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OAuthState(Base):
    """One-time OAuth `state` (stored as a hash) with its PKCE verifier (encrypted). Valid 10 minutes, single use."""
    __tablename__ = "oauth_states"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    provider: Mapped[str] = mapped_column(String(32))
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    verifier_enc: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)



# ---------- Game and rewards (guide section 30) ----------

class GameSettings(Base):
    __tablename__ = "game_settings"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    paused: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    daily_cap: Mapped[int] = mapped_column(Integer, default=150, server_default="150")
    steps_target: Mapped[int] = mapped_column(Integer, default=8000, server_default="8000")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PointRule(Base):
    """Rules are data, not code (guide 30.4): tune points and caps without a release."""
    __tablename__ = "point_rules"
    __table_args__ = (UniqueConstraint("user_id", "event_type", name="uq_point_rules_user_event"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    event_type: Mapped[str] = mapped_column(String(32))
    points: Mapped[int] = mapped_column(Integer)
    daily_cap: Mapped[int] = mapped_column(Integer)
    area: Mapped[str] = mapped_column(String(32))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PointsLedger(Base):
    """Append-only. (user, event, ref) is unique, so retries and re-completions never double count."""
    __tablename__ = "points_ledger"
    __table_args__ = (
        UniqueConstraint("user_id", "event_type", "ref_id", name="uq_points_ledger_user_event_ref"),
        Index("ix_points_ledger_user_date", "user_id", "local_date"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    event_type: Mapped[str] = mapped_column(String(32))
    ref_id: Mapped[str] = mapped_column(String(100))
    points: Mapped[int] = mapped_column(Integer)
    area: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(String(200))
    local_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Quest(Base):
    __tablename__ = "quests"
    __table_args__ = (
        CheckConstraint("period IN ('day','week')", name="ck_quests_period"),
        CheckConstraint("status IN ('active','archived')", name="ck_quests_status"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    title: Mapped[str] = mapped_column(String(120))
    event_type: Mapped[str] = mapped_column(String(32))
    target_count: Mapped[int] = mapped_column(Integer)
    period: Mapped[str] = mapped_column(String(8), default="day")
    bonus_points: Mapped[int] = mapped_column(Integer, default=30)
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Treat(Base):
    __tablename__ = "treats"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(120))
    cost_points: Mapped[int] = mapped_column(Integer)
    money_cost: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    wish_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("wishlist_items.id", ondelete="SET NULL"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Redemption(Base):
    __tablename__ = "redemptions"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    treat_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("treats.id", ondelete="SET NULL"), nullable=True)
    treat_name: Mapped[str] = mapped_column(String(120))
    points_spent: Mapped[int] = mapped_column(Integer)
    money_cost: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)



class AiSettings(Base):
    """AI gateway controls (guide 27.3-27.4): off switch, token/cost caps, per-feature off, data sharing per area."""
    __tablename__ = "ai_settings"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    ai_off: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    daily_token_cap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_token_cap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_cost_cap_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    disabled_features: Mapped[list] = mapped_column(JsonDict, default=list)
    share_money: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    share_health: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CapturedCommand(Base):
    """'Say it once' (guide 34): what you said, how it was understood, and what was created (so it can be undone)."""
    __tablename__ = "captured_commands"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_captured_commands_user_key"),
        CheckConstraint("status IN ('created','needs_answer','cancelled','undone')", name="ck_captured_commands_status"),
        CheckConstraint("source IN ('voice','text')", name="ck_captured_commands_source"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    raw_text: Mapped[str | None] = mapped_column(String(500), nullable=True)   # deletable for privacy
    source: Mapped[str] = mapped_column(String(8), default="text")
    parsed: Mapped[dict] = mapped_column(JsonDict, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="needs_answer")
    question: Mapped[str | None] = mapped_column(String(300), nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)



# ---------- Study abroad planner (guide 39) ----------

STUDY_STAGES = ("explore", "shortlist", "requirements", "prepare", "apply", "offer", "visa", "move", "dropped")


class StudyProgram(Base):
    __tablename__ = "study_programs"
    __table_args__ = (CheckConstraint("stage IN ('explore','shortlist','requirements','prepare','apply','offer','visa','move','dropped')",
                                      name="ck_study_programs_stage"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    country: Mapped[str] = mapped_column(String(80))
    university: Mapped[str] = mapped_column(String(200))
    course: Mapped[str] = mapped_column(String(200))
    language: Mapped[str | None] = mapped_column(String(40), nullable=True)
    stage: Mapped[str] = mapped_column(String(16), default="explore", server_default="explore")
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    deadline_note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    language_test: Mapped[str | None] = mapped_column(String(80), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    application_fee: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    tuition_per_year: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    living_per_month: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    fx_rate_to_lkr: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    fx_rate_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProgramRequirement(Base):
    __tablename__ = "program_requirements"
    __table_args__ = (
        UniqueConstraint("program_id", "kind", name="uq_program_requirements_program_kind"),
        CheckConstraint("status IN ('todo','done','na')", name="ck_program_requirements_status"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    program_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("study_programs.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(8), default="todo", server_default="todo")
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StudyCost(Base):
    __tablename__ = "study_costs"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    program_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("study_programs.id", ondelete="CASCADE"), index=True)
    item: Mapped[str] = mapped_column(String(32))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Scholarship(Base):
    __tablename__ = "scholarships"
    __table_args__ = (CheckConstraint("status IN ('researching','preparing','applied','won','lost','dropped')", name="ck_scholarships_status"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    program_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("study_programs.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str | None] = mapped_column(String(200), nullable=True)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    eligibility_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="researching", server_default="researching")
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- Coach (guide 26) ----------

class CoachSettings(Base):
    __tablename__ = "coach_settings"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    tone: Mapped[str] = mapped_column(String(8), default="gentle", server_default="gentle")
    daily_cap: Mapped[int] = mapped_column(Integer, default=3, server_default="3")
    muted_kinds: Mapped[list] = mapped_column(JsonDict, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DailyCheckin(Base):
    __tablename__ = "daily_checkins"
    __table_args__ = (
        UniqueConstraint("user_id", "local_date", name="uq_daily_checkins_user_date"),
        CheckConstraint("energy BETWEEN 1 AND 5", name="ck_daily_checkins_energy"),
        CheckConstraint("mood BETWEEN 1 AND 5", name="ck_daily_checkins_mood"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    local_date: Mapped[date] = mapped_column(Date)
    energy: Mapped[int] = mapped_column(Integer)
    mood: Mapped[int] = mapped_column(Integer)
    win: Mapped[str | None] = mapped_column(String(300), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CoachSuggestion(Base):
    """Output of the plain-code rules: evidence + 1-3 options. One per kind per day."""
    __tablename__ = "coach_suggestions"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "local_date", name="uq_coach_suggestions_user_kind_date"),
        CheckConstraint("status IN ('proposed','accepted','dismissed','expired')", name="ck_coach_suggestions_status"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    kind: Mapped[str] = mapped_column(String(32))
    local_date: Mapped[date] = mapped_column(Date)
    message: Mapped[str] = mapped_column(String(500))
    evidence: Mapped[dict] = mapped_column(JsonDict, default=dict)
    options: Mapped[list] = mapped_column(JsonDict, default=list)
    status: Mapped[str] = mapped_column(String(16), default="proposed", server_default="proposed")
    choice: Mapped[str | None] = mapped_column(String(40), nullable=True)
    helpful: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)



# ---------- Whole-life balance (guide 20) ----------

class LifeArea(Base):
    """A life area with a weekly target. 'metric' says how actual is measured from data you already log."""
    __tablename__ = "life_areas"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_life_areas_user_key"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    key: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(60))
    metric: Mapped[str] = mapped_column(String(32), default="manual")
    unit: Mapped[str] = mapped_column(String(20), default="times")
    weekly_target: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("3"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AreaEntry(Base):
    """Manual 'I did this' log for an area (rest block, called a friend...). Adds to the measured actual."""
    __tablename__ = "area_entries"
    __table_args__ = (Index("ix_area_entries_user_date", "user_id", "local_date"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    area_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("life_areas.id", ondelete="CASCADE"), index=True)
    local_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1"))
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- Document vault (guide 39.6 / 32): what you have, where it is, when it expires ----------

class VaultDocument(Base):
    """No files are uploaded. The document number (if you add one) is encrypted with TOKEN_ENCRYPTION_KEY."""
    __tablename__ = "vault_documents"
    __table_args__ = (CheckConstraint(
        "kind IN ('passport','visa','national_id','driving_license','insurance','warranty','certificate','transcript','language_test','other')",
        name="ck_vault_documents_kind"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="other")
    number_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    number_hint: Mapped[str | None] = mapped_column(String(4), nullable=True)   # last 3 characters, for recognising it
    issued_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    renew_lead_days: Mapped[int] = mapped_column(Integer, default=30)
    location_note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reminder_task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- Phase 1 Life OS: routines, checklists and meals ----------

class Routine(Base):
    """A routine (timed steps, e.g. Morning) or a checklist (e.g. Gym bag). days: 1 = Monday ... 7 = Sunday."""
    __tablename__ = "routines"
    __table_args__ = (
        CheckConstraint("kind IN ('routine','checklist')", name="ck_routines_kind"),
        CheckConstraint("duration_minutes BETWEEN 5 AND 720", name="ck_routines_duration"),
        CheckConstraint("day_rule IN ('fixed','gym','work','off')", name="ck_routines_day_rule"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(60))
    kind: Mapped[str] = mapped_column(String(16), default="routine")
    icon: Mapped[str] = mapped_column(String(8), default="✨")
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)   # null = at wake-up (routines) / any time (checklists)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    # Which days it runs: "fixed" = the listed days; "gym" / "work" / "off" = follow the profile's gym days, work days,
    # or the days that aren't work days (so the weekend routine moves with your work week).
    day_rule: Mapped[str] = mapped_column(String(8), default="fixed", server_default="fixed")
    days: Mapped[list] = mapped_column(JsonDict, default=list)            # [1..7] used when day_rule = "fixed"
    position: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RoutineStep(Base):
    __tablename__ = "routine_steps"

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    routine_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routines.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(120))
    detail: Mapped[str | None] = mapped_column(String(200), nullable=True)
    essential: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")  # part of the short version
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RoutineRun(Base):
    """One routine on one day: which steps are ticked, full or short version, done or skipped."""
    __tablename__ = "routine_runs"
    __table_args__ = (
        UniqueConstraint("routine_id", "run_date", name="uq_routine_runs_routine_date"),
        CheckConstraint("status IN ('open','done','skipped')", name="ck_routine_runs_status"),
        CheckConstraint("mode IN ('full','short')", name="ck_routine_runs_mode"),
        Index("ix_routine_runs_user_date", "user_id", "run_date"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    routine_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routines.id", ondelete="CASCADE"), index=True)
    run_date: Mapped[date] = mapped_column(Date)
    mode: Mapped[str] = mapped_column(String(8), default="full")
    status: Mapped[str] = mapped_column(String(8), default="open")
    done_step_ids: Mapped[list] = mapped_column(JsonDict, default=list)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MealLog(Base):
    """Mindful-eating check after a meal (your eating rules). Five yes/no answers; no calories, no judging."""
    __tablename__ = "meal_logs"
    __table_args__ = (CheckConstraint("meal IN ('breakfast','lunch','dinner','snack')", name="ck_meal_logs_meal"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    meal: Mapped[str] = mapped_column(String(10))
    local_date: Mapped[date] = mapped_column(Date, index=True)
    slow: Mapped[bool] = mapped_column(Boolean, default=False)
    no_screen: Mapped[bool] = mapped_column(Boolean, default=False)
    upright: Mapped[bool] = mapped_column(Boolean, default=False)
    stopped_80: Mapped[bool] = mapped_column(Boolean, default=False)
    walked_after: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    foods: Mapped[str | None] = mapped_column(Text, nullable=True)            # what you ate, e.g. "rice, dhal, chicken curry"
    eaten_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- Life OS Phase 3: exam coach (IELTS, Goethe German) ----------

class ExamPlan(Base):
    """One exam you're preparing for. IELTS scores are bands (0-9); Goethe scores are points per module (0-100)."""
    __tablename__ = "exam_plans"
    __table_args__ = (
        UniqueConstraint("user_id", "exam", name="uq_exam_plans_user_exam"),
        CheckConstraint("exam IN ('ielts','goethe')", name="ck_exam_plans_exam"),
        CheckConstraint("daily_minutes BETWEEN 10 AND 240", name="ck_exam_plans_minutes"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    exam: Mapped[str] = mapped_column(String(8))
    variant: Mapped[str] = mapped_column(String(16))                 # IELTS: academic | general; Goethe: A1 ... C1
    target_score: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    exam_date: Mapped[date] = mapped_column(Date)
    date_is_estimate: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    daily_minutes: Mapped[int] = mapped_column(Integer, default=30)
    study_days: Mapped[list] = mapped_column(JsonDict, default=list)  # 1 = Monday ... 7 = Sunday
    study_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ExamScore(Base):
    """A score for one skill: a mock test, a practice test, the real exam, or an AI estimate."""
    __tablename__ = "exam_scores"
    __table_args__ = (
        CheckConstraint("source IN ('mock','practice','real','estimate')", name="ck_exam_scores_source"),
        Index("ix_exam_scores_plan_date", "plan_id", "taken_on"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exam_plans.id", ondelete="CASCADE"))
    skill: Mapped[str] = mapped_column(String(16))
    score: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    taken_on: Mapped[date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(8), default="mock")
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ExamLog(Base):
    """Study time, and writing / speaking practice with its feedback."""
    __tablename__ = "exam_logs"
    __table_args__ = (
        CheckConstraint("kind IN ('practice','vocab','mock','writing','speaking')", name="ck_exam_logs_kind"),
        CheckConstraint("minutes BETWEEN 0 AND 600", name="ck_exam_logs_minutes"),
        Index("ix_exam_logs_plan_date", "plan_id", "local_date"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exam_plans.id", ondelete="CASCADE"))
    skill: Mapped[str] = mapped_column(String(16))
    kind: Mapped[str] = mapped_column(String(12), default="practice")
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    local_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback: Mapped[dict | None] = mapped_column(JsonDict, nullable=True)
    estimated_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    used_ai: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- Life OS Phase 4: AI workers (a small team that leaves notes on the Today card) ----------

class AiWorker(Base):
    """One helper with one job. Facts come from plain code; AI (if allowed and within budget) only writes the note."""
    __tablename__ = "ai_workers"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_ai_workers_user_key"),
        CheckConstraint("daily_token_budget BETWEEN 0 AND 100000", name="ck_ai_workers_budget"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    key: Mapped[str] = mapped_column(String(32))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    run_time: Mapped[time] = mapped_column(Time)
    days: Mapped[list] = mapped_column(JsonDict, default=list)          # 1 = Monday ... 7 = Sunday
    use_ai: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    daily_token_budget: Mapped[int] = mapped_column(Integer, default=3000, server_default="3000")
    last_run_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WorkerNote(Base):
    """A worker's note for one day (re-running replaces it). Actions are code-defined, never free text."""
    __tablename__ = "worker_notes"
    __table_args__ = (
        UniqueConstraint("user_id", "worker_key", "local_date", name="uq_worker_notes_user_worker_date"),
        CheckConstraint("status IN ('new','read','done','dismissed')", name="ck_worker_notes_status"),
        CheckConstraint("feedback IS NULL OR feedback IN ('up','down')", name="ck_worker_notes_feedback"),
        Index("ix_worker_notes_user_date", "user_id", "local_date"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    worker_key: Mapped[str] = mapped_column(String(32))
    local_date: Mapped[date] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text)
    facts: Mapped[dict] = mapped_column(JsonDict, default=dict)
    actions: Mapped[list] = mapped_column(JsonDict, default=list)
    used_ai: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    status: Mapped[str] = mapped_column(String(10), default="new", server_default="new")
    feedback: Mapped[str | None] = mapped_column(String(4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- Life OS Phase 5: learns you (weekly "about you" report, AI answer cache) ----------

class InsightReport(Base):
    """The weekly 'about you' report: patterns found by plain code, one change to try, optional AI wording."""
    __tablename__ = "insight_reports"
    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_insight_reports_user_week"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    week_start: Mapped[date] = mapped_column(Date)
    data: Mapped[dict] = mapped_column(JsonDict, default=dict)
    findings: Mapped[list] = mapped_column(JsonDict, default=list)
    change: Mapped[dict | None] = mapped_column(JsonDict, nullable=True)
    body: Mapped[str] = mapped_column(Text)
    used_ai: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AiCache(Base):
    """Reuses an AI answer when exactly the same request comes again within its time-to-live (saves tokens)."""
    __tablename__ = "ai_cache"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_ai_cache_user_key"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    key: Mapped[str] = mapped_column(String(64))                  # sha256 of feature + model + messages
    feature: Mapped[str] = mapped_column(String(64))
    response: Mapped[str] = mapped_column(Text)
    tokens: Mapped[int] = mapped_column(Integer, default=0)        # tokens the original call used (saved on each hit)
    hits: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- Life OS Phase 6: news and ideas digest ----------

class NewsSource(Base):
    """A public RSS/Atom feed. Fetched by the server with SSRF checks; its content is data, never instructions."""
    __tablename__ = "news_sources"
    __table_args__ = (
        UniqueConstraint("user_id", "url", name="uq_news_sources_user_url"),
        CheckConstraint("topic IN ('ai','tech','sri_lanka','markets','learning','other')", name="ck_news_sources_topic"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    name: Mapped[str] = mapped_column(String(80))
    url: Mapped[str] = mapped_column(String(500))
    topic: Mapped[str] = mapped_column(String(16), default="tech")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NewsItem(Base):
    __tablename__ = "news_items"
    __table_args__ = (
        UniqueConstraint("user_id", "url", name="uq_news_items_user_url"),
        CheckConstraint("status IN ('new','saved','dismissed')", name="ck_news_items_status"),
        Index("ix_news_items_user_published", "user_id", "published_at"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("news_sources.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str] = mapped_column(String(300))
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    topic: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(10), default="new", server_default="new")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NewsDigest(Base):
    __tablename__ = "news_digests"
    __table_args__ = (UniqueConstraint("user_id", "local_date", name="uq_news_digests_user_date"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    local_date: Mapped[date] = mapped_column(Date)
    intro: Mapped[str] = mapped_column(Text)
    items: Mapped[list] = mapped_column(JsonDict, default=list)       # [{id, title, url, source, section, why}]
    used_ai: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------- Life OS Phase 7: CSE investing assistant (signals from YOUR rules; never trades) ----------

class StockPrice(Base):
    """One symbol's prices for one trading day: from the CSE website, your CSV/Excel upload, or typed in."""
    __tablename__ = "stock_prices"
    __table_args__ = (
        UniqueConstraint("user_id", "symbol", "trade_date", name="uq_stock_prices_user_symbol_date"),
        CheckConstraint("source IN ('cse','upload','manual')", name="ck_stock_prices_source"),
        Index("ix_stock_prices_user_date", "user_id", "trade_date"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    symbol: Mapped[str] = mapped_column(String(20))
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    trade_date: Mapped[date] = mapped_column(Date)
    close: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    prev_close: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    open: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    high: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    low: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    change_pct: Mapped[Decimal | None] = mapped_column(Numeric(9, 3), nullable=True)
    volume: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    turnover: Mapped[Decimal | None] = mapped_column(Numeric(20, 2), nullable=True)
    market_cap: Mapped[Decimal | None] = mapped_column(Numeric(22, 2), nullable=True)
    source: Mapped[str] = mapped_column(String(8), default="cse")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StockTrade(Base):
    """Your own record of a buy, sell or dividend (Sakuna never places trades)."""
    __tablename__ = "stock_trades"
    __table_args__ = (
        CheckConstraint("side IN ('buy','sell','dividend')", name="ck_stock_trades_side"),
        CheckConstraint("quantity > 0", name="ck_stock_trades_quantity"),
        Index("ix_stock_trades_user_symbol", "user_id", "symbol"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    symbol: Mapped[str] = mapped_column(String(20))
    trade_date: Mapped[date] = mapped_column(Date)
    side: Mapped[str] = mapped_column(String(8))
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 2))          # shares (for a dividend: shares that received it)
    price: Mapped[Decimal] = mapped_column(Numeric(14, 4))             # per share (for a dividend: dividend per share)
    fees: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"), server_default="0")
    currency: Mapped[str] = mapped_column(String(3), default="LKR", server_default="LKR")
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source: Mapped[str] = mapped_column(String(8), default="manual", server_default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WatchItem(Base):
    """A share you follow and the rules you set for it. P/E and yield use the EPS / DPS you enter."""
    __tablename__ = "watch_items"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_watch_items_user_symbol"),)

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    symbol: Mapped[str] = mapped_column(String(20))
    sector: Mapped[str | None] = mapped_column(String(60), nullable=True)
    target_buy: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    stop_loss: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    take_profit: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    max_pe: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    min_yield: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)   # percent
    eps: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    dps: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StockAlert(Base):
    __tablename__ = "stock_alerts"
    __table_args__ = (
        UniqueConstraint("user_id", "symbol", "rule", "trade_date", name="uq_stock_alerts_user_symbol_rule_date"),
        CheckConstraint("status IN ('new','seen')", name="ck_stock_alerts_status"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    symbol: Mapped[str] = mapped_column(String(20))
    rule: Mapped[str] = mapped_column(String(16))
    trade_date: Mapped[date] = mapped_column(Date)
    message: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(6), default="new", server_default="new")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)



# ---------- Journal ----------

class JournalEntry(Base):
    """One journal page per day: what I did, positives, negatives, gratitude, lesson, notes, mood. Private."""
    __tablename__ = "journal_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "local_date", name="uq_journal_entries_user_date"),
        CheckConstraint("mood IS NULL OR mood BETWEEN 1 AND 5", name="ck_journal_entries_mood"),
    )

    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = user_fk()
    local_date: Mapped[date] = mapped_column(Date)
    mood: Mapped[int | None] = mapped_column(Integer, nullable=True)
    did: Mapped[str | None] = mapped_column(Text, nullable=True)
    positives: Mapped[list] = mapped_column(JsonDict, default=list)
    negatives: Mapped[list] = mapped_column(JsonDict, default=list)
    gratitude: Mapped[list] = mapped_column(JsonDict, default=list)
    lesson: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list] = mapped_column(JsonDict, default=list)
    ai_reflection: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
