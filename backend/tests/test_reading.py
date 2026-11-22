import json
import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.services import reading


def _user(client):
    r = client.post("/api/v1/auth/register", json={"email": f"bk.{uuid.uuid4().hex[:8]}@example.com", "password": "Book-test-pass-one", "full_name": "B"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return lambda m, p, b=None: client.request(m, "/api/v1" + p, headers=h, **({"json": b} if b is not None else {}))


def test_open_library_search_is_parsed_from_real_fields(monkeypatch):
    doc = {"docs": [{"key": "/works/OL17930368W", "title": "Atomic Habits", "author_name": ["James Clear"], "first_publish_year": 2016,
                     "number_of_pages_median": 306, "cover_i": 12539702}, {"key": "/works/x"}]}
    monkeypatch.setattr(reading, "_http_get", lambda u: json.dumps(doc) if "openlibrary.org/search.json?q=atomic+habits" in u else "")
    items = reading.search("atomic habits")
    assert items == [{"title": "Atomic Habits", "author": "James Clear", "year": 2016, "pages": 306, "source_key": "/works/OL17930368W",
                      "cover_url": "https://covers.openlibrary.org/b/id/12539702-M.jpg", "link": "https://openlibrary.org/works/OL17930368W"}]


def test_search_offline_returns_nothing_not_made_up():
    assert reading.search("anything") == []                                       # network blocked in tests


def test_progress_forecast_finish_highlights_and_privacy():
    with TestClient(app) as client:
        a, b = _user(client), _user(client)
        bk = a("POST", "/reading/books", {"title": "Atomic Habits", "author": "James Clear", "total_pages": 300, "status": "reading"}).json()
        assert bk["percent"] == 0 and bk["pages_left"] == 300
        assert a("POST", "/reading/books", {"title": "Atomic Habits", "author": "James Clear"}).status_code == 409
        ov = a("POST", f"/reading/books/{bk['id']}/progress", {"to_page": 70, "minutes": 40}).json()
        me = next(x for x in ov["books"] if x["id"] == bk["id"])
        assert me["current_page"] == 70 and me["percent"] == 23 and ov["week_pages"] == 70 and ov["streak"] == 1
        assert ov["pace_pages_per_day"] == 5.0                                    # 70 pages / 14 days
        assert me["finish_forecast"] == (date.today() + timedelta(days=46)).isoformat()   # 230 left / 5 a day
        a("POST", f"/reading/books/{bk['id']}/progress", {"pages": 30})
        h = a("POST", f"/reading/books/{bk['id']}/highlights", {"quote": "You do not rise to the level of your goals.", "page": 27}).json()
        assert h["highlights"][0]["page"] == 27
        assert a("POST", f"/reading/books/{bk['id']}/takeaways").status_code == 503          # no AI key
        ov = a("POST", f"/reading/books/{bk['id']}/progress", {"to_page": 999}).json()           # past the end = finished
        me = next(x for x in ov["books"] if x["id"] == bk["id"])
        assert me["status"] == "finished" and me["current_page"] == 300 and me["finished_on"] and ov["year"]["finished"] == 1
        assert b("GET", "/reading").json()["books"] == []
        for method, path, body in (("PATCH", f"/reading/books/{bk['id']}", {"rating": 5}), ("DELETE", f"/reading/books/{bk['id']}", None),
                                   ("POST", f"/reading/books/{bk['id']}/progress", {"pages": 5}), ("POST", f"/reading/books/{bk['id']}/highlights", {"quote": "x"})):
            assert b(method, path, body).status_code == 404
        assert a("DELETE", f"/reading/books/{bk['id']}/highlights/0").json()["highlights"] == []
        assert a("DELETE", f"/reading/books/{bk['id']}/highlights/5").status_code == 404


def test_yearly_goal_and_suggestions_are_real_books():
    with TestClient(app) as client:
        a = _user(client)
        a("POST", "/goals", {"title": "Build $1 million net worth"})
        ov = a("PUT", "/reading/goal", {"books_per_year": 12, "daily_minutes": 20}).json()
        assert ov["year"]["goal"] == 12 and ov["daily_minutes"] == 20
        doy = date.today().timetuple().tm_yday
        assert ov["year"]["expected_by_now"] == round(12 * doy / 365, 1)
        sug = ov["suggestions"]
        assert sug[0]["area"] == "money" and all((s["title"], s["author"]) in {(t, au) for t, au, _, _ in reading.SUGGESTIONS} for s in sug)
        assert all(s["search"].startswith("https://openlibrary.org/search?q=") for s in sug)
        a("POST", "/reading/books", {"title": "The Psychology of Money", "author": "Morgan Housel"})
        assert "The Psychology of Money" not in [s["title"] for s in a("GET", "/reading").json()["suggestions"]]
