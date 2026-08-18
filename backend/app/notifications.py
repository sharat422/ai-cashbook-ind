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

import httpx

from .config import settings

log = logging.getLogger("cashbook.notifications")


class WhatsAppNotConfigured(RuntimeError):
    """Raised when WhatsApp credentials are absent."""


class WhatsAppSendError(RuntimeError):
    """Raised when the WhatsApp Cloud API rejects the send."""


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
