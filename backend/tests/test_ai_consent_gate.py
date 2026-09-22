"""AI processing is gated on consent: without it, no user data is sent to any
AI provider. Pure-AI endpoints return 403; khata insights fall back to the
local heuristic (no external call) instead of failing."""

import io

from conftest import today_iso
from helpers import add_customer, add_ledger


def _grant_ai(client, headers, granted: bool) -> None:
    r = client.put(
        "/api/v1/consents",
        headers=headers,
        json={"choices": [{"purpose": "ai", "granted": granted}]},
    )
    assert r.status_code == 200, r.text


def test_ai_endpoints_are_blocked_without_ai_consent(make_user, client):
    # A fully onboarded user who did NOT opt in to AI.
    u = make_user(ai_consent=False)

    assert client.post(
        "/api/v1/parse-transaction", headers=u.headers, json={"text": "x"}
    ).status_code == 403
    assert client.post(
        "/api/v1/parse-expense", headers=u.headers, json={"text": "x"}
    ).status_code == 403
    assert client.post(
        "/api/v1/categorize", headers=u.headers, json={"text": "petrol"}
    ).status_code == 403
    assert client.post(
        "/api/v1/receipts/scan",
        headers=u.headers,
        files={"receipt": ("r.jpg", io.BytesIO(b"x"), "image/jpeg")},
    ).status_code == 403
    assert client.post(
        "/api/v1/assistant/ask", headers=u.headers, json={"question": "hi"}
    ).status_code == 403


def test_granting_ai_consent_unblocks_endpoints(make_user, client):
    u = make_user(ai_consent=False)
    assert client.post(
        "/api/v1/parse-transaction", headers=u.headers, json={"text": "gave ramesh 500"}
    ).status_code == 403

    _grant_ai(client, u.headers, True)
    # Now allowed (heuristic path since no API key is set in tests) → 200.
    assert client.post(
        "/api/v1/parse-transaction", headers=u.headers, json={"text": "gave ramesh 500"}
    ).status_code == 200

    # Withdrawing consent blocks it again.
    _grant_ai(client, u.headers, False)
    assert client.post(
        "/api/v1/parse-transaction", headers=u.headers, json={"text": "gave ramesh 500"}
    ).status_code == 403


def test_insights_degrade_to_heuristic_without_ai_consent(make_user, client):
    # Insights must keep working WITHOUT sending customer data to AI.
    u = make_user(ai_consent=False)
    c = add_customer(client, u.headers)
    add_ledger(client, u.headers, c["id"], type="credit", amount=5000,
               date=today_iso(), client_id="gate-1")
    r = client.get("/api/v1/khata/insights", headers=u.headers)
    assert r.status_code == 200
    assert isinstance(r.json()["insights"], list)
