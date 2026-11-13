"""GST credit notes (s.34, Rule 53): sales returns, post-supply discounts and
other corrections of an issued GST invoice. The invoice is never edited.

- A note has its own consecutive number per FY ("CN26-27/00001").
- Its amount is taxable value; the tax is worked out at the invoice's rate,
  CGST+SGST or IGST as on the invoice. Notes on one invoice can't add up to
  more than the invoice's taxable value.
- It reduces the buyer's balance through a 'credit_note' payment, which is
  never a collection (reconciliation and the daily close skip it).
- Deadline (s.34(2)): 30 November after the end of the FY of the invoice.
- Proviso to s.34(2): for a registered buyer the seller's tax goes down (in
  the GSTR-3B summary) only once the buyer's ITC reversal is confirmed;
  the note is reported in GSTR-1 Table 9B either way.
"""
from datetime import date as Date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import gst
from ..calc import recompute_customer
from ..database import get_db
from ..deps import require
from ..gst_reports import B2CL_LIMIT
from ..models import Business, CreditNote, Customer, LedgerEntry, User, in_books, now_iso
from ..rbac import DATA_VIEW, ENTRY_EDIT
from ..security import get_current_user
from ..validation import validate_date

router = APIRouter(tags=["gst"])

REASONS = ("return", "discount", "other")


def deadline(invoice_day: str) -> str:
    """30 November after the end of the invoice's financial year (s.34(2))."""
    y, m = int(invoice_day[:4]), int(invoice_day[5:7])
    return f"{y + 1 if m >= 4 else y}-11-30"  # FY Apr 2025–Mar 2026 → 30 Nov 2026


def note_number(fy: str, serial: int) -> str:
    return f"CN{fy}/{serial:05d}"  # 'CN26-27/00001' — 13 characters (16 max)


class CreditNoteBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    client_id: str = Field(alias="clientId", min_length=1, max_length=80)
    invoice_id: str = Field(alias="invoiceId", max_length=40)
    reason: str
    amount: Decimal = Field(description="Taxable value credited (before GST)")
    quantity: Decimal | None = None  # a return: how many came back
    date: str
    buyer_itc_reversed: bool = Field(default=False, alias="buyerItcReversed")
    note: str | None = Field(default=None, max_length=500)


class ItcBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    buyer_itc_reversed: bool = Field(alias="buyerItcReversed")


def credit_note_dto(n: CreditNote) -> dict:
    return {
        "id": n.id, "number": n.number, "date": n.date, "reason": n.reason,
        "invoiceId": n.invoice_entry_id, "invoiceNumber": n.invoice_number, "invoiceDate": n.invoice_date,
        "customerName": n.customer_name, "customerGstin": n.customer_gstin,
        "hsn": n.hsn_code, "rate": f"{Decimal(n.gst_rate).normalize():f}",
        "quantity": None if n.quantity is None else f"{Decimal(n.quantity).normalize():f}", "uqc": n.uqc,
        "taxableValue": gst.money(n.taxable_value), "cgst": gst.money(n.cgst), "sgst": gst.money(n.sgst),
        "igst": gst.money(n.igst),
        "total": gst.money(Decimal(n.taxable_value) + n.cgst + n.sgst + n.igst),
        "buyerRegistered": n.buyer_registered, "buyerItcReversed": n.buyer_itc_reversed,
        "reducesTax": n.reduces_tax, "note": n.note, "createdAt": n.created_at,
    }


def _invoice(db: Session, business: Business, entry_id: str) -> tuple[LedgerEntry, Customer]:
    row = db.execute(select(LedgerEntry, Customer).join(Customer, Customer.id == LedgerEntry.customer_id)
                     .where(LedgerEntry.id == entry_id, Customer.business_id == business.id,
                            LedgerEntry.type == "credit", LedgerEntry.gst_rate.is_not(None),
                            in_books())).first()  # an issued invoice: not a draft or cancelled
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "GST invoice not found")
    return row


