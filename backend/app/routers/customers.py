import logging
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..discards import refuse_if_discarded
from .. import gst
from ..calc import recompute_customer
from ..crypto import blind_index
from ..database import get_db
from ..errors import AppError
from ..beats import assert_beat_access
from ..deps import get_current_membership, require
from ..rbac import DATA_VIEW, ENTRY_CREATE, ENTRY_DELETE, ENTRY_EDIT
from ..models import BankLine, BankMatch, BeatRetailer, Bill, BillLine, SchemeApplication, StatementEvent, StatementLink, Business, CreditNote, Customer, GstInvoiceNumber, LedgerEntry, PaymentUtr, User, Visit, now_iso
from ..security import get_current_user
from ..serializers import customer_dto, ledger_dto
from ..storage import save_upload
from ..validation import validate_date, validate_text, validate_amount, validate_mobile

router = APIRouter(tags=["customers"])
log = logging.getLogger(__name__)


class CustomerBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    full_name: str = Field(min_length=1, max_length=200)
    # Optional so quick flows (e.g. AI voice entry) can create a party by name;
    # the mobile can be filled in later from the customer form.
    mobile: str = ""
    gst_number: str | None = None
    business_name: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=5000)


_GST_COLUMNS = ("customer_gstin", "hsn_code", "place_of_supply", "gst_rate",
                "price_includes_gst", "taxable_value", "cgst", "sgst", "igst",
                "gst_quantity", "gst_uqc")
def _issue_invoice_number(db: Session, business: Business, day: str) -> GstInvoiceNumber:
    """The next consecutive GST invoice number for this business in that
    financial year (Rule 46). The server always assigns it; the business row
    lock makes two sales at once get two different numbers."""
    db.execute(select(Business.id).where(Business.id == business.id).with_for_update())
    fy = gst.financial_year(day)
    last = db.scalar(select(func.max(GstInvoiceNumber.serial)).where(
        GstInvoiceNumber.business_id == business.id, GstInvoiceNumber.fy == fy)) or 0
    issued = GstInvoiceNumber(business_id=business.id, fy=fy, serial=last + 1,
                              number=gst.invoice_number(fy, last + 1))
    db.add(issued)
    return issued


def _refuse_duplicate_utr(db: Session, business: Business, utr_hash: str) -> None:
    """409 naming the earlier payment, so the person can spot the typo."""
    earlier = db.execute(
        select(LedgerEntry, Customer)
        .join(PaymentUtr, PaymentUtr.ledger_entry_id == LedgerEntry.id)
        .join(Customer, Customer.id == LedgerEntry.customer_id)
        .where(PaymentUtr.business_id == business.id, PaymentUtr.utr_hash == utr_hash)
    ).first()
    if earlier is not None:
        entry, who = earlier
        d = entry.date
        raise AppError(409, "duplicate_utr", (
            f"This UTR is already on a UPI payment of ₹{entry.amount:,.2f} from {who.full_name} "
            f"on {d[8:10]}-{d[5:7]}-{d[:4]}. Each UPI payment has its own UTR — check for a typo."),
            amount=f"₹{entry.amount:,.2f}", customer=who.full_name, date=f"{d[8:10]}-{d[5:7]}-{d[:4]}")


def _ref_key(method: str | None, reference: str | None, bank: str | None, account: str | None) -> str | None:
    """Blind index for the bank-transfer / cheque duplicate WARNING. The rail
    is part of the key, so a UPI UTR is never compared with a bank reference.
    A cheque is only "the same" with the same number, bank and account."""
    if not reference or method not in ("bank", "cheque"):
        return None
    norm = lambda v: "".join((v or "").upper().split())  # noqa: E731
    parts = [method, norm(reference)] + ([norm(bank), norm(account)] if method == "cheque" else [])
    return blind_index("|".join(parts))


def _duplicate_ref(db: Session, business: Business, ref_hash: str) -> tuple[LedgerEntry, Customer] | None:
    return db.execute(
        select(LedgerEntry, Customer).join(Customer, Customer.id == LedgerEntry.customer_id)
        .where(Customer.business_id == business.id, LedgerEntry.ref_hash == ref_hash)
        .order_by(LedgerEntry.created_at)
    ).first()


