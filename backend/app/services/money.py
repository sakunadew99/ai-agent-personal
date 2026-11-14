"""Phase 5 money: accounts + reconcile, balance view, envelopes, wish list (cooling-off), buy list, affordability.

Rules (guide 36.5): exact decimals only; totals never mix currencies; the app never buys, pays or transfers; numbers
are reported neutrally and the decision stays with the user.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc, zone
from app.models.entities import (
    AccountAdjustment, BuyListItem, Envelope, Expense, FinancialAccount, Income, PriceNote, UserProfile, WishlistItem,
)
from app.schemas.dto import ExpenseIn
from app.services.audit import audit

ZERO = Decimal("0")
CENT = Decimal("0.01")
SPENDABLE_TYPES = ("cash", "bank", "wallet", "other")


def q(value) -> Decimal:
    return Decimal(value or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def _profile(db: Session, user_id) -> UserProfile | None:
    return db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))


def _tz(db: Session, user_id):
    profile = _profile(db, user_id)
    return zone(profile.timezone if profile else None)


# ---------- accounts ----------

def open_account(db: Session, user_id, name: str, account_type: str, currency: str, balance: Decimal) -> FinancialAccount:
    now = now_utc()
    row = FinancialAccount(user_id=user_id, name=name.strip(), account_type=account_type, currency=currency,
                           balance=q(balance), record_kind="actual", balance_as_of=now, updated_at=now)
    db.add(row)
    db.flush()
    db.add(AccountAdjustment(user_id=user_id, account_id=row.id, previous_balance=ZERO, new_balance=row.balance,
                             difference=row.balance, reason="opening", note="Opening balance"))
    audit(db, user_id, "account.open", "financial_account", row.id, {"currency": currency})
    return row


def reconcile(db: Session, row: FinancialAccount, new_balance: Decimal, note: str | None, reason: str = "reconcile") -> AccountAdjustment:
    """'Does this balance match reality?' The difference is kept as an adjustment, never silently overwritten."""
    previous, new = q(row.balance), q(new_balance)
    adjustment = AccountAdjustment(user_id=row.user_id, account_id=row.id, previous_balance=previous, new_balance=new,
                                   difference=q(new - previous), reason=reason, note=(note or "").strip() or None)
    db.add(adjustment)
    row.balance = new
    row.balance_as_of = row.updated_at = now_utc()
    audit(db, row.user_id, "account.reconcile", "financial_account", row.id, {"difference": str(adjustment.difference)})
    return adjustment


# ---------- balance view and forecast ----------

def _month_start(day: date) -> date:
    return day.replace(day=1)


def _add_months(day: date, months: int) -> date:
    total = day.month - 1 + months
    return date(day.year + total // 12, total % 12 + 1, 1)


def balance_view(db: Session, user_id, currency: str | None = None) -> dict:
    tz = _tz(db, user_id)
    now = now_utc()
    accounts = db.scalars(select(FinancialAccount).where(FinancialAccount.user_id == user_id, FinancialAccount.archived_at.is_(None))).all()
    currencies = sorted({a.currency for a in accounts} | ({currency} if currency else set()))
    if currency:
        currencies = [currency]
    today = datetime.now(tz).date()
    months = [_add_months(_month_start(today), -i) for i in (3, 2, 1)]  # the three full months before this one
    history_start = datetime.combine(months[0], time.min, tzinfo=tz).astimezone(timezone.utc)
    history_end = datetime.combine(_month_start(today), time.min, tzinfo=tz).astimezone(timezone.utc)
    expenses = db.scalars(select(Expense).where(Expense.user_id == user_id, Expense.spent_at >= history_start,
                                                Expense.spent_at < now + timedelta(days=30))).all()
    incomes = db.scalars(select(Income).where(Income.user_id == user_id, Income.received_at >= history_start,
                                              Income.received_at < history_end)).all()
    open_buy = db.scalars(select(BuyListItem).where(BuyListItem.user_id == user_id, BuyListItem.checked_at.is_(None),
                                                    BuyListItem.est_price.is_not(None))).all()
    out = []
    for cur in currencies:
        mine = [a for a in accounts if a.currency == cur]
        have = q(sum((Decimal(a.balance) for a in mine), ZERO))
        savings = q(sum((Decimal(a.balance) for a in mine if a.account_type == "savings"), ZERO))
        spendable = q(have - savings)
        bills = q(sum((Decimal(e.amount) for e in expenses if e.currency == cur and e.record_kind in ("estimated", "projected")
                       and now <= as_utc(e.spent_at) < now + timedelta(days=30)), ZERO))
        shopping = q(sum((Decimal(b.est_price) for b in open_buy if b.currency == cur), ZERO))
        committed = q(bills + shopping)
        monthly_spend, monthly_income = [], []
        for start in months:
            lo = datetime.combine(start, time.min, tzinfo=tz).astimezone(timezone.utc)
            hi = datetime.combine(_add_months(start, 1), time.min, tzinfo=tz).astimezone(timezone.utc)
            monthly_spend.append(q(sum((Decimal(e.amount) for e in expenses if e.currency == cur and e.record_kind == "actual"
                                        and e.category != "savings" and lo <= as_utc(e.spent_at) < hi), ZERO)))
            monthly_income.append(q(sum((Decimal(i.amount) for i in incomes if i.currency == cur and i.record_kind == "actual"
                                         and lo <= as_utc(i.received_at) < hi), ZERO)))
        months_with_data = [m for m in monthly_spend if m > 0]
        avg_spend = q(sum(months_with_data, ZERO) / len(months_with_data)) if months_with_data else None
        avg_income = q(sum(monthly_income, ZERO) / 3) if any(monthly_income) else ZERO
        runway = (have / avg_spend).quantize(Decimal("0.1")) if avg_spend else None
        forecast = None
        if avg_spend is not None:
            forecast = {
                "low": q(have + avg_income - max(monthly_spend)),
                "mid": q(have + avg_income - avg_spend),
                "high": q(have + avg_income - min(months_with_data)),
                "basis": f"{len(months_with_data)} month(s) of actual spending and average income",
            }
        out.append({
            "currency": cur, "accounts": len(mine), "have_now": have, "in_savings": savings, "spendable": spendable,
            "committed_30_days": committed, "committed_bills": bills, "committed_buy_list": shopping,
            "safe_to_spend": q(spendable - committed), "avg_monthly_spend": avg_spend, "runway_months": runway,
            "next_month_forecast": forecast,
            "stale_accounts": [a.name for a in mine if a.balance_as_of is None or as_utc(a.balance_as_of) < now - timedelta(days=7)],
        })
    return {"as_of": now, "currencies": out,
            "note": "Totals never mix currencies. Balances are what you entered; reconcile weekly so they match reality."}


# ---------- envelopes ----------

def envelope_status(db: Session, user_id, month: str | None = None) -> list[dict]:
    tz = _tz(db, user_id)
    if month:
        try:
            year, mon = (int(x) for x in month.split("-"))
            first = date(year, mon, 1)
        except ValueError as exc:
            raise HTTPException(422, "month must look like 2026-11") from exc
    else:
        first = _month_start(datetime.now(tz).date())
    lo = datetime.combine(first, time.min, tzinfo=tz).astimezone(timezone.utc)
    hi = datetime.combine(_add_months(first, 1), time.min, tzinfo=tz).astimezone(timezone.utc)
    envelopes = db.scalars(select(Envelope).where(Envelope.user_id == user_id).order_by(Envelope.kind, Envelope.name)).all()
    spent_rows = db.scalars(select(Expense).where(Expense.user_id == user_id, Expense.record_kind == "actual",
                                                  Expense.spent_at >= lo, Expense.spent_at < hi)).all()
    out = []
    for env in envelopes:
        cats = set(env.categories or [])
        spent = q(sum((Decimal(e.amount) for e in spent_rows if e.currency == env.currency and e.category in cats), ZERO))
        budget = q(env.monthly_amount)
        left = q(budget - spent)
        out.append({"id": env.id, "name": env.name, "kind": env.kind, "currency": env.currency, "monthly_amount": budget,
                    "categories": list(env.categories or []), "spent": spent, "left": left, "over": left < 0,
                    "used_percent": int(min(999, (spent / budget * 100))) if budget > 0 else None, "month": first.strftime("%Y-%m")})
    return out


# ---------- wish list ----------

def wish_state(row: WishlistItem, now: datetime | None = None) -> tuple[str, int]:
    """waiting -> ready (after the cooling-off period) -> bought / skipped. Returns (state, whole days left)."""
    if row.status in ("bought", "skipped"):
        return row.status, 0
    now = now or now_utc()
    left = as_utc(row.cooling_until) - now
    if left.total_seconds() <= 0:
        return "ready", 0
    return "waiting", max(1, -(-int(left.total_seconds()) // 86400))


def wish_out(row: WishlistItem) -> dict:
    state, days = wish_state(row)
    data = {c: getattr(row, c) for c in ("id", "name", "price", "currency", "priority", "category", "link", "notes", "target_date",
                                         "status", "cooling_days", "cooling_until", "decided_at", "expense_id", "created_at")}
    return {**data, "state": state, "days_left": days}


def add_wish(db: Session, user_id, data) -> WishlistItem:
    now = now_utc()
    row = WishlistItem(user_id=user_id, **data.model_dump(), status="active", cooling_until=now + timedelta(days=data.cooling_days),
                       created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    if row.price is not None:
        db.add(PriceNote(user_id=user_id, wish_id=row.id, price=row.price, currency=row.currency))
    audit(db, user_id, "wish.create", "wishlist_item", row.id)
    return row


def update_wish(db: Session, row: WishlistItem, changes: dict) -> WishlistItem:
    if "price" in changes and changes["price"] is not None and (row.price is None or q(changes["price"]) != q(row.price)):
        db.add(PriceNote(user_id=row.user_id, wish_id=row.id, price=changes["price"], currency=row.currency))
    for key, value in changes.items():
        if key == "name" and value is None:
            continue
        setattr(row, key, value)
    row.updated_at = now_utc()
    return row


def decide_wish(db: Session, row: WishlistItem, action: str, record_expense: bool, amount: Decimal | None) -> WishlistItem:
    from app.services.actions import create_expense  # local import avoids a cycle
    now = now_utc()
    if action == "reopen":
        row.status, row.decided_at = "active", None
    elif action == "skipped":
        row.status, row.decided_at = "skipped", now
    else:  # bought: the user already bought it; we only record it
        paid = amount if amount is not None else row.price
        if record_expense:
            if paid is None or paid <= 0:
                raise HTTPException(422, "Enter the amount you paid to record the expense")
            expense = create_expense(db, row.user_id, ExpenseIn(amount=paid, currency=row.currency, category=row.category,
                                                                 merchant=None, notes=f"Wish list: {row.name}"))
            row.expense_id = expense.id
        row.status, row.decided_at = "bought", now
    row.updated_at = now
    audit(db, row.user_id, f"wish.{action}", "wishlist_item", row.id)
    return row


def affordability(db: Session, user_id, row: WishlistItem) -> dict:
    """Numbers only (guide 36.2): what's safe to spend, fun money left, upcoming commitments, effect on your savings target."""
    if row.price is None:
        raise HTTPException(422, "Add a price to check affordability")
    price, cur = q(row.price), row.currency
    view = balance_view(db, user_id, cur)["currencies"][0]
    fun = [e for e in envelope_status(db, user_id) if e["kind"] == "fun" and e["currency"] == cur]
    fun_left = q(sum((e["left"] for e in fun), ZERO)) if fun else None
    profile = _profile(db, user_id)
    lines = []
    after_safe = q(view["safe_to_spend"] - price)
    if view["accounts"] == 0:
        lines.append(f"No {cur} accounts yet. Add one under Money to see what is safe to spend.")
    else:
        lines.append(f"Safe to spend now: {cur} {view['safe_to_spend']:,}. After this: {cur} {after_safe:,}.")
        if view["committed_30_days"] > 0:
            lines.append(f"Already committed in the next 30 days: {cur} {view['committed_30_days']:,}.")
    if fun_left is not None:
        lines.append(f"Fun money left this month: {cur} {fun_left:,}" + (f" ({cur} {q(fun_left - price):,} after)." if price else "."))
    target = None
    if profile and profile.financial_target_amount and profile.financial_target_currency == cur:
        target = {"amount": q(profile.financial_target_amount), "date": profile.financial_target_date,
                  "saved": view["in_savings"], "gap_after": q(profile.financial_target_amount - view["in_savings"] + max(ZERO, -after_safe))}
        if after_safe < 0:
            lines.append(f"This is more than your safe-to-spend, so it would come from savings: your target gap grows to {cur} {target['gap_after']:,}.")
    if view["avg_monthly_spend"]:
        days = (price / (view["avg_monthly_spend"] / 30)).quantize(Decimal("0.1"))
        lines.append(f"That's about {days} days of your usual spending.")
    state, days_left = wish_state(row)
    if state == "waiting":
        lines.append(f"Cooling-off: {days_left} day(s) left before it's ready.")
    return {"wish_id": row.id, "price": price, "currency": cur, "state": state, "safe_to_spend": view["safe_to_spend"],
            "safe_after": after_safe, "committed_30_days": view["committed_30_days"], "fun_left": fun_left,
            "savings_target": target, "lines": lines, "decision": "yours"}


