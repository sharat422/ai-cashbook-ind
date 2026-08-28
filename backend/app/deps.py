from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .models import Business, BusinessMember, User
from .rbac import role_can
from .security import get_current_user


def _resolve_membership(db: Session, user: User) -> tuple[Business, str]:
    """Return (business, role) for the user's active business.

    v1 uses the user's first active membership. Falls back to a legacy
    owner-by-user_id business for any row created before memberships existed
    (the migration backfills these, so the fallback is belt-and-suspenders).
    """
    member = db.scalars(
        select(BusinessMember)
        .where(BusinessMember.user_id == user.id, BusinessMember.status == "active")
        .order_by(BusinessMember.created_at.asc())
    ).first()
    if member is not None:
        business = db.get(Business, member.business_id)
        if business is not None:
            return business, member.role

    legacy = db.scalars(
        select(Business).where(Business.user_id == user.id)
    ).first()
    if legacy is not None:
        return legacy, "owner"

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No business found. Complete onboarding first.",
    )


def get_current_membership(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> tuple[Business, str]:
    """The active business plus the caller's role in it."""
    return _resolve_membership(db, user)


def get_current_business(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Business:
    """Resolve the active business for the authenticated user (any role)."""
    business, _role = _resolve_membership(db, user)
    return business


def require(*permissions: str):
    """Dependency factory: allow the request only if the caller's role grants
    every listed permission, else 403. Returns the active Business so gated
    endpoints can use it exactly like `get_current_business`.
    """

    def _dep(
        membership: tuple[Business, str] = Depends(get_current_membership),
    ) -> Business:
        business, role = membership
        if not all(role_can(role, p) for p in permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your role doesn't allow this action.",
            )
        return business

    return _dep
