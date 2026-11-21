"""Speaking coach and search everything (FinBERT news tone lives in the portfolio review)."""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, owned
from app.models.entities import SpeakingSession, User
from app.schemas import dto

router = APIRouter()


@router.get("/speaking")
def speaking_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import speaking
    return speaking.overview(db, user.id)


@router.post("/speaking/sessions", status_code=201)
def speaking_create(data: dto.SpeakingIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Score one talk from its transcript (plain code: pace, filler words, variety, length)."""
    from app.services import speaking
    row = speaking.save(db, user.id, data.transcript, data.seconds, data.lang, data.topic, data.source); db.commit(); db.refresh(row)
    return speaking.out(row)


@router.post("/speaking/audio", status_code=201)
async def speaking_audio(file: UploadFile = File(...), seconds: int = Form(..., ge=5, le=1800), lang: str = Form("en"),
                         topic: str | None = Form(None), fallback: str | None = Form(None),
                         db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Recorded talk -> Whisper transcript (your AI provider) -> scores. Falls back to the phone's transcript if Whisper is off."""
    from app.services import speaking
    from app.services.ai_client import transcribe_audio
    if lang not in ("en", "de"):
        raise HTTPException(422, "lang must be en or de")
    content = await file.read(12 * 1024 * 1024 + 1)
    if len(content) > 12 * 1024 * 1024:
        raise HTTPException(413, "Audio file is too large")
    text = transcribe_audio(db, user.id, file.filename or "talk.m4a", content, file.content_type or "audio/mp4")
    source = "whisper" if text else "device"
    text = text or (fallback or "")
    row = speaking.save(db, user.id, text, seconds, lang, topic, source); db.commit(); db.refresh(row)
    return speaking.out(row)


@router.post("/speaking/{session_id}/feedback")
def speaking_feedback(session_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Optional AI coach feedback on one talk (only when AI is on)."""
    from app.services import speaking
    row = owned(db, SpeakingSession, user.id, session_id)
    text = speaking.ai_feedback(db, user.id, row)
    if not text:
        raise HTTPException(503, "AI feedback needs AI switched on; your scores and tips work without it.")
    db.commit(); return speaking.out(row)


@router.delete("/speaking/{session_id}", status_code=204)
def speaking_delete(session_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = owned(db, SpeakingSession, user.id, session_id)
    db.delete(row); db.commit()


@router.get("/search")
def search_everything(q: str = Query(min_length=1, max_length=200), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Search your tasks, notes, journal, videos, news, cards, jobs... by words, and by meaning when HF_TOKEN is set."""
    from app.services import search
    out = search.search(db, user.id, q); db.commit(); return out


@router.get("/speaking/drill")
def speaking_drill_phrases(lang: str = Query(default="de", pattern="^(de|en)$"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Sentences to practise saying: your own German flashcards first, then built-in everyday phrases."""
    from app.services import speaking
    return {"lang": lang, "phrases": speaking.drill_phrases(db, user.id, lang)}


@router.post("/speaking/drill", status_code=201)
def speaking_drill(data: dto.DrillIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Say a sentence: compare what the phone heard with the target, word by word, and save the score."""
    from app.services import speaking
    res = speaking.compare_speech(data.target, data.heard)
    row = SpeakingSession(user_id=user.id, lang=data.lang, topic=f"Say it: {data.target[:180]}", transcript=(data.heard or "(nothing heard)")[:20000],
                          seconds=max(5, data.seconds), words=len(data.heard.split()), wpm=0, fillers=0, score=res["accuracy"],
                          details={"kind": "drill", "target": data.target, **res}, source="device")
    db.add(row); db.commit()
    return {**res, "id": row.id}
