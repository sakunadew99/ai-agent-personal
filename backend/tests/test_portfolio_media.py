"""CSE portfolio import (ATrad), per-holding numbers, the daily review (faked market data), and the video library; ownership."""
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import portfolio_ai

ATRAD = """ATrad Online - Client Portfolio
Security Quantity Cleared Balance Available Balance
AEL.N0000 700
COCR.N0000 500 700 700 0 0 1.60 58.2527 58.91 40,776.87 82.60 57,820.00 6.01 647.58 57,172.42
COMB.N0000 350 500 500 0 0 1.15 96.7803 97.86 48,390.14 97.00 48,500.00 5.04
350 350 0 0 0.80 161.2389 163.04 56,433.61 212.50 74,375.00 7.73
"""


def fake_http(method, url, data=None):
    days = [date.today() - timedelta(days=200 - i) for i in range(200)]
    if "companyInfoSummery" in url:
        return json.dumps({"reqSymbolInfo": {"id": {"AEL.N0000": 1, "COCR.N0000": 2, "COMB.N0000": 3}.get(data["symbol"], 9)}})
    if "companyChartDataByStock" in url:
        sid = int(data["stockId"])
        base = {1: 50.0, 2: 120.0, 3: 150.0}.get(sid, 10.0)
        slope = {1: 0.2, 2: -0.3, 3: 0.35}.get(sid, 0)
        pts = [{"p": round(base + slope * i, 2), "t": int(datetime.combine(d, datetime.min.time(), timezone.utc).timestamp() * 1000)} for i, d in enumerate(days)]
        return json.dumps({"chartData": pts})
    if "cse.lk/api/chartData" in url:
        return json.dumps([{"d": int(datetime.combine(d, datetime.min.time(), timezone.utc).timestamp() * 1000), "v": 20000 + i * 5} for i, d in enumerate(days)])
    if "finance.yahoo.com" in url:
        ts = [int(datetime.combine(d, datetime.min.time(), timezone.utc).timestamp()) for d in days[-120:]]
        start = 70.0 if "BZ" in url else 300.0 if "LKR" in url else 2000.0
        closes = [start * (1 + 0.001 * i) for i in range(len(ts))]
        return json.dumps({"chart": {"result": [{"timestamp": ts, "indicators": {"quote": [{"close": closes}]}}]}})
    raise AssertionError(url)


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"pm.{uuid.uuid4().hex[:8]}@example.com", "password": "Folio-test-pass-one", "full_name": "P"})
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    def call(method, path, body=None, expect=None, files=None):
        kw = {"files": files} if files else ({"json": body} if body is not None else {})
        resp = client.request(method, "/api/v1" + path, headers=headers, **kw)
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


@pytest.fixture()
def client(monkeypatch):
    portfolio_ai.clear_cache()
    monkeypatch.setattr(portfolio_ai, "_http", fake_http)
    with TestClient(app) as c:
        yield c


def test_parse_atrad_pairs_by_quantity():
    rows = portfolio_ai.parse_portfolio_text(ATRAD)
    assert [(r["symbol"], r["quantity"], r["avg_price"]) for r in rows] == [("AEL.N0000", 700, 58.2527), ("COCR.N0000", 500, 96.7803), ("COMB.N0000", 350, 161.2389)]
    assert rows[2]["total_cost"] == 56433.61 and rows[2]["bes_price"] == 163.04


def test_import_holdings_numbers_and_review(client):
    a, b = _user(client), _user(client)
    prev = a("POST", "/invest/portfolio/preview", files={"file": ("portfolio.txt", ATRAD.encode(), "text/plain")}, expect=200).json()
    assert prev["count"] == 3
    out = a("POST", "/invest/portfolio/import", {"rows": [{"symbol": r["symbol"], "quantity": r["quantity"], "avg_price": r["avg_price"]} for r in prev["rows"]]}, 200).json()
    assert out["saved"] == 3 and len(out["portfolio"]["items"]) == 3
    a("POST", "/invest/prices", {"symbol": "COMB", "close": 212.5}, 201)
    comb = next(i for i in a("GET", "/invest", expect=200).json()["portfolio"]["items"] if i["symbol"] == "COMB.N0000")
    assert float(comb["avg_cost"]) == pytest.approx(161.24, abs=0.01) and float(comb["unrealised"]) == pytest.approx(350 * 212.5 - 350 * 161.2389, abs=0.05)
    assert float(comb["break_even_price"]) > 161.24 and float(comb["net_sale_value"]) == pytest.approx(350 * 212.5 * (1 - 0.0112), abs=0.05)
    again = a("POST", "/invest/portfolio/import", {"rows": [{"symbol": "AEL.N0000", "quantity": 100, "avg_price": 50}]}, 200).json()
    assert again["replaced"] == 3 and len(again["portfolio"]["items"]) == 1                 # re-import replaces only imported positions
    a("POST", "/invest/holdings", {"symbol": "COMB", "quantity": 10, "avg_price": 200}, 201)
    rev = a("GET", "/invest/review", expect=200).json()
    by = {h["symbol"]: h for h in rev["holdings"]}
    assert set(by) == {"AEL.N0000", "COMB.N0000"} and rev["market"]["aspi_trend"] == "up" and "brent" in rev["market"]
    assert by["AEL.N0000"]["indicators"]["enough_data"] and by["AEL.N0000"]["indicators"]["forecast"]["expected_change_pct"] > 0
    assert by["AEL.N0000"]["suggestion"]["action"] in ("Add on dips", "Accumulate slowly", "Hold", "Watch closely", "Trim / take some profit")
    assert rev["disclaimer"].startswith("Educational") and rev["summary"]
    assert b("GET", "/invest/review", expect=200).json()["holdings"] == []                   # private
    a("POST", "/invest/portfolio/preview", files={"file": ("x.txt", b"nothing here", "text/plain")}, expect=422)


def test_media_library_and_ownership(client):
    a, b = _user(client), _user(client)
    v = a("POST", "/media", {"url": "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing", "title": "German lesson 1", "folder": "German"}, 201).json()
    assert v["provider"] == "drive" and v["play_url"] == "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview" and v["thumb"]
    y = a("POST", "/media", {"url": "https://youtu.be/dQw4w9WgXcQ"}, 201).json()
    assert y["provider"] == "youtube" and y["play_url"].endswith("/embed/dQw4w9WgXcQ")
    f = a("POST", "/media", {"url": "https://drive.google.com/drive/folders/1Xyz0123456789"}, 201).json()
    assert f["is_folder"] is True
    a("POST", "/media", {"url": "http://insecure.example.com/v"}, 422)
    assert a("PATCH", f"/media/{v['id']}", {"add_minutes": 12}, 200).json()["minutes_watched"] == 12
    lib = a("GET", "/media", expect=200).json()
    assert lib["minutes_total"] == 12 and "German" in lib["folders"] and len(lib["items"]) == 3
    assert b("GET", "/media", expect=200).json()["items"] == []
    b("PATCH", f"/media/{v['id']}", {"title": "x"}, 404)
    b("DELETE", f"/media/{v['id']}", expect=404)
    a("DELETE", f"/media/{v['id']}", expect=204)
