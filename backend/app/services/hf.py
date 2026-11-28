"""Free Hugging Face models through the Inference API (needs HF_TOKEN; without it callers use plain-code fallbacks).

- FinBERT (ProsusAI/finbert): positive / negative / neutral tone of finance headlines.
- all-MiniLM-L6-v2: 384-number "meaning" vectors for search.
- bart-large-mnli (zero-shot): sorts public video titles into topics for the Learning feed.
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


def embed(texts: list[str], model: str | None = None) -> list[list[float]] | None:
    """Meaning vectors (384 numbers each), or None if unavailable. model: e.g. the multilingual one for Sinhala."""
    if not texts or not enabled():
        return None
    model = model or settings.hf_embedding_model
    vecs: list[list[float]] = []
    try:
        for i in range(0, len(texts), 32):
            res = _post(model, {"inputs": texts[i:i + 32], "options": {"wait_for_model": True}}, "/pipeline/feature-extraction")
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


ZERO_SHOT_MODEL = "facebook/bart-large-mnli"          # fallback when the newer model isn't available
_zs_cache: dict[str, str | None] = {}


def zero_shot(texts: list[str], labels: dict[str, str]) -> list[str | None]:
    """Best label key per text (labels: key -> description), or None when unavailable or unsure (score < 0.5)."""
    out: list[str | None] = [None] * len(texts)
    if not texts or not enabled():
        return out
    names = list(labels.values())
    back = {v: k for k, v in labels.items()}
    for i, text in enumerate(texts):
        if text in _zs_cache:
            out[i] = _zs_cache[text]
            continue
        payload = {"inputs": text[:300], "parameters": {"candidate_labels": names}, "options": {"wait_for_model": True}}
        try:
            try:
                res = _post(settings.hf_zero_shot_model, payload)
            except (httpx.HTTPError, ValueError, json.JSONDecodeError):
                res = _post(ZERO_SHOT_MODEL, payload)                           # older, always-available model
        except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
            _fail("zero-shot", exc)
            break
        best, score = None, 0.0
        if isinstance(res, dict) and res.get("labels"):                       # {"labels": [...], "scores": [...]}
            best, score = res["labels"][0], float(res["scores"][0])
        elif isinstance(res, list) and res and isinstance(res[0], dict):       # [{"label", "score"}, ...]
            top = max(res, key=lambda x: x.get("score", 0))
            best, score = top.get("label"), float(top.get("score", 0))
        _zs_cache[text] = back.get(best) if best and score >= 0.5 else None
        out[i] = _zs_cache[text]
    if len(_zs_cache) > 3000:
        _zs_cache.clear()
    return out


EMOTION_MODEL = "j-hartmann/emotion-english-distilroberta-base"


def emotion(text: str) -> str | None:
    """anger / disgust / fear / joy / neutral / sadness / surprise for a journal entry, or None if AI is off or unsure."""
    if not text.strip() or not enabled():
        return None
    try:
        res = _post(EMOTION_MODEL, {"inputs": text[:1000], "options": {"wait_for_model": True}})
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        _fail("emotion", exc)
        return None
    if isinstance(res, list) and res and isinstance(res[0], list):
        res = res[0]
    if isinstance(res, list) and res and isinstance(res[0], dict):
        top = max(res, key=lambda x: x.get("score", 0))
        return str(top.get("label")).lower() if float(top.get("score", 0)) >= 0.4 else None
    return None


SINHALA = "\u0d80-\u0dff"


def has_sinhala(text: str) -> bool:
    import re
    return bool(re.search(f"[{SINHALA}]", text or ""))


def translate(text: str, to: str) -> str | None:
    """Sinhala <-> English with NLLB (to = "en" or "si"). None when unavailable."""
    if not text.strip() or not enabled():
        return None
    src, tgt = ("sin_Sinh", "eng_Latn") if to == "en" else ("eng_Latn", "sin_Sinh")
    try:
        res = _post(settings.hf_translate_model, {"inputs": text[:1500], "parameters": {"src_lang": src, "tgt_lang": tgt}, "options": {"wait_for_model": True}})
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        _fail("translation", exc)
        return None
    if isinstance(res, list) and res and isinstance(res[0], dict):
        out = res[0].get("translation_text") or res[0].get("generated_text")
        return str(out).strip() or None
    return None
