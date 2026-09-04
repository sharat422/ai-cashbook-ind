from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..calc import today_iso
from ..database import get_db
from ..deps import require
from ..rbac import DATA_VIEW, SETTINGS_MANAGE
from ..models import Business, Expense, RecurringExpense, gen_id
from ..recurring import FREQUENCIES, catch_up, next_occurrence
from ..serializers import expense_dto, recurring_expense_dto
from ..validation import validate_amount

router = APIRouter(tags=["recurring"])


class RecurringBody(BaseModel):
    name: str
    amount: float
    category: str
    vendor: str = ""
    frequency: str  # weekly | monthly | yearly | custom
    interval: int = 1
    anchor_day: int | None = None
    next_due_date: str  # YYYY-MM-DD — first (or next) time it's due
    notes: str | None = None
    active: bool = True


def _validate(body: RecurringBody) -> None:
    if not body.name.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name is required")
    validate_amount(body.amount)  # positive, finite, and within the sane cap
    if body.frequency not in FREQUENCIES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Frequency must be one of {', '.join(FREQUENCIES)}",
        )
    if body.interval < 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Interval must be >= 1")


def _owned(db: Session, business: Business, rec_id: str) -> RecurringExpense:
    row = db.get(RecurringExpense, rec_id)
    if row is None or row.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recurring expense not found")
    return row


def _anchor_day(body: RecurringBody) -> int | None:
    """For monthly templates, remember the intended day-of-month so short
    months don't permanently shift the schedule earlier."""
    if body.frequency != "monthly":
        return None
    if body.anchor_day is not None:
        return body.anchor_day
    try:
        return int(body.next_due_date[8:10])
    except ValueError:
        return None


@router.get("/recurring-expenses")
def list_recurring(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    today = today_iso()
    rows = db.scalars(
        select(RecurringExpense)
        .where(RecurringExpense.business_id == business.id)
        .order_by(RecurringExpense.next_due_date.asc())
    ).all()
    items = [recurring_expense_dto(r, today=today) for r in rows]
    due = [i for i in items if i["is_due"]]
    return {
        "items": items,
        "due_count": len(due),
        "due_total": round(sum(i["amount"] for i in due), 2),
        "monthly_total": round(_monthly_equivalent(rows), 2),
    }


def _monthly_equivalent(rows: list[RecurringExpense]) -> float:
    """Rough monthly run-rate of all active templates, for an at-a-glance total."""
    per_month = {"weekly": 52 / 12, "monthly": 1.0, "yearly": 1 / 12, "custom": 30}
    total = 0.0
    for r in rows:
        if not r.active:
            continue
        factor = per_month.get(r.frequency, 0)
        if r.frequency == "custom":
            factor = 30 / max(r.interval, 1)
        else:
            factor = factor / max(r.interval, 1)
        total += r.amount * factor
    return total


@router.post("/recurring-expenses")
def create_recurring(
    body: RecurringBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    _validate(body)
    row = RecurringExpense(
        business_id=business.id,
        name=body.name.strip(),
        amount=body.amount,
        category=body.category,
        vendor=body.vendor,
        frequency=body.frequency,
        interval=body.interval,
        anchor_day=_anchor_day(body),
        next_due_date=body.next_due_date,
        notes=body.notes,
        active=body.active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return recurring_expense_dto(row, today=today_iso())


@router.patch("/recurring-expenses/{rec_id}")
def update_recurring(
    rec_id: str,
    body: RecurringBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    _validate(body)
    row = _owned(db, business, rec_id)
    row.name = body.name.strip()
    row.amount = body.amount
    row.category = body.category
    row.vendor = body.vendor
    row.frequency = body.frequency
    row.interval = body.interval
    row.anchor_day = _anchor_day(body)
    row.next_due_date = body.next_due_date
    row.notes = body.notes
    row.active = body.active
    db.commit()
    db.refresh(row)
    return recurring_expense_dto(row, today=today_iso())


@router.delete("/recurring-expenses/{rec_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring(
    rec_id: str,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> None:
    db.delete(_owned(db, business, rec_id))
    db.commit()


@router.post("/recurring-expenses/{rec_id}/post")
def post_occurrence(
    rec_id: str,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    """Record the current due occurrence as a real Expense and roll the
    schedule forward to the next future date. Returns the new template state
    plus the created expense."""
    row = _owned(db, business, rec_id)
    today = today_iso()
    due_date = row.next_due_date

    # Idempotency: one posted expense per template per due date.
    client_id = f"recur:{row.id}:{due_date}"
    existing = db.scalars(
        select(Expense).where(
            Expense.business_id == business.id, Expense.client_id == client_id
        )
    ).first()
    if existing is None:
        existing = Expense(
            id=gen_id(),
            business_id=business.id,
            amount=row.amount,
            category=row.category,
            vendor=row.vendor,
            date=due_date,
            notes=(row.notes or f"Recurring: {row.name}"),
            client_id=client_id,
        )
        db.add(existing)

    row.last_posted_date = due_date
    # Always advance at least one cycle; then skip past any missed cycles so a
    # long-ignored template lands on its next *future* date rather than staying
    # perpetually overdue.
    advanced = next_occurrence(
        due_date, row.frequency, row.interval, anchor_day=row.anchor_day
    )
    row.next_due_date = catch_up(
        advanced,
        row.frequency,
        row.interval,
        today,
        anchor_day=row.anchor_day,
    )
    db.commit()
    db.refresh(row)
    db.refresh(existing)
    return {
        "recurring": recurring_expense_dto(row, today=today),
        "expense": expense_dto(existing),
    }
