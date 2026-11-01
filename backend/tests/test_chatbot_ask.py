"""POST /api/v1/chatbot/ask: two-call tool loop, server-side guards, logging.

OpenAI is replaced by a scripted fake. "Faithful" scripts build their answer
from the tool results the server actually sends, so these tests prove the real
database numbers flow through; "lying" scripts prove the guards reject
invented numbers. All data is labelled TEST data."""

import json
import logging
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_ledger
from app.chatbot.loop import MESSAGES, TOOL_DEFINITIONS, numbers_in_results, numbers_in_text
from app.chatbot.tools import TOOLS
from app.config import settings
from app.crypto import decrypt
from app.database import SessionLocal
from app.models import AiDecision, User

URL = "/api/v1/chatbot/ask"
UNVERIFIED = MESSAGES["unverified"]


# --- Fake OpenAI --------------------------------------------------------------

def _resp(content=None, tool_calls=None):
    msg = SimpleNamespace(content=content, tool_calls=tool_calls)
    usage = SimpleNamespace(prompt_tokens=100, completion_tokens=20, total_tokens=120)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=usage)


def _tool_call(name, args, call_id="call_1"):
    return SimpleNamespace(id=call_id, function=SimpleNamespace(name=name, arguments=json.dumps(args)))


class FakeLLM:
    """Plays scripted turns. A turn is a response, or a function of the
    messages the server sent (to answer from real tool results)."""

    def __init__(self, *turns):
        self.turns = list(turns)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        turn = self.turns.pop(0)
        return turn(kwargs["messages"]) if callable(turn) else turn


def _tool_results(messages):
    return [json.loads(m["content"]) for m in messages if m["role"] == "tool"]


@pytest.fixture
def llm(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    holder = {}

    def install(*turns):
        holder["fake"] = FakeLLM(*turns)
        return holder["fake"]

    with patch("openai.OpenAI", side_effect=lambda **_: holder["fake"]):
        yield install


@pytest.fixture
def merchant(user, client):
    """TEST merchant: Ramesh owes 3500 (since 10 days), Ramesh Traders 800.20."""
    h = user.headers
    ramesh = add_customer(client, h, full_name="TEST Ramesh", mobile="9876543210")
    traders = add_customer(client, h, full_name="TEST Ramesh Traders")
    add_ledger(client, h, ramesh["id"], type="credit", amount=3500, date=days_ago_iso(10), client_id="a-c1")
    add_ledger(client, h, traders["id"], type="credit", amount=800.2, date=today_iso(), client_id="a-c2")
    return user, ramesh, traders


def _ask(client, user, text, **extra):
    return client.post(URL, headers=user.headers, json={"transcript_text": text, **extra})


# --- Acceptance: who owes me most --------------------------------------------

def test_who_owes_most_returns_real_top_defaulters(merchant, client, llm):
    user, ramesh, traders = merchant

    def faithful(messages):
        top = _tool_results(messages)[0]["defaulters"]
        lines = "; ".join(f"{d['name']} ₹{d['balance']:,.2f} ({d['days_owing']} din se)" for d in top)
        return _resp(f"Sabse zyada: {lines}.")

    fake = llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {"limit": 5})]), faithful)
    r = _ask(client, user, "who owes me most?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body.pop("question_id"), str)
    assert body == {
        "answer_text": "Sabse zyada: TEST Ramesh ₹3,500.00 (10 din se); TEST Ramesh Traders ₹800.20 (0 din se).",
        "tools_used": ["get_top_defaulters"],
        "data_source": "database",
        "verified": True,
        "blocked": None,
        "candidates": [],
        "sources": [],
        "suggested_screen": None,
        # Date range and "View details" come from the tool result, not the model.
        "period": {"as_of": today_iso()},
        "view_details": {"screen": "KhataDashboard"},
    }
    # Exactly two LLM calls; the second can't call tools; tokens capped.
    assert len(fake.calls) == 2
    assert [c["tool_choice"] for c in fake.calls] == ["auto", "none"]
    assert all(c["max_tokens"] == settings.chatbot_max_tokens == 300 for c in fake.calls)
    assert all(c["model"] == settings.chatbot_model for c in fake.calls)


# --- Acceptance: non-existent customer ---------------------------------------

def test_unknown_customer_says_so(merchant, client, llm):
    user, _, _ = merchant

    def faithful(messages):
        assert _tool_results(messages)[0] == {"status": "not_found", "customer": None}
        return _resp("Mujhe Mahesh naam ka customer nahi dikh raha.")

    llm(_resp(tool_calls=[_tool_call("get_customer_balance", {"customer_name": "Mahesh"})]), faithful)
    body = _ask(client, user, "Mahesh ka balance kitna hai?").json()
    assert body["answer_text"] == "Mujhe Mahesh naam ka customer nahi dikh raha."
    assert body["verified"] is True


def test_made_up_balance_for_unknown_customer_is_rejected(merchant, client, llm):
    user, _, _ = merchant
    llm(_resp(tool_calls=[_tool_call("get_customer_balance", {"customer_name": "Mahesh"})]),
        _resp("Mahesh owes you ₹1,200."))
    body = _ask(client, user, "How much does Mahesh owe?").json()
    assert body["answer_text"] == UNVERIFIED and body["verified"] is False


# --- Guards -------------------------------------------------------------------

def test_number_without_tool_call_is_rejected(merchant, client, llm):
    user, _, _ = merchant
    fake = llm(_resp("Your total outstanding is ₹4,300."))
    body = _ask(client, user, "total outstanding kitna hai?").json()
    assert isinstance(body.pop("question_id"), str)
    assert body == {"answer_text": UNVERIFIED, "tools_used": [], "data_source": "none",
                    "verified": False, "blocked": None, "candidates": [], "sources": [],
                    "suggested_screen": None, "period": None, "view_details": None}
    assert len(fake.calls) == 1


def test_reply_without_tools_becomes_fixed_scope_message(merchant, client, llm):
    # Nothing un-backed reaches the user: not a greeting, not an invented feature.
    user, _, _ = merchant
    llm(_resp("Haan, Bolcash aapke liye GST return file karta hai."))
    body = _ask(client, user, "hello").json()
    assert body["answer_text"] == MESSAGES["out_of_scope"]["hinglish"]
    assert body["verified"] is True and body["data_source"] == "none"
    llm(_resp("I can help with your account."))
    body = _ask(client, user, "hello", language_hint="en").json()
    assert body["answer_text"] == MESSAGES["out_of_scope"]["en"]


def test_altered_amount_after_tool_call_is_rejected(merchant, client, llm):
    user, _, _ = merchant
    llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {})]),
        _resp("TEST Ramesh owes ₹3,600."))  # real figure is 3500
    assert _ask(client, user, "who owes most").json()["answer_text"] == UNVERIFIED


