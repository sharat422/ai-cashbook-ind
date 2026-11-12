"""Retailer statements without the app: a scoped browser link and PDF, opt-in
WhatsApp sharing with opt-out, and a printable ledger with page totals. Bill
PDFs (render_bill) use the same PDF builder and the same consent and log.

Scoping: a link's token resolves to one (business, customer) pair and every
query below filters on that pair — a link has no way to name another retailer.
Consent is per retailer per distributor (one Customer row = one relationship)
and is never implied by trading: no opt-in row means "no".
"""
from __future__ import annotations

import hashlib
import html
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from fastapi import HTTPException
from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.orm import Session

from .calc import days_since, today_iso
from .config import settings
from .models import (Bill, BillLine, Business, Customer, LedgerEntry, SchemeApplication,
                     StatementEvent, StatementLink, User)

LINK_DAYS = 30
ZERO = Decimal("0.00")
FONTS = Path(__file__).parent / "fonts"
INDIC = ("Devanagari", "Bengali", "Gujarati", "Gurmukhi", "Tamil", "Telugu", "Kannada",
         "Malayalam")
AGEING = (("current", "Not yet due"), ("d1_30", "1–30 days"), ("d31_60", "31–60 days"),
          ("d61_90", "61–90 days"), ("d90_plus", "Over 90 days"))


