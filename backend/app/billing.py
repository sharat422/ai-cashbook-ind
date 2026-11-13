"""Item bills to retailers, with schemes applied by the server.

A saved bill: its lines and scheme lines, the scheme log, a credit entry for
the total on the retailer's ledger, and stock out (paid + free goods) of the
godown or the salesperson's van. Bills carry no GST in this phase.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .discards import refuse_if_discarded
from . import gst, stock
from .beats import assert_beat_access
from .calc import recompute_customer, today_iso
from .errors import AppError
from .models import (BeatRetailer, Bill, BillLine, BillSeries, Business, Customer, Item, LedgerEntry, Scheme,
                     SchemeApplication, SchemeItem, User)
from .schemes import ZERO, ZERO_QTY, Rule, evaluate, evaluate_bill, money

MAX_LINES = 200


def _reject(msg: str, code: int = 422) -> HTTPException:
    return HTTPException(code, msg)


# ------------------------------------------------------------- bill numbers

def _old_bills_in(db: Session, business_id: str, fy: str) -> int:
    """Bills dated in that year before its series existed (B-1, B-2…): the
    series carries on after them."""
    start, end = f"20{fy[:2]}-04-01", f"20{fy[3:]}-03-31"
    return db.scalar(select(func.count()).select_from(Bill).where(
        Bill.business_id == business_id, Bill.date >= start, Bill.date <= end)) or 0


def prefix_of(db: Session, business_id: str) -> str:
    """The prefix of the latest year's series (the owner's setting), else "B"."""
    return db.scalar(select(BillSeries.prefix).where(BillSeries.business_id == business_id)
                     .order_by(BillSeries.financial_year.desc()).limit(1)) or "B"


def series_for(db: Session, business: Business, fy: str) -> BillSeries:
    row = db.scalars(select(BillSeries).where(BillSeries.business_id == business.id,
                                              BillSeries.financial_year == fy)).first()
    if row is None:
        try:
            with db.begin_nested():  # two first bills of a year at once: one row wins
                row = BillSeries(business_id=business.id, financial_year=fy, prefix=prefix_of(db, business.id),
                                 current_number=_old_bills_in(db, business.id, fy))
                db.add(row)
        except IntegrityError:
            row = db.scalars(select(BillSeries).where(BillSeries.business_id == business.id,
                                                      BillSeries.financial_year == fy)).one()
    return row


def next_bill_number(db: Session, business: Business, day: str) -> str:
    """The next bill number in the bill date's financial year — the GST
    invoice rule (routers/customers._issue_invoice_number): the business row
    lock, then one atomic increment, so two bills at once get two consecutive
    numbers. It rolls back with a refused bill, so there are no gaps either."""
    db.execute(select(Business.id).where(Business.id == business.id).with_for_update())
    fy = gst.financial_year(day)
    row = series_for(db, business, fy)
    n = db.execute(update(BillSeries).where(BillSeries.id == row.id)
                   .values(current_number=BillSeries.current_number + 1)
                   .returning(BillSeries.current_number),
                   execution_options={"synchronize_session": False}).scalar_one()
    return f"{row.prefix}-{fy}-{n}"


def series_dto(db: Session, business: Business, day: str) -> dict:
    """The prefix and the number the next bill dated `day` would get."""
    fy = gst.financial_year(day)
    row = db.scalars(select(BillSeries).where(BillSeries.business_id == business.id,
                                              BillSeries.financial_year == fy)).first()
    prefix = row.prefix if row else prefix_of(db, business.id)
    n = (row.current_number if row else _old_bills_in(db, business.id, fy)) + 1
    return {"prefix": prefix, "financialYear": fy, "nextNumber": f"{prefix}-{fy}-{n}"}


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


def compute(db: Session, business: Business, day: str, lines_in: list, customer_id: str | None = None) -> dict:
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
                      "amount": money(qty * rate), "rate_changed": rate != _rate(None, item.sale_price)})

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

    every = rules(db, business)
    results = evaluate(lines, [r for r in every if r.level == "line"], day, rate_of)
    subtotal = sum((ln["amount"] for ln in lines), ZERO)
    line_discount = sum((r["applied"]["benefit"].discount for r in results if r["applied"]), ZERO)
    # Then once per bill, on what's left after the line schemes.
    bill_scheme, bill_not_applied = evaluate_bill(every, day, customer_id, subtotal - line_discount)
    discount = line_discount + (bill_scheme["discount"] if bill_scheme else ZERO)
    total = subtotal - discount
    assert total >= 0, "a scheme made a bill negative"  # discounts are capped per line
    for ln, r in zip(lines, results):
        ln["scheme"] = r["applied"]
        ln["not_applied"] = r["not_applied"]
        if r["applied"] and r["applied"]["benefit"].free_item_id:
            ln["free_item"] = item_of(r["applied"]["benefit"].free_item_id)
    return {"lines": lines, "subtotal": subtotal, "discount": discount, "total": total,
            "bill_scheme": bill_scheme, "bill_not_applied": bill_not_applied}


def _qty(x: Decimal) -> str:
    return f"{Decimal(x).quantize(stock.QTY):f}"


WHOLE_BILL = ""  # the scheme log's item_id for a bill-level scheme


def group_note(group: dict | None, c: dict) -> str | None:
    """"6 Soap A + 4 Soap B = 10 · free: Soap B" for a group scheme's lines."""
    if not group:
        return None
    name = {ln["item_id"]: ln["item"].name for ln in c["lines"]}
    parts = " + ".join(f"{_short(q)} {name.get(i, i)}" for i, q in group["lines"])
    free = f" · free: {name.get(group['freeLine'], group['freeLine'])}" if group["freeLine"] else ""
    return f"{parts} = {_short(group['total'])}{free}"


