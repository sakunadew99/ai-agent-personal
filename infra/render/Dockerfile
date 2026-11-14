# Single-container image for free hosting (Render): API + MCP in one process.
# Build context is the repository root:  docker build -f infra/render/Dockerfile .
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY backend/requirements.txt /tmp/req-backend.txt
COPY mcp-service/requirements.txt /tmp/req-mcp.txt
RUN pip install -r /tmp/req-backend.txt -r /tmp/req-mcp.txt

COPY backend/ /app/
COPY mcp-service/app/main.py /app/sakuna_mcp_main.py
COPY infra/render/combined.py /app/combined.py

RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

# Render provides $PORT. Migrations are idempotent and run on every start.
CMD ["sh", "-c", "alembic upgrade head && uvicorn combined:app --host 0.0.0.0 --port ${PORT:-10000} --proxy-headers --forwarded-allow-ips='*'"]
