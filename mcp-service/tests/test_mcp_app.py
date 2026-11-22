import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    # The MCP session manager may only be started once per process, so all tests
    # share one TestClient (one app lifespan) instead of opening a new one each.
    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint_is_public(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_mcp_endpoint_requires_a_sakuna_token(client):
    response = client.post("/mcp", json={})

    assert response.status_code == 401
    assert response.json()["detail"] == "Sakuna bearer token required"


def test_new_tools_validate_before_calling_the_api():
    import asyncio

    from app import main

    for call in (lambda: main.ask_sakuna("delete everything"), lambda: main.search_resources("python", "expert"), lambda: main.search_travel(13)):
        with pytest.raises(ValueError):
            asyncio.run(call())


def test_capture_note_is_only_a_proposal(monkeypatch):
    import asyncio

    from app import main

    sent = {}

    async def fake_backend(method, path, *, body=None, params=None):
        sent.update(method=method, path=path, body=body)
        return {"status": "pending"}

    monkeypatch.setattr(main, "_backend", fake_backend)
    asyncio.run(main.capture_note("buy milk", tags=["home"]))
    assert sent["path"] == "/api/v1/mcp/proposals" and sent["body"]["tool_name"] == "create_note"
