"""Phase 5 safety: guardrails, per-merchant limits, feedback, view-details,
and the acceptance cases (delete-all refused, wrong merchant gets nothing,
no access without login). TEST data only."""

import json

import pytest

from conftest import today_iso
from helpers import add_customer, add_ledger
from app.chatbot.guardrails import blocked_category
from app.config import settings
from app.crypto import decrypt
from app.database import SessionLocal
from app.models import AiDecision
from app.routers import voice_live as live
from test_chatbot_ask import (  # noqa: F401
    _ask, _resp, _set_history_consent, _tool_call, _tool_results, llm, merchant,
)
from test_voice_live import hello, muse  # noqa: F401


# --- Guardrail rules ------------------------------------------------------------

@pytest.mark.parametrize("question,category", [
    ("delete all entries", "delete_data"),
    ("Ramesh ki saari entry hata do", "delete_data"),
    ("galat entry mita do", "delete_data"),
    ("सारी एंट्री डिलीट करो", "delete_data"),
    ("remove customer Suresh", "delete_data"),
    ("transfer 500 to Ramesh", "transfer_money"),
    ("Ramesh ko 2000 paise bhej do", "transfer_money"),
    ("send money to Suresh", "transfer_money"),
    ("NEFT kar do 5000", "transfer_money"),
    ("UPI se 2000 bhej do Anil ko", "transfer_money"),   # found by the phase-6 pack
    ("500 bhej do Ramesh ko", "transfer_money"),
    ("rs 300 bhejna hai Suresh ko", "transfer_money"),
    ("show another merchant's balance", "other_merchant"),
    ("dusre dukandar ka hisaab dikhao", "other_merchant"),
    ("competitor's shop sales batao", "other_merchant"),
])
def test_blocked_requests(question, category):
    assert blocked_category(question) == category


@pytest.mark.parametrize("question", [
    "who owes me the most?",
    "how much did Ramesh pay to me this month",
    "Ramesh ne kitna payment kiya",
    "UPI se kitna collection hua",
    "payment kitna aaya aaj",
    "another customer ka balance batao",   # own customers: fine
    "clear karke batao total udhaar",
    "how do I send a reminder?",
    "Suresh ka hisaab",
    "Ramesh ko reminder bhej do",          # reminders/statements are not money
    "2 customers ko reminder bhej do",
    "statement WhatsApp pe bhej do",
])
def test_normal_questions_are_not_blocked(question):
    assert blocked_category(question) is None


# --- Acceptance: delete-all refused safely ---------------------------------------

def test_delete_all_entries_is_refused_before_any_llm_call(merchant, client, llm):
    user, _, _ = merchant
    fake = llm()  # no scripted turns: any LLM call would fail the test
    body = _ask(client, user, "Delete all entries", language_hint="en").json()
    assert body["blocked"] == "delete_data" and body["verified"] is True
    assert "Help & support" in body["answer_text"] and "Delete voice history" in body["answer_text"]
    assert body["tools_used"] == [] and fake.calls == []
    with SessionLocal() as s:  # nothing deleted; the refusal itself is logged
        row = s.get(AiDecision, body["question_id"])
        assert json.loads(row.output_json)["outcome"] == "blocked_delete_data"
    assert client.get(f"/api/v1/customers", headers=user.headers).json()["items"]


def test_transfer_refusal_points_to_the_real_request_button(merchant, client, llm):
    user, _, _ = merchant
    llm()
    body = _ask(client, user, "Ramesh ko 500 paise bhej do").json()
    assert body["blocked"] == "transfer_money" and "💳 Request" in body["answer_text"]


# --- Acceptance: wrong-merchant request returns nothing --------------------------

def test_wrong_merchant_request_returns_nothing(merchant, client, llm, make_user):
    victim, ramesh, _ = merchant
    attacker = make_user(ai_consent=True)
    seen = {}

    def faithful(messages):
        seen["result"] = _tool_results(messages)[0]
        return _resp("Mujhe TEST Ramesh naam ka customer nahi dikh raha.")

    # Same customer name and even the victim's customer id: still nothing.
    llm(_resp(tool_calls=[_tool_call("get_customer_balance", {"customer_id": ramesh["id"]})]), faithful)
    body = _ask(client, attacker, "TEST Ramesh ka balance", selected_customer_id=ramesh["id"]).json()
    assert seen["result"] == {"status": "not_found", "customer": None}
    assert body["view_details"] is None and body["candidates"] == []
    assert "3,500" not in body["answer_text"] and "3500" not in body["answer_text"]

    # Feedback on the victim's question id is not accepted either.
    llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {})]), _resp("Kisi ka nahi."))
    victim_qid = _ask(client, victim, "who owes me").json()["question_id"]
    r = client.post("/api/v1/chatbot/feedback", headers=attacker.headers,
                    json={"question_id": victim_qid, "rating": "down"})
    assert r.status_code == 404


# --- Acceptance: no access without login ------------------------------------------

