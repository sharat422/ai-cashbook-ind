from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..chatbot.guardrails import question_limit_reached
from ..chatbot.loop import ChatbotUnavailable, ask, delete_history, message, record_feedback
from ..config import settings
from ..consent import PURPOSE_AI_HISTORY
from ..database import get_db
from ..deps import consent_granted, get_current_business, require, require_ai_consent
from ..models import Business, User
from ..rbac import DATA_VIEW
from ..security import get_current_user

router = APIRouter(tags=["chatbot"])

Language = Literal["hinglish", "hi", "en", "te", "ta", "ml"]


class AskBody(BaseModel):
    # extra="forbid": a client-sent merchant_id is rejected, never used. The
    # merchant always comes from the auth token (require(DATA_VIEW) below).
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    transcript_text: str = Field(min_length=1, max_length=1000)
    language_hint: Language | None = None
    # Set when the user taps one of the candidates from an ambiguous answer.
    selected_customer_id: str | None = Field(default=None, max_length=40)
    # Where the text came from (mic transcript or typed); for logs only.
    input_mode: Literal["voice", "text"] = "text"


@router.post("/chatbot/ask")
def chatbot_ask(
    body: AskBody,
    business: Business = Depends(require(DATA_VIEW)),
    user: User = Depends(get_current_user),
    _ai: None = Depends(require_ai_consent),
    db: Session = Depends(get_db),
) -> dict:
    """Read-only account Q&A. Every number comes from a server-side tool call
    scoped to the caller's business; unverifiable answers are replaced."""
    if question_limit_reached(db, business.id):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            message("limit_questions", body.language_hint).format(limit=settings.chatbot_questions_per_hour),
        )
    try:
        return ask(
            db, business.id, body.transcript_text, body.language_hint, body.selected_customer_id,
            user_id=user.id,
            store_text=consent_granted(db, user.id, PURPOSE_AI_HISTORY),
            input_mode=body.input_mode,
        )
    except ChatbotUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, message("unavailable", body.language_hint))


class FeedbackBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    question_id: str = Field(min_length=1, max_length=40)
    rating: Literal["up", "down"]
    note: str | None = Field(default=None, max_length=500)


@router.post("/chatbot/feedback")
def chatbot_feedback(
    body: FeedbackBody,
    business: Business = Depends(require(DATA_VIEW)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Thumbs up/down on one answer, stored with its question id. A question
    from another business is reported as not found."""
    if not record_feedback(db, business.id, user.id, body.question_id, body.rating, body.note or None):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    return {"ok": True}


@router.delete("/chatbot/history")
def chatbot_delete_history(
    business: Business = Depends(get_current_business),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """One-tap "Delete voice history": removes the stored text of the caller's
    Ask AI chats (voice and typed). Any role may delete their own history."""
    return {"deleted": delete_history(db, business.id, user.id)}
