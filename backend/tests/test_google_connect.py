"""Google connections: Gmail read-only (Fiverr F1) and Google Calendar. Google is faked; no network calls."""
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
from app.services import google_oauth as gmail_oauth

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
        self.events: list[dict] = []
        self.sent: list[tuple] = []

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
        if url.endswith("/calendars/primary"):
            return 200, {"summary": "me@gmail.com", "timeZone": "Asia/Colombo"}
        if url.endswith("/calendars/primary/events"):
            return 200, {"items": self.events}
        return 200, {"resultSizeEstimate": 7}

    def send(self, method, url, token, body=None):
        self.sent.append((method, url, body))
        if method == "POST":
            return 200, {"id": f"evt{len(self.sent)}", "htmlLink": "https://calendar.google.com/event?eid=x"}
        return 204, {}


@pytest.fixture()
def google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(gmail_oauth, "_post", fake.post)
    monkeypatch.setattr(gmail_oauth, "_get", fake.get)
    monkeypatch.setattr(gmail_oauth, "_send", fake.send)
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
    assert client.post("/api/v1/integrations/outlook/connect", headers=h).status_code == 422  # unknown provider


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


# ---------- Google Calendar ----------

CAL_READ, CAL_EVENTS = gmail_oauth.CAL_READ, gmail_oauth.CAL_EVENTS


def _connect_calendar(client, google, headers, write: bool):
    scope = CAL_EVENTS if write else CAL_READ
    google.token_response = (200, {"access_token": "ya29.cal", "refresh_token": f"1//cal-{uuid.uuid4().hex[:6]}", "expires_in": 3599,
                                   "scope": f"openid https://www.googleapis.com/auth/userinfo.email {scope}", "id_token": _id_token("me@gmail.com")})
    url = client.post("/api/v1/integrations/calendar/connect", json={"write": write}, headers=headers).json()["auth_url"]
    assert scope in parse_qs(urlparse(url).query)["scope"][0] and GMAIL not in url
    state = parse_qs(urlparse(url).query)["state"][0]
    return _callback(client, code="4/cal", state=state)


def test_calendar_read_only_connect_and_month_view(client, google):
    h = _user(client, "calread")
    r = _connect_calendar(client, google, h, write=False)
    assert r.headers["location"] == "/?calendar=connected&reason=connected#settings"
    info = client.get("/api/v1/integrations", headers=h).json()
    assert info["calendar"]["connection"]["can_add_events"] is False and info["gmail"]["connection"] is None   # separate connections
    google.events = [
        {"id": "e1", "summary": "Team meeting", "start": {"dateTime": "2027-03-03T10:00:00+05:30"}, "end": {"dateTime": "2027-03-03T11:00:00+05:30"}},
        {"id": "e2", "summary": "Holiday", "start": {"date": "2027-03-08"}, "end": {"date": "2027-03-09"}},
        {"id": "e3", "summary": "Mine", "start": {"dateTime": "2027-03-04T10:00:00Z"}, "end": {"dateTime": "2027-03-04T11:00:00Z"},
         "extendedProperties": {"private": {"sakuna_task_id": "x"}}},
        {"id": "e4", "status": "cancelled", "summary": "Gone", "start": {"dateTime": "2027-03-05T10:00:00Z"}, "end": {"dateTime": "2027-03-05T11:00:00Z"}},
    ]
    month = client.get("/api/v1/planner/monthly?month=2027-03", headers=h).json()
    assert month["calendar"] == "connected"
    assert [e["title"] for e in month["days"]["2027-03-03"] if e["kind"] == "event"] == ["Team meeting"]
    assert any(e["title"] == "Holiday" and e["at"] is None for e in month["days"]["2027-03-08"])
    assert "2027-03-04" not in month["days"] and "2027-03-05" not in month["days"]   # Sakuna's own + cancelled are skipped
    task = client.post("/api/v1/tasks", json={"title": "Dentist", "due_at": "2027-03-10T09:00:00Z"}, headers=h).json()
    r = client.post(f"/api/v1/tasks/{task['id']}/calendar", json={}, headers=h)
    assert r.status_code == 403 and "read-only" in r.json()["detail"]
    check = client.post("/api/v1/integrations/calendar/check", headers=h).json()
    assert check["ok"] is True and check["can_add_events"] is False


