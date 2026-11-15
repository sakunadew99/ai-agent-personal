"""Life OS Phase 3: exam coach (IELTS + Goethe): defaults, plan edits, scores, forecast, catch-up, feedback, assistant, coach."""
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.entities import ExamPlan
from app.services import ai_client
from app.services.exams import clean_score, ielts_overall, parse_exam_command

TODAY = date(2026, 11, 15)


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"ex.{uuid.uuid4().hex[:8]}@example.com", "password": "Exam-test-pass-1", "full_name": "E"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None):
        resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def api(client):
    return _user(client)


def _plans(api):
    return {p["exam"]: p for p in api("GET", "/exams", expect=200).json()}


def _age_plan(plan_id: str, days: int):
    with SessionLocal() as db:
        row = db.get(ExamPlan, uuid.UUID(plan_id))
        row.created_at = datetime.now(timezone.utc) - timedelta(days=days)
        db.commit()


# ---------- pure rules ----------

def test_ielts_rounding_and_score_cleaning():
    assert ielts_overall([Decimal("6.5"), Decimal("6.5"), Decimal("5.0"), Decimal("7.0")]) == Decimal("6.5")   # 6.25 -> 6.5
    assert ielts_overall([Decimal("6.5"), Decimal("6.5"), Decimal("6.5"), Decimal("7.5")]) == Decimal("7.0")   # 6.75 -> 7.0
    assert ielts_overall([Decimal("6"), Decimal("6"), Decimal("6"), Decimal("6.5")]) == Decimal("6.0")         # 6.125 -> 6.0
    assert clean_score("ielts", "6.3") == Decimal("6.5") and clean_score("goethe", "72.4") == Decimal("72")
    with pytest.raises(Exception):
        clean_score("ielts", 9.5)


@pytest.mark.parametrize(("text", "expect"), [
    ("log 30 minutes IELTS listening", {"action": "log", "exam": "ielts", "skill": "listening", "minutes": 30}),
    ("studied german 1.5 hours", {"action": "log", "exam": "goethe", "minutes": 90}),
    ("IELTS reading mock 6.5", {"action": "score", "exam": "ielts", "skill": "reading", "score": "6.5", "source": "mock"}),
    ("got 72 points in Goethe Lesen", {"action": "score", "exam": "goethe", "skill": "lesen", "score": "72"}),
    ("set my IELTS exam date to 20 March", {"action": "set", "exam": "ielts", "field": "exam_date", "value": "2027-03-20"}),
    ("my ielts target is 7", {"action": "set", "field": "target_score", "value": "7"}),
    ("study german 40 minutes a day", {"action": "set", "exam": "goethe", "field": "daily_minutes", "value": 40}),
    ("change goethe level to B2", {"action": "set", "field": "variant", "value": "B2"}),
    ("how is my IELTS prep going?", {"action": "status", "exam": "ielts"}),
])
def test_parse_exam_command(text, expect):
    got = parse_exam_command(text, TODAY)
    assert got is not None, text
    for k, v in expect.items():
        assert got[k] == v, f"{text}: {k}={got[k]!r}"


def test_parse_exam_command_ignores_other_text():
    assert parse_exam_command("buy milk tomorrow", TODAY) is None
    from app.services.assistant import classify_intent
    assert classify_intent("remind me to study german tomorrow at 6pm") == "capture"            # tasks still win
    assert classify_intent("log 30 minutes IELTS listening") == "exam_update"
    assert classify_intent("help me prepare for IELTS writing") == "exam_status"


# ---------- API ----------

def test_defaults_and_plan_edits(api):
    plans = _plans(api)
    ielts, goethe = plans["ielts"], plans["goethe"]
    assert ielts["variant"] == "academic" and Decimal(str(ielts["target_score"])) == Decimal("6.5") and ielts["daily_minutes"] == 45
    assert goethe["variant"] == "B1" and goethe["daily_minutes"] == 30 and ielts["date_is_estimate"] is True
    assert ielts["study_days"] == [1, 2, 3, 4, 5, 6] and ielts["study_time"].startswith("14:00")
    assert len(ielts["skills"]) == 4 and ielts["readiness"]["status"] == "no_data"
    assert len(_plans(api)) == 2                                                               # defaults made once
    out = api("PATCH", f"/exams/{ielts['id']}", {"exam_date": "2027-04-10", "target_score": "6.8", "daily_minutes": 60, "variant": "general"}, 200).json()
    assert out["date_is_estimate"] is False and Decimal(str(out["target_score"])) == Decimal("7.0") and out["variant"] == "general"
    api("PATCH", f"/exams/{goethe['id']}", {"variant": "Z9"}, 422)
    api("PATCH", f"/exams/{goethe['id']}", {"study_days": [0]}, 422)
    api("PATCH", f"/exams/{goethe['id']}", {"daily_minutes": 5}, 422)


