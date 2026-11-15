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
