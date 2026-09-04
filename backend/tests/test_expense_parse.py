"""Voice/text EXPENSE extraction engine (separate from the khata parser).

Covers parse_expense's contract — flag uncertainty instead of guessing, coerce
categories to the app's set, degrade to a heuristic without a key — and the two
endpoints that expose it.
"""

import openai
import pytest

import app.ai as ai
import app.routers.ai_routes as ai_routes


# --- parse_expense (the engine) --------------------------------------------

def test_parse_expense_heuristic_without_key(monkeypatch):
    monkeypatch.setattr(ai.settings, "openai_api_key", "")
    r = ai.parse_expense("petrol 500 rupees", "2026-09-04")
    assert r["amount"] == 500
    assert r["category"] == "Fuel"          # petrol → Fuel (app category)
    assert r["currency"] == "INR"
    assert r["confidence"] == "low"
    assert r["needs_confirmation"] is True
    assert "currency" in r["ambiguous_fields"]  # inferred, so flagged
    assert r["source"] == "rule"


def test_parse_expense_empty_is_flagged(monkeypatch):
    monkeypatch.setattr(ai.settings, "openai_api_key", "")
    r = ai.parse_expense("   ", "2026-09-04")
    assert r["amount"] is None and r["category"] is None
    assert r["needs_confirmation"] is True


def _mock_openai(monkeypatch, payload: dict):
    import json as _json

    class FakeResp:
        class choices:  # noqa: N801
            pass

    resp = type("R", (), {})()
    msg = type("M", (), {"content": _json.dumps(payload)})()
    choice = type("C", (), {"message": msg})()
    resp.choices = [choice]

    class FakeCompletions:
        def create(self, **_):
            return resp

    class FakeClient:
        def __init__(self, **_):
            self.chat = type("Ch", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(ai.settings, "openai_api_key", "test-key")
    monkeypatch.setattr(openai, "OpenAI", FakeClient)


def test_parse_expense_normalizes_model_output(monkeypatch):
    _mock_openai(monkeypatch, {
        "detected_language": "hi",
        "amount": 250,
        "currency": "INR",
        "category": "Food",
        "vendor": "Cafe Coffee Day",
        "date": "2026-09-03",
        "note": "Coffee",
        "confidence": "high",
        "needs_confirmation": False,
        "ambiguous_fields": [],
    })
    r = ai.parse_expense("do sau pachas cafe me", "2026-09-04")
    assert r["amount"] == 250 and r["category"] == "Food"
    assert r["vendor"] == "Cafe Coffee Day"
    assert r["detected_language"] == "hi"
    assert r["confidence"] == "high"
    assert r["needs_confirmation"] is False
    assert r["source"] == "ai"


def test_parse_expense_flags_out_of_set_category(monkeypatch):
    # A category the model invents outside our fixed set is dropped + flagged.
    _mock_openai(monkeypatch, {
        "amount": 100, "category": "gambling", "confidence": "medium",
        "ambiguous_fields": [],
    })
    r = ai.parse_expense("spent 100", "2026-09-04")
    assert r["category"] is None
    assert "category" in r["ambiguous_fields"]
    assert r["needs_confirmation"] is True  # any flag forces confirmation


def test_parse_expense_maps_alias_category(monkeypatch):
    _mock_openai(monkeypatch, {"amount": 300, "category": "groceries", "confidence": "high"})
    assert ai.parse_expense("groceries 300", "2026-09-04")["category"] == "Food"


def test_parse_expense_rejects_non_positive_amount(monkeypatch):
    _mock_openai(monkeypatch, {"amount": -5, "category": "Food", "confidence": "high"})
    r = ai.parse_expense("weird", "2026-09-04")
    assert r["amount"] is None
    assert r["needs_confirmation"] is True


# --- endpoints --------------------------------------------------------------

def test_parse_expense_route(user, client, monkeypatch):
    monkeypatch.setattr(ai_routes, "parse_expense", lambda *a, **k: {
        "amount": 500, "category": "Fuel", "confidence": "low",
        "needs_confirmation": True, "ambiguous_fields": ["currency"],
    })
    r = client.post(
        "/api/v1/parse-expense",
        headers=user.headers,
        json={"text": "petrol 500", "today": "2026-09-04"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["category"] == "Fuel"


def test_voice_parse_expense_transcribes_then_parses(user, client, monkeypatch):
    monkeypatch.setattr(ai_routes, "_transcribe_or_raise", lambda *a, **k: "petrol 500 rupees")
    monkeypatch.setattr(ai_routes, "parse_expense", lambda text, day, language=None: {
        "amount": 500, "category": "Fuel", "raw_transcript": text,
        "confidence": "low", "needs_confirmation": True, "ambiguous_fields": [],
    })
    r = client.post(
        "/api/v1/voice/parse-expense",
        headers=user.headers,
        files={"audio": ("clip.m4a", b"fake", "audio/m4a")},
        data={"today": "2026-09-04"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["raw_transcript"] == "petrol 500 rupees"


def test_voice_parse_expense_requires_auth(client):
    r = client.post(
        "/api/v1/voice/parse-expense",
        files={"audio": ("c.m4a", b"x", "audio/m4a")},
    )
    assert r.status_code in (401, 403)