def _short(q: Decimal) -> str:
    return f"{Decimal(q).normalize():f}"


def preview_dto(c: dict) -> dict:
    out = []
    for ln in c["lines"]:
        a = ln["scheme"]
        scheme = None
        if a:
            b = a["benefit"]
            free = ln.get("free_item")
            scheme = {"schemeId": a["rule"].id, "name": a["rule"].name, "type": a["rule"].type,
                      "group": group_note(a.get("group"), c), "scope": a["rule"].scope,
                      "freeItemId": b.free_item_id, "freeItemName": free.name if free else None,
                      "freeQty": _qty(b.free_qty), "discount": f"{b.discount:.2f}",
                      "value": f"{a['value']:.2f}"}
        out.append({"itemId": ln["item_id"], "name": ln["item"].name, "unit": ln["item"].unit,
                    "quantity": _qty(ln["quantity"]), "rate": f"{ln['rate']:.2f}",
                    "rateChanged": ln["rate_changed"],
                    "amount": f"{ln['amount']:.2f}", "scheme": scheme,
                    "notApplied": [{"schemeId": x["rule"].id, "name": x["rule"].name,
                                    "reason": x["reason"]} for x in ln["not_applied"]]})
    bs = c.get("bill_scheme")
    return {"lines": out, "subtotal": f"{c['subtotal']:.2f}", "discount": f"{c['discount']:.2f}",
            "total": f"{c['total']:.2f}",
            # The bill-level scheme, its own line; and the ones it beat, with the reason.
            "billScheme": None if not bs else {"schemeId": bs["rule"].id, "name": bs["rule"].name,
                                               "type": bs["rule"].type, "discount": f"{bs['discount']:.2f}"},
            "billNotApplied": [{"schemeId": x["rule"].id, "name": x["rule"].name, "reason": x["reason"]}
                               for x in c.get("bill_not_applied", [])]}


