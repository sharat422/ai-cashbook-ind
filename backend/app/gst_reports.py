"""GST-ready exports for the CA: a GSTR-1-ready workbook, a GSTR-3B summary
and a Tally import sheet. They are working files for the CA. Bolcash does not
file returns and does not create e-invoices.

Every figure is the tax saved on the invoice when it was entered — nothing is
recomputed here, so a later rate change can't alter a past period.
"""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from .calc import IST
from .gst import UQC, money, place_label
from .models import Business, Customer, GstRateChangeLog, LedgerEntry

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CSV = "text/csv; charset=utf-8"
ZERO = Decimal("0.00")
# Inter-state sale to an unregistered buyer above this goes to B2CL, not B2CS.
# ponytail: ₹1 lakh since Aug 2024 — confirm with the CA.
B2CL_LIMIT = Decimal("100000")

TALLY_HEADER = [
    "Voucher Date", "Party Name", "GSTIN", "HSN", "Taxable Value", "CGST", "SGST",
    "IGST", "Bill Reference", "GST Rate", "Place of Supply", "Invoice Value",
]


def invoices(db: Session, business: Business, start: str, end: str) -> list[tuple]:
    """(entry, customer) for every GST invoice dated start..end, oldest first."""
    return db.execute(
        select(LedgerEntry, Customer)
        .join(Customer, Customer.id == LedgerEntry.customer_id)
        .where(Customer.business_id == business.id, LedgerEntry.type == "credit",
               LedgerEntry.gst_rate.is_not(None),
               LedgerEntry.date >= start, LedgerEntry.date <= end)
        .order_by(LedgerEntry.date, LedgerEntry.invoice_number)
    ).all()


def _ist_day_start_utc(day: str) -> str:
    """00:00 IST of `day` as the UTC ISO string changed_at is stored in."""
    return datetime.combine(date.fromisoformat(day), time(), IST).astimezone(timezone.utc).isoformat()


def rate_changes(db: Session, business: Business, start: str, end: str) -> list:
    # The period is IST days; changed_at is UTC. Compare on IST day boundaries,
    # or a change made between midnight and 5:30 am IST lands on the wrong day.
    next_day = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
    return db.scalars(
        select(GstRateChangeLog)
        .where(GstRateChangeLog.business_id == business.id,
               GstRateChangeLog.changed_at >= _ist_day_start_utc(start),
               GstRateChangeLog.changed_at < _ist_day_start_utc(next_day))
        .order_by(GstRateChangeLog.changed_at)
    ).all()


