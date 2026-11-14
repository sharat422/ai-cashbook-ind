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
from sqlalchemy.orm import Session, selectinload

from .calc import IST
from .gst import UQC, lines_of, money, place_label, state_code
from .models import (Business, CreditNote, Customer, GstInvoiceNumber, GstRateChangeLog, Item, LedgerEntry, in_books,
                     StockMove)

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
               LedgerEntry.gst_rate.is_not(None), in_books(),
               LedgerEntry.date >= start, LedgerEntry.date <= end)
        .options(selectinload(LedgerEntry.gst_lines))
        .order_by(LedgerEntry.date, LedgerEntry.invoice_number)
    ).all()


def credit_notes(db: Session, business: Business, start: str, end: str) -> list[CreditNote]:
    """GST credit notes dated start..end, in number order."""
    return list(db.scalars(select(CreditNote).where(
        CreditNote.business_id == business.id, CreditNote.date >= start, CreditNote.date <= end)
        .order_by(CreditNote.fy, CreditNote.serial)))


def documents(db: Session, business: Business, start: str, end: str) -> list[tuple[str, str, bool]]:
    """GSTR-1 Table 13: every invoice number issued in the period (IST days of
    issue), in series order, as (series, number, cancelled). A number whose
    invoice was deleted stays in the series as cancelled; numbers are never reused."""
    next_day = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
    rows = db.scalars(select(GstInvoiceNumber).where(
        GstInvoiceNumber.business_id == business.id,
        GstInvoiceNumber.created_at >= _ist_day_start_utc(start),
        GstInvoiceNumber.created_at < _ist_day_start_utc(next_day))
        .order_by(GstInvoiceNumber.fy, GstInvoiceNumber.serial)).all()
    return [(r.fy, r.number, r.ledger_entry_id is None) for r in rows]


def _note_total(n: CreditNote) -> Decimal:
    return _d(n.taxable_value) + _d(n.cgst) + _d(n.sgst) + _d(n.igst)


# ---------------------------------------------------------------- ITC review
# Purchases with GST, for the CA to check against GSTR-2B. Bolcash never works
# out an ITC claim: GSTR-3B table 4 is filled from GSTR-2B on the portal.

ITC_LABEL = "for the CA — not a claim"


def purchases_with_gst(db: Session, business: Business, start: str, end: str) -> list[tuple]:
    """(purchase move, item name) for purchases dated start..end that carry GST."""
    return db.execute(
        select(StockMove, Item.name).join(Item, Item.id == StockMove.item_id)
        .where(StockMove.business_id == business.id, StockMove.kind == "purchase",
               StockMove.gst_amount.is_not(None), StockMove.date >= start, StockMove.date <= end)
        .order_by(StockMove.date, StockMove.created_at)).all()


def _bill_key(gstin: str | None, bill: str | None) -> tuple[str, str]:
    return ("".join((gstin or "").split()).upper(), "".join((bill or "").split()).upper())


