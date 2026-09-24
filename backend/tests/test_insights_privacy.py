"""Khata insights must not send customer names to the external model: names are
replaced with opaque labels before the call and restored in the result."""

from app.ai import _anonymize_stats, _rehydrate_insights


def test_anonymize_strips_names_and_ids():
    stats = {
        "total_receivable": 50000,
        "top_defaulters": [
            {"customer_id": "abc123", "name": "Ramesh Kumar", "amount": 30000, "days_overdue": 40},
            {"customer_id": "def456", "name": "Sita Devi", "amount": 20000, "days_overdue": 12},
        ],
    }
    safe, mapping = _anonymize_stats(stats)

    # The payload that would go to OpenAI contains no names or ids.
    import json
    blob = json.dumps(safe)
    assert "Ramesh Kumar" not in blob and "Sita Devi" not in blob
    assert "abc123" not in blob and "def456" not in blob
    # It keeps the useful numbers under opaque labels.
    assert safe["top_defaulters"][0] == {"label": "Customer 1", "amount": 30000, "days_overdue": 40}
    assert safe["total_receivable"] == 50000
    # Mapping lets us restore names afterwards.
    assert mapping == {"Customer 1": "Ramesh Kumar", "Customer 2": "Sita Devi"}
    # Original stats are not mutated.
    assert stats["top_defaulters"][0]["name"] == "Ramesh Kumar"


def test_rehydrate_restores_names_in_output():
    mapping = {"Customer 1": "Ramesh Kumar"}
    insights = [{
        "id": "x", "type": "risk", "sentiment": "warning",
        "title": "Customer 1 is overdue",
        "detail": "Customer 1 owes the most and is 40 days late.",
        "drill": {"target": "customers", "search": "Customer 1"},
    }]
    out = _rehydrate_insights(insights, mapping)
    assert out[0]["title"] == "Ramesh Kumar is overdue"
    assert "Ramesh Kumar" in out[0]["detail"]
    assert out[0]["drill"]["search"] == "Ramesh Kumar"


def test_no_defaulters_is_safe():
    safe, mapping = _anonymize_stats({"total_receivable": 0})
    assert safe["top_defaulters"] == [] and mapping == {}
    assert _rehydrate_insights([], mapping) == []
