"""TE6: Ask AI answers in the user's own app language, Hinglish included.
Hinglish = everyday Hindi in Roman letters (never Devanagari). The language
comes with each question from that user's app, so it is per user, not per
business. What the assistant can do, and its safety rules, are unchanged.

(The model is a scripted fake, as in test_chatbot_ask: these tests check what
the server tells the model, what it verifies, and its own fixed replies.)"""

import json
import re
from pathlib import Path

from app.chatbot.guardrails import _RULES
from app.chatbot.loop import MESSAGES
from conftest import _login
from test_chatbot_ask import _ask, _resp, _tool_call, _tool_results, llm, merchant  # noqa: F401

ROOT = Path(__file__).resolve().parents[2]
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
MONEY = re.compile(r"₹[\d,]+\.\d\d")
HINGLISH_HINT = "User's language hint: Hinglish: everyday Hindi written in Roman (Latin) letters"


def _model(language_said: dict):
    """A fake model that answers in the language the server asked for, from the real tool results."""
    def answer(messages):
        asked = " ".join(m["content"] for m in messages if m["role"] == "system")
        top = _tool_results(messages)[0]["defaulters"]
        if "language hint: Hinglish" in asked or "final answer in Hinglish" in asked:
            language_said["lang"] = "hinglish"
            lines = "; ".join(f"{d['name']} ₹{d['balance']:,.2f} ({d['days_owing']} din se)" for d in top)
            return _resp(f"Sabse zyada baaki: {lines}.")
        language_said["lang"] = "en"
        lines = "; ".join(f"{d['name']} ₹{d['balance']:,.2f} ({d['days_owing']} days)" for d in top)
        return _resp(f"Most owed: {lines}.")
    return answer


def test_a_hinglish_users_question_is_answered_in_hinglish_with_the_same_figures(merchant, client, llm):
    user, _, _ = merchant
    answers = {}
    for lang in ("en", "hinglish"):
        said = {}
        fake = llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {"limit": 5})]), _model(said))
        # A voice question often comes out of the transcriber in English: the user's language decides.
        body = _ask(client, user, "who owes me most?", language_hint=lang).json()
        assert body["verified"] is True and said["lang"] == lang, body
        answers[lang] = body["answer_text"]
    prompt = fake.calls[0]["messages"][0]["content"]
    assert HINGLISH_HINT in prompt and "Never Devanagari" in prompt
    # Restated right before the final answer (tool results in English pull the model to English).
    assert fake.calls[1]["messages"][-1]["content"].startswith("Write the final answer in Hinglish:")
    hinglish = answers["hinglish"]
    assert "din se" in hinglish and not DEVANAGARI.search(hinglish)   # Hinglish, Roman script
    assert MONEY.findall(hinglish) == MONEY.findall(answers["en"]) == ["₹3,500.00", "₹800.20"]


def test_two_users_on_one_business_get_answers_in_their_own_languages(merchant, client, llm):
    owner, _, _ = merchant
    mobile = "6" + str(abs(hash((owner.mobile, "te6"))) % 10**9).zfill(9)
    r = client.post("/api/v1/team", headers=owner.headers, json={"mobile": mobile, "role": "accountant"})
    assert r.status_code == 200, r.text
    accountant = type("U", (), {"headers": _login(client, mobile)})()
    assert client.put("/api/v1/consents", headers=accountant.headers,
                      json={"choices": [{"purpose": "ai", "granted": True}]}).status_code == 200
    seen = {}
    for who, lang in ((owner, "te"), (accountant, "hinglish")):
        fake = llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {"limit": 5})]), _model({}))
        assert _ask(client, who, "who owes me most?", language_hint=lang).status_code == 200
        seen[lang] = fake.calls[0]["messages"][0]["content"]
        # The same business: the same figures reach the model for both.
        assert _tool_results(fake.calls[1]["messages"])[0]["defaulters"][0]["balance"] == 3500.0
    assert "User's language hint: Telugu (Telugu script)" in seen["te"]
    assert HINGLISH_HINT in seen["hinglish"]
    # Fixed replies too: each gets their own language from the same business.
    llm()
    te = _ask(client, owner, "delete all my entries", language_hint="te").json()["answer_text"]
    hi = _ask(client, accountant, "delete all my entries", language_hint="hinglish").json()["answer_text"]
    assert te == _RULES["delete_data"]["reply"]["te"] and hi == _RULES["delete_data"]["reply"]["hinglish"]


def test_every_fixed_reply_has_real_hinglish_in_roman_script():
    for key, replies in MESSAGES.items():
        if not key.startswith("_"):
            h = replies["hinglish"]
            assert not DEVANAGARI.search(h) and h != replies["en"], key  # Hinglish, not English
            assert sorted(re.findall(r"\{[^}]+\}", h)) == sorted(re.findall(r"\{[^}]+\}", replies["en"])), key
    for category, rule in _RULES.items():
        if not category.startswith("_"):
            assert not DEVANAGARI.search(rule["reply"]["hinglish"]), category


def test_the_two_server_replies_from_the_translation_tool_match_the_reviewed_app_strings():
    """'Couldn't verify' and 'unavailable' had English as their Hinglish. Their
    Hinglish now comes from the translation tool via src/i18n (chatbot.*), so it's on
    the review sheet; a reviewer's correction must be copied here too."""
    locale = json.loads((ROOT / "src/i18n/locales/hinglish.json").read_text(encoding="utf-8"))
    en = json.loads((ROOT / "src/i18n/locales/en.json").read_text(encoding="utf-8"))
    for key in ("unverified", "unavailable"):
        assert MESSAGES[key]["en"] == en[f"chatbot.{key}"], key
        assert MESSAGES[key]["hinglish"] == locale[f"chatbot.{key}"], key
