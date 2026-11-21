"""Edit and delete what you added: a share in your portfolio, income / expense entries, health records."""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal, get_args

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc
from app.core.database import get_db
from app.core.deps import get_current_user, owned
from app.models.entities import Expense, HealthRecord, Income, SleepRecord, StockTrade, User
from app.schemas import dto

router = APIRouter()


def _symbol_trades(db: Session, user_id, symbol: str) -> tuple[str, list[StockTrade]]:
    from app.services import invest
    sym = invest.norm_symbol(symbol)
    rows = db.scalars(select(StockTrade).where(StockTrade.user_id == user_id, StockTrade.symbol == sym, StockTrade.side.in_(["buy", "sell"]))).all()
    if not rows:
        raise HTTPException(404, "Not found")
    return sym, list(rows)


@router.put("/invest/holdings/{symbol}")
def invest_set_holding(symbol: str, data: dto.HoldingSetIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Change a share to this quantity and average cost. Its buy/sell history becomes one opening position; dividends stay."""
    from app.api.v1.routes_lifeos import _invest_view
    from app.services import routines
    sym, rows = _symbol_trades(db, user.id, symbol)
    for r in rows:
        db.delete(r)
    db.add(StockTrade(user_id=user.id, symbol=sym, side="buy", quantity=data.quantity, price=data.avg_price, fees=Decimal(0),
                      trade_date=routines.today_for(db, user.id), source="opening", note="Opening position (edited)"))
    db.commit(); return _invest_view(db, user)


@router.delete("/invest/holdings/{symbol}")
def invest_delete_holding(symbol: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Remove a share from your portfolio (its buy/sell records). Recorded dividends stay for your history."""
    from app.api.v1.routes_lifeos import _invest_view
    _, rows = _symbol_trades(db, user.id, symbol)
    for r in rows:
        db.delete(r)
    db.commit(); return _invest_view(db, user)


def _money_out(kind: str, r) -> dict:
    return {"kind": kind, "id": r.id, "amount": r.amount, "currency": r.currency, "label": r.category if kind == "expense" else r.source,
            "notes": r.notes, "occurred_at": r.spent_at if kind == "expense" else r.received_at, "record_kind": r.record_kind}


@router.get("/finance/entries")
def finance_entries(limit: int = Query(default=60, ge=1, le=300), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Your latest income and expenses, newest first, to check, edit or delete."""
    ex = db.scalars(select(Expense).where(Expense.user_id == user.id).order_by(Expense.spent_at.desc()).limit(limit)).all()
    inc = db.scalars(select(Income).where(Income.user_id == user.id).order_by(Income.received_at.desc()).limit(limit)).all()
    rows = [_money_out("expense", r) for r in ex] + [_money_out("income", r) for r in inc]
    rows.sort(key=lambda r: as_utc(r["occurred_at"]) if r["occurred_at"] else datetime.min, reverse=True)
    return {"items": rows[:limit], "categories": list(get_args(dto.ExpenseCategory)), "sources": list(get_args(dto.IncomeSource))}


@router.patch("/finance/entries/{kind}/{entry_id}")
def finance_entry_update(kind: Literal["expense", "income"], entry_id: uuid.UUID, data: dto.MoneyUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Expense if kind == "expense" else Income, user.id, entry_id)
    if data.amount is not None:
        row.amount = data.amount
    if data.label is not None:
        allowed = get_args(dto.ExpenseCategory) if kind == "expense" else get_args(dto.IncomeSource)
        if data.label not in allowed:
            raise HTTPException(422, f"Choose one of: {', '.join(allowed)}")
        setattr(row, "category" if kind == "expense" else "source", data.label)
    if data.notes is not None:
        row.notes = data.notes.strip() or None
    if data.occurred_at is not None:
        setattr(row, "spent_at" if kind == "expense" else "received_at", as_utc(data.occurred_at))
    db.commit(); db.refresh(row); return _money_out(kind, row)


@router.delete("/finance/entries/{kind}/{entry_id}", status_code=204)
def finance_entry_delete(kind: Literal["expense", "income"], entry_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, Expense if kind == "expense" else Income, user.id, entry_id)
    db.delete(row); db.commit()


@router.delete("/health/records/{record_id}", status_code=204)
def health_record_delete(record_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, HealthRecord, user.id, record_id)
    db.delete(row); db.commit()


@router.delete("/health/sleep/{sleep_id}", status_code=204)
def health_sleep_delete(sleep_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, SleepRecord, user.id, sleep_id)
    db.delete(row); db.commit()