def _ref_warning(method: str, earlier: LedgerEntry, who: Customer) -> dict:
    d = earlier.date
    what = "cheque" if method == "cheque" else "bank reference"
    return {"code": "duplicate_reference", "entryId": earlier.id, "customerName": who.full_name,
            "amount": f"{earlier.amount:.2f}", "date": d,
            "message": (f"Same {what} as ₹{earlier.amount:,.2f} from {who.full_name} on "
                        f"{d[8:10]}-{d[5:7]}-{d[:4]} — check it isn't entered twice.")}


class GstPreviewBody(BaseModel):
    amount: float
    rate: str
    price_includes_gst: bool = False
    customer_gstin: str | None = None
    place_of_supply: str | None = None
    date: str | None = None  # the invoice date decides which rates are allowed


@router.post("/gst/preview")
def gst_preview(
    body: GstPreviewBody,
    business: Business = Depends(require(ENTRY_CREATE)),
) -> dict:
    """The tax split the server will save for these inputs (nothing is saved).
    The app shows this instead of computing tax itself."""
    tax = gst.invoice(business, amount=validate_amount(body.amount), rate=body.rate,
                      inclusive=body.price_includes_gst, hsn=None,
                      customer_gstin=body.customer_gstin,
                      place_of_supply=body.place_of_supply,
                      day=validate_date(body.date) if body.date else None)
    return {
        "place_of_supply": gst.place_label(tax["place_of_supply"]),
        "inter_state": tax["inter_state"],
        **{k: gst.money(tax[k]) for k in ("taxable_value", "cgst", "sgst", "igst", "total")},
    }


def _owned_customer(db: Session, business: Business, customer_id: str) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None or customer.business_id != business.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )
    return customer


def _assert_mobile_unique(
    db: Session, business: Business, mobile: str, exclude_id: str | None = None
) -> None:
    """A mobile number identifies one customer within a business. Reject a second
    customer with the same number (empty mobile = party-by-name, no constraint)."""
    if not mobile:
        return
    q = select(Customer).where(
        Customer.business_id == business.id, Customer.mobile == mobile
    )
    if exclude_id is not None:
        q = q.where(Customer.id != exclude_id)
    if db.scalars(q).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A customer with this mobile number already exists.",
        )


