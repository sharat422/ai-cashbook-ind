"""Ask AI chat loop: direct OpenAI tool calling, at most two LLM calls per question.

1. Call 1: system prompt + question, with the six account tools and the
   help-guide search available.
2. If the model calls tools, run them server-side with the authenticated
   merchant_id, then Call 2 (tools disabled) writes the answer from the results.
3. Guards, applied by the server, not the model:
   - No tool called + the answer contains a number -> rejected (unverified);
     no tool called otherwise -> a fixed "what I can help with" reply.
   - Every number in the final answer must appear in the tool results (or the
     question). Otherwise the answer is replaced with the "unverified" message.
   - App how-to questions: if the model skips search_help_docs but the guide
     covers the question, the server runs the search itself; if the guide has
     nothing, a fixed "not in the help guide" reply is returned (no call 2);
     an app answer without a closing next-step question gets one appended.

Prompt, tool definitions and fixed replies live in the files next to this one.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import settings
from ..crypto import encrypt
from ..models import AiDecision
from . import guardrails, help_search
from .tools import HELP_TOOL, _today, run_tool

log = logging.getLogger("cashbook.chatbot")

_DIR = Path(__file__).parent
SYSTEM_PROMPT = (_DIR / "system_prompt.md").read_text(encoding="utf-8")
TOOL_DEFINITIONS = json.loads((_DIR / "tool_definitions.json").read_text(encoding="utf-8"))
MESSAGES = json.loads((_DIR / "messages.json").read_text(encoding="utf-8"))

MAX_TOOL_CALLS = 4  # per question, all from call 1
LANGUAGE_HINTS = ("hinglish", "hi", "en")
_LANGUAGE_TEXT = {
    "hinglish": "Hinglish",
    "hi": "Hindi",
    "en": "English",
    None: "not given; match the language of the question",
}

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MASKED_PHONE = re.compile(r"^\*+(\d+)$")


class ChatbotUnavailable(RuntimeError):
    """The LLM provider is not configured or failed."""


# ---------------------------------------------------------------------------
# Number grounding
# ---------------------------------------------------------------------------
def _dec(text: str) -> Decimal | None:
    try:
        return Decimal(text.replace(",", "")).normalize()
    except InvalidOperation:
        return None


def numbers_in_text(text: str) -> set[Decimal]:
    """Numbers as written in text: '₹1,999.90' -> 1999.9, '2 Sep 2026' -> 2, 2026."""
    return {d for d in (_dec(m) for m in _NUMBER.findall(text or "")) if d is not None}


def numbers_in_results(value) -> set[Decimal]:
    """Numbers the tools actually returned: numeric fields, date parts and the
    visible digits of masked phones. Ids and names are ignored on purpose."""
    found: set[Decimal] = set()
    if isinstance(value, bool):
        return found
    if isinstance(value, (int, float)):
        found.add(Decimal(str(value)).normalize())
    elif isinstance(value, str):
        if _DATE.match(value):
            found |= numbers_in_text(value.replace("-", " "))
        elif m := _MASKED_PHONE.match(value):
            found.add(Decimal(m.group(1)).normalize())
    elif isinstance(value, dict):
        for k, v in value.items():
            if k in ("content", "title") and isinstance(v, str):
                found |= numbers_in_text(v)  # help-doc text: step numbers, limits
            else:
                found |= numbers_in_results(v)
    elif isinstance(value, list):
        for v in value:
            found |= numbers_in_results(v)
    return found


def _customer_ids(value) -> list[str]:
    ids: list[str] = []
    if isinstance(value, dict):
        if isinstance(value.get("customer_id"), str):
            ids.append(value["customer_id"])
        for v in value.values():
            ids += _customer_ids(v)
    elif isinstance(value, list):
        for v in value:
            ids += _customer_ids(v)
    return ids


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------
def _system_prompt(language_hint: str | None) -> str:
    return (SYSTEM_PROMPT
            .replace("{{TODAY}}", _today().isoformat())
            .replace("{{LANGUAGE_HINT}}", _LANGUAGE_TEXT.get(language_hint, _LANGUAGE_TEXT[None])))


def _complete(client, messages: list, tool_choice: str):
    try:
        return client.chat.completions.create(
            model=settings.chatbot_model,
            messages=messages,
            tools=TOOL_DEFINITIONS,
            tool_choice=tool_choice,
            max_tokens=settings.chatbot_max_tokens,
        )
    except Exception as exc:  # noqa: BLE001 — any provider failure -> unavailable
        log.warning("chatbot LLM call failed: %s", type(exc).__name__)
        raise ChatbotUnavailable from exc


def _add_usage(total: dict, response) -> None:
    usage = getattr(response, "usage", None)
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        total[key] += int(getattr(usage, key, 0) or 0)


_EMPTY_USAGE = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


def _details(calls: list[tuple[str, dict]], outcome: str) -> tuple[dict | None, dict | None]:
    """Date range and "View details" target for an account answer, taken from
    the tool results themselves (not from the model's wording)."""
    if outcome != "answered":
        return None, None
    period = view = None
    for name, r in calls:
        if not isinstance(r, dict) or name == HELP_TOOL or "error" in r:
            continue
        if period is None:
            if r.get("from") and r.get("to"):
                period = {"from": r["from"], "to": r["to"]}
            elif r.get("month_from") and r.get("month_to"):
                period = {"from": r["month_from"], "to": r["month_to"]}
            elif r.get("as_of"):
                period = {"as_of": r["as_of"]}
            elif r.get("status") == "found" or r.get("matches"):
                period = {"as_of": _today().isoformat()}
        one = r.get("customer") if r.get("status") == "found" else (
            r["matches"][0] if len(r.get("matches") or []) == 1 else None)
        if one and one.get("customer_id"):
            view = {"screen": "CustomerProfile", "customer_id": one["customer_id"]}
        elif view is None and name == "list_recent_transactions":
            view = {"screen": "TransactionHistory"}
        elif view is None and name in ("get_top_defaulters", "get_business_summary", "get_collections_summary"):
            view = {"screen": "KhataDashboard"}
    return period, view


def _record(db: Session, merchant_id: str, question: str, answer: str, model_answer: str,
            outcome: str, store_text: bool, started: float, **meta_fields) -> str:
    """Log one question: metadata to the app log; a row (text encrypted, only
    with ai_history consent) to ai_decisions. Returns the row id = question_id."""
    meta = {
        "event": "chatbot_ask",
        "merchant_id": merchant_id,
        "outcome": outcome,
        "llm_calls": 0,
        "tools_used": [],
        "tokens": dict(_EMPTY_USAGE),
        **meta_fields,
        "latency_ms": round((time.monotonic() - started) * 1000),
    }
    log.info(json.dumps(meta))  # metadata only: no question/answer text in app logs
    # Text (encrypted) only with the user's ai_history consent; see
    # delete_history() for the one-tap delete.
    text = {
        "answer_enc": encrypt(answer),
        "model_answer_enc": encrypt(model_answer) if model_answer and outcome != "answered" else None,
    } if store_text else {}
    row = AiDecision(
        business_id=merchant_id,
        kind="chatbot",
        input_text=encrypt(question) if store_text else None,
        output_json=json.dumps({**meta, "text_stored": store_text, **text}),
        confidence=None,
    )
    db.add(row)
    db.commit()
    return row.id


def ask(db: Session, merchant_id: str, question: str, language_hint: str | None = None,
        selected_customer_id: str | None = None, *, user_id: str | None = None,
        store_text: bool = False, input_mode: str = "text") -> dict:
    """Answer one question. `store_text` (the user's ai_history consent) decides
    whether the question/answer text is kept; metadata is always logged."""
    lang = language_hint or "hinglish"
    category = guardrails.blocked_category(question)
    if category:
        # Refused before any LLM call: read-only bot, fixed safe reply.
        answer = guardrails.refusal(category, lang)
        return {
            "answer_text": answer, "tools_used": [], "data_source": "none", "verified": True,
            "blocked": category, "candidates": [], "sources": [], "suggested_screen": None,
            "period": None, "view_details": None,
            "question_id": _record(db, merchant_id, question, answer, "", f"blocked_{category}",
                                   store_text, time.monotonic(), user_id=user_id,
                                   input_mode=input_mode),
        }
    if not settings.openai_api_key:
        raise ChatbotUnavailable("OPENAI_API_KEY is not set")
    from openai import OpenAI

    started = time.monotonic()
    client = OpenAI(api_key=settings.openai_api_key, timeout=20)
    user_text = question + (f"\nSelected customer_id: {selected_customer_id}" if selected_customer_id else "")
    messages: list = [
        {"role": "system", "content": _system_prompt(language_hint)},
        {"role": "user", "content": user_text},
    ]
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    first = _complete(client, messages, "auto")
    _add_usage(usage, first)
    llm_calls = 1
    reply = first.choices[0].message
    tools_used: list[str] = []
    results: list = []
    help_docs: list[dict] = []
    help_searched = False

    tool_calls = [(tc.id, tc.function.name, tc.function.arguments) for tc in (reply.tool_calls or [])]
    forced_help = False
    if not tool_calls and help_search.search(question):
        # The model skipped the help guide for a question the guide covers. Run
        # the search server-side so the answer still comes only from the docs.
        tool_calls = [("server_help_search", HELP_TOOL, json.dumps({"query": question}))]
        forced_help = True

    if tool_calls:
        messages.append({
            "role": "assistant",
            "content": None if forced_help else reply.content,
            "tool_calls": [
                {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}
                for call_id, name, arguments in tool_calls
            ],
        })
        for i, (call_id, name, arguments) in enumerate(tool_calls):
            if i >= MAX_TOOL_CALLS:
                result = {"error": "too many tool calls; answer with what you have"}
            else:
                try:
                    args = json.loads(arguments or "{}")
                except json.JSONDecodeError:
                    args = None
                result = run_tool(db, merchant_id, name, args)
                tools_used.append(name)
                results.append(result)
                if name == HELP_TOOL:
                    help_searched = True
                    help_docs += result.get("results", [])
            messages.append({"role": "tool", "tool_call_id": call_id, "content": json.dumps(result)})

        account_used = any(name != HELP_TOOL for name in tools_used)
        if help_searched and not help_docs and not account_used:
            # Nothing in the help guide: fixed reply, no chance to improvise.
            model_answer, outcome = "", "not_in_help"
        else:
            second = _complete(client, messages, "none")
            _add_usage(usage, second)
            llm_calls = 2
            model_answer = second.choices[0].message.content or ""
            allowed = numbers_in_results(results) | numbers_in_text(question)
            ungrounded = numbers_in_text(model_answer) - allowed
            outcome = "rejected_ungrounded" if (ungrounded or not model_answer.strip()) else "answered"
    else:
        model_answer = reply.content or ""
        # No tool was called, so nothing in the answer is backed by data or docs.
        # Numbers -> "couldn't verify" (phase 2 rule); anything else -> a fixed
        # reply about what the bot can do, so it can't invent a feature either.
        invented = numbers_in_text(model_answer) - numbers_in_text(question)
        outcome = "rejected_no_tool" if invented else "out_of_scope"

    if outcome == "not_in_help":
        answer = MESSAGES["not_in_help"][lang]
    elif outcome == "out_of_scope":
        answer = MESSAGES["out_of_scope"][lang]
    elif outcome == "answered":
        answer = model_answer.strip()
        if help_docs and not answer.endswith("?"):  # every app answer ends with a next step
            answer += " " + MESSAGES["next_step"][lang].format(screen=help_docs[0]["screen_label"])
    else:
        answer = MESSAGES["unverified"]

    sources = list(dict.fromkeys(d["source"] for d in help_docs))
    data_source = "+".join(
        label for label, used in (("database", any(n != HELP_TOOL for n in tools_used)),
                                  ("help_docs", help_searched)) if used
    ) or "none"
    candidates = [
        {k: m.get(k) for k in ("customer_id", "name", "business_name", "mobile_masked")}
        for r in results if isinstance(r, dict) and r.get("status") == "ambiguous"
        for m in r.get("matches", [])
    ]
    period, view_details = _details(list(zip(tools_used, results)), outcome)
    response = {
        "answer_text": answer,
        "tools_used": tools_used,
        "data_source": data_source,
        "verified": outcome in ("answered", "not_in_help", "out_of_scope"),
        "blocked": None,
        "candidates": candidates,
        "sources": sources,
        "suggested_screen": (
            {"screen": help_docs[0]["screen"], "label": help_docs[0]["screen_label"]}
            if help_docs and outcome == "answered" else None
        ),
        "period": period,
        "view_details": view_details,
    }
    response["question_id"] = _record(
        db, merchant_id, question, answer, model_answer, outcome, store_text, started,
        user_id=user_id, input_mode=input_mode, llm_calls=llm_calls, tools_used=tools_used,
        forced_help_search=forced_help, help_sources=sources,
        result_customer_ids=_customer_ids(results), tokens=usage, model=settings.chatbot_model,
    )
    return response


def delete_history(db: Session, merchant_id: str, user_id: str) -> int:
    """Remove the stored question/answer text (and feedback notes) of this
    user's Ask AI chats in this business. Usage metadata (tools, minutes,
    tokens, ratings) is kept. Returns the number of chats changed."""
    removed = 0
    rows = db.query(AiDecision).filter(
        AiDecision.business_id == merchant_id, AiDecision.kind == "chatbot"
    ).all()
    for row in rows:
        meta = json.loads(row.output_json)
        # Rows from before per-user history (no user_id) are cleared too.
        note = (meta.get("feedback") or {}).get("note_enc")
        if meta.get("user_id") not in (user_id, None) or not (row.input_text or "answer_enc" in meta or note):
            continue
        for key in ("answer_enc", "model_answer_enc"):
            meta.pop(key, None)
        if note:  # the user's own feedback note is text too; the rating stays
            meta["feedback"]["note_enc"] = None
        meta["text_stored"] = False
        row.output_json = json.dumps(meta)
        row.input_text = None
        removed += 1
    db.commit()
    return removed


def record_feedback(db: Session, merchant_id: str, user_id: str, question_id: str,
                    rating: str, note: str | None) -> bool:
    """Thumbs up/down (+ optional note, encrypted) on one answer. Only a
    question of this merchant counts; anything else returns False (404)."""
    row = db.get(AiDecision, question_id)
    if row is None or row.kind != "chatbot" or row.business_id != merchant_id:
        return False
    meta = json.loads(row.output_json)
    meta["feedback"] = {
        "rating": rating,
        "note_enc": encrypt(note) if note else None,
        "user_id": user_id,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    row.output_json = json.dumps(meta)
    db.commit()
    log.info(json.dumps({"event": "chatbot_feedback", "merchant_id": merchant_id,
                         "question_id": question_id, "rating": rating, "has_note": bool(note)}))
    return True
