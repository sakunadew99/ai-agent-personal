from datetime import date, timedelta

from app.services.capture import parse_capture, sensitivity_of


def test_capture_extracts_tomorrow_learning_task():
    today = date(2026, 11, 10)
    result = parse_capture("Tomorrow, study Python for 30 minutes", today)

    assert result["classified_type"] == "learning_task"
    assert result["title"] == "Study Python"
    assert result["date"] == (today + timedelta(days=1)).isoformat()
    assert result["duration_minutes"] == 30


def test_sensitive_capture_is_detected():
    assert sensitivity_of("My API key is abc123") == "sensitive"
    assert sensitivity_of("Review my Python notes") == "normal"
