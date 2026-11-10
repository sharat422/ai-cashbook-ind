"""Item bills to retailers, with schemes applied by the server.

A saved bill: its lines and scheme lines, the scheme log, a credit entry for
the total on the retailer's ledger, and stock out (paid + free goods) of the
godown or the salesperson's van. Bills carry no GST in this phase.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import stock
from .beats import assert_beat_access
from .calc import recompute_customer
from .models import (BeatRetailer, Bill, BillLine, Business, Customer, Item, LedgerEntry, Scheme,
                     SchemeApplication, SchemeItem, User)
from .schemes import ZERO, ZERO_QTY, Rule, evaluate, money

MAX_LINES = 200


def _reject(msg: str, code: int = 422) -> HTTPException:
    return HTTPException(code, msg)


def _rate(value, default: float) -> Decimal:
    if value in (None, ""):
        return money(Decimal(str(default)))
    try:
        r = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise _reject("Enter the rate.") from None
    if not r.is_finite() or r < 0 or r != money(r) or r > Decimal("10000000"):
        raise _reject("Rate must be 0 or more, in rupees and paise.")
    return r


def rules(db: Session, business: Business) -> list[Rule]:
    rows = db.scalars(select(Scheme).where(Scheme.business_id == business.id)).all()
    links = db.execute(select(SchemeItem.scheme_id, SchemeItem.item_id)
                       .where(SchemeItem.scheme_id.in_([s.id for s in rows]))).all()
    items: dict[str, list[str]] = {}
    for sid, iid in links:
        items.setdefault(sid, []).append(iid)
    return [Rule.of(s, items.get(s.id, [])) for s in rows]


def compute(db: Session, business: Business, day: str, lines_in: list) -> dict:
    """Price the lines and apply schemes. Pure read: nothing is saved."""
    if not 1 <= len(lines_in) <= MAX_LINES:
        raise _reject(f"A bill needs 1 to {MAX_LINES} lines.")
    if len({ln.item_id for ln in lines_in}) != len(lines_in):
        raise _reject("Each item can be on a bill once — add to its quantity instead.")
    lines = []
    for ln in lines_in:
        item = stock.owned_item(db, business, ln.item_id)
        qty = stock.quantity(ln.quantity)
        rate = _rate(ln.rate, item.sale_price)
        lines.append({"item": item, "item_id": item.id, "quantity": qty, "rate": rate,
                      "amount": money(qty * rate)})

    billed_rate = {ln["item_id"]: ln["rate"] for ln in lines}
    names: dict[str, Item | None] = {ln["item_id"]: ln["item"] for ln in lines}

    def item_of(item_id: str) -> Item | None:
        if item_id not in names:
            it = db.get(Item, item_id)
            names[item_id] = it if it is not None and it.business_id == business.id else None
        return names[item_id]

    def rate_of(item_id: str) -> Decimal:
        if item_id in billed_rate:
            return billed_rate[item_id]
        it = item_of(item_id)
        return money(Decimal(str(it.sale_price))) if it else ZERO

    results = evaluate(lines, rules(db, business), day, rate_of)
    subtotal = sum((ln["amount"] for ln in lines), ZERO)
    discount = sum((r["applied"]["benefit"].discount for r in results if r["applied"]), ZERO)
    total = subtotal - discount
    assert total >= 0, "a scheme made a bill negative"  # discounts are capped per line
    for ln, r in zip(lines, results):
        ln["scheme"] = r["applied"]
        ln["not_applied"] = r["not_applied"]
        if r["applied"] and r["applied"]["benefit"].free_item_id:
            ln["free_item"] = item_of(r["applied"]["benefit"].free_item_id)
    return {"lines": lines, "subtotal": subtotal, "discount": discount, "total": total}


def _qty(x: Decimal) -> str:
    return f"{Decimal(x).quantize(stock.QTY):f}"


def preview_dto(c: dict) -> dict:
    out = []
    for ln in c["lines"]:
        a = ln["scheme"]
        scheme = None
        if a:
            b = a["benefit"]
            free = ln.get("free_item")
            scheme = {"schemeId": a["rule"].id, "name": a["rule"].name, "type": a["rule"].type,
                      "freeItemId": b.free_item_id, "freeItemName": free.name if free else None,
                      "freeQty": _qty(b.free_qty), "discount": f"{b.discount:.2f}",
                      "value": f"{a['value']:.2f}"}
        out.append({"itemId": ln["item_id"], "name": ln["item"].name, "unit": ln["item"].unit,
                    "quantity": _qty(ln["quantity"]), "rate": f"{ln['rate']:.2f}",
                    "amount": f"{ln['amount']:.2f}", "scheme": scheme,
                    "notApplied": [{"schemeId": x["rule"].id, "name": x["rule"].name,
                                    "reason": x["reason"]} for x in ln["not_applied"]]})
    return {"lines": out, "subtotal": f"{c['subtotal']:.2f}", "discount": f"{c['discount']:.2f}",
            "total": f"{c['total']:.2f}"}


def save(db: Session, business: Business, user: User, role: str, *, customer_id: str, day: str,
         location: str, van_user_id: str | None, lines_in: list, client_id: str | None,
         beat_id: str | None = None) -> Bill:
    if client_id:
        existing = db.scalars(select(Bill).where(Bill.business_id == business.id,
                                                 Bill.client_id == client_id)).first()
        if existing is not None:
            return existing
    customer = db.get(Customer, customer_id)
    if customer is None or customer.business_id != business.id:
        raise _reject("Customer not found", 404)
    where = stock.place(db, business, user, role, location, van_user_id)
    if beat_id:
        assert_beat_access(db, business, user, role, beat_id)
        if db.scalars(select(BeatRetailer).where(BeatRetailer.beat_id == beat_id,
                                                 BeatRetailer.customer_id == customer.id)).first() is None:
            raise _reject("This customer isn't on that beat.")
    c = compute(db, business, day, lines_in)

    # Stock out: paid quantity plus free goods, for items whose stock is tracked.
    needed: dict[str, Decimal] = {}
    for ln in c["lines"]:
        needed[ln["item_id"]] = needed.get(ln["item_id"], ZERO_QTY) + ln["quantity"]
        a = ln["scheme"]
        if a and a["benefit"].free_item_id and a["benefit"].free_qty > 0:
            fid = a["benefit"].free_item_id
            needed[fid] = needed.get(fid, ZERO_QTY) + a["benefit"].free_qty
    tracked = {i.id: i for i in db.scalars(select(Item).where(
        Item.id.in_(list(needed)), Item.business_id == business.id,
        Item.track_stock.is_(True))).all()}
    # Atomic per item; if any is short the whole bill is refused (nothing commits).
    for item_id, item in tracked.items():
        stock.take(db, business, item, where, needed[item_id])

    count = db.scalar(select(func.count()).select_from(Bill).where(Bill.business_id == business.id))
    bill = Bill(business_id=business.id, customer_id=customer.id, bill_number=f"B-{count + 1}",
                date=day, location=where[0], van_user_id=where[1], subtotal=c["subtotal"],
                discount=c["discount"], total=c["total"], client_id=client_id,
                created_by=user.id)
    db.add(bill)
    db.flush()
    for ln in c["lines"]:
        item = ln["item"]
        db.add(BillLine(bill_id=bill.id, item_id=item.id, item_name=item.name, unit=item.unit,
                        quantity=ln["quantity"], rate=ln["rate"], amount=ln["amount"]))
        logs = ([(ln["scheme"], "applied", None)] if ln["scheme"] else []) + \
               [(x, "not_applied", x["reason"]) for x in ln["not_applied"]]
        for entry, status, reason in logs:
            rule = entry["rule"]
            b = entry.get("benefit")
            applied = status == "applied"
            free = ln.get("free_item") if applied else None
            db.add(SchemeApplication(
                business_id=business.id, bill_id=bill.id, customer_id=customer.id, date=day,
                scheme_id=rule.id, scheme_name=rule.name, scheme_type=rule.type,
                item_id=item.id, item_name=item.name, status=status, reason=reason,
                quantity=ln["quantity"],
                free_item_id=b.free_item_id if applied else None,
                free_item_name=free.name if free else None,
                free_qty=b.free_qty if applied else ZERO_QTY,
                discount=b.discount if applied else ZERO,
                value=entry["value"] if applied else ZERO))
    for item_id, item in tracked.items():
        db.add(stock._move(business, item, where, "sale", -needed[item_id], day, user,
                           group_id=bill.id, note=f"bill {bill.bill_number}"))
    if c["total"] > 0:
        entry = LedgerEntry(customer_id=customer.id, type="credit", amount=float(c["total"]),
                            date=day, invoice_number=bill.bill_number,
                            notes=f"Bill {bill.bill_number} · {len(c['lines'])} item(s)",
                            client_id=f"bill:{bill.id}", salesman_id=user.id,
                            beat_id=beat_id or None)
        db.add(entry)
        db.flush()
        bill.ledger_entry_id = entry.id
        recompute_customer(db, customer)
    try:
        for item in tracked.values():
            stock._sync_total(db, business, item)
        db.commit()
    except IntegrityError:
        db.rollback()
        if client_id:
            existing = db.scalars(select(Bill).where(Bill.business_id == business.id,
                                                     Bill.client_id == client_id)).first()
            if existing is not None:
                return existing
        raise _reject("Another bill was saved at the same moment. Please try again.", 409)
    db.refresh(bill)
    return bill


def bill_dto(db: Session, bill: Bill) -> dict:
    lines = db.scalars(select(BillLine).where(BillLine.bill_id == bill.id)).all()
    apps = db.scalars(select(SchemeApplication).where(SchemeApplication.bill_id == bill.id)).all()
    return {
        "id": bill.id, "billNumber": bill.bill_number, "customerId": bill.customer_id,
        "date": bill.date, "location": bill.location, "vanUserId": bill.van_user_id,
        "subtotal": f"{bill.subtotal:.2f}", "discount": f"{bill.discount:.2f}",
        "total": f"{bill.total:.2f}", "ledgerEntryId": bill.ledger_entry_id,
        "lines": [{"itemId": ln.item_id, "name": ln.item_name, "unit": ln.unit,
                   "quantity": _qty(ln.quantity), "rate": f"{ln.rate:.2f}",
                   "amount": f"{ln.amount:.2f}"} for ln in lines],
        "schemes": [application_dto(a) for a in apps],
    }


def application_dto(a: SchemeApplication) -> dict:
    return {"id": a.id, "billId": a.bill_id, "customerId": a.customer_id, "date": a.date,
            "schemeId": a.scheme_id, "schemeName": a.scheme_name, "schemeType": a.scheme_type,
            "itemId": a.item_id, "itemName": a.item_name, "status": a.status, "reason": a.reason,
            "quantity": _qty(a.quantity), "freeItemId": a.free_item_id,
            "freeItemName": a.free_item_name, "freeQty": _qty(a.free_qty),
            "discount": f"{a.discount:.2f}", "value": f"{a.value:.2f}"}
