"""Beat plan: which retailers a staff member visits, in what order, on which days.

Isolation lives HERE, not in the router: every read or write of a beat goes
through `assert_beat_access`, so a staff member can only ever touch beats
assigned to them, whichever endpoint calls in. Owners and accountants
(DATA_VIEW) see every beat of their business.
"""

from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .calc import IST
from .models import Beat, BeatRetailer, Business, Customer, LedgerEntry, User, Visit
from .rbac import DATA_VIEW, role_can
from .routers.customer_insights import _customer_aging


def _sees_all(role: str) -> bool:
    return role_can(role, DATA_VIEW)


def assert_beat_access(db: Session, business: Business, user: User, role: str, beat_id: str) -> Beat:
    """The beat, or 404 if it isn't this business's, or 403 if the caller is
    staff and it isn't assigned to them."""
    beat = db.get(Beat, beat_id)
    if beat is None or beat.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Beat not found")
    if not _sees_all(role) and beat.assigned_user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This beat isn't assigned to you.")
    return beat


def list_beats(db: Session, business: Business, user: User, role: str) -> list[Beat]:
    query = select(Beat).where(Beat.business_id == business.id).order_by(Beat.name)
    if not _sees_all(role):
        query = query.where(Beat.assigned_user_id == user.id)
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
    }


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
