"""Phase 5 (Fiverr F1): Gmail OAuth connect / check / disconnect. Google is faked; no network calls."""
import base64
import json
import uuid
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.clock import now_utc
from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.models.entities import IntegrationConnection, OAuthState
from app.services import gmail_oauth

GMAIL = gmail_oauth.GMAIL_SCOPE


def _id_token(email: str) -> str:
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{part({'alg': 'none'})}.{part({'email': email, 'email_verified': True})}.sig"


class FakeGoogle:
    def __init__(self):
        self.posts: list[tuple[str, dict]] = []
        self.token_response = (200, {"access_token": "ya29.access-1", "refresh_token": "1//refresh-1", "expires_in": 3599,
                                     "scope": f"openid https://www.googleapis.com/auth/userinfo.email {GMAIL}", "id_token": _id_token("me@gmail.com")})
        self.refresh_response = (200, {"access_token": "ya29.access-2", "expires_in": 3599})
        self.profile = (200, {"emailAddress": "me@gmail.com", "messagesTotal": 4321})

    def post(self, url, data):
        self.posts.append((url, data))
        if url == gmail_oauth.REVOKE_URL:
            return 200, {}
        if data.get("grant_type") == "refresh_token":
            return self.refresh_response
        return self.token_response

    def get(self, url, token, params=None):
        if url.endswith("/profile"):
            return self.profile
        return 200, {"resultSizeEstimate": 7}


