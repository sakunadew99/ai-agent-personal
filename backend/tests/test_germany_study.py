"""Study in Germany: DAAD search (faked, no network), summary, save to tracker, ownership, chat retries."""
import json
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import daad

SEARCH = {"numResults": 42, "courses": [
    {"id": 101, "courseName": "Data Science (MSc)", "academy": "TU Example", "city": "Dresden", "languages": ["English"],
     "beginning": "Winter semester", "programmeDuration": "4 semesters", "tuitionFees": "No tuition fees",
     "applicationDeadline": "Register by 15 January 2099 + 1 more", "subject": "Data Science"},
    {"id": 102, "courseName": "AI Engineering", "academy": "Private Uni", "city": "Berlin", "languages": ["English"],
     "beginning": "Winter semester, Summer semester", "programmeDuration": "3 semesters", "tuitionFees": "5,980",
     "applicationDeadline": "<ul><li>until 31 May</li></ul>", "subject": "Computer Science"},
    {"id": 103, "courseName": "Informatik", "academy": "Uni Nord", "city": "Kiel", "languages": ["German"],
     "beginning": "Winter semester", "tuitionFees": "Tuition varies", "applicationDeadline": "This programme has no deadline."},
]}

DETAIL = """<html><h2 class="c-detail-header__title"><span class="d-none">Data Science (MSc)</span><span>DS</span></h2>
<h3 class="c-detail-header__subtitle">TU Example – Dresden</h3>
<div class="tab-pane" id="overview" role="tabpanel"><dl><dt>Teaching language</dt><dd>English</dd>
<dt>Course-specific, integrated English language courses</dt><dd>No</dd></dl></div>
<div class="tab-pane" id="costs" role="tabpanel"><dl><dt>Tuition fees per semester</dt><dd>None</dd>
<dt>Semester contribution</dt><dd>Approx. 300 EUR per semester</dd></dl></div>
<div class="tab-pane" id="registration" role="tabpanel"><dl>
<dt>Academic admission requirements</dt><dd>Bachelor's degree (180 ECTS) in CS; GRE recommended</dd>
<dt>English language skills</dt><dd>C1 required, e.g. IELTS Academic: 6.5 TOEFL iBT (before 2026): 90</dd>
<dt>Application periods</dt><dd>Winter semester: 1 November - 15 January 2099</dd>
<dt>Submit application via</dt><dd>uni-assist</dd></dl></div>
<div class="tab-pane" id="university" role="tabpanel"></div></html>"""


