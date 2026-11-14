from functools import lru_cache
from decimal import Decimal

from pydantic_settings import BaseSettings, SettingsConfigDict

WEAK_SECRETS = {"", "change-me", "dev-only-change-me", "dev-service-token"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+psycopg://sakuna:sakuna@localhost:5432/sakuna"
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 14
    openai_api_key: str = ""
    # Any OpenAI-compatible provider: OpenAI (default), Google Gemini
    # (https://generativelanguage.googleapis.com/v1beta/openai), Groq (https://api.groq.com/openai/v1),
    # OpenRouter (https://openrouter.ai/api/v1), Anthropic (https://api.anthropic.com/v1). Set the model names to match.
    ai_base_url: str = "https://api.openai.com/v1"
    ai_api_key: str = ""                  # falls back to OPENAI_API_KEY
    ai_embeddings: bool = True            # needs 1536-dim embeddings; turn off for providers without them
    ai_transcription: bool = True
    openai_model_small: str = "gpt-4o-mini"
    openai_model_balanced: str = "gpt-4o-mini"
    openai_model_reasoning: str = "gpt-4o"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dimensions: int = 1536
    openai_transcription_model: str = "whisper-1"
    openai_input_price_per_million: Decimal = Decimal("0")
    openai_output_price_per_million: Decimal = Decimal("0")
    cors_origins: str = "http://localhost:3000,http://localhost:8081"
    service_token: str = "dev-service-token"
    # Turn off on any internet-facing server once your own account exists, so strangers who find
    # the URL cannot sign up. Existing users can still sign in.
    registration_open: bool = True


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.environment == "production":
        if settings.jwt_secret in WEAK_SECRETS or len(settings.jwt_secret) < 32:
            raise RuntimeError("Set a strong JWT_SECRET before running in production")
        if settings.database_url.startswith("sqlite"):
            raise RuntimeError("Production requires PostgreSQL")
        if settings.service_token in WEAK_SECRETS:
            raise RuntimeError("Set SERVICE_TOKEN before running in production")
    return settings


settings = get_settings()
