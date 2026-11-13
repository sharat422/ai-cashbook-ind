from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..discards import refuse_if_discarded
from .. import beats as svc
from ..calc import IST
from ..database import get_db
from ..deps import get_current_membership, require
from ..errors import error_body
from ..models import VISIT_OUTCOMES, AccessLog, Beat, BeatAssignment, BeatRetailer, Business, BusinessMember, User, Visit, now_iso
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
    # The beat version this edit started from (IM3); old apps omit it.
    base_version: int | None = Field(default=None, alias="baseVersion")


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
    return {**svc.beat_dto_with_team(db, beat), "retailers": svc.day_list(db, beat)}


def _claim_version(db: Session, beat: Beat, base_version: int | None = None) -> bool:
    """IM3, the credit-limit version pattern made atomic: take the beat's next
    version, and with `base_version` only if nobody saved since (one conditional
    UPDATE, so two phones saving at once can't both pass). A server counter, never
    a device clock. Call before changing the beat: it reloads it."""
    current = func.coalesce(Beat.version, 1)
    q = update(Beat).where(Beat.id == beat.id).values(version=current + 1)
    if base_version is not None:
        q = q.where(current == base_version)
    claimed = db.execute(q, execution_options={"synchronize_session": False}).rowcount == 1
    db.refresh(beat)
    return claimed


def _changed_elsewhere(db: Session, beat: Beat) -> JSONResponse:
    """Nothing was saved: 409 with the current beat, which the app shows with the notice."""
    db.rollback()
    return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={
        **error_body(status.HTTP_409_CONFLICT, f"{beat.name}: changed on another phone — review and save again.",
                     "beat_changed", {"beat": beat.name}),
        "beat": _with_list(db, beat),
    })


