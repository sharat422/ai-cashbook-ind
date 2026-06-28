from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_business
from ..models import Business, Expense
from ..serializers import expense_dto
from ..storage import save_upload

router = APIRouter(tags=["expenses"])


@router.get("/expenses")
def list_expenses(
    business: Business = Depends(get_current_business),
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
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    existing = db.scalars(
        select(Expense).where(
            Expense.business_id == business.id, Expense.client_id == client_id
        )
    ).first()
    if existing is not None:
        return expense_dto(existing)

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
    db.commit()
    db.refresh(row)
    return expense_dto(row)
