from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_business
from ..models import Business, Expense, Income

router = APIRouter(tags=["transactions"])


@router.get("/transactions")
def list_transactions(
    limit: int = Query(20, ge=1, le=100),
    sort_by: str = "date",
    sort_dir: str = "desc",
    cursor: str | None = None,
    search: str | None = None,
    type: str | None = None,
    categories: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    """Unified income + expense feed with search, filters, sort and a cursor.

    Income and expense live in separate tables, so we merge in Python. Fine for
    a stub; for very large datasets back this with a SQL UNION + keyset cursor.
    """
    rows: list[dict] = []

    if type != "expense":
        for i in db.scalars(
            select(Income).where(Income.business_id == business.id)
        ).all():
            rows.append({
                "id": i.id, "type": "income", "amount": i.amount,
                "category": i.category, "date": i.date, "vendor": None,
                "notes": i.notes, "created_at": i.created_at,
            })

    if type != "income":
        for e in db.scalars(
            select(Expense).where(Expense.business_id == business.id)
        ).all():
            rows.append({
                "id": e.id, "type": "expense", "amount": e.amount,
                "category": e.category, "date": e.date, "vendor": e.vendor,
                "notes": e.notes, "created_at": e.created_at,
            })

    if search:
        low = search.lower()
        rows = [
            r for r in rows
            if low in (r["category"] or "").lower()
            or low in (r["vendor"] or "").lower()
            or low in (r["notes"] or "").lower()
        ]

    if categories:
        wanted = {c.strip() for c in categories.split(",") if c.strip()}
        rows = [r for r in rows if r["category"] in wanted]

    if date_from:
        rows = [r for r in rows if r["date"] >= date_from]
    if date_to:
        rows = [r for r in rows if r["date"] <= date_to]

    reverse = sort_dir != "asc"
    key = (lambda r: r["amount"]) if sort_by == "amount" else (lambda r: (r["date"], r["created_at"]))
    rows.sort(key=key, reverse=reverse)

    total = len(rows)
    offset = int(cursor) if (cursor and cursor.isdigit()) else 0
    page = rows[offset : offset + limit]
    next_cursor = str(offset + limit) if offset + limit < total else None

    return {"items": page, "next_cursor": next_cursor, "total": total}
