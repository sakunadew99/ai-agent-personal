from sqlalchemy import select

from app.models.entities import Asset, Expense, Income, Liability
from app.services.finance import Balance, Flow, month_bounds, summarize
from app.core.clock import zone
from app.models.entities import UserProfile


def finance_summary(db, user, month=None):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    tz = zone(profile.timezone if profile else "UTC")
    start, end, label = month_bounds(month, tz)
    incomes = db.scalars(select(Income).where(Income.user_id == user.id, Income.received_at >= start, Income.received_at < end)).all()
    expenses = db.scalars(select(Expense).where(Expense.user_id == user.id, Expense.spent_at >= start, Expense.spent_at < end)).all()
    assets = db.scalars(select(Asset).where(Asset.user_id == user.id)).all()
    liabilities = db.scalars(select(Liability).where(Liability.user_id == user.id)).all()
    result = summarize(
        [Flow(r.amount, r.currency, r.record_kind, source=r.source) for r in incomes],
        [Flow(r.amount, r.currency, r.record_kind, category=r.category, scope=r.scope) for r in expenses],
        [Balance(r.value, r.currency, r.record_kind) for r in assets],
        [Balance(r.balance, r.currency, r.record_kind) for r in liabilities],
        profile.currency if profile else "USD",
    )
    target = profile.financial_target_amount if profile else None
    result["month"] = label
    result["target_amount"] = target
    result["target_progress_percent"] = None if not target else (result["net_worth"] / target * 100).quantize(__import__("decimal").Decimal("0.01"))
    result["notice"] = "Amounts in other currencies are excluded; no exchange rates are applied."
    return result
