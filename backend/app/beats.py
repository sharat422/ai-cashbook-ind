"""Beat plan: which retailers a staff member visits, in what order, on which days.

Isolation lives HERE, not in the router: every read or write of a beat goes
through `assert_beat_access`, so a staff member can only ever touch beats
assigned to them, whichever endpoint calls in. Owners and accountants
(DATA_VIEW) see every beat of their business.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .calc import IST, today_iso
from .models import (Beat, BeatAssignment, BeatRetailer, Business, BusinessMember, Customer,
                     LedgerEntry, User, Visit)
from .rbac import DATA_VIEW, role_can
from .routers.customer_insights import _customer_aging


def _sees_all(role: str) -> bool:
    return role_can(role, DATA_VIEW)


def assert_beat_access(db: Session, business: Business, user: User, role: str, beat_id: str,
                       allow_deleted: bool = False) -> Beat:
    """The beat, or 404 if it isn't this business's (or was deleted, unless
    reading its history), or 403 if the caller is staff and it isn't theirs."""
    beat = db.get(Beat, beat_id)
    if beat is None or beat.business_id != business.id or (beat.deleted_at and not allow_deleted):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Beat not found")
    if not _sees_all(role) and not is_assigned(db, beat.id, user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This beat isn't assigned to you.")
    return beat


def _active(day: str):
    """Assignments in force on `day` (valid_to is the last day they apply)."""
    return (BeatAssignment.valid_from <= day,
            (BeatAssignment.valid_to.is_(None)) | (BeatAssignment.valid_to >= day))


def is_assigned(db: Session, beat_id: str, user_id: str, day: str | None = None) -> bool:
    day = day or today_iso()
    return db.scalars(select(BeatAssignment.id).where(
        BeatAssignment.beat_id == beat_id, BeatAssignment.user_id == user_id, *_active(day))).first() is not None


def assignments(db: Session, beat_id: str, day: str | None = None) -> list[BeatAssignment]:
    day = day or today_iso()
    return list(db.scalars(select(BeatAssignment).where(BeatAssignment.beat_id == beat_id, *_active(day))
                           .order_by(BeatAssignment.role, BeatAssignment.created_at)).all())


def upcoming(db: Session, beat_id: str, user_id: str | None = None, day: str | None = None) -> list[BeatAssignment]:
    """Assignments in force on `day` or starting later (the beat's team, with
    planned cover)."""
    day = day or today_iso()
    query = select(BeatAssignment).where(BeatAssignment.beat_id == beat_id,
                                         (BeatAssignment.valid_to.is_(None)) | (BeatAssignment.valid_to >= day))
    if user_id:
        query = query.where(BeatAssignment.user_id == user_id)
    return list(db.scalars(query.order_by(BeatAssignment.role, BeatAssignment.valid_from,
                                          BeatAssignment.created_at)).all())


def assign(db: Session, beat: Beat, user_id: str, role: str, day: str | None = None) -> BeatAssignment:
    """Put a member on a beat. A new primary ends the current primary (they
    stay on as nobody unless also added as a secondary)."""
    day = day or today_iso()
    if role not in ("primary", "secondary"):
        raise HTTPException(422, "Role must be primary or secondary.")
    current = [a for a in assignments(db, beat.id, day) if a.user_id == user_id]
    if role == "secondary" and any(a.role == "primary" for a in current):
        # Demoting the primary would leave the beat with no open primary.
        raise HTTPException(422, "This person is the beat's salesperson; change the salesperson instead.")
    for a in current:
        if a.role == role:
            return a  # already on it
        _end(a, day, now=True)  # switching role: the new row takes over today
    if role == "primary":
        # A handover: the old primary stops at once (not tomorrow).
        for a in db.scalars(select(BeatAssignment).where(
                BeatAssignment.beat_id == beat.id, BeatAssignment.role == "primary",
                BeatAssignment.valid_to.is_(None))).all():
            _end(a, day, now=True)
        beat.assigned_user_id = user_id
    db.flush()
    row = BeatAssignment(beat_id=beat.id, user_id=user_id, role=role, valid_from=day)
    db.add(row)
    db.flush()
    return row


def _end(a: BeatAssignment, day: str, now: bool = False) -> None:
    """valid_to is the last day it applies: ending it today hides the beat
    from tomorrow; `now` (a handover) makes yesterday the last day."""
    last = (date.fromisoformat(day) - timedelta(days=1)).isoformat() if now else day
    a.valid_to = last


def end_assignment(db: Session, beat: Beat, user_id: str, day: str | None = None) -> int:
    """Today is their last day; cover planned for later is cancelled (it never
    started, so no visit refers to it)."""
    day = day or today_iso()
    rows = upcoming(db, beat.id, user_id, day)
    for a in rows:
        if a.valid_from > day:
            db.delete(a)
            continue
        _end(a, day)
        if a.role == "primary" and beat.assigned_user_id == user_id:
            beat.assigned_user_id = None
    return len(rows)


def end_all_for_member(db: Session, business: Business, user_id: str, day: str | None = None) -> None:
    """A member leaving the team stops working every beat; their visits stay."""
    day = day or today_iso()
    for beat in db.scalars(select(Beat).where(Beat.business_id == business.id)).all():
        end_assignment(db, beat, user_id, day)


def restore(db: Session, beat: Beat, day: str | None = None) -> bool:
    """Undo a delete: shops, order, visits and closes never left. Members who
    have since left stop working it; with no primary left the beat goes back
    to nobody (no staff day-list) until the owner picks a salesperson."""
    if not beat.deleted_at:
        return False
    day = day or today_iso()
    beat.deleted_at = None
    active = set(db.scalars(select(BusinessMember.user_id).where(
        BusinessMember.business_id == beat.business_id, BusinessMember.status == "active")).all())
    team = assignments(db, beat.id, day)
    if not any(a.role == "primary" and a.user_id in active for a in team):
        active = set()  # no salesperson: nobody sees it until one is picked
    for a in team:
        if a.user_id not in active:
            _end(a, day, now=True)
    beat.assigned_user_id = next((a.user_id for a in team if a.role == "primary" and a.user_id in active), None)
    return True


def list_beats(db: Session, business: Business, user: User, role: str, deleted: bool = False) -> list[Beat]:
    gone = Beat.deleted_at.is_not(None) if deleted else Beat.deleted_at.is_(None)
    query = select(Beat).where(Beat.business_id == business.id, gone).order_by(Beat.name)
    if not _sees_all(role):
        mine = select(BeatAssignment.beat_id).where(BeatAssignment.user_id == user.id, *_active(today_iso()))
        query = query.where(Beat.id.in_(mine))
    return list(db.scalars(query).all())


def get_today_beats(db: Session, business: Business, user: User, role: str) -> list[Beat]:
    """Beats scheduled for today's IST weekday: staff get only their own."""
    weekday = str(datetime.now(IST).weekday())
    return [b for b in list_beats(db, business, user, role) if weekday in b.weekdays.split(",")]


def set_retailers(db: Session, beat: Beat, customer_ids: list[str]) -> None:
    """Replace the beat's retailers with `customer_ids`, in that visit order."""
    if len(set(customer_ids)) != len(customer_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A retailer is listed twice.")
    if customer_ids:
        owned = set(db.scalars(select(Customer.id).where(
            Customer.business_id == beat.business_id, Customer.id.in_(customer_ids))).all())
        if owned != set(customer_ids):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown retailer.")
    db.query(BeatRetailer).filter(BeatRetailer.beat_id == beat.id).delete(synchronize_session=False)
    db.add_all(BeatRetailer(beat_id=beat.id, customer_id=cid, visit_order=i)
               for i, cid in enumerate(customer_ids))


def day_list(db: Session, beat: Beat) -> list[dict]:
    """The beat's retailers in visit order, with what a salesperson needs at
    the counter: balance, overdue (dues older than 30 days, oldest paid first),
    credit limit, last promise date and today's visit, if any."""
    rows = db.execute(
        select(BeatRetailer, Customer)
        .join(Customer, BeatRetailer.customer_id == Customer.id)
        .where(BeatRetailer.beat_id == beat.id)
        .order_by(BeatRetailer.visit_order)
    ).all()
    ids = [c.id for _, c in rows]
    ledger: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id.in_(ids))).all():
        ledger[e.customer_id].append(e)
    visits = db.scalars(
        select(Visit).where(Visit.customer_id.in_(ids)).order_by(Visit.visited_at)
    ).all()
    promise: dict[str, str] = {}
    today_visit: dict[str, Visit] = {}
    today = datetime.now(IST).date().isoformat()
    for v in visits:  # oldest first, so the latest wins
        if v.promise_date:
            promise[v.customer_id] = v.promise_date
        if v.beat_id == beat.id and v.visited_at[:10] == today:
            today_visit[v.customer_id] = v

    out = []
    for r, c in rows:
        aging = _customer_aging(ledger[c.id])
        out.append({
            "customer_id": c.id,
            "full_name": c.full_name,
            "business_name": c.business_name,
            "visit_order": r.visit_order,
            "outstanding_amount": c.outstanding_amount,
            "overdue_amount": aging["d31_60"] + aging["d61_90"] + aging["d90_plus"],
            "credit_limit": c.credit_limit,
            "last_promise_date": promise.get(c.id),
            "today_visit": visit_dto(today_visit[c.id]) if c.id in today_visit else None,
        })
    return out


