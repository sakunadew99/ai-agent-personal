import os

# API tests need a database. CI provides PostgreSQL (with migrations applied) through DATABASE_URL;
# locally, fall back to an in-memory SQLite database. Must run before the app's settings are imported.
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
