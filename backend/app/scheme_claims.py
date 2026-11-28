"""A claim to the supplier for what one scheme gave away in a period: the Scheme
Report's figures for that scheme (net of returns, without cancelled bills),
copied when the claim is made, then its status as the supplier answers. The
files the distributor sends: a PDF and an Excel sheet with the same figures."""
from __future__ import annotations

import io
import json
from datetime import date
from decimal import Decimal

from openpyxl import Workbook

from .models import Business, SchemeClaim
from .statements import _Pdf, inr

STATUSES = ("draft", "filed", "approved", "rejected", "paid")
COLS = (("Item", 70, "L"), ("Bills", 16, "R"), ("Qty sold", 24, "R"), ("Free qty", 24, "R"),
        ("Discount", 26, "R"), ("Value", 26, "R"))


def _day(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%d %b %Y")


def _qty(x) -> str:
    """As the Scheme Report writes quantities ("6.000")."""
    return f"{Decimal(str(x)):.3f}"


def _show(x) -> str:
    """For the PDF: "6", "2.5"."""
    return f"{Decimal(str(x)).normalize():f}"


def claim_dto(c: SchemeClaim) -> dict:
    return {"id": c.id, "schemeId": c.scheme_id, "schemeName": c.scheme_name, "schemeType": c.scheme_type,
            "from": c.period_from, "to": c.period_to, "status": c.status, "bills": c.bills,
            "quantity": _qty(c.total_qty), "freeQty": _qty(c.total_free_qty),
            "discount": f"{c.total_discount:.2f}", "value": f"{c.total_value:.2f}",
            "lines": json.loads(c.lines or "[]"), "note": c.note, "createdAt": c.created_at,
            "filedAt": c.filed_at, "updatedAt": c.updated_at}


def _title(business: Business, c: SchemeClaim) -> list[str]:
    return [f"Scheme claim: {c.scheme_name}", f"Period: {_day(c.period_from)} to {_day(c.period_to)}",
            f"From: {business.business_name}" + (f" · GSTIN {business.gstin}" if business.gstin else ""),
            f"Claim {c.id[:8].upper()} · prepared {_day(c.created_at[:10])}"]


def render_pdf(business: Business, c: SchemeClaim) -> bytes:
    pdf = _Pdf()
    pdf.add_page()
    head = _title(business, c)
    pdf.set_font("Noto", "B", 14)
    pdf.cell(0, 8, head[0], new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Noto", "", 9)
    for line in head[1:] + ([business.address] if business.address else []):
        pdf.cell(0, 5, line, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    def row(cells: list[str], bold: bool = False) -> None:
        if pdf.get_y() > 275:
            pdf.add_page()
        pdf.set_font("Noto", "B" if bold else "", 9)
        for (_, w, align), text in zip(COLS, cells):
            pdf.cell(w, 6, text, border="B", align=align)
        pdf.ln(6)

    row([name for name, _, _ in COLS], bold=True)
    for ln in json.loads(c.lines or "[]"):
        row([ln["itemName"], str(ln["bills"]), _show(ln["quantity"]), _show(ln["freeQty"]),
             inr(Decimal(ln["discount"])), inr(Decimal(ln["value"]))])
    row(["Total", str(c.bills), _show(c.total_qty), _show(c.total_free_qty),
         inr(c.total_discount), inr(c.total_value)], bold=True)
    pdf.ln(4)
    pdf.set_font("Noto", "", 7.5)
    pdf.multi_cell(0, 4, "Value = discount given + free goods at the billed rate, from the scheme log in Bolcash, "
                         "net of returned bills; cancelled bills are left out.")
    return bytes(pdf.output())


def render_xlsx(business: Business, c: SchemeClaim) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Claim"
    for line in _title(business, c):
        ws.append([line])
    ws.append([])
    ws.append([name for name, _, _ in COLS])
    for ln in json.loads(c.lines or "[]"):
        ws.append([ln["itemName"], ln["bills"], float(ln["quantity"]), float(ln["freeQty"]),
                   float(ln["discount"]), float(ln["value"])])
    ws.append(["Total", c.bills, float(c.total_qty), float(c.total_free_qty),
               float(c.total_discount), float(c.total_value)])
    ws.column_dimensions["A"].width = 40
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
