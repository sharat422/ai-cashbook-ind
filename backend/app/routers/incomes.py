from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_business
from ..models import Business, Income
from ..serializers import income_dto
from ..storage import save_upload

router = APIRouter(tags=["incomes"])


@router.get("/incomes")
def list_incomes(
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = db.scalars(
        select(Income)
        .where(Income.business_id == business.id)
        .order_by(Income.date.desc(), Income.created_at.desc())
    ).all()
    return [income_dto(r) for r in rows]


@router.post("/incomes")
def create_income(
    amount: float = Form(...),
    category: str = Form(...),
    date: str = Form(...),
    client_id: str = Form(...),
    notes: str | None = Form(None),
    attachment: UploadFile | None = File(None),
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    # Idempotency: a retried offline submission must not create a duplicate.
    existing = db.scalars(
        select(Income).where(
            Income.business_id == business.id, Income.client_id == client_id
        )
    ).first()
    if existing is not None:
        return income_dto(existing)

    row = Income(
        business_id=business.id,
        amount=amount,
        category=category,
        date=date,
        notes=notes,
        client_id=client_id,
        attachment_url=save_upload(attachment),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return income_dto(row)
