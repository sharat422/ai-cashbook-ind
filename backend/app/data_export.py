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
    AccessLog, BankImport, BankLine, BankMatch, Beat, BeatAssignment, BeatRetailer, Bill, BillLine, BillSeries, Business,
    BusinessMember, CaTestResult, CashCount, CashDeposit, CreditNote, Customer, DiscardedEntry, TeamInvite, Supplier, Expense, GstInvoiceLine, GstInvoiceNumber, GstRateChangeLog, ImportLog,
    Income, Item, ItemUnit, LedgerEntry, StockMonthLock, RecurringExpense, Scheme, SchemeApplication, SchemeItem,
    StatementEvent, StatementSchedule, StockLevel, StockMove, Visit,
)
from .doc_i18n import ENGLISH, Tr
from .doc_i18n import date as ldate
from .statements import _Pdf, inr, money


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
    items = by_business(Item, Item.name)
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

    ledger = child(LedgerEntry, LedgerEntry.customer_id, cust_ids, LedgerEntry.date)
    groups = {
        "customers": customers,
        "ledger_entries": ledger,
        "gst_invoice_lines": child(GstInvoiceLine, GstInvoiceLine.entry_id, [e.id for e in ledger],
                                   GstInvoiceLine.position),
        "gst_invoice_numbers": by_business(GstInvoiceNumber, GstInvoiceNumber.created_at),
        "gst_rate_changes": by_business(GstRateChangeLog, GstRateChangeLog.changed_at),
        "incomes": by_business(Income, Income.date),
        "expenses": by_business(Expense, Expense.date),
        "recurring_expenses": by_business(RecurringExpense),
        "items": items,
        "item_units": child(ItemUnit, ItemUnit.item_id, [i.id for i in items]),
        "stock_month_locks": by_business(StockMonthLock, StockMonthLock.month),
        "stock_levels": by_business(StockLevel),
        "stock_moves": by_business(StockMove, StockMove.created_at),
        "schemes": schemes,
        "scheme_items": child(SchemeItem, SchemeItem.scheme_id, scheme_ids),
        "bills": bills,
        "bill_lines": child(BillLine, BillLine.bill_id, bill_ids),
        "bill_series": by_business(BillSeries, BillSeries.financial_year),
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
        "credit_notes": by_business(CreditNote, CreditNote.created_at),
        "ca_test_results": by_business(CaTestResult, CaTestResult.tested_at),
        "suppliers": by_business(Supplier, Supplier.created_at),
        "statement_events": by_business(StatementEvent),
        "statement_schedules": by_business(StatementSchedule),
        "khata_imports": by_business(ImportLog, ImportLog.created_at),
        "discarded_entries": by_business(DiscardedEntry, DiscardedEntry.discarded_at),  # IM5: what the owner discarded
        "team_invites": by_business(TeamInvite, TeamInvite.created_at),  # AC2: the invite log
        "accountant_activity": by_business(AccessLog, AccessLog.created_at),
        "team": by_business(BusinessMember),
    }
    return {name: [_row(x) for x in rows] for name, rows in groups.items()}


_STATUS = {None: "doc.status.saved", "cancelled": "doc.cancelled", "partly_returned": "doc.status.partlyReturned"}
_LOG_STATUS = {"applied": "doc.log.applied", "not_applied": "doc.log.notApplied", "reversed": "doc.log.reversed"}


def _cols(t: Tr, *keys: str) -> list[str]:
    return [t(f"doc.col.{k}") for k in keys]


def _title(text: str) -> str:
    """A sheet name Excel accepts: none of []:*?/\\, at most 31 characters."""
    return "".join(" " if ch in "[]:*?/\\" else ch for ch in text)[:31]


def _qty(q) -> str:
    return f"{Decimal(q).normalize():f}"


def bill_sheets(db: Session, business: Business, names: dict[str, str],
                t: Tr = ENGLISH) -> dict[str, tuple[list, list]]:
    """The two records that prove what a retailer was charged and which scheme
    applied, readable: one row per bill, one row per scheme considered. A
    cancelled bill stays, marked Cancelled; its return is its own row."""
    bills = db.scalars(select(Bill).where(Bill.business_id == business.id)
                       .order_by(Bill.date, Bill.created_at)).all()
    number = {b.id: b.bill_number for b in bills}
    ids = list(number)
    lines: dict[str, list[BillLine]] = {}
    logs: dict[str, list[SchemeApplication]] = {}
    if ids:
        for ln in db.scalars(select(BillLine).where(BillLine.bill_id.in_(ids))):
            lines.setdefault(ln.bill_id, []).append(ln)
    apps = db.scalars(select(SchemeApplication).where(SchemeApplication.business_id == business.id)
                      .order_by(SchemeApplication.date)).all()
    for a in apps:
        logs.setdefault(a.bill_id, []).append(a)

    def line_text(ln: BillLine) -> str:
        marks = (f" ({t('doc.rateChanged')})" if ln.rate_changed else "") + \
            (f" ({t('doc.returned')})" if ln.returned else "")
        return f"{ln.item_name} {_qty(ln.quantity)} {ln.unit or ''} × {inr(money(ln.rate))} = {inr(money(ln.amount))}" \
            .replace("  ", " ") + marks

    def scheme_text(a: SchemeApplication) -> str:
        what = t("doc.free", qty=_qty(a.free_qty), item=a.free_item_name) if a.free_qty \
            else f"−{inr(money(a.discount))}"
        return f"{a.scheme_name} ({a.item_name}): {what}"

    bill_rows = [[
        b.bill_number, _day(b.date), names.get(b.customer_id, ""),
        "; ".join(line_text(ln) for ln in lines.get(b.id, [])),
        "; ".join(scheme_text(a) for a in logs.get(b.id, []) if a.status == "applied"),
        money(b.subtotal), money(b.discount), money(b.total),
        t("doc.returnOf", number=number.get(b.reverses_id, "")) if b.reverses_id
        else t(_STATUS[b.status]) if b.status in _STATUS else b.status,
    ] for b in bills]
    log_rows = [[
        number.get(a.bill_id, ""), _day(a.date), names.get(a.customer_id, ""), a.scheme_name, a.item_name,
        _qty(a.quantity), t(_LOG_STATUS[a.status]) if a.status in _LOG_STATUS else a.status,
        f"{_qty(a.free_qty)} {a.free_item_name or ''}".strip() if a.free_qty else "",
        money(a.discount), money(a.value), a.reason or "", a.group_note or "",
    ] for a in apps]
    return {
        t("doc.sheet.bills"): (_cols(t, "billNumber", "date", "retailer", "lines", "schemeLines", "subtotal",
                                     "schemeDiscount", "total", "status"), bill_rows),
        t("doc.sheet.schemeLog"): (_cols(t, "bill", "date", "retailer", "scheme", "sku", "quantity", "status",
                                         "freeGoods", "discount", "value", "reasonNotApplied", "group"), log_rows),
    }