def save(db: Session, business: Business, user: User, role: str, *, customer_id: str, day: str,
         location: str, van_user_id: str | None, lines_in: list, client_id: str | None,
         beat_id: str | None = None, queued: bool = False) -> Bill:
    # A retry of a bill already saved (a lost response, or the offline queue
    # syncing twice) returns that bill: one bill, one number.
    if client_id:
        existing = db.scalars(select(Bill).where(Bill.business_id == business.id,
                                                 Bill.client_id == client_id)).first()
        if existing is not None:
            return existing
        refuse_if_discarded(db, business.id, client_id)  # IM5: discarded by the owner on the phone
    customer = db.get(Customer, customer_id)
    if customer is None or customer.business_id != business.id:
        raise _reject("Customer not found", 404)
    where = stock.place(db, business, user, role, location, van_user_id)
    stock.assert_open(db, business, day)  # the bill takes stock out on its date
    if beat_id:
        assert_beat_access(db, business, user, role, beat_id)
        if db.scalars(select(BeatRetailer).where(BeatRetailer.beat_id == beat_id,
                                                 BeatRetailer.customer_id == customer.id)).first() is None:
            raise _reject("This customer isn't on that beat.")
    c = compute(db, business, day, lines_in, customer_id=customer.id)
    if queued:
        # Made offline: a scheme it gets that has ended since goes back to the
        # owner (the conflict screen) rather than being given after its dates.
        today = today_iso()
        for e in [ln["scheme"] for ln in c["lines"] if ln["scheme"]] + ([c["bill_scheme"]] if c["bill_scheme"] else []):
            if not e["rule"].live_on(today):
                raise AppError(409, "scheme_ended", f"Scheme '{e['rule'].name}' ended on {e['rule'].valid_to}, "
                               "after this bill was made offline.", scheme=e["rule"].name, date=e["rule"].valid_to)

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
        Item.track_stock.is_(True)).order_by(Item.id)).all()}
    # Locks in one order everywhere (bills, returns): the business row (the
    # number) first, then stock rows by item id — two bills can't deadlock.
    number = next_bill_number(db, business, day)
    # One conditional UPDATE per item (stock.take: qty >= n or nothing), the
    # S2 race fix; CHECK (qty >= 0) backs it up. If any line is short the whole
    # bill is refused (422) and nothing commits — no partial bill, no number used.
    for item_id, item in tracked.items():
        stock.take(db, business, item, where, needed[item_id])

    bill = Bill(business_id=business.id, customer_id=customer.id, bill_number=number,
                date=day, location=where[0], van_user_id=where[1], subtotal=c["subtotal"],
                discount=c["discount"], total=c["total"], client_id=client_id,
                created_by=user.id)
    db.add(bill)
    db.flush()
    for ln in c["lines"]:
        item = ln["item"]
        db.add(BillLine(bill_id=bill.id, item_id=item.id, item_name=item.name, unit=item.unit,
                        quantity=ln["quantity"], rate=ln["rate"], amount=ln["amount"],
                        rate_changed=ln["rate_changed"]))
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
                group_note=group_note(entry.get("group"), c) if applied else None,
                discount=b.discount if applied else ZERO,
                value=entry["value"] if applied else ZERO))
    # The bill-level scheme (its own "whole bill" line in the log), and the ones it beat.
    bill_logs = ([(c["bill_scheme"], "applied", None)] if c["bill_scheme"] else []) + \
                [(x, "not_applied", x["reason"]) for x in c["bill_not_applied"]]
    for entry, status, reason in bill_logs:
        rule, off = entry["rule"], entry.get("discount", ZERO) if status == "applied" else ZERO
        db.add(SchemeApplication(
            business_id=business.id, bill_id=bill.id, customer_id=customer.id, date=day,
            scheme_id=rule.id, scheme_name=rule.name, scheme_type=rule.type, item_id=WHOLE_BILL,
            item_name="Whole bill", status=status, reason=reason, quantity=ZERO_QTY,
            free_qty=ZERO_QTY, discount=off, value=off))
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


def cancel(db: Session, business: Business, user: User, bill_id: str, item_ids: list[str] | None,
           day: str) -> Bill:
    """Cancel a bill, or return some of its lines (item_ids), by reversal —
    never an edit. A reversal bill with the lines negated points at the
    original; the goods (and those lines' free goods) go back to the place they
    came from; a 'bill_return' entry lowers what the retailer owes by the
    lines' net amount (less their line discount and their share of any bill
    discount); the scheme log gets 'reversed' rows so the report nets out. The
    original is marked cancelled / partly_returned. Owner only (the router)."""
    bill = db.get(Bill, bill_id)
    if bill is None or bill.business_id != business.id:
        raise _reject("Bill not found", 404)
    if bill.reverses_id:
        raise _reject("This is a return; it can't be returned again.")
    stock.assert_open(db, business, day)
    lines = list(db.scalars(select(BillLine).where(BillLine.bill_id == bill.id)))
    open_lines = [ln for ln in lines if not ln.returned]
    if not open_lines:
        raise _reject("This bill is already cancelled.")
    picked = open_lines if not item_ids else [ln for ln in open_lines if ln.item_id in set(item_ids)]
    if item_ids and len(picked) != len(set(item_ids)):
        raise _reject("Pick lines of this bill that haven't been returned yet.")
    apps = list(db.scalars(select(SchemeApplication).where(SchemeApplication.bill_id == bill.id,
                                                           SchemeApplication.status == "applied")))
    line_app = {a.item_id: a for a in apps if a.item_id != WHOLE_BILL}
    whole = next((a for a in apps if a.item_id == WHOLE_BILL), None)
    net = {ln.item_id: ln.amount - (line_app[ln.item_id].discount if ln.item_id in line_app else ZERO) for ln in lines}
    all_net = sum(net.values(), ZERO)
    share = {i: (money(whole.discount * n / all_net) if whole and all_net else ZERO) for i, n in net.items()}
    refund = sum((net[ln.item_id] - share[ln.item_id] for ln in picked), ZERO)

    customer = db.get(Customer, bill.customer_id)
    where = (bill.location, bill.van_user_id)
    # The return takes the next number; the cancelled bill keeps its own.
    rev = Bill(business_id=business.id, customer_id=bill.customer_id, bill_number=next_bill_number(db, business, day),
               date=day,
               location=bill.location, van_user_id=bill.van_user_id, reverses_id=bill.id,
               subtotal=-sum((ln.amount for ln in picked), ZERO),
               discount=-sum((ln.amount for ln in picked), ZERO) + refund, total=-refund, created_by=user.id)
    db.add(rev)
    db.flush()
    back: dict[str, Decimal] = {}
    for ln in picked:
        ln.returned = True
        db.add(BillLine(bill_id=rev.id, item_id=ln.item_id, item_name=ln.item_name, unit=ln.unit,
                        quantity=-ln.quantity, rate=ln.rate, amount=-ln.amount, rate_changed=ln.rate_changed))
        back[ln.item_id] = back.get(ln.item_id, ZERO_QTY) + ln.quantity
        a = line_app.get(ln.item_id)
        if a is not None:
            if a.free_item_id and a.free_qty > 0:
                back[a.free_item_id] = back.get(a.free_item_id, ZERO_QTY) + a.free_qty
            db.add(_reversed(a, rev, day, ln.quantity))
        if whole is not None and share[ln.item_id] > 0:
            db.add(_reversed(whole, rev, day, ZERO_QTY, discount=share[ln.item_id], item=(ln.item_id, ln.item_name)))
    items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_(list(back)), Item.business_id == business.id,
                                                             Item.track_stock.is_(True)).order_by(Item.id))}
    for item_id, item in items.items():
        stock.put(db, business, item, where, back[item_id])
        db.add(stock._move(business, item, where, "sale", back[item_id], day, user, group_id=rev.id,
                           note=f"return of bill {bill.bill_number}"))
    if refund > 0:
        entry = LedgerEntry(customer_id=customer.id, type="payment", amount=float(refund), date=day,
                            payment_method="bill_return", invoice_number=rev.bill_number,
                            notes=f"Return of bill {bill.bill_number} ({len(picked)} line(s)) · {rev.bill_number}",
                            client_id=f"billret:{rev.id}", salesman_id=user.id)
        db.add(entry)
        db.flush()
        rev.ledger_entry_id = entry.id
        recompute_customer(db, customer)
    bill.status = "cancelled" if all(ln.returned for ln in lines) else "partly_returned"
    for item in items.values():
        stock._sync_total(db, business, item)
    db.commit()
    db.refresh(rev)
    return rev