@pytest.mark.parametrize("method,path,body", [
    ("POST", "/api/v1/chatbot/ask", {"transcript_text": "who owes me"}),
    ("POST", "/api/v1/chatbot/feedback", {"question_id": "x", "rating": "up"}),
    ("DELETE", "/api/v1/chatbot/history", None),
])
def test_logged_out_requests_are_rejected(client, method, path, body):
    r = client.request(method, path, json=body)
    assert r.status_code in (401, 403)


def test_logged_out_voice_is_rejected(client, muse):
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json({"token": "not-a-real-token", "purpose": "chatbot"})
        assert ws.receive_json()["status"] == 401
    assert not muse


# --- Limits ---------------------------------------------------------------------

def test_hourly_question_limit_gives_a_polite_message(merchant, client, llm, monkeypatch):
    user, _, _ = merchant
    monkeypatch.setattr(settings, "chatbot_questions_per_hour", 2)
    for _ in range(2):
        llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {})]), _resp("Kisi ka nahi."))
        assert _ask(client, user, "who owes me").status_code == 200
    fake = llm()
    r = _ask(client, user, "who owes me", language_hint="en")
    assert r.status_code == 429
    assert r.json()["detail"] == "You've reached this hour's limit of 2 questions. Please try again a little later."
    assert fake.calls == []


def _use_voice(business_id, seconds, purpose="chatbot"):
    with SessionLocal() as s:
        s.add(AiDecision(business_id=business_id, kind="voice_usage", input_text=None,
                         output_json=json.dumps({"purpose": purpose, "seconds": seconds})))
        s.commit()


def test_daily_voice_limit_applies_to_ask_ai_only(client, user, muse):
    _use_voice(user.business["id"], 600, purpose="entry")  # voice entry doesn't count
    _use_voice(user.business["id"], 590)
    token = user.headers["Authorization"].removeprefix("Bearer ")
    assert live._authorize(token, "chatbot")[2] == pytest.approx(10)  # session capped to what's left
    _use_voice(user.business["id"], 10)
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(user, purpose="chatbot"))
        err = ws.receive_json()
    assert err["status"] == 429 and "10 min per day" in err["message"]
    with client.websocket_connect("/api/v1/voice/live") as ws:  # voice entry still works
        ws.send_json(hello(user))
        assert ws.receive_json() == {"type": "ready"}


# --- Feedback ---------------------------------------------------------------------

def test_feedback_is_stored_with_the_question_id(merchant, client, llm):
    user, _, _ = merchant
    _set_history_consent(client, user, True)
    llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {})]), _resp("Kisi ka nahi."))
    qid = _ask(client, user, "who owes me").json()["question_id"]
    r = client.post("/api/v1/chatbot/feedback", headers=user.headers,
                    json={"question_id": qid, "rating": "down", "note": "TEST Ramesh owes more"})
    assert r.status_code == 200
    with SessionLocal() as s:
        fb = json.loads(s.get(AiDecision, qid).output_json)["feedback"]
    assert fb["rating"] == "down" and decrypt(fb["note_enc"]) == "TEST Ramesh owes more"
    assert client.post("/api/v1/chatbot/feedback", headers=user.headers,
                       json={"question_id": qid, "rating": "meh"}).status_code == 422

    # Delete voice history removes the note too, keeps the rating.
    client.delete("/api/v1/chatbot/history", headers=user.headers)
    with SessionLocal() as s:
        fb = json.loads(s.get(AiDecision, qid).output_json)["feedback"]
    assert fb == {**fb, "rating": "down", "note_enc": None}


# --- Every account answer: date range + View details --------------------------

def test_customer_answer_links_to_that_customer(merchant, client, llm):
    user, ramesh, _ = merchant
    llm(_resp(tool_calls=[_tool_call("get_customer_balance", {"customer_name": "TEST Ramesh"})]),
        _resp("TEST Ramesh ka balance ₹3,500 hai."))
    body = _ask(client, user, "TEST Ramesh ka balance").json()
    assert body["view_details"] == {"screen": "CustomerProfile", "customer_id": ramesh["id"]}
    assert body["period"] == {"as_of": today_iso()}


def test_transactions_answer_links_to_history_with_its_range(merchant, client, llm):
    user, _, _ = merchant

    def faithful(messages):
        r = _tool_results(messages)[0]
        return _resp(f"{r['total_found']} entries.")

    llm(_resp(tool_calls=[_tool_call("list_recent_transactions", {"days": 7})]), faithful)
    body = _ask(client, user, "recent transactions").json()
    assert body["view_details"] == {"screen": "TransactionHistory"}
    assert body["period"]["to"] == today_iso() and body["period"]["from"] < today_iso()


def test_unverified_or_help_answers_have_no_details(merchant, client, llm):
    user, _, _ = merchant
    llm(_resp(tool_calls=[_tool_call("get_top_defaulters", {})]), _resp("TEST Ramesh owes ₹9,999."))
    body = _ask(client, user, "who owes most").json()
    assert body["verified"] is False and body["period"] is None and body["view_details"] is None
