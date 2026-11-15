"""Life OS Phase 7: CSE investing: CSE fetch, CSV/Excel/paste import, holdings maths, your rules -> alerts, research, analyst, ownership."""
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import ai_client, invest

DAY = date(2026, 11, 13)


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"iv.{uuid.uuid4().hex[:8]}@example.com", "password": "Invest-test-pass-1", "full_name": "I"})
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    def call(method, path, body=None, expect=None, files=None, params=None):
        kw = {"files": files} if files else ({"json": body} if body is not None else {})
        resp = client.request(method, "/api/v1" + path, headers=headers, params=params, **kw)
        if expect is not None:
            assert resp.status_code == expect, f"{method} {path}: {resp.status_code} {resp.text}"
        return resp
    return call


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fake_cse(monkeypatch):
    stamp = int(datetime(2026, 11, 13, 9, 0, tzinfo=timezone.utc).timestamp() * 1000)   # 14:30 in Colombo

    def post(path):
        if path == "aspiData":
            return {"value": 22024.18, "lowValue": 21970.45, "highValue": 22263.51, "change": -133.22, "percentage": -0.60, "timestamp": stamp}
        return {"reqTradeSummery": [
            {"symbol": "JKH.N0000", "name": "JOHN KEELLS HOLDINGS PLC", "price": 21.5, "closingPrice": 21.5, "previousClose": 20.0, "open": 20.1,
             "high": 21.8, "low": 20.0, "percentageChange": 7.5, "sharevolume": 5000000, "turnover": 1.07e8, "marketCap": 3.7e11},
            {"symbol": "COMB.N0000", "name": "COMMERCIAL BANK OF CEYLON PLC", "price": 150.0, "closingPrice": 150.0, "previousClose": 151.0,
             "percentageChange": -0.66, "sharevolume": 100000},
        ]}
    monkeypatch.setattr(invest, "_cse_post", post)


def test_parsing_helpers():
    assert invest.norm_symbol(" jkh ") == "JKH.N0000" and invest.norm_symbol("JKH.X0000") == "JKH.X0000" and invest.norm_symbol("aspi") == "ASPI"
    assert invest._d("1,012.25") == Decimal("1012.25") and invest._d("Rs. 12.5") == Decimal("12.5") and invest._d("(3.2)") == Decimal("-3.2")
    assert invest._d("-") is None and invest._parse_date("13-Nov-2026") == DAY and invest._parse_date("13/11/2026") == DAY


def test_fetch_cse_and_rules(client, fake_cse):
    api = _user(client)
    out = api("POST", "/invest/fetch", expect=200).json()
    assert out["trade_date"] == str(DAY) and out["saved"] == 3
    assert out["portfolio"]["index"]["symbol"] == "ASPI" and float(out["portfolio"]["index"]["close"]) == 22024.18
    api("POST", "/invest/trades", {"symbol": "jkh", "trade_date": "2026-11-01", "side": "buy", "quantity": 1000, "price": 19}, 201)
    view = api("PUT", "/invest/watch/JKH", {"sector": "Diversified", "take_profit": 21, "eps": 1.5, "max_pe": 15, "dps": 0.8, "min_yield": 3}, 200).json()
    w = view["watchlist"][0]
    assert w["held"] and float(w["pe"]) == pytest.approx(14.3, abs=0.05) and float(w["yield_pct"]) == pytest.approx(3.7, abs=0.05)
    rules = {s["rule"] for s in w["signals"]}
    assert {"take_profit", "pe", "yield", "big_move"} <= rules                                 # 7.5% move on a holding
    alerts = {a["rule"] for a in view["alerts"]}
    assert {"take_profit", "pe", "yield", "big_move"} <= alerts
    again = api("POST", "/invest/fetch", expect=200).json()
    assert again["new_alerts"] == 0                                                            # once per rule per trading day
    api("PUT", "/invest/watch/COMB", {"target_buy": 155}, 200)
    assert any(a["symbol"] == "COMB.N0000" and a["rule"] == "target_buy" for a in api("GET", "/invest", expect=200).json()["alerts"])
    assert "not financial advice" in view["disclaimer"]


