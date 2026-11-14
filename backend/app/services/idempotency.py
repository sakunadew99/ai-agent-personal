import hashlib
import json

from fastapi import HTTPException, status
from sqlalchemy import select

from app.models.entities import IdempotencyKey


def canonical_hash(payload) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def replay(db, user_id, key: str | None, payload_hash: str):
    if not key:
        return None
    row = db.scalar(select(IdempotencyKey).where(IdempotencyKey.user_id == user_id, IdempotencyKey.key == key))
    if row is None:
        return None
    if row.request_hash != payload_hash:
        raise HTTPException(status.HTTP_409_CONFLICT, "Idempotency key was reused with a different request")
    return row


def remember(db, user_id, key: str | None, payload_hash: str, body: dict, status_code: int = 200) -> None:
    if not key:
        return
    db.add(
        IdempotencyKey(
            user_id=user_id,
            key=key,
            request_hash=payload_hash,
            response_json=body,
            status_code=status_code,
        )
    )
