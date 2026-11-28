from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..discards import refuse_if_discarded
from ..database import get_db
from ..deps import get_current_user, require
from ..rbac import DATA_VIEW, ENTRY_CREATE, ENTRY_DELETE, ENTRY_EDIT
from .. import corrections
from ..models import Business, Income, User
from ..serializers import income_dto
from ..storage import save_upload
from ..validation import validate_amount, validate_date, validate_notes, validate_text

router = APIRouter(tags=["incomes"])


@router.get("/incomes")
def list_incomes(
    business: Business = Depends(require(DATA_VIEW)),
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
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    amount = validate_amount(amount)
    category = validate_text(category, "Category", 60)
    date = validate_date(date, allow_future=False)
    client_id = validate_text(client_id, "Client ID", 80)
    notes = validate_notes(notes, 280)
    # Idempotency: a retried offline submission must not create a duplicate.
    find = select(Income).where(Income.business_id == business.id, Income.client_id == client_id)
    existing = db.scalars(find).first()
    if existing is not None:
        return income_dto(existing)
    refuse_if_discarded(db, business.id, client_id)  # IM5: discarded by the owner on the phone

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
    try:
        db.commit()
    except IntegrityError:  # a concurrent retry with this client_id saved first
        db.rollback()
        return income_dto(db.scalars(find).one())
    db.refresh(row)
    return income_dto(row)



# --- Corrections (owner only): edited or deleted in place, logged (app/corrections.py).

class IncomeEdit(BaseModel):
    amount: float | None = None
    category: str | None = None
    date: str | None = None
    notes: str | None = None  # "" clears them


@router.patch("/incomes/{income_id}")
def edit_income(
    income_id: str,
    body: IncomeEdit,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    row = corrections.owned(db, Income, business, income_id)
    new = {}
    if body.amount is not None:
        new["amount"] = validate_amount(body.amount)
    if body.category is not None:
        new["category"] = validate_text(body.category, "Category", 60)
    if body.date is not None:
        new["date"] = validate_date(body.date, allow_future=False)
    if body.notes is not None:
        new["notes"] = validate_notes(body.notes, 280)
    corrections.edit(db, business, user, row, new)
    db.commit()
    db.refresh(row)
    return income_dto(row)


@router.delete("/incomes/{income_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_income(
    income_id: str,
    business: Business = Depends(require(ENTRY_DELETE)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    corrections.delete(db, business, user, corrections.owned(db, Income, business, income_id))
    db.commit()
