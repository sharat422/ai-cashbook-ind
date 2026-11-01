"""Phase 3: app Q&A only from the help guide (app/chatbot/help_docs).

Reuses the scripted OpenAI fake from test_chatbot_ask. "Faithful" scripts
answer from the doc text the server actually sends."""

import json
import re
from pathlib import Path

import pytest

from app.chatbot.help_search import DOCS, MAX_RESULTS, search
from app.chatbot.loop import MESSAGES
from test_chatbot_ask import _ask, _resp, _tool_call, _tool_results, llm, merchant  # noqa: F401

REPO = Path(__file__).resolve().parents[2]
EXPECTED_DOCS = {
    "add-customer.md", "add-entry.md", "send-reminder.md", "export-excel-pdf.md",
    "add-staff.md", "change-language.md", "backup.md", "delete-entry.md",
}


# --- The help guide itself ----------------------------------------------------

def test_all_eight_docs_exist_with_steps_and_limits():
    assert {d.source for d in DOCS} == EXPECTED_DOCS
    for d in DOCS:
        assert d.title and d.keywords and d.screen_label
        assert "**What it does:**" in d.body and "**Limits**" in d.body, d.source
        assert re.search(r"^1\. ", d.body, re.M), f"{d.source} has no numbered steps"


def test_every_doc_points_at_a_real_app_screen():
    navigator = (REPO / "src/navigation/AppNavigator.tsx").read_text(encoding="utf-8")
    routes = set(re.findall(r'name="(\w+)"', navigator))
    for d in DOCS:
        assert d.screen in routes, f"{d.source}: screen {d.screen!r} is not a navigation route"


@pytest.mark.parametrize("question,expected", [
    ("How do I send a reminder?", "send-reminder.md"),
    ("reminder kaise bheje", "send-reminder.md"),
    ("naya customer kaise add kare", "add-customer.md"),
    ("excel mein report kaise nikale", "export-excel-pdf.md"),
    ("staff ko access kaise de", "add-staff.md"),
    ("bhasha kaise badle", "change-language.md"),
    ("phone badla data kaise wapas aayega", "backup.md"),
    ("galat entry kaise hataye", "delete-entry.md"),
    ("udhaar kaise likhe", "add-entry.md"),
])
def test_search_finds_the_right_doc_first(question, expected):
    results = search(question)
    assert results and results[0]["source"] == expected
    assert len(results) <= MAX_RESULTS


@pytest.mark.parametrize("question", [
    "Does Bolcash do GST filing?",   # "GST" appears only in a doc body (GST number)
    "invoice kaise banaye",          # "invoice" appears only in a doc body
    "loan kaise milega",
    "what is the weather today",
    "",
])
def test_search_returns_nothing_for_topics_not_in_the_guide(question):
    assert search(question) == []


# --- Through the endpoint -----------------------------------------------------

def test_send_reminder_answer_comes_from_the_doc(merchant, client, llm):
    user, _, _ = merchant

    def faithful(messages):
        doc = _tool_results(messages)[0]["results"][0]
        assert doc["source"] == "send-reminder.md"
        steps = [line for line in doc["content"].splitlines() if re.match(r"^\d\. ", line)]
        return _resp("Reminder aise bhejiye:\n" + "\n".join(steps[:6])
                     + f"\nKya main {doc['screen_label']} screen khol doon?")

    fake = llm(_resp(tool_calls=[_tool_call("search_help_docs", {"query": "send reminder"})]), faithful)
    body = _ask(client, user, "How do I send a reminder?").json()
    assert "Tap **🔔 Reminder**." in body["answer_text"]
    assert "6. WhatsApp or your SMS app opens" in body["answer_text"]
    assert body["answer_text"].endswith("Kya main Customers screen khol doon?")
    assert body["sources"] == ["send-reminder.md"]
    assert body["data_source"] == "help_docs" and body["verified"] is True
    assert body["suggested_screen"] == {"screen": "Customers", "label": "Customers"}
    assert len(fake.calls) == 2


def test_gst_filing_is_not_in_the_help_guide(merchant, client, llm):
    user, _, _ = merchant
    fake = llm(_resp(tool_calls=[_tool_call("search_help_docs", {"query": "GST filing"})]))
    body = _ask(client, user, "Does Bolcash do GST filing?", language_hint="en").json()
    assert body["answer_text"] == MESSAGES["not_in_help"]["en"]
    assert body["sources"] == [] and body["suggested_screen"] is None
    assert body["data_source"] == "help_docs"
    assert len(fake.calls) == 1  # no second call, no chance to improvise


def test_invented_feature_without_tool_is_not_shown(merchant, client, llm):
    user, _, _ = merchant
    llm(_resp("Haan! Bolcash har mahine aapka GST return file karta hai."))
    body = _ask(client, user, "Does Bolcash do GST filing?").json()
    assert "GST return" not in body["answer_text"]
    assert body["answer_text"] == MESSAGES["out_of_scope"]["hinglish"]


def test_model_skipping_help_search_gets_the_docs_anyway(merchant, client, llm):
    user, _, _ = merchant
    seen = {}

    def faithful(messages):
        seen["sources"] = [d["source"] for d in _tool_results(messages)[0]["results"]]
        return _resp("Settings → Preferences → Content language. Kya main Settings screen khol doon?")

    # Call 1 answers from memory; the server runs the help search instead.
    fake = llm(_resp("Profile mein jaake Language badal lo."), faithful)
    body = _ask(client, user, "bhasha kaise badle").json()
    assert seen["sources"][0] == "change-language.md"
    assert "Profile" not in body["answer_text"]
    assert body["tools_used"] == ["search_help_docs"] and len(fake.calls) == 2


def test_next_step_appended_when_missing(merchant, client, llm):
    user, _, _ = merchant
    llm(_resp(tool_calls=[_tool_call("search_help_docs", {"query": "add customer"})]),
        _resp("Customers kholiye, + Add dabaiye, naam aur mobile bhariye."))
    body = _ask(client, user, "customer kaise add kare").json()
    assert body["answer_text"].endswith(MESSAGES["next_step"]["hinglish"].format(screen="Customers"))


def test_help_answer_with_number_not_in_doc_is_rejected(merchant, client, llm):
    user, _, _ = merchant
    llm(_resp(tool_calls=[_tool_call("search_help_docs", {"query": "add staff"})]),
        _resp("Aap 25 staff tak add kar sakte hain. Kya main Team & roles screen khol doon?"))
    body = _ask(client, user, "kitne staff add kar sakte hain").json()
    assert body["answer_text"] == MESSAGES["unverified"]


def test_help_search_is_audited_with_masked_query(merchant, client, llm, caplog):
    import logging

    user, _, _ = merchant
    llm(_resp(tool_calls=[_tool_call("search_help_docs", {"query": "send reminder"})]),
        _resp("Reminder bhejne ke steps... Kya main Customers screen khol doon?"))
    with caplog.at_level(logging.INFO, logger="cashbook.chatbot.audit"):
        _ask(client, user, "reminder kaise bheje")
    rec = [json.loads(r.getMessage()) for r in caplog.records if r.name == "cashbook.chatbot.audit"][-1]
    assert rec["tool"] == "search_help_docs" and rec["params"] == {"query": "s************"}
