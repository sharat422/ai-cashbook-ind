"""Retailer statements without the app: a scoped browser link and PDF, opt-in
WhatsApp sharing with opt-out, and a printable ledger with page totals.

Scoping: a link's token resolves to one (business, customer) pair and every
query below filters on that pair — a link has no way to name another retailer.
Consent is per retailer per distributor (one Customer row = one relationship)
and is never implied by trading: no opt-in row means "no".
"""
from __future__ import annotations

import hashlib
import hmac
import html
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from fastapi import HTTPException
from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.orm import Session

from .calc import days_since, paid_at_sale, today_iso
from .doc_i18n import ENGLISH, Tr, translator
from .errors import AppError
from .doc_i18n import date as ldate
from .config import settings
from .models import (Bill, BillLine, Business, Customer, LedgerEntry, SchemeApplication, StatementEvent,
                     StatementLink, User, in_books)

LINK_DAYS = 30
ZERO = Decimal("0.00")
FONTS = Path(__file__).parent / "fonts"
INDIC = ("Devanagari", "Bengali", "Gujarati", "Gurmukhi", "Tamil", "Telugu", "Kannada",
         "Malayalam")
AGEING = ("current", "d1_30", "d31_60", "d61_90", "d90_plus")  # labels: doc.ageing.<key>


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
        channel: str | None = None, note: str | None = None, user: User | None = None,
        message_id: str | None = None) -> None:
    db.add(StatementEvent(business_id=business_id, customer_id=customer_id, kind=kind,
                          source=source, channel=channel, note=note, message_id=message_id,
                          created_by=user.id if user else None))


# ------------------------------------------------------ every PDF share (ST3)

PDF_CHANNELS = ("whatsapp", "share_sheet", "email", "save")
# The open share sheet reaches WhatsApp too, so it's gated like WhatsApp.
GATED_CHANNELS = {"whatsapp", "share_sheet"}
NO_CONSENT = "No consent — ask the retailer to opt in."
PDF_LINK_MINUTES = 10


def _pdf_token(subject: str, exp: int) -> str:
    mac = hmac.new(settings.jwt_secret.encode(), f"pdf:{subject}:{exp}".encode(), hashlib.sha256)
    return f"{exp}.{mac.hexdigest()[:32]}"


def pdf_token_ok(subject: str, share: str | None) -> bool:
    """A server-made PDF (ledger, bill) is only served with a token that
    share_statement_pdf issued, for that document, in the last few minutes."""
    head = (share or "").split(".")[0]
    exp = int(head) if head.isdigit() else 0
    return bool(share) and exp >= time.time() and hmac.compare_digest(share, _pdf_token(subject, exp))


def share_statement_pdf(db: Session, business: Business, customer: Customer, channel: str, user: User,
                        what: str, subject: str | None = None) -> str | None:
    """The one door for every statement, ledger or bill PDF share. WhatsApp (and
    the open share sheet, which reaches WhatsApp) needs the retailer's opt-in
    for this distributor: refused and logged without it. Email and save are
    logged, not gated — the consent rule is about WhatsApp messages. Every
    share is in the log: channel, time, who. For a server-made PDF (`subject`)
    it returns the short-lived token its download needs; nothing else issues one."""
    if channel not in PDF_CHANNELS:
        raise HTTPException(422, f"Share by one of: {', '.join(PDF_CHANNELS)}.")
    if channel in GATED_CHANNELS and consent(db, business.id, customer.id)["status"] != "opted_in":
        log(db, business.id, customer.id, "blocked", "system", channel=f"pdf_{channel}",
            note=f"{what}: {NO_CONSENT}", user=user)
        db.commit()
        raise AppError(409, "no_consent", NO_CONSENT)
    if channel == "whatsapp" and not customer.mobile:
        raise HTTPException(422, "Add the retailer's mobile number first.")
    log(db, business.id, customer.id, "shared", "owner", channel=f"pdf_{channel}", note=what, user=user)
    db.commit()
    return _pdf_token(subject, int(time.time()) + PDF_LINK_MINUTES * 60) if subject else None


# -------------------------------------------------------------------- links