def fake_fetch(url, params=None):
    if url == daad.SEARCH_URL:
        q = dict(params or [])["q"]
        return json.dumps(SEARCH if "nothing" not in q else {"numResults": 0, "courses": []})
    if "/detail/" in url:
        return DETAIL
    raise AssertionError(url)


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(daad, "_fetch", fake_fetch)
    with TestClient(app) as c:
        yield c


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"de.{uuid.uuid4().hex[:8]}@example.com", "password": "Germany-test-pass-one", "full_name": "G"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None, extra=None):
        resp = client.request(method, "/api/v1" + path, headers={**headers, **(extra or {})}, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


def test_parsers():
    today = date(2026, 11, 15)
    assert daad.next_deadline("Register by 15 January 2027 + 1 more", today) == date(2027, 1, 15)
    assert daad.next_deadline("until 15 November and until 31 May", today) == date(2026, 11, 15)
    assert daad.next_deadline("until 1 March", today) == date(2027, 3, 1)
    assert daad.next_deadline("no deadline", today) is None
    assert daad.next_deadline("For the winter semester: 1 June - 15 July", today) == date(2027, 7, 15)
    assert daad._fee("No tuition fees") == 0 and daad._fee("5,980") == 5980 and daad._fee("Tuition varies") is None
    assert daad._ielts("IELTS Academic: 6.5") == 6.5 and daad._score("TOEFL iBT (before 2026): 90", "TOEFL") == 90


def test_search_summary_and_save(client):
    api = _user(client)
    r = api("GET", "/study/germany/search?fields=Data%20Science,AI&lang=en", expect=200).json()
    assert r["total"] == 84 and len(r["courses"]) == 3            # both fields returned the same 3 programmes (deduplicated)
    first = r["courses"][0]
    assert first["id"] == 101 and first["tuition_per_semester"] == 0 and first["next_deadline"] == "2099-01-15"
    assert first["facts"]["ielts"] == 6.5 and first["facts"]["uni_assist"] and first["facts"]["gre"] and first["facts"]["ects"] == 180
    assert first["facts"]["english_level"] == "C1" and first["facts"]["semester_contribution_eur"] == 300
    s = r["summary"]
    assert s["tuition_free"] == 1 and s["with_fee"] == 1 and s["first_year_eur"]["blocked_account"] == 11904
    assert "tuition-free" in s["headline"] and r["documents"] and first["saved_id"] is None

    free = api("GET", "/study/germany/search?fields=Data%20Science&free=true", expect=200).json()
    assert [c["id"] for c in free["courses"]] == [101]

    saved = api("POST", "/study/germany/101/save", expect=201).json()
    assert saved["country"] == "Germany" and saved["university"] == "TU Example" and saved["deadline"] == "2099-01-15"
    assert saved["tuition_per_year"] in ("0.00", 0, "0") and saved["language_test"] == "IELTS 6.5" and "daad.de" in saved["link"]
    again = api("POST", "/study/germany/101/save", expect=201).json()
    assert again["id"] == saved["id"]                              # saving twice doesn't duplicate
    r2 = api("GET", "/study/germany/search?fields=Data%20Science", expect=200).json()
    assert r2["courses"][0]["saved_id"] == saved["id"]

    detail = api("GET", "/study/germany/101", expect=200).json()
    assert detail["header"]["university"] == "TU Example" and detail["facts"]["submit_via"] == "uni-assist"
    text = api("POST", "/study/germany/explain", {"fields": "Data Science"}, expect=200).json()["text"]
    assert "blocked account" in text.lower()

    api("GET", "/study/germany/search?fields=x", expect=422)        # too short


def test_saved_program_is_private(client):
    a, b = _user(client), _user(client)
    saved = a("POST", "/study/germany/101/save", expect=201).json()
    b("GET", f"/study/programs/{saved['id']}/requirements", expect=404)
    b("PATCH", f"/study/programs/{saved['id']}", {"stage": "apply"}, expect=404)
    assert all(p["id"] != saved["id"] for p in b("GET", "/study/programs", expect=200).json())
    b_saved = b("POST", "/study/germany/101/save", expect=201).json()  # B gets their own copy
    assert b_saved["id"] != saved["id"]


def test_daad_down_is_a_clear_error(client, monkeypatch):
    import httpx

    def down(url, params=None):
        raise httpx.ConnectError("down")
    daad.clear_cache()
    monkeypatch.setattr(daad, "_fetch", down)
    api = _user(client)
    r = api("GET", "/study/germany/search?fields=Data%20Science", expect=502)
    assert "DAAD" in r.json()["detail"]


def test_chat_retry_with_same_key_returns_first_answer(client):
    api = _user(client)
    key = {"Idempotency-Key": uuid.uuid4().hex}
    first = api("POST", "/chat", {"message": "what should I focus on today"}, expect=200, extra=key).json()
    second = api("POST", "/chat", {"message": "what should I focus on today"}, expect=200, extra=key).json()
    assert first["conversation_id"] == second["conversation_id"] and first["reply"] == second["reply"]
    conv = api("GET", f"/conversations/{first['conversation_id']}", expect=200).json()
    assert len(conv["messages"]) == 2                                # the retry did not add messages
    api("POST", "/chat", {"message": "something else"}, expect=409, extra=key)
