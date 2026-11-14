"""Life balance (target vs actual per area) and document vault (encrypted number, expiry, reminders, plan needs)."""
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.models.entities import FocusSession, VaultDocument


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"bv.{uuid.uuid4().hex[:8]}@example.com", "password": "Balance-vault-1", "full_name": "B"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None):
        resp = client.request(method, "/api/v1" + path, headers=headers, **({"json": body} if body is not None else {}))
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


@pytest.fixture()
def api():
    with TestClient(app) as client:
        yield _user(client)


@pytest.fixture()
def key(monkeypatch):
    monkeypatch.setattr(settings, "token_encryption_key", Fernet.generate_key().decode())


def D(v):
    return Decimal(str(v))


def area(view, k):
    return next(a for a in view["areas"] if a["key"] == k)


# ---------- life balance ----------

def test_default_areas_and_measured_actuals(api):
    v = api("GET", "/balance", expect=200).json()
    assert [a["key"] for a in v["areas"]] == ["work", "money", "health", "learning", "relationships", "rest", "home"]
    assert all(a["status"] == "zero" for a in v["areas"]) and v["total"] == 7
    # Work: a 60-minute focus session on a work task.
    t = api("POST", "/tasks", {"title": "Client report", "category": "work"}, 201).json()
    s = api("POST", "/focus/sessions", {"minutes": 60, "task_id": t["id"]}, 201).json()
    with SessionLocal() as db:
        row = db.get(FocusSession, uuid.UUID(s["id"]))
        row.started_at = datetime.now(timezone.utc) - timedelta(minutes=60)
        row.ended_at = datetime.now(timezone.utc)
        db.commit()
    # Money, health, learning, home.
    api("POST", "/finance/expenses", {"amount": "500", "currency": "LKR", "category": "food"}, 201)
    api("POST", "/health/workouts", {"activity": "Run", "duration_minutes": 30, "source": "manual"}, 201)
    card = api("POST", "/learning/cards", {"deck": "german", "front": "Haus", "back": "house"}, 201).json()
    api("POST", f"/learning/cards/{card['id']}/review", {"grade": "good"}, 200)
    home = api("POST", "/tasks", {"title": "Pay water bill", "category": "personal"}, 201).json()
    api("PATCH", f"/tasks/{home['id']}/complete", expect=200)
    v = api("GET", "/balance", expect=200).json()
    assert D(area(v, "work")["actual"]) == D("1.0") and area(v, "work")["unit"] == "hours"
    assert D(area(v, "money")["actual"]) == 1 and D(area(v, "health")["actual"]) == 1
    assert D(area(v, "learning")["actual"]) == 1 and D(area(v, "home")["actual"]) == 1
    assert area(v, "rest")["status"] == "zero" and area(v, "rest")["manual_only"] is True
    assert len(area(v, "work")["last_weeks"]) == 3


def test_manual_logs_targets_custom_area_and_warning(api):
    v = api("GET", "/balance", expect=200).json()
    rest = area(v, "rest")
    out = api("POST", f"/balance/areas/{rest['id']}/log", {"amount": "2", "note": "Evening walk + reading"}, 201).json()
    assert D(area(out["view"], "rest")["actual"]) == 2
    v = api("PATCH", f"/balance/areas/{rest['id']}", {"weekly_target": "2"}, 200).json()
    assert area(v, "rest")["status"] == "met" and area(v, "rest")["percent"] == 100
    api("DELETE", f"/balance/entries/{out['id']}", expect=204)
    assert area(api("GET", "/balance", expect=200).json(), "rest")["status"] == "zero"
    v = api("POST", "/balance/areas", {"name": "Music", "unit": "sessions", "weekly_target": "2"}, 201).json()
    assert any(a["name"] == "Music" and a["manual_only"] for a in v["areas"])
    api("POST", "/balance/areas", {"name": "Music"}, 409)
    work = area(v, "work")
    v = api("PATCH", f"/balance/areas/{work['id']}", {"weekly_target": "0.5"}, 200).json()
    api("POST", f"/balance/areas/{work['id']}/log", {"amount": "1"}, 201)
    v = api("GET", "/balance", expect=200).json()
    assert any("Work is at" in w for w in v["warnings"])                               # overload guardrail
    api("PATCH", f"/balance/areas/{area(v, 'money')['id']}", {"active": False}, 200)
    assert "money" not in [a["key"] for a in api("GET", "/balance", expect=200).json()["areas"]]
    last_week = (date.today() - timedelta(days=7)).isoformat()
    assert api("GET", f"/balance?week={last_week}", expect=200).json()["is_current_week"] is False


# ---------- document vault ----------

