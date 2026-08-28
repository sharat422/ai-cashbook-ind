import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..assistant import answer_question
from ..database import get_db
from ..deps import require
from ..rbac import DATA_VIEW
from ..models import AiDecision, Business

router = APIRouter(tags=["assistant"])


class AskBody(BaseModel):
    question: str


@router.post("/assistant/ask")
def assistant_ask(
    body: AskBody,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """Answer a natural-language question about the business. The LLM only
    classifies intent; the numbers are computed from the DB (accurate)."""
    result = answer_question(db, business, body.question)

    db.add(AiDecision(
        business_id=business.id,
        kind="assistant",
        input_text=body.question,
        output_json=json.dumps(result),
        confidence=None,
    ))
    db.commit()
    return result
