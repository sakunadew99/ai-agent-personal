"""Life OS phases: routines and meals, exam coach, AI workers, about you, news, investing, compass, journal."""
import uuid
from datetime import date


from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, owned
from app.models.entities import (
    User,
)
from app.schemas import dto
from app.services.audit import audit
from app.core.clock import as_utc, now_utc

from app.api.v1.router import profile_for  # noqa: E402  (shared helpers)

router = APIRouter()


# ---------- Life OS Phase 1: routines, checklists, meals, day / week / month ----------
# Static paths come before /routines/{routine_id} so "today", "week" etc. are never read as an id.

from app.services import routines as routine_svc  # noqa: E402


def _day_or_today(db: Session, user: User, day: date | None) -> date:
    return day or routine_svc.today_for(db, user.id)


@router.get("/routines/today")
def routines_today(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return routine_svc.day_view(db, user.id, _day_or_today(db, user, day))


@router.get("/routines/week")
def routines_week(start: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.core import cache
    return cache.cached(user.id, f"week:{start}", lambda: routine_svc.week_view(db, user.id, start))


@router.get("/routines/month")
def routines_month(month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.core import cache
    return cache.cached(user.id, f"month:{month}", lambda: routine_svc.month_view(db, user.id, month))


@router.post("/routines/starter", status_code=201)
def routines_starter(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    added = routine_svc.load_starter(db, user.id); db.commit()
    return {"added": len(added), "routines": [routine_svc.routine_out(db, r) for r in routine_svc._routines(db, user.id, active_only=False)]}


@router.get("/routines")
def routines_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [routine_svc.routine_out(db, r) for r in routine_svc._routines(db, user.id, active_only=False)]


@router.post("/routines", status_code=201)
def routines_create(data: dto.RoutineIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = routine_svc.save_routine(db, user.id, data); db.commit(); return routine_svc.routine_out(db, row)


@router.patch("/routines/{routine_id}")
def routines_update(routine_id: uuid.UUID, data: dto.RoutineUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = routine_svc.save_routine(db, user.id, data, routine_svc.owned_routine(db, user.id, routine_id)); db.commit()
    return routine_svc.routine_out(db, row)


@router.delete("/routines/{routine_id}")
def routines_delete(routine_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = routine_svc.owned_routine(db, user.id, routine_id)
    audit(db, user.id, "routine.delete", "routine", row.id); db.delete(row); db.commit(); return {"deleted": True}


@router.post("/routines/{routine_id}/days/{day}/steps/{step_id}")
def routines_tick(routine_id: uuid.UUID, day: date, step_id: uuid.UUID, data: dto.StepTickIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = routine_svc.tick(db, routine_svc.owned_routine(db, user.id, routine_id), day, step_id, data.done); db.commit(); return out


@router.post("/routines/{routine_id}/days/{day}/mode")
def routines_mode(routine_id: uuid.UUID, day: date, data: dto.RunModeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = routine_svc.set_mode(db, routine_svc.owned_routine(db, user.id, routine_id), day, data.mode); db.commit(); return out


@router.post("/routines/{routine_id}/days/{day}/skip")
def routines_skip(routine_id: uuid.UUID, day: date, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = routine_svc.skip(db, routine_svc.owned_routine(db, user.id, routine_id), day); db.commit(); return out


@router.post("/meals", status_code=201)
def meals_create(data: dto.MealIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = routine_svc.log_meal(db, user.id, data); db.commit(); return routine_svc.meal_out(row)


@router.delete("/meals/{meal_id}")
def meals_delete(meal_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import MealLog
    row = owned(db, MealLog, user.id, meal_id); db.delete(row); db.commit(); return {"deleted": True}


@router.get("/meals")
def meals_list(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import MealLog
    selected = _day_or_today(db, user, day)
    rows = db.scalars(select(MealLog).where(MealLog.user_id == user.id, MealLog.local_date == selected).order_by(MealLog.created_at)).all()
    return [routine_svc.meal_out(r) for r in rows]


# ---------- Life OS Phase 3: exam coach (IELTS, Goethe German) ----------

from app.services import exams as exam_svc  # noqa: E402


@router.get("/exams")
def exams_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.core import cache
    plans = exam_svc.ensure_defaults(db, user.id); db.commit()
    return cache.cached(user.id, "exams", lambda: [exam_svc.plan_out(db, p) for p in plans])


@router.get("/exams/status")
def exams_status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    text = exam_svc.status_text(db, user.id); db.commit(); return {"text": text}


@router.patch("/exams/{plan_id}")
def exams_update(plan_id: uuid.UUID, data: dto.ExamPlanUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    plan = exam_svc.update_plan(db, exam_svc.owned_plan(db, user.id, plan_id), data.model_dump(exclude_unset=True)); db.commit()
    return exam_svc.plan_out(db, plan)


@router.post("/exams/{plan_id}/log", status_code=201)
def exams_log(plan_id: uuid.UUID, data: dto.ExamLogIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    plan = exam_svc.owned_plan(db, user.id, plan_id)
    exam_svc.log_study(db, plan, data.skill, data.minutes, data.kind, data.note, data.local_date); db.commit()
    return exam_svc.plan_out(db, plan)


@router.post("/exams/{plan_id}/scores", status_code=201)
def exams_score(plan_id: uuid.UUID, data: dto.ExamScoreIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    plan = exam_svc.owned_plan(db, user.id, plan_id)
    exam_svc.add_score(db, plan, data.skill, data.score, data.taken_on, data.source, data.note); db.commit()
    return exam_svc.plan_out(db, plan)


@router.delete("/exams/{plan_id}/scores/{score_id}")
def exams_score_delete(plan_id: uuid.UUID, score_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import ExamScore
    plan = exam_svc.owned_plan(db, user.id, plan_id)
    row = db.get(ExamScore, score_id)
    if row is None or row.plan_id != plan.id: raise HTTPException(404, "Score not found")
    db.delete(row); db.commit(); return exam_svc.plan_out(db, plan)


@router.post("/exams/{plan_id}/feedback", status_code=201)
def exams_feedback(plan_id: uuid.UUID, data: dto.ExamFeedbackIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    plan = exam_svc.owned_plan(db, user.id, plan_id)
    out = exam_svc.feedback(db, plan, data.mode, data.prompt, data.answer, data.task, data.seconds); db.commit(); return out


@router.get("/exams/{plan_id}/practice")
def exams_practice(plan_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import ExamLog
    plan = exam_svc.owned_plan(db, user.id, plan_id)
    rows = db.scalars(select(ExamLog).where(ExamLog.plan_id == plan.id, ExamLog.kind.in_(("writing", "speaking")))
                      .order_by(ExamLog.created_at.desc()).limit(15)).all()
    return [{"id": r.id, "kind": r.kind, "skill": r.skill, "local_date": r.local_date, "prompt": r.prompt, "answer": r.answer,
             "feedback": r.feedback, "estimated_score": r.estimated_score, "used_ai": r.used_ai} for r in rows]


@router.delete("/exams/practice/{log_id}")
def exams_practice_delete(log_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import ExamLog
    row = db.get(ExamLog, log_id)
    if row is None or row.user_id != user.id: raise HTTPException(404, "Practice not found")
    db.delete(row); db.commit(); return {"deleted": True}


# ---------- Life OS Phase 4: AI workers ----------

from app.services import ai_workers as worker_svc  # noqa: E402


@router.get("/workers")
def workers_list(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = worker_svc.ensure_workers(db, user.id); tz = worker_svc._tz(db, user.id); db.commit()
    return [worker_svc.worker_out(db, w, tz) for w in rows]


@router.get("/workers/today")
def workers_today(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = worker_svc.today_view(db, user.id); db.commit(); return out


@router.patch("/workers/{key}")
def workers_update(key: str, data: dto.WorkerUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    w = worker_svc.update_worker(db, worker_svc.owned_worker(db, user.id, key), data.model_dump(exclude_unset=True)); db.commit()
    return worker_svc.worker_out(db, w, worker_svc._tz(db, user.id))


@router.post("/workers/{key}/run")
def workers_run(key: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    note = worker_svc.run_worker(db, worker_svc.owned_worker(db, user.id, key), notify=False); db.commit()
    return worker_svc.note_out(note)


@router.post("/workers/notes/{note_id}/act")
def workers_note_act(note_id: uuid.UUID, data: dto.WorkerActIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = worker_svc.act(db, worker_svc.owned_note(db, user.id, note_id), data.action_id); db.commit(); return out


@router.post("/workers/notes/{note_id}/feedback")
def workers_note_feedback(note_id: uuid.UUID, data: dto.WorkerFeedbackIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    note = worker_svc.owned_note(db, user.id, note_id)
    note.feedback = data.feedback; note.updated_at = now_utc()
    audit(db, user.id, "worker.feedback", "worker_note", note.id, {"feedback": data.feedback}); db.commit()
    return worker_svc.note_out(note)


# ---------- Life OS Phase 5: learns you ----------

from app.services import you as you_svc  # noqa: E402


@router.get("/you")
def you_view(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.core import cache
    return cache.cached(user.id, "you", lambda: _you_compute(db, user))


def _you_compute(db: Session, user: User) -> dict:
    from app.models.entities import InsightReport
    from app.services.ai_client import cache_stats
    p = you_svc.profile(db, user.id)
    found = you_svc.findings(p)
    latest = db.scalar(select(InsightReport).where(InsightReport.user_id == user.id).order_by(InsightReport.week_start.desc()).limit(1))
    return {"profile": p, "findings": found, "change": you_svc.one_change(p, found), "preferences": you_svc.preferences_text(db, user.id),
            "latest_report": you_svc.report_out(latest) if latest else None, "cache": cache_stats(db, user.id)}


@router.post("/you/report", status_code=201)
def you_report(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = you_svc.build_report(db, user.id); db.commit(); return you_svc.report_out(row)


@router.get("/you/reports")
def you_reports(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import InsightReport
    rows = db.scalars(select(InsightReport).where(InsightReport.user_id == user.id).order_by(InsightReport.week_start.desc()).limit(12)).all()
    return [you_svc.report_out(r) for r in rows]


@router.post("/you/reports/{report_id}/memory")
def you_report_memory(report_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = you_svc.save_to_memory(db, you_svc.owned_report(db, user.id, report_id)); db.commit(); return out


# ---------- Life OS Phase 6: news and ideas digest ----------

from app.services import news as news_svc  # noqa: E402


def _refresh_news_later(user_id) -> None:
    """Runs after the response: fetch stale feeds without making the screen wait."""
    from app.core.database import SessionLocal
    try:
        with SessionLocal() as db:
            news_svc.refresh(db, user_id)
            db.commit()
    except Exception:  # noqa: BLE001 - background refresh is best-effort
        import logging
        logging.getLogger(__name__).exception("background news refresh failed")


@router.get("/news")
def news_view(background: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Today's digest (built from stories already fetched; refreshing the feeds is a separate call) and the ranked list."""
    from app.models.entities import NewsDigest, NewsSource
    sources = news_svc.ensure_sources(db, user.id)
    today = routine_svc.today_for(db, user.id)
    digest = db.scalar(select(NewsDigest).where(NewsDigest.user_id == user.id, NewsDigest.local_date == today))
    if digest is None:
        digest = news_svc.build_digest(db, user.id, today, use_ai=False)
    names = {s.id: s.name for s in db.scalars(select(NewsSource).where(NewsSource.user_id == user.id)).all()}
    items = [news_svc.item_out(r, s, names) for r, s in news_svc.ranked(db, user.id, hours=72, limit=30)]
    stale = any(s.active and (s.last_fetched_at is None or as_utc(s.last_fetched_at) < now_utc() - news_svc.FETCH_EVERY) for s in sources)
    out = {"digest": news_svc.digest_out(digest), "items": items, "sources": [news_svc.source_out(s) for s in sources],
           "interests": news_svc.interests(db, user.id), "refreshing": stale}
    db.commit()
    if stale:
        background.add_task(_refresh_news_later, user.id)
    return out


@router.post("/news/refresh")
def news_refresh(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = news_svc.refresh(db, user.id, force=True)
    digest = news_svc.build_digest(db, user.id)
    db.commit(); return {**result, "digest": news_svc.digest_out(digest)}


@router.put("/news/interests")
def news_interests(data: dto.NewsInterestsIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = profile_for(db, user)
    profile.news_interests = sorted({i.strip() for i in data.interests if i.strip()}, key=str.lower)
    profile.updated_at = now_utc()
    db.commit(); return {"interests": profile.news_interests}


@router.post("/news/sources", status_code=201)
def news_source_add(data: dto.NewsSourceIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    news_svc.ensure_sources(db, user.id)
    src = news_svc.add_source(db, user.id, data.name, data.url, data.topic); db.commit(); return news_svc.source_out(src)


@router.patch("/news/sources/{source_id}")
def news_source_update(source_id: uuid.UUID, data: dto.NewsSourceUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    src = news_svc.owned_source(db, user.id, source_id); src.active = data.active; db.commit(); return news_svc.source_out(src)


@router.delete("/news/sources/{source_id}")
def news_source_delete(source_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    src = news_svc.owned_source(db, user.id, source_id)
    audit(db, user.id, "news.source_delete", "news_source", src.id); db.delete(src); db.commit(); return {"deleted": True}


@router.post("/news/items/{item_id}/{action}")
def news_item_action(item_id: uuid.UUID, action: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if action not in ("save", "task", "dismiss"): raise HTTPException(404, "Unknown action")
    out = news_svc.item_action(db, news_svc.owned_item(db, user.id, item_id), action); db.commit(); return out


# ---------- Life OS Phase 7: CSE investing assistant ----------

from app.services import invest as invest_svc  # noqa: E402


def _invest_view(db: Session, user: User) -> dict:
    from app.models.entities import StockAlert, StockPrice
    last = db.scalar(select(func.max(StockPrice.trade_date)).where(StockPrice.user_id == user.id))
    alerts = db.scalars(select(StockAlert).where(StockAlert.user_id == user.id).order_by(StockAlert.created_at.desc()).limit(20)).all()
    return {"portfolio": invest_svc.holdings(db, user.id), "watchlist": invest_svc.watch_out(db, user.id),
            "alerts": [{"id": a.id, "symbol": a.symbol, "rule": a.rule, "date": a.trade_date, "message": a.message, "status": a.status} for a in alerts],
            "last_price_date": last, "disclaimer": invest_svc.DISCLAIMER}


@router.get("/invest")
def invest_view(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.core import cache
    return cache.cached(user.id, "invest", lambda: _invest_view(db, user))


@router.post("/invest/fetch")
def invest_fetch(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = invest_svc.fetch_cse(db, user.id); alerts = invest_svc.evaluate(db, user.id); db.commit()
    return {**out, "new_alerts": len(alerts), **_invest_view(db, user)}


@router.post("/invest/upload")
async def invest_upload(file: UploadFile = File(...), kind: str = Query("auto", pattern="^(auto|prices|trades)$"), trade_date: date | None = None,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    content = await file.read(invest_svc.MAX_UPLOAD + 1)
    out = invest_svc.import_table(db, user.id, content, file.filename or "upload.csv", kind, trade_date)
    alerts = invest_svc.evaluate(db, user.id); db.commit()
    return {**out, "new_alerts": len(alerts)}


@router.post("/invest/import-text")
def invest_import_text(data: dto.ImportTextIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = invest_svc.import_table(db, user.id, data.text.encode("utf-8"), "pasted.csv", data.kind, data.trade_date)
    alerts = invest_svc.evaluate(db, user.id); db.commit()
    return {**out, "new_alerts": len(alerts)}


@router.post("/invest/prices", status_code=201)
def invest_manual_price(data: dto.ManualPriceIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    day = data.trade_date or routine_svc.today_for(db, user.id)
    invest_svc.store_prices(db, user.id, day, [{"symbol": data.symbol, "close": data.close}], "manual")
    invest_svc.evaluate(db, user.id); db.commit(); return _invest_view(db, user)


@router.get("/invest/trades")
def invest_trades(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import StockTrade
    rows = db.scalars(select(StockTrade).where(StockTrade.user_id == user.id).order_by(StockTrade.trade_date.desc(), StockTrade.created_at.desc()).limit(300)).all()
    return [{"id": t.id, "symbol": t.symbol, "date": t.trade_date, "side": t.side, "quantity": t.quantity, "price": t.price, "fees": t.fees,
             "note": t.note, "source": t.source} for t in rows]


@router.post("/invest/trades", status_code=201)
def invest_trade_add(data: dto.StockTradeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import StockTrade
    row = StockTrade(user_id=user.id, symbol=invest_svc.norm_symbol(data.symbol), trade_date=data.trade_date, side=data.side, quantity=data.quantity,
                     price=data.price, fees=data.fees, note=data.note, source="manual")
    db.add(row); db.flush(); audit(db, user.id, "invest.trade", "stock_trade", row.id, {"side": data.side})
    invest_svc.evaluate(db, user.id); db.commit(); return _invest_view(db, user)


@router.delete("/invest/trades/{trade_id}")
def invest_trade_delete(trade_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import StockTrade
    row = owned(db, StockTrade, user.id, trade_id)
    audit(db, user.id, "invest.trade_delete", "stock_trade", row.id); db.delete(row); db.commit(); return _invest_view(db, user)


@router.put("/invest/watch/{symbol}")
def invest_watch_set(symbol: str, data: dto.WatchIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invest_svc.upsert_watch(db, user.id, symbol, data.model_dump(exclude_unset=True)); invest_svc.evaluate(db, user.id); db.commit()
    return _invest_view(db, user)


@router.delete("/invest/watch/{symbol}")
def invest_watch_delete(symbol: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import WatchItem
    row = db.scalar(select(WatchItem).where(WatchItem.user_id == user.id, WatchItem.symbol == invest_svc.norm_symbol(symbol)))
    if row is None: raise HTTPException(404, "Not on your watchlist")
    db.delete(row); db.commit(); return _invest_view(db, user)


@router.post("/invest/alerts/seen")
def invest_alerts_seen(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.models.entities import StockAlert
    for a in db.scalars(select(StockAlert).where(StockAlert.user_id == user.id, StockAlert.status == "new")).all():
        a.status = "seen"
    db.commit(); return {"ok": True}


@router.get("/invest/symbols")
def invest_symbol_search(q: str = Query(default="", max_length=40), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Dropdown for the symbol field: every matching share class (e.g. COMB.N0000 voting and COMB.X0000 non-voting)."""
    return invest_svc.search_symbols(db, user.id, q)


@router.get("/invest/symbols/{symbol}")
def invest_symbol(symbol: str, ai: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = {"history": invest_svc.history(db, user.id, symbol), "research": invest_svc.research(db, user.id, symbol, use_ai=ai)}
    db.commit(); return out


# ---------- Life Compass: the seven life areas from every feature, and the next best actions ----------

from app.services import compass as compass_svc  # noqa: E402


@router.get("/compass")
def compass_view(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.core import cache
    out = cache.cached(user.id, "compass", lambda: compass_svc.view(db, user.id)); db.commit(); return out


@router.post("/compass/{area}/log", status_code=201)
def compass_log(area: str, data: dto.CompassLogIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    compass_svc.log(db, user.id, area, data.amount, data.note)
    audit(db, user.id, "compass.log", "life_area", None, {"area": area})
    out = compass_svc.view(db, user.id); db.commit(); return out



# ---------- Journal ----------

from app.services import journal as journal_svc  # noqa: E402


@router.get("/journal")
def journal_view(day: date | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return journal_svc.view(db, user.id, day)


@router.put("/journal/{day}")
def journal_save(day: date, data: dto.JournalIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    journal_svc.save(db, user.id, day, data.model_dump(exclude_unset=True)); db.commit(); return journal_svc.view(db, user.id, day)


@router.delete("/journal/{day}")
def journal_delete(day: date, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    journal_svc.delete(db, user.id, day); db.commit(); return journal_svc.view(db, user.id, day)


@router.post("/journal/{day}/reflect")
def journal_reflect(day: date, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = journal_svc.reflect(db, user.id, day); db.commit(); return journal_svc.entry_out(row)
