from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai import generate_insights
from ..calc import days_since, parse_date, today_iso
from ..database import get_db
from ..deps import get_current_business
from ..models import Business, Customer, LedgerEntry

router = APIRouter(tags=["khata"])


def _business_customers(db: Session, business: Business) -> list[Customer]:
    return db.scalars(
        select(Customer).where(Customer.business_id == business.id)
    ).all()


def _business_ledger(db: Session, business: Business) -> list[LedgerEntry]:
    return db.scalars(
        select(LedgerEntry)
        .join(Customer, LedgerEntry.customer_id == Customer.id)
        .where(Customer.business_id == business.id)
    ).all()


def _month_sum(entries: list[LedgerEntry], month_prefix: str, kind: str) -> float:
    return sum(
        e.amount for e in entries if e.type == kind and e.date.startswith(month_prefix)
    )


def compute_summary(db: Session, business: Business, frm: str, to: str) -> dict:
    customers = _business_customers(db, business)
    ledger = _business_ledger(db, business)
    today = today_iso()

    total_receivable = sum(c.outstanding_amount for c in customers if c.outstanding_amount > 0)
    total_payable = sum(-c.outstanding_amount for c in customers if c.outstanding_amount < 0)
    overdue_amount = sum(
        c.outstanding_amount for c in customers if c.is_overdue and c.outstanding_amount > 0
    )
    today_collections = sum(
        e.amount for e in ledger if e.type == "payment" and e.date == today
    )

    defaulters = sorted(
        (c for c in customers if c.outstanding_amount > 0),
        key=lambda c: c.outstanding_amount,
        reverse=True,
    )[:5]
    top_defaulters = [
        {
            "customer_id": c.id,
            "name": c.full_name,
            "amount": c.outstanding_amount,
            "days_overdue": max(0, days_since(c.last_transaction_date)),
        }
        for c in defaulters
    ]

    trend = _build_trend(ledger, frm, to)

    return {
        "total_receivable": total_receivable,
        "total_payable": total_payable,
        "overdue_amount": overdue_amount,
        "today_collections": today_collections,
        "top_defaulters": top_defaulters,
        "trend": trend,
    }


def _build_trend(ledger: list[LedgerEntry], frm: str, to: str) -> list[dict]:
    collected: dict[str, float] = defaultdict(float)
    billed: dict[str, float] = defaultdict(float)
    for e in ledger:
        if frm <= e.date <= to:
            if e.type == "payment":
                collected[e.date] += e.amount
            elif e.type == "credit":
                billed[e.date] += e.amount

    d0, d1 = parse_date(frm), parse_date(to)
    points: list[dict] = []
    if d0 and d1 and 0 <= (d1 - d0).days <= 31:
        cur = d0
        while cur <= d1:
            key = cur.isoformat()
            points.append({"date": key, "collected": collected.get(key, 0), "billed": billed.get(key, 0)})
            cur += timedelta(days=1)
    else:
        for key in sorted(set(collected) | set(billed)):
            points.append({"date": key, "collected": collected.get(key, 0), "billed": billed.get(key, 0)})
    return points


@router.get("/khata/summary")
def khata_summary(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    branch: str = "all",
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    # branch / business filters are accepted for API parity (single-business stub).
    return compute_summary(db, business, from_, to)


@router.get("/khata/insights")
def khata_insights(
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    today = today_iso()
    month_start = today[:7] + "-01"
    summary = compute_summary(db, business, month_start, today)

    # Month-over-month collection change feeds the insight prompt/heuristic.
    ledger = _business_ledger(db, business)
    this_month = today[:7]
    d = parse_date(today)
    last_month = f"{d.year - 1:04d}-12" if d.month == 1 else f"{d.year:04d}-{d.month - 1:02d}"
    this_collected = _month_sum(ledger, this_month, "payment")
    last_collected = _month_sum(ledger, last_month, "payment")
    change_pct = (
        round((this_collected - last_collected) / last_collected * 100)
        if last_collected
        else None
    )

    stats = {**summary, "collection_change_pct": change_pct}
    return {"insights": generate_insights(stats)}
