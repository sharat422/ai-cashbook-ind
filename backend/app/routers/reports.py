from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import gst_reports as gr
from ..database import get_db
from ..deps import require
from ..rbac import REPORTS_VIEW
from ..models import Business, Expense, Income
from ..validation import validate_date

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
    business: Business = Depends(require(REPORTS_VIEW)),
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


# ------------------------------------------------ GST-ready exports for the CA
# Working files for the CA. Bolcash does not file returns or create e-invoices.

def _period(from_: str, to: str) -> tuple[str, str]:
    start, end = validate_date(from_), validate_date(to)
    if start > end:
        raise HTTPException(422, "The start date is after the end date.")
    return start, end


def _file(data: bytes, media_type: str, name: str) -> StreamingResponse:
    return StreamingResponse(
        iter([data]), media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/reports/gst-summary")
def gst_summary(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    business: Business = Depends(require(REPORTS_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """Counts and totals of the GST invoices in the period (what the files hold)."""
    start, end = _period(from_, to)
    return {"from": start, "to": end,
            "rate_changes": len(gr.rate_changes(db, business, start, end)),
            **gr.summary(gr.invoices(db, business, start, end))}


@router.get("/reports/gstr1.xlsx")
def gstr1(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    business: Business = Depends(require(REPORTS_VIEW)),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    start, end = _period(from_, to)
    data = gr.gstr1_xlsx(gr.invoices(db, business, start, end),
                         gr.rate_changes(db, business, start, end))
    return _file(data, gr.XLSX, f"GSTR1_ready_{start}_{end}.xlsx")


@router.get("/reports/gstr3b-summary.xlsx")
def gstr3b(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    business: Business = Depends(require(REPORTS_VIEW)),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    start, end = _period(from_, to)
    data = gr.gstr3b_xlsx(gr.invoices(db, business, start, end), start, end)
    return _file(data, gr.XLSX, f"GSTR3B_summary_{start}_{end}.xlsx")


@router.get("/reports/tally-export.xlsx")
def tally_xlsx(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    business: Business = Depends(require(REPORTS_VIEW)),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    start, end = _period(from_, to)
    data = gr.tally_xlsx(gr.invoices(db, business, start, end))
    return _file(data, gr.XLSX, f"Tally_sales_{start}_{end}.xlsx")


@router.get("/reports/tally-export.csv")
def tally_csv(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    business: Business = Depends(require(REPORTS_VIEW)),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    start, end = _period(from_, to)
    data = gr.tally_csv(gr.invoices(db, business, start, end))
    return _file(data, gr.CSV, f"Tally_sales_{start}_{end}.csv")
