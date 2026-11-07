"""Bring an existing khata in from Excel/CSV (another app's export, or a paper
register typed into a sheet).

The person maps each column; we only guess a starting mapping from header
names. `preview()` never writes anything — it is the dry run. `run()` repeats
the same checks, saves a backup of the books, then writes everything in one
transaction.

Duplicate rule: a row with the same retailer + bill reference + amount + date
as an entry already in the books, or as an earlier row of the same file, is
flagged and skipped. Re-importing a file therefore adds nothing.

Row problems come back as reason codes (not English) so the app can show them
in the user's language.
"""
from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import data_export
from .bank_statement import MAX_ROWS, StatementError, parse_amount, parse_date
from .bank_statement import _rows as read_rows
from .calc import recompute_customer, today_iso
from .models import Business, Customer, ImportLog, LedgerEntry, User

FIELDS = ("date", "retailer", "billRef", "amount", "type", "opening")
REQUIRED = ("retailer", "amount")
LIST_LIMIT = 100  # duplicates / problems listed in a preview (counts are exact)


def _key(text) -> str:
    """Case/space/punctuation-insensitive form, any script."""
    return re.sub(r"[\W_]+", "", str(text or "").casefold())


def _name(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


_HEADERS = {
    "date": ("date", "billdate", "invoicedate", "txndate", "transactiondate", "entrydate",
             "tarikh", "tareekh", "తేదీ", "तारीख", "दिनांक"),
    "retailer": ("retailer", "retailername", "customer", "customername", "party", "partyname",
                 "name", "shop", "shopname", "దుకాణం", "కస్టమర్", "పేరు", "पार्टी", "ग्राहक", "दुकान", "नाम"),
    "billRef": ("bill", "billno", "billnumber", "billref", "invoice", "invoiceno", "invoicenumber",
                "ref", "refno", "reference", "voucherno", "vchno", "బిల్లు", "बिल"),
    "amount": ("amount", "amt", "rs", "rupees", "value", "మొత్తం", "रकम", "राशि"),
    "type": ("type", "entrytype", "udharjama", "drcr", "crdr", "txntype", "రకం", "प्रकार"),
    "opening": ("opening", "openingbalance", "ob", "isopening", "openingflag"),
}
_HEADERS = {f: tuple(_key(n) for n in names) for f, names in _HEADERS.items()}

# Udhar (credit given — the retailer owes more) vs jama (money received).
# In a customer's account Dr = owes, Cr = paid, as in Tally/paper khatas.
_CREDIT = {_key(w) for w in ("udhar", "udhaar", "udhari", "credit", "sale", "sales", "dr", "debit",
                             "given", "baki", "baaki", "అప్పు", "ఉద్దెర", "ఉద్దెరా", "उधार", "बाकी")}
_PAYMENT = {_key(w) for w in ("jama", "jamaa", "payment", "paid", "received", "receipt", "cr",
                              "collection", "జమ", "జమా", "जमा")}
_YES = {_key(w) for w in ("yes", "y", "true", "1", "opening", "ob", "haan", "ha", "అవును", "हाँ", "हां", "x")}
_NO = {"", *(_key(w) for w in ("no", "n", "false", "0", "కాదు", "नहीं"))}


class ImportFileError(ValueError):
    """The file as a whole can't be used (unreadable, too big, no columns)."""


@dataclass
class Row:
    row: int  # 1-based row number in the file, as the person sees it
    retailer: str
    bill_ref: str
    amount: Decimal  # > 0
    type: str  # credit | payment
    date: str
    opening: bool

    @property
    def dup_key(self) -> tuple:
        return (_key(self.retailer), self.bill_ref.casefold(), int(self.amount * 100), self.date)


@dataclass
class Plan:
    file_name: str
    headers: list[str]
    header_row: int
    mapping: dict[str, int | None]
    missing: list[str]
    row_count: int = 0
    rows: list[Row] = field(default_factory=list)  # to import
    duplicates: list[dict] = field(default_factory=list)
    issues: list[dict] = field(default_factory=list)
    new_retailers: list[str] = field(default_factory=list)
    customers: dict[str, Customer] = field(default_factory=dict)  # name key -> existing

    @property
    def skipped(self) -> int:
        return len(self.duplicates) + len(self.issues)


def guess_mapping(headers: list) -> dict[str, int | None]:
    keys = [_key(h) for h in headers]
    out: dict[str, int | None] = {}
    used: set[int] = set()
    for f in FIELDS:
        out[f] = next((i for name in _HEADERS[f] for i, k in enumerate(keys)
                       if k == name and i not in used), None)
        if out[f] is not None:
            used.add(out[f])
    return out


def _cell_text(cell) -> str:
    if isinstance(cell, float) and cell.is_integer():
        return str(int(cell))  # Excel stores bill no. 1042 as 1042.0
    return _name(cell)


def _header_row(rows: list[list]) -> int:
    for i, row in enumerate(rows[:20]):
        if sum(v is not None for v in guess_mapping(row).values()) >= 2:
            return i
    for i, row in enumerate(rows[:20]):
        if any(_cell_text(c) for c in row):
            return i
    raise ImportFileError("The file has no rows.")


def _clean_mapping(raw: dict | None, guessed: dict, width: int) -> dict[str, int | None]:
    if raw is None:
        return guessed
    out = {}
    for f in FIELDS:
        v = raw.get(f)
        if v is None or v == "":
            out[f] = None
        elif isinstance(v, int) and not isinstance(v, bool) and 0 <= v < width:
            out[f] = v
        else:
            raise ImportFileError(f"Column for '{f}' is not in the file.")
    return out


def _parse_row(n: int, cells: list, m: dict, fallback_date: str | None) -> Row | dict:
    def cell(f):
        i = m.get(f)
        return cells[i] if i is not None and i < len(cells) else None

    retailer = _cell_text(cell("retailer"))
    if not retailer:
        return {"row": n, "reason": "missing_retailer"}
    if len(retailer) > 200:
        return {"row": n, "reason": "long_name"}
    raw_amount = cell("amount")
    if isinstance(raw_amount, float):
        raw_amount = round(raw_amount, 2)  # Excel float noise (0.1 + 0.2)
    try:
        amount = parse_amount(raw_amount)
    except ValueError:
        return {"row": n, "reason": "bad_amount"}
    if amount is None:
        return {"row": n, "reason": "bad_amount"}
    if amount == 0:
        return {"row": n, "reason": "zero_amount"}
    if abs(amount) > Decimal("100000000"):
        return {"row": n, "reason": "bad_amount"}

    opening_text = _cell_text(cell("opening"))
    opening_raw = _key(opening_text)
    if opening_raw in _YES or opening_text in ("✓", "✔"):  # a tick has no letters to _key
        opening = True
    elif opening_raw in _NO:
        opening = False
    else:
        return {"row": n, "reason": "bad_opening"}

    type_raw = _key(_cell_text(cell("type")))
    if type_raw in _CREDIT:
        entry_type = "credit"
    elif type_raw in _PAYMENT:
        entry_type = "payment"
    elif type_raw == "":
        entry_type = "payment" if amount < 0 else "credit"  # no type: sign decides
    else:
        return {"row": n, "reason": "bad_type"}

    raw_date = cell("date")
    if raw_date is None or _cell_text(raw_date) == "":
        if not opening or fallback_date is None:
            return {"row": n, "reason": "missing_date"}
        day = fallback_date
    else:
        try:
            day = parse_date(raw_date)
        except ValueError:
            return {"row": n, "reason": "bad_date"}
    if day > today_iso():
        return {"row": n, "reason": "future_date"}

    return Row(row=n, retailer=retailer, bill_ref=_cell_text(cell("billRef"))[:80],
               amount=abs(amount).quantize(Decimal("0.01")), type=entry_type, date=day,
               opening=opening)


def plan(db: Session, business: Business, data: bytes, file_name: str,
         mapping: dict | None = None) -> Plan:
    try:
        rows = read_rows(data, file_name)
    except StatementError as err:
        raise ImportFileError(str(err)) from err
    if len(rows) >= MAX_ROWS + 50:
        raise ImportFileError(f"The file has more than {MAX_ROWS:,} rows. Split it and import each part.")
    h = _header_row(rows)
    headers = [_cell_text(c) for c in rows[h]]
    m = _clean_mapping(mapping, guess_mapping(rows[h]), len(headers))
    p = Plan(file_name=file_name, headers=headers, header_row=h + 1, mapping=m,
             missing=[f for f in REQUIRED if m[f] is None])
    body = [(h + 2 + i, r) for i, r in enumerate(rows[h + 1:]) if any(_cell_text(c) for c in r)]
    p.row_count = len(body)
    if p.missing:
        return p

    # An opening balance with no date goes on the file's earliest day (else today).
    dates = []
    if m["date"] is not None:
        for _, r in body:
            try:
                if m["date"] < len(r) and _cell_text(r[m["date"]]):
                    dates.append(parse_date(r[m["date"]]))
            except ValueError:
                pass
    fallback = min(dates, default=today_iso())

    by_name: dict[str, list[Customer]] = {}
    for c in db.scalars(select(Customer).where(Customer.business_id == business.id)).all():
        by_name.setdefault(_key(c.full_name), []).append(c)
    ids = {c.id: k for k, cs in by_name.items() for c in cs}
    seen = {
        (ids[e.customer_id], (e.invoice_number or "").casefold(),
         int((Decimal(str(e.amount)) * 100).quantize(Decimal("1"))), e.date)
        for e in (db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id.in_(list(ids)))).all()
                  if ids else [])
    }
    in_file: set[tuple] = set()
    new: dict[str, str] = {}
    for n, cells in body:
        r = _parse_row(n, cells, m, fallback)
        if isinstance(r, dict):
            p.issues.append(r)
            continue
        k = _key(r.retailer)
        if len(by_name.get(k, [])) > 1:
            p.issues.append({"row": n, "reason": "ambiguous_retailer", "retailer": r.retailer})
            continue
        if r.dup_key in seen or r.dup_key in in_file:
            p.duplicates.append({"row": n, "retailer": r.retailer, "billRef": r.bill_ref,
                                 "amount": float(r.amount), "date": r.date,
                                 "against": "file" if r.dup_key in in_file else "books"})
            continue
        in_file.add(r.dup_key)
        p.rows.append(r)
        if k in by_name:
            p.customers[k] = by_name[k][0]
        else:
            new.setdefault(k, r.retailer)
    p.new_retailers = sorted(new.values(), key=str.casefold)
    return p


