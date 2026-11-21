from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text

from app.api.v1.router import router
from app.core.config import settings
from app.core.database import Base, engine
import app.models  # noqa: F401


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Production schema changes are applied by Alembic in the container entrypoint.
    # create_all keeps local SQLite development usable without a database server.
    if settings.environment != "production":
        if engine.dialect.name == "postgresql":
            with engine.begin() as connection:
                connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Sakuna AI", version="1.0.0", lifespan=lifespan)
origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)
app.add_middleware(GZipMiddleware, minimum_size=800)   # JSON shrinks 5-10x: much faster on mobile data
app.include_router(router, prefix="/api/v1")


@app.get("/health", tags=["system"])
@app.get("/health/ready", tags=["system"], include_in_schema=False)
@app.get("/api/v1/health", tags=["system"], include_in_schema=False)
def health():
    """Readiness: the API is up and the database answers.

    Also served under /api/v1/health so the deploy health check works through
    Caddy, which only forwards /api/* to this service.
    """
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok", "version": app.version}


@app.get("/health/live", tags=["system"], include_in_schema=False)
def liveness():
    """Liveness: the process answers, without touching the database."""
    return {"status": "ok"}
