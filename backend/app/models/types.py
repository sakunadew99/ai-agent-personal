import json
import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String, Text, TypeDecorator
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON


def uuid_pk() -> uuid.UUID:
    return uuid.uuid4()


class EmbeddingType(TypeDecorator):
    impl = Text
    cache_ok = True

    def __init__(self, dimensions: int = 1536) -> None:
        super().__init__()
        self.dimensions = dimensions

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from pgvector.sqlalchemy import Vector

            return dialect.type_descriptor(Vector(self.dimensions))
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value, dialect):
        if value is None or dialect.name == "postgresql":
            return value
        return json.dumps(value)

    def process_result_value(self, value, dialect):
        if value is None or dialect.name == "postgresql":
            return value
        if isinstance(value, str):
            return json.loads(value)
        return value


JsonDict = JSON().with_variant(JSONB(), "postgresql")
Money = Numeric(14, 2)
Short = String(64)
Name = String(200)
LongName = String(320)


def utcnow() -> datetime:
    from datetime import timezone

    return datetime.now(timezone.utc)


__all__ = [
    "DateTime",
    "Decimal",
    "EmbeddingType",
    "JsonDict",
    "LongName",
    "Money",
    "Name",
    "Short",
    "date",
    "datetime",
    "time",
    "uuid",
    "uuid_pk",
    "utcnow",
]
