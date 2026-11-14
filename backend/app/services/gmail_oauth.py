"""Phase 5 (Fiverr F1): connect Gmail read-only with OAuth 2.0 + PKCE. Connect, check, disconnect (revoke). No sync yet.

Security (guide 13.1-13.2):
- Minimum scope: gmail.readonly (+ openid email to show which account is connected). Nothing is ever sent or changed.
- `state` is random, single-use, expires in 10 minutes, stored only as a SHA-256 hash; PKCE (S256) binds the code.
- Refresh/access tokens are Fernet-encrypted with TOKEN_ENCRYPTION_KEY (kept outside the database).
- Disconnect revokes at Google first, then deletes the tokens locally. Errors never include token values.
- "Testing" consent screens get refresh tokens that Google revokes after ~7 days: that shows as status "expired"
  with a one-click reconnect, never as a crash.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, now_utc
from app.core.config import settings
from app.models.entities import IntegrationConnection, OAuthState
from app.services.audit import audit

PROVIDER = "gmail"
GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
SCOPES = ("openid", "email", GMAIL_SCOPE)
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
STATE_TTL = timedelta(minutes=10)
FIVERR_QUERY = "from:(fiverr.com) newer_than:90d"


class Expired(Exception):
    """Google no longer accepts the refresh token (revoked, password change, or the 7-day Testing limit)."""


# ---------- configuration and encryption ----------

def configured() -> bool:
    return all((settings.google_client_id, settings.google_client_secret, settings.google_redirect_uri, settings.token_encryption_key))


def _fernet() -> Fernet:
    try:
        return Fernet(settings.token_encryption_key.encode())
    except (ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "TOKEN_ENCRYPTION_KEY is missing or not a valid Fernet key") from exc


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:  # key was rotated or data damaged: treat the connection as needing a reconnect
        raise Expired("stored token cannot be decrypted with the current key") from exc


def _require_configured() -> None:
    if not configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Gmail connection is not set up on the server yet (Google client ID/secret, redirect URI, encryption key).")


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


# ---------- HTTP (small seams so tests never call Google) ----------

def _post(url: str, data: dict) -> tuple[int, dict]:
    response = httpx.post(url, data=data, timeout=15)
    try:
        body = response.json()
    except ValueError:
        body = {}
    return response.status_code, body


def _get(url: str, token: str, params: dict | None = None) -> tuple[int, dict]:
    response = httpx.get(url, headers={"Authorization": f"Bearer {token}"}, params=params, timeout=15)
    try:
        body = response.json()
    except ValueError:
        body = {}
    return response.status_code, body


# ---------- connect ----------

def start_connect(db: Session, user_id) -> str:
    """Create a one-time state + PKCE verifier and return Google's consent URL."""
    _require_configured()
    now = now_utc()
    db.execute(delete(OAuthState).where(OAuthState.user_id == user_id, OAuthState.provider == PROVIDER))  # one pending attempt
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    db.add(OAuthState(user_id=user_id, provider=PROVIDER, state_hash=_hash(state), verifier_enc=encrypt(verifier),
                      created_at=now, expires_at=now + STATE_TTL))
    audit(db, user_id, "integration.connect_started", "integration", None, {"provider": PROVIDER})
    return AUTH_URL + "?" + urlencode({
        "client_id": settings.google_client_id, "redirect_uri": settings.google_redirect_uri, "response_type": "code",
        "scope": " ".join(SCOPES), "access_type": "offline", "prompt": "consent", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })


def _email_from_id_token(id_token: str | None) -> str | None:
    """The ID token came straight from Google's token endpoint over TLS, so its claims can be read without re-verifying
    the signature (OpenID Connect Core 3.1.3.7). Used only to show which account is connected."""
    if not id_token or id_token.count(".") != 2:
        return None
    payload = id_token.split(".")[1]
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    email = claims.get("email")
    return email if isinstance(email, str) and claims.get("email_verified", True) else None


def finish_connect(db: Session, code: str | None, state: str | None, error: str | None) -> tuple[bool, str]:
    """Handle Google's redirect. Returns (ok, short reason code for the web app). Never raises for user errors."""
    if not configured():
        return False, "not_configured"
    if not state:
        return False, "missing_state"
    row = db.scalar(select(OAuthState).where(OAuthState.state_hash == _hash(state), OAuthState.provider == PROVIDER))
    if row is None or row.used_at is not None:
        return False, "invalid_state"
    row.used_at = now_utc()
    db.flush()
    if as_utc(row.expires_at) < now_utc():
        return False, "expired_state"
    if error:
        audit(db, row.user_id, "integration.connect_denied", "integration", None, {"provider": PROVIDER, "error": error[:50]})
        return False, "denied" if error == "access_denied" else "google_error"
    if not code:
        return False, "missing_code"
    try:
        verifier = decrypt(row.verifier_enc)
    except Expired:
        return False, "invalid_state"
    code_status, body = _post(TOKEN_URL, {
        "code": code, "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
        "redirect_uri": settings.google_redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier,
    })
    if code_status != 200 or "access_token" not in body:
        audit(db, row.user_id, "integration.connect_failed", "integration", None, {"provider": PROVIDER, "error": str(body.get("error", code_status))[:50]})
        return False, "exchange_failed"
    granted = set(str(body.get("scope", "")).split())
    if GMAIL_SCOPE not in granted:
        _revoke(body.get("refresh_token") or body["access_token"])  # don't keep a grant we can't use
        return False, "gmail_permission_not_granted"
    if not body.get("refresh_token"):
        return False, "no_refresh_token"
    now = now_utc()
    conn = db.scalar(select(IntegrationConnection).where(IntegrationConnection.user_id == row.user_id, IntegrationConnection.provider == PROVIDER))
    if conn is None:
        conn = IntegrationConnection(user_id=row.user_id, provider=PROVIDER, created_at=now)
        db.add(conn)
    conn.account_email = _email_from_id_token(body.get("id_token"))
    conn.scopes = " ".join(sorted(granted))
    conn.refresh_token_enc = encrypt(body["refresh_token"])
    conn.access_token_enc = encrypt(body["access_token"])
    conn.access_expires_at = now + timedelta(seconds=int(body.get("expires_in", 3600)) - 60)
    conn.status, conn.last_error, conn.connected_at, conn.updated_at = "connected", None, now, now
    db.flush()
    audit(db, row.user_id, "integration.connected", "integration", conn.id, {"provider": PROVIDER, "scopes": conn.scopes})
    return True, "connected"