@pytest.fixture()
def google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(gmail_oauth, "_post", fake.post)
    monkeypatch.setattr(gmail_oauth, "_get", fake.get)
    for key, value in {"google_client_id": "cid.apps.googleusercontent.com", "google_client_secret": "secret",
                       "google_redirect_uri": "https://example.test/api/v1/integrations/google/callback",
                       "token_encryption_key": Fernet.generate_key().decode(), "web_app_url": "/"}.items():
        monkeypatch.setattr(settings, key, value)
    return fake


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _user(client, name):
    r = client.post("/api/v1/auth/register", json={"email": f"{name}.{uuid.uuid4().hex[:8]}@example.com", "password": "Gmail-test-pass-1", "full_name": name})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _connect_url(client, headers):
    r = client.post("/api/v1/integrations/gmail/connect", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["auth_url"]


def _callback(client, **params):
    return client.get("/api/v1/integrations/google/callback", params=params, follow_redirects=False)


def test_not_configured_is_clear(client, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    h = _user(client, "nocfg")
    assert client.get("/api/v1/integrations", headers=h).json()["gmail"]["configured"] is False
    r = client.post("/api/v1/integrations/gmail/connect", headers=h)
    assert r.status_code == 503 and "not set up" in r.json()["detail"]


def test_auth_url_is_read_only_pkce_and_offline(client, google):
    url = _connect_url(client, _user(client, "url"))
    q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
    assert url.startswith(gmail_oauth.AUTH_URL)
    assert set(q["scope"].split()) == {"openid", "email", GMAIL}           # minimum scope, read-only
    assert q["code_challenge_method"] == "S256" and len(q["code_challenge"]) >= 43
    assert q["access_type"] == "offline" and q["prompt"] == "consent" and len(q["state"]) >= 40
    with SessionLocal() as db:  # only the hash of state is stored
        assert db.query(OAuthState).filter(OAuthState.state_hash == q["state"]).count() == 0


def test_full_connect_check_and_disconnect(client, google):
    alice, bob = _user(client, "alice"), _user(client, "bob")
    state = parse_qs(urlparse(_connect_url(client, alice)).query)["state"][0]
    r = _callback(client, code="4/abc", state=state)
    assert r.status_code == 303 and r.headers["location"] == "/?gmail=connected&reason=connected#settings"
    token_call = google.posts[-1][1]
    assert token_call["grant_type"] == "authorization_code" and token_call["code_verifier"]   # PKCE verifier sent
    with SessionLocal() as db:
        conn = db.query(IntegrationConnection).filter(IntegrationConnection.account_email == "me@gmail.com").one()
        assert "1//refresh-1" not in conn.refresh_token_enc and gmail_oauth.decrypt(conn.refresh_token_enc) == "1//refresh-1"
    # Same state again is rejected (single use).
    assert "reason=invalid_state" in _callback(client, code="4/abc", state=state).headers["location"]
    info = client.get("/api/v1/integrations", headers=alice).json()["gmail"]["connection"]
    assert info["status"] == "connected" and info["read_only"] is True and info["email"] == "me@gmail.com"
    assert "refresh" not in json.dumps(info).lower().replace("last_checked_at", "")              # no tokens in API output
    # Bob never sees or controls Alice's connection.
    assert client.get("/api/v1/integrations", headers=bob).json()["gmail"]["connection"] is None
    assert client.post("/api/v1/integrations/gmail/check", headers=bob).status_code == 404
    assert client.delete("/api/v1/integrations/gmail", headers=bob).status_code == 404
    # Read-only check: counts only.
    check = client.post("/api/v1/integrations/gmail/check", headers=alice).json()
    assert check == {"ok": True, "status": "connected", "email": "me@gmail.com", "messages_total": 4321, "fiverr_emails_90_days": 7}
    # Disconnect revokes at Google with the refresh token, then deletes locally.
    out = client.delete("/api/v1/integrations/gmail", headers=alice).json()
    assert out["revoked_at_google"] is True
    assert google.posts[-1] == (gmail_oauth.REVOKE_URL, {"token": "1//refresh-1"})
    assert client.get("/api/v1/integrations", headers=alice).json()["gmail"]["connection"] is None


def test_expired_refresh_token_becomes_reconnect(client, google):
    h = _user(client, "expiry")
    state = parse_qs(urlparse(_connect_url(client, h)).query)["state"][0]
    _callback(client, code="4/x", state=state)
    with SessionLocal() as db:
        conn = db.query(IntegrationConnection).order_by(IntegrationConnection.created_at.desc()).first()
        conn.access_expires_at = now_utc() - timedelta(minutes=1)
        db.commit()
    google.refresh_response = (400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
    check = client.post("/api/v1/integrations/gmail/check", headers=h).json()
    assert check["ok"] is False and check["status"] == "expired"
    info = client.get("/api/v1/integrations", headers=h).json()["gmail"]["connection"]
    assert info["status"] == "expired" and "Reconnect" in info["last_error"]
    with SessionLocal() as db:
        conn = db.query(IntegrationConnection).filter(IntegrationConnection.status == "expired").first()
        assert conn.refresh_token_enc is None and conn.access_token_enc is None


@pytest.mark.parametrize(("params", "reason"), [
    ({"state": "made-up"}, "invalid_state"),
    ({}, "missing_state"),
])
def test_bad_callbacks(client, google, params, reason):
    assert f"reason={reason}" in _callback(client, code="4/x", **params).headers["location"]


def test_denied_expired_and_missing_scope(client, google):
    h = _user(client, "deny")
    state = parse_qs(urlparse(_connect_url(client, h)).query)["state"][0]
    assert "reason=denied" in _callback(client, error="access_denied", state=state).headers["location"]
    # Expired state (older than 10 minutes).
    state = parse_qs(urlparse(_connect_url(client, h)).query)["state"][0]
    with SessionLocal() as db:
        for row in db.query(OAuthState).all():
            row.expires_at = now_utc() - timedelta(seconds=1)
        db.commit()
    assert "reason=expired_state" in _callback(client, code="4/x", state=state).headers["location"]
    # User unticked the Gmail permission: nothing stored, grant revoked.
    google.token_response = (200, {"access_token": "a", "refresh_token": "r-noscope", "scope": "openid email", "expires_in": 3599})
    state = parse_qs(urlparse(_connect_url(client, h)).query)["state"][0]
    assert "reason=gmail_permission_not_granted" in _callback(client, code="4/x", state=state).headers["location"]
    assert google.posts[-1] == (gmail_oauth.REVOKE_URL, {"token": "r-noscope"})
    assert client.get("/api/v1/integrations", headers=h).json()["gmail"]["connection"] is None
