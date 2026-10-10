"""SMS provider abstraction for OTP delivery.

Two implementations ship:

* :class:`StubSmsProvider` — today's behavior: logs the OTP, sends nothing.
  Used for local dev and the test suite (``SMS_PROVIDER=stub``).
* :class:`Msg91SmsProvider` — MSG91 v5 flow API (template-based OTP):
  ``POST https://control.msg91.com/api/v5/flow/`` with the account's
  ``authkey`` header, a sender id, a flow (template) id, and the OTP as the
  ``VAR1`` template variable. Used in production (``SMS_PROVIDER=msg91``).

Selection happens in :func:`get_sms_provider` from ``Settings``. When
``sms_provider`` is ``"msg91"`` but any credential is missing, construction
raises :class:`SmsConfigurationError` — the OTP request then fails LOUDLY
(HTTP 500 with a traceback in the server logs) instead of silently
pretending an SMS was sent.
"""

import logging
from typing import Protocol

import httpx

from .config import settings

log = logging.getLogger("cashbook.sms")

MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow/"


class SmsConfigurationError(RuntimeError):
    """Raised when the configured SMS provider cannot be built or used."""


class SmsProvider(Protocol):
    def send_otp(self, mobile: str, otp: str) -> None: ...


class StubSmsProvider:
    """Dev/test provider: logs the OTP, delivers nothing."""

    def send_otp(self, mobile: str, otp: str) -> None:
        log.info("[stub-sms] OTP for %s -> %s (not sent)", mobile, otp)


class Msg91SmsProvider:
    """MSG91 v5 flow API (https://control.msg91.com/api/v5/flow/).

    The DLT-registered template behind ``flow_id`` must contain a single
    variable placeholder (``##VAR1##``) which receives the OTP.
    """

    def __init__(self, *, api_key: str, sender_id: str, flow_id: str) -> None:
        missing = [
            name
            for name, value in (
                ("MSG91_API_KEY", api_key),
                ("MSG91_SENDER_ID", sender_id),
                ("MSG91_FLOW_ID", flow_id),
            )
            if not (value or "").strip()
        ]
        if missing:
            # Fail loudly: a half-configured provider must never silently
            # pretend the OTP SMS went out.
            raise SmsConfigurationError(
                "SMS_PROVIDER=msg91 but these are missing/empty: "
                + ", ".join(missing)
                + ". Set them in the environment (Render dashboard) — "
                "refusing to pretend the OTP SMS was sent."
            )
        self._api_key = api_key.strip()
        self._sender_id = sender_id.strip()
        self._flow_id = flow_id.strip()

    def send_otp(self, mobile: str, otp: str) -> None:
        # MSG91 expects the recipient with country code; our mobiles are
        # validated 10-digit Indian numbers (see app.validation.validate_mobile).
        payload = {
            "flow_id": self._flow_id,
            "sender": self._sender_id,
            "mobiles": f"91{mobile}",
            "VAR1": otp,
        }
        try:
            response = httpx.post(
                MSG91_FLOW_URL,
                headers={"authkey": self._api_key, "Content-Type": "application/json"},
                json=payload,
                timeout=15.0,
            )
        except httpx.HTTPError as exc:
            raise SmsConfigurationError(f"MSG91 request failed: {exc}") from exc
        if response.status_code >= 400:
            raise SmsConfigurationError(
                f"MSG91 rejected the OTP SMS (HTTP {response.status_code}): "
                f"{response.text[:200]}"
            )
        try:
            body = response.json()
        except ValueError as exc:
            raise SmsConfigurationError(
                "MSG91 returned a non-JSON response "
                f"(HTTP {response.status_code}): {response.text[:200]}"
            ) from exc
        if not isinstance(body, dict) or body.get("type") != "success":
            raise SmsConfigurationError(
                f"MSG91 did not accept the OTP SMS: {response.text[:200]}"
            )
        # Never log the OTP itself on the real path.
        log.info("OTP SMS accepted by MSG91 for mobile ending %s", mobile[-4:])


def get_sms_provider() -> SmsProvider:
    """Build the SMS provider selected by ``Settings.sms_provider``."""
    name = (settings.sms_provider or "stub").strip().lower()
    if name == "stub":
        return StubSmsProvider()
    if name == "msg91":
        return Msg91SmsProvider(
            api_key=settings.msg91_api_key,
            sender_id=settings.msg91_sender_id,
            flow_id=settings.msg91_flow_id,
        )
    raise SmsConfigurationError(
        f"Unknown SMS_PROVIDER={settings.sms_provider!r} — expected 'stub' or 'msg91'."
    )