def _reversed(a: SchemeApplication, rev: Bill, day: str, qty: Decimal, *, discount: Decimal | None = None,
              item: tuple[str, str] | None = None) -> SchemeApplication:
    """The scheme log's mirror of an applied row, on the reversal bill."""
    off = a.discount if discount is None else discount
    return SchemeApplication(
        business_id=a.business_id, bill_id=rev.id, customer_id=a.customer_id, date=day, scheme_id=a.scheme_id,
        scheme_name=a.scheme_name, scheme_type=a.scheme_type, item_id=a.item_id if item is None else WHOLE_BILL,
        item_name=a.item_name, status="reversed", reason=f"Return of bill (reverses {a.bill_id})",
        quantity=-qty, free_item_id=a.free_item_id, free_item_name=a.free_item_name,
        free_qty=-(a.free_qty if discount is None else ZERO_QTY), discount=-off,
        value=-(a.value if discount is None else off), group_note=a.group_note)


def bill_dto(db: Session, bill: Bill) -> dict:
    lines = db.scalars(select(BillLine).where(BillLine.bill_id == bill.id)).all()
    apps = db.scalars(select(SchemeApplication).where(SchemeApplication.bill_id == bill.id)).all()
    return {
        "id": bill.id, "billNumber": bill.bill_number, "customerId": bill.customer_id,
        "date": bill.date, "location": bill.location, "vanUserId": bill.van_user_id,
        "subtotal": f"{bill.subtotal:.2f}", "discount": f"{bill.discount:.2f}",
        "total": f"{bill.total:.2f}", "ledgerEntryId": bill.ledger_entry_id,
        "status": bill.status, "reversesId": bill.reverses_id,
        "reversals": [{"id": r.id, "billNumber": r.bill_number, "date": r.date, "total": f"{r.total:.2f}"}
                      for r in db.scalars(select(Bill).where(Bill.reverses_id == bill.id).order_by(Bill.created_at))],
        "lines": [{"itemId": ln.item_id, "name": ln.item_name, "unit": ln.unit,
                   "quantity": _qty(ln.quantity), "rate": f"{ln.rate:.2f}",
                   "rateChanged": bool(ln.rate_changed),
                   "amount": f"{ln.amount:.2f}", "returned": bool(ln.returned)} for ln in lines],
        "schemes": [application_dto(a) for a in apps],
    }


def application_dto(a: SchemeApplication) -> dict:
    return {"id": a.id, "billId": a.bill_id, "customerId": a.customer_id, "date": a.date,
            "schemeId": a.scheme_id, "schemeName": a.scheme_name, "schemeType": a.scheme_type,
            "itemId": a.item_id, "itemName": a.item_name, "status": a.status, "reason": a.reason,
            "quantity": _qty(a.quantity), "freeItemId": a.free_item_id,
            "freeItemName": a.free_item_name, "freeQty": _qty(a.free_qty),
            "discount": f"{a.discount:.2f}", "value": f"{a.value:.2f}", "groupNote": a.group_note}
