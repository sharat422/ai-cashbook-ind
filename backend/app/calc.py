"""Date helpers and derived-field recomputation shared across aggregates."""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Customer, LedgerEntry

OVERDUE_DAYS = 30


# India Standard Time — fixed +05:30, no DST, so no tzdata dependency needed.
IST = timezone(timedelta(hours=5, minutes=30), "IST")


def today_iso() -> str:
    """The business day as users see it (Asia/Kolkata), not UTC."""
    return datetime.now(IST).date().isoformat()


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def days_since(value: str | None) -> int:
    d = parse_date(value)
    if d is None:
        return 0
    return (datetime.now(IST).date() - d).days


def recompute_customer(db: Session, customer: Customer) -> None:
    """Recalculate outstanding / last-transaction / overdue from the ledger."""
    entries = db.scalars(
        select(LedgerEntry).where(LedgerEntry.customer_id == customer.id)
    ).all()

    credits = sum(e.amount for e in entries if e.type == "credit")
    payments = sum(e.amount for e in entries if e.type == "payment")
    outstanding = credits - payments

    last_date = max((e.date for e in entries), default=None)

    customer.outstanding_amount = outstanding
    customer.last_transaction_date = last_date
    customer.is_overdue = bool(outstanding > 0 and days_since(last_date) > OVERDUE_DAYS)
