from types import SimpleNamespace
import uuid

import app.services.assistant as assistant


class EmptyScalars:
    def all(self):
        return []


class EmptyDb:
    def scalars(self, _statement):
        return EmptyScalars()


def test_assistant_facts_serializes_insight_snapshot(monkeypatch):
    monkeypatch.setattr(
        assistant,
        "insight_facts",
        lambda _db, _user: {"open_tasks": [{"title": "Study Python"}], "active_goals": []},
    )
    monkeypatch.setattr(
        assistant,
        "finance_summary",
        lambda _db, _user, _month: {"net_income": "0.00", "currency": "USD", "net_worth": "0.00", "target_amount": None},
    )

    facts = assistant._facts(EmptyDb(), SimpleNamespace(id=uuid.uuid4()), "general")

    assert isinstance(facts, str)
    assert "Recent activity:" in facts
    assert '"Study Python"' in facts
