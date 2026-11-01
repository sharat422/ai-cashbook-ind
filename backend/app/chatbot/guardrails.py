"""Ask AI safety rails that run on the server, before and around the LLM.

- blocked_category(): requests the read-only bot must refuse (delete data,
  transfer money, another merchant's data). Rules and replies live in
  guardrails.json. Refused questions never reach the LLM.
- Per-merchant v1 limits, counted from the database (so they hold across
  server workers and in DEBUG/staging): questions per rolling hour, and Ask AI
  voice seconds per IST day.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from ..calc import IST
from ..config import settings
from ..models import AiDecision

_RULES = json.loads((Path(__file__).parent / "guardrails.json").read_text(encoding="utf-8"))
_PATTERNS = {
    category: [re.compile(p, re.IGNORECASE) for p in rule["patterns"]]
    for category, rule in _RULES.items() if not category.startswith("_")
}


def blocked_category(question: str) -> str | None:
    """The guardrail category the question falls in, or None if it's allowed."""
    for category, patterns in _PATTERNS.items():
        if any(p.search(question or "") for p in patterns):
            return category
    return None


def refusal(category: str, lang: str) -> str:
    replies = _RULES[category]["reply"]
    return replies.get(lang) or replies["hinglish"]


# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------
def _utc_iso(dt: datetime) -> str:
    # Same format as models.now_iso(), so stored created_at strings compare correctly.
    return dt.astimezone(timezone.utc).isoformat()


def questions_last_hour(db: Session, merchant_id: str) -> int:
    since = _utc_iso(datetime.now(timezone.utc) - timedelta(hours=1))
    return db.query(AiDecision).filter(
        AiDecision.business_id == merchant_id,
        AiDecision.kind == "chatbot",
        AiDecision.created_at >= since,
    ).count()


def question_limit_reached(db: Session, merchant_id: str) -> bool:
    return questions_last_hour(db, merchant_id) >= settings.chatbot_questions_per_hour


def voice_seconds_today(db: Session, merchant_id: str) -> float:
    """Ask AI voice seconds used since midnight IST (voice entry not counted)."""
    midnight = datetime.combine(datetime.now(IST).date(), time.min, tzinfo=IST)
    rows = db.query(AiDecision).filter(
        AiDecision.business_id == merchant_id,
        AiDecision.kind == "voice_usage",
        AiDecision.created_at >= _utc_iso(midnight),
    ).all()
    total = 0.0
    for row in rows:
        meta = json.loads(row.output_json)
        if meta.get("purpose") == "chatbot":
            total += float(meta.get("seconds") or 0)
    return total


def voice_seconds_left(db: Session, merchant_id: str) -> float:
    return max(0.0, settings.chatbot_voice_seconds_per_day - voice_seconds_today(db, merchant_id))
