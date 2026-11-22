"""Reading: books, progress, highlights, yearly goal and real book search (Open Library)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, owned
from app.models.entities import Book, Skill, SkillSession, User, UserProfile
from app.schemas import dto
from app.services import reading

router = APIRouter()


def _today(db: Session, user: User):
    from app.services.wellbeing import _today as today
    return today(db, user.id)


def _check_link(url: str) -> None:
    try:
        reading.ebook_links(url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/reading")
def reading_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Your books with progress and finish forecasts, pages this week, streak, yearly goal and suggestions."""
    return reading.overview(db, user.id, _today(db, user))


@router.get("/reading/search")
def reading_search(q: str = Query(min_length=2, max_length=120), user: User = Depends(get_current_user)):
    """Real books from Open Library (title, author, pages, cover). Empty when offline."""
    return {"items": reading.search(q)}


@router.post("/reading/books", status_code=201)
def book_create(data: dto.BookIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    exists = db.scalar(select(Book).where(Book.user_id == user.id, Book.title == data.title.strip(), Book.author == data.author.strip()))
    if exists:
        raise HTTPException(409, "This book is already on your shelf")
    values = {**data.model_dump(), "title": data.title.strip(), "author": data.author.strip()}
    if values.get("file_url"):
        _check_link(values["file_url"])
        if values["format"] == "paper":
            values["format"] = "ebook"                                # a PDF link means you read it as an e-book
    b = Book(user_id=user.id, **values)
    if b.status == "reading":
        b.started_on = _today(db, user)
    db.add(b); db.commit(); db.refresh(b)
    return reading.book_out(b, None, _today(db, user))


@router.patch("/reading/books/{book_id}")
def book_update(book_id: uuid.UUID, data: dto.BookUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    b = owned(db, Book, user.id, book_id)
    changes = data.model_dump(exclude_unset=True)
    if changes.get("file_url"):
        _check_link(changes["file_url"])
        if b.format == "paper" and "format" not in changes:
            changes["format"] = "ebook"
    elif "file_url" in changes:
        changes["file_url"] = None                                    # an empty link removes the e-book
    for k, v in changes.items():
        setattr(b, k, v)
    today = _today(db, user)
    if changes.get("status") == "reading" and not b.started_on:
        b.started_on = today
    if changes.get("status") == "finished":
        b.finished_on = b.finished_on or today
        if b.total_pages:
            b.current_page = b.total_pages
    db.commit(); db.refresh(b); return reading.book_out(b, None, today)


@router.delete("/reading/books/{book_id}", status_code=204)
def book_delete(book_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(owned(db, Book, user.id, book_id)); db.commit()


@router.post("/reading/books/{book_id}/progress")
def book_progress(book_id: uuid.UUID, data: dto.BookProgressIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Log a sitting: the page you reached (or pages read) and minutes. Finishing the last page marks the book finished."""
    b = owned(db, Book, user.id, book_id)
    if data.to_page is None and data.pages is None and not data.minutes:
        raise HTTPException(422, "Give the page you reached, pages read or minutes")
    today = _today(db, user)
    s = reading.log_progress(db, user.id, b, data.to_page, data.pages, data.minutes, today)
    skill = next((k for k in db.scalars(select(Skill).where(Skill.user_id == user.id)).all() if k.name.lower().startswith("read")), None)
    if skill is not None and data.minutes:
        db.add(SkillSession(user_id=user.id, skill_id=skill.id, local_date=today, minutes=min(600, data.minutes),
                            metrics={"kind": "reading", "book": b.title, "pages": s.pages}, source="reading"))
    db.commit()
    return reading.overview(db, user.id, today)


@router.post("/reading/books/{book_id}/highlights", status_code=201)
def book_highlight(book_id: uuid.UUID, data: dto.HighlightIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    b = owned(db, Book, user.id, book_id)
    b.highlights = [*(b.highlights or []), data.model_dump()][-200:]
    db.commit(); db.refresh(b); return reading.book_out(b, None, _today(db, user))


@router.delete("/reading/books/{book_id}/highlights/{index}")
def book_highlight_delete(book_id: uuid.UUID, index: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    b = owned(db, Book, user.id, book_id)
    items = list(b.highlights or [])
    if not 0 <= index < len(items):
        raise HTTPException(404, "Not found")
    items.pop(index)
    b.highlights = items
    db.commit(); db.refresh(b); return reading.book_out(b, None, _today(db, user))


@router.post("/reading/books/{book_id}/takeaways")
def book_takeaways(book_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """AI summary of YOUR highlights (key ideas and how to apply them). Needs AI on and at least one highlight."""
    b = owned(db, Book, user.id, book_id)
    text = reading.ai_takeaways(db, user.id, b)
    if not text:
        raise HTTPException(503, "Needs AI switched on and at least one highlight or note.")
    db.commit(); return {"text": text.strip()}


@router.put("/reading/goal")
def reading_goal(data: dto.ReadingGoalIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    if p is None:
        p = UserProfile(user_id=user.id); db.add(p)
    p.reading_goal_books, p.reading_daily_minutes = data.books_per_year, data.daily_minutes
    db.commit()
    return reading.overview(db, user.id, _today(db, user))
