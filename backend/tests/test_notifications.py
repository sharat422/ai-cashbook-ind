"""E2E: WhatsApp notification endpoint (disabled path) + recipient normalization.

The test env sets no WhatsApp credentials, so the endpoint must report the
channel as unconfigured (503) rather than attempting a real send — this is the
exact contract the app relies on to fall back to the in-app inbox.
"""

from app.notifications import normalize_recipient


def test_whatsapp_status_reports_unconfigured(user, client):
    r = client.get("/api/v1/notifications/whatsapp/status", headers=user.headers)
    assert r.status_code == 200
    assert r.json() == {"configured": False}


def test_whatsapp_send_returns_503_when_unconfigured(user, client):
    r = client.post(
        "/api/v1/notifications/whatsapp",
        headers=user.headers,
        json={"to": "9999999999", "message": "hi"},
    )
    assert r.status_code == 503


def test_whatsapp_endpoint_requires_auth(client):
    r = client.post(
        "/api/v1/notifications/whatsapp",
        json={"to": "9999999999", "message": "hi"},
    )
    assert r.status_code in (401, 403)


def test_recipient_normalization():
    # Bare 10-digit gets the default country code (91) prepended.
    assert normalize_recipient("9876543210") == "919876543210"
    # Already-qualified numbers pass through (digits only).
    assert normalize_recipient("+91 98765 43210") == "919876543210"
    assert normalize_recipient("919876543210") == "919876543210"
