"""Payment reminders: who needs chasing today (the owner's rules), a shared
history of every reminder sent (automatic or by hand, from any phone), and the
scheduled job that sends the automatic ones.

An automatic reminder is the retailer's WhatsApp statement (balance due and a
link), through statement_send.bulk: only retailers who opted in to WhatsApp
statements, only the approved statement template, at most one WhatsApp message
a day, 9 a.m. to 8 p.m. IST. Everyone else stays on the due list to be sent by
hand (a WhatsApp or SMS link on the phone), which is recorded here too.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import allocation
from . import beats as beat_svc
from . import statement_send as sending
from . import statements as st
from .config import settings
from .models import (Beat, BeatRetailer, Business, BusinessMember, Customer, LedgerEntry, ReminderEvent,
                     ReminderRule, User, in_books)

OVERDUE_AFTER = 30  # days: when the app calls a bill overdue (the day list's Overdue figure)
DEFAULTS = {"enabled": False, "before_promise_days": 1, "overdue_days": 3, "repeat_days": 7, "beat_id": None}


def rules(db: Session, business: Business) -> ReminderRule:
    """The business's rules (unsaved defaults until the owner saves them)."""
    r = db.scalars(select(ReminderRule).where(ReminderRule.business_id == business.id)).first()
    return r or ReminderRule(business_id=business.id, **DEFAULTS)


def rules_dto(r: ReminderRule) -> dict:
    return {"enabled": bool(r.enabled), "beforePromiseDays": r.before_promise_days, "overdueDays": r.overdue_days,
            "repeatDays": r.repeat_days, "beatId": r.beat_id, "updatedAt": r.updated_at}


def _when(iso: str) -> datetime:
    at = datetime.fromisoformat(iso)
    return at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at


def due(db: Session, business: Business, customers: list[Customer], r: ReminderRule, today: date) -> list[dict]:
    """Who needs a reminder today, and why:
      * promise: an open promise to pay falls due within `before_promise_days`,
        and nobody reminded them since the promise was made;
      * overdue: the oldest unpaid bill is `overdue_days` past due (bills fall due
        after 30 days), or a promise to pay was missed; again every `repeat_days`.
    Either rule is off when its days are None."""
    if not customers:
        return []
    ids = [c.id for c in customers]
    entries: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id.in_(ids), in_books())):
        entries[e.customer_id].append(e)
    links = allocation.links(db, business.id)
    promises = beat_svc.open_promises(db, ids)
    last = dict(db.execute(select(ReminderEvent.customer_id, func.max(ReminderEvent.created_at)).where(
        ReminderEvent.business_id == business.id, ReminderEvent.customer_id.in_(ids),
        ReminderEvent.status == "sent").group_by(ReminderEvent.customer_id)).all())
    out = []
    for c in customers:
        p, sent = promises.get(c.id), last.get(c.id)
        reason, detail = None, {}
        if r.before_promise_days is not None and p:
            days = (date.fromisoformat(p["date"]) - today).days
            if 0 <= days <= r.before_promise_days and not (sent and _when(sent) > _when(p["made_at"])):
                reason, detail = "promise", {"promiseDate": p["date"], "promiseAmount": p["remaining"]}
        if reason is None and r.overdue_days is not None and c.outstanding_amount > 0:
            unpaid = [b.entry.date for b in allocation.view(entries[c.id], links).bills if b.left > 0]
            late = (today - date.fromisoformat(min(unpaid))).days - OVERDUE_AFTER if unpaid else None
            missed = bool(p and p["date"] < today.isoformat())
            recent = sent and (today - _when(sent).astimezone(sending.IST).date()).days < r.repeat_days
            if ((late is not None and late >= r.overdue_days) or missed) and not recent:
                reason = "overdue"
                detail = {"daysOverdue": late if late is not None and late > 0 else None,
                          "promiseDate": p["date"] if missed else None}
        if reason:
            out.append({"customerId": c.id, "fullName": c.full_name, "mobile": c.mobile,
                        "outstandingAmount": c.outstanding_amount, "reason": reason, **detail,
                        "lastReminderAt": sent,
                        "optedIn": st.consent(db, business.id, c.id)["status"] == "opted_in"})
    return out