# ---------- buy list ----------

def checkout(db: Session, user_id, items: list[BuyListItem], amount: Decimal | None, currency: str, category: str, merchant: str | None) -> dict:
    """Items you already bought -> one expense (optional amount override). Staples stay on the list for next time."""
    from app.services.actions import create_expense
    if not items:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if any(i.currency != currency for i in items if i.est_price is not None) and amount is None:
        raise HTTPException(422, "Items use different currencies; enter the amount you paid")
    total = q(amount) if amount is not None else q(sum((Decimal(i.est_price) for i in items if i.est_price is not None), ZERO))
    expense = None
    if total > 0:
        names = ", ".join(i.name for i in items)[:400]
        expense = create_expense(db, user_id, ExpenseIn(amount=total, currency=currency, category=category, merchant=merchant,
                                                        notes=f"Buy list: {names}"))
    now = now_utc()
    for item in items:
        item.checked_at = now
        item.expense_id = expense.id if expense else None
        item.updated_at = now
    audit(db, user_id, "buylist.checkout", "buy_list_item", None, {"items": len(items), "total": str(total)})
    return {"checked": len(items), "expense_id": expense.id if expense else None, "amount": total, "currency": currency}


def restock_staples(db: Session, user_id) -> int:
    rows = db.scalars(select(BuyListItem).where(BuyListItem.user_id == user_id, BuyListItem.staple.is_(True),
                                                BuyListItem.checked_at.is_not(None))).all()
    for row in rows:
        row.checked_at, row.expense_id, row.updated_at = None, None, now_utc()
    return len(rows)