def money(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def inr(x: Decimal) -> str:
    """₹1,23,456.70 (Indian grouping); negative as −₹…"""
    neg = x < 0
    whole, frac = f"{abs(x):.2f}".split(".")
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    grouped = ",".join(groups + [tail]) if groups else tail
    return f"{'−' if neg else ''}₹{grouped}.{frac}"


def dmy(iso: str) -> str:
    y, m, d = iso[:10].split("-")
    return f"{d}-{m}-{y}"


# ------------------------------------------------------------------ consent

def consent(db: Session, business_id: str, customer_id: str) -> dict:
    last = db.scalars(
        select(StatementEvent).where(
            StatementEvent.business_id == business_id, StatementEvent.customer_id == customer_id,
            StatementEvent.kind.in_(("opt_in", "opt_out")))
        .order_by(StatementEvent.created_at.desc(), StatementEvent.id.desc())
    ).first()
    status = {"opt_in": "opted_in", "opt_out": "opted_out"}.get(last.kind) if last else "none"
    return {"status": status, "since": last.created_at if last else None,
            "source": last.source if last else None}


def log(db: Session, business_id: str, customer_id: str, kind: str, source: str, *,
        channel: str | None = None, note: str | None = None, user: User | None = None) -> None:
    db.add(StatementEvent(business_id=business_id, customer_id=customer_id, kind=kind,
                          source=source, channel=channel, note=note,
                          created_by=user.id if user else None))


# -------------------------------------------------------------------- links

def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_link(db: Session, business: Business, customer: Customer, user: User,
             period_from: str | None) -> str:
    token = secrets.token_urlsafe(24)  # 192 bits: unguessable
    expires = datetime.now(timezone.utc) + timedelta(days=LINK_DAYS)
    db.add(StatementLink(business_id=business.id, customer_id=customer.id,
                         token_hash=_hash(token), period_from=period_from,
                         created_by=user.id, expires_at=expires.isoformat()))
    log(db, business.id, customer.id, "link_created", "owner", channel="link", user=user)
    return f"{settings.public_base_url.rstrip('/')}/s/{token}"


def resolve(db: Session, token: str) -> tuple[StatementLink, Business, Customer]:
    """The link's own retailer, or 404 (unknown) / 410 (expired). Never more."""
    link = db.scalars(select(StatementLink).where(StatementLink.token_hash == _hash(token))).first()
    if link is None:
        raise HTTPException(404, "This statement link isn't valid.")
    if link.expires_at < datetime.now(timezone.utc).isoformat():
        raise HTTPException(410, "This statement link has expired. Ask for a new one.")
    business = db.get(Business, link.business_id)
    customer = db.get(Customer, link.customer_id)
    if business is None or customer is None or customer.business_id != business.id:
        raise HTTPException(404, "This statement link isn't valid.")
    return link, business, customer


# ---------------------------------------------------------------- statement

@dataclass
class Row:
    date: str
    particulars: str
    debit: Decimal  # credit given (retailer owes more)
    credit: Decimal  # payment received
    balance: Decimal


@dataclass
class Statement:
    start: str | None
    end: str
    opening: Decimal
    rows: list[Row]
    total_debit: Decimal
    total_credit: Decimal
    closing: Decimal
    current: Decimal
    ageing: dict[str, Decimal] = field(default_factory=dict)


def _particulars(e: LedgerEntry) -> str:
    # Notes are the owner's private remarks and are never shown to the retailer.
    if e.type == "credit":
        return f"Sale · {e.invoice_number}" if e.invoice_number else "Sale"
    method = (e.payment_method or "").upper()
    return f"Payment · {method}" if method else "Payment"


def ageing(entries: list[LedgerEntry]) -> dict[str, Decimal]:
    """Oldest credits are paid first; the unpaid rest is bucketed by age."""
    pool = sum((money(e.amount) for e in entries if e.type == "payment"), ZERO)
    buckets = {k: ZERO for k, _ in AGEING}
    for c in sorted((e for e in entries if e.type == "credit"), key=lambda e: (e.date, e.created_at)):
        applied = min(pool, money(c.amount))
        pool -= applied
        unpaid = money(c.amount) - applied
        if unpaid <= 0:
            continue
        age = days_since(c.date)
        key = ("current" if age <= 0 else "d1_30" if age <= 30 else "d31_60" if age <= 60
               else "d61_90" if age <= 90 else "d90_plus")
        buckets[key] += unpaid
    return buckets


def build(db: Session, customer: Customer, start: str | None, end: str | None = None) -> Statement:
    """Opening balance before `start`, the entries in [start, end] oldest first
    with running balance, totals, closing, current balance and ageing — the
    same rules as the app's on-screen statement."""
    end = end or today_iso()
    entries = db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id == customer.id)
                         .order_by(LedgerEntry.date, LedgerEntry.created_at)).all()
    signed = lambda e: money(e.amount) if e.type == "credit" else -money(e.amount)  # noqa: E731
    opening = sum((signed(e) for e in entries if start and e.date < start), ZERO)
    balance, rows, debit, credit = opening, [], ZERO, ZERO
    for e in entries:
        if (start and e.date < start) or e.date > end:
            continue
        balance += signed(e)
        d, c = (money(e.amount), ZERO) if e.type == "credit" else (ZERO, money(e.amount))
        debit, credit = debit + d, credit + c
        rows.append(Row(e.date, _particulars(e), d, c, balance))
    return Statement(start=start, end=end, opening=opening, rows=rows, total_debit=debit,
                     total_credit=credit, closing=opening + debit - credit,
                     current=sum((signed(e) for e in entries), ZERO), ageing=ageing(entries))


@dataclass
class Page:
    number: int
    brought_forward: Decimal
    rows: list[Row]
    debit: Decimal
    credit: Decimal
    carried_forward: Decimal


def paginate(st: Statement, first: int, per_page: int) -> list[Page]:
    """Fixed rows per page, so every page's totals are known before drawing."""
    chunks = [st.rows[:first]] + [st.rows[i:i + per_page] for i in range(first, len(st.rows), per_page)]
    pages, bf = [], st.opening
    for n, chunk in enumerate(chunks):  # the first chunk may be empty: one blank page
        d = sum((r.debit for r in chunk), ZERO)
        c = sum((r.credit for r in chunk), ZERO)
        pages.append(Page(n + 1, bf, chunk, d, c, bf + d - c))
        bf = bf + d - c
    return pages


