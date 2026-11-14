import re

from fastapi import HTTPException, status
from sqlalchemy import or_, select, text

from app.core.clock import now_utc
from app.models.entities import Memory, MemoryEmbedding
from app.services.ai_client import embed_text
from app.services.audit import audit
from app.services.capture import sensitivity_of


def save_memory(db, user_id, content: str, category: str, source: str, allow_sensitive: bool, pinned: bool = False) -> Memory:
    sensitivity = sensitivity_of(content)
    if sensitivity == "sensitive" and not allow_sensitive:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "This looks sensitive and was not saved. Confirm explicitly if you still want it stored.",
        )
    row = Memory(
        user_id=user_id,
        content=content.strip(),
        category=category,
        source=source,
        sensitivity=sensitivity,
        pinned=pinned,
    )
    db.add(row)
    db.flush()
    vector = embed_text(db, user_id, row.content)
    if vector is not None:
        db.add(MemoryEmbedding(memory_id=row.id, user_id=user_id, embedding=vector, model="text-embedding-3-small"))
    audit(db, user_id, "memory.save", "memory", row.id, {"category": category, "sensitivity": sensitivity})
    return row


def update_memory(db, row: Memory, content: str | None, category: str | None, pinned: bool | None, allow_sensitive: bool) -> Memory:
    if content is not None:
        sensitivity = sensitivity_of(content)
        if sensitivity == "sensitive" and not allow_sensitive:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "This looks sensitive and was not saved. Confirm explicitly if you still want it stored.",
            )
        row.content = content.strip()
        row.sensitivity = sensitivity
        db.query(MemoryEmbedding).filter(MemoryEmbedding.memory_id == row.id).delete()
        vector = embed_text(db, row.user_id, row.content)
        if vector is not None:
            db.add(MemoryEmbedding(memory_id=row.id, user_id=row.user_id, embedding=vector, model="text-embedding-3-small"))
    if category is not None:
        row.category = category
    if pinned is not None:
        row.pinned = pinned
    row.updated_at = now_utc()
    audit(db, row.user_id, "memory.update", "memory", row.id)
    return row


def delete_memory(db, row: Memory) -> None:
    row.deleted_at = now_utc()
    db.query(MemoryEmbedding).filter(MemoryEmbedding.memory_id == row.id).delete()
    audit(db, row.user_id, "memory.delete", "memory", row.id)


def search_memories(db, user_id, query: str, limit: int) -> list[Memory]:
    vector = embed_text(db, user_id, query)
    if vector is not None and db.bind is not None and db.bind.dialect.name == "postgresql":
        rows = db.execute(
            text(
                """
                SELECT m.id
                FROM memories m
                JOIN memory_embeddings e ON e.memory_id = m.id
                WHERE m.user_id = :user_id AND m.deleted_at IS NULL
                ORDER BY e.embedding <=> CAST(:embedding AS vector)
                LIMIT :limit
                """
            ),
            {"user_id": str(user_id), "embedding": "[" + ",".join(str(item) for item in vector) + "]", "limit": limit},
        ).all()
        ids = [row.id for row in rows]
        if ids:
            found = db.scalars(select(Memory).where(Memory.id.in_(ids))).all()
            order = {value: index for index, value in enumerate(ids)}
            return sorted(found, key=lambda item: order.get(item.id, 0))
    terms = [term for term in re.split(r"\s+", query.strip()) if len(term) > 1][:8]
    statement = select(Memory).where(Memory.user_id == user_id, Memory.deleted_at.is_(None))
    if terms:
        statement = statement.where(or_(*[Memory.content.ilike(f"%{term}%") for term in terms]))
    statement = statement.order_by(Memory.pinned.desc(), Memory.updated_at.desc()).limit(limit)
    return list(db.scalars(statement).all())
