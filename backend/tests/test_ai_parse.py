"""E2E: AI voice/text transaction parsing (heuristic fallback — no API key)."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.ai import _heuristic_amount, _heuristic_parse, parse_transaction
from app.config import settings

# MANUAL_TESTING.md §17.1–17.4: (sentence, customer, type, amount, category)
TEST_PLAN_SENTENCES = [
    ("Ramesh ko 2500 ka maal diya", "Ramesh", "credit", 2500.0, "Sale"),
    ("Suresh se teen hazaar mile", "Suresh", "payment", 3000.0, "Payment"),
    ("gave ramesh 500 for groceries", "Ramesh", "credit", 500.0, "Groceries"),
    ("ramesh paid 2000", "Ramesh", "payment", 2000.0, "Payment"),
]


@pytest.mark.parametrize("text,name,kind,amount,category", TEST_PLAN_SENTENCES)
def test_test_plan_sentences_offline(user, client, text, name, kind, amount, category):
    r = client.post("/api/v1/parse-transaction", headers=user.headers,
                    json={"text": text}).json()
    assert (r["customer_name"], r["type"], r["amount"], r["category"]) == (
        name, kind, amount, category)


@pytest.mark.parametrize("text,kind", [
    ("give mohan 250 for rice", "credit"),
    ("sold to anil on credit 750", "credit"),
    ("anil owes 700", "credit"),
    ("received 900 from suresh", "payment"),
    ("got 400 from suresh", "payment"),
    ("suresh pays 300", "payment"),
])
def test_english_direction_rules(text, kind):
    assert _heuristic_parse(text, "2026-01-01")["type"] == kind


def test_ai_prompt_has_rules_and_for_item_wins(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    client = MagicMock()
    # A model that still returns the generic label gets the "for X" item word.
    reply = {"customer_name": "Ramesh", "type": "credit", "amount": 500, "category": "Sale"}
    client.chat.completions.create.return_value = SimpleNamespace(choices=[
        SimpleNamespace(message=SimpleNamespace(content=json.dumps(reply)))])
    with patch("openai.OpenAI", return_value=client):
        out = parse_transaction("gave ramesh 500 for groceries", "2026-01-01")
    assert out["category"] == "Groceries" and out["source"] == "ai"
    prompt = client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
    assert "'gave X <amount>' is ALWAYS credit" in prompt
    assert '"gave ramesh 500 for groceries" -> {"customer_name": "Ramesh", ' \
           '"type": "credit"' in prompt


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