def test_calendar_add_task_with_reminders_repeat_and_remove(client, google):
    h, other = _user(client, "calwrite"), _user(client, "calother")
    _connect_calendar(client, google, h, write=True)
    task = client.post("/api/v1/tasks", json={"title": "German class", "due_at": "2027-03-01T13:30:00Z", "duration_minutes": 90,
                                              "recurrence": "FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20270630"}, headers=h).json()
    assert client.post(f"/api/v1/tasks/{task['id']}/calendar", json={}, headers=other).status_code == 404   # ownership
    r = client.post(f"/api/v1/tasks/{task['id']}/calendar", json={"popup_minutes": 10, "email_minutes": 60}, headers=h)
    assert r.status_code == 201, r.text
    method, url, body = google.sent[-1]
    assert method == "POST" and url.endswith("/calendars/primary/events")
    assert body["start"] == {"dateTime": "2027-03-01T19:00:00", "timeZone": "Asia/Colombo"}       # 13:30Z = 19:00 Colombo
    assert body["end"]["dateTime"] == "2027-03-01T20:30:00"
    assert body["reminders"] == {"useDefault": False, "overrides": [{"method": "popup", "minutes": 10}, {"method": "email", "minutes": 60}]}
    assert body["recurrence"] == ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20270630T235959Z"]
    assert body["extendedProperties"]["private"]["sakuna_task_id"] == task["id"]
    event_id = r.json()["event_id"]
    assert client.post(f"/api/v1/tasks/{task['id']}/calendar", json={}, headers=h).status_code == 409    # no duplicates
    client.patch(f"/api/v1/tasks/{task['id']}/complete", headers=h)
    nxt = next(t for t in client.get("/api/v1/tasks?status=todo", headers=h).json() if t["title"] == "German class")
    assert nxt["calendar_event_id"] == event_id                         # repeats share the one recurring Google event
    assert client.delete(f"/api/v1/tasks/{nxt['id']}/calendar", headers=h).json() == {"removed": True}
    assert google.sent[-1][0] == "DELETE" and google.sent[-1][1].endswith(f"/events/{event_id}")
    assert all(t["calendar_event_id"] is None for t in client.get("/api/v1/tasks", headers=h).json())
    no_date = client.post("/api/v1/tasks", json={"title": "Someday"}, headers=h).json()
    assert client.post(f"/api/v1/tasks/{no_date['id']}/calendar", json={}, headers=h).status_code == 422


def test_calendar_busy_time_reduces_capacity(client, google):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.services.gcalendar import busy_minutes_by_day
    tz = ZoneInfo("Asia/Colombo")
    d = datetime(2027, 3, 3).date()

    def ev(s, e, **kw):
        return {"start": datetime.fromisoformat(s), "end": datetime.fromisoformat(e), "busy": True, "all_day": False, **kw}
    events = [ev("2027-03-03T04:30:00+00:00", "2027-03-03T05:30:00+00:00"),            # 10:00-11:00 local
              ev("2027-03-03T05:00:00+00:00", "2027-03-03T06:00:00+00:00"),            # overlap -> 10:00-11:30 = 90 min
              ev("2027-03-03T08:00:00+00:00", "2027-03-03T08:30:00+00:00", busy=False),  # "free" ignored
              ev("2027-03-03T00:00:00+00:00", "2027-03-04T00:00:00+00:00", all_day=True)]
    assert busy_minutes_by_day(events, tz, [d]) == {d: 90}
    h = _user(client, "calbusy")
    _connect_calendar(client, google, h, write=False)
    local_tomorrow = (datetime.now(tz) + timedelta(days=1)).date()
    start = datetime.combine(local_tomorrow, datetime.min.time(), tzinfo=tz).replace(hour=9)
    google.events = [{"id": "b1", "summary": "Workshop", "start": {"dateTime": start.isoformat()}, "end": {"dateTime": (start + timedelta(hours=3)).isoformat()}}]
    data = client.get("/api/v1/time/insights", headers=h).json()
    assert data["calendar"] == "connected"
    tomorrow = next(x for x in data["days"] if x["date"] == local_tomorrow.isoformat())
    assert tomorrow["calendar_busy_minutes"] == 180 and tomorrow["capacity_minutes"] == data["capacity"]["plannable_minutes"] - 180


def test_calendar_too_broad_scope_is_refused(client, google):
    h = _user(client, "calbroad")
    google.token_response = (200, {"access_token": "a", "refresh_token": "r-broad", "expires_in": 3599,
                                   "scope": "openid email https://www.googleapis.com/auth/calendar"})
    url = client.post("/api/v1/integrations/calendar/connect", json={}, headers=h).json()["auth_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    assert "reason=calendar_permission_not_granted" in _callback(client, code="4/x", state=state).headers["location"]
    assert google.posts[-1] == (gmail_oauth.REVOKE_URL, {"token": "r-broad"})
