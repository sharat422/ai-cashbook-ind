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


def test_scan_returns_structured_line_items(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    result = _empty_receipt()
    result["line_items"] = [
        {"description": " Tea ", "quantity": 2, "unit": "cup", "rate": 12.5, "amount": 25},
        {"description": "Rice", "quantity": "1.5", "unit": "", "rate": None, "amount": "60.75"},
        {"description": "", "quantity": 1, "unit": None, "rate": 1, "amount": 1},  # dropped
        "junk",  # dropped
    ]
    client = MagicMock()
    client.messages.create.return_value = SimpleNamespace(content=[
        SimpleNamespace(type="tool_use", input=result),
    ])
    with patch("anthropic.Anthropic", return_value=client):
        extracted = scan_receipt("aW1hZ2U=", "image/jpeg")
    assert extracted["line_items"] == [
        {"description": "Tea", "unit": "cup", "quantity": 2.0, "rate": 12.5, "amount": 25.0},
        {"description": "Rice", "unit": None, "quantity": 1.5, "rate": None, "amount": 60.75},
    ]
    schema = client.messages.create.call_args.kwargs["tools"][0]["input_schema"]
    assert "line_items" in schema["required"]
    assert schema["properties"]["line_items"]["type"] == "array"


def test_model_without_line_items_returns_empty_list(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    result = _empty_receipt()
    del result["line_items"]
    client = MagicMock()
    client.messages.create.return_value = SimpleNamespace(content=[
        SimpleNamespace(type="tool_use", input=result),
    ])
    with patch("anthropic.Anthropic", return_value=client):
        assert scan_receipt("aW1hZ2U=", "image/jpeg")["line_items"] == []


# --- Image preparation: phone photos must reach the vision model in a shape it
# accepts (the cause of "Couldn't read the receipt" on every scan). ----------
import base64
import io

import anthropic
import httpx
from PIL import Image

from app.ai import prepare_receipt_image


def _photo_bytes(size=(4032, 3024), fmt="JPEG", exif_orientation=None) -> bytes:
    img = Image.new("RGB", size, "white")
    buf = io.BytesIO()
    kwargs = {}
    if exif_orientation:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        kwargs["exif"] = exif
    img.save(buf, format=fmt, quality=95, **kwargs)
    return buf.getvalue()


def _decode(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64)))


def test_large_camera_photo_is_downsized_to_jpeg():
    b64, media_type = prepare_receipt_image(_photo_bytes(), "image/jpg")
    assert media_type == "image/jpeg"
    assert max(_decode(b64).size) == 1568
    assert len(b64) < 5 * 1024 * 1024


def test_exif_rotation_is_applied_so_text_is_upright():
    # Orientation 6 = rotate 90° CW: a landscape-stored portrait shot.
    b64, _ = prepare_receipt_image(_photo_bytes((2000, 1000), exif_orientation=6), "image/jpeg")
    w, h = _decode(b64).size
    assert h > w


def test_png_and_rgba_are_converted():
    img = Image.new("RGBA", (800, 1200), (255, 255, 255, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64, media_type = prepare_receipt_image(buf.getvalue(), "application/octet-stream")
    assert media_type == "image/jpeg"
    assert _decode(b64).size == (800, 1200)


def test_heic_from_iphone_gallery_is_converted():
    import pillow_heif

    pillow_heif.register_heif_opener()
    buf = io.BytesIO()
    Image.new("RGB", (3024, 4032), "white").save(buf, format="HEIF")
    b64, media_type = prepare_receipt_image(buf.getvalue(), "image/heic")
    assert media_type == "image/jpeg"
    assert _decode(b64).size == (1176, 1568)


def test_undecodable_bytes_pass_through_with_valid_media_type():
    b64, media_type = prepare_receipt_image(b"not-a-real-image", "image/jpg")
    assert base64.b64decode(b64) == b"not-a-real-image"
    assert media_type == "image/jpeg"


def test_missing_model_falls_back_instead_of_returning_empty(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    monkeypatch.setattr(settings, "anthropic_model", "claude-retired")
    monkeypatch.setattr(settings, "anthropic_fallback_model", "claude-fallback")
    result = _empty_receipt()
    result["amount"] = {"value": 120, "confidence": 0.9}
    not_found = anthropic.NotFoundError(
        "model not found",
        response=httpx.Response(404, request=httpx.Request("POST", "https://x")),
        body=None,
    )
    client = MagicMock()
    client.messages.create.side_effect = [
        not_found,
        SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=result)]),
    ]
    with patch("anthropic.Anthropic", return_value=client):
        extracted = scan_receipt("aW1hZ2U=", "image/jpeg")
    assert extracted["amount"]["value"] == 120
    models = [c.kwargs["model"] for c in client.messages.create.call_args_list]
    assert models == ["claude-retired", "claude-fallback"]


def test_scan_endpoint_rejects_empty_upload(user, client):
    r = client.post(
        "/api/v1/receipts/scan",
        headers=user.headers,
        files={"receipt": ("r.jpg", io.BytesIO(b""), "image/jpeg")},
    )
    assert r.status_code == 400


def _api_error(cls, status, message):
    return cls(message, response=httpx.Response(status, request=httpx.Request("POST", "https://x")), body=None)


def test_a_failed_reader_says_why_instead_of_an_empty_draft(monkeypatch):
    """An empty draft read as "try a clearer photo" for every receipt, whatever the real fault."""
    import pytest
    from app.errors import AppError

    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    cases = [
        (_api_error(anthropic.AuthenticationError, 401, "invalid x-api-key"), "receipt_ai_setup"),
        (_api_error(anthropic.BadRequestError, 400, "Your credit balance is too low"), "receipt_ai_setup"),
        (anthropic.APIConnectionError(request=httpx.Request("POST", "https://x")), "receipt_ai_busy"),
        (_api_error(anthropic.InternalServerError, 529, "Overloaded"), "receipt_ai_busy"),
    ]
    for exc, code in cases:
        client = MagicMock()
        client.messages.create.side_effect = exc
        with patch("anthropic.Anthropic", return_value=client), pytest.raises(AppError) as err:
            scan_receipt("aW1hZ2U=", "image/jpeg")
        assert (err.value.status_code, err.value.code) == (503, code), type(exc).__name__
    # The photo itself refused: an empty draft, which the app shows as "try a clearer photo".
    client = MagicMock()
    client.messages.create.side_effect = _api_error(anthropic.BadRequestError, 400, "Could not process image")
    with patch("anthropic.Anthropic", return_value=client):
        assert scan_receipt("aW1hZ2U=", "image/jpeg") == _empty_receipt()