# ---------- use ----------

def _mark_expired(db: Session, conn: IntegrationConnection, reason: str) -> None:
    conn.status = "expired"
    conn.last_error = reason[:500]
    conn.access_token_enc = None
    conn.refresh_token_enc = None
    conn.updated_at = now_utc()
    audit(db, conn.user_id, "integration.expired", "integration", conn.id, {"provider": PROVIDER})


def access_token(db: Session, conn: IntegrationConnection, force_refresh: bool = False) -> str:
    if conn.status == "expired" or not conn.refresh_token_enc:
        raise Expired("not connected")
    if not force_refresh and conn.access_token_enc and conn.access_expires_at and as_utc(conn.access_expires_at) > now_utc():
        return decrypt(conn.access_token_enc)
    code, body = _post(TOKEN_URL, {"client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
                                   "refresh_token": decrypt(conn.refresh_token_enc), "grant_type": "refresh_token"})
    if code == 400 and body.get("error") == "invalid_grant":
        _mark_expired(db, conn, "Google ended this connection (revoked, password changed, or the 7-day Testing limit). Reconnect.")
        raise Expired("invalid_grant")
    if code != 200 or "access_token" not in body:
        conn.status, conn.last_error = "error", f"Token refresh failed ({body.get('error', code)})"
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, conn.last_error)
    conn.access_token_enc = encrypt(body["access_token"])
    conn.access_expires_at = now_utc() + timedelta(seconds=int(body.get("expires_in", 3600)) - 60)
    if body.get("refresh_token"):  # Google may rotate it
        conn.refresh_token_enc = encrypt(body["refresh_token"])
    conn.status, conn.last_error, conn.updated_at = "connected", None, now_utc()
    return body["access_token"]


def check(db: Session, conn: IntegrationConnection) -> dict:
    """Read-only health check: mailbox profile + how many Fiverr emails exist in 90 days (counts only, no content)."""
    _require_configured()
    try:
        token = access_token(db, conn)
        code, profile = _get(f"{GMAIL_API}/profile", token)
        if code == 401:
            token = access_token(db, conn, force_refresh=True)
            code, profile = _get(f"{GMAIL_API}/profile", token)
    except Expired:
        return {"ok": False, "status": "expired", "message": conn.last_error or "Reconnect Gmail."}
    if code != 200:
        conn.status, conn.last_error = "error", f"Gmail API returned {code}"
        return {"ok": False, "status": "error", "message": conn.last_error}
    fiverr_code, listing = _get(f"{GMAIL_API}/messages", token, {"q": FIVERR_QUERY, "maxResults": 1})
    conn.last_checked_at = conn.updated_at = now_utc()
    conn.status, conn.last_error = "connected", None
    if profile.get("emailAddress"):
        conn.account_email = profile["emailAddress"]
    return {"ok": True, "status": "connected", "email": conn.account_email, "messages_total": profile.get("messagesTotal"),
            "fiverr_emails_90_days": listing.get("resultSizeEstimate", 0) if fiverr_code == 200 else None}


def _revoke(token: str) -> bool:
    try:
        code, body = _post(REVOKE_URL, {"token": token})
    except httpx.HTTPError:
        return False
    return code == 200 or body.get("error") == "invalid_token"  # already revoked counts as done


def disconnect(db: Session, conn: IntegrationConnection) -> dict:
    """Revoke at Google, then delete the tokens and the connection locally (local delete happens even if Google is down)."""
    revoked = False
    for enc in (conn.refresh_token_enc, conn.access_token_enc):
        if enc and not revoked:
            try:
                revoked = _revoke(decrypt(enc))
            except Expired:
                pass
    audit(db, conn.user_id, "integration.disconnected", "integration", conn.id, {"provider": PROVIDER, "revoked_at_google": revoked})
    db.delete(conn)
    return {"disconnected": True, "revoked_at_google": revoked,
            "note": None if revoked else "Removed here. To be sure, also remove access at myaccount.google.com/permissions."}


def describe(conn: IntegrationConnection | None) -> dict | None:
    if conn is None:
        return None
    return {"provider": conn.provider, "status": conn.status, "email": conn.account_email, "scopes": conn.scopes.split(),
            "read_only": GMAIL_SCOPE in conn.scopes.split() and "https://mail.google.com/" not in conn.scopes,
            "connected_at": conn.connected_at, "last_checked_at": conn.last_checked_at, "last_error": conn.last_error}
