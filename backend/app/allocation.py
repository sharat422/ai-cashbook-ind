"""Payments against bills.

A bill is a credit entry (a sale on credit, an item bill's or a GST invoice's
entry); the entry's id is the bill's identity. A payment pays bills through:
- its allocations (payment_allocations), picked when it was recorded;
- what it already is: a cash GST sale's payment (paid_entry_id), a credit note
  (its invoice), an item bill's return (the bill returned).
Those go first. Whatever is not linked to a bill (every payment from before
allocations existed, AI entry, imports) is then used up on the oldest bills
still open, as the ageing always did. So the bills left open always add up to
the balance (credits − payments), and anything paid beyond every bill is an
advance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from .models import Bill, CreditNote, LedgerEntry, PaymentAllocation

Links = dict[str, list[tuple[str, int]]]  # payment id -> [(bill id, paise)]


def paise(amount) -> int:
    return int((Decimal(str(amount)) * 100).quantize(Decimal(1), ROUND_HALF_UP))


def rupees(p: int) -> str:
    return f"{Decimal(p) / 100:.2f}"


@dataclass
class BillState:
    entry: LedgerEntry
    amount: int
    paid: int = 0

    @property
    def left(self) -> int:
        return self.amount - self.paid

    @property
    def status(self) -> str:
        return "paid" if self.left <= 0 else "part" if self.paid > 0 else "open"


@dataclass
class View:
    bills: list[BillState]  # oldest first
    by_id: dict[str, BillState]
    linked: Links = field(default_factory=dict)  # what each payment actually paid, by bill
    unlinked: int = 0  # payments not linked to a bill, used up oldest first
    advance: int = 0  # paid beyond every bill


def links(db: Session, business_id: str, customer_id: str | None = None) -> Links:
    """Every payment's bills, stored or implied, for a business (or one customer)."""
    out: Links = {}
    q = select(PaymentAllocation).where(PaymentAllocation.business_id == business_id)
    if customer_id:
        q = q.where(PaymentAllocation.customer_id == customer_id)
    for a in db.scalars(q.order_by(PaymentAllocation.created_at)):
        out.setdefault(a.payment_id, []).append((a.bill_id, a.amount_paise))
    implied = select(CreditNote.ledger_entry_id, CreditNote.invoice_entry_id).where(
        CreditNote.business_id == business_id, CreditNote.ledger_entry_id.is_not(None),
        CreditNote.invoice_entry_id.is_not(None))
    orig = aliased(Bill)
    returns = (select(Bill.ledger_entry_id, orig.ledger_entry_id).join(orig, orig.id == Bill.reverses_id)
               .where(Bill.business_id == business_id, Bill.ledger_entry_id.is_not(None),
                      orig.ledger_entry_id.is_not(None)))
    if customer_id:
        returns = returns.where(Bill.customer_id == customer_id)
    for q in (implied, returns):
        for pay_id, bill_id in db.execute(q):
            out.setdefault(pay_id, []).append((bill_id, -1))  # -1: the whole payment
    return out


def view(entries: list[LedgerEntry], links: Links | None = None) -> View:
    """Each bill's paid and left, for one customer's entries in the books."""
    links = links or {}
    order = sorted(entries, key=lambda e: (e.date, e.created_at or ""))
    bills = [BillState(e, paise(e.amount)) for e in order if e.type == "credit"]
    by_id = {b.entry.id: b for b in bills}
    v = View(bills, by_id)
    for p in (e for e in order if e.type == "payment"):
        rest = paise(p.amount)
        wanted = list(links.get(p.id, []))
        if p.paid_entry_id:
            wanted.append((p.paid_entry_id, -1))
        for bill_id, amount in wanted:
            b = by_id.get(bill_id)  # a bill out of the books (cancelled) pays nothing
            take = min(rest if amount < 0 else amount, rest, b.left if b else 0)
            if take > 0:
                b.paid += take
                rest -= take
                v.linked.setdefault(p.id, []).append((bill_id, take))
        v.unlinked += rest
    pool = v.unlinked
    for b in bills:
        take = min(pool, b.left)
        if take > 0:
            b.paid += take
            pool -= take
    v.advance = pool
    return v


def bill_dto(b: BillState) -> dict:
    e = b.entry
    return {"id": e.id, "date": e.date, "number": e.invoice_number, "amount": rupees(b.amount),
            "paid": rupees(b.paid), "left": rupees(max(b.left, 0)), "status": b.status}


def paid_bills(v: View, payment_id: str) -> list[dict]:
    """What one payment paid, bill by bill (empty: not linked to a bill)."""
    return [{"bill_id": bid, "number": v.by_id[bid].entry.invoice_number, "date": v.by_id[bid].entry.date,
             "amount": rupees(p)} for bid, p in v.linked.get(payment_id, [])]