# --- Ambiguous names -> candidates, then the picked id -----------------------

def test_ambiguous_name_returns_candidates_then_selected_id_resolves(merchant, client, llm):
    user, ramesh, traders = merchant
    llm(_resp(tool_calls=[_tool_call("get_customer_balance", {"customer_name": "ramesh"})]),
        _resp("Kaun sa Ramesh? TEST Ramesh ya TEST Ramesh Traders?"))
    body = _ask(client, user, "ramesh ka balance").json()
    assert {c["customer_id"] for c in body["candidates"]} == {ramesh["id"], traders["id"]}
    assert all(c["mobile_masked"].startswith("***") and len(c["mobile_masked"]) == 7 for c in body["candidates"])

    def faithful(messages):
        assert f"Selected customer_id: {traders['id']}" in messages[1]["content"]
        c = _tool_results(messages)[0]["customer"]
        return _resp(f"{c['name']} ka balance ₹{c['balance']:,.2f} hai.")

    llm(_resp(tool_calls=[_tool_call("get_customer_balance", {"customer_id": traders["id"]})]), faithful)
    body = _ask(client, user, "ramesh ka balance", selected_customer_id=traders["id"]).json()
    assert body["answer_text"] == "TEST Ramesh Traders ka balance ₹800.20 hai."


def test_selected_customer_of_another_merchant_is_not_found(merchant, client, llm, make_user):
    _, ramesh, _ = merchant
    other = make_user(ai_consent=True)
    seen = {}

    def faithful(messages):
        seen["result"] = _tool_results(messages)[0]
        return _resp("Mujhe yeh customer nahi dikh raha.")

    llm(_resp(tool_calls=[_tool_call("get_customer_balance", {"customer_id": ramesh["id"]})]), faithful)
    body = _ask(client, other, "balance batao", selected_customer_id=ramesh["id"]).json()
    assert seen["result"] == {"status": "not_found", "customer": None}
    assert "3500" not in json.dumps(body) and "3,500" not in json.dumps(body)


# --- Merchant scoping, auth, availability ------------------------------------

def test_client_cannot_send_merchant_id(merchant, client, llm):
    user, _, _ = merchant
    llm()
    r = _ask(client, user, "who owes me", merchant_id="someone-else")
    assert r.status_code == 422


def test_tools_run_for_the_authenticated_merchant_only(merchant, client, llm, make_user):
    other = make_user(ai_consent=True)
    seen = {}

    def faithful(messages):
        seen["result"] = _tool_results(messages)[0]
        return _resp("Abhi koi customer udhaar mein nahi hai.")

    # The model even tries to pass a merchant_id argument; it's ignored.
    llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {"merchant_id": merchant[0].business["id"]})]),
        faithful)
    _ask(client, other, "who owes me most")
    assert seen["result"]["defaulters"] == []


def test_requires_view_permission_and_ai_consent(merchant, client, make_user):
    no_consent = make_user(ai_consent=False)
    assert client.post(URL, headers=no_consent.headers, json={"transcript_text": "hi"}).status_code == 403
    assert client.post(URL, json={"transcript_text": "hi"}).status_code in (401, 403)


