"""E2E: AI endpoints on their deterministic fallback paths (no API keys set).

With OPENAI/ANTHROPIC keys unset the backend must still return usable 200s:
keyword categorization, heuristic insights, and an empty receipt draft.
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


def test_receipt_scan_returns_empty_draft(user, client):
    fake = io.BytesIO(b"not-a-real-image")
    r = client.post(
        "/api/v1/receipts/scan",
        headers=user.headers,
        files={"receipt": ("receipt.jpg", fake, "image/jpeg")},
    )
    assert r.status_code == 200
    draft = r.json()
    # Every field present, all values null on the fallback path.
    for field in ["vendor_name", "amount", "date", "category"]:
        assert field in draft
        assert draft[field]["value"] is None


def test_insights_returns_non_empty_list(user, client):
    c = add_customer(client, user.headers)
    add_ledger(client, user.headers, c["id"], type="credit", amount=5000,
               date=today_iso(), client_id="ai-1")
    r = client.get("/api/v1/khata/insights", headers=user.headers).json()
    assert isinstance(r["insights"], list)
    assert len(r["insights"]) >= 1
    assert "title" in r["insights"][0]
