import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Feedback, User
from ..security import get_current_user

router = APIRouter(tags=["feedback"])


class FeedbackBody(BaseModel):
    kind: str = "feedback"  # 'feedback' | 'bug'
    message: str
    # Client-collected device/app diagnostics (see collectDiagnostics on the app).
    diagnostics: dict | None = None


@router.post("/feedback")
def submit_feedback(
    body: FeedbackBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Store user feedback or a bug report. Available to any signed-in user
    (all roles) — support, not a business action."""
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Please describe the issue."
        )

    row = Feedback(
        user_id=user.id,
        kind="bug" if body.kind == "bug" else "feedback",
        message=message[:5000],
        diagnostics=json.dumps(body.diagnostics or {})[:8000],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "id": row.id}