def beat_dto(beat: Beat) -> dict:
    return {
        "id": beat.id,
        "name": beat.name,
        "weekdays": [int(d) for d in beat.weekdays.split(",") if d],
        "assigned_user_id": beat.assigned_user_id,
        "deleted": bool(beat.deleted_at),
    }


def beat_dto_with_team(db: Session, beat: Beat) -> dict:
    names = dict(db.execute(select(BusinessMember.user_id, BusinessMember.display_name).where(
        BusinessMember.business_id == beat.business_id)).all())
    mobiles = dict(db.execute(select(User.id, User.mobile).join(
        BeatAssignment, BeatAssignment.user_id == User.id).where(BeatAssignment.beat_id == beat.id)).all())
    return {**beat_dto(beat), "assignments": [
        {"user_id": a.user_id, "role": a.role, "valid_from": a.valid_from, "valid_to": a.valid_to,
         "name": names.get(a.user_id), "mobile": mobiles.get(a.user_id)}
        for a in upcoming(db, beat.id)]}


def visit_dto(v: Visit) -> dict:
    return {
        "id": v.id,
        "client_id": v.client_id,
        "beat_id": v.beat_id,
        "customer_id": v.customer_id,
        "outcome": v.outcome,
        "reason": v.reason,
        "promise_date": v.promise_date,
        "visited_at": v.visited_at,
    }


