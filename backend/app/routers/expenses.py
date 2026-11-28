from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..discards import refuse_if_discarded
from ..database import get_db
from .. import corrections
from ..deps import get_current_user, require
from ..errors import AppError
from ..rbac import DATA_VIEW, ENTRY_CREATE, ENTRY_DELETE, ENTRY_EDIT
from ..models import Business, Expense, User
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
    # Optional: the app lets you save an expense with just an amount (quick add,
    # "Vendor / Paid to" left empty). It used to be required here, so those
    # expenses were refused and stayed "waiting to sync" on the phone.
    vendor: str = Form(""),
    client_id: str = Form(...),
    notes: str | None = Form(None),
    attachment: UploadFile | None = File(None),
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    amount = validate_amount(amount)
    vendor = validate_text(vendor, "Vendor", 200) if vendor.strip() else ""
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


# --- Corrections (owner only): edited or deleted in place, logged (app/corrections.py).
# A stock purchase's expense is the purchase's own: reversing the purchase in Stock
# deletes it (stock.reverse), and it is never edited or deleted on its own.

class ExpenseEdit(BaseModel):
    amount: float | None = None
    category: str | None = None
    vendor: str | None = None  # "" clears it
    date: str | None = None
    notes: str | None = None  # "" clears them


def _correctable(db: Session, business: Business, expense_id: str) -> Expense:
    row = corrections.owned(db, Expense, business, expense_id)
    if row.purchase_id:
        raise AppError(409, "purchase_expense", "This expense is a stock purchase. Reverse the purchase in "
                       "Stock to cancel it, then enter it again if it was wrong.")
    return row


@router.patch("/expenses/{expense_id}")
def edit_expense(
    expense_id: str,
    body: ExpenseEdit,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    row = _correctable(db, business, expense_id)
    new = {}
    if body.amount is not None:
        new["amount"] = validate_amount(body.amount)
    if body.category is not None:
        new["category"] = validate_text(body.category, "Category", 60)
    if body.vendor is not None:
        new["vendor"] = validate_text(body.vendor, "Vendor", 200) if body.vendor.strip() else ""
    if body.date is not None:
        new["date"] = validate_date(body.date, allow_future=False)
    if body.notes is not None:
        new["notes"] = validate_notes(body.notes, 5000)
    corrections.edit(db, business, user, row, new)
    db.commit()
    db.refresh(row)
    return expense_dto(row)


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: str,
    business: Business = Depends(require(ENTRY_DELETE)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    corrections.delete(db, business, user, _correctable(db, business, expense_id))
    db.commit()
