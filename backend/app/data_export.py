"""The business's own data as files it can keep: an Excel workbook of
everything and a PDF of every customer's balance.

These are the "Your data" exports. They are free on every plan: nothing here
(or in the routes that serve them) checks a plan, a payment or a trial.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import gst_reports as gr
from .calc import today_iso
from .models import Business, Customer, Expense, Income, LedgerEntry
from .statements import _Pdf, dmy, inr, money


def _customers(db: Session, business: Business) -> list[Customer]:
    return db.scalars(select(Customer).where(Customer.business_id == business.id)
                      .order_by(Customer.full_name)).all()


def _day(iso: str | None):
    try:
        return date.fromisoformat(iso[:10]) if iso else None
    except ValueError:
        return iso


def workbook(db: Session, business: Business) -> bytes:
    customers = _customers(db, business)
    names = {c.id: c.full_name for c in customers}
    ledger = db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id.in_(list(names)))
                        .order_by(LedgerEntry.date, LedgerEntry.created_at)).all() if names else []
    incomes = db.scalars(select(Income).where(Income.business_id == business.id)
                         .order_by(Income.date)).all()
    expenses = db.scalars(select(Expense).where(Expense.business_id == business.id)
                          .order_by(Expense.date)).all()
    wb = Workbook()
    gr._sheet(wb, "Customers", ["Name", "Business", "Mobile", "GSTIN", "Outstanding"],
              [[c.full_name, c.business_name or "", c.mobile, c.gst_number or "",
                money(c.outstanding_amount or 0)] for c in customers])
    gr._sheet(wb, "Ledger", ["Date", "Customer", "Type", "Amount", "Invoice", "Method",
                             "Reference", "Notes"],
              [[_day(e.date), names.get(e.customer_id, ""),
                "Sale (credit)" if e.type == "credit" else "Payment", money(e.amount),
                e.invoice_number or "", e.payment_method or "", e.reference_number or "",
                e.notes or ""] for e in ledger])
    gr._sheet(wb, "Income", ["Date", "Category", "Amount", "Notes"],
              [[_day(x.date), x.category, money(x.amount), x.notes or ""] for x in incomes])
    gr._sheet(wb, "Expenses", ["Date", "Category", "Paid to", "Amount", "Notes"],
              [[_day(x.date), x.category, x.vendor or "", money(x.amount), x.notes or ""]
               for x in expenses])
    return gr._save(wb)


ROWS_PER_PAGE = 38


def balances_pdf(db: Session, business: Business) -> bytes:
    customers = _customers(db, business)
    rows = [(c.full_name + (f" ({c.business_name})" if c.business_name else ""), c.mobile,
             money(c.outstanding_amount or 0)) for c in customers]
    total = sum((r[2] for r in rows), Decimal("0.00"))
    chunks = [rows[i:i + ROWS_PER_PAGE] for i in range(0, len(rows), ROWS_PER_PAGE)] or [[]]
    pdf = _Pdf()
    for n, chunk in enumerate(chunks, 1):
        pdf.add_page()
        pdf.set_font("Noto", "B", 14)
        pdf.cell(0, 7, business.business_name, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Noto", "", 9)
        pdf.cell(0, 5, f"Customer balances as on {dmy(today_iso())}    Page {n} of {len(chunks)}",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
        for cells, bold in [(("Customer", "Mobile", "Balance"), True)] + [(r, False) for r in chunk]:
            pdf.set_font("Noto", "B" if bold else "", 9)
            name, mobile, bal = cells
            pdf.cell(110, 6, name, border="B")
            pdf.cell(36, 6, mobile, border="B")
            pdf.cell(40, 6, bal if isinstance(bal, str) else inr(bal), border="B", align="R")
            pdf.ln(6)
        if n == len(chunks):
            pdf.set_font("Noto", "B", 9)
            pdf.cell(146, 6, f"Total ({len(rows)} customers)", border="B")
            pdf.cell(40, 6, inr(total), border="B", align="R")
            pdf.ln(6)
        pdf.set_y(-14)
        pdf.set_font("Noto", "", 7)
        pdf.cell(0, 4, f"Exported from Bolcash on {dmy(today_iso())}. "
                       "Positive balance = amount the customer owes you.", align="C")
    return bytes(pdf.output())