def test_log_study_points_today_plan_and_catch_up(api):
    ielts = _plans(api)["ielts"]
    today = ielts["today"]
    if today["study_day"]:
        assert today["blocks"][0]["skill"] == "vocab" and sum(b["minutes"] for b in today["blocks"]) == today["minutes"]
    before = api("GET", "/game", expect=200).json()["balance"]
    out = api("POST", f"/exams/{ielts['id']}/log", {"skill": "listening", "minutes": 30}, 201).json()
    assert out["today"]["done_minutes"] == 30 and api("GET", "/game", expect=200).json()["balance"] > before
    api("POST", f"/exams/{ielts['id']}/log", {"skill": "lesen", "minutes": 30}, 422)            # a Goethe skill on the IELTS plan
    # Plan existed for 10 days with almost nothing studied: catch-up appears, capped at +50%.
    _age_plan(ielts["id"], 10)
    fresh = _plans(api)["ielts"]
    assert fresh["readiness"]["week"]["planned"] > 0 and fresh["readiness"]["status"] in ("behind", "no_data")
    if fresh["today"]["study_day"]:
        assert 0 < fresh["today"]["catch_up"] <= fresh["daily_minutes"] // 2


def test_scores_forecast_and_overall(api):
    ielts = _plans(api)["ielts"]
    today = date.fromisoformat(api("GET", "/focus/today", expect=200).json()["date"])
    for skill, scores in {"listening": ["6.0", "6.5", "7.0"], "reading": ["7.0"], "writing": ["5.5"], "speaking": ["6.5"]}.items():
        for n, sc in enumerate(scores):
            api("POST", f"/exams/{ielts['id']}/scores", {"skill": skill, "score": sc, "taken_on": str(today - timedelta(days=30 - 10 * n))}, 201)
    out = _plans(api)["ielts"]
    skills = {s["skill"]: s for s in out["skills"]}
    assert Decimal(str(skills["listening"]["latest"])) == Decimal("7.0")                     # mean of the last two (6.5, 7.0) -> 6.75 -> 7.0
    assert skills["listening"]["trend_per_30_days"] > 0 and skills["writing"]["status"] in ("behind", "on_track")
    assert out["readiness"]["overall"] is not None
    blocks = [b["skill"] for b in out["today"]["blocks"]]
    if out["today"]["study_day"]:
        assert blocks[1] == "writing"                                                         # weakest skill gets time first
    api("POST", f"/exams/{ielts['id']}/scores", {"skill": "listening", "score": 9.5}, 422)
    goethe = _plans(api)["goethe"]
    api("POST", f"/exams/{goethe['id']}/scores", {"skill": "lesen", "score": 72}, 201)
    assert _plans(api)["goethe"]["readiness"]["pass_mark"] is not None


def test_feedback_without_and_with_ai(api, monkeypatch):
    ielts = _plans(api)["ielts"]
    essay = "Some people think working from home is good. " * 12 + "\n\nHowever, others disagree. In conclusion, it depends."
    out = api("POST", f"/exams/{ielts['id']}/feedback", {"mode": "writing", "prompt": "Working from home: advantages vs disadvantages?", "answer": essay}, 201).json()
    assert out["ai"] is None and out["metrics"]["words"] > 50 and "rule-based" in out["note"]
    reply = json.dumps({"estimated_score": 5.8, "criteria": {"Task response": "Partly answered"},
                        "corrections": [{"wrong": "is good", "right": "is beneficial", "why": "more precise word"}],
                        "tips": ["Give an example in each paragraph"], "summary": "Clear position, limited ideas."})
    monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai_client, "chat_complete", lambda *a, **k: reply)
    out = api("POST", f"/exams/{ielts['id']}/feedback", {"mode": "writing", "prompt": "Working from home?", "answer": essay}, 201).json()
    assert Decimal(str(out["ai"]["estimated_score"])) == Decimal("6.0") and out["mistakes_saved"] == 1    # 5.8 rounded to a half band
    assert any(s["source"] == "estimate" for s in {x["skill"]: x for x in _plans(api)["ielts"]["skills"]}["writing"]["history"])
    speech = api("POST", f"/exams/{ielts['id']}/feedback", {"mode": "speaking", "prompt": "Describe your hometown.",
                                                            "answer": "um I live in Kandy um it is like a beautiful city with a lake", "seconds": 20}, 201).json()
    assert speech["metrics"]["fillers"] >= 2 and speech["metrics"]["words_per_minute"]
    practice = api("GET", f"/exams/{ielts['id']}/practice", expect=200).json()
    assert len(practice) == 3
    api("DELETE", f"/exams/practice/{practice[0]['id']}", expect=200)


