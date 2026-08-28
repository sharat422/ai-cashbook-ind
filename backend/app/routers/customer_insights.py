"""Customer intelligence — AR aging buckets and smart-list insights.

Computed from the ledger on the server (it has every entry), so the app can ask
"who owes the most / who's late / who paid this month / who's dormant / who's
high risk" and show an aging breakdown without pulling all data to the device.
"""

from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..calc import days_since, today_iso
from ..database import get_db
from ..deps import require
from ..rbac import DATA_VIEW
from ..models import Business, Customer, LedgerEntry

router = APIRouter(tags=["customer-insights"])

# Dormant = no ledger activity for this many days.
DORMANT_DAYS = 30


def _business_ledger(db: Session, business: Business) -> list[LedgerEntry]:
    return db.scalars(
        select(LedgerEntry)
        .join(Customer, LedgerEntry.customer_id == Customer.id)
        .where(Customer.business_id == business.id)
    ).all()


def _customer_aging(entries: list[LedgerEntry]) -> dict:
    """FIFO-allocate payments against oldest credits, then bucket the unpaid
    remainder of each credit by its age."""
    credits = sorted((e for e in entries if e.type == "credit"), key=lambda e: e.date)
    pool = sum(e.amount for e in entries if e.type == "payment")

    buckets = {"current": 0.0, "d1_30": 0.0, "d31_60": 0.0, "d61_90": 0.0, "d90_plus": 0.0}
    for c in credits:
        applied = min(pool, c.amount)
        pool -= applied
        unpaid = c.amount - applied
        if unpaid <= 1e-9:
            continue
        age = days_since(c.date)
        if age <= 0:
            buckets["current"] += unpaid
        elif age <= 30:
            buckets["d1_30"] += unpaid
        elif age <= 60:
            buckets["d31_60"] += unpaid
        elif age <= 90:
            buckets["d61_90"] += unpaid
        else:
            buckets["d90_plus"] += unpaid
    return buckets


@router.get("/customer-aging")
def customers_aging(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    customers = db.scalars(
        select(Customer).where(Customer.business_id == business.id)
    ).all()
    by_customer: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in _business_ledger(db, business):
        by_customer[e.customer_id].append(e)

    totals = {"current": 0.0, "d1_30": 0.0, "d31_60": 0.0, "d61_90": 0.0, "d90_plus": 0.0}
    for c in customers:
        b = _customer_aging(by_customer.get(c.id, []))
        for k in totals:
            totals[k] += b[k]

    return {"buckets": totals, "total": sum(totals.values())}


def _risk_score(customer: Customer) -> int:
    if customer.outstanding_amount <= 0:
        return 0
    days = max(0, days_since(customer.last_transaction_date))
    score = 40 if customer.is_overdue else 0
    score += min(days, 90) / 90 * 30
    score += min(customer.outstanding_amount / 50_000, 1) * 30
    return round(score)


@router.get("/customer-insights")
def customers_insights(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    customers = db.scalars(
        select(Customer).where(Customer.business_id == business.id)
    ).all()
    by_id = {c.id: c for c in customers}
    ledger = _business_ledger(db, business)
    month_prefix = today_iso()[:7]

    paid_month: dict[str, float] = defaultdict(float)
    for e in ledger:
        if e.type == "payment" and e.date.startswith(month_prefix):
            paid_month[e.customer_id] += e.amount

    def row(c: Customer) -> dict:
        return {
            "customer_id": c.id,
            "name": c.full_name,
            "outstanding": c.outstanding_amount,
            "days_overdue": max(0, days_since(c.last_transaction_date))
            if c.is_overdue
            else 0,
        }

    receivable = [c for c in customers if c.outstanding_amount > 0]
    top_debtors = sorted(receivable, key=lambda c: c.outstanding_amount, reverse=True)[:5]
    overdue = sorted(
        (c for c in customers if c.is_overdue and c.outstanding_amount > 0),
        key=lambda c: c.outstanding_amount,
        reverse=True,
    )
    dormant = sorted(
        (
            c
            for c in customers
            if c.last_transaction_date and days_since(c.last_transaction_date) > DORMANT_DAYS
        ),
        key=lambda c: days_since(c.last_transaction_date),
        reverse=True,
    )[:10]

    high_risk = []
    for c in receivable:
        s = _risk_score(c)
        if s >= 50:
            high_risk.append({**row(c), "score": s})
    high_risk.sort(key=lambda r: r["score"], reverse=True)

    paid_this_month = [
        {"customer_id": cid, "name": by_id[cid].full_name, "amount": amt}
        for cid, amt in sorted(paid_month.items(), key=lambda kv: kv[1], reverse=True)
        if cid in by_id
    ]

    return {
        "total_receivable": sum(c.outstanding_amount for c in receivable),
        "overdue_count": len(overdue),
        "top_debtors": [row(c) for c in top_debtors],
        "overdue": [row(c) for c in overdue],
        "paid_this_month": paid_this_month,
        "dormant": [
            {**row(c), "days_since": days_since(c.last_transaction_date)} for c in dormant
        ],
        "high_risk": high_risk,
    }
