from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_membership, require
from ..models import Business, BusinessMember, User
from ..rbac import TEAM_MANAGE, ROLES
from ..security import get_current_user

router = APIRouter(tags=["team"])


class AddMemberBody(BaseModel):
    mobile: str
    role: str  # accountant | staff | owner


class UpdateRoleBody(BaseModel):
    role: str


def _member_dto(m: BusinessMember, user: User | None, self_user_id: str) -> dict:
    return {
        "user_id": m.user_id,
        "mobile": user.mobile if user else m.invited_by_mobile,
        "role": m.role,
        "status": m.status,
        "is_self": m.user_id == self_user_id,
        "created_at": m.created_at,
    }


def _members(db: Session, business_id: str) -> list[BusinessMember]:
    return db.scalars(
        select(BusinessMember)
        .where(BusinessMember.business_id == business_id)
        .order_by(BusinessMember.created_at.asc())
    ).all()


def _owner_count(db: Session, business_id: str) -> int:
    return sum(1 for m in _members(db, business_id) if m.role == "owner")


@router.get("/team")
def list_team(
    business: Business = Depends(require(TEAM_MANAGE)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = _members(db, business.id)
    out = []
    for m in rows:
        user = db.get(User, m.user_id)
        out.append(_member_dto(m, user, current.id))
    return out


@router.post("/team")
def add_member(
    body: AddMemberBody,
    business: Business = Depends(require(TEAM_MANAGE)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    mobile = body.mobile.strip()
    if not mobile:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mobile is required")
    if body.role not in ROLES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Role must be one of {', '.join(ROLES)}",
        )

    # Find or create the invitee's identity by mobile (they gain access on their
    # next OTP login — mirrors verify_otp's reuse-by-mobile behaviour).
    user = db.scalars(select(User).where(User.mobile == mobile)).first()
    if user is None:
        user = User(mobile=mobile)
        db.add(user)
        db.flush()

    existing = db.scalars(
        select(BusinessMember).where(
            BusinessMember.business_id == business.id,
            BusinessMember.user_id == user.id,
        )
    ).first()
    if existing is not None:
        existing.role = body.role  # already a member → update their role
        member = existing
    else:
        member = BusinessMember(
            business_id=business.id,
            user_id=user.id,
            role=body.role,
            status="active",
            invited_by_mobile=mobile,
        )
        db.add(member)
    db.commit()
    db.refresh(member)
    return _member_dto(member, user, current.id)


def _owned_member(db: Session, business_id: str, user_id: str) -> BusinessMember:
    member = db.scalars(
        select(BusinessMember).where(
            BusinessMember.business_id == business_id,
            BusinessMember.user_id == user_id,
        )
    ).first()
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return member


@router.patch("/team/{user_id}")
def update_member_role(
    user_id: str,
    body: UpdateRoleBody,
    business: Business = Depends(require(TEAM_MANAGE)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if body.role not in ROLES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Role must be one of {', '.join(ROLES)}",
        )
    member = _owned_member(db, business.id, user_id)
    # Guard: don't let the last owner demote themselves and lock the business out.
    if member.role == "owner" and body.role != "owner" and _owner_count(db, business.id) <= 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This is the only owner — promote someone else to owner first.",
        )
    member.role = body.role
    db.commit()
    db.refresh(member)
    return _member_dto(member, db.get(User, member.user_id), current.id)


@router.delete("/team/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    user_id: str,
    business: Business = Depends(require(TEAM_MANAGE)),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    member = _owned_member(db, business.id, user_id)
    if member.role == "owner" and _owner_count(db, business.id) <= 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Can't remove the only owner. Assign another owner first.",
        )
    db.delete(member)
    db.commit()