def gstr2b_bills(data: bytes, filename: str = "") -> set[tuple[str, str]]:
    """(supplier GSTIN, invoice number) pairs in a GSTR-2B download: the
    portal's JSON (docdata.b2b[].ctin / inv[].inum) or its Excel (any sheet
    with a "GSTIN of supplier" column and an invoice/note number column)."""
    if data[:1] in (b"{", b"["):
        import json

        found: set[tuple[str, str]] = set()

        def walk(node):
            if isinstance(node, dict):
                ctin = node.get("ctin")
                for key, num in (("inv", "inum"), ("nt", "ntnum")):
                    for doc in node.get(key) or []:
                        if ctin and isinstance(doc, dict) and doc.get(num):
                            found.add(_bill_key(ctin, str(doc[num])))
                for v in node.values():
                    walk(v)
            elif isinstance(node, list):
                for v in node:
                    walk(v)
        try:
            walk(json.loads(data.decode("utf-8-sig")))
        except (ValueError, UnicodeDecodeError):
            raise ValueError("This isn't a GSTR-2B file (JSON).") from None
        return found
    from openpyxl import load_workbook
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 — anything that isn't an xlsx
        raise ValueError("Upload the GSTR-2B as downloaded from the GST portal (Excel or JSON).") from None
    found = set()
    for ws in wb.worksheets:
        rows = [[str(c).strip() if c is not None else "" for c in r] for r in ws.iter_rows(values_only=True)]
        for i, row in enumerate(rows[:30]):
            g = next((j for j, c in enumerate(row) if "gstin" in c.lower()), None)
            if g is None:
                continue
            # The number column is on the same header row or the one under it (merged headers).
            heads = [row] + rows[i + 1:i + 2]
            n = next((j for h in heads for j, c in enumerate(h)
                      if any(k in c.lower() for k in ("invoice number", "invoice no", "note number", "note no"))), None)
            if n is None:
                continue
            for r in rows[i + 1:]:
                if len(r) > max(g, n) and len(r[g]) == 15 and r[n]:
                    found.add(_bill_key(r[g], r[n]))
            break
    return found


def itc_rows(rows: list[tuple], business: Business, in_2b: set | None) -> list[list]:
    """One row per purchase: its tax as billed, split IGST vs CGST/SGST by the
    supplier's state (unknown without their GSTIN), and its 2B status."""
    ours = (business.gstin or "")[:2] or state_code(business.state)
    out = []
    for m, item in rows:
        tax, gstin = _d(m.gst_amount), m.supplier_gstin or ""
        igst = cgst = sgst = unknown = ZERO
        if not gstin:
            unknown = tax  # can't tell intra- from inter-state
        elif gstin[:2] == ours:
            cgst = (tax / 2).quantize(Decimal("0.01"))
            sgst = tax - cgst  # an odd paisa goes to SGST, so the halves add up
        else:
            igst = tax
        if in_2b is None:
            status = "2B not checked"
        elif not gstin:
            status = "no supplier GSTIN"
        else:
            status = "matched" if _bill_key(gstin, m.bill_ref) in in_2b else "not in 2B"
        out.append([date.fromisoformat(m.date), m.supplier, gstin, m.bill_ref, item,
                    Decimal(m.gst_rate).normalize() + 0, tax, igst, cgst, sgst, unknown, status])
    return out


ITC_HEADER = ["Bill date", "Supplier", "Supplier GSTIN", "Bill number", "Item", "GST rate", "Tax paid",
              "IGST", "CGST", "SGST/UTGST", "Tax paid, split unknown (no GSTIN)", "In GSTR-2B?"]


def itc_review_xlsx(rows: list[list], start: str, end: str, checked: bool) -> bytes:
    wb = Workbook()
    _sheet(wb, "ITC review", ITC_HEADER, rows)
    _sheet(wb, "Notes", ["Note"], [
        [f"Purchases with GST, {start} to {end}, as entered in Bolcash. Review sheet {ITC_LABEL}."],
        ["Bolcash does not work out an ITC claim. GSTR-3B table 4 is filled from GSTR-2B on the portal."],
        ["'In GSTR-2B?' matches supplier GSTIN + bill number against the 2B file uploaded; a line "
         "that isn't there stays on the sheet as 'not in 2B'." if checked else
         "Not checked against GSTR-2B: upload the 2B file to see which bills are in it."],
    ])
    return _save(wb)


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


