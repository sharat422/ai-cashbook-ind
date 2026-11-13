"""Server-side notification delivery — WhatsApp Business Cloud API.

The app owns no messaging credentials; it POSTs {to, message} to
`/notifications/whatsapp` and this module forwards to Meta's Cloud API using the
server's token. Blank credentials = disabled (the route returns 503 and the app
silently falls back to the in-app inbox).

Note on WhatsApp policy: free-form *text* messages only deliver inside the
24-hour customer-service window (i.e. after the user has messaged your number).
For business-initiated notifications outside that window you must send an
approved *template* — set WHATSAPP_TEMPLATE_NAME once your template is approved
(see docs). Text send is used here for the MVP / testing path.
"""

import logging
import time

import httpx

from .config import settings

log = logging.getLogger("cashbook.notifications")


class WhatsAppNotConfigured(RuntimeError):
    """Raised when WhatsApp credentials are absent."""


class WhatsAppSendError(RuntimeError):
    """Raised when the WhatsApp Cloud API rejects the send (Meta's error code
    and its reason, when it gave them)."""

    def __init__(self, message: str, code: int | str | None = None, reason: str | None = None):
        super().__init__(message)
        self.code = code
        self.reason = reason or message


def whatsapp_configured() -> bool:
    return bool(
        settings.whatsapp_access_token and settings.whatsapp_phone_number_id
    )


def normalize_recipient(to: str) -> str:
    """Return a WhatsApp msisdn: digits only, with a country code.

    A bare 10-digit number gets the default country code prepended; anything
    already carrying a country code (11-13 digits) is passed through.
    """
    digits = "".join(ch for ch in (to or "") if ch.isdigit())
    if len(digits) == 10:
        digits = f"{settings.whatsapp_default_country_code}{digits}"
    return digits


def send_whatsapp_text(to: str, message: str) -> dict:
    """Send a free-form text WhatsApp message. Raises on missing config/errors."""
    if not whatsapp_configured():
        raise WhatsAppNotConfigured("WhatsApp is not configured on the server.")

    recipient = normalize_recipient(to)
    url = (
        f"https://graph.facebook.com/{settings.whatsapp_api_version}"
        f"/{settings.whatsapp_phone_number_id}/messages"
    )
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": recipient,
        "type": "text",
        "text": {"preview_url": False, "body": message},
    }
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_access_token}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:  # network/timeout
        log.warning("WhatsApp request failed: %s", exc)
        raise WhatsAppSendError(f"WhatsApp request failed: {exc}") from exc

    if resp.status_code >= 400:
        log.warning("WhatsApp API %s: %s", resp.status_code, resp.text)
        raise WhatsAppSendError(f"WhatsApp API error {resp.status_code}: {resp.text}")

    return resp.json()


# ------------------------------------------------------- approved templates
# Business-initiated messages outside the 24-hour window need a template Meta
# has APPROVED. Server sends use only that, with variables only.

_TEMPLATE_TTL = 600  # seconds; Meta can pause or re-categorise a template
_template_cache: dict[str, tuple[float, str]] = {}


def _graph(path: str) -> str:
    return f"https://graph.facebook.com/{settings.whatsapp_api_version}/{path}"


def template_status(name: str) -> str:
    """APPROVED only if Meta lists this template as approved AND still UTILITY
    (a re-categorised one would be charged as marketing). Otherwise PENDING,
    REJECTED, PAUSED, DISABLED, RECATEGORISED_MARKETING, NOT_SET or UNKNOWN."""
    if not (name and whatsapp_configured() and settings.whatsapp_business_account_id):
        return "NOT_SET"
    hit = _template_cache.get(name)
    if hit and time.monotonic() - hit[0] < _TEMPLATE_TTL:
        return hit[1]
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(_graph(f"{settings.whatsapp_business_account_id}/message_templates"),
                              params={"name": name, "fields": "name,status,category,language"},
                              headers={"Authorization": f"Bearer {settings.whatsapp_access_token}"})
        rows = resp.json().get("data", []) if resp.status_code < 400 else None
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("WhatsApp template status check failed: %s", exc)
        rows = None
    if rows is None:
        return "UNKNOWN"  # not cached: try again next time
    row = next((r for r in rows if r.get("name") == name
                and r.get("language") == settings.whatsapp_template_language), None)
    status = (row or {}).get("status", "NOT_FOUND")
    if status == "APPROVED" and row.get("category") != "UTILITY":
        status = f"RECATEGORISED_{row.get('category')}"
    _template_cache[name] = (time.monotonic(), status)
    return status


def send_whatsapp_template(to: str, name: str, params: list[str]) -> dict:
    """Send an approved template with its body variables — never free text.
    Returns Meta's reply (messages[0].id is the message id for the webhook)."""
    if not whatsapp_configured():
        raise WhatsAppNotConfigured("WhatsApp is not configured on the server.")
    payload = {
        "messaging_product": "whatsapp",
        "to": normalize_recipient(to),
        "type": "template",
        "template": {
            "name": name,
            "language": {"code": settings.whatsapp_template_language},
            "components": [{"type": "body",
                            "parameters": [{"type": "text", "text": p} for p in params]}],
        },
    }
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(_graph(f"{settings.whatsapp_phone_number_id}/messages"), json=payload,
                               headers={"Authorization": f"Bearer {settings.whatsapp_access_token}"})
    except httpx.HTTPError as exc:
        raise WhatsAppSendError(f"WhatsApp request failed: {exc}", reason="network error") from exc
    if resp.status_code >= 400:
        try:
            err = resp.json().get("error", {})
        except ValueError:
            err = {}
        reason = (err.get("error_data") or {}).get("details") or err.get("message") or resp.text[:200]
        log.warning("WhatsApp template send refused %s: %s", err.get("code"), reason)
        raise WhatsAppSendError(f"WhatsApp refused the message: {reason}", code=err.get("code"), reason=reason)
    return resp.json()
