"""Ask AI chat loop: direct OpenAI tool calling, at most two LLM calls per question.

1. Call 1: system prompt + question, with the six account tools available.
2. If the model calls tools, run them server-side with the authenticated
   merchant_id, then Call 2 (tools disabled) writes the answer from the results.
3. Guards, applied by the server, not the model:
   - No tool called + the answer contains a number -> rejected (unverified).
   - Every number in the final answer must appear in the tool results (or the
     question). Otherwise the answer is replaced with the "unverified" message.

Prompt, tool definitions and fixed replies live in the files next to this one.
"""

from __future__ import annotations

import json
import logging
import re
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import settings
from ..crypto import encrypt
from ..models import AiDecision
from .tools import _today, run_tool

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
        for v in value.values():
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


def ask(db: Session, merchant_id: str, question: str, language_hint: str | None = None,
        selected_customer_id: str | None = None) -> dict:
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

    if reply.tool_calls:
        messages.append({
            "role": "assistant",
            "content": reply.content,
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in reply.tool_calls
            ],
        })
        for i, tc in enumerate(reply.tool_calls):
            if i >= MAX_TOOL_CALLS:
                result = {"error": "too many tool calls; answer with what you have"}
            else:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = None
                result = run_tool(db, merchant_id, tc.function.name, args)
                tools_used.append(tc.function.name)
                results.append(result)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)})

        second = _complete(client, messages, "none")
        _add_usage(usage, second)
        llm_calls = 2
        model_answer = second.choices[0].message.content or ""
        allowed = numbers_in_results(results) | numbers_in_text(question)
        ungrounded = numbers_in_text(model_answer) - allowed
        outcome = "rejected_ungrounded" if (ungrounded or not model_answer.strip()) else "answered"
    else:
        model_answer = reply.content or ""
        # No tool was called, so no number in the answer can be verified.
        invented = numbers_in_text(model_answer) - numbers_in_text(question)
        outcome = "rejected_no_tool" if (invented or not model_answer.strip()) else "answered"

    answer = model_answer.strip() if outcome == "answered" else MESSAGES["unverified"]
    candidates = [
        {k: m.get(k) for k in ("customer_id", "name", "business_name", "mobile_masked")}
        for r in results if isinstance(r, dict) and r.get("status") == "ambiguous"
        for m in r.get("matches", [])
    ]
    response = {
        "answer_text": answer,
        "tools_used": tools_used,
        "data_source": "database" if tools_used else "none",
        "verified": outcome == "answered",
        "candidates": candidates,
    }

    meta = {
        "event": "chatbot_ask",
        "merchant_id": merchant_id,
        "outcome": outcome,
        "llm_calls": llm_calls,
        "tools_used": tools_used,
        "result_customer_ids": _customer_ids(results),
        "latency_ms": round((time.monotonic() - started) * 1000),
        "tokens": usage,
        "model": settings.chatbot_model,
    }
    log.info(json.dumps(meta))  # metadata only: no question/answer text in app logs
    db.add(AiDecision(
        business_id=merchant_id,
        kind="chatbot",
        input_text=encrypt(question),
        output_json=json.dumps({
            **meta,
            "answer_enc": encrypt(answer),
            "model_answer_enc": encrypt(model_answer) if outcome != "answered" else None,
        }),
        confidence=None,
    ))
    db.commit()
    return response
