import pytest
from fastapi import HTTPException

from app.api.v1 import router as routes
from app.schemas import dto


def _payload():
    return dto.RegisterIn(email="new.person@example.com", password="Long-enough-pass-1", full_name="New Person")


def test_registration_is_refused_when_closed(monkeypatch):
    monkeypatch.setattr(routes.settings, "registration_open", False)
    with pytest.raises(HTTPException) as caught:
        routes.register(_payload(), db=None)  # refused before the database is touched
    assert caught.value.status_code == 403


def test_registration_is_open_by_default():
    from app.core.config import Settings
    assert Settings().registration_open is True
