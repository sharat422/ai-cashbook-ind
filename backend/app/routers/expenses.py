from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..discards import refuse_if_discarded
from ..database import get_db
from ..deps import require
from ..rbac import DATA_VIEW, ENTRY_CREATE
from ..models import Business, Expense
from ..serializers import expense_dto
from ..storage import save_upload
from ..validation import validate_amount, validate_date, validate_notes, validate_text

router = APIRouter(tags=["expenses"])


@router.get("/expenses")
def list_expenses(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = db.scalars(
        select(Expense)
        .where(Expense.business_id == business.id)
        .order_by(Expense.date.desc(), Expense.created_at.desc())
    ).all()
    return [expense_dto(r) for r in rows]


@router.post("/expenses")
def create_expense(
    amount: float = Form(...),
    category: str = Form(...),
    date: str = Form(...),
    vendor: str = Form(...),
    client_id: str = Form(...),
    notes: str | None = Form(None),
    attachment: UploadFile | None = File(None),
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    amount = validate_amount(amount)
    vendor = validate_text(vendor, "Vendor", 200)
    category = validate_text(category, "Category", 60)
    date = validate_date(date, allow_future=False)
    client_id = validate_text(client_id, "Client ID", 80)
    notes = validate_notes(notes, 5000)
    find = select(Expense).where(Expense.business_id == business.id, Expense.client_id == client_id)
    existing = db.scalars(find).first()
    if existing is not None:
        return expense_dto(existing)
    refuse_if_discarded(db, business.id, client_id)  # IM5: discarded by the owner on the phone

    row = Expense(
        business_id=business.id,
        amount=amount,
        category=category,
        vendor=vendor,
        date=date,
        notes=notes,
        client_id=client_id,
        attachment_url=save_upload(attachment),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:  # a concurrent retry with this client_id saved first
        db.rollback()
        return expense_dto(db.scalars(find).one())
    db.refresh(row)
    return expense_dto(row)
