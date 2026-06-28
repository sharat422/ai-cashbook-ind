from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .models import Business, User
from .security import get_current_user


def get_current_business(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Business:
    """Resolve the active business for the authenticated user.

    The onboarding flow creates exactly one business per user; we use the first
    one. Endpoints that touch business data depend on this so a user who hasn't
    finished onboarding gets a clear 400 instead of leaking another user's rows.
    """
    business = db.scalars(
        select(Business).where(Business.user_id == user.id)
    ).first()
    if business is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No business found. Complete onboarding first.",
        )
    return business