def _signed(r: Row) -> Decimal:
    return r.amount if r.type == "credit" else -r.amount


def preview_dto(p: Plan) -> dict:
    total = lambda rows: float(sum((_signed(r) for r in rows), Decimal("0")))  # noqa: E731
    return {
        "fileName": p.file_name,
        "headers": p.headers,
        "headerRow": p.header_row,
        "mapping": p.mapping,
        "missing": p.missing,
        "rowCount": p.row_count,
        "toImport": len(p.rows),
        "skipped": p.skipped,
        "newRetailers": p.new_retailers,
        "duplicateCount": len(p.duplicates),
        "duplicates": p.duplicates[:LIST_LIMIT],
        "issueCount": len(p.issues),
        "issues": p.issues[:LIST_LIMIT],
        "openingTotal": total([r for r in p.rows if r.opening]),
        "udharTotal": float(sum((r.amount for r in p.rows if r.type == "credit"), Decimal("0"))),
        "jamaTotal": float(sum((r.amount for r in p.rows if r.type == "payment"), Decimal("0"))),
        "sample": [{"row": r.row, "retailer": r.retailer, "billRef": r.bill_ref,
                    "amount": float(r.amount), "type": r.type, "date": r.date,
                    "opening": r.opening} for r in p.rows[:5]],
    }


