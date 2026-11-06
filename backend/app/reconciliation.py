"""Manual UPI/bank reconciliation: bank statement lines vs recorded collections.

Nothing here moves money or talks to a bank. The owner uploads a statement
export; we SUGGEST which collection each money-in line is, and a person
confirms each pair. Nothing is ever confirmed automatically.

Money is compared in exact paise / Decimal, never float. A suggestion needs
the exact same amount and dates within MATCH_DAYS; a matching UTR (or the
collection's reference appearing in the bank narration) ranks it first.
"""

import hashlib
from datetime import date as Date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .bank_statement import parse_statement
from .beats import assert_beat_access
from .models import BankImport, BankLine, Business, Customer, LedgerEntry, User, now_iso
from .rbac import DATA_VIEW, role_can

MATCH_DAYS = 3  # UPI/NEFT can land a day or two after it was recorded
CENT = Decimal("0.01")


def to_paise(amount: float | Decimal) -> int:
    return int((Decimal(str(amount)) * 100).quantize(Decimal(1), ROUND_HALF_UP))


def rupees(paise: int) -> str:
    """Exact money string for the API, e.g. 1234.50."""
    return str((Decimal(paise) / 100).quantize(CENT))


def _clean(ref: str | None) -> str:
    return "".join(ch for ch in (ref or "").upper() if ch.isalnum())


def _days(a: str, b: str) -> int:
    return abs((Date.fromisoformat(a) - Date.fromisoformat(b)).days)


def _shift(day: str, days: int) -> str:
    return (Date.fromisoformat(day) + timedelta(days=days)).isoformat()


# --- Import ------------------------------------------------------------------

def import_statement(db: Session, business: Business, data: bytes, filename: str) -> dict:
    file_hash = hashlib.sha256(data).hexdigest()
    seen = db.scalars(select(BankImport).where(
        BankImport.business_id == business.id, BankImport.file_hash == file_hash)).first()
    if seen is not None:
        return {"imported": 0, "duplicates": 0, "skipped": 0, "rejected": [], "alreadyImported": True}

    parsed = parse_statement(data, filename)  # StatementError → 422 in the router
    lines = parsed.lines
    duplicates = 0
    if lines:
        # The same transaction in two overlapping statements: skip it by UTR.
        lo, hi = min(l.date for l in lines), max(l.date for l in lines)
        known = {
            (b.date, b.amount_paise, _clean(b.utr))
            for b in db.scalars(select(BankLine).where(
                BankLine.business_id == business.id, BankLine.date >= lo, BankLine.date <= hi))
            if b.utr
        }
        fresh = []
        for l in lines:
            key = (l.date, to_paise(l.amount), _clean(l.utr))
            if l.utr and key in known:
                duplicates += 1
                continue
            if l.utr:
                known.add(key)
            fresh.append(l)
        lines = fresh

    result = {"imported": len(lines), "duplicates": duplicates, "skipped": parsed.skipped,
              "rejected": parsed.rejected, "alreadyImported": False}
    if not lines:
        return result  # don't remember the file, so a fixed copy can be retried
    batch = BankImport(business_id=business.id, file_hash=file_hash, filename=(filename or "")[:200])
    db.add(batch)
    try:
        db.flush()
    except IntegrityError:  # the same file uploaded twice at once
        db.rollback()
        return {**result, "imported": 0, "alreadyImported": True}
    db.add_all(BankLine(business_id=business.id, import_id=batch.id, date=l.date,
                        amount_paise=to_paise(l.amount), utr=l.utr, narration=l.narration)
               for l in lines)
    db.commit()
    return result


# --- Matching ----------------------------------------------------------------

def _is_collection(e: LedgerEntry) -> bool:
    """A payment that should show up in the bank: anything but cash."""
    return e.type == "payment" and (e.payment_method or "").lower() != "cash"


def _collections(db: Session, business: Business, lo: str, hi: str) -> list[tuple[LedgerEntry, Customer]]:
    matched = select(BankLine.matched_entry_id).where(BankLine.matched_entry_id.is_not(None))
    rows = db.execute(
        select(LedgerEntry, Customer)
        .join(Customer, LedgerEntry.customer_id == Customer.id)
        .where(Customer.business_id == business.id, LedgerEntry.type == "payment",
               LedgerEntry.date >= lo, LedgerEntry.date <= hi,
               LedgerEntry.id.not_in(matched))
        .order_by(LedgerEntry.date, LedgerEntry.created_at)
    ).all()
    return [(e, c) for e, c in rows if _is_collection(e)]


def _ref_hit(entry: LedgerEntry, line: BankLine) -> bool:
    ref = _clean(entry.reference_number)
    if len(ref) < 6:
        return False
    return ref == _clean(line.utr) or ref in _clean(line.narration)


def _unmatched_lines(db: Session, business: Business) -> list[BankLine]:
    return list(db.scalars(select(BankLine).where(
        BankLine.business_id == business.id, BankLine.matched_entry_id.is_(None)
    ).order_by(BankLine.date, BankLine.id)))


