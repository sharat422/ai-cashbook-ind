import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_membership, require
from ..beats import end_all_for_member
from ..calc import IST
from ..models import AccessLog, Business, BusinessMember, Customer, User
from ..rbac import TEAM_MANAGE, ROLES
from ..security import get_current_user

router = APIRouter(tags=["team"])


class AddMemberBody(BaseModel):
    mobile: str
    role: str  # accountant | staff | owner
    name: str | None = Field(default=None, max_length=60)


class UpdateRoleBody(BaseModel):
    role: str | None = None
    name: str | None = Field(default=None, max_length=60)  # "" clears it


def _name(value: str | None) -> str | None:
    v = " ".join((value or "").split())
    return v[:60] or None


def _member_dto(m: BusinessMember, user: User | None, self_user_id: str) -> dict:
    return {
        "user_id": m.user_id,
        "name": m.display_name,
        "mobile": user.mobile if user else m.invited_by_mobile,
        "role": m.role,
        "status": m.status,
        "is_self": m.user_id == self_user_id,
        "created_at": m.created_at,
    }


def _members(db: Session, business_id: str) -> list[BusinessMember]:
    return db.scalars(
        select(BusinessMember)
        .where(BusinessMember.business_id == business_id, BusinessMember.status != "revoked")
        .order_by(BusinessMember.created_at.asc())
    ).all()


def _active_owner_count(db: Session, business_id: str) -> int:
    """Number of *active* owners. Inactive owner rows (invited-but-never-joined,
    soft-removed) must NOT count toward the last-owner guard — otherwise a
    lingering inactive owner lets the sole active owner be demoted/removed,
    leaving the business with zero owners who can actually manage it."""
    return sum(
        1
        for m in _members(db, business_id)
        if m.role == "owner" and m.status == "active"
    )


def _is_last_active_owner(db: Session, business_id: str, member: BusinessMember) -> bool:
    """True if removing/demoting `member` would drop the business to zero active
    owners — i.e. it is itself an active owner and the only one left."""
    return (
        member.role == "owner"
        and member.status == "active"
        and _active_owner_count(db, business_id) <= 1
    )


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
        existing.status = "active"  # re-inviting someone whose access was removed
        if body.name is not None:
            existing.display_name = _name(body.name)
        member = existing
    else:
        member = BusinessMember(
            business_id=business.id,
            user_id=user.id,
            role=body.role,
            status="active",
            invited_by_mobile=mobile,
            display_name=_name(body.name),
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
    member = _owned_member(db, business.id, user_id)
    if body.name is not None:
        member.display_name = _name(body.name)
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Role must be one of {', '.join(ROLES)}",
            )
        # Guard: don't let the last active owner demote themselves and lock the
        # business out (inactive owner rows don't count — see _active_owner_count).
        if body.role != "owner" and _is_last_active_owner(db, business.id, member):
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
    if _is_last_active_owner(db, business.id, member):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Can't remove the only owner. Assign another owner first.",
        )
    # Kept as "revoked", not deleted: their next call is refused with a clear
    # "access removed" (not "set up a business"), and their audit trail stays.
    member.status = "revoked"
    end_all_for_member(db, business, user_id)  # their past visits stay in history
    db.commit()


_AREAS = (
    (re.compile(r"/customers/[^/]+/(ledger|statement)"), "ledger"),
    (re.compile(r"/(statements|customer-aging|ageing|khata)"), "ageing"),
    (re.compile(r"/customers"), "customers"),
    (re.compile(r"/(daily-close|reconciliation)"), "dailyClose"),
    (re.compile(r"/gst"), "gst"),
    (re.compile(r"/(reports|transactions|incomes|expenses)"), "reports"),
    (re.compile(r"/(dashboard|daily-summary|summary)"), "dashboard"),
    (re.compile(r"/account/"), "export"),
    (re.compile(r"/chatbot/"), "assistant"),
)
_CUSTOMER_ID = re.compile(r"/customers/([0-9a-f]{32})")


@router.get("/team/activity")
def accountant_activity(
    user_id: str | None = None,
    limit: int = Query(300, ge=1, le=1000),
    business: Business = Depends(require(TEAM_MANAGE)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Owner: what accountants viewed and exported, newest first, times in IST."""
    q = select(AccessLog).where(AccessLog.business_id == business.id,
                                AccessLog.action.in_(("view", "export", "denied")))
    if user_id:
        q = q.where(AccessLog.user_id == user_id)
    rows = db.scalars(q.order_by(AccessLog.created_at.desc()).limit(limit)).all()
    ids = {m.group(1) for r in rows if (m := _CUSTOMER_ID.search(r.path))}
    names = dict(db.execute(select(Customer.id, Customer.full_name).where(
        Customer.business_id == business.id, Customer.id.in_(ids))).all()) if ids else {}
    names_by_user = dict(db.execute(select(BusinessMember.user_id, BusinessMember.display_name).where(
        BusinessMember.business_id == business.id)).all())
    out = []
    for r in rows:
        m = _CUSTOMER_ID.search(r.path)
        out.append({
            "at": r.created_at,
            "atIst": datetime.fromisoformat(r.created_at).astimezone(IST).strftime("%d %b %Y, %I:%M %p IST"),
            "mobile": r.mobile,
            "name": names_by_user.get(r.user_id),
            "userId": r.user_id,
            "action": r.action,
            "area": next((a for rx, a in _AREAS if rx.search(r.path)), "other"),
            "customer": names.get(m.group(1)) if m else None,
            "path": r.path,
        })
    return out
