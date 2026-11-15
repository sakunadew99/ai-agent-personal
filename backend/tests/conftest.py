import os

# API tests need a database. CI provides PostgreSQL (with migrations applied) through DATABASE_URL;
# locally, fall back to an in-memory SQLite database. Must run before the app's settings are imported.
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _no_real_news_downloads(monkeypatch):
    """Tests never fetch real feeds; test_news.py installs its own fake feeds."""
    from app.services import news

    def blocked(url):
        raise ValueError("network disabled in tests")
    monkeypatch.setattr(news, "_download", blocked)
    from app.services import daad
    daad.clear_cache()
    monkeypatch.setattr(daad, "_fetch", lambda url, params=None: blocked(url))


@pytest.fixture(autouse=True)
def _no_response_cache(monkeypatch):
    """Many tests change rows directly in the database; the per-user response cache is tested on its own (test_speed_journal_food.py)."""
    from app.core import cache
    cache.clear()
    monkeypatch.setattr(cache, "TTL_SECONDS", 0)