def _ist_minute(iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone(IST).strftime("%Y-%m-%d %H:%M")


def _d(x) -> Decimal:
    return ZERO if x is None else Decimal(x).quantize(Decimal("0.01"))


def _total(e: LedgerEntry) -> Decimal:
    return _d(e.taxable_value) + _d(e.cgst) + _d(e.sgst) + _d(e.igst)


def _party(c: Customer) -> str:
    return c.business_name or c.full_name


def _rate(e: LedgerEntry) -> Decimal:
    return Decimal(e.gst_rate).normalize() + 0  # 18.00 -> 18 (and never 1.8E+1)


def summary(rows: list[tuple]) -> dict:
    t = defaultdict(lambda: ZERO)
    for e, _ in rows:
        for k in ("taxable_value", "cgst", "sgst", "igst"):
            t[k] += _d(getattr(e, k))
    return {
        "invoices": len(rows),
        **{k: money(t[k]) for k in ("taxable_value", "cgst", "sgst", "igst")},
        "total": money(sum(t.values(), ZERO)),
    }


# ---------------------------------------------------------------- Tally

def tally_rows(rows: list[tuple]) -> list[list]:
    return [
        [date.fromisoformat(e.date), _party(c), e.customer_gstin or "", e.hsn_code,
         _d(e.taxable_value), _d(e.cgst), _d(e.sgst), _d(e.igst), e.invoice_number or "",
         _rate(e), place_label(e.place_of_supply), _total(e)]
        for e, c in rows
    ]


def _csv_cell(v) -> str:
    if isinstance(v, date):
        return v.strftime("%d-%m-%Y")
    if isinstance(v, Decimal):
        return f"{v:f}"
    s = str(v)
    # A cell starting with = + - @ runs as a formula in Excel: neutralise it.
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def tally_csv(rows: list[tuple]) -> bytes:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(TALLY_HEADER)
    for r in tally_rows(rows):
        w.writerow([_csv_cell(v) for v in r])
    return out.getvalue().encode("utf-8-sig")  # BOM: Excel reads ₹ and Indian scripts


# ---------------------------------------------------------------- xlsx

def _sheet(wb: Workbook, title: str, header: list[str], body: list[list],
           date_format: str = "DD-MM-YYYY"):
    ws = wb.create_sheet(title)
    ws.append(header)
    for r in body:
        ws.append(r)
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            if isinstance(cell.value, Decimal):
                cell.number_format = "0.00"
            elif isinstance(cell.value, date):
                cell.number_format = date_format
            elif isinstance(cell.value, str) and cell.value.startswith("="):
                cell.data_type = "s"  # text, never a formula
    for cell in ws[1]:
        ws.column_dimensions[cell.column_letter].width = max(12, len(str(cell.value)) + 2)
    return ws


def _save(wb: Workbook) -> bytes:
    del wb[wb.sheetnames[0]]  # the default empty sheet
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def tally_xlsx(rows: list[tuple]) -> bytes:
    wb = Workbook()
    _sheet(wb, "Sales", TALLY_HEADER, tally_rows(rows))
    return _save(wb)


def gstr1_xlsx(rows: list[tuple], changes: list) -> bytes:
    """Sheets named and laid out like the GST offline tool's GSTR-1 tabs, for
    the CA to check and upload. Cess is always 0 (not recorded)."""
    dfmt = "DD-MMM-YYYY"
    b2b, b2cl = [], []
    b2cs: dict[tuple, Decimal] = defaultdict(lambda: ZERO)
    hsn: dict[tuple, list] = {}
    for e, c in rows:
        rate, taxable, total = _rate(e), _d(e.taxable_value), _total(e)
        when, pos = date.fromisoformat(e.date), place_label(e.place_of_supply)
        if e.customer_gstin:
            b2b.append([e.customer_gstin, _party(c), e.invoice_number, when, total, pos,
                        "N", "", "Regular B2B", "", rate, taxable, ZERO])
        elif _d(e.igst) > 0 and total > B2CL_LIMIT:
            b2cl.append([e.invoice_number, when, total, pos, "", rate, taxable, ZERO, ""])
        else:
            b2cs[(pos, rate)] += taxable
        # One row per HSN + unit + rate. Invoices saved before quantity/UQC were
        # recorded group under a blank unit, for the CA to fill.
        key = ("b2b" if e.customer_gstin else "b2c", e.hsn_code, e.gst_uqc or "", rate)
        acc = hsn.setdefault(key, [ZERO] * 6)
        for i, v in enumerate((total, taxable, _d(e.igst), _d(e.cgst), _d(e.sgst),
                               Decimal(e.gst_quantity or 0))):
            acc[i] += v

    def hsn_rows(kind):
        return [[h, "", f"{u}-{UQC[u].upper()}" if u else "", (acc[5].normalize() + 0) if u else "",
                 acc[0], rate, acc[1], acc[2], acc[3], acc[4], ZERO]
                for (k, h, u, rate), acc in sorted(hsn.items()) if k == kind]

    hsn_header = ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate",
                  "Taxable Value", "Integrated Tax Amount", "Central Tax Amount",
                  "State/UT Tax Amount", "Cess Amount"]
    wb = Workbook()
    _sheet(wb, "b2b", ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number",
                       "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge",
                       "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN",
                       "Rate", "Taxable Value", "Cess Amount"], b2b, dfmt)
    _sheet(wb, "b2cl", ["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply",
                        "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount",
                        "E-Commerce GSTIN"], b2cl, dfmt)
    _sheet(wb, "b2cs", ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate",
                        "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
           [["OE", pos, "", rate, v, ZERO, ""] for (pos, rate), v in sorted(b2cs.items())])
    _sheet(wb, "hsn(b2b)", hsn_header, hsn_rows("b2b"))
    _sheet(wb, "hsn(b2c)", hsn_header, hsn_rows("b2c"))
    _sheet(wb, "rate changes", ["Changed at (IST)", "Item", "Old rate", "New rate"],
           [[_ist_minute(x.changed_at), x.item_name,
             Decimal(x.old_rate).normalize() + 0, Decimal(x.new_rate).normalize() + 0]
            for x in changes])
    return _save(wb)


def gstr3b_xlsx(rows: list[tuple], start: str, end: str) -> bytes:
    """Outward-supply figures for GSTR-3B tables 3.1 and 3.2. Input tax credit
    (table 4) is not included: purchases aren't recorded with GST."""
    taxable = defaultdict(lambda: ZERO)  # 3.1(a) totals
    nil = ZERO                           # 3.1(c) nil-rated
    inter_unreg: dict[str, list] = {}    # 3.2 by place of supply
    for e, _ in rows:
        if _rate(e) == 0:
            nil += _d(e.taxable_value)
            continue
        for k in ("taxable_value", "igst", "cgst", "sgst"):
            taxable[k] += _d(getattr(e, k))
        if not e.customer_gstin and _d(e.igst) > 0:
            acc = inter_unreg.setdefault(place_label(e.place_of_supply), [ZERO, ZERO])
            acc[0] += _d(e.taxable_value)
            acc[1] += _d(e.igst)
    wb = Workbook()
    _sheet(wb, "3.1 Outward supplies",
           ["Nature of supplies", "Total taxable value", "Integrated tax", "Central tax",
            "State/UT tax", "Cess"],
           [["(a) Outward taxable supplies (other than zero rated, nil rated and exempted)",
             taxable["taxable_value"], taxable["igst"], taxable["cgst"], taxable["sgst"], ZERO],
            ["(c) Other outward supplies (nil rated, exempted)", nil, ZERO, ZERO, ZERO, ZERO]])
    _sheet(wb, "3.2 Inter-state unregistered",
           ["Place of supply", "Total taxable value", "Integrated tax"],
           [[pos, v[0], v[1]] for pos, v in sorted(inter_unreg.items())])
    _sheet(wb, "Notes", ["Note"], [
        [f"Period {start} to {end}. Sales figures only, from invoices entered in Bolcash."],
        ["Not included: input tax credit (table 4), purchases, credit/debit notes, cess."],
        ["Working sheet for your CA. Bolcash does not file returns."],
    ])
    return _save(wb)
