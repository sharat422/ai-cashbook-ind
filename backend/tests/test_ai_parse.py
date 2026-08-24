"""E2E: AI voice/text transaction parsing (heuristic fallback — no API key)."""

from app.ai import _heuristic_amount, _heuristic_parse


def test_parse_credit_sentence(user, client):
    r = client.post(
        "/api/v1/parse-transaction",
        headers=user.headers,
        json={"text": "Ramesh ko 2500 ka maal diya", "today": "2026-06-17"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "credit"
    assert data["amount"] == 2500.0
    assert data["customer_name"] == "Ramesh"
    assert data["date"] == "2026-06-17"


def test_parse_payment_sentence(user, client):
    r = client.post(
        "/api/v1/parse-transaction",
        headers=user.headers,
        json={"text": "Suresh se teen hazaar mile"},
    ).json()
    assert r["type"] == "payment"
    assert r["amount"] == 3000.0
    assert r["customer_name"] == "Suresh"


def test_parse_requires_auth(client):
    assert client.post(
        "/api/v1/parse-transaction", json={"text": "x"}
    ).status_code in (401, 403)


def test_heuristic_amount_words():
    assert _heuristic_amount("do sau") == 200
    assert _heuristic_amount("ek lakh") == 100000
    assert _heuristic_amount("teen hazaar") == 3000
    assert _heuristic_amount("2,500 rupees") == 2500
    assert _heuristic_amount("no number here") is None


def test_heuristic_defaults_to_credit():
    out = _heuristic_parse("gave goods to Mohan", "2026-01-01")
    assert out["type"] == "credit"
    assert out["date"] == "2026-01-01"


def test_parse_english_gave(user, client):
    r = client.post(
        "/api/v1/parse-transaction",
        headers=user.headers,
        json={"text": "gave ramesh 500 for groceries", "today": "2026-06-17"},
    ).json()
    assert r["type"] == "credit"
    assert r["amount"] == 500.0
    assert r["customer_name"] == "Ramesh"  # lowercase name recovered + capitalized
    assert r["category"] == "Groceries"  # extracted from "for groceries"


def test_parse_english_paid(user, client):
    r = client.post(
        "/api/v1/parse-transaction",
        headers=user.headers,
        json={"text": "ramesh paid 2000"},
    ).json()
    assert r["type"] == "payment"
    assert r["amount"] == 2000.0
    assert r["customer_name"] == "Ramesh"