def visit_history(db: Session, business: Business, user: User, role: str, *, customer_id: str | None,
                  user_id: str | None, beat_id: str | None, start: str | None, end: str | None,
                  limit: int) -> list[dict]:
    """Past visits, newest first. Staff only ever see their own."""
    if not _sees_all(role):
        user_id = user.id
    q = (select(Visit, Customer.full_name, Beat.name, User.mobile, BusinessMember.display_name)
         .join(Customer, Customer.id == Visit.customer_id)
         .join(Beat, Beat.id == Visit.beat_id)
         .join(User, User.id == Visit.user_id, isouter=True)
         .join(BusinessMember, (BusinessMember.user_id == Visit.user_id)
               & (BusinessMember.business_id == business.id), isouter=True)
         .where(Visit.business_id == business.id)
         .order_by(Visit.visited_at.desc()).limit(limit))
    if customer_id:
        q = q.where(Visit.customer_id == customer_id)
    if user_id:
        q = q.where(Visit.user_id == user_id)
    if beat_id:
        q = q.where(Visit.beat_id == beat_id)
    if start:
        q = q.where(Visit.visited_at >= start)
    if end:
        q = q.where(Visit.visited_at < f"{end}T99")
    return [{**visit_dto(v), "customer_name": name, "beat_name": beat, "user_id": v.user_id,
             "user_mobile": mobile, "user_name": who} for v, name, beat, mobile, who in db.execute(q).all()]
