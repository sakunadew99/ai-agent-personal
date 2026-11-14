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