# ---------------------------------------------------------------------- PDF

class _Pdf(FPDF):
    def __init__(self):
        super().__init__(format="A4")
        self.set_margins(12, 12, 12)
        self.set_auto_page_break(False)
        self.add_font("Noto", "", str(FONTS / "NotoSans-Regular.ttf"))
        self.add_font("Noto", "B", str(FONTS / "NotoSans-Bold.ttf"))
        for script in INDIC:
            self.add_font(script, "", str(FONTS / f"NotoSans{script}-Regular.ttf"))
        self.set_fallback_fonts(list(INDIC))
        self.set_text_shaping(True)
        self.set_font("Noto", size=9)


COLS = (("Date", 24, "L"), ("Particulars", 70, "L"), ("Debit (sale)", 30, "R"),
        ("Credit (paid)", 30, "R"), ("Balance", 32, "R"))


def _row(pdf: FPDF, cells: list[str], bold: bool = False, fill: bool = False) -> None:
    pdf.set_font("Noto", "B" if bold else "", 9)
    if fill:
        pdf.set_fill_color(241, 245, 249)
    for (_, w, align), text in zip(COLS, cells):
        pdf.cell(w, 6, text, border="B", align=align, fill=fill)
    pdf.ln(6)


def render(business: Business, customer: Customer, st: Statement, *, kind: str) -> bytes:
    """kind 'statement' (retailer copy: summary + ageing) or 'ledger' (print)."""
    statement = kind == "statement"
    pages = paginate(st, 16 if statement else 30, 30)
    period = f"{dmy(st.start) if st.start else 'Beginning'} to {dmy(st.end)}"
    party = customer.full_name + (f" ({customer.business_name})" if customer.business_name else "")
    pdf = _Pdf()
    for page in pages:
        pdf.add_page()
        pdf.set_font("Noto", "B", 14)
        pdf.cell(0, 7, business.business_name, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Noto", "", 9)
        pdf.cell(0, 5, f"{'Statement of account' if statement else 'Customer ledger'} · {party}",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 5, f"Period: {period}    Page {page.number} of {len(pages)}",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
        if statement and page.number == 1:
            pdf.set_font("Noto", "B", 10)
            for label, value in (("Opening balance", st.opening), ("Sales in period", st.total_debit),
                                 ("Payments in period", st.total_credit),
                                 ("Closing balance", st.closing), ("Current balance", st.current)):
                pdf.cell(60, 6, label)
                pdf.cell(40, 6, inr(value), align="R", new_x="LMARGIN", new_y="NEXT")
            pdf.ln(1)
            pdf.cell(0, 6, "Ageing of the current balance", new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("Noto", "", 9)
            for key, label in AGEING:
                pdf.cell(37, 5, label, align="C")
            pdf.ln(5)
            for key, _ in AGEING:
                pdf.cell(37, 5, inr(st.ageing[key]), align="C")
            pdf.ln(8)
        _row(pdf, [c[0] for c in COLS], bold=True, fill=True)
        _row(pdf, ["", "Brought forward", "", "", inr(page.brought_forward)])
        for r in page.rows:
            _row(pdf, [dmy(r.date), r.particulars, inr(r.debit) if r.debit else "",
                       inr(r.credit) if r.credit else "", inr(r.balance)])
        _row(pdf, ["", "Page total", inr(page.debit), inr(page.credit), inr(page.carried_forward)],
             bold=True, fill=True)
        if page.number == len(pages):
            _row(pdf, ["", "Period total", inr(st.total_debit), inr(st.total_credit), inr(st.closing)],
                 bold=True, fill=True)
        pdf.set_y(-14)
        pdf.set_font("Noto", "", 7)
        pdf.cell(0, 4, f"Generated {dmy(today_iso())} by {business.business_name} with Bolcash. "
                       "Positive balance = amount due to the distributor.", align="C")
    return bytes(pdf.output())


# ------------------------------------------------------------------ bill PDF

def balance_after(db: Session, customer: Customer, bill: Bill) -> Decimal:
    """The retailer's balance right after this bill: every ledger entry up to
    and including the bill's own credit entry, in ledger order. Later entries
    (payments, newer bills) never change what this bill's PDF says."""
    entries = db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id == customer.id)
                         .order_by(LedgerEntry.date, LedgerEntry.created_at, LedgerEntry.id)).all()
    own = next((e for e in entries if e.id == bill.ledger_entry_id), None)
    cut = (own.date, own.created_at) if own else (bill.date, bill.created_at)
    signed = lambda e: money(e.amount) if e.type == "credit" else -money(e.amount)  # noqa: E731
    return sum((signed(e) for e in entries if (e.date, e.created_at) <= cut), ZERO)


def _q(x) -> str:
    """20.000 -> 20, 1.500 -> 1.5"""
    d = Decimal(x).normalize()
    return f"{d:f}"


BILL_COLS = (("Item", 84, "L"), ("Qty", 26, "R"), ("Rate", 38, "R"), ("Amount", 38, "R"))


def render_bill(db: Session, business: Business, customer: Customer, bill: Bill) -> bytes:
    """The retailer's copy of one bill: lines, scheme lines, total, and the
    balance after this bill. English, like every server file (TE5)."""
    lines = db.scalars(select(BillLine).where(BillLine.bill_id == bill.id)
                       .order_by(BillLine.id)).all()
    schemes = db.scalars(select(SchemeApplication).where(
        SchemeApplication.bill_id == bill.id, SchemeApplication.status == "applied")
        .order_by(SchemeApplication.id)).all()
    order = {ln.item_id: i for i, ln in enumerate(lines)}
    schemes = sorted(schemes, key=lambda a: order.get(a.item_id, len(order)))
    party = customer.full_name + (f" ({customer.business_name})" if customer.business_name else "")
    pdf = _Pdf()

    def header(first: bool) -> None:
        pdf.add_page()
        pdf.set_font("Noto", "B", 14)
        pdf.cell(0, 7, business.business_name, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Noto", "", 9)
        pdf.cell(0, 5, f"Bill {bill.bill_number} · {dmy(bill.date)}", new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 5, f"To: {party}" + ("" if first else " (continued)"),
                 new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
        row([c[0] for c in BILL_COLS], bold=True, fill=True)

    def row(cells: list[str], bold: bool = False, fill: bool = False) -> None:
        if pdf.get_y() > 265:
            header(False)
        pdf.set_font("Noto", "B" if bold else "", 9)
        if fill:
            pdf.set_fill_color(241, 245, 249)
        for (_, w, align), text in zip(BILL_COLS, cells):
            pdf.cell(w, 6, text, border="B", align=align, fill=fill)
        pdf.ln(6)

    header(True)
    for ln in lines:
        unit = f" {ln.unit}" if ln.unit else ""
        row([ln.item_name, f"{_q(ln.quantity)}{unit}", inr(money(ln.rate)), inr(money(ln.amount))])
    if schemes:
        row(["Schemes", "", "", ""], bold=True)
        for a in schemes:
            if a.free_item_id and Decimal(a.free_qty) > 0:
                what = f"{_q(a.free_qty)} {a.free_item_name or 'item'} free"
                row([f"{a.scheme_name} · {a.item_name}: {what}", _q(a.free_qty), "", "Free"])
            else:
                row([f"{a.scheme_name} · {a.item_name}", "", "", inr(-money(a.discount))])
    row(["Items total", "", "", inr(money(bill.subtotal))])
    row(["Scheme discount", "", "", inr(-money(bill.discount))])
    row(["Bill total", "", "", inr(money(bill.total))], bold=True, fill=True)
    row(["Balance after this bill", "", "", inr(balance_after(db, customer, bill))],
        bold=True, fill=True)
    pdf.set_y(-14)
    pdf.set_font("Noto", "", 7)
    pdf.cell(0, 4, f"Generated {dmy(today_iso())} by {business.business_name} with Bolcash. "
                   "Positive balance = amount due to the distributor.", align="C")
    return bytes(pdf.output())


# --------------------------------------------------------------------- HTML

def page_html(business: Business, customer: Customer, st: Statement, consent_status: str,
              notice: str | None, *, base: str) -> str:
    """The retailer's page: works in any phone browser, no app needed."""
    e = html.escape
    rows = "".join(
        f"<tr><td>{dmy(r.date)}</td><td>{e(r.particulars)}</td>"
        f"<td class=n>{inr(r.debit) if r.debit else ''}</td>"
        f"<td class=n>{inr(r.credit) if r.credit else ''}</td><td class=n>{inr(r.balance)}</td></tr>"
        for r in st.rows) or "<tr><td colspan=5 class=m>No entries in this period</td></tr>"
    ageing_cells = "".join(f"<td><small>{label}</small><br><b>{inr(st.ageing[k])}</b></td>"
                           for k, label in AGEING)
    if consent_status == "opted_in":
        choice = (f"<form method=post action='{base}/opt-out'><p>You get statements from "
                  f"{e(business.business_name)} on WhatsApp.</p>"
                  "<button>Stop WhatsApp statements</button></form>")
    else:
        choice = (f"<form method=post action='{base}/opt-in'><p>Want statements from "
                  f"{e(business.business_name)} on WhatsApp?</p>"
                  "<button>Yes, send them on WhatsApp</button></form>")
    banner = f"<p class=note>{e(notice)}</p>" if notice else ""
    return f"""<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex>
<title>Statement · {e(business.business_name)}</title><style>
body{{font-family:system-ui,-apple-system,Roboto,'Noto Sans',sans-serif;margin:0;padding:16px;color:#0f172a;background:#f8fafc}}
main{{max-width:760px;margin:auto;background:#fff;border-radius:16px;padding:16px}}
h1{{font-size:20px;margin:0}} .s{{color:#64748b;font-size:13px}}
table{{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}}
td,th{{padding:6px;border-bottom:1px solid #e2e8f0;text-align:left}} .n{{text-align:right}} .m{{color:#94a3b8;text-align:center}}
.sum td{{border:0;padding:3px 0}} .age td{{text-align:center;border:0}} .big{{font-size:22px;font-weight:700}}
a.b,button{{display:inline-block;background:#0f172a;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-size:14px;text-decoration:none}}
form{{margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0}} .note{{background:#ecfdf5;padding:10px;border-radius:10px}}
</style></head><body><main>
{banner}<h1>{e(business.business_name)}</h1>
<p class=s>Statement for {e(customer.full_name)}{(' · ' + e(customer.business_name)) if customer.business_name else ''}<br>
{dmy(st.start) if st.start else 'From the beginning'} to {dmy(st.end)}</p>
<p>Current balance<br><span class=big>{inr(st.current)}</span></p>
<p><a class=b href="{base}/statement.pdf">Download PDF</a></p>
<table class=sum><tr><td>Opening balance</td><td class=n>{inr(st.opening)}</td></tr>
<tr><td>Sales in period</td><td class=n>{inr(st.total_debit)}</td></tr>
<tr><td>Payments in period</td><td class=n>{inr(st.total_credit)}</td></tr>
<tr><td><b>Closing balance</b></td><td class=n><b>{inr(st.closing)}</b></td></tr></table>
<p class=s>Ageing of the current balance</p><table class=age><tr>{ageing_cells}</tr></table>
<table><tr><th>Date</th><th>Particulars</th><th class=n>Sale</th><th class=n>Paid</th><th class=n>Balance</th></tr>{rows}</table>
{choice}
<p class=s>Shared by {e(business.business_name)} using Bolcash. You don't need the app to view this.</p>
</main></body></html>"""

