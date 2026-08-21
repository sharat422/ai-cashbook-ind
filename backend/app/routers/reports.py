from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_business
from ..models import Business, Expense, Income

router = APIRouter(tags=["reports"])


def _by_category(rows: list, total: float) -> list[dict]:
    buckets: dict[str, float] = defaultdict(float)
    for r in rows:
        buckets[r.category] += r.amount
    return [
        {"category": cat, "amount": amt, "share": (amt / total) if total else 0.0}
        for cat, amt in sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
    ]


@router.get("/reports/summary")
def report_summary(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    """Profit & Loss + category breakdowns for a date range [from, to].

    Dates are inclusive ISO strings (YYYY-MM-DD); lexical comparison is valid
    for that format.
    """
    incomes = [
        i
        for i in db.scalars(
            select(Income).where(Income.business_id == business.id)
        ).all()
        if from_ <= i.date <= to
    ]
    expenses = [
        e
        for e in db.scalars(
            select(Expense).where(Expense.business_id == business.id)
        ).all()
        if from_ <= e.date <= to
    ]

    income_total = sum(i.amount for i in incomes)
    expense_total = sum(e.amount for e in expenses)

    return {
        "from": from_,
        "to": to,
        "income_total": income_total,
        "expense_total": expense_total,
        "profit": income_total - expense_total,
        "income_count": len(incomes),
        "expense_count": len(expenses),
        "income_by_category": _by_category(incomes, income_total),
        "expense_by_category": _by_category(expenses, expense_total),
    }