def test_holdings_maths(client):
    api = _user(client)
    for t in [{"side": "buy", "quantity": 100, "price": 50, "fees": 100, "trade_date": "2026-10-01"},
              {"side": "buy", "quantity": 100, "price": 60, "trade_date": "2026-10-05"},
              {"side": "sell", "quantity": 50, "price": 70, "fees": 50, "trade_date": "2026-10-10"},
              {"side": "dividend", "quantity": 150, "price": 2, "trade_date": "2026-10-20"}]:
        api("POST", "/invest/trades", {"symbol": "HNB", **t}, 201)
    api("POST", "/invest/prices", {"symbol": "HNB", "close": 65, "trade_date": str(DAY)}, 201)
    p = api("GET", "/invest", expect=200).json()["portfolio"]
    h = p["items"][0]
    assert h["symbol"] == "HNB.N0000" and Decimal(str(h["quantity"])) == 150 and Decimal(str(h["avg_cost"])) == Decimal("55.50")
    assert Decimal(str(h["realised"])) == Decimal("675.00") and Decimal(str(h["dividends"])) == Decimal("300.00")
    assert Decimal(str(p["value"])) == Decimal("9750.00") and Decimal(str(p["unrealised"])) == Decimal("1425.00")
    assert Decimal(str(p["total_return"])) == Decimal("2400.00") and h["weight_pct"] == 100.0
    trade = api("GET", "/invest/trades", expect=200).json()[0]
    api("DELETE", f"/invest/trades/{trade['id']}", expect=200)
    assert len(api("GET", "/invest/trades", expect=200).json()) == 3


def test_upload_csv_xlsx_and_paste(client):
    api = _user(client)
    prices_csv = "Trade Summary 13-Nov-2026\nSecurity,Company Name,Closing Price,Previous Close,% Change,Share Volume\n" \
                 'JKH.N0000,John Keells,"1,021.50",1000.00,2.15,"12,345"\nSAMP,Sampath,Rs. 98.75,99,-0.25,100\nBAD,,-,,,\n'
    out = api("POST", "/invest/upload", files={"file": ("cse.csv", prices_csv.encode(), "text/csv")}, params={"trade_date": str(DAY)}, expect=200).json()
    assert out["kind"] == "prices" and out["saved"] == 2 and out["dates"] == [str(DAY)] and len(out["skipped"]) == 1
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active
    ws.append(["Date", "Symbol", "Type", "Qty", "Price", "Commission"])
    ws.append([datetime(2026, 11, 3), "JKH", "Buy", 10, 1000, 25])
    ws.append([datetime(2026, 11, 10), "SAMP", "B", 200, 95, 0])
    ws.append([datetime(2026, 11, 12), "SAMP", "weird", 1, 1, 0])
    buf = io.BytesIO(); wb.save(buf)
    out = api("POST", "/invest/upload", files={"file": ("trades.xlsx", buf.getvalue(), "application/octet-stream")}, expect=200).json()
    assert out["kind"] == "trades" and out["saved"] == 2 and len(out["skipped"]) == 1
    pasted = "Symbol\tLTP\nCOMB\t151.25\n"
    out = api("POST", "/invest/import-text", {"text": pasted, "trade_date": str(DAY)}, 200).json()
    assert out["saved"] == 1
    p = api("GET", "/invest", expect=200).json()["portfolio"]
    assert {i["symbol"] for i in p["items"]} == {"JKH.N0000", "SAMP.N0000"} and Decimal(str(p["value"])) == Decimal("29965.00")   # 10*1021.5 + 200*98.75
    api("POST", "/invest/upload", files={"file": ("old.xls", b"xx", "application/vnd.ms-excel")}, expect=422)
    api("POST", "/invest/import-text", {"text": "a,b,c\n1,2,3"}, 422)                           # no symbol column