@router.post("/gst/credit-notes")
def create_credit_note(
    body: CreditNoteBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Issue a credit note against one GST invoice."""
    done = db.scalars(select(CreditNote).where(CreditNote.business_id == business.id,
                                               CreditNote.client_id == body.client_id)).first()
    if done is not None:  # a retry of the same note
        return credit_note_dto(done)
    if body.reason not in REASONS:
        raise HTTPException(422, "Reason must be return, discount or other.")
    day = validate_date(body.date)
    inv, cust = _invoice(db, business, body.invoice_id)
    if day < inv.date:
        raise HTTPException(422, "A credit note can't be dated before its invoice.")
    last_day = deadline(inv.date)
    if day > last_day:
        d = Date.fromisoformat(last_day)
        raise HTTPException(422, f"The deadline for a credit note on invoice {inv.invoice_number} "
                                 f"(FY {gst.financial_year(inv.date)}) was {d.day} Nov {d.year}.")
    amount = Decimal(str(body.amount)).quantize(Decimal("0.01"))
    if amount <= 0:
        raise HTTPException(422, "Enter the amount being credited.")
    # Lock the business row: one number at a time, and no two notes overspending one invoice.
    db.execute(select(Business.id).where(Business.id == business.id).with_for_update())
    already = db.scalar(select(func.coalesce(func.sum(CreditNote.taxable_value), 0))
                        .where(CreditNote.invoice_entry_id == inv.id)) or 0
    room = Decimal(inv.taxable_value) - Decimal(already)
    if amount > room:
        raise HTTPException(422, f"Invoice {inv.invoice_number} has ₹{room:.2f} of taxable value left "
                                 f"to credit (of ₹{Decimal(inv.taxable_value):.2f}).")
    if body.quantity is not None and (body.quantity <= 0 or (inv.gst_quantity and body.quantity > inv.gst_quantity)):
        raise HTTPException(422, "The quantity can't be more than on the invoice.")
    tax = gst.split(amount, Decimal(inv.gst_rate), inclusive=False, inter_state=Decimal(inv.igst or 0) > 0)
    fy = gst.financial_year(day)
    serial = (db.scalar(select(func.max(CreditNote.serial)).where(
        CreditNote.business_id == business.id, CreditNote.fy == fy)) or 0) + 1
    registered = bool(inv.customer_gstin)
    invoice_total = Decimal(inv.taxable_value) + (inv.cgst or 0) + (inv.sgst or 0) + (inv.igst or 0)
    n = CreditNote(
        business_id=business.id, client_id=body.client_id, invoice_entry_id=inv.id, fy=fy, serial=serial,
        number=note_number(fy, serial), date=day, reason=body.reason,
        invoice_number=inv.invoice_number or "", invoice_date=inv.date, customer_name=cust.business_name or cust.full_name,
        customer_gstin=inv.customer_gstin, place_of_supply=inv.place_of_supply,
        invoice_b2cl=not registered and Decimal(inv.igst or 0) > 0 and invoice_total > B2CL_LIMIT,
        hsn_code=inv.hsn_code, gst_rate=inv.gst_rate, quantity=body.quantity, uqc=inv.gst_uqc,
        taxable_value=tax["taxable_value"], cgst=tax["cgst"], sgst=tax["sgst"], igst=tax["igst"],
        buyer_registered=registered, buyer_itc_reversed=registered and body.buyer_itc_reversed,
        itc_reversed_at=now_iso() if registered and body.buyer_itc_reversed else None,
        note=body.note, created_by=user.id)
    db.add(n)
    db.flush()
    pay = LedgerEntry(customer_id=cust.id, type="payment", amount=float(tax["total"]), date=day,
                      payment_method="credit_note", client_id=f"cn:{n.id}", salesman_id=user.id,
                      notes=f"Credit note {n.number} against invoice {n.invoice_number}")
    db.add(pay)
    db.flush()
    n.ledger_entry_id = pay.id
    recompute_customer(db, cust)
    db.commit()
    return credit_note_dto(n)


@router.patch("/gst/credit-notes/{note_id}")
def set_itc_reversed(
    note_id: str,
    body: ItcBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Record whether the registered buyer has reversed the ITC. Until they
    have, the note doesn't reduce the seller's tax in the GSTR-3B summary."""
    n = db.get(CreditNote, note_id)
    if n is None or n.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Credit note not found")
    if not n.buyer_registered:
        raise HTTPException(422, "The buyer isn't GST-registered, so there's no ITC to reverse.")
    if n.buyer_itc_reversed != body.buyer_itc_reversed:
        n.buyer_itc_reversed = body.buyer_itc_reversed
        n.itc_reversed_at = now_iso() if body.buyer_itc_reversed else None
        db.commit()
    return credit_note_dto(n)


@router.get("/gst/credit-notes")
def list_credit_notes(
    invoice_id: str | None = Query(None, alias="invoiceId"),
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    q = select(CreditNote).where(CreditNote.business_id == business.id)
    if invoice_id:
        q = q.where(CreditNote.invoice_entry_id == invoice_id)
    return [credit_note_dto(n) for n in db.scalars(q.order_by(CreditNote.fy, CreditNote.serial))]
