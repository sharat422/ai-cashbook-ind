"""Per-purpose consent: read the current user's choices and change them one
purpose at a time.

Available to any authenticated user (even before onboarding), so consent can be
recorded during signup before a business exists. Each write stamps the current
policy version and a fresh updated_at; a required purpose (core) can never be
set to false.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..consent import (
    CONSENT_PURPOSES,
    CURRENT_POLICY_VERSION,
    OPTIONAL_PURPOSES,
    REQUIRED_PURPOSES,
    is_required,
)
from ..database import get_db
from ..models import User, UserConsent, now_iso
from ..security import get_current_user

router = APIRouter(tags=["consent"])


class ConsentChoice(BaseModel):
    purpose: str
    granted: bool


class ConsentUpdate(BaseModel):
    # One or more purposes to set in a single call (e.g. the whole signup screen).
    choices: list[ConsentChoice]


def _consent_dto(purpose: str, row: UserConsent | None) -> dict:
    """Current state for one purpose. A purpose with no row yet reads as
    not-granted (required purposes still report required so the client can
    render them locked)."""
    return {
        "purpose": purpose,
        "granted": bool(row.granted) if row else False,
        "required": is_required(purpose),
        "policy_version": row.policy_version if row else None,
        "updated_at": row.updated_at if row else None,
    }


def _load(db: Session, user_id: str) -> dict[str, UserConsent]:
    rows = db.scalars(
        select(UserConsent).where(UserConsent.user_id == user_id)
    ).all()
    return {r.purpose: r for r in rows}


def _snapshot(db: Session, user_id: str) -> dict:
    existing = _load(db, user_id)
    return {
        "policy_version": CURRENT_POLICY_VERSION,
        "required": list(REQUIRED_PURPOSES),
        "optional": list(OPTIONAL_PURPOSES),
        "consents": [_consent_dto(p, existing.get(p)) for p in CONSENT_PURPOSES],
    }


@router.get("/consents")
def get_consents(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """The user's current choice for every purpose, plus the current policy
    version and which purposes are required vs optional."""
    return _snapshot(db, user.id)


@router.put("/consents")
def update_consents(
    body: ConsentUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Set one or more purposes. Upserts each row, stamping the current policy
    version and updated_at. A required purpose cannot be withdrawn."""
    if not body.choices:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "No consent choices provided."
        )

    existing = _load(db, user.id)
    now = now_iso()
    for choice in body.choices:
        if choice.purpose not in CONSENT_PURPOSES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Unknown consent purpose '{choice.purpose}'.",
            )
        if is_required(choice.purpose) and not choice.granted:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"'{choice.purpose}' consent is required to use the app and "
                "cannot be withdrawn.",
            )
        row = existing.get(choice.purpose)
        if row is None:
            row = UserConsent(
                user_id=user.id,
                purpose=choice.purpose,
                granted=choice.granted,
                policy_version=CURRENT_POLICY_VERSION,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            existing[choice.purpose] = row
        else:
            row.granted = choice.granted
            row.policy_version = CURRENT_POLICY_VERSION
            row.updated_at = now

    db.commit()
    return _snapshot(db, user.id)
