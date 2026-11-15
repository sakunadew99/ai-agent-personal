import logging
from datetime import timedelta
from decimal import Decimal

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import now_utc
from app.core.config import settings
from app.models.entities import AiSettings, AiUsage

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


# ---------- AI gateway controls (guide 27.3): off switch, caps, per-feature off. Blocked = rules take over. ----------

# Feature name (as logged in ai_usage) -> group the user can switch off.
GROUP_LABELS = {"chat": "assistant chat", "summary": "conversation summaries", "memory": "memory search (embeddings)",
                "transcription": "audio transcription", "voice_parse": "understanding unusual voice commands",
                "exam": "exam writing and speaking feedback", "workers": "AI team notes (morning coach, focus guard...)"}
_last_block: dict[str, dict] = {}


def feature_group(feature: str) -> str:
    if feature.startswith("worker_"):
        return "workers"
    return {"summary": "summary", "embedding": "memory", "transcription": "transcription", "command_parse": "voice_parse", "exam_feedback": "exam"}.get(feature, "chat")


def settings_for(db: Session, user_id) -> AiSettings | None:
    return db.scalar(select(AiSettings).where(AiSettings.user_id == user_id))


def usage_totals(db: Session, user_id) -> dict:
    now = now_utc()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    def total(since):
        row = db.execute(select(func.coalesce(func.sum(AiUsage.input_tokens + AiUsage.output_tokens), 0),
                                func.coalesce(func.sum(AiUsage.estimated_cost_usd), 0), func.count())
                         .where(AiUsage.user_id == user_id, AiUsage.created_at >= since)).one()
        return {"tokens": int(row[0] or 0), "cost_usd": Decimal(row[1] or 0), "calls": int(row[2] or 0)}
    return {"today": total(day_start), "month": total(month_start), "day_start": day_start, "month_start": month_start,
            "week_start": day_start - timedelta(days=13)}


def gate(db: Session, user_id, feature: str) -> str | None:
    """Why an AI call must not happen now (None = allowed). Checked before every call; never raises."""
    if user_id is None:
        return None
    try:
        cfg = settings_for(db, user_id)
        if cfg is None:
            return None
        if cfg.ai_off:
            return "AI is switched off in Settings, so Sakuna used its built-in rules."
        group = feature_group(feature)
        if group in (cfg.disabled_features or []):
            return f"AI for {GROUP_LABELS.get(group, group)} is switched off in Settings."
        if cfg.daily_token_cap or cfg.monthly_token_cap or cfg.monthly_cost_cap_usd:
            used = usage_totals(db, user_id)
            if cfg.daily_token_cap and used["today"]["tokens"] >= cfg.daily_token_cap:
                return f"Today's AI limit ({cfg.daily_token_cap:,} tokens) is used up; rules are used until tomorrow (UTC)."
            if cfg.monthly_token_cap and used["month"]["tokens"] >= cfg.monthly_token_cap:
                return f"This month's AI limit ({cfg.monthly_token_cap:,} tokens) is used up; rules are used until next month."
            if cfg.monthly_cost_cap_usd and used["month"]["cost_usd"] >= cfg.monthly_cost_cap_usd:
                return f"This month's AI budget (USD {cfg.monthly_cost_cap_usd}) is used up; rules are used until next month."
    except Exception:  # noqa: BLE001 - the gate must never break a request
        logger.exception("AI gate check failed")
    return None


def _blocked(db: Session, user_id, feature: str) -> bool:
    reason = gate(db, user_id, feature)
    if reason:
        _last_block[str(user_id)] = {"feature": feature, "reason": reason, "at": now_utc().isoformat()}
        return True
    return False


def block_reason(user_id) -> str | None:
    """The most recent reason an AI call was skipped for this user (shown in chat and Settings)."""
    entry = _last_block.get(str(user_id))
    return entry["reason"] if entry else None


def clear_block(user_id) -> None:
    _last_block.pop(str(user_id), None)


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
    if not ai_enabled() or _blocked(db, user_id, feature):
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
    if not embeddings_enabled() or _blocked(db, user_id, "embedding"):
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
    if not (ai_enabled() and settings.ai_transcription) or _blocked(db, user_id, "transcription"):
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