def run(db: Session, business: Business, user: User, role: str, data: bytes, file_name: str,
        mapping: dict | None) -> ImportLog:
    # Serialize imports per business (Postgres row lock), so a double tap plans
    # the second run against the first one's rows and imports nothing twice.
    db.execute(select(Business).where(Business.id == business.id).with_for_update())
    p = plan(db, business, data, file_name, mapping)
    if p.missing:
        raise ImportFileError("Choose the retailer and amount columns first.")

    backup = base64.b64encode(data_export.workbook(db, business)).decode()
    log = ImportLog(business_id=business.id, user_id=user.id,
                    imported_by=f"{role} · {user.mobile}"[:60], file_name=file_name[:200] or "file",
                    rows_imported=len(p.rows), rows_skipped=p.skipped,
                    new_retailers=len(p.new_retailers), backup=backup)
    db.add(log)
    db.flush()

    customers = dict(p.customers)
    for r in p.rows:
        k = _key(r.retailer)
        if k not in customers:
            customers[k] = Customer(business_id=business.id, full_name=r.retailer, mobile="")
            db.add(customers[k])
    db.flush()
    # Opening balances first, so a statement's running balance starts from them.
    for r in sorted(p.rows, key=lambda r: not r.opening):
        db.add(LedgerEntry(
            customer_id=customers[_key(r.retailer)].id, type=r.type, amount=float(r.amount),
            date=r.date, invoice_number=r.bill_ref or None,
            notes="Opening balance (imported)" if r.opening else None,
            client_id=f"imp_{log.id}_{r.row}", salesman_id=user.id))
    db.flush()
    for c in {id(c): c for c in customers.values()}.values():
        recompute_customer(db, c)
    db.commit()
    db.refresh(log)
    return log


def log_dto(log: ImportLog) -> dict:
    return {"id": log.id, "createdAt": log.created_at, "fileName": log.file_name,
            "rowsImported": log.rows_imported, "rowsSkipped": log.rows_skipped,
            "newRetailers": log.new_retailers, "importedBy": log.imported_by}