def workbook(db: Session, business: Business, t: Tr = ENGLISH) -> bytes:
    """Headings, sheet names and fixed words in the owner's language (`t`, from
    reviewed strings only; English where none); names and notes as typed. The
    "(all)" sheets are the raw tables, with their column names, as in the backup."""
    customers = _customers(db, business)
    names = {c.id: c.full_name for c in customers}
    ledger = db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id.in_(list(names)))
                        .order_by(LedgerEntry.date, LedgerEntry.created_at)).all() if names else []
    incomes = db.scalars(select(Income).where(Income.business_id == business.id)
                         .order_by(Income.date)).all()
    expenses = db.scalars(select(Expense).where(Expense.business_id == business.id)
                          .order_by(Expense.date)).all()
    wb = Workbook()
    gr._sheet(wb, _title(t("doc.sheet.customers")), _cols(t, "name", "business", "mobile", "gstin", "outstanding"),
              [[c.full_name, c.business_name or "", c.mobile, c.gst_number or "",
                money(c.outstanding_amount or 0)] for c in customers])
    gr._sheet(wb, _title(t("doc.sheet.ledger")),
              _cols(t, "date", "customer", "type", "amount", "invoice", "method", "reference", "notes"),
              [[_day(e.date), names.get(e.customer_id, ""),
                t("doc.saleCredit") if e.type == "credit" else t("doc.payment"), money(e.amount),
                e.invoice_number or "", e.payment_method or "", e.reference_number or "",
                e.notes or ""] for e in ledger])
    gr._sheet(wb, _title(t("doc.sheet.income")), _cols(t, "date", "category", "amount", "notes"),
              [[_day(x.date), x.category, money(x.amount), x.notes or ""] for x in incomes])
    gr._sheet(wb, _title(t("doc.sheet.expenses")), _cols(t, "date", "category", "paidTo", "amount", "notes"),
              [[_day(x.date), x.category, x.vendor or "", money(x.amount), x.notes or ""]
               for x in expenses])
    for title, (header, rows) in bill_sheets(db, business, names, t).items():
        gr._sheet(wb, _title(title), header, rows)
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


def balances_pdf(db: Session, business: Business, t: Tr = ENGLISH) -> bytes:
    """Every customer's balance, in the owner's language (`t`); names as typed,
    amounts ₹ with Indian grouping, the date IST with the month in that language."""
    customers = _customers(db, business)
    rows = [(c.full_name + (f" ({c.business_name})" if c.business_name else ""), c.mobile,
             money(c.outstanding_amount or 0)) for c in customers]
    total = sum((r[2] for r in rows), Decimal("0.00"))
    chunks = [rows[i:i + ROWS_PER_PAGE] for i in range(0, len(rows), ROWS_PER_PAGE)] or [[]]
    today = ldate(t, today_iso())
    pdf = _Pdf()
    for n, chunk in enumerate(chunks, 1):
        pdf.add_page()
        pdf.set_font("Noto", "B", 14)
        pdf.cell(0, 7, business.business_name, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Noto", "", 9)
        pdf.cell(0, 5, f"{t('doc.balancesAsOn', date=today)}    {t('doc.page', n=n, total=len(chunks))}",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
        for cells, bold in [(tuple(_cols(t, "customer", "mobile", "balance")), True)] + [(r, False) for r in chunk]:
            pdf.set_font("Noto", "B" if bold else "", 9)
            name, mobile, bal = cells
            pdf.cell(110, 6, name, border="B")
            pdf.cell(36, 6, mobile, border="B")
            pdf.cell(40, 6, bal if isinstance(bal, str) else inr(bal), border="B", align="R")
            pdf.ln(6)
        if n == len(chunks):
            pdf.set_font("Noto", "B", 9)
            pdf.cell(146, 6, t("doc.balancesTotal", count=len(rows)), border="B")
            pdf.cell(40, 6, inr(total), border="B", align="R")
            pdf.ln(6)
        pdf.set_y(-14)
        pdf.set_font("Noto", "", 7)
        pdf.cell(0, 4, t("doc.balancesFooter", date=today), align="C")
    return bytes(pdf.output())