def test_assistant_tracks_and_adjusts(api):
    reply = api("POST", "/chat", {"message": "log 30 minutes IELTS listening"}, 200).json()
    assert any(a["tool"] == "exam_update" for a in reply["actions_completed"]), reply
    reply = api("POST", "/chat", {"message": "IELTS reading mock 6.5"}, 200).json()
    assert any(a["tool"] == "exam_update" for a in reply["actions_completed"]), reply
    api("POST", "/chat", {"message": "set my IELTS exam date to 20 March"}, 200)
    ielts = _plans(api)["ielts"]
    assert ielts["date_is_estimate"] is False and ielts["exam_date"].endswith("-03-20") and ielts["today"]["done_minutes"] >= 30
    assert Decimal(str({s["skill"]: s for s in ielts["skills"]}["reading"]["latest"])) == Decimal("6.5")
    status = api("POST", "/chat", {"message": "how is my IELTS prep going?"}, 200).json()["reply"]
    assert "IELTS" in status
    assert "IELTS" in api("GET", "/exams/status", expect=200).json()["text"]


def test_coach_speaks_up_and_day_plan_has_study(api):
    ielts = _plans(api)["ielts"]
    _age_plan(ielts["id"], 10)
    from app.services.exams import coach_finding
    with SessionLocal() as db:
        plan = db.get(ExamPlan, uuid.UUID(ielts["id"]))
        local_today = date.fromisoformat(api("GET", "/focus/today", expect=200).json()["date"])
        finding = coach_finding(db, plan.user_id, local_today)
    assert finding is not None and finding.kind == "exam_behind" and any(o["action"].startswith("task_today:") for o in finding.options)
    monday = TODAY + timedelta(days=1)                                                         # a study day
    plan = api("POST", "/planner/generate", {"plan_date": str(monday)}, 200).json()
    assert any("IELTS study" in i["title"] for i in plan["items"])


def test_ownership(client):
    a, b = _user(client), _user(client)
    plan = {p["exam"]: p for p in a("GET", "/exams", expect=200).json()}["ielts"]
    b("PATCH", f"/exams/{plan['id']}", {"daily_minutes": 60}, 404)
    b("POST", f"/exams/{plan['id']}/log", {"skill": "listening", "minutes": 20}, 404)
    b("POST", f"/exams/{plan['id']}/scores", {"skill": "listening", "score": 6}, 404)
    b("POST", f"/exams/{plan['id']}/feedback", {"mode": "writing", "prompt": "Topic", "answer": "Some essay text here."}, 404)
    b("GET", f"/exams/{plan['id']}/practice", expect=404)
    a("POST", f"/exams/{plan['id']}/scores", {"skill": "listening", "score": 6}, 201)
    score = {s["skill"]: s for s in a("GET", "/exams", expect=200).json()[0]["skills"]}["listening"]
    assert score["tests"] == 1
    a("POST", f"/exams/{plan['id']}/feedback", {"mode": "writing", "prompt": "Topic", "answer": "Some essay text here."}, 201)
    practice = a("GET", f"/exams/{plan['id']}/practice", expect=200).json()[0]
    b("DELETE", f"/exams/practice/{practice['id']}", expect=404)
    b_plans = {p["exam"]: p for p in b("GET", "/exams", expect=200).json()}
    b("DELETE", f"/exams/{b_plans['ielts']['id']}/scores/{uuid.uuid4()}", expect=404)
