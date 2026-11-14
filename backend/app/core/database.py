import os
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def _engine():
    url = settings.database_url
    if url.startswith("sqlite"):
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    if os.getenv("DB_NULLPOOL", "").lower() in {"1", "true", "yes"}:
        # Serverless (Vercel): no idle pooled connections per instance; the Supabase pooler does the pooling.
        # prepare_threshold=None keeps psycopg compatible with transaction-mode poolers too.
        return create_engine(url, poolclass=NullPool, connect_args={"prepare_threshold": None})
    return create_engine(url, pool_pre_ping=True)


engine = _engine()


@event.listens_for(engine, "connect")
def _sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    if engine.dialect.name == "sqlite":
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
