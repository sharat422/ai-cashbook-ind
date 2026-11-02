"""Telugu, Tamil and Malayalam: every fixed server reply comes back in the
user's language, and the model is told which language to answer in."""

import json
import re

import pytest

from app.chatbot.guardrails import _RULES
from app.chatbot.loop import MESSAGES, message
from app.config import settings
from test_chatbot_ask import _ask, _resp, _tool_call, llm, merchant  # noqa: F401
from test_voice_live import hello, muse, _usage_rows  # noqa: F401

SCRIPTS = {"te": r"[ఀ-౿]", "ta": r"[஀-௿]", "ml": r"[ഀ-ൿ]"}
LANGS = list(SCRIPTS)


def test_every_fixed_reply_exists_in_each_language_and_script():
    for key, replies in MESSAGES.items():
        if key.startswith("_"):
            continue
        for lang, script in SCRIPTS.items():
            assert re.search(script, replies[lang]), (key, lang)
            # Only this language's script (no stray letters from other Indian scripts).
            rest = re.sub(script, "", replies[lang])
            assert not re.search(r"[ऀ-෿]", rest), (key, lang)
            assert sorted(re.findall(r"\{[^}]+\}", replies[lang])) == sorted(re.findall(r"\{[^}]+\}", replies["en"]))
    for category, rule in _RULES.items():
        if not category.startswith("_"):
            for lang, script in SCRIPTS.items():
                assert re.search(script, rule["reply"][lang]), (category, lang)


@pytest.mark.parametrize("lang", LANGS)
def test_refusal_comes_back_in_the_users_language(merchant, client, llm, lang):
    user, _, _ = merchant
    llm()
    body = _ask(client, user, "delete all my entries", language_hint=lang).json()
    assert body["blocked"] == "delete_data"
    assert body["answer_text"] == _RULES["delete_data"]["reply"][lang]


@pytest.mark.parametrize("lang", LANGS)
def test_not_in_guide_and_unverified_in_the_users_language(merchant, client, llm, lang):
    user, _, _ = merchant
    llm(_resp(tool_calls=[_tool_call("search_help_docs", {"query": "credit card"})]), _resp("NOT_IN_HELP_GUIDE"))
    assert _ask(client, user, "credit card?", language_hint=lang).json()["answer_text"] == MESSAGES["not_in_help"][lang]
    llm(_resp("Total ₹9,999 hai."))
    assert _ask(client, user, "total?", language_hint=lang).json()["answer_text"] == MESSAGES["unverified"][lang]


def test_model_is_told_the_language(merchant, client, llm):
    user, _, _ = merchant
    fake = llm(_resp(tool_calls=[_tool_call("get_business_summary", {})]), _resp("సరే."))
    _ask(client, user, "నా మొత్తం బాకీ ఎంత?", language_hint="te")
    assert "User's language hint: Telugu (Telugu script)" in fake.calls[0]["messages"][0]["content"]


@pytest.mark.parametrize("lang", LANGS)
def test_hourly_limit_and_unavailable_messages_localised(merchant, client, llm, monkeypatch, lang):
    user, _, _ = merchant
    monkeypatch.setattr(settings, "openai_api_key", "")
    r = _ask(client, user, "total?", language_hint=lang)
    assert r.status_code == 503 and r.json()["detail"] == MESSAGES["unavailable"][lang]
    monkeypatch.setattr(settings, "chatbot_questions_per_hour", 0)
    r = _ask(client, user, "total?", language_hint=lang)
    assert r.status_code == 429 and r.json()["detail"] == message("limit_questions", lang).format(limit=0)


def test_voice_limit_message_uses_the_voice_language(client, user, muse, monkeypatch):
    monkeypatch.setattr(settings, "chatbot_voice_seconds_per_day", 0)
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(user, purpose="chatbot", language="ta"))
        err = ws.receive_json()
    assert err["status"] == 429 and re.search(SCRIPTS["ta"], err["message"])


def test_unknown_language_hint_is_rejected(merchant, client, llm):
    user, _, _ = merchant
    llm()
    assert _ask(client, user, "hi", language_hint="kn").status_code == 422


def test_language_is_restated_before_the_answer_is_written(merchant, client, llm):
    user, _, _ = merchant
    fake = llm(_resp(tool_calls=[_tool_call("get_business_summary", {})]), _resp("సరే."))
    _ask(client, user, "రమేష్ బ్యాలెన్స్?", language_hint="te")
    last = fake.calls[1]["messages"][-1]
    assert last == {"role": "system", "content": "Write the final answer in Telugu (Telugu script)."}
    # Hinglish (the default) gets no extra instruction.
    fake = llm(_resp(tool_calls=[_tool_call("get_business_summary", {})]), _resp("Theek hai."))
    _ask(client, user, "total?", language_hint="hinglish")
    assert fake.calls[1]["messages"][-1]["role"] == "tool"


@pytest.mark.parametrize("hint,question,regional", [
    ("te", "total?", True),
    ("ta", "total?", True),
    ("ml", "total?", True),
    (None, "నా మొత్తం బాకీ ఎంత?", True),      # Telugu typed with no hint
    (None, "என் மொத்த நிலுவை?", True),        # Tamil
    (None, "എന്റെ ആകെ കുടിശ്ശിക?", True),     # Malayalam
    ("hinglish", "Ramesh ka balance", False),
    ("hi", "रमेश का बैलेंस", False),
    ("en", "who owes me most", False),
])
def test_regional_languages_use_the_stronger_model(merchant, client, llm, hint, question, regional):
    user, _, _ = merchant
    fake = llm(_resp(tool_calls=[_tool_call("get_business_summary", {})]), _resp("ok"))
    extra = {"language_hint": hint} if hint else {}
    _ask(client, user, question, **extra)
    want = settings.chatbot_model_regional if regional else settings.chatbot_model
    assert [c["model"] for c in fake.calls] == [want, want]
