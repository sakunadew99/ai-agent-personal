import uuid

from fastapi.testclient import TestClient

from app.main import app


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"ed.{uuid.uuid4().hex[:8]}@example.com", "password": "Edit-test-pass-one", "full_name": "E"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_edit_and_delete_a_holding_and_ownership():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        assert a("POST", "/invest/holdings", {"symbol": "COMB", "quantity": 350, "avg_price": 161.24}).status_code == 201
        a("POST", "/invest/trades", {"symbol": "COMB", "side": "buy", "quantity": 50, "price": 200, "fees": 0, "trade_date": "2026-11-01"})
        a("POST", "/invest/trades", {"symbol": "COMB", "side": "dividend", "quantity": 400, "price": 2, "fees": 0, "trade_date": "2026-11-02"})
        assert b("PUT", "/invest/holdings/COMB", {"quantity": 1, "avg_price": 1}).status_code == 404          # B can't touch A's share
        assert b("DELETE", "/invest/holdings/COMB").status_code == 404
        out = a("PUT", "/invest/holdings/comb", {"quantity": 500, "avg_price": 170}).json()
        comb = next(i for i in out["portfolio"]["items"] if i["symbol"] == "COMB.N0000")
        assert float(comb["quantity"]) == 500 and float(comb["avg_cost"]) == 170 and float(comb["dividends"]) == 800     # dividends kept
        out = a("DELETE", "/invest/holdings/COMB.N0000").json()
        assert not [i for i in out["portfolio"]["items"] if i["symbol"] == "COMB.N0000" and float(i["quantity"]) > 0]
        assert a("DELETE", "/invest/holdings/COMB").status_code == 404


def test_edit_and_delete_money_entries_and_health_records():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        e = a("POST", "/finance/expenses", {"amount": 1200, "currency": "LKR", "category": "food"}).json()
        i = a("POST", "/finance/income", {"amount": 150000, "currency": "LKR", "source": "salary"}).json()
        items = a("GET", "/finance/entries").json()
        assert {x["kind"] for x in items["items"]} == {"expense", "income"} and "food" in items["categories"]
        assert b("GET", "/finance/entries").json()["items"] == []
        assert b("PATCH", f"/finance/entries/expense/{e['id']}", {"amount": 1}).status_code == 404
        up = a("PATCH", f"/finance/entries/expense/{e['id']}", {"amount": 1500, "label": "transport", "notes": "taxi"}).json()
        assert float(up["amount"]) == 1500 and up["label"] == "transport" and up["notes"] == "taxi"
        assert a("PATCH", f"/finance/entries/income/{i['id']}", {"label": "lottery"}).status_code == 422
        assert b("DELETE", f"/finance/entries/income/{i['id']}").status_code == 404
        assert a("DELETE", f"/finance/entries/income/{i['id']}").status_code == 204
        h = a("POST", "/health/records", {"metric": "steps", "value": 500, "unit": "steps"}).json()
        assert b("DELETE", f"/health/records/{h['id']}").status_code == 404
        assert a("DELETE", f"/health/records/{h['id']}").status_code == 204
