"""Unit tests for the SMS provider abstraction (app/sms.py).

No network is touched: the MSG91 HTTP call is mocked, and these tests never
route through the OTP endpoint (which uses the stub provider under test env).
"""

from unittest.mock import MagicMock, patch

import pytest

from app.config import settings
from app.sms import (
    Msg91SmsProvider,
    SmsConfigurationError,
    StubSmsProvider,
    get_sms_provider,
)


def test_stub_provider_is_default():
    assert isinstance(get_sms_provider(), StubSmsProvider)


def test_unknown_provider_name_fails_loudly(monkeypatch):
    monkeypatch.setattr(settings, "sms_provider", "carrier-pigeon")
    with pytest.raises(SmsConfigurationError):
        get_sms_provider()


def test_msg91_missing_credentials_fail_loudly():
    with pytest.raises(SmsConfigurationError):
        Msg91SmsProvider(api_key="", sender_id="BOLCSH", flow_id="flow123")
    with pytest.raises(SmsConfigurationError):
        Msg91SmsProvider(api_key="key", sender_id="", flow_id="flow123")
    with pytest.raises(SmsConfigurationError):
        Msg91SmsProvider(api_key="key", sender_id="BOLCSH", flow_id="   ")


def _ok_response() -> MagicMock:
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {"type": "success", "message": "sent"}
    resp.text = '{"type": "success"}'
    return resp


def test_msg91_sends_otp_via_flow_api():
    provider = Msg91SmsProvider(api_key="key", sender_id="BOLCSH", flow_id="flow123")
    with patch("app.sms.httpx.post", return_value=_ok_response()) as mock_post:
        provider.send_otp("9876543210", "482913")

    (url,), kwargs = mock_post.call_args
    assert url == "https://control.msg91.com/api/v5/flow/"
    assert kwargs["headers"]["authkey"] == "key"
    body = kwargs["json"]
    assert body["flow_id"] == "flow123"
    assert body["sender"] == "BOLCSH"
    assert body["mobiles"] == "919876543210"  # country code prefixed
    assert body["VAR1"] == "482913"


def test_msg91_http_rejection_raises():
    provider = Msg91SmsProvider(api_key="key", sender_id="BOLCSH", flow_id="flow123")
    resp = MagicMock()
    resp.status_code = 400
    resp.text = '{"type": "error", "message": "bad request"}'
    with patch("app.sms.httpx.post", return_value=resp):
        with pytest.raises(SmsConfigurationError):
            provider.send_otp("9876543210", "482913")


def test_msg91_error_payload_raises():
    provider = Msg91SmsProvider(api_key="key", sender_id="BOLCSH", flow_id="flow123")
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {"type": "error", "message": "template not found"}
    resp.text = '{"type": "error"}'
    with patch("app.sms.httpx.post", return_value=resp):
        with pytest.raises(SmsConfigurationError):
            provider.send_otp("9876543210", "482913")
