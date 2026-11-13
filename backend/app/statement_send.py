"""Server-sent WhatsApp statements: one at a time (the owner's button) or in
bulk (ST7: all retailers or a beat, now or on the monthly schedule).

ONE sending path with the caps of a business-started message, for every
server send that goes out without the owner pressing a button per retailer:
  * only to retailers who opted in for this distributor (the statement consent);
  * only via the approved UTILITY template (ST1), variables only;
  * at most one WhatsApp message per retailer per day (IST);
  * only 9 a.m. to 8 p.m. IST;
  * a batch stops once more than 10% of its sends fail (after the first 10) —
    a failing batch is a template or consent problem, not a queue to drain.
Every outcome is in the statement log, so the owner sees what went and why not.
"""
from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import statements as svc
from .calc import IST
from .config import settings
from .models import BeatRetailer, Business, Customer, StatementEvent, StatementSchedule, User
from .notifications import WhatsAppNotConfigured, WhatsAppSendError, send_whatsapp_template, template_status

WINDOW = (9, 20)          # IST hours: from 9:00, before 20:00
FAIL_STOP = 0.10          # stop a batch above this failure rate...
MIN_SAMPLE = 10           # ...once this many sends were tried (one bad number early isn't a trend)
WHATSAPP_TO_RETAILER = ("whatsapp_server", "whatsapp_phone", "pdf_whatsapp")


def ist_now() -> datetime:
    return datetime.now(IST)


def in_window(now: datetime) -> bool:
    return WINDOW[0] <= now.hour < WINDOW[1]


def messaged_today(db: Session, business_id: str, customer_id: str, now: datetime) -> bool:
    """Any WhatsApp statement / file from this distributor to this retailer today (IST)."""
    since = datetime.combine(now.date(), time(0), IST).astimezone(timezone.utc).isoformat()  # stored in UTC
    return db.scalar(select(StatementEvent.id).where(
        StatementEvent.business_id == business_id, StatementEvent.customer_id == customer_id,
        StatementEvent.kind.in_(("sent", "shared")), StatementEvent.channel.in_(WHATSAPP_TO_RETAILER),
        StatementEvent.created_at >= since)) is not None


def send_template(db: Session, business: Business, customer: Customer, user: User | None,
                  start: str | None, *, note: str = "", url: str | None = None) -> dict:
    """Send one retailer their statement with the approved template and log it.
    Raises WhatsAppSendError / WhatsAppNotConfigured (the caller logs the refusal)."""
    name = settings.whatsapp_statement_template
    url = url or svc.new_link(db, business, customer, user, start)
    st = svc.build(db, customer, start)
    params = [customer.full_name, business.business_name, svc.inr(st.current).replace("₹", ""), url]
    sent = send_whatsapp_template(customer.mobile, name, params)
    msg = (sent.get("messages") or [{}])[0]
    svc.log(db, business.id, customer.id, "sent", "owner" if user else "system", channel="whatsapp_server",
            user=user, note=f"{note}Template {name}: {msg.get('message_status', 'accepted')}",
            message_id=msg.get("id"))
    return {"url": url, "messageId": msg.get("id")}


def preview(db: Session, business: Business, customers: list[Customer], now: datetime) -> dict:
    opted = [c for c in customers if svc.consent(db, business.id, c.id)["status"] == "opted_in"]
    today = [c for c in opted if messaged_today(db, business.id, c.id, now)]
    name = settings.whatsapp_statement_template
    return {"total": len(customers), "optedIn": len(opted), "notOptedIn": len(customers) - len(opted),
            "alreadyToday": len(today), "noMobile": sum(1 for c in opted if not c.mobile),
            "willSend": len([c for c in opted if c.mobile and c not in today]),
            "template": name or None, "templateStatus": template_status(name), "inWindow": in_window(now)}


