from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..calc import today_iso
from ..database import get_db
from ..deps import get_current_business
from ..models import Business, Expense, Income

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/summary")
def dashboard_summary(
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    incomes = db.scalars(
        select(Income).where(Income.business_id == business.id)
    ).all()
    expenses = db.scalars(
        select(Expense).where(Expense.business_id == business.id)
    ).all()

    today = today_iso()
    month_prefix = today[:7]  # YYYY-MM

    today_income = sum(i.amount for i in incomes if i.date == today)
    today_expense = sum(e.amount for e in expenses if e.date == today)
    month_revenue = sum(i.amount for i in incomes if i.date.startswith(month_prefix))
    month_expense = sum(e.amount for e in expenses if e.date.startswith(month_prefix))
    cash_balance = sum(i.amount for i in incomes) - sum(e.amount for e in expenses)

    return {
        "today_income": today_income,
        "today_expense": today_expense,
        "cash_balance": cash_balance,
        "month_revenue": month_revenue,
        "month_expense": month_expense,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