def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_link(db: Session, business: Business, customer: Customer, user: User | None,
             period_from: str | None, detailed: bool = False) -> str:
    token = secrets.token_urlsafe(24)  # 192 bits: unguessable
    expires = datetime.now(timezone.utc) + timedelta(days=LINK_DAYS)
    db.add(StatementLink(business_id=business.id, customer_id=customer.id,
                         token_hash=_hash(token), period_from=period_from, detailed=detailed,
                         created_by=user.id if user else None, expires_at=expires.isoformat()))
    log(db, business.id, customer.id, "link_created", "owner", channel="link", user=user)
    return f"{settings.public_base_url.rstrip('/')}/s/{token}"


REVOKED = "This link has been revoked."


def link_by_token(db: Session, token: str) -> StatementLink | None:
    return db.scalars(select(StatementLink).where(StatementLink.token_hash == _hash(token))).first()


def link_status(link: StatementLink) -> str:
    if link.revoked_at:
        return "revoked"
    return "expired" if link.expires_at < datetime.now(timezone.utc).isoformat() else "live"


def revoke(db: Session, link: StatementLink, user: User) -> None:
    """The owner closes a link now. A revoked link stays revoked: they send a
    fresh one instead (there is no un-revoke)."""
    if link.revoked_at:
        raise HTTPException(422, "This link is already revoked and can't be turned back on. Send a fresh link instead.")
    link.revoked_at = datetime.now(timezone.utc).isoformat()
    log(db, link.business_id, link.customer_id, "link_revoked", "owner", channel="link",
        note=f"Link sent {link.created_at[:10]} revoked", user=user)


def record_consent(db: Session, business_id: str, customer_id: str, kind: str, source: str, *,
                   channel: str, note: str | None = None, user: User | None = None,
                   message_id: str | None = None) -> None:
    """Every opt-in / opt-out goes through here (owner, the retailer's link, a
    STOP reply). An opt-out also revokes every live link of that retailer for
    this distributor, and logs it."""
    log(db, business_id, customer_id, kind, source, channel=channel, note=note, user=user, message_id=message_id)
    if kind != "opt_out":
        return
    now = datetime.now(timezone.utc).isoformat()
    live = db.scalars(select(StatementLink).where(
        StatementLink.business_id == business_id, StatementLink.customer_id == customer_id,
        StatementLink.revoked_at.is_(None), StatementLink.expires_at > now)).all()
    for link in live:
        link.revoked_at = now
    if live:
        log(db, business_id, customer_id, "link_revoked", "system", channel="link",
            note=f"{len(live)} live link(s) revoked: the retailer opted out", user=user)


def resolve(db: Session, token: str) -> tuple[StatementLink, Business, Customer]:
    """The link's own retailer, or 404 (unknown) / 410 (revoked, expired). Never more."""
    link = link_by_token(db, token)
    if link is None:
        raise HTTPException(404, "This statement link isn't valid.")
    if link.revoked_at:
        raise HTTPException(410, REVOKED)
    if link.expires_at < datetime.now(timezone.utc).isoformat():
        raise HTTPException(410, "This statement link has expired. Ask for a new one.")
    business = db.get(Business, link.business_id)
    customer = db.get(Customer, link.customer_id)
    if business is None or customer is None or customer.business_id != business.id:
        raise HTTPException(404, "This statement link isn't valid.")
    return link, business, customer


# ---------------------------------------------------------------- statement

@dataclass
class BillDetail:
    """What a sale row was for (ST6): its bill's lines and scheme lines, as
    text in the document's language. Detail only — never in a total."""
    count: int
    cancelled: bool
    lines: list[str]


@dataclass
class Row:
    date: str
    particulars: str
    debit: Decimal  # credit given (retailer owes more)
    credit: Decimal  # payment received
    balance: Decimal
    detail: BillDetail | None = None


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


def _particulars(e: LedgerEntry, t: Tr) -> str:
    # Notes are the owner's private remarks and are never shown to the retailer.
    if e.type == "credit":
        return f"{t('doc.sale')} · {e.invoice_number}" if e.invoice_number else t("doc.sale")
    if e.payment_method == "bill_return":
        return f"{t('doc.billReturn')} · {e.invoice_number}" if e.invoice_number else t("doc.billReturn")
    method = (e.payment_method or "").upper()
    return f"{t('doc.payment')} · {method}" if method else t("doc.payment")