def test_unavailable_without_key_or_on_provider_error(merchant, client, monkeypatch, llm):
    user, _, _ = merchant
    monkeypatch.setattr(settings, "openai_api_key", "")
    r = _ask(client, user, "who owes me")
    assert r.status_code == 503 and r.json()["detail"] == MESSAGES["unavailable"]

    monkeypatch.setattr(settings, "openai_api_key", "test-key")

    def boom(messages):
        raise TimeoutError("provider down")

    llm(boom)
    assert _ask(client, user, "who owes me").status_code == 503


# --- Logging ------------------------------------------------------------------

def _set_history_consent(client, user, granted: bool):
    r = client.put("/api/v1/consents", headers=user.headers,
                   json={"choices": [{"purpose": "ai_history", "granted": granted}]})
    assert r.status_code == 200, r.text


def _last_chat_row(user):
    with SessionLocal() as s:
        return s.query(AiDecision).filter_by(business_id=user.business["id"], kind="chatbot").all()[-1]


def test_without_history_consent_only_metadata_is_stored(merchant, client, llm):
    user, _, _ = merchant
    llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {})]), _resp("Kisi ka nahi."))
    _ask(client, user, "TEST Ramesh kitna deta hai?", input_mode="voice")
    row = _last_chat_row(user)
    meta = json.loads(row.output_json)
    assert row.input_text is None and "answer_enc" not in meta
    assert meta["text_stored"] is False and meta["input_mode"] == "voice"
    with SessionLocal() as s:
        assert meta["user_id"] == s.query(User).filter_by(mobile=user.mobile).one().id
    assert meta["tools_used"] == ["get_top_defaulters"]


def test_delete_history_removes_text_keeps_metadata(merchant, client, llm, make_user):
    user, _, _ = merchant
    _set_history_consent(client, user, True)
    llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {})]), _resp("Kisi ka nahi."))
    _ask(client, user, "TEST Ramesh kitna deta hai?")
    assert _last_chat_row(user).input_text is not None

    r = client.delete("/api/v1/chatbot/history", headers=user.headers)
    assert r.status_code == 200 and r.json() == {"deleted": 1}
    row = _last_chat_row(user)
    meta = json.loads(row.output_json)
    assert row.input_text is None and "answer_enc" not in meta and meta["text_stored"] is False
    assert meta["tools_used"] == ["get_top_defaulters"]  # usage metadata kept
    # Deleting again is a no-op; another merchant's delete touches nothing here.
    assert client.delete("/api/v1/chatbot/history", headers=user.headers).json() == {"deleted": 0}


def test_question_and_answer_logged_encrypted_metadata_in_app_log(merchant, client, llm, caplog):
    user, ramesh, traders = merchant
    _set_history_consent(client, user, True)
    llm(_resp(tool_calls=[_tool_call("get_customer_balance", {"customer_name": "ramesh"})]),
        _resp("Kaun sa Ramesh?"))
    with caplog.at_level(logging.INFO, logger="cashbook.chatbot"):
        _ask(client, user, "TEST Ramesh ka hisaab")
    meta = [json.loads(r.getMessage()) for r in caplog.records if r.name == "cashbook.chatbot"][-1]
    assert meta["tools_used"] == ["get_customer_balance"] and meta["llm_calls"] == 2
    assert set(meta["result_customer_ids"]) == {ramesh["id"], traders["id"]}
    assert meta["tokens"]["total_tokens"] == 240 and meta["latency_ms"] >= 0
    assert "Ramesh" not in caplog.text  # no question/answer/name text in app logs

    with SessionLocal() as s:
        row = s.query(AiDecision).filter_by(business_id=user.business["id"], kind="chatbot").all()[-1]
    stored = json.loads(row.output_json)
    assert "Ramesh" not in row.input_text and "Ramesh" not in row.output_json  # encrypted at rest
    assert decrypt(row.input_text) == "TEST Ramesh ka hisaab"
    assert decrypt(stored["answer_enc"]) == "Kaun sa Ramesh?"


# --- Files and helpers --------------------------------------------------------

def test_tool_definitions_file_matches_tools():
    names = [t["function"]["name"] for t in TOOL_DEFINITIONS]
    assert sorted(names) == sorted(TOOLS)
    for t in TOOL_DEFINITIONS:  # the model is never offered a merchant_id argument
        assert "merchant_id" not in t["function"]["parameters"].get("properties", {})


def test_number_extraction():
    # An answer's numbers must be a subset of what the tools returned.
    assert numbers_in_text("₹1,99,999.50 on 2 Sep 2026") <= numbers_in_results([199999.5, "2026-09-02"])
    assert numbers_in_text("₹1,200") - numbers_in_results([1199.99]) == numbers_in_text("1200")
    assert numbers_in_results({"customer_id": "a1b2c3", "mobile_masked": "***3210"}) == numbers_in_text("3210")
