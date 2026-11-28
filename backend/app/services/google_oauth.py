"""Google connections with OAuth 2.0 + PKCE: Gmail (read-only, Fiverr F1) and Google Calendar (read, optional add-events).

One Google Cloud project / OAuth client / redirect URI serves both. Each is a separate connection with its own consent,
so either can be connected, checked and revoked on its own.

Security (guide 13.1-13.2):
- Minimum scopes. Gmail: gmail.readonly. Calendar: calendar.readonly, or calendar.events only if you allow Sakuna
  to add events you confirm. Never mail sending, never full-account scopes.
- `state` is random, single-use, expires in 10 minutes, stored only as a SHA-256 hash; PKCE (S256) binds the code.
- Tokens are Fernet-encrypted with TOKEN_ENCRYPTION_KEY (kept outside the database) and never returned by the API.
- Disconnect revokes at Google first, then deletes locally. Errors never include token values.
- Google's "Testing" consent screens revoke refresh tokens after ~7 days: shown as status "expired" + one-click reconnect.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
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

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
CAL_READ = "https://www.googleapis.com/auth/calendar.readonly"
CAL_EVENTS = "https://www.googleapis.com/auth/calendar.events"
DRIVE_FILE = "https://www.googleapis.com/auth/drive.file"   # only files Sakuna creates (backups)
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
CALENDAR_API = "https://www.googleapis.com/calendar/v3"
STATE_TTL = timedelta(minutes=10)
FIVERR_QUERY = "from:(fiverr.com) newer_than:90d"
FORBIDDEN_SCOPES = {"https://mail.google.com/", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.modify",
                    "https://www.googleapis.com/auth/calendar"}


@dataclass(frozen=True)
class Provider:
    key: str
    label: str
    required_any: frozenset[str]   # at least one of these must be granted


PROVIDERS = {
    "gmail": Provider("gmail", "Gmail", frozenset({GMAIL_SCOPE})),
    "calendar": Provider("calendar", "Google Calendar", frozenset({CAL_READ, CAL_EVENTS})),
    "drive": Provider("drive", "Google Drive (backups)", frozenset({DRIVE_FILE})),
}
PROVIDER = "gmail"  # kept for older imports


def requested_scopes(provider: str, write: bool = False) -> tuple[str, ...]:
    if provider == "gmail":
        return ("openid", "email", GMAIL_SCOPE)
    if provider == "drive":
        return ("openid", "email", DRIVE_FILE)
    return ("openid", "email", CAL_EVENTS if write else CAL_READ)


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
    except InvalidToken as exc:  # key rotated or data damaged: treat as needing a reconnect
        raise Expired("stored token cannot be decrypted with the current key") from exc


def _require_configured() -> None:
    if not configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Google connection is not set up on the server yet (Google client ID/secret, redirect URI, encryption key).")


def _provider(key: str) -> Provider:
    if key not in PROVIDERS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown connection")
    return PROVIDERS[key]


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


# ---------- HTTP (small seams so tests never call Google) ----------

def _json(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _post(url: str, data: dict) -> tuple[int, dict]:
    response = httpx.post(url, data=data, timeout=15)
    return response.status_code, _json(response)


def _get(url: str, token: str, params: dict | None = None) -> tuple[int, dict]:
    response = httpx.get(url, headers={"Authorization": f"Bearer {token}"}, params=params, timeout=15)
    return response.status_code, _json(response)


def _send(method: str, url: str, token: str, body: dict | None = None) -> tuple[int, dict]:
    response = httpx.request(method, url, headers={"Authorization": f"Bearer {token}"}, json=body, timeout=15)
    return response.status_code, _json(response)


# ---------- connect ----------

def get_connection(db: Session, user_id, provider: str) -> IntegrationConnection | None:
    return db.scalar(select(IntegrationConnection).where(IntegrationConnection.user_id == user_id, IntegrationConnection.provider == provider))


def start_connect(db: Session, user_id, provider: str = "gmail", write: bool = False) -> str:
    """Create a one-time state + PKCE verifier and return Google's consent URL."""
    _provider(provider)
    _require_configured()
    now = now_utc()
    db.execute(delete(OAuthState).where(OAuthState.user_id == user_id, OAuthState.provider == provider))  # one pending attempt
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    db.add(OAuthState(user_id=user_id, provider=provider, state_hash=_hash(state), verifier_enc=encrypt(verifier),
                      created_at=now, expires_at=now + STATE_TTL))
    audit(db, user_id, "integration.connect_started", "integration", None, {"provider": provider, "write": write})
    return AUTH_URL + "?" + urlencode({
        "client_id": settings.google_client_id, "redirect_uri": settings.google_redirect_uri, "response_type": "code",
        "scope": " ".join(requested_scopes(provider, write)), "access_type": "offline", "prompt": "consent", "state": state,
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


def finish_connect(db: Session, code: str | None, state: str | None, error: str | None) -> tuple[bool, str, str]:
    """Handle Google's redirect. Returns (ok, provider, short reason code). Never raises for user errors."""
    if not configured():
        return False, "", "not_configured"
    if not state:
        return False, "", "missing_state"
    row = db.scalar(select(OAuthState).where(OAuthState.state_hash == _hash(state)))
    if row is None or row.used_at is not None or row.provider not in PROVIDERS:
        return False, "", "invalid_state"
    provider = PROVIDERS[row.provider]
    row.used_at = now_utc()
    db.flush()
    if as_utc(row.expires_at) < now_utc():
        return False, provider.key, "expired_state"
    if error:
        audit(db, row.user_id, "integration.connect_denied", "integration", None, {"provider": provider.key, "error": error[:50]})
        return False, provider.key, "denied" if error == "access_denied" else "google_error"
    if not code:
        return False, provider.key, "missing_code"
    try:
        verifier = decrypt(row.verifier_enc)
    except Expired:
        return False, provider.key, "invalid_state"
    code_status, body = _post(TOKEN_URL, {
        "code": code, "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
        "redirect_uri": settings.google_redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier,
    })
    if code_status != 200 or "access_token" not in body:
        audit(db, row.user_id, "integration.connect_failed", "integration", None, {"provider": provider.key, "error": str(body.get("error", code_status))[:50]})
        return False, provider.key, "exchange_failed"
    granted = set(str(body.get("scope", "")).split())
    if not granted & provider.required_any or granted & FORBIDDEN_SCOPES:
        _revoke(body.get("refresh_token") or body["access_token"])  # don't keep a grant we can't (or shouldn't) use
        return False, provider.key, f"{provider.key}_permission_not_granted" if not granted & provider.required_any else "too_broad"
    if not body.get("refresh_token"):
        return False, provider.key, "no_refresh_token"
    now = now_utc()
    conn = get_connection(db, row.user_id, provider.key)
    if conn is None:
        conn = IntegrationConnection(user_id=row.user_id, provider=provider.key, created_at=now)
        db.add(conn)
    conn.account_email = _email_from_id_token(body.get("id_token"))
    conn.scopes = " ".join(sorted(granted))
    conn.refresh_token_enc = encrypt(body["refresh_token"])
    conn.access_token_enc = encrypt(body["access_token"])
    conn.access_expires_at = now + timedelta(seconds=int(body.get("expires_in", 3600)) - 60)
    conn.status, conn.last_error, conn.connected_at, conn.updated_at = "connected", None, now, now
    db.flush()
    audit(db, row.user_id, "integration.connected", "integration", conn.id, {"provider": provider.key, "scopes": conn.scopes})
    return True, provider.key, "connected"


# ---------- use ----------

def _mark_expired(db: Session, conn: IntegrationConnection, reason: str) -> None:
    conn.status = "expired"
    conn.last_error = reason[:500]
    conn.access_token_enc = None
    conn.refresh_token_enc = None
    conn.updated_at = now_utc()
    audit(db, conn.user_id, "integration.expired", "integration", conn.id, {"provider": conn.provider})


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


def call(db: Session, conn: IntegrationConnection, method: str, url: str, params: dict | None = None, body: dict | None = None) -> tuple[int, dict]:
    """Authorised Google API call with one automatic token refresh on 401. Raises Expired when a reconnect is needed."""
    token = access_token(db, conn)
    send = (lambda t: _get(url, t, params)) if method == "GET" else (lambda t: _send(method, url, t, body))
    code, data = send(token)
    if code == 401:
        code, data = send(access_token(db, conn, force_refresh=True))
    return code, data


def check(db: Session, conn: IntegrationConnection) -> dict:
    """Read-only health check. Gmail: profile + Fiverr email count. Calendar: primary calendar + events in the next 7 days."""
    _require_configured()
    try:
        if conn.provider == "gmail":
            code, profile = call(db, conn, "GET", f"{GMAIL_API}/profile")
        elif conn.provider == "drive":
            code, profile = call(db, conn, "GET", "https://www.googleapis.com/drive/v3/files", {"pageSize": 1, "fields": "files(id)"})
        else:
            code, profile = call(db, conn, "GET", f"{CALENDAR_API}/calendars/primary")
    except Expired:
        return {"ok": False, "status": "expired", "message": conn.last_error or "Reconnect."}
    if code != 200:
        conn.status, conn.last_error = "error", f"Google API returned {code}"
        return {"ok": False, "status": "error", "message": conn.last_error}
    conn.last_checked_at = conn.updated_at = now_utc()
    conn.status, conn.last_error = "connected", None
    if conn.provider == "gmail":
        fiverr_code, listing = call(db, conn, "GET", f"{GMAIL_API}/messages", {"q": FIVERR_QUERY, "maxResults": 1})
        if profile.get("emailAddress"):
            conn.account_email = profile["emailAddress"]
        return {"ok": True, "status": "connected", "email": conn.account_email, "messages_total": profile.get("messagesTotal"),
                "fiverr_emails_90_days": listing.get("resultSizeEstimate", 0) if fiverr_code == 200 else None}
    if conn.provider == "drive":
        return {"ok": True, "status": "connected", "email": conn.account_email}
    now = now_utc()
    ev_code, events = call(db, conn, "GET", f"{CALENDAR_API}/calendars/primary/events",
                           {"timeMin": now.isoformat(), "timeMax": (now + timedelta(days=7)).isoformat(), "singleEvents": "true", "maxResults": 250})
    return {"ok": True, "status": "connected", "email": conn.account_email, "calendar": profile.get("summary"),
            "timezone": profile.get("timeZone"), "events_next_7_days": len(events.get("items", [])) if ev_code == 200 else None,
            "can_add_events": CAL_EVENTS in conn.scopes.split()}


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
    audit(db, conn.user_id, "integration.disconnected", "integration", conn.id, {"provider": conn.provider, "revoked_at_google": revoked})
    db.delete(conn)
    return {"disconnected": True, "revoked_at_google": revoked,
            "note": None if revoked else "Removed here. To be sure, also remove access at myaccount.google.com/permissions."}


def describe(conn: IntegrationConnection | None) -> dict | None:
    if conn is None:
        return None
    scopes = conn.scopes.split()
    return {"provider": conn.provider, "status": conn.status, "email": conn.account_email, "scopes": scopes,
            "read_only": not (set(scopes) & (FORBIDDEN_SCOPES | {CAL_EVENTS})), "can_add_events": CAL_EVENTS in scopes,
            "connected_at": conn.connected_at, "last_checked_at": conn.last_checked_at, "last_error": conn.last_error}