def _qty(q) -> str:
    return f"{Decimal(q).normalize():f}"


def bill_details(db: Session, entry_ids: list[str], t: Tr) -> dict[str, BillDetail]:
    """Sale entry id -> its item bill's lines and scheme lines (sales typed in
    by hand have no bill, so no detail). A cancelled bill's lines say so."""
    bills = db.scalars(select(Bill).where(Bill.ledger_entry_id.in_(entry_ids))).all() if entry_ids else []
    if not bills:
        return {}
    ids = [b.id for b in bills]
    lines: dict[str, list[BillLine]] = {}
    for ln in db.scalars(select(BillLine).where(BillLine.bill_id.in_(ids))):
        lines.setdefault(ln.bill_id, []).append(ln)
    schemes: dict[str, list[SchemeApplication]] = {}
    for a in db.scalars(select(SchemeApplication).where(SchemeApplication.bill_id.in_(ids),
                                                        SchemeApplication.status == "applied")):
        schemes.setdefault(a.bill_id, []).append(a)
    out = {}
    for b in bills:
        cancelled = b.status == "cancelled"
        texts = []
        for ln in lines.get(b.id, []):
            mark = f" ({t('doc.cancelled')})" if cancelled else f" ({t('doc.returned')})" if ln.returned else ""
            texts.append(f"{ln.item_name} · {_qty(ln.quantity)} {ln.unit or ''} · {inr(money(ln.amount))}"
                         .replace("  ", " ") + mark)
        for a in schemes.get(b.id, []):
            what = (t("doc.free", qty=_qty(a.free_qty), item=a.free_item_name or "") if a.free_qty
                    else f"−{inr(money(a.discount))}")
            texts.append(f"• {a.scheme_name}: {what}")  # (no emoji: the PDF font has none)
        out[b.ledger_entry_id] = BillDetail(len(lines.get(b.id, [])), cancelled, texts)
    return out


def ageing(entries: list[LedgerEntry]) -> dict[str, Decimal]:
    """Oldest credits are paid first; the unpaid rest is bucketed by age.
    Cash GST sales (an invoice paid at once) aren't debt and are left out."""
    settled = paid_at_sale(entries)
    entries = [e for e in entries if e.id not in settled]
    pool = sum((money(e.amount) for e in entries if e.type == "payment"), ZERO)
    buckets = {k: ZERO for k in AGEING}
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


def build(db: Session, customer: Customer, start: str | None, end: str | None = None,
          t: Tr = ENGLISH) -> Statement:
    """Opening balance before `start`, the entries in [start, end] oldest first
    with running balance, totals, closing, current balance and ageing — the
    same rules as the app's on-screen statement. `t`: the document's language."""
    end = end or today_iso()
    entries = db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id == customer.id, in_books())
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
        rows.append(Row(e.date, _particulars(e, t), d, c, balance))
    in_period = [e for e in entries if not ((start and e.date < start) or e.date > end)]  # = rows, in order
    details = bill_details(db, [e.id for e in in_period if e.type == "credit"], t)
    for row, e in zip(rows, in_period):
        row.detail = details.get(e.id)
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


def paginate(st: Statement, first: int, per_page: int, detailed: bool = False) -> list[Page]:
    """Fixed lines per page, so every page's totals are known before drawing.
    A detailed PDF counts a sale's bill lines too (they take space, not totals)."""
    chunks: list[list[Row]] = [[]]
    used, budget = 0, first
    for r in st.rows:
        need = 1 + (len(r.detail.lines) if detailed and r.detail else 0)
        if used + need > budget and chunks[-1]:
            chunks.append([])
            used, budget = 0, per_page
        chunks[-1].append(r)
        used += need
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
        self.set_fallback_fonts(list(INDIC), exact_match=False)  # bold text: the regular Indic font (no bold files)
        self.set_text_shaping(True)
        self.set_font("Noto", size=9)

    def cell(self, *args, **kwargs):
        # fpdf 2.8: a cell that STARTS in a fallback font (e.g. a Telugu name or
        # heading) leaves that font current, and the next cell's Latin letters
        # vanish (the Telugu font has none). Select the chosen font again — in
        # the page itself, not just fpdf's pointer (set_font skips "no change").
        try:
            return super().cell(*args, **kwargs)
        finally:
            family, style, size = self.font_family, self.font_style, self.font_size_pt
            self.font_family = ""
            self.set_font(family, style, size)