@router.get("/beats")
def list_beats(
    deleted: bool = Query(False),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Live beats; `?deleted=true` (owner) lists deleted ones to restore."""
    business, role = _manage(membership) if deleted else membership
    return [_with_list(db, b) for b in svc.list_beats(db, business, user, role, deleted)]


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


def _beat_fields(db: Session, business: Business, body: BeatBody) -> dict:
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
    return {"name": name, "weekdays": ",".join(map(str, days)), "assigned_user_id": body.assigned_user_id}


@router.post("/beats")
def create_beat(
    body: BeatBody,
    business: Business = Depends(require(BEATS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    fields = _beat_fields(db, business, body)
    beat = Beat(business_id=business.id, **{**fields, "assigned_user_id": None})
    db.add(beat)
    db.flush()
    if fields["assigned_user_id"]:
        svc.assign(db, beat, fields["assigned_user_id"], "primary")
    svc.set_retailers(db, beat, body.customer_ids)
    db.commit()
    return _with_list(db, beat)


class BeatEditBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(min_length=1, max_length=100)
    weekdays: list[int] = Field(min_length=1, max_length=7)
    assigned_user_id: str | None = Field(default=None, alias="assignedUserId")
    # The beat version this edit started from (IM3); old apps omit it.
    base_version: int | None = Field(default=None, alias="baseVersion")


@router.put("/beats/{beat_id}")
def edit_beat(
    beat_id: str,
    body: BeatEditBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Rename, change days or salesperson. Shops and order: retailers/order.
    Changed on another phone since `baseVersion`: nothing saved, 409 (IM3)."""
    business, role = membership
    if not role_can(role, BEATS_MANAGE):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role doesn't allow this action.")
    beat = svc.assert_beat_access(db, business, user, role, beat_id)
    fields = _beat_fields(db, business, BeatBody(**body.model_dump(exclude={"base_version"})))
    if not _claim_version(db, beat, body.base_version):
        return _changed_elsewhere(db, beat)
    primary = fields.pop("assigned_user_id")
    for key, value in fields.items():
        setattr(beat, key, value)
    if primary and primary != beat.assigned_user_id:
        svc.assign(db, beat, primary, "primary")  # the old primary's assignment ends today
    elif not primary and beat.assigned_user_id:
        svc.end_assignment(db, beat, beat.assigned_user_id)
    db.commit()
    return _with_list(db, beat)


class AssignBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    user_id: str = Field(alias="userId", max_length=40)
    role: str = "secondary"


def _manage(membership: tuple[Business, str]) -> tuple[Business, str]:
    business, role = membership
    if not role_can(role, BEATS_MANAGE):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role doesn't allow this action.")
    return business, role


@router.post("/beats/{beat_id}/assignments")
def add_assignment(
    beat_id: str,
    body: AssignBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Share a beat: add a member as secondary (or make them the primary)."""
    business, role = _manage(membership)
    beat = svc.assert_beat_access(db, business, user, role, beat_id)
    _claim_version(db, beat)  # who works it changed: older edits are now stale (IM3)
    _beat_fields(db, business, BeatBody(name=beat.name, weekdays=[0], assignedUserId=body.user_id))  # a team member
    svc.assign(db, beat, body.user_id, body.role)
    try:
        db.commit()
    except IntegrityError:  # two primaries at once
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This beat already has a primary salesperson.") from None
    return _with_list(db, beat)


@router.post("/beats/{beat_id}/assignments/{member_id}/end")
def end_assignment(
    beat_id: str,
    member_id: str,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Take a member off the beat from tomorrow; their visits stay in history."""
    business, role = _manage(membership)
    beat = svc.assert_beat_access(db, business, user, role, beat_id)
    _claim_version(db, beat)  # who works it changed: older edits are now stale (IM3)
    if not svc.end_assignment(db, beat, member_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That member isn't on this beat.")
    db.commit()
    return _with_list(db, beat)


class HelperBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    user_id: str = Field(alias="userId", max_length=40)
    valid_from: str | None = Field(default=None, alias="validFrom", max_length=10)  # default today
    valid_to: str | None = Field(default=None, alias="validTo", max_length=10)  # last day; None = open


@router.post("/beats/{beat_id}/helpers")
def add_helper(
    beat_id: str,
    body: HelperBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: add a helper (secondary) from a start date (default today) to an
    optional end date. No back-dating: history is written by visits. Already
    on the beat for any of those days: 422."""
    business, role = _manage(membership)
    beat = svc.assert_beat_access(db, business, user, role, beat_id)
    _claim_version(db, beat)  # who works it changed: older edits are now stale (IM3)
    _beat_fields(db, business, BeatBody(name=beat.name, weekdays=[0], assignedUserId=body.user_id))  # a team member
    today = svc.today_iso()
    start = validate_date(body.valid_from) if body.valid_from else today
    end = validate_date(body.valid_to) if body.valid_to else None
    if start < today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The start date can't be in the past.")
    if end and end < start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The end date can't be before the start date.")
    clash = [a for a in svc.upcoming(db, beat.id, body.user_id, start) if end is None or a.valid_from <= end]
    if any(a.role == "primary" for a in clash):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "This person is the beat's salesperson; change the salesperson instead.")
    if len(clash) == 1 and clash[0].valid_to == today == start:
        clash[0].valid_to = end  # removed earlier today: undo that rather than add a second row
    elif clash:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This person is already on this beat for those dates.")
    else:
        db.add(BeatAssignment(beat_id=beat.id, user_id=body.user_id, role="secondary", valid_from=start, valid_to=end))
    db.commit()
    return _with_list(db, beat)


@router.delete("/beats/{beat_id}/helpers/{member_id}")
def remove_helper(
    beat_id: str,
    member_id: str,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: a helper's last day on the beat is today (the row is kept, so
    their visits stay in history); cover that hasn't started is cancelled.
    The primary can't be removed here: 422."""
    business, role = _manage(membership)
    beat = svc.assert_beat_access(db, business, user, role, beat_id)
    _claim_version(db, beat)  # who works it changed: older edits are now stale (IM3)
    today = svc.today_iso()
    mine = [a for a in svc.upcoming(db, beat.id, member_id) if a.valid_to is None or a.valid_to > today]
    if any(a.role == "primary" for a in mine):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "The salesperson can't be removed here; change the salesperson instead.")
    if not mine:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That member isn't a helper on this beat.")
    svc.end_assignment(db, beat, member_id)
    db.commit()
    return _with_list(db, beat)


@router.delete("/beats/{beat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_beat(
    beat_id: str,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Soft delete: the beat leaves every list; its visits stay in the history."""
    business, role = membership
    if not role_can(role, BEATS_MANAGE):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role doesn't allow this action.")
    beat = svc.assert_beat_access(db, business, user, role, beat_id)
    beat.deleted_at = now_iso()
    db.commit()


@router.put("/beats/{beat_id}/restore")
def restore_beat(
    beat_id: str,
    request: Request,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: bring a deleted beat back as it was. Already live: a no-op."""
    business, role = _manage(membership)
    beat = svc.assert_beat_access(db, business, user, role, beat_id, allow_deleted=True)
    if svc.restore(db, beat):
        db.add(AccessLog(business_id=business.id, user_id=user.id, mobile=user.mobile, action="restore",
                         method="PUT", path=request.url.path[:300]))
        db.commit()
    return _with_list(db, beat)


@router.get("/visits")
def visit_history(
    customer_id: str | None = Query(None, alias="customerId", max_length=40),
    user_id: str | None = Query(None, alias="userId", max_length=40),
    beat_id: str | None = Query(None, alias="beatId", max_length=40),
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
    limit: int = Query(200, ge=1, le=1000),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Past visits by shop, salesperson, beat or date. Staff: their own only."""
    business, role = membership
    return svc.visit_history(db, business, user, role, customer_id=customer_id, user_id=user_id,
                             beat_id=beat_id, start=validate_date(start) if start else None,
                             end=validate_date(end) if end else None, limit=limit)


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
    if not _claim_version(db, beat, body.base_version):  # IM3: two phones reordering at once
        return _changed_elsewhere(db, beat)
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
    refuse_if_discarded(db, business.id, client_id)  # IM5: discarded by the owner on the phone
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
