"""The business's own data as files it can keep: an Excel workbook of
everything and a PDF of every customer's balance.

These are the "Your data" exports. They are free on every plan: nothing here
(or in the routes that serve them) checks a plan, a payment or a trial.

`sections()` is the ONE place that decides what "everything" is. The JSON
backup ("Download my data") and the Excel workbook both read from it, so a
table added there is in both. Rows are read from the model's own columns, so a
new column is exported without touching this file. Left out on purpose: secrets
(statement-link token hashes, UTR index hashes) and the import backup copies.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import gst_reports as gr
from .calc import today_iso
from .models import (
    AccessLog, BankImport, BankLine, BankMatch, Beat, BeatAssignment, BeatRetailer, Bill, BillLine, Business,
    BusinessMember, CashCount, CashDeposit, Customer, Expense, GstInvoiceNumber, GstRateChangeLog, ImportLog,
    Income, Item, LedgerEntry, RecurringExpense, Scheme, SchemeApplication, SchemeItem,
    StatementEvent, StockLevel, StockMove, Visit,
)
from .statements import _Pdf, dmy, inr, money


def _customers(db: Session, business: Business) -> list[Customer]:
    return db.scalars(select(Customer).where(Customer.business_id == business.id)
                      .order_by(Customer.full_name)).all()


def _day(iso: str | None):
    try:
        return date.fromisoformat(iso[:10]) if iso else None
    except ValueError:
        return iso


# Columns that must never leave the server, by table.
_SECRET = {"import_logs": {"backup"}, "bank_imports": {"file_hash"}}


def _row(obj) -> dict:
    out = {}
    for col in obj.__table__.columns:
        if col.key in _SECRET.get(obj.__tablename__, ()):
            continue
        v = getattr(obj, col.key)
        out[col.key] = f"{v:f}" if isinstance(v, Decimal) else v
    return out


def sections(db: Session, business: Business) -> dict[str, list[dict]]:
    """Every table that belongs to this business, as plain rows."""
    def by_business(model, order=None):
        q = select(model).where(model.business_id == business.id)
        return db.scalars(q.order_by(order) if order is not None else q).all()

    customers = by_business(Customer, Customer.full_name)
    cust_ids = [c.id for c in customers]
    beats = by_business(Beat, Beat.name)
    beat_ids = [b.id for b in beats]
    bills = by_business(Bill, Bill.date)
    bill_ids = [b.id for b in bills]
    schemes = by_business(Scheme)
    scheme_ids = [x.id for x in schemes]

    def child(model, column, ids, order=None):
        if not ids:
            return []
        q = select(model).where(column.in_(ids))
        return db.scalars(q.order_by(order) if order is not None else q).all()

    groups = {
        "customers": customers,
        "ledger_entries": child(LedgerEntry, LedgerEntry.customer_id, cust_ids, LedgerEntry.date),
        "gst_invoice_numbers": by_business(GstInvoiceNumber, GstInvoiceNumber.created_at),
        "gst_rate_changes": by_business(GstRateChangeLog, GstRateChangeLog.changed_at),
        "incomes": by_business(Income, Income.date),
        "expenses": by_business(Expense, Expense.date),
        "recurring_expenses": by_business(RecurringExpense),
        "items": by_business(Item, Item.name),
        "stock_levels": by_business(StockLevel),
        "stock_moves": by_business(StockMove, StockMove.created_at),
        "schemes": schemes,
        "scheme_items": child(SchemeItem, SchemeItem.scheme_id, scheme_ids),
        "bills": bills,
        "bill_lines": child(BillLine, BillLine.bill_id, bill_ids),
        "scheme_applications": by_business(SchemeApplication, SchemeApplication.date),
        "beats": beats,
        "beat_retailers": child(BeatRetailer, BeatRetailer.beat_id, beat_ids),
        "beat_assignments": child(BeatAssignment, BeatAssignment.beat_id, beat_ids),
        "visits": by_business(Visit, Visit.visited_at),
        "bank_statements": by_business(BankImport, BankImport.created_at),
        "bank_lines": by_business(BankLine, BankLine.date),
        "bank_matches": by_business(BankMatch, BankMatch.confirmed_at),
        "cash_counts": by_business(CashCount, CashCount.created_at),
        "cash_deposits": by_business(CashDeposit, CashDeposit.created_at),
        "statement_events": by_business(StatementEvent),
        "khata_imports": by_business(ImportLog, ImportLog.created_at),
        "accountant_activity": by_business(AccessLog, AccessLog.created_at),
        "team": by_business(BusinessMember),
    }
    return {name: [_row(x) for x in rows] for name, rows in groups.items()}


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
    # Then every table in full, one sheet each (the same data as the JSON backup).
    for name, rows in sections(db, business).items():
        if rows:
            cols = list(rows[0])
            gr._sheet(wb, f"{name} (all)"[:31], cols, [[_cell(r[c]) for c in cols] for r in rows])
    return gr._save(wb)


def _cell(v):
    """Excel can't hold dicts/lists or tz-aware objects; keep everything plain."""
    return v if v is None or isinstance(v, (str, int, float, bool)) else str(v)


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
