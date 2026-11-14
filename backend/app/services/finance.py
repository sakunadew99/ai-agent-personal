from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal, ROUND_HALF_UP

TWOPLACES = Decimal("0.01")
HUNDRED = Decimal("100")


def money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def net_income(total_income: Decimal, total_expenses: Decimal) -> Decimal:
    return money(total_income - total_expenses)


def savings_rate(total_savings: Decimal, total_income: Decimal) -> Decimal | None:
    if total_income == 0:
        return None
    return (Decimal(total_savings) / Decimal(total_income) * HUNDRED).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def net_worth(total_assets: Decimal, total_liabilities: Decimal) -> Decimal:
    return money(total_assets - total_liabilities)


def business_profit(revenue: Decimal, expenses: Decimal) -> Decimal:
    return money(revenue - expenses)


@dataclass
class Flow:
    amount: Decimal
    currency: str
    record_kind: str
    source: str = ""
    category: str = ""
    scope: str = "personal"


@dataclass
class Balance:
    amount: Decimal
    currency: str
    record_kind: str


def _sum(rows: list, currency: str, kinds: set[str], predicate) -> Decimal:
    total = Decimal("0")
    for row in rows:
        if row.currency != currency or row.record_kind not in kinds:
            continue
        if predicate(row):
            total += Decimal(row.amount)
    return money(total)


def summarize(
    income: list[Flow],
    expenses: list[Flow],
    assets: list[Balance],
    liabilities: list[Balance],
    currency: str,
    pending_receivables: Decimal = Decimal("0"),
) -> dict:
    actual = {"actual"}
    salary = _sum(income, currency, actual, lambda row: row.source == "salary")
    freelance = _sum(income, currency, actual, lambda row: row.source == "freelance")
    business_revenue = _sum(income, currency, actual, lambda row: row.source == "business")
    other = _sum(income, currency, actual, lambda row: row.source == "other")
    total_income = money(salary + freelance + business_revenue + other)
    consumption = _sum(expenses, currency, actual, lambda row: row.category != "savings")
    explicit_savings = _sum(expenses, currency, actual, lambda row: row.category == "savings")
    if explicit_savings > 0:
        saved = explicit_savings
        basis = "explicit"
    else:
        saved = money(max(total_income - consumption, Decimal("0")))
        basis = "unspent_income"
    categories: dict[str, Decimal] = {}
    for row in expenses:
        if row.currency != currency or row.record_kind != "actual" or row.category == "savings":
            continue
        categories[row.category] = money(categories.get(row.category, Decimal("0")) + Decimal(row.amount))
    by_kind: dict[str, dict[str, Decimal]] = {}
    for kind in ("actual", "estimated", "projected"):
        by_kind[kind] = {
            "income": _sum(income, currency, {kind}, lambda _row: True),
            "expenses": _sum(expenses, currency, {kind}, lambda row: row.category != "savings"),
        }
    present = {row.currency for row in [*income, *expenses, *assets, *liabilities]}
    return {
        "currency": currency,
        "total_income": total_income,
        "total_expenses": consumption,
        "total_savings": saved,
        "savings_basis": basis,
        "savings_rate": savings_rate(saved, total_income),
        "net_income": net_income(total_income, consumption),
        "net_worth": net_worth(
            _sum(assets, currency, actual, lambda _row: True),
            _sum(liabilities, currency, actual, lambda _row: True),
        ),
        "business_revenue": business_revenue,
        "business_expenses": _sum(
            expenses, currency, actual, lambda row: row.scope == "business" and row.category != "savings"
        ),
        "business_profit": business_profit(
            business_revenue,
            _sum(expenses, currency, actual, lambda row: row.scope == "business" and row.category != "savings"),
        ),
        "salary_income": salary,
        "freelance_income": freelance,
        "other_income": other,
        "pending_receivables": money(pending_receivables),
        "expense_by_category": categories,
        "totals_by_kind": by_kind,
        "excluded_currencies": sorted(code for code in present if code != currency),
    }


def month_bounds(month: str | None, tz) -> tuple[datetime, datetime, str]:
    if month:
        year, mon = (int(part) for part in month.split("-"))
        start_date = date(year, mon, 1)
    else:
        local_today = datetime.now(tz).date()
        start_date = local_today.replace(day=1)
    if start_date.month == 12:
        next_date = date(start_date.year + 1, 1, 1)
    else:
        next_date = date(start_date.year, start_date.month + 1, 1)
    start = datetime.combine(start_date, time.min, tzinfo=tz).astimezone(timezone.utc)
    end = datetime.combine(next_date, time.min, tzinfo=tz).astimezone(timezone.utc)
    return start, end, f"{start_date.year:04d}-{start_date.month:02d}"


def progress_percent(current: Decimal, target: Decimal | None) -> Decimal | None:
    if target is None or target == 0:
        return None
    return (Decimal(current) / Decimal(target) * HUNDRED).quantize(TWOPLACES, rounding=ROUND_HALF_UP)
