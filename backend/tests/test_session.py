"""Staying signed in: sliding 90-day refresh tokens that rotate, can't be reused, and end on sign-out."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.clock import as_utc
from app.core.database import SessionLocal
from app.core.security import hash_token
from app.main import app
from app.models.entities import RefreshToken


def _expiry(refresh: str) -> datetime:
    with SessionLocal() as db:
        return as_utc(db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh))).expires_at)


def test_sliding_refresh_rotation_and_logout():
    with TestClient(app) as client:
        email = f"ss.{uuid.uuid4().hex[:8]}@example.com"
        reg = client.post("/api/v1/auth/register", json={"email": email, "password": "Session-test-pass-1", "full_name": "S"}).json()
        assert _expiry(reg["refresh_token"]) > datetime.now(timezone.utc) + timedelta(days=89)            # 90 days, not 14
        login = client.post("/api/v1/auth/login", json={"email": email, "password": "Session-test-pass-1"}).json()
        first = login["refresh_token"]
        pair = client.post("/api/v1/auth/refresh", json={"refresh_token": first})
        assert pair.status_code == 200
        second = pair.json()["refresh_token"]
        assert second != first and _expiry(second) > datetime.now(timezone.utc) + timedelta(days=89)     # each use slides the window
        assert client.post("/api/v1/auth/refresh", json={"refresh_token": first}).status_code == 401    # old token can't be reused
        access = pair.json()["access_token"]
        out = client.post("/api/v1/auth/logout", json={"refresh_token": second}, headers={"Authorization": f"Bearer {access}"})
        assert out.status_code == 204
        assert client.post("/api/v1/auth/refresh", json={"refresh_token": second}).status_code == 401   # signed out = really out