def suggest(db: Session, business: Business) -> tuple[list[dict], list[BankLine]]:
    """(suggestions, lines with no suggestion). Each
    line and each collection appears in at most one suggestion; the best
    pairs (UTR hit, then closest date) are taken first."""
    lines = _unmatched_lines(db, business)
    if not lines:
        return [], []
    lo = _shift(min(l.date for l in lines), -MATCH_DAYS)
    hi = _shift(max(l.date for l in lines), MATCH_DAYS)
    entries = _collections(db, business, lo, hi)
    by_paise: dict[int, list[tuple[LedgerEntry, Customer]]] = {}
    for e, c in entries:
        by_paise.setdefault(to_paise(e.amount), []).append((e, c))

    pairs = []
    for line in lines:
        for e, c in by_paise.get(line.amount_paise, []):
            gap = _days(line.date, e.date)
            if gap <= MATCH_DAYS:
                hit = _ref_hit(e, line)
                pairs.append(((0 if hit else 1, gap, e.date, line.date, e.id, line.id), line, e, c, hit, gap))
    pairs.sort(key=lambda p: p[0])

    used_lines, used_entries, out = set(), set(), []
    for _key, line, e, c, hit, gap in pairs:
        if line.id in used_lines or e.id in used_entries:
            continue
        used_lines.add(line.id)
        used_entries.add(e.id)
        out.append({"bankLine": line_dto(line), "collection": collection_dto(e, c),
                    "match": "utr" if hit else "amount_date", "dayGap": gap})
    out.sort(key=lambda s: (s["bankLine"]["date"], s["bankLine"]["id"]))
    return out, [l for l in lines if l.id not in used_lines]


def exceptions(db: Session, business: Business) -> dict:
    """Bank lines with no suggested collection, and non-cash collections in
    the statement period that no bank line accounts for."""
    suggestions, lone_lines = suggest(db, business)
    suggested_entries = {s["collection"]["id"] for s in suggestions}
    period = db.execute(select(BankLine.date).where(BankLine.business_id == business.id)
                        .order_by(BankLine.date)).scalars().all()
    lone_entries = []
    if period:
        lone_entries = [collection_dto(e, c) for e, c in _collections(db, business, period[0], period[-1])
                        if e.id not in suggested_entries]
    return {"bankLines": [line_dto(l) for l in lone_lines], "collections": lone_entries}


def confirm(db: Session, business: Business, user: User, line_id: str, entry_id: str) -> dict:
    line = db.get(BankLine, line_id)
    if line is None or line.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bank line not found")
    row = db.execute(select(LedgerEntry, Customer).join(Customer, LedgerEntry.customer_id == Customer.id)
                     .where(LedgerEntry.id == entry_id, Customer.business_id == business.id)).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found")
    entry, customer = row
    if not _is_collection(entry):
        raise HTTPException(422, "Only UPI, bank and other non-cash payments can be matched.")
    if to_paise(entry.amount) != line.amount_paise:
        raise HTTPException(422, "The amounts don't match exactly.")
    if line.matched_entry_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This bank line is already matched.")
    if db.scalars(select(BankLine).where(BankLine.matched_entry_id == entry.id)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This collection is already matched.")
    line.matched_entry_id, line.confirmed_by, line.confirmed_at = entry.id, user.id, now_iso()
    try:
        db.commit()
    except IntegrityError:  # two people confirming the same collection at once
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This collection is already matched.")
    return {"bankLine": line_dto(line), "collection": collection_dto(entry, customer)}


# --- Daily close -------------------------------------------------------------

def daily_close(db: Session, business: Business, user: User, role: str,
                beat_id: str | None, day: str) -> dict:
    """What a beat (or, for the owner, the whole business) recorded on a day.

    difference = collections − cash − non-cash collections confirmed against
    the bank. So it is exactly 0.00 once every UPI/bank collection is matched.
    """
    query = (select(LedgerEntry, Customer).join(Customer, LedgerEntry.customer_id == Customer.id)
             .where(Customer.business_id == business.id, LedgerEntry.date == day)
             .order_by(LedgerEntry.created_at))
    if beat_id:
        assert_beat_access(db, business, user, role, beat_id)
        query = query.where(LedgerEntry.beat_id == beat_id)
    elif not role_can(role, DATA_VIEW):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Pick your beat to see its daily close.")
    rows = db.execute(query).all()
    ids = [e.id for e, _ in rows]
    verified = set(db.scalars(select(BankLine.matched_entry_id).where(
        BankLine.matched_entry_id.in_(ids)))) if ids else set()

    totals = dict.fromkeys(("collected", "cash", "upi", "bank", "other", "verified", "creditGiven"), 0)
    collections = []
    for e, c in rows:
        p = to_paise(e.amount)
        if e.type == "credit":
            totals["creditGiven"] += p
            continue
        method = (e.payment_method or "").lower()
        totals["collected"] += p
        totals[method if method in ("cash", "upi", "bank") else "other"] += p
        if method != "cash" and e.id in verified:
            totals["verified"] += p
        collections.append({**collection_dto(e, c), "verified": e.id in verified})
    difference = totals["collected"] - totals["cash"] - totals["verified"]
    return {
        "date": day,
        "beatId": beat_id,
        "collections": collections,
        "creditCollected": rupees(totals["collected"]),
        "cashInHand": rupees(totals["cash"]),
        "upiClaimed": rupees(totals["upi"]),
        "bankClaimed": rupees(totals["bank"]),
        "otherClaimed": rupees(totals["other"]),
        "verified": rupees(totals["verified"]),
        "creditGiven": rupees(totals["creditGiven"]),
        "difference": rupees(difference),
    }


# --- DTOs ----------------------------------------------------------------------

def line_dto(l: BankLine) -> dict:
    return {"id": l.id, "date": l.date, "amount": rupees(l.amount_paise), "utr": l.utr,
            "narration": l.narration, "matchedEntryId": l.matched_entry_id}


def collection_dto(e: LedgerEntry, c: Customer) -> dict:
    return {"id": e.id, "customerId": c.id, "customerName": c.full_name, "date": e.date,
            "amount": rupees(to_paise(e.amount)), "mode": e.payment_method,
            "reference": e.reference_number, "beatId": e.beat_id, "salesmanId": e.salesman_id}
