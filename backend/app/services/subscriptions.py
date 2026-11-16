"""Subscriptions and renewals, and moving inbox (capture) items to where they belong. Plain code; never pays anything."""
from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_utc, zone
from app.models.entities import CaptureItem, Expense, Habit, Subscription, UserProfile

PER_MONTH = {"weekly": Decimal("52") / 12, "monthly": Decimal("1"), "quarterly": Decimal("1") / 3, "yearly": Decimal("1") / 12}


def today_for(db: Session, user_id) -> date:
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    return now_utc().astimezone(zone(p.timezone if p else "Asia/Colombo")).date()


def add_cycle(day: date, cycle: str, times: int = 1) -> date:
    if cycle == "weekly":
        return day + timedelta(weeks=times)
    months = {"monthly": 1, "quarterly": 3, "yearly": 12}[cycle] * times
    m = day.month - 1 + months
    y, m = day.year + m // 12, m % 12 + 1
    return date(y, m, min(day.day, calendar.monthrange(y, m)[1]))


def sub_out(row: Subscription, today: date) -> dict:
    days = (row.next_due - today).days
    state = "overdue" if days < 0 else "due_soon" if days <= row.remind_days else "ok"
    monthly = (row.amount * PER_MONTH[row.cycle]).quantize(Decimal("0.01")) if row.amount is not None else None
    return {"id": row.id, "name": row.name, "category": row.category, "amount": row.amount, "currency": row.currency, "cycle": row.cycle,
            "next_due": row.next_due, "remind_days": row.remind_days, "auto_renews": row.auto_renews, "active": row.active, "link": row.link,
            "notes": row.notes, "last_paid_on": row.last_paid_on, "days_left": days, "state": state, "per_month": monthly}


def overview(db: Session, user_id) -> dict:
    today = today_for(db, user_id)
    rows = db.scalars(select(Subscription).where(Subscription.user_id == user_id).order_by(Subscription.active.desc(), Subscription.next_due)).all()
    items = [sub_out(r, today) for r in rows]
    monthly, yearly = defaultdict(Decimal), defaultdict(Decimal)
    by_cat: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for r, o in zip(rows, items):
        if r.active and o["per_month"] is not None:
            monthly[r.currency] += o["per_month"]
            yearly[r.currency] += o["per_month"] * 12
            by_cat[r.currency][r.category] += o["per_month"]
    active = [o for o in items if o["active"]]
    return {
        "items": items,
        "due_30_days": [o for o in active if o["days_left"] <= 30],
        "overdue": sum(1 for o in active if o["state"] == "overdue"),
        "due_soon": sum(1 for o in active if o["state"] == "due_soon"),
        "per_month": {k: v.quantize(Decimal("0.01")) for k, v in monthly.items()},
        "per_year": {k: v.quantize(Decimal("0.01")) for k, v in yearly.items()},
        "by_category": {cur: {k: v.quantize(Decimal("0.01")) for k, v in cats.items()} for cur, cats in by_cat.items()},
        "today": today,
    }


def mark_paid(db: Session, user_id, row: Subscription, record_expense: bool, amount: Decimal | None) -> dict:
    """Paid this cycle: move next_due forward one cycle (or until it is in the future), optionally log the expense."""
    today = today_for(db, user_id)
    paid = amount if amount is not None else row.amount
    expense_id = None
    if record_expense:
        if paid is None or paid <= 0:
            raise HTTPException(422, "Add the amount to log it as an expense")
        cat = {"insurance": "health", "rent": "housing", "loan": "other", "bill": "housing"}.get(row.category, "subscriptions")
        exp = Expense(user_id=user_id, amount=paid, currency=row.currency, category=cat, scope="personal", record_kind="actual",
                      merchant=row.name[:200], spent_at=now_utc(), notes=f"{row.name} ({row.cycle})")
        db.add(exp); db.flush(); expense_id = exp.id
    nxt = add_cycle(row.next_due, row.cycle)
    while nxt <= today:
        nxt = add_cycle(nxt, row.cycle)
    row.next_due, row.last_paid_on, row.updated_at = nxt, today, now_utc()
    return {"subscription": sub_out(row, today), "expense_id": expense_id}


# ---------- inbox: move a captured item to where it belongs ----------

TARGETS = ("task", "goal", "habit", "wish", "buy", "memory")


def move_capture(db: Session, user, row: CaptureItem, data) -> dict:
    """Create the record the user chose from an inbox item, then mark the item moved. Nothing happens without this call."""
    if row.status in ("moved", "processed", "saved"):
        raise HTTPException(409, "This item was already sorted")
    from app.schemas import dto
    title = (data.title or (row.extracted or {}).get("title") or row.raw_text).strip()[:200] or "Untitled"
    created: dict = {"target": data.target}
    if data.target == "task":
        from app.services.actions import create_task
        t = create_task(db, user.id, dto.TaskIn(title=title, priority=data.priority or "medium", category=data.category or "personal",
                                                duration_minutes=data.duration_minutes or 30, due_at=data.due_at, notes=row.raw_text, recurrence=data.recurrence))
        row.task_id, created["id"] = t.id, str(t.id)
    elif data.target == "goal":
        from app.services.actions import create_goal
        g = create_goal(db, user.id, dto.GoalIn(title=title, category=data.category if data.category in ("personal", "career", "finance", "health", "learning") else "personal",
                                                target_value=data.target_value, unit=data.unit, due_date=data.due_date, description=row.raw_text[:2000]))
        created["id"] = str(g.id)
    elif data.target == "habit":
        h = Habit(user_id=user.id, name=title, schedule="daily", kind="build", icon=data.icon, reminder_time=data.reminder_time)
        db.add(h); db.flush(); created["id"] = str(h.id)
    elif data.target == "wish":
        from app.services import money as money_svc
        w = money_svc.add_wish(db, user.id, dto.WishIn(name=title, price=data.price, currency=data.currency or "LKR", target_date=data.due_date, notes=row.raw_text[:2000]))
        created["id"] = str(w.id)
    elif data.target == "buy":
        from app.models.entities import BuyListItem
        b = BuyListItem(user_id=user.id, name=title, est_price=data.price, currency=data.currency or "LKR", need_by=data.due_date,
                        list_name=(data.list_name or "groceries").strip().lower()[:32])
        db.add(b); db.flush(); created["id"] = str(b.id)
    elif data.target == "memory":
        from app.services.memory import save_memory
        m = save_memory(db, user.id, row.raw_text if not data.title else f"{data.title}: {row.raw_text}"[:4000], data.category or "note", "capture", False)
        created["id"] = str(getattr(m, "id", "")) or None
    row.status = "moved"
    row.extracted = {**(row.extracted or {}), "moved_to": created}
    return created
