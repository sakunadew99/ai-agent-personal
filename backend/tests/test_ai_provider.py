from app.services import ai_client
from app.services.assistant import _local_reply


class _Resp:
    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": "hello from provider"}}], "usage": {"prompt_tokens": 3, "completion_tokens": 2}}


class _Db:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)


def test_ai_disabled_without_any_key(monkeypatch):
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "")
    monkeypatch.setattr(ai_client.settings, "openai_api_key", "")
    assert ai_client.ai_enabled() is False
    assert ai_client.chat_complete(_Db(), None, "conversation", "m", [{"role": "user", "content": "hi"}]) is None


def test_chat_uses_configured_provider_url_and_key(monkeypatch):
    calls = {}

    def fake_post(url, headers=None, json=None, timeout=None, **_):
        calls.update(url=url, auth=headers["Authorization"], model=json["model"], temperature=json["temperature"])
        return _Resp()

    monkeypatch.setattr(ai_client.settings, "ai_api_key", "provider-key")
    monkeypatch.setattr(ai_client.settings, "ai_base_url", "https://api.example-llm.com/v1/")
    monkeypatch.setattr(ai_client.httpx, "post", fake_post)
    db = _Db()
    reply = ai_client.chat_complete(db, None, "conversation", "some-model", [{"role": "user", "content": "hi"}], temperature=0.4)
    assert reply == "hello from provider"
    assert calls == {"url": "https://api.example-llm.com/v1/chat/completions", "auth": "Bearer provider-key", "model": "some-model", "temperature": 0.4}
    assert len(db.added) == 1  # usage recorded


def test_openai_key_still_works_as_fallback(monkeypatch):
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "")
    monkeypatch.setattr(ai_client.settings, "openai_api_key", "legacy-key")
    assert ai_client.ai_enabled() is True


def test_embeddings_can_be_turned_off_per_provider(monkeypatch):
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "k")
    monkeypatch.setattr(ai_client.settings, "ai_embeddings", False)
    assert ai_client.embeddings_enabled() is False
    assert ai_client.embed_text(_Db(), None, "text") is None


def test_focus_reply_without_priorities_is_a_full_sentence():
    reply = _local_reply("What should I focus on today?", "Open tasks: 0.", "focus")
    assert "Start with ." not in reply
    assert reply.startswith("Open tasks: 0.")


def test_assistant_status_never_exposes_the_key(monkeypatch):
    from app.api.v1 import router as routes
    monkeypatch.setattr(ai_client.settings, "ai_api_key", "secret-key-value")
    monkeypatch.setattr(ai_client.settings, "ai_base_url", "https://api.groq.com/openai/v1")
    status = routes.assistant_status(user=None)
    assert status["ai_enabled"] is True and status["provider"] == "api.groq.com"
    assert "secret-key-value" not in str(status)