@router.get("/customers")
def list_customers(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
    search: str | None = None,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    base = select(Customer).where(Customer.business_id == business.id)
    if search:
        like = f"%{search}%"
        base = base.where(
            or_(
                Customer.full_name.ilike(like),
                Customer.mobile.ilike(like),
                Customer.business_name.ilike(like),
            )
        )

    total = len(db.scalars(base).all())
    offset = int(cursor) if (cursor and cursor.isdigit()) else 0

    rows = db.scalars(
        base.order_by(Customer.full_name.asc()).offset(offset).limit(limit + 1)
    ).all()

    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = str(offset + limit) if has_more else None

    return {
        "items": [customer_dto(c) for c in items],
        "next_cursor": next_cursor,
        "total": total,
    }


@router.get("/customers/{customer_id}")
def get_customer(
    customer_id: str,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    return customer_dto(_owned_customer(db, business, customer_id))


@router.post("/customers")
def create_customer(
    body: CustomerBody,
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    # Server-side gate: mobile is optional (party-by-name), but must be valid if
    # given. Store the normalized digits so downstream (WhatsApp/UPI) is clean.
    data = body.model_dump()
    data["mobile"] = validate_mobile(body.mobile, required=False)
    _assert_mobile_unique(db, business, data["mobile"])
    row = Customer(business_id=business.id, **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return customer_dto(row)


@router.patch("/customers/{customer_id}")
def update_customer(
    customer_id: str,
    body: CustomerBody,
    expected_version: int | None = None,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    customer = _owned_customer(db, business, customer_id)

    # Optimistic concurrency: if the caller tells us which version it edited and
    # the row has moved on since (another device saved first), reject with 409
    # instead of clobbering the other edit. Omitting the token keeps the old
    # last-write-wins behaviour for callers that don't participate.
    if expected_version is not None and (customer.version or 1) != expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This customer was changed on another device. "
                "Reload the latest version and try again."
            ),
        )

    data = body.model_dump()
    data["mobile"] = validate_mobile(body.mobile, required=False)
    _assert_mobile_unique(db, business, data["mobile"], exclude_id=customer_id)
    for key, value in data.items():
        setattr(customer, key, value)
    customer.version = (customer.version or 1) + 1
    customer.updated_at = now_iso()
    db.commit()
    db.refresh(customer)
    return customer_dto(customer)


@router.delete("/customers/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(
    customer_id: str,
    business: Business = Depends(require(ENTRY_DELETE)),
    db: Session = Depends(get_db),
) -> None:
    customer = _owned_customer(db, business, customer_id)
    # Explicit: SQLite doesn't enforce ON DELETE CASCADE.
    db.query(Visit).filter(Visit.customer_id == customer_id).delete(synchronize_session=False)
    for model in (StatementLink, StatementEvent):  # explicit for SQLite
        db.query(model).filter(model.customer_id == customer_id).delete(synchronize_session=False)
    bill_ids = [b.id for b in db.scalars(select(Bill).where(Bill.customer_id == customer_id)).all()]
    if bill_ids:  # explicit for SQLite, which doesn't enforce the cascade
        for model in (SchemeApplication, BillLine):
            db.query(model).filter(model.bill_id.in_(bill_ids)).delete(synchronize_session=False)
        db.query(Bill).filter(Bill.id.in_(bill_ids)).delete(synchronize_session=False)
    db.query(BeatRetailer).filter(BeatRetailer.customer_id == customer_id).delete(synchronize_session=False)
    # A bank line matched to one of these entries goes back to unmatched.
    entry_ids = select(LedgerEntry.id).where(LedgerEntry.customer_id == customer_id)
    db.query(PaymentUtr).filter(PaymentUtr.ledger_entry_id.in_(entry_ids)).delete(synchronize_session=False)
    # Issued GST invoice numbers stay (as cancelled), so they're never reused.
    db.query(GstInvoiceNumber).filter(GstInvoiceNumber.ledger_entry_id.in_(entry_ids)).update(
        {GstInvoiceNumber.ledger_entry_id: None}, synchronize_session=False)
    db.query(BankMatch).filter(BankMatch.entry_id.in_(entry_ids)).delete(synchronize_session=False)
    db.delete(customer)
    db.commit()


class CreditLimitBody(BaseModel):
    credit_limit: float | None = Field(alias="creditLimit")
    # The limit version this save was based on (0 = "only if never set").
    # Omitted by old app versions only.
    expected_version: int | None = Field(default=None, alias="expectedVersion")


@router.put("/customers/{customer_id}/credit-limit")
def set_credit_limit(
    customer_id: str,
    body: CreditLimitBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Set (or clear, with null) the customer's credit limit in INR. If it was
    changed on another device since `expectedVersion`, nothing is saved: 409,
    and the app shows the server's limit (server wins, with a notice)."""
    customer = _owned_customer(db, business, customer_id)
    current = customer.credit_limit_version or 0
    if body.expected_version is not None and body.expected_version != current:
        now = "no limit" if customer.credit_limit is None else f"₹{customer.credit_limit:,.0f}"
        raise AppError(status.HTTP_409_CONFLICT, "credit_limit_changed",
                       f"The credit limit was changed on another device to {now}. Yours wasn't saved.",
                       limit="—" if customer.credit_limit is None else f"₹{customer.credit_limit:,.0f}")
    customer.credit_limit = (
        None if body.credit_limit is None else validate_amount(body.credit_limit)
    )
    customer.credit_limit_version = current + 1
    customer.updated_at = now_iso()
    db.commit()
    db.refresh(customer)
    return customer_dto(customer)


# --- Ledger sub-resource -------------------------------------------------
PAYMENT_METHODS = ("cash", "upi", "bank", "card", "cheque", "credit", "other")
_REFERENCE_RE = re.compile(r"^[A-Za-z0-9/_.-]{6,40}$")


def _validate_payment(
    entry_type: str, method: str | None, reference: str | None, utr_rule: bool = True
) -> tuple[str | None, str | None]:
    """Server-side rule: a UPI payment must carry its UTR / transaction ID, so
    it can be checked against the bank statement. Enforced here, not only in
    the app, so old app versions and direct API calls can't skip it."""
    method = (method or "").strip().lower() or None
    reference = (reference or "").strip() or None
    if method == "upi" and reference is not None:
        reference = reference.replace(" ", "")
    if method is not None and method not in PAYMENT_METHODS:
        raise HTTPException(422, "Unknown payment method.")
    if reference is not None and len(reference) > 40:
        raise HTTPException(422, "Reference must not exceed 40 characters.")
    if entry_type == "payment" and method == "upi":
        if reference is None:
            if not utr_rule:
                return method, None  # an old app's offline payment: saved, flagged utr_missing
            raise HTTPException(422, "Enter the UPI transaction ID (UTR) for a UPI payment.")
        if not _REFERENCE_RE.match(reference):
            raise HTTPException(422, "The UTR should be 6 to 40 letters or digits.")
    return method, reference

@router.get("/customers/{customer_id}/ledger")
def list_ledger(
    customer_id: str,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    _owned_customer(db, business, customer_id)
    rows = db.scalars(
        select(LedgerEntry)
        .where(LedgerEntry.customer_id == customer_id)
        .order_by(LedgerEntry.date.desc(), LedgerEntry.created_at.desc())
    ).all()
    return [ledger_dto(r) for r in rows]


@router.post("/customers/{customer_id}/ledger")
def add_ledger_entry(
    customer_id: str,
    type: str = Form(...),
    amount: float = Form(...),
    date: str = Form(...),
    client_id: str = Form(...),
    invoice_number: str | None = Form(None),
    notes: str | None = Form(None),
    payment_method: str | None = Form(None),
    reference_number: str | None = Form(None),
    cheque_bank: str | None = Form(None),  # cheque: the drawer's bank and account
    cheque_account: str | None = Form(None),
    beat_id: str | None = Form(None),
    # GST invoice (credit only): the server computes the tax split from these.
    gst_rate: str | None = Form(None),
    hsn_code: str | None = Form(None),
    quantity: str | None = Form(None),  # GST invoice: quantity and unit (UQC), both required
    uqc: str | None = Form(None),
    customer_gstin: str | None = Form(None),
    price_includes_gst: bool = Form(False),
    place_of_supply: str | None = Form(None),
    # A cash GST sale: the invoice is paid in full at once, in cash.
    paid_now: bool = Form(False),
    # A GST invoice saved as a draft: no number, editable, not in the books
    # until issued (POST .../ledger/{id}/issue).
    draft: bool = Form(False),
    attachment: UploadFile | None = File(None),
    # Sent by app versions that enforce the UTR rule. Older apps don't send it;
    # their UTR-less UPI payments (queued offline before the update) are kept.
    utr_rule: bool = Form(False),
    business: Business = Depends(require(ENTRY_CREATE)),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    customer = _owned_customer(db, business, customer_id)
    amount = validate_amount(amount)
    date = validate_date(date)
    client_id = validate_text(client_id, "Client ID", 80)
    if notes is not None and len(notes) > 5000:
        raise HTTPException(422, "Notes must not exceed 5000 characters.")
    if type not in ("credit", "payment"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Entry type must be 'credit' or 'payment'.",
        )
    payment_method, reference_number = _validate_payment(type, payment_method, reference_number,
                                                         utr_rule=utr_rule)
    utr_missing = type == "payment" and payment_method == "upi" and reference_number is None
    tax: dict = {}
    if gst_rate not in (None, ""):
        if type != "credit":
            raise HTTPException(422, "GST applies to a sale (credit), not a payment.")
        tax = gst.invoice(business, amount=amount, rate=gst_rate, inclusive=price_includes_gst,
                          hsn=hsn_code or "", customer_gstin=customer_gstin,
                          place_of_supply=place_of_supply, day=date)
        tax["gst_quantity"], tax["gst_uqc"] = gst.clean_line(quantity, uqc)
        amount = float(tax["total"])
    if paid_now and not tax:
        raise HTTPException(422, "Only a GST invoice can be marked paid now (a cash GST sale).")
    if draft and (not tax or paid_now):
        raise HTTPException(422, "Only a GST invoice on credit can be saved as a draft.")

    find = select(LedgerEntry).where(
        LedgerEntry.customer_id == customer_id, LedgerEntry.client_id == client_id)
    existing = db.scalars(find).first()
    if existing is not None:
        return ledger_dto(existing)
    refuse_if_discarded(db, business.id, client_id)  # IM5: discarded by the owner on the phone

    if beat_id:
        # Staff may only tag their own beat, and only a shop that is on it.
        assert_beat_access(db, business, user, membership[1], beat_id)
        on_beat = db.scalars(select(BeatRetailer).where(
            BeatRetailer.beat_id == beat_id, BeatRetailer.customer_id == customer_id)).first()
        if on_beat is None:
            raise HTTPException(422, "This customer isn't on that beat.")

    utr_hash = (blind_index(reference_number.upper())
                if type == "payment" and payment_method == "upi" and reference_number else None)
    if utr_hash:
        _refuse_duplicate_utr(db, business, utr_hash)
    cheque_bank, cheque_account = ((v or "").strip()[:60] or None if payment_method == "cheque" else None
                                   for v in (cheque_bank, cheque_account))
    ref_hash = _ref_key(payment_method, reference_number, cheque_bank, cheque_account) if type == "payment" else None
    repeat = _duplicate_ref(db, business, ref_hash) if ref_hash else None
    issued = _issue_invoice_number(db, business, date) if tax and not draft else None
    if issued is not None:
        invoice_number = issued.number  # never the app's own number for a GST invoice
    elif tax:
        invoice_number = None  # a draft gets its number when it's issued
    row = LedgerEntry(
        customer_id=customer_id,
        type=type,
        amount=amount,
        date=date,
        invoice_number=invoice_number,
        notes=notes,
        payment_method=payment_method,
        reference_number=reference_number,
        cheque_bank=cheque_bank,
        cheque_account=cheque_account,
        ref_hash=ref_hash,
        ref_duplicate_of=repeat[0].id if repeat else None,
        client_id=client_id,
        utr_missing=utr_missing or None,
        salesman_id=user.id,
        beat_id=beat_id or None,
        attachment_url=save_upload(attachment),
        **{k: tax[k] for k in _GST_COLUMNS if tax},
        gst_status="draft" if draft else None,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:  # a concurrent retry with this client_id saved first
        db.rollback()
        existing = db.scalars(find).first()
        if existing is None:
            raise HTTPException(409, "Another entry was saved at the same moment. Please try again.") from None
        return ledger_dto(existing)
    if issued is not None:
        issued.ledger_entry_id = row.id
    if paid_now:  # the same sale, paid on the spot: one payment for the invoice total
        db.add(LedgerEntry(customer_id=customer_id, type="payment", amount=row.amount, date=date,
                           payment_method="cash", client_id=f"{client_id}:paid"[:80], salesman_id=user.id,
                           beat_id=beat_id or None, paid_entry_id=row.id))
        db.flush()
    if utr_hash:
        db.add(PaymentUtr(business_id=business.id, utr_hash=utr_hash, ledger_entry_id=row.id))
        try:
            db.flush()
        except IntegrityError:  # the same UTR saved by another request this instant
            db.rollback()
            _refuse_duplicate_utr(db, business, utr_hash)
            raise
    recompute_customer(db, customer)
    db.commit()
    db.refresh(row)
    if repeat is None:
        return ledger_dto(row)
    log.info("duplicate %s reference: entry %s repeats %s", payment_method, row.id, repeat[0].id)
    return {**ledger_dto(row), "warning": _ref_warning(payment_method, *repeat)}


# --- GST invoice drafts: editable until issued; issued ones are locked ---------

def _gst_entry(db: Session, business: Business, customer_id: str, entry_id: str) -> tuple[LedgerEntry, Customer]:
    customer = _owned_customer(db, business, customer_id)
    entry = db.get(LedgerEntry, entry_id)
    if entry is None or entry.customer_id != customer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    return entry, customer


def _locked(entry: LedgerEntry) -> HTTPException:
    if entry.gst_rate is None:
        return HTTPException(422, "Entries can't be edited. Add a correcting entry instead.")
    if entry.gst_status == "cancelled":
        return HTTPException(422, "This invoice is cancelled.")
    return AppError(422, "invoice_locked", f"Invoice {entry.invoice_number} is issued and locked. Correct it "
                                           f"with a credit note, or cancel it and issue a new one.",
                    number=entry.invoice_number)


@router.put("/customers/{customer_id}/ledger/{entry_id}")
def edit_draft(
    customer_id: str,
    entry_id: str,
    amount: float = Form(...),
    date: str = Form(...),
    gst_rate: str = Form(...),
    hsn_code: str = Form(""),
    quantity: str | None = Form(None),
    uqc: str | None = Form(None),
    customer_gstin: str | None = Form(None),
    price_includes_gst: bool = Form(False),
    place_of_supply: str | None = Form(None),
    notes: str | None = Form(None),
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    """Change a draft GST invoice freely. An issued one is locked (422)."""
    entry, _customer = _gst_entry(db, business, customer_id, entry_id)
    if entry.gst_status != "draft":
        raise _locked(entry)
    amount, date = validate_amount(amount), validate_date(date)
    if notes is not None and len(notes) > 5000:
        raise HTTPException(422, "Notes must not exceed 5000 characters.")
    tax = gst.invoice(business, amount=amount, rate=gst_rate, inclusive=price_includes_gst, hsn=hsn_code,
                      customer_gstin=customer_gstin, place_of_supply=place_of_supply, day=date)
    tax["gst_quantity"], tax["gst_uqc"] = gst.clean_line(quantity, uqc)
    for k in _GST_COLUMNS:
        setattr(entry, k, tax[k])
    entry.amount, entry.date, entry.notes = float(tax["total"]), date, notes
    db.commit()
    db.refresh(entry)
    return ledger_dto(entry)


@router.delete("/customers/{customer_id}/ledger/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    customer_id: str,
    entry_id: str,
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> None:
    """Delete a draft: it never had a number, so it leaves no trace in Table 13.
    An issued invoice is never deleted (cancel it instead)."""
    entry, _customer = _gst_entry(db, business, customer_id, entry_id)
    if entry.gst_status != "draft":
        raise _locked(entry)
    db.delete(entry)
    db.commit()


@router.post("/customers/{customer_id}/ledger/{entry_id}/issue")
def issue_draft(
    customer_id: str,
    entry_id: str,
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    """Give a draft the next consecutive invoice number (the same allocation as
    a sale entered directly) and lock it. Issuing twice changes nothing."""
    entry, customer = _gst_entry(db, business, customer_id, entry_id)
    if entry.gst_status != "draft":
        if entry.gst_status is None and entry.gst_rate is not None:
            return ledger_dto(entry)  # already issued
        raise _locked(entry)
    issued = _issue_invoice_number(db, business, entry.date)  # locks the business row
    db.refresh(entry)  # another request may have issued it while we waited
    if entry.gst_status != "draft":
        db.rollback()
        return ledger_dto(db.get(LedgerEntry, entry_id))
    issued.ledger_entry_id = entry.id
    entry.invoice_number, entry.gst_status = issued.number, None
    db.flush()  # the recompute below reads the new status
    recompute_customer(db, customer)
    db.commit()
    db.refresh(entry)
    return ledger_dto(entry)


@router.post("/customers/{customer_id}/ledger/{entry_id}/cancel")
def cancel_invoice(
    customer_id: str,
    entry_id: str,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Cancel an issued GST invoice: it leaves the books and the exports, its
    number stays in Table 13 as cancelled and is never reused. A cash sale's
    payment goes with it. Refused once it has credit notes."""
    entry, customer = _gst_entry(db, business, customer_id, entry_id)
    if entry.gst_rate is None or entry.gst_status == "draft":
        raise HTTPException(422, "Only an issued GST invoice can be cancelled; delete a draft instead.")
    if entry.gst_status == "cancelled":
        return ledger_dto(entry)
    if db.scalars(select(CreditNote.id).where(CreditNote.invoice_entry_id == entry.id)).first():
        raise HTTPException(422, "This invoice has credit notes, so it can't be cancelled.")
    entry.gst_status = "cancelled"
    for paid in db.scalars(select(LedgerEntry).where(LedgerEntry.paid_entry_id == entry.id)):
        paid.gst_status = "cancelled"
    db.query(GstInvoiceNumber).filter(GstInvoiceNumber.ledger_entry_id == entry.id).update(
        {GstInvoiceNumber.ledger_entry_id: None}, synchronize_session=False)  # Table 13: cancelled
    db.flush()  # the recompute below reads the new status
    recompute_customer(db, customer)
    db.commit()
    db.refresh(entry)
    return ledger_dto(entry)


class UtrBody(BaseModel):
    utr: str = Field(max_length=60)


@router.patch("/customers/{customer_id}/ledger/{entry_id}/utr")
def add_missing_utr(
    customer_id: str,
    entry_id: str,
    body: UtrBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Add the UTR to a UPI payment an old app saved without one."""
    _owned_customer(db, business, customer_id)
    entry = db.get(LedgerEntry, entry_id)
    if entry is None or entry.customer_id != customer_id or not entry.utr_missing:
        raise HTTPException(404, "No UPI payment without a UTR here.")
    _, reference = _validate_payment("payment", "upi", body.utr)
    utr_hash = blind_index(reference.upper())
    _refuse_duplicate_utr(db, business, utr_hash)
    entry.reference_number, entry.utr_missing = reference, None
    db.add(PaymentUtr(business_id=business.id, utr_hash=utr_hash, ledger_entry_id=entry.id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _refuse_duplicate_utr(db, business, utr_hash)
        raise
    db.refresh(entry)
    return ledger_dto(entry)
