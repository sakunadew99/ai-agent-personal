import logging
from decimal import Decimal

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import AiUsage

logger = logging.getLogger(__name__)


def _api_key() -> str:
    return settings.ai_api_key or settings.openai_api_key


def _url(path: str) -> str:
    return f"{settings.ai_base_url.rstrip('/')}/{path.lstrip('/')}"


# Last provider failure, for the in-app status (provider's message only; the API key is never included).
last_error: dict | None = None


def _remember_error(exc: Exception) -> None:
    global last_error
    status = None
    message = type(exc).__name__
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        try:
            body = exc.response.json()
            err = body.get("error", body) if isinstance(body, dict) else body
            message = (err.get("message") or err.get("code") or str(err)) if isinstance(err, dict) else str(err)
        except ValueError:
            message = exc.response.text[:300] or message
    elif isinstance(exc, httpx.HTTPError):
        message = f"Could not reach the AI provider ({type(exc).__name__})"
    key = _api_key()
    if key:
        message = message.replace(key, "***")
    last_error = {"status": status, "message": str(message)[:300]}


def ai_enabled() -> bool:
    """True when a language-model provider key is configured."""
    return bool(_api_key())


def embeddings_enabled() -> bool:
    return ai_enabled() and settings.ai_embeddings


def _cost(input_tokens: int, output_tokens: int) -> Decimal | None:
    if settings.openai_input_price_per_million == 0 and settings.openai_output_price_per_million == 0:
        return None
    million = Decimal(1_000_000)
    return (
        Decimal(input_tokens) * settings.openai_input_price_per_million
        + Decimal(output_tokens) * settings.openai_output_price_per_million
    ) / million


def _record(db: Session, user_id, feature: str, model: str, usage: dict) -> None:
    prompt = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    completion = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    db.add(
        AiUsage(
            user_id=user_id,
            feature=feature,
            model=model,
            input_tokens=prompt,
            output_tokens=completion,
            estimated_cost_usd=_cost(prompt, completion),
        )
    )


def chat_complete(db: Session, user_id, feature: str, model: str, messages: list[dict], temperature: float = 0.2) -> str | None:
    if not ai_enabled():
        return None
    try:
        payload = {"model": model, "temperature": temperature, "messages": messages}
        response = httpx.post(_url("chat/completions"), headers={"Authorization": f"Bearer {_api_key()}"}, json=payload, timeout=60)
        if response.status_code == 400 and "temperature" in response.text.lower():
            # Newer reasoning models (e.g. the GPT-5 family) only accept the default temperature.
            payload.pop("temperature")
            response = httpx.post(_url("chat/completions"), headers={"Authorization": f"Bearer {_api_key()}"}, json=payload, timeout=60)
        response.raise_for_status()
        data = response.json()
        _record(db, user_id, feature, model, data.get("usage") or {})
        global last_error
        last_error = None
        return data["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        logger.exception("chat completion failed")
        _remember_error(exc)
        return None


def embed_text(db: Session, user_id, text: str) -> list[float] | None:
    if not embeddings_enabled():
        return None
    try:
        response = httpx.post(
            _url("embeddings"),
            headers={"Authorization": f"Bearer {_api_key()}"},
            json={"model": settings.openai_embedding_model, "input": text},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        _record(db, user_id, "embedding", settings.openai_embedding_model, data.get("usage") or {})
        return data["data"][0]["embedding"]
    except (httpx.HTTPError, KeyError, IndexError):
        logger.exception("embedding failed")
        return None


def transcribe_audio(db: Session, user_id, filename: str, content: bytes, content_type: str) -> str | None:
    if not (ai_enabled() and settings.ai_transcription):
        return None
    try:
        response = httpx.post(
            _url("audio/transcriptions"),
            headers={"Authorization": f"Bearer {_api_key()}"},
            data={"model": settings.openai_transcription_model},
            files={"file": (filename or "audio.webm", content, content_type or "application/octet-stream")},
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
        db.add(
            AiUsage(
                user_id=user_id,
                feature="transcription",
                model=settings.openai_transcription_model,
                input_tokens=0,
                output_tokens=0,
                estimated_cost_usd=None,
            )
        )
        return data.get("text", "")
    except (httpx.HTTPError, KeyError):
        logger.exception("transcription failed")
        return None


def model_for(purpose: str) -> str:
    if purpose in {"analysis", "finance", "planning"}:
        return settings.openai_model_reasoning
    if purpose == "classification":
        return settings.openai_model_small
    return settings.openai_model_balanced
