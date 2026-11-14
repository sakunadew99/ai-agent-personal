import time
import uuid
from collections import defaultdict
from collections.abc import Generator

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.entities import User

bearer = HTTPBearer(auto_error=False)
_buckets: dict[str, list[float]] = defaultdict(list)


def rate_limit(request: Request, limit: int = 30, window_seconds: int = 60) -> None:
    host = request.client.host if request.client else "unknown"
    key = f"{host}:{request.url.path}"
    current = time.monotonic()
    stamps = [stamp for stamp in _buckets[key] if current - stamp < window_seconds]
    if len(stamps) >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests")
    stamps.append(current)
    _buckets[key] = stamps


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user_id = decode_access_token(credentials.credentials)
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


def get_db_session() -> Generator[Session, None, None]:
    yield from get_db()


def owned(db: Session, model: type, user_id: uuid.UUID, row_id: uuid.UUID):
    row = db.get(model, row_id)
    if row is None or getattr(row, "user_id", None) != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if getattr(row, "deleted_at", None) is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row


def query_user(db: Session, model: type, user_id: uuid.UUID):
    statement = select(model).where(model.user_id == user_id)
    if hasattr(model, "deleted_at"):
        statement = statement.where(model.deleted_at.is_(None))
    return statement
