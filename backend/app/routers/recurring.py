import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import AppError
from ..calc import today_iso
from ..database import get_db
from ..deps import check_cron_secret, require
from ..rbac import DATA_VIEW, SETTINGS_MANAGE
from ..models import Business, Expense, Income, RecurringExpense, gen_id, now_iso
from ..recurring import FREQUENCIES, catch_up, next_occurrence
from ..serializers import expense_dto, income_dto, recurring_expense_dto
from ..statements import inr, money
from ..validation import validate_amount

router = APIRouter(tags=["recurring"])
log = logging.getLogger("cashbook.recurring")
KINDS = ("expense", "income")
# A run posts at most this many occurrences of one template (a template set up with
# a start date long ago); the next run carries on.
MAX_PER_RUN = 12


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
    kind: str | None = None  # expense | income; None keeps it (or expense, new)
    auto_post: bool | None = None  # None keeps it (or on, new): an older app doesn't send it


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
    if body.kind is not None and body.kind not in KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Kind must be expense or income")


def _owned(db: Session, business: Business, rec_id: str) -> RecurringExpense:
    row = db.get(RecurringExpense, rec_id)
    if row is None or row.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recurring expense not found")
    return row


def _assert_name_unique(
    db: Session, business: Business, name: str, exclude_id: str | None = None
) -> None:
    """A recurring template's name identifies it within a business. Reject a
    second template with the same name (case-insensitive, trimmed) so the user
    can't accidentally add "Shop rent" twice; the message names the one that
    exists. Templates only: one-off expenses may share a name."""
    cleaned = name.strip()
    q = select(RecurringExpense).where(
        RecurringExpense.business_id == business.id,
        func.lower(RecurringExpense.name) == cleaned.lower(),
    )
    if exclude_id is not None:
        q = q.where(RecurringExpense.id != exclude_id)
    existing = db.scalars(q).first()
    if existing is not None:
        unit = {"weekly": "weeks", "monthly": "months", "yearly": "years", "custom": "days"}[existing.frequency]
        every = existing.frequency if existing.interval == 1 else f"every {existing.interval} {unit}"
        amount = inr(money(existing.amount))
        # A code, so the app says it in the user's language (the app's own check usually catches it first).
        raise AppError(status.HTTP_422_UNPROCESSABLE_ENTITY, "recurring_duplicate",
                       f"Expense name already added: {existing.name}, {amount}, {every}",
                       name=existing.name, amount=amount)


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
        # Money going out: expenses only. Recurring income has its own run-rate.
        "due_total": round(sum(i["amount"] for i in due if i["kind"] == "expense"), 2),
        "monthly_total": round(_monthly_equivalent([r for r in rows if (r.kind or "expense") == "expense"]), 2),
        "income_monthly_total": round(_monthly_equivalent([r for r in rows if r.kind == "income"]), 2),
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
    _assert_name_unique(db, business, body.name)
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
        kind=body.kind or "expense",
        auto_post=True if body.auto_post is None else body.auto_post,
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
    _assert_name_unique(db, business, body.name, exclude_id=rec_id)
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
    if body.kind is not None:
        row.kind = body.kind
    if body.auto_post is not None:
        row.auto_post = body.auto_post
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
    existing = _post_one(db, row, due_date)
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
    entry = {"income": income_dto(existing)} if row.kind == "income" else {"expense": expense_dto(existing)}
    return {"recurring": recurring_expense_dto(row, today=today), **entry}


def _post_one(db: Session, row: RecurringExpense, due_date: str, auto: bool = False) -> Expense | Income:
    """Book one occurrence (an Expense, or an Income for recurring income) dated its
    due date. Idempotent: one entry per template per due date, whoever posts it."""
    model = Income if row.kind == "income" else Expense
    client_id = f"recur:{row.id}:{due_date}"
    entry = db.scalars(select(model).where(model.business_id == row.business_id,
                                           model.client_id == client_id)).first()
    if entry is None:
        fields = dict(id=gen_id(), business_id=row.business_id, amount=row.amount, category=row.category,
                      date=due_date, notes=row.notes or f"Recurring: {row.name}", client_id=client_id)
        entry = Income(**fields) if model is Income else Expense(**fields, vendor=row.vendor)
        db.add(entry)
    row.last_posted_date = due_date
    if auto:
        row.last_auto_posted_at = now_iso()
    return entry


def post_due(db: Session, today: str) -> dict:
    """The scheduled job: every active template set to post automatically, each
    occurrence that has come due (up to MAX_PER_RUN a run), as Mark paid would book
    it. One template failing doesn't stop the rest; a repeated run books nothing twice."""
    posted = templates = 0
    rows = db.scalars(select(RecurringExpense).where(
        RecurringExpense.active.is_(True), RecurringExpense.auto_post.is_(True),
        RecurringExpense.next_due_date <= today)).all()
    for row in rows:
        try:
            n = 0
            while row.next_due_date <= today and n < MAX_PER_RUN:
                _post_one(db, row, row.next_due_date, auto=True)
                row.next_due_date = next_occurrence(row.next_due_date, row.frequency, row.interval,
                                                    anchor_day=row.anchor_day)
                n += 1
            db.commit()
            posted, templates = posted + n, templates + 1
        except Exception:  # noqa: BLE001 — one bad template mustn't stop the rest
            db.rollback()
            log.exception("auto-post failed for recurring %s", row.id)
    return {"posted": posted, "templates": templates}


@router.post("/cron/recurring")
def run_recurring(request: Request, db: Session = Depends(get_db)) -> dict:
    """Called by .github/workflows/recurring-autopost.yml with the cron secret.
    Posts what's due; safe to call any time."""
    check_cron_secret(request)
    return post_due(db, today_iso())
