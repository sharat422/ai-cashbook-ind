from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import beats as svc
from ..calc import IST
from ..database import get_db
from ..deps import get_current_membership, require
from ..models import VISIT_OUTCOMES, Beat, BeatRetailer, Business, BusinessMember, User, Visit
from ..rbac import BEATS_MANAGE, ENTRY_CREATE, role_can
from ..security import get_current_user
from ..validation import validate_date, validate_notes, validate_text

router = APIRouter(tags=["beats"])


class BeatBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(min_length=1, max_length=100)
    weekdays: list[int] = Field(min_length=1, max_length=7)
    assigned_user_id: str | None = Field(default=None, alias="assignedUserId")
    customer_ids: list[str] = Field(default_factory=list, alias="customerIds", max_length=500)


class OrderBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    customer_ids: list[str] = Field(alias="customerIds", max_length=500)


class VisitBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    client_id: str = Field(alias="clientId")
    beat_id: str = Field(alias="beatId")
    customer_id: str = Field(alias="customerId")
    outcome: str
    reason: str | None = None
    promise_date: str | None = Field(default=None, alias="promiseDate")
    visited_at: str | None = Field(default=None, alias="visitedAt")


def _with_list(db: Session, beat: Beat) -> dict:
    return {**svc.beat_dto(beat), "retailers": svc.day_list(db, beat)}


@router.get("/beats")
def list_beats(
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    business, role = membership
    return [_with_list(db, b) for b in svc.list_beats(db, business, user, role)]


@router.get("/beats/today")
def today_beats(
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    business, role = membership
    return [_with_list(db, b) for b in svc.get_today_beats(db, business, user, role)]


@router.get("/beats/{beat_id}")
def get_beat(
    beat_id: str,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    business, role = membership
    return _with_list(db, svc.assert_beat_access(db, business, user, role, beat_id))


@router.post("/beats")
def create_beat(
    body: BeatBody,
    business: Business = Depends(require(BEATS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    name = validate_text(body.name, "Beat name", 100)
    days = sorted(set(body.weekdays))
    if any(d < 0 or d > 6 for d in days):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Weekdays must be 0 (Mon) to 6 (Sun).")
    if body.assigned_user_id is not None and db.scalars(select(BusinessMember).where(
        BusinessMember.business_id == business.id,
        BusinessMember.user_id == body.assigned_user_id,
        BusinessMember.status == "active",
    )).first() is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Assign the beat to a member of your team.")
    beat = Beat(business_id=business.id, name=name, weekdays=",".join(map(str, days)),
                assigned_user_id=body.assigned_user_id)
    db.add(beat)
    db.flush()
    svc.set_retailers(db, beat, body.customer_ids)
    db.commit()
    return _with_list(db, beat)


@router.put("/beats/{beat_id}/retailers/order")
def order_retailers(
    beat_id: str,
    body: OrderBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    business, role = membership
    if not role_can(role, BEATS_MANAGE):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role doesn't allow this action.")
    beat = svc.assert_beat_access(db, business, user, role, beat_id)
    svc.set_retailers(db, beat, body.customer_ids)
    db.commit()
    return _with_list(db, beat)


def _visited_at(value: str | None) -> str:
    """When the visit happened (an offline visit syncs later), stored in IST."""
    now = datetime.now(IST)
    if not value:
        return now.isoformat(timespec="seconds")
    try:
        at = datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "visitedAt must be an ISO date-time.")
    at = at.replace(tzinfo=IST) if at.tzinfo is None else at.astimezone(IST)
    if at > now + timedelta(minutes=5):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Visit time can't be in the future.")
    return at.isoformat(timespec="seconds")


@router.post("/visits")
def record_visit(
    body: VisitBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    business, role = membership
    if not role_can(role, ENTRY_CREATE):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role doesn't allow this action.")
    beat = svc.assert_beat_access(db, business, user, role, body.beat_id)
    client_id = validate_text(body.client_id, "Client ID", 80)

    def existing() -> Visit | None:
        return db.scalars(select(Visit).where(
            Visit.business_id == business.id, Visit.client_id == client_id)).first()

    if (found := existing()) is not None:
        return svc.visit_dto(found)
    if body.outcome not in VISIT_OUTCOMES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown visit outcome.")
    if db.scalars(select(BeatRetailer).where(
        BeatRetailer.beat_id == beat.id, BeatRetailer.customer_id == body.customer_id)).first() is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This retailer isn't on that beat.")
    reason = body.reason.strip() or None if body.reason else None
    validate_notes(reason, 280)
    visited_at = _visited_at(body.visited_at)
    promise = body.promise_date and validate_date(body.promise_date)
    if promise and promise < visited_at[:10]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Promise date can't be before the visit.")

    visit = Visit(business_id=business.id, beat_id=beat.id, customer_id=body.customer_id,
                  user_id=user.id, outcome=body.outcome, reason=reason,
                  promise_date=promise or None, visited_at=visited_at, client_id=client_id)
    db.add(visit)
    try:
        db.commit()
    except IntegrityError:  # the same upload raced in twice: keep the first
        db.rollback()
        return svc.visit_dto(existing())
    return svc.visit_dto(visit)