def bulk(db: Session, business: Business, user: User | None, customers: list[Customer], *,
         start: str | None = None, now: datetime | None = None) -> dict:
    """Send every opted-in retailer in `customers` their statement, with the caps
    above. Refused as a whole (422/409) outside the window or without an
    approved template; otherwise each retailer's outcome is logged."""
    now = now or ist_now()
    if not in_window(now):
        raise HTTPException(422, "Statements go out between 9 a.m. and 8 p.m. IST. Try again then.")
    name = settings.whatsapp_statement_template
    status = template_status(name)
    if status != "APPROVED":
        raise HTTPException(409, f"Server sends are off: the WhatsApp template '{name or '-'}' is {status}. "
                                 "Send from your phone instead, or wait for Meta's approval.")
    batch = now.strftime("%d %b %H:%M")
    last = ""
    out = {"sent": 0, "notOptedIn": 0, "alreadyToday": 0, "noMobile": 0, "failed": 0, "notTried": 0,
           "stopped": None}
    for i, c in enumerate(customers):
        def refuse(why: str, key: str) -> None:
            svc.log(db, business.id, c.id, "blocked", "system", channel="whatsapp_server",
                    note=f"Bulk send {batch}: {why}", user=user)
            out[key] += 1
        if svc.consent(db, business.id, c.id)["status"] != "opted_in":
            refuse("no WhatsApp opt-in from this retailer", "notOptedIn")
        elif messaged_today(db, business.id, c.id, now):
            refuse("already got a WhatsApp message today (1 a day)", "alreadyToday")
        elif not c.mobile:
            refuse("no mobile number", "noMobile")
        else:
            try:
                send_template(db, business, c, user, start, note=f"Bulk send {batch}: ")
                out["sent"] += 1
            except (WhatsAppSendError, WhatsAppNotConfigured) as exc:
                code = getattr(exc, "code", None)
                last = f"WhatsApp refused{f' ({code})' if code else ''}: {getattr(exc, 'reason', str(exc))}"
                refuse(last, "failed")
            tried = out["sent"] + out["failed"]
            if tried >= MIN_SAMPLE and out["failed"] / tried > FAIL_STOP:
                out["notTried"] = len(customers) - i - 1
                out["stopped"] = (f"Stopped: {out['failed']} of {tried} sends failed (over 10%). "
                                  f"Last error: {last}. This is usually the template or the "
                                  "retailers' numbers, not a queue to retry.")
                db.commit()
                break
        db.commit()
    return out


def retailers(db: Session, business: Business, beat_id: str | None) -> list[Customer]:
    """Everyone (not opted in: skipped and counted), or one beat's retailers."""
    q = select(Customer).where(Customer.business_id == business.id)
    if beat_id:
        q = q.where(Customer.id.in_(select(BeatRetailer.customer_id).where(BeatRetailer.beat_id == beat_id)))
    return list(db.scalars(q.order_by(Customer.full_name)))


def run_schedules(db: Session, now: datetime | None = None) -> list[dict]:
    """The monthly sends that are due: enabled, on or after their day and hour
    this month (a missed hour catches up later the same month), not yet run
    this month, inside the window. Each runs once a month."""
    now = now or ist_now()
    if not in_window(now):
        return []
    month = now.strftime("%Y-%m")
    prev_start = (date(now.year, now.month, 1) - timedelta(days=1)).replace(day=1).isoformat()
    ran = []
    for s in db.scalars(select(StatementSchedule).where(StatementSchedule.enabled.is_(True))).all():
        due = now.day > s.day or (now.day == s.day and now.hour >= s.hour)
        if not due or s.last_run_month == month:
            continue
        business = db.get(Business, s.business_id)
        s.last_run_month = month  # claimed before sending: a crash mid-batch never sends twice
        db.commit()
        try:
            result = bulk(db, business, None, retailers(db, business, s.beat_id), start=prev_start, now=now)
        except HTTPException as exc:
            result = {"stopped": exc.detail}
        result["ranAt"] = now.isoformat()
        s.last_result = json.dumps(result)
        db.commit()
        ran.append({"businessId": business.id, **result})
    return ran
