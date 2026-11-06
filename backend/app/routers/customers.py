import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..calc import recompute_customer
from ..database import get_db
from ..beats import assert_beat_access
from ..deps import get_current_membership, require
from ..rbac import DATA_VIEW, ENTRY_CREATE, ENTRY_DELETE, ENTRY_EDIT
from ..models import BankLine, BeatRetailer, Business, Customer, LedgerEntry, User, Visit, now_iso
from ..security import get_current_user
from ..serializers import customer_dto, ledger_dto
from ..storage import save_upload
from ..validation import validate_date, validate_text, validate_amount, validate_mobile

router = APIRouter(tags=["customers"])


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
    db.query(BeatRetailer).filter(BeatRetailer.customer_id == customer_id).delete(synchronize_session=False)
    # A bank line matched to one of these entries goes back to unmatched.
    entry_ids = select(LedgerEntry.id).where(LedgerEntry.customer_id == customer_id)
    db.query(BankLine).filter(BankLine.matched_entry_id.in_(entry_ids)).update(
        {BankLine.matched_entry_id: None, BankLine.confirmed_by: None, BankLine.confirmed_at: None},
        synchronize_session=False)
    db.delete(customer)
    db.commit()


class CreditLimitBody(BaseModel):
    credit_limit: float | None = Field(alias="creditLimit")


@router.put("/customers/{customer_id}/credit-limit")
def set_credit_limit(
    customer_id: str,
    body: CreditLimitBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Set (or clear, with null) the customer's credit limit in INR."""
    customer = _owned_customer(db, business, customer_id)
    customer.credit_limit = (
        None if body.credit_limit is None else validate_amount(body.credit_limit)
    )
    customer.updated_at = now_iso()
    db.commit()
    db.refresh(customer)
    return customer_dto(customer)


# --- Ledger sub-resource -------------------------------------------------
PAYMENT_METHODS = ("cash", "upi", "bank", "card", "cheque", "credit", "other")
_REFERENCE_RE = re.compile(r"^[A-Za-z0-9/_.-]{6,40}$")


def _validate_payment(
    entry_type: str, method: str | None, reference: str | None
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
    beat_id: str | None = Form(None),
    attachment: UploadFile | None = File(None),
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
    payment_method, reference_number = _validate_payment(type, payment_method, reference_number)

    existing = db.scalars(
        select(LedgerEntry).where(
            LedgerEntry.customer_id == customer_id,
            LedgerEntry.client_id == client_id,
        )
    ).first()
    if existing is not None:
        return ledger_dto(existing)

    if beat_id:
        # Staff may only tag their own beat, and only a shop that is on it.
        assert_beat_access(db, business, user, membership[1], beat_id)
        on_beat = db.scalars(select(BeatRetailer).where(
            BeatRetailer.beat_id == beat_id, BeatRetailer.customer_id == customer_id)).first()
        if on_beat is None:
            raise HTTPException(422, "This customer isn't on that beat.")

    row = LedgerEntry(
        customer_id=customer_id,
        type=type,
        amount=amount,
        date=date,
        invoice_number=invoice_number,
        notes=notes,
        payment_method=payment_method,
        reference_number=reference_number,
        client_id=client_id,
        salesman_id=user.id,
        beat_id=beat_id or None,
        attachment_url=save_upload(attachment),
    )
    db.add(row)
    db.flush()
    recompute_customer(db, customer)
    db.commit()
    db.refresh(row)
    return ledger_dto(row)