def test_research_ai_and_market_analyst(client, fake_cse, monkeypatch):
    api = _user(client)
    api("POST", "/invest/fetch", expect=200)
    from app.core.database import SessionLocal
    from app.models.entities import NewsItem, NewsSource
    user_id = uuid.UUID(str(api("GET", "/me", expect=200).json()["user"]["id"]))
    with SessionLocal() as db:
        src = NewsSource(user_id=user_id, name="LBO", url="https://www.lankabusinessonline.com/feed/", topic="sri_lanka")
        db.add(src); db.flush()
        db.add(NewsItem(user_id=user_id, source_id=src.id, url="https://ex.com/jk", title="John Keells profit rises 40% in Q2", excerpt="Leisure and retail up.",
                        published_at=datetime.now(timezone.utc) - timedelta(days=1), topic="markets"))
        db.commit()
    r = api("GET", "/invest/symbols/JKH", expect=200).json()
    assert r["history"][0]["date"] == str(DAY) and r["research"]["news"][0]["title"].startswith("John Keells") and r["research"]["ai"] is None
    monkeypatch.setattr(ai_client, "ai_enabled", lambda: True)
    monkeypatch.setattr(ai_client, "chat_complete", lambda *a, **k: '{"summary": "Profits grew.", "positives": ["Leisure"], "risks": ["Rates"]}')
    r = api("GET", "/invest/symbols/JKH", params={"ai": "true"}, expect=200).json()
    assert r["research"]["ai"]["summary"] == "Profits grew." and "not financial advice" in r["research"]["disclaimer"]
    monkeypatch.setattr(ai_client, "ai_enabled", lambda: False)
    api("POST", "/invest/trades", {"symbol": "JKH", "trade_date": "2026-11-01", "side": "buy", "quantity": 100, "price": 19}, 201)
    workers = {w["key"]: w for w in api("GET", "/workers", expect=200).json()}
    assert workers["market_analyst"]["available"] and workers["market_analyst"]["days"] == [1, 2, 3, 4, 5]
    note = api("POST", "/workers/market_analyst/run", expect=200).json()
    assert "ASPI 22024.18" in note["body"] and "not financial advice" in note["body"] and any(a["action"] == "open:Invest" for a in note["actions"])
    from app.services.assistant import classify_intent
    assert classify_intent("how is my portfolio doing?") == "invest" and classify_intent("what's the CSE doing today") == "invest"


def test_cse_down_is_explained(client, monkeypatch):
    api = _user(client)

    def down(path):
        import httpx
        raise httpx.ConnectError("no route")
    monkeypatch.setattr(invest, "_cse_post", down)
    r = api("POST", "/invest/fetch", expect=502).json()
    assert "upload a CSV/Excel file" in r["detail"]


def test_ownership(client):
    a, b = _user(client), _user(client)
    a("POST", "/invest/trades", {"symbol": "JKH", "trade_date": "2026-11-01", "side": "buy", "quantity": 10, "price": 20}, 201)
    a("PUT", "/invest/watch/JKH", {"target_buy": 18}, 200)
    trade = a("GET", "/invest/trades", expect=200).json()[0]
    b("DELETE", f"/invest/trades/{trade['id']}", expect=404)
    b("DELETE", "/invest/watch/JKH", expect=404)
    view = b("GET", "/invest", expect=200).json()
    assert view["portfolio"]["items"] == [] and view["watchlist"] == [] and b("GET", "/invest/trades", expect=200).json() == []


def test_symbol_dropdown_tells_share_classes_apart(client, monkeypatch):
    stamp = int(datetime(2026, 11, 13, 9, 0, tzinfo=timezone.utc).timestamp() * 1000)

    def post(path):
        if path == "aspiData":
            return {"value": 22024.18, "change": 10, "percentage": 0.1, "timestamp": stamp}
        return {"reqTradeSummery": [
            {"symbol": "COMB.N0000", "name": "COMMERCIAL BANK OF CEYLON PLC", "closingPrice": 150.0},
            {"symbol": "COMB.X0000", "name": "COMMERCIAL BANK OF CEYLON PLC", "closingPrice": 120.0},
            {"symbol": "COCO.N0000", "name": "RENUKA FOODS", "closingPrice": 30.0},
            {"symbol": "JKH.N0000", "name": "JOHN KEELLS HOLDINGS PLC", "closingPrice": 21.5},
        ]}
    monkeypatch.setattr(invest, "_cse_post", post)
    a, b = _user(client), _user(client)
    assert b("GET", "/invest/symbols", params={"q": "COMB"}, expect=200).json()["loaded"] is False
    a("POST", "/invest/fetch", expect=200)
    items = a("GET", "/invest/symbols", params={"q": "COMB"}, expect=200).json()["items"]
    assert [i["symbol"] for i in items] == ["COMB.N0000", "COMB.X0000"]
    assert [i["class_label"] for i in items] == ["voting", "non-voting"] and all(i["has_other_classes"] for i in items)
    assert [i["symbol"] for i in a("GET", "/invest/symbols", params={"q": "comb.x"}, expect=200).json()["items"]] == ["COMB.X0000"]
    assert [i["symbol"] for i in a("GET", "/invest/symbols", params={"q": "keells"}, expect=200).json()["items"]] == ["JKH.N0000"]
    assert {i["symbol"] for i in a("GET", "/invest/symbols", params={"q": "CO"}, expect=200).json()["items"]} == {"COMB.N0000", "COMB.X0000", "COCO.N0000"}
    # B sees nothing of A's prices
    assert b("GET", "/invest/symbols", params={"q": "COMB"}, expect=200).json()["items"] == []
    assert invest.share_class("COMB.X0000") == ("X", "non-voting")
