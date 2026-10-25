"""Receipt OCR keeps the complete transcription alongside summary fields."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.ai import _empty_receipt, scan_receipt
from app.config import settings


def test_scan_requests_and_preserves_all_receipt_details(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    text = "Shop\nTea 2 x 12.50 = 25.00\nGST 1.25\nTotal 26.25\nUPI ref 123"
    result = _empty_receipt()
    result["receipt_text"] = {"value": text, "confidence": 0.9}
    result["amount"] = {"value": 26.25, "confidence": 0.95}
    client = MagicMock()
    client.messages.create.return_value = SimpleNamespace(content=[
        SimpleNamespace(type="tool_use", input=result),
    ])
    with patch("anthropic.Anthropic", return_value=client):
        extracted = scan_receipt("aW1hZ2U=", "image/jpeg")
    assert extracted["receipt_text"]["value"] == text
    assert extracted["amount"]["value"] == 26.25
    request = client.messages.create.call_args.kwargs
    assert "receipt_text" in request["tools"][0]["input_schema"]["required"]
    assert request["messages"][0]["content"][0]["source"]["data"] == "aW1hZ2U="
    assert "every line item" in request["messages"][0]["content"][1]["text"]
