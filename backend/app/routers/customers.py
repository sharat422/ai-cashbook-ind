from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..calc import recompute_customer
from ..database import get_db
from ..deps import get_current_business
from ..models import Business, Customer, LedgerEntry
from ..serializers import customer_dto, ledger_dto
from ..storage import save_upload

router = APIRouter(tags=["customers"])


class CustomerBody(BaseModel):
    full_name: str
    mobile: str
    gst_number: str | None = None
    business_name: str | None = None
    address: str | None = None
    notes: str | None = None


def _owned_customer(db: Session, business: Business, customer_id: str) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None or customer.business_id != business.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found"
        )
    return customer


@router.get("/customers")
def list_customers(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
    search: str | None = None,
    business: Business = Depends(get_current_business),
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
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    return customer_dto(_owned_customer(db, business, customer_id))


@router.post("/customers")
def create_customer(
    body: CustomerBody,
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    row = Customer(business_id=business.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return customer_dto(row)


@router.patch("/customers/{customer_id}")
def update_customer(
    customer_id: str,
    body: CustomerBody,
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    customer = _owned_customer(db, business, customer_id)
    for key, value in body.model_dump().items():
        setattr(customer, key, value)
    db.commit()
    db.refresh(customer)
    return customer_dto(customer)


@router.delete("/customers/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(
    customer_id: str,
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> None:
    customer = _owned_customer(db, business, customer_id)
    db.delete(customer)
    db.commit()


# --- Ledger sub-resource -------------------------------------------------
@router.get("/customers/{customer_id}/ledger")
def list_ledger(
    customer_id: str,
    business: Business = Depends(get_current_business),
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
    attachment: UploadFile | None = File(None),
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    customer = _owned_customer(db, business, customer_id)

    existing = db.scalars(
        select(LedgerEntry).where(
            LedgerEntry.customer_id == customer_id,
            LedgerEntry.client_id == client_id,
        )
    ).first()
    if existing is not None:
        return ledger_dto(existing)

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
        attachment_url=save_upload(attachment),
    )
    db.add(row)
    db.flush()
    recompute_customer(db, customer)
    db.commit()
    db.refresh(row)
    return ledger_dto(row)
