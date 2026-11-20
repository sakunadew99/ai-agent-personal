"""Free Hugging Face models through the Inference API (needs HF_TOKEN; without it callers use plain-code fallbacks).

- FinBERT (ProsusAI/finbert): positive / negative / neutral tone of finance headlines.
- all-MiniLM-L6-v2: 384-number "meaning" vectors for search.
Only public headlines and the text you search are sent; private data follows your AI sharing switches (see search.py).
"""
from __future__ import annotations

import json
import logging
import time

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)
_tone_cache: dict[str, tuple[float, dict]] = {}
_down_until = 0.0          # after a failure, rest for a few minutes instead of slowing every request


def enabled() -> bool:
    return bool(settings.hf_token) and time.time() >= _down_until


def _post(model: str, payload: dict, suffix: str = "") -> object:
    """One call to the Inference API (tests replace this)."""
    r = httpx.post(f"{settings.hf_base_url}/{model}{suffix}", headers={"Authorization": f"Bearer {settings.hf_token}"},
                   json=payload, timeout=45)
    r.raise_for_status()
    return r.json()


def _fail(what: str, exc: Exception) -> None:
    global _down_until
    _down_until = time.time() + 300
    logger.warning("hugging face %s failed: %s", what, type(exc).__name__)


def finbert(titles: list[str]) -> list[dict | None]:
    """Tone per headline: {"label": positive|negative|neutral, "score": 0..1}. None where unknown."""
    out: list[dict | None] = [None] * len(titles)
    if not titles or not enabled():
        return out
    todo = [t for t in dict.fromkeys(titles) if t not in _tone_cache]
    for i in range(0, len(todo), 16):
        batch = todo[i:i + 16]
        try:
            res = _post(settings.hf_sentiment_model, {"inputs": batch, "options": {"wait_for_model": True}})
        except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
            _fail("finbert", exc)
            break
        if isinstance(res, list) and res and isinstance(res[0], dict):       # single input comes back flat
            res = [res]
        for title, labels in zip(batch, res if isinstance(res, list) else []):
            if isinstance(labels, list) and labels:
                best = max(labels, key=lambda x: x.get("score", 0))
                _tone_cache[title] = (time.time(), {"label": str(best.get("label", "neutral")).lower(), "score": round(float(best.get("score", 0)), 3)})
    if len(_tone_cache) > 3000:
        _tone_cache.clear()
    return [(_tone_cache.get(t) or (0, None))[1] for t in titles]


def embed(texts: list[str]) -> list[list[float]] | None:
    """Meaning vectors (384 numbers each), or None if unavailable."""
    if not texts or not enabled():
        return None
    vecs: list[list[float]] = []
    try:
        for i in range(0, len(texts), 32):
            res = _post(settings.hf_embedding_model, {"inputs": texts[i:i + 32], "options": {"wait_for_model": True}}, "/pipeline/feature-extraction")
            if not isinstance(res, list):
                return None
            vecs.extend([float(x) for x in v] for v in res)
    except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError) as exc:
        _fail("embeddings", exc)
        return None
    return vecs if len(vecs) == len(texts) else None


def cosine(a: list[float], b: list[float]) -> float:
    num = sum(x * y for x, y in zip(a, b))
    da = sum(x * x for x in a) ** 0.5
    db = sum(y * y for y in b) ** 0.5
    return num / (da * db) if da and db else 0.0