COLS = (("doc.col.date", 24, "L"), ("doc.col.particulars", 70, "L"), ("doc.col.debit", 30, "R"),
        ("doc.col.credit", 30, "R"), ("doc.col.balance", 32, "R"))


def _row(pdf: FPDF, cells: list[str], bold: bool = False, fill: bool = False) -> None:
    pdf.set_font("Noto", "B" if bold else "", 9)
    if fill:
        pdf.set_fill_color(241, 245, 249)
    for (_, w, align), text in zip(COLS, cells):
        pdf.cell(w, 6, text, border="B", align=align, fill=fill)
    pdf.ln(6)


def render(business: Business, customer: Customer, st: Statement, *, kind: str, lang: str = "en",
           detailed: bool = False) -> bytes:
    """kind 'statement' (retailer copy: summary + ageing) or 'ledger' (print),
    in `lang` (reviewed strings; English where none). Amounts ₹ with Indian
    grouping; dates with the month in that language; names as typed."""
    t = translator(lang)
    statement = kind == "statement"
    pages = paginate(st, 16 if statement else 30, 30, detailed)
    start = ldate(t, st.start) if st.start else t("doc.beginning")
    party = customer.full_name + (f" ({customer.business_name})" if customer.business_name else "")
    pdf = _Pdf()
    for page in pages:
        pdf.add_page()
        pdf.set_font("Noto", "B", 14)
        pdf.cell(0, 7, business.business_name, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Noto", "", 9)
        pdf.cell(0, 5, f"{t('doc.statementOfAccount') if statement else t('doc.customerLedger')} · {party}",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 5, f"{t('doc.period', **{'from': start, 'to': ldate(t, st.end)})}    "
                       f"{t('doc.page', n=page.number, total=len(pages))}",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
        if statement and page.number == 1:
            pdf.set_font("Noto", "B", 10)
            for key, value in (("doc.openingBalance", st.opening), ("doc.salesInPeriod", st.total_debit),
                               ("doc.paymentsInPeriod", st.total_credit),
                               ("doc.closingBalance", st.closing), ("doc.currentBalance", st.current)):
                pdf.cell(60, 6, t(key))
                pdf.cell(40, 6, inr(value), align="R", new_x="LMARGIN", new_y="NEXT")
            pdf.ln(1)
            pdf.cell(0, 6, t("doc.ageingTitle"), new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("Noto", "", 9)
            for key in AGEING:
                pdf.cell(37, 5, t(f"doc.ageing.{key}"), align="C")
            pdf.ln(5)
            for key in AGEING:
                pdf.cell(37, 5, inr(st.ageing[key]), align="C")
            pdf.ln(8)
        _row(pdf, [t(c[0]) for c in COLS], bold=True, fill=True)
        _row(pdf, ["", t("doc.broughtForward"), "", "", inr(page.brought_forward)])
        for r in page.rows:
            _row(pdf, [ldate(t, r.date), r.particulars, inr(r.debit) if r.debit else "",
                       inr(r.credit) if r.credit else "", inr(r.balance)])
            if detailed and r.detail:  # the bill's lines, under the sale: detail, not totals
                pdf.set_font("Noto", "", 7.5)
                for text in r.detail.lines:
                    pdf.cell(COLS[0][1], 5, "")
                    pdf.cell(sum(w for _, w, _ in COLS[1:]), 5, f"   {text}", new_x="LMARGIN", new_y="NEXT")
        _row(pdf, ["", t("doc.pageTotal"), inr(page.debit), inr(page.credit), inr(page.carried_forward)],
             bold=True, fill=True)
        if page.number == len(pages):
            _row(pdf, ["", t("doc.periodTotal"), inr(st.total_debit), inr(st.total_credit), inr(st.closing)],
                 bold=True, fill=True)
        pdf.set_y(-14)
        pdf.set_font("Noto", "", 7)
        pdf.cell(0, 4, t("doc.footer", date=ldate(t, today_iso()), business=business.business_name), align="C")
    return bytes(pdf.output())


# ------------------------------------------------------------- bill PDF
# The same builder (fonts, layout helpers, ₹ formatting) as the statement.

def balance_after_bill(db: Session, customer: Customer, entry_id: str | None, day: str) -> Decimal:
    """What the retailer owed right after this bill's ledger entry (or, with
    none, at the end of the bill's date)."""
    entries = db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id == customer.id, in_books())
                         .order_by(LedgerEntry.date, LedgerEntry.created_at)).all()
    bal = ZERO
    for e in entries:
        if entry_id is None and e.date > day:
            break
        bal += money(e.amount) if e.type == "credit" else -money(e.amount)
        if e.id == entry_id:
            break
    return bal


BILL_COLS = (("Item", 80, "L"), ("Qty", 25, "R"), ("Rate", 30, "R"), ("Amount", 51, "R"))


def render_bill(business: Business, customer: Customer, bill, lines: list, schemes: list,
                balance_after: Decimal) -> bytes:
    """One item bill: retailer, number, date, lines, scheme lines, total, and
    the balance after it. English, like the statement (names in any script)."""
    pdf = _Pdf()
    pdf.add_page()
    pdf.set_font("Noto", "B", 14)
    pdf.cell(0, 7, business.business_name, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Noto", "", 10)
    party = customer.full_name + (f" ({customer.business_name})" if customer.business_name else "")
    kind = "Return" if bill.reverses_id else "Bill"
    pdf.cell(0, 6, f"{kind} {bill.bill_number} · {dmy(bill.date)} · {party}", new_x="LMARGIN", new_y="NEXT")
    if bill.status:
        pdf.cell(0, 6, f"Status: {bill.status.replace('_', ' ')}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    def row(cells, bold=False, fill=False):
        pdf.set_font("Noto", "B" if bold else "", 9)
        if fill:
            pdf.set_fill_color(241, 245, 249)
        for (_, w, align), text in zip(BILL_COLS, cells):
            pdf.cell(w, 6, text, border="B", align=align, fill=fill)
        pdf.ln(6)

    row([c[0] for c in BILL_COLS], bold=True, fill=True)
    for ln in lines:
        q = f"{Decimal(ln.quantity).normalize():f} {ln.unit or ''}".strip()
        row([ln.item_name + (" (returned)" if ln.returned else ""), q, inr(money(ln.rate)), inr(money(ln.amount))])
    applied = [a for a in schemes if a.status in ("applied", "reversed")]
    if applied:
        pdf.ln(1)
        pdf.set_font("Noto", "B", 9)
        pdf.cell(0, 6, "Schemes", new_x="LMARGIN", new_y="NEXT")
        for a in applied:
            what = (f"{Decimal(a.free_qty).normalize():f} {a.free_item_name} free" if a.free_qty
                    else f"−{inr(money(a.discount))}")
            row([f"{a.scheme_name} · {a.item_name}", "", "", what])
    pdf.ln(1)
    for label, value in (("Subtotal", bill.subtotal), ("Scheme discount", -money(bill.discount)),
                         ("Total", bill.total), ("Balance after this bill", balance_after)):
        pdf.set_font("Noto", "B" if label in ("Total", "Balance after this bill") else "", 10)
        pdf.cell(135, 6, label, align="R")
        pdf.cell(51, 6, inr(money(value)), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(-14)
    pdf.set_font("Noto", "", 7)
    pdf.cell(0, 4, f"Generated {dmy(today_iso())} by {business.business_name} with Bolcash. "
                   "Positive balance = amount due to the distributor.", align="C")
    return bytes(pdf.output())


# --------------------------------------------------------------------- HTML

def page_html(business: Business, customer: Customer, st: Statement, consent_status: str,
              notice: str | None, *, base: str, lang: str = "en") -> str:
    """The retailer's page: works in any phone browser, no app needed. In
    `lang` (reviewed strings; English where none)."""
    e = html.escape
    t = translator(lang)
    def particulars(r: Row) -> str:
        if not r.detail:
            return e(r.particulars)
        label = t("doc.items", count=r.detail.count) + (f" · {t('doc.cancelled')}" if r.detail.cancelled else "")
        items = "".join(f"<li>{e(x)}</li>" for x in r.detail.lines)
        return (f"{e(r.particulars)}<details{' class=x' if r.detail.cancelled else ''}><summary>{e(label)}</summary>"
                f"<ul>{items}</ul></details>")

    rows = "".join(
        f"<tr><td>{ldate(t, r.date)}</td><td>{particulars(r)}</td>"
        f"<td class=n>{inr(r.debit) if r.debit else ''}</td>"
        f"<td class=n>{inr(r.credit) if r.credit else ''}</td><td class=n>{inr(r.balance)}</td></tr>"
        for r in st.rows) or f"<tr><td colspan=5 class=m>{e(t('doc.noEntries'))}</td></tr>"
    ageing_cells = "".join(f"<td><small>{e(t(f'doc.ageing.{k}'))}</small><br><b>{inr(st.ageing[k])}</b></td>"
                           for k in AGEING)
    biz = business.business_name
    if consent_status == "opted_in":
        choice = (f"<form method=post action='{base}/opt-out'><p>{e(t('doc.optedIn', business=biz))}</p>"
                  f"<button>{e(t('doc.stop'))}</button></form>")
    else:
        choice = (f"<form method=post action='{base}/opt-in'><p>{e(t('doc.wantStatements', business=biz))}</p>"
                  f"<button>{e(t('doc.yesSend'))}</button></form>")
    banner = f"<p class=note>{e(notice)}</p>" if notice else ""
    party = customer.full_name + (f" · {customer.business_name}" if customer.business_name else "")
    period = t("doc.fromTo", **{"from": ldate(t, st.start) if st.start else t("doc.beginning"),
                                "to": ldate(t, st.end)})
    return f"""<!doctype html><html lang={'hi' if lang == 'hinglish' else lang}><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex>
<title>{e(t('doc.title'))} · {e(biz)}</title><style>
body{{font-family:system-ui,-apple-system,Roboto,'Noto Sans',sans-serif;margin:0;padding:16px;color:#0f172a;background:#f8fafc}}
main{{max-width:760px;margin:auto;background:#fff;border-radius:16px;padding:16px}}
h1{{font-size:20px;margin:0}} .s{{color:#64748b;font-size:13px}}
table{{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}}
td,th{{padding:6px;border-bottom:1px solid #e2e8f0;text-align:left}} .n{{text-align:right}} .m{{color:#94a3b8;text-align:center}}
.sum td{{border:0;padding:3px 0}} .age td{{text-align:center;border:0}} .big{{font-size:22px;font-weight:700}}
a.b,button{{display:inline-block;background:#0f172a;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-size:14px;text-decoration:none}}
form{{margin-top:18px;padding-top:12px;border-top:1px solid #e2e8f0}} .note{{background:#ecfdf5;padding:10px;border-radius:10px}}
details{{font-size:12px;color:#475569}} summary{{cursor:pointer;color:#0f172a}} details ul{{margin:4px 0;padding-left:16px}} details.x li{{text-decoration:line-through}}
</style></head><body><main>
{banner}<h1>{e(business.business_name)}</h1>
<p class=s>{e(t('doc.statementFor', name=party))}<br>
{e(period)}</p>
<p>{e(t('doc.currentBalance'))}<br><span class=big>{inr(st.current)}</span></p>
<p><a class=b href="{base}/statement.pdf">{e(t('doc.downloadPdf'))}</a></p>
<table class=sum><tr><td>{e(t('doc.openingBalance'))}</td><td class=n>{inr(st.opening)}</td></tr>
<tr><td>{e(t('doc.salesInPeriod'))}</td><td class=n>{inr(st.total_debit)}</td></tr>
<tr><td>{e(t('doc.paymentsInPeriod'))}</td><td class=n>{inr(st.total_credit)}</td></tr>
<tr><td><b>{e(t('doc.closingBalance'))}</b></td><td class=n><b>{inr(st.closing)}</b></td></tr></table>
<p class=s>{e(t('doc.ageingTitle'))}</p><table class=age><tr>{ageing_cells}</tr></table>
<table><tr><th>{e(t('doc.col.date'))}</th><th>{e(t('doc.col.particulars'))}</th><th class=n>{e(t('doc.col.sale'))}</th><th class=n>{e(t('doc.col.paid'))}</th><th class=n>{e(t('doc.col.balance'))}</th></tr>{rows}</table>
{choice}
<p class=s>{e(t('doc.sharedBy', business=biz))}</p>
</main></body></html>"""

