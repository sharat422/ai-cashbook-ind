from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..chatbot.loop import MESSAGES, ChatbotUnavailable, ask
from ..database import get_db
from ..deps import require, require_ai_consent
from ..models import Business
from ..rbac import DATA_VIEW

router = APIRouter(tags=["chatbot"])


class AskBody(BaseModel):
    # extra="forbid": a client-sent merchant_id is rejected, never used. The
    # merchant always comes from the auth token (require(DATA_VIEW) below).
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    transcript_text: str = Field(min_length=1, max_length=1000)
    language_hint: Literal["hinglish", "hi", "en"] | None = None
    # Set when the user taps one of the candidates from an ambiguous answer.
    selected_customer_id: str | None = Field(default=None, max_length=40)


@router.post("/chatbot/ask")
def chatbot_ask(
    body: AskBody,
    business: Business = Depends(require(DATA_VIEW)),
    _ai: None = Depends(require_ai_consent),
    db: Session = Depends(get_db),
) -> dict:
    """Read-only account Q&A. Every number comes from a server-side tool call
    scoped to the caller's business; unverifiable answers are replaced."""
    try:
        return ask(db, business.id, body.transcript_text, body.language_hint, body.selected_customer_id)
    except ChatbotUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, MESSAGES["unavailable"])
