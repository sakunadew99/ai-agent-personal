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
    from app.services import jobs_finder, learn_radar
    jobs_finder.clear_cache(); learn_radar.clear_cache()
    monkeypatch.setattr(jobs_finder, "_fetch", blocked)
    monkeypatch.setattr(learn_radar, "_fetch", blocked)
    from app.services import brain_videos
    brain_videos.clear_cache()
    monkeypatch.setattr(brain_videos, "_fetch", blocked)
    from app.services import tracking
    tracking.clear_cache()
    monkeypatch.setattr(tracking, "_get", lambda url, body=None: blocked(url))
    from app.services import portfolio_ai
    portfolio_ai.clear_cache()
    monkeypatch.setattr(portfolio_ai, "_http", lambda method, url, data=None: blocked(url))
    from app.services import hf
    monkeypatch.setattr(hf, "_post", lambda model, payload, suffix="": blocked(model))
    from app.services import resources
    resources._cache.clear()
    monkeypatch.setattr(resources, "_http_get", blocked)


@pytest.fixture(autouse=True)
def _no_response_cache(monkeypatch):
    """Many tests change rows directly in the database; the per-user response cache is tested on its own (test_speed_journal_food.py)."""
    from app.core import cache
    cache.clear()
    monkeypatch.setattr(cache, "TTL_SECONDS", 0)
