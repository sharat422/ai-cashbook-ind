"""Business intelligence — a single morning-summary endpoint powering the
daily digest, profit dashboard, month-over-month trends and a simple cash-flow
forecast. All computed from income / expense / ledger data.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..calc import days_since
from ..database import get_db
from ..deps import require
from ..rbac import DATA_VIEW
from ..models import Business, Customer, Expense, Income, LedgerEntry

router = APIRouter(tags=["business"])


def _today():
    return datetime.now(timezone.utc).date()


def _month_prefix(base, months_back: int) -> str:
    y, m = base.year, base.month - months_back
    while m <= 0:
        m += 12
        y -= 1
    return f"{y:04d}-{m:02d}"


def _pct(cur: float, prev: float):
    if not prev:
        return None
    return round((cur - prev) / prev * 100)


@router.get("/business/summary")
def business_summary(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    incomes = db.scalars(
        select(Income).where(Income.business_id == business.id)
    ).all()
    expenses = db.scalars(
        select(Expense).where(Expense.business_id == business.id)
    ).all()
    customers = db.scalars(
        select(Customer).where(Customer.business_id == business.id)
    ).all()
    ledger = db.scalars(
        select(LedgerEntry)
        .join(Customer, LedgerEntry.customer_id == Customer.id)
        .where(Customer.business_id == business.id)
    ).all()

    today = _today()
    today_s = today.isoformat()
    yday_s = (today - timedelta(days=1)).isoformat()
    d30_s = (today - timedelta(days=30)).isoformat()
    this_month = today_s[:7]
    last_month = _month_prefix(today, 1)

    payments = [e for e in ledger if e.type == "payment"]

    # --- Yesterday (#26) ---
    yesterday = {
        "sales": sum(i.amount for i in incomes if i.date == yday_s),
        "collections": sum(p.amount for p in payments if p.date == yday_s),
        "expenses": sum(e.amount for e in expenses if e.date == yday_s),
    }

    # --- Receivables (#26) ---
    outstanding = sum(c.outstanding_amount for c in customers if c.outstanding_amount > 0)
    overdue_customers = [
        c for c in customers if c.is_overdue and c.outstanding_amount > 0
    ]
    overdue = sum(c.outstanding_amount for c in overdue_customers)

    # Expected collection today = avg daily collection over the last 30 days.
    pay_30 = sum(p.amount for p in payments if d30_s <= p.date <= today_s)
    expected_today = round(pay_30 / 30, 2)

    # --- This month vs last month (#29 profit, #30 trends) ---
    def m_income(mp):
        return sum(i.amount for i in incomes if i.date.startswith(mp))

    def m_expense(mp):
        return sum(e.amount for e in expenses if e.date.startswith(mp))

    def m_collect(mp):
        return sum(p.amount for p in payments if p.date.startswith(mp))

    m_sales, m_exp, m_coll = m_income(this_month), m_expense(this_month), m_collect(this_month)
    profit = m_sales - m_exp
    margin = round(profit / m_sales, 4) if m_sales else 0.0

    lm_sales, lm_exp, lm_coll = m_income(last_month), m_expense(last_month), m_collect(last_month)

    trends = {
        "sales_pct": _pct(m_sales, lm_sales),
        "collections_pct": _pct(m_coll, lm_coll),
        "expenses_pct": _pct(m_exp, lm_exp),
    }

    # --- Cash-flow forecast (#31): mean of the last 3 months ---
    prefixes = [_month_prefix(today, i) for i in (0, 1, 2)]
    avg_coll = sum(m_collect(mp) for mp in prefixes) / 3
    avg_exp = sum(m_expense(mp) for mp in prefixes) / 3
    forecast = {
        "expected_collections": round(avg_coll),
        "expected_expenses": round(avg_exp),
        "net": round(avg_coll - avg_exp),
    }

    return {
        "yesterday": yesterday,
        "outstanding": outstanding,
        "overdue": overdue,
        "expected_collection_today": expected_today,
        "customers_need_attention": len(overdue_customers),
        "month": {
            "sales": m_sales,
            "expenses": m_exp,
            "collections": m_coll,
            "profit": profit,
            "margin": margin,
        },
        "trends": trends,
        "forecast": forecast,
    }
