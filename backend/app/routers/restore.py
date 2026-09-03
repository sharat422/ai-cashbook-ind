from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require
from ..rbac import DATA_VIEW
from ..models import Business, Customer, Expense, Income, LedgerEntry

router = APIRouter(tags=["restore"])


@router.get("/restore/summary")
def restore_summary(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """Counts of what's stored in the cloud for the caller's business.

    The app calls this right after login on a fresh install to decide whether to
    offer a "Restore your data" step. It's intentionally cheap (COUNTs only, no
    rows) so the check is fast even on a cold free-tier backend.
    """
    incomes = db.scalar(
        select(func.count()).select_from(Income).where(Income.business_id == business.id)
    ) or 0
    expenses = db.scalar(
        select(func.count()).select_from(Expense).where(Expense.business_id == business.id)
    ) or 0
    customers = db.scalar(
        select(func.count()).select_from(Customer).where(Customer.business_id == business.id)
    ) or 0
    ledger_entries = db.scalar(
        select(func.count())
        .select_from(LedgerEntry)
        .join(Customer, LedgerEntry.customer_id == Customer.id)
        .where(Customer.business_id == business.id)
    ) or 0

    return {
        "incomes": incomes,
        "expenses": expenses,
        "customers": customers,
        "ledger_entries": ledger_entries,
        # Unified transaction feed = income + expense entries.
        "transactions": incomes + expenses,
        # Convenience: is there anything worth restoring at all?
        "total": incomes + expenses + customers + ledger_entries,
    }
