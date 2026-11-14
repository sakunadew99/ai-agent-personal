import pytest
from fastapi import HTTPException

from app.api.v1 import router as routes

STRONG = "s" * 40


def test_tick_refuses_wrong_token(monkeypatch):
    monkeypatch.setattr(routes.settings, "service_token", STRONG)
    with pytest.raises(HTTPException) as caught:
        routes.internal_tick(x_service_token="wrong")
    assert caught.value.status_code == 403


def test_tick_refuses_when_only_weak_dev_token_is_configured(monkeypatch):
    monkeypatch.setattr(routes.settings, "service_token", "dev-service-token")
    with pytest.raises(HTTPException) as caught:
        routes.internal_tick(x_service_token="dev-service-token")
    assert caught.value.status_code == 403


def test_tick_runs_worker_with_correct_token(monkeypatch):
    calls = []
    monkeypatch.setattr(routes.settings, "service_token", STRONG)
    import app.workers.checkins as checkins
    monkeypatch.setattr(checkins, "process_once", lambda: calls.append(1))
    assert routes.internal_tick(x_service_token=STRONG) == {"status": "ok"}
    assert calls == [1]