def _rate(e) -> Decimal:  # an entry or one of its gst_lines
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
    """One row per item; an invoice with several items repeats its bill
    reference and invoice value on each."""
    return [
        [date.fromisoformat(e.date), _party(c), e.customer_gstin or "", ln.hsn_code,
         _d(ln.taxable_value), _d(ln.cgst), _d(ln.sgst), _d(ln.igst), e.invoice_number or "",
         _rate(ln), place_label(e.place_of_supply), _total(e)]
        for e, c in rows for ln in lines_of(e)
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


def gstr1_xlsx(rows: list[tuple], changes: list, notes: list | None = None,
               docs: list | None = None) -> bytes:
    """Sheets named and laid out like the GST offline tool's GSTR-1 tabs, for
    the CA to check and upload. Cess is always 0 (not recorded).

    Credit notes (Table 9B): registered buyers in cdnr; unregistered buyers in
    cdnur when the invoice was a B2CL one, else netted off b2cs (that's where
    a B2C small invoice was reported). Table 13 (docs): the invoice and credit
    note series, with cancelled numbers listed in order."""
    notes, docs = notes or [], docs or []
    dfmt = "DD-MMM-YYYY"
    b2b, b2cl = [], []
    b2cs: dict[tuple, Decimal] = defaultdict(lambda: ZERO)
    hsn: dict[tuple, list] = {}
    for e, c in rows:
        total = _total(e)  # the invoice value, on every rate row of the invoice
        when, pos = date.fromisoformat(e.date), place_label(e.place_of_supply)
        by_rate: dict[Decimal, Decimal] = defaultdict(lambda: ZERO)
        for ln in lines_of(e):
            rate, taxable = _rate(ln), _d(ln.taxable_value)
            by_rate[rate] += taxable
            # One row per HSN + unit + rate. Invoices saved before quantity/UQC were
            # recorded group under a blank unit, for the CA to fill.
            key = ("b2b" if e.customer_gstin else "b2c", ln.hsn_code, ln.gst_uqc or "", rate)
            acc = hsn.setdefault(key, [ZERO] * 6)
            for i, v in enumerate((_total(ln), taxable, _d(ln.igst), _d(ln.cgst), _d(ln.sgst),
                                   Decimal(ln.gst_quantity or 0))):
                acc[i] += v
        # b2b and b2cl: one row per invoice and rate, as the offline tool wants.
        for rate, taxable in sorted(by_rate.items()):
            if e.customer_gstin:
                b2b.append([e.customer_gstin, _party(c), e.invoice_number, when, total, pos,
                            "N", "", "Regular B2B", "", rate, taxable, ZERO])
            elif _d(e.igst) > 0 and total > B2CL_LIMIT:
                b2cl.append([e.invoice_number, when, total, pos, "", rate, taxable, ZERO, ""])
            else:
                b2cs[(pos, rate)] += taxable

    cdnr, cdnur = [], []
    for n in notes:
        rate, when, pos = Decimal(n.gst_rate).normalize() + 0, date.fromisoformat(n.date), place_label(n.place_of_supply)
        if n.buyer_registered:
            cdnr.append([n.customer_gstin, n.customer_name, n.number, when, "C", pos, "N", "Regular B2B",
                         _note_total(n), "", rate, _d(n.taxable_value), ZERO])
        elif n.invoice_b2cl:
            cdnur.append(["B2CL", n.number, when, "C", pos, _note_total(n), "", rate, _d(n.taxable_value), ZERO])
        else:
            b2cs[(pos, rate)] -= _d(n.taxable_value)

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
    _sheet(wb, "cdnr", ["GSTIN/UIN of Recipient", "Receiver Name", "Note Number", "Note Date", "Note Type",
                        "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value",
                        "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"], cdnr, dfmt)
    _sheet(wb, "cdnur", ["UR Type", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Note Value",
                         "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"], cdnur, dfmt)
    _sheet(wb, "hsn(b2b)", hsn_header, hsn_rows("b2b"))
    _sheet(wb, "hsn(b2c)", hsn_header, hsn_rows("b2c"))
    series = [("Invoices for outward supply", [(nb, x) for _, nb, x in docs]),
              ("Credit Note", [(n.number, False) for n in notes])]
    _sheet(wb, "docs", ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"],
           [[kind, s[0][0], s[-1][0], len(s), sum(1 for _, x in s if x)] for kind, s in series if s])
    _sheet(wb, "docs (cancelled)", ["Nature of Document", "Number", "Status"],
           [[kind, nb, "Cancelled" if x else "Issued"] for kind, s in series for nb, x in s])
    _sheet(wb, "rate changes", ["Changed at (IST)", "Item", "Old rate", "New rate"],
           [[_ist_minute(x.changed_at), x.item_name,
             Decimal(x.old_rate).normalize() + 0, Decimal(x.new_rate).normalize() + 0]
            for x in changes])
    return _save(wb)


def gstr3b_xlsx(rows: list[tuple], start: str, end: str, notes: list | None = None,
                itc: list[list] | None = None) -> bytes:
    """Outward-supply figures for GSTR-3B tables 3.1 and 3.2. Input tax credit
    (table 4) is not included: purchases aren't recorded with GST.

    Credit notes dated in the period reduce these figures only once they may
    (an unregistered buyer, or a registered one whose ITC reversal is
    confirmed: proviso to s.34(2)); the rest are listed as pending."""
    notes = notes or []
    taxable = defaultdict(lambda: ZERO)  # 3.1(a) totals
    nil = ZERO                           # 3.1(c) nil-rated
    inter_unreg: dict[str, list] = {}    # 3.2 by place of supply
    for e, _ in rows:
        for ln in lines_of(e):
            if _rate(ln) == 0:
                nil += _d(ln.taxable_value)
                continue
            for k in ("taxable_value", "igst", "cgst", "sgst"):
                taxable[k] += _d(getattr(ln, k))
            if not e.customer_gstin and _d(ln.igst) > 0:
                acc = inter_unreg.setdefault(place_label(e.place_of_supply), [ZERO, ZERO])
                acc[0] += _d(ln.taxable_value)
                acc[1] += _d(ln.igst)
    pending = []
    for n in notes:
        if not n.reduces_tax:
            pending.append([n.number, date.fromisoformat(n.date), n.customer_name, n.customer_gstin or "",
                            _d(n.taxable_value), _d(n.igst), _d(n.cgst), _d(n.sgst)])
            continue
        if Decimal(n.gst_rate) == 0:
            nil -= _d(n.taxable_value)
            continue
        for k in ("taxable_value", "igst", "cgst", "sgst"):
            taxable[k] -= _d(getattr(n, k))
        if not n.buyer_registered and _d(n.igst) > 0:
            acc = inter_unreg.setdefault(place_label(n.place_of_supply), [ZERO, ZERO])
            acc[0] -= _d(n.taxable_value)
            acc[1] -= _d(n.igst)
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
    itc = itc or []
    _sheet(wb, f"4 ITC ({ITC_LABEL})"[:31],
           ["Table 4 — review only, " + ITC_LABEL, "IGST", "CGST", "SGST/UTGST", "Split unknown (no GSTIN)"],
           [["Tax paid on purchases recorded in Bolcash (see the ITC review file; "
             "the claim comes from GSTR-2B)",
             sum((r[7] for r in itc), ZERO), sum((r[8] for r in itc), ZERO),
             sum((r[9] for r in itc), ZERO), sum((r[10] for r in itc), ZERO)]])
    _sheet(wb, "Credit notes pending ITC",
           ["Note number", "Note date", "Buyer", "Buyer GSTIN", "Taxable value", "Integrated tax",
            "Central tax", "State/UT tax"], pending)
    _sheet(wb, "Notes", ["Note"], [
        [f"Period {start} to {end}. Sales figures from invoices entered in Bolcash, less credit notes."],
        ["Credit notes reduce 3.1 only once the registered buyer's ITC reversal is confirmed "
         "(proviso to s.34(2)); the others are on 'Credit notes pending ITC'."],
        [f"Table 4 is a review of purchases entered in Bolcash, {ITC_LABEL}: the claim comes from GSTR-2B."],
        ["Not included: debit notes, cess."],
        ["Working sheet for your CA. Bolcash does not file returns."],
    ])
    return _save(wb)
