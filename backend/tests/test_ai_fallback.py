"""E2E: AI endpoints on their deterministic fallback paths (no API keys set).

With OPENAI/ANTHROPIC keys unset the backend must still return usable 200s:
keyword categorization, heuristic insights; a receipt scan says reading is not set up (503).
"""

import io

from conftest import today_iso
from helpers import add_customer, add_ledger


def test_categorize_keyword_match(user, client):
    r = client.post("/api/v1/categorize", headers=user.headers, json={"text": "Petrol at HP pump"})
    assert r.status_code == 200
    assert r.json()["category"] == "Fuel"


def test_categorize_unknown_is_miscellaneous(user, client):
    r = client.post(
        "/api/v1/categorize", headers=user.headers, json={"text": "zzzz unclassifiable qqqq"}
    )
    assert r.json()["category"] == "Miscellaneous"


def test_receipt_scan_without_a_key_says_reading_is_not_set_up(user, client, monkeypatch):
    # Not an empty draft: the app showed that as "try a clearer photo" for every receipt.
    from app.config import settings

    monkeypatch.setattr(settings, "anthropic_api_key", "")  # a developer's backend/.env may have one
    fake = io.BytesIO(b"not-a-real-image")
    r = client.post(
        "/api/v1/receipts/scan",
        headers=user.headers,
        files={"receipt": ("receipt.jpg", fake, "image/jpeg")},
    )
    assert r.status_code == 503
    assert r.json()["code"] == "receipt_ai_setup"


def test_insights_returns_non_empty_list(user, client):
    c = add_customer(client, user.headers)
    add_ledger(client, user.headers, c["id"], type="credit", amount=5000,
               date=today_iso(), client_id="ai-1")
    r = client.get("/api/v1/khata/insights", headers=user.headers).json()
    assert isinstance(r["insights"], list)
    assert len(r["insights"]) >= 1
    assert "title" in r["insights"][0]