def test_vault_encrypts_number_reveals_and_reminds(api, key):
    exp = date.today() + timedelta(days=200)
    doc = api("POST", "/vault/documents", {"name": "Passport", "kind": "passport", "number": "N1234567", "expires_on": exp.isoformat(),
                                           "location_note": "Home safe; scan in Google Drive"}, 201).json()
    assert doc["has_number"] and doc["number_hint"] == "•••567" and "N1234567" not in str(doc)
    assert doc["renew_lead_days"] == 270 and doc["status"] == "renew_now"              # within 9 months
    with SessionLocal() as db:
        row = db.get(VaultDocument, uuid.UUID(doc["id"]))
        assert row.number_enc and "N1234567" not in row.number_enc                      # encrypted at rest
    assert api("POST", f"/vault/documents/{doc['id']}/reveal", expect=200).json() == {"number": "N1234567"}
    t1 = api("POST", f"/vault/documents/{doc['id']}/reminder", expect=201).json()
    t2 = api("POST", f"/vault/documents/{doc['id']}/reminder", expect=201).json()
    assert t1["task_id"] == t2["task_id"] and t1["title"].startswith("Renew Passport")   # idempotent
    api("PATCH", f"/vault/documents/{doc['id']}", {"number": ""}, 200)
    api("POST", f"/vault/documents/{doc['id']}/reveal", expect=404)
    month = api("GET", f"/planner/monthly?month={exp:%Y-%m}", expect=200).json()
    assert any(e["kind"] == "expiry" for e in month["days"].get(exp.isoformat(), []))


def test_vault_statuses_and_no_key(api, monkeypatch):
    monkeypatch.setattr(settings, "token_encryption_key", "")
    api("POST", "/vault/documents", {"name": "Licence", "kind": "driving_license", "number": "B999"}, 503)   # never stored in clear
    api("POST", "/vault/documents", {"name": "Licence", "kind": "driving_license", "expires_on": (date.today() - timedelta(days=3)).isoformat()}, 201)
    api("POST", "/vault/documents", {"name": "Degree certificate", "kind": "certificate"}, 201)
    api("POST", "/vault/documents", {"name": "Laptop warranty", "kind": "warranty", "expires_on": (date.today() + timedelta(days=400)).isoformat()}, 201)
    ov = api("GET", "/vault", expect=200).json()
    assert ov["counts"] == {"expired": 1, "renew_now": 0, "valid": 1, "no_expiry": 1}
    assert ov["needed_for_plans"] == []                                                # no active study plans


def test_vault_needed_for_study_plans_and_coach_rule(api, key):
    api("POST", "/study/programs", {"country": "Germany", "university": "TUM", "course": "MSc", "stage": "apply", "language_test": "IELTS 6.5",
                                    "deadline": (date.today() + timedelta(days=60)).isoformat()}, 201)
    needs = {n["kind"]: n for n in api("GET", "/vault", expect=200).json()["needed_for_plans"]}
    assert set(needs) == {"passport", "transcript", "language_test"} and not any(n["have"] for n in needs.values())
    api("POST", "/vault/documents", {"name": "Passport", "kind": "passport", "expires_on": (date.today() + timedelta(days=120)).isoformat()}, 201)
    needs = {n["kind"]: n for n in api("GET", "/vault", expect=200).json()["needed_for_plans"]}
    assert needs["passport"]["have"] and needs["passport"]["warning"]                  # too short for a year abroad
    coach = api("GET", "/coach", expect=200).json()
    s = next(x for x in coach["suggestions"] if x["kind"] == "document_expiring")
    out = api("POST", f"/coach/suggestions/{s['id']}/decide", {"option_id": "remind"}, 200).json()
    assert out["task_id"]


def test_balance_and_vault_ownership(api, key):
    v = api("GET", "/balance", expect=200).json()
    entry = api("POST", f"/balance/areas/{v['areas'][0]['id']}/log", {}, 201).json()
    doc = api("POST", "/vault/documents", {"name": "Visa", "kind": "visa", "number": "V1"}, 201).json()
    with TestClient(app) as client:
        bob = _user(client)
        for method, path, body in [("PATCH", f"/balance/areas/{v['areas'][0]['id']}", {"weekly_target": "1"}),
                                   ("POST", f"/balance/areas/{v['areas'][0]['id']}/log", {}), ("DELETE", f"/balance/entries/{entry['id']}", None),
                                   ("PATCH", f"/vault/documents/{doc['id']}", {"name": "x"}), ("DELETE", f"/vault/documents/{doc['id']}", None),
                                   ("POST", f"/vault/documents/{doc['id']}/reveal", None), ("POST", f"/vault/documents/{doc['id']}/reminder", None)]:
            bob(method, path, body, expect=404)
        assert bob("GET", "/vault", expect=200).json()["documents"] == []
        assert all(a["status"] == "zero" for a in bob("GET", "/balance", expect=200).json()["areas"])
