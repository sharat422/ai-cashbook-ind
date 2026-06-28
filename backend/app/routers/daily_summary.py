from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..calc import today_iso
from ..database import get_db
from ..deps import get_current_business
from ..models import Business, Expense, Income

router = APIRouter(tags=["daily-summary"])


@router.get("/summary/daily")
def daily_summary(
    date: str | None = Query(None),
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    day = date or today_iso()

    incomes = db.scalars(
        select(Income).where(
            Income.business_id == business.id, Income.date == day
        )
    ).all()
    expenses = db.scalars(
        select(Expense).where(
            Expense.business_id == business.id, Expense.date == day
        )
    ).all()

    income_total = sum(i.amount for i in incomes)
    expense_total = sum(e.amount for e in expenses)

    by_category: dict[str, float] = defaultdict(float)
    for e in expenses:
        by_category[e.category] += e.amount

    top = sorted(by_category.items(), key=lambda kv: kv[1], reverse=True)[:5]
    top_categories = [
        {
            "category": cat,
            "amount": amt,
            "share": (amt / expense_total) if expense_total else 0,
        }
        for cat, amt in top
    ]

    return {
        "date": day,
        "income": income_total,
        "expense": expense_total,
        "profit": income_total - expense_total,
        "transaction_count": len(incomes) + len(expenses),
        "top_expense_categories": top_categories,
    }