def visible_customers(db: Session, business: Business, user: User, role: str, beat_id: str | None) -> list[Customer]:
    """One beat's retailers (checked against the person's beats), or: the owner's
    whole list; staff, the retailers on their beats."""
    if beat_id:
        beat_svc.assert_beat_access(db, business, user, role, beat_id)
        beat_ids = [beat_id]
    elif beat_svc._sees_all(role):
        return list(db.scalars(select(Customer).where(Customer.business_id == business.id)
                               .order_by(Customer.full_name)))
    else:
        beat_ids = [b.id for b in beat_svc.list_beats(db, business, user, role)]
    return list(db.scalars(select(Customer).where(
        Customer.business_id == business.id,
        Customer.id.in_(select(BeatRetailer.customer_id).where(BeatRetailer.beat_id.in_(beat_ids))))
        .order_by(Customer.full_name)))


def record(db: Session, business: Business, customer_id: str, *, channel: str, reason: str, status: str,
           message: str | None, user: User | None, note: str | None = None) -> ReminderEvent:
    ev = ReminderEvent(business_id=business.id, customer_id=customer_id, channel=channel, reason=reason,
                       status=status, message=message, note=note, sent_by=user.id if user else None)
    db.add(ev)
    return ev


def event_dto(e: ReminderEvent, names: dict[str, str | None], customers: dict[str, str]) -> dict:
    return {"id": e.id, "customerId": e.customer_id, "customerName": customers.get(e.customer_id),
            "channel": e.channel, "reason": e.reason, "status": e.status, "message": e.message, "note": e.note,
            "automatic": e.sent_by is None, "sentBy": e.sent_by, "sentByName": names.get(e.sent_by or ""),
            "createdAt": e.created_at}


def history(db: Session, business: Business, customer_ids: list[str] | None, limit: int) -> list[dict]:
    q = select(ReminderEvent).where(ReminderEvent.business_id == business.id)
    if customer_ids is not None:
        q = q.where(ReminderEvent.customer_id.in_(customer_ids))
    rows = db.scalars(q.order_by(ReminderEvent.created_at.desc()).limit(limit)).all()
    names = {}
    for m, u in db.execute(select(BusinessMember, User).join(User, User.id == BusinessMember.user_id)
                           .where(BusinessMember.business_id == business.id)):
        names[u.id] = m.display_name or u.mobile
    customers = dict(db.execute(select(Customer.id, Customer.full_name).where(
        Customer.id.in_({e.customer_id for e in rows}))).all()) if rows else {}
    return [event_dto(e, names, customers) for e in rows]


def run(db: Session, now: datetime | None = None) -> list[dict]:
    """The scheduled job: for each business that turned automatic reminders on,
    send today's due retailers their WhatsApp statement (statement_send.bulk, with
    all its caps) and record each outcome in the shared history."""
    now = now or sending.ist_now()
    ran = []
    for r in db.scalars(select(ReminderRule).where(ReminderRule.enabled.is_(True))).all():
        business = db.get(Business, r.business_id)
        if business is None or (r.beat_id and db.get(Beat, r.beat_id) is None):
            continue
        rows = {d["customerId"]: d for d in due(db, business, sending.retailers(db, business, r.beat_id), r, now.date())}
        customers = [c for c in sending.retailers(db, business, r.beat_id) if c.id in rows]

        def outcome(c: Customer, key: str) -> None:
            if key == "sent":
                record(db, business, c.id, channel="whatsapp_server", reason=rows[c.id]["reason"], status="sent",
                       user=None, message=f"WhatsApp statement ({settings.whatsapp_statement_template}): "
                                          f"balance {st.inr(st.money(c.outstanding_amount))} and a link to it.")
            elif key == "failed":
                record(db, business, c.id, channel="whatsapp_server", reason=rows[c.id]["reason"], status="failed",
                       user=None, message=None, note="WhatsApp refused the message (see the statement log).")

        try:
            result = sending.bulk(db, business, None, customers, now=now, outcome=outcome) if customers else {"sent": 0}
        except HTTPException as exc:  # outside 9–8, or the template isn't approved: nothing sent
            result = {"stopped": exc.detail}
        db.commit()
        ran.append({"businessId": business.id, "due": len(rows), **result})
    return ran
