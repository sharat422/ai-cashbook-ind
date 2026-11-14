"""Manual UPI/bank reconciliation: bank statement lines vs recorded collections.

Nothing here moves money or talks to a bank. The owner uploads a statement
export; we SUGGEST which collection each money-in line is, and a person
confirms each pair. Nothing is ever confirmed automatically. A person can also
match by hand (any collection, any date), let one bank line cover several
collections (₹1,000 = ₹600 + ₹400), undo a match, and delete a statement.

Money is compared in exact paise / Decimal, never float. A suggestion needs
the exact same amount and dates within MATCH_DAYS; a matching UTR (or the
collection's reference appearing in the bank narration) ranks it first.
"""

import hashlib
from datetime import date as Date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .bank_statement import parse_statement, preview_statement
from .beats import assert_beat_access
from .calc import NOT_MONEY, paid_at_sale
from .models import (BankImport, BankLine, BankMatch, Business, BusinessMember, CashCount, CashDeposit, Customer,
                     LedgerEntry, User, gen_id, in_books, now_iso)
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

def import_statement(db: Session, business: Business, data: bytes, filename: str,
                     mapping: dict | None = None, date_format: str | None = None) -> dict:
    file_hash = hashlib.sha256(data).hexdigest()
    seen = db.scalars(select(BankImport).where(
        BankImport.business_id == business.id, BankImport.file_hash == file_hash)).first()
    if seen is not None:
        return {"imported": 0, "duplicates": 0, "skipped": 0, "rejected": [], "alreadyImported": True}

    parsed = parse_statement(data, filename, mapping, date_format)  # StatementError → 422 in the router
    lines = parsed.lines
    duplicates = 0
    if lines:
        # The same transaction in two overlapping statements: skip it by UTR.
        lo, hi = min(l.date for l in lines), max(l.date for l in lines)
        known = {
            (b.date, b.amount_paise, _clean(b.utr))
            for b in db.scalars(select(BankLine).where(
                BankLine.business_id == business.id, BankLine.date >= lo, BankLine.date <= hi,
                BankLine.deleted_at.is_(None)))
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

def _active(business: Business):
    return (BankMatch.business_id == business.id, BankMatch.undone_at.is_(None))


def _is_collection(e: LedgerEntry) -> bool:
    """A payment that should show up in the bank: anything but cash (and a
    credit note, which is a correction, not money received)."""
    return e.type == "payment" and (e.payment_method or "").lower() not in ("cash", *NOT_MONEY)


def _collections(db: Session, business: Business, lo: str | None = None, hi: str | None = None
                 ) -> list[tuple[LedgerEntry, Customer]]:
    """Non-cash collections not yet in an active match (optionally by date)."""
    matched = select(BankMatch.entry_id).where(*_active(business), BankMatch.entry_id.is_not(None))
    q = (select(LedgerEntry, Customer)
         .join(Customer, LedgerEntry.customer_id == Customer.id)
         .where(Customer.business_id == business.id, LedgerEntry.type == "payment",
                LedgerEntry.id.not_in(matched))
         .order_by(LedgerEntry.date, LedgerEntry.created_at))
    if lo:
        q = q.where(LedgerEntry.date >= lo)
    if hi:
        q = q.where(LedgerEntry.date <= hi)
    return [(e, c) for e, c in db.execute(q).all() if _is_collection(e)]


def _ref_hit(entry: LedgerEntry, line: BankLine) -> bool:
    ref = _clean(entry.reference_number)
    if len(ref) < 6:
        return False
    return ref == _clean(line.utr) or ref in _clean(line.narration)


def _allocated(db: Session, business: Business, line_ids: list[str]) -> dict[str, int]:
    if not line_ids:
        return {}
    return dict(db.execute(select(BankMatch.bank_line_id, func.sum(BankMatch.amount_paise))
                           .where(*_active(business), BankMatch.bank_line_id.in_(line_ids))
                           .group_by(BankMatch.bank_line_id)).all())


def _open_lines(db: Session, business: Business) -> list[tuple[BankLine, int]]:
    """(line, paise still to account for) for lines not fully matched."""
    lines = list(db.scalars(select(BankLine).where(
        BankLine.business_id == business.id, BankLine.deleted_at.is_(None)
    ).order_by(BankLine.date, BankLine.id)))
    used = _allocated(db, business, [l.id for l in lines])
    return [(l, l.amount_paise - used.get(l.id, 0)) for l in lines if l.amount_paise - used.get(l.id, 0) > 0]


def suggest(db: Session, business: Business) -> tuple[list[dict], list[tuple[BankLine, int]]]:
    """(suggestions, open lines with no suggestion). A suggestion is one
    collection equal to what's left on a line; each line and collection is in
    at most one; the best pairs (UTR hit, then closest date) go first."""
    lines = _open_lines(db, business)
    if not lines:
        return [], []
    lo = _shift(min(l.date for l, _ in lines), -MATCH_DAYS)
    hi = _shift(max(l.date for l, _ in lines), MATCH_DAYS)
    by_paise: dict[int, list[tuple[LedgerEntry, Customer]]] = {}
    for e, c in _collections(db, business, lo, hi):
        by_paise.setdefault(to_paise(e.amount), []).append((e, c))

    pairs = []
    for line, left in lines:
        for e, c in by_paise.get(left, []):
            gap = _days(line.date, e.date)
            if gap <= MATCH_DAYS:
                hit = _ref_hit(e, line)
                pairs.append(((0 if hit else 1, gap, e.date, line.date, e.id, line.id), line, left, e, c, hit, gap))
    pairs.sort(key=lambda p: p[0])

    used_lines, used_entries, out = set(), set(), []
    for _key, line, left, e, c, hit, gap in pairs:
        if line.id in used_lines or e.id in used_entries:
            continue
        used_lines.add(line.id)
        used_entries.add(e.id)
        out.append({"bankLine": line_dto(line, left), "collection": collection_dto(e, c),
                    "match": "utr" if hit else "amount_date", "dayGap": gap})
    out.sort(key=lambda s: (s["bankLine"]["date"], s["bankLine"]["id"]))
    return out, [(l, left) for l, left in lines if l.id not in used_lines]


def exceptions(db: Session, business: Business) -> dict:
    """Bank lines (or what's left of them) with no suggested collection, and
    non-cash collections in the statement period that no bank line accounts for."""
    suggestions, lone_lines = suggest(db, business)
    suggested_entries = {s["collection"]["id"] for s in suggestions}
    period = db.execute(select(BankLine.date).where(
        BankLine.business_id == business.id, BankLine.deleted_at.is_(None)).order_by(BankLine.date)).scalars().all()
    lone_entries = []
    if period:
        lone_entries = [collection_dto(e, c) for e, c in _collections(db, business, period[0], period[-1])
                        if e.id not in suggested_entries]
    missing = db.execute(select(LedgerEntry, Customer).join(Customer, LedgerEntry.customer_id == Customer.id)
                         .where(Customer.business_id == business.id, LedgerEntry.utr_missing.is_(True))
                         .order_by(LedgerEntry.date)).all()
    return {"bankLines": [line_dto(l, left) for l, left in lone_lines], "collections": lone_entries,
            "missingUtr": [collection_dto(e, c) for e, c in missing]}


def candidates(db: Session, business: Business, line_id: str, search: str = "") -> list[dict]:
    """Matching by hand: every unmatched non-cash collection, any date, closest
    to the bank line's date first, optionally filtered by name or amount."""
    line = _line(db, business, line_id)
    needle = search.strip().lower()
    rows = _collections(db, business)
    if needle:
        rows = [(e, c) for e, c in rows
                if needle in c.full_name.lower() or needle in rupees(to_paise(e.amount))]
    rows.sort(key=lambda r: (_days(r[0].date, line.date), r[0].date))
    return [collection_dto(e, c) for e, c in rows[:100]]


def _line(db: Session, business: Business, line_id: str) -> BankLine:
    line = db.get(BankLine, line_id)
    if line is None or line.business_id != business.id or line.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bank line not found")
    return line


def _lock_lines(db: Session, business: Business, line_ids: list[str]) -> list[BankLine]:
    """The lines, row-locked (Postgres) so two people can't over-allocate one."""
    lines = list(db.scalars(select(BankLine).where(
        BankLine.id.in_(line_ids), BankLine.business_id == business.id, BankLine.deleted_at.is_(None)
    ).order_by(BankLine.id).with_for_update()))
    if len(lines) != len(line_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bank line not found")
    return lines


def match(db: Session, business: Business, user: User, line_ids: list[str], entry_ids: list[str],
          exact: bool = False) -> dict:
    """Allocate bank lines to collections, as one match (undone as a whole):

    - one line, any number of collections (₹1,000 = ₹600 + ₹400): the total
      may not exceed what's left on the line (exact=True: must equal it);
    - several lines, any number of collections (₹900 + ₹600 for three ₹500
      bills): the lines' remaining amounts must add up to the collections
      exactly, so every line and every collection is fully allocated.

    A collection is always fully allocated or not at all, and a line is never
    over-allocated. Refused server-side (422), whatever the app checked."""
    line_ids, ids = list(dict.fromkeys(line_ids)), list(dict.fromkeys(entry_ids))
    if not ids or not line_ids:
        raise HTTPException(422, "Pick at least one collection.")
    lines = _lock_lines(db, business, line_ids)
    rows = db.execute(select(LedgerEntry, Customer).join(Customer, LedgerEntry.customer_id == Customer.id)
                      .where(LedgerEntry.id.in_(ids), Customer.business_id == business.id)).all()
    if len(rows) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found")
    if not all(_is_collection(e) for e, _ in rows):
        raise HTTPException(422, "Only UPI, bank and other non-cash payments can be matched.")
    if db.scalars(select(BankMatch.id).where(*_active(business), BankMatch.entry_id.in_(ids))).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "This collection is already matched.")
    used = _allocated(db, business, line_ids)
    left = {l.id: l.amount_paise - used.get(l.id, 0) for l in lines}
    if any(v <= 0 for v in left.values()):
        raise HTTPException(status.HTTP_409_CONFLICT, "This bank line is already matched.")
    total = sum(to_paise(e.amount) for e, _ in rows)
    room = sum(left.values())
    if len(lines) == 1:
        if exact and total != room:
            raise HTTPException(422, "The amounts don't match exactly.")
        if total > room:
            raise HTTPException(422, f"These add up to ₹{rupees(total)} but the bank line has ₹{rupees(room)} left.")
        allocations = [(lines[0], e, to_paise(e.amount), 0) for e, _ in rows]
    else:
        if total != room:
            raise HTTPException(422, f"The bank lines add up to ₹{rupees(room)} but the collections add up to "
                                     f"₹{rupees(total)}. They must match exactly.")
        allocations = _spread(lines, left, [e for e, _ in rows])
    group = gen_id()
    db.add_all(BankMatch(business_id=business.id, bank_line_id=l.id, entry_id=e.id, amount_paise=p,
                         part=part, group_id=group, confirmed_by=user.id) for l, e, p, part in allocations)
    try:
        db.commit()
    except IntegrityError:  # two people matching the same collection at once
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This collection is already matched.")
    spent = {l.id: sum(p for x, _, p, _ in allocations if x.id == l.id) for l in lines}
    out_lines = [line_dto(l, left[l.id] - spent[l.id]) for l in lines]
    return {"bankLine": out_lines[0], "bankLines": out_lines,
            "collections": [collection_dto(e, c) for e, c in rows]}


def _spread(lines: list[BankLine], left: dict[str, int], entries: list[LedgerEntry]
            ) -> list[tuple[BankLine, LedgerEntry, int, int]]:
    """Pour the lines into the collections in order (the totals are equal):
    (line, collection, paise, part) where part numbers each collection's
    pieces, so one collection can take money from several lines."""
    out, li, room = [], 0, left[lines[0].id]
    for e in entries:
        need, part = to_paise(e.amount), 0
        while need:
            if not room:
                li += 1
                room = left[lines[li].id]
            take = min(need, room)
            out.append((lines[li], e, take, part))
            need, room, part = need - take, room - take, part + 1
    return out


def confirm(db: Session, business: Business, user: User, line_ids: list[str], entry_ids: list[str]) -> dict:
    """Confirm a match exactly: a suggestion (one line, one collection), a
    split, or several lines paying several collections. Every line and every
    collection must be fully allocated; anything else is refused."""
    out = match(db, business, user, line_ids, entry_ids, exact=True)
    return {"bankLine": out["bankLine"], "bankLines": out["bankLines"], "collection": out["collections"][0],
            "collections": out["collections"]}


def _undo(db: Session, business: Business, user: User, line_ids: list[str], reason: str) -> int:
    """Undo every match on these lines, and the rest of any split they're part
    of, so no collection is ever left partly allocated."""
    on_lines = select(BankMatch).where(*_active(business), BankMatch.bank_line_id.in_(line_ids))
    groups = {m.group_id for m in db.scalars(on_lines) if m.group_id}
    rows = db.scalars(select(BankMatch).where(*_active(business), BankMatch.bank_line_id.in_(line_ids)
                                              | BankMatch.group_id.in_(groups))).all()
    for m in rows:
        m.undone_at, m.undone_by, m.undo_reason = now_iso(), user.id, reason
    return len(rows)


def undo(db: Session, business: Business, user: User, line_id: str) -> dict:
    """Take back every match on a bank line (and the other lines of a split);
    its collections are unmatched again."""
    line = _line(db, business, line_id)
    if not _undo(db, business, user, [line.id], "undone"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This bank line has no match to undo.")
    db.commit()
    return line_dto(line, line.amount_paise)


def line_candidates(db: Session, business: Business, entry_id: str) -> list[dict]:
    """Matching a collection by hand to several bank lines: every open line
    (what's left on it), closest to the collection's date first."""
    e = db.execute(select(LedgerEntry).join(Customer, LedgerEntry.customer_id == Customer.id)
                   .where(LedgerEntry.id == entry_id, Customer.business_id == business.id)).scalar_one_or_none()
    if e is None or not _is_collection(e):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found")
    lines = sorted(_open_lines(db, business), key=lambda x: (_days(x[0].date, e.date), x[0].date))
    return [line_dto(l, left) for l, left in lines[:100]]


def other_lines(db: Session, business: Business, line_id: str) -> list[dict]:
    """Matching by hand from a bank line: the other open lines that could go
    in the same match (several transfers for several bills), closest date first."""
    line = _line(db, business, line_id)
    lines = sorted(((l, left) for l, left in _open_lines(db, business) if l.id != line.id),
                   key=lambda x: (_days(x[0].date, line.date), x[0].date))
    return [line_dto(l, left) for l, left in lines[:100]]


def matched(db: Session, business: Business) -> list[dict]:
    """Lines with at least one active match, newest first, with what's on them
    (collections, or a cash deposit)."""
    rows = db.execute(
        select(BankMatch, BankLine, LedgerEntry, Customer, CashDeposit)
        .join(BankLine, BankLine.id == BankMatch.bank_line_id)
        .join(LedgerEntry, LedgerEntry.id == BankMatch.entry_id, isouter=True)
        .join(Customer, Customer.id == LedgerEntry.customer_id, isouter=True)
        .join(CashDeposit, CashDeposit.id == BankMatch.deposit_id, isouter=True)
        .where(*_active(business), BankLine.deleted_at.is_(None))
        .order_by(BankLine.date.desc(), BankLine.id)).all()
    out: dict[str, dict] = {}
    for m, line, e, c, d in rows:
        item = out.setdefault(line.id, {"line": line, "used": 0, "collections": [], "deposits": [],
                                        "by": m.confirmed_by, "at": m.confirmed_at})
        item["used"] += m.amount_paise
        if e is not None:
            item["collections"].append(collection_dto(e, c))
        if d is not None:
            item["deposits"].append(deposit_dto(d, line.id))
    return [{"bankLine": line_dto(v["line"], v["line"].amount_paise - v["used"]),
             "collections": v["collections"], "deposits": v["deposits"], "confirmedAt": v["at"]}
            for v in out.values()]


# --- Cash deposits -----------------------------------------------------------
# A record of cash the owner already took to the bank (or kept back as float).
# Nothing here moves money.

def _deposit_scope(db: Session, business: Business, user: User, role: str, beat_id: str | None) -> None:
    """Staff: their own beat only. The whole business: those who see all."""
    if beat_id:
        assert_beat_access(db, business, user, role, beat_id, allow_deleted=True)
    elif not role_can(role, DATA_VIEW):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Pick your beat to see its deposits.")


def _deposit_lines(db: Session, business: Business, ids: list[str]) -> dict[str, str]:
    """deposit id -> the bank line it's matched to (active matches only)."""
    if not ids:
        return {}
    return dict(db.execute(select(BankMatch.deposit_id, BankMatch.bank_line_id)
                           .where(*_active(business), BankMatch.deposit_id.in_(ids))).all())


def _deposits(db: Session, business: Business, day: str, beat_id: str | None) -> list[CashDeposit]:
    q = select(CashDeposit).where(CashDeposit.business_id == business.id, CashDeposit.date == day,
                                  CashDeposit.deleted_at.is_(None))
    if beat_id:
        q = q.where(CashDeposit.beat_id == beat_id)
    return list(db.scalars(q.order_by(CashDeposit.created_at)))


def _visible(deposits: list[CashDeposit], user: User, role: str) -> list[CashDeposit]:
    """Staff see whole-beat deposits and their own, not a colleague's."""
    if role_can(role, DATA_VIEW):
        return deposits
    return [d for d in deposits if d.user_id in (None, user.id)]


def list_deposits(db: Session, business: Business, user: User, role: str, day: str,
                  beat_id: str | None) -> list[dict]:
    _deposit_scope(db, business, user, role, beat_id)
    rows = _visible(_deposits(db, business, day, beat_id), user, role)
    lines = _deposit_lines(db, business, [d.id for d in rows])
    return [deposit_dto(d, lines.get(d.id)) for d in rows]


# Cash recorded with no salesperson (entries from before who-recorded-it was
# kept, or by a since-deleted user) is counted and deposited as this "person".
NO_SALESPERSON = "none"


def _check_person(db: Session, business: Business, role: str, user_id: str) -> None:
    if user_id == NO_SALESPERSON:
        if not role_can(role, DATA_VIEW):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can count cash with no salesperson.")
    elif not db.scalars(select(BusinessMember.id).where(
            BusinessMember.business_id == business.id, BusinessMember.user_id == user_id)).first():
        raise HTTPException(422, "That person isn't on your team.")


def record_deposit(db: Session, business: Business, user: User, role: str, *, day: str,
                   beat_id: str | None, amount: Decimal, kind: str, note: str | None,
                   user_id: str | None = None) -> dict:
    """Cash taken to the bank (or kept back), for one salesperson (user_id)
    or the whole beat."""
    if kind not in ("deposit", "float"):
        raise HTTPException(422, "Kind must be deposit or float.")
    _deposit_scope(db, business, user, role, beat_id)
    if amount <= 0 or amount > Decimal("100000000"):
        raise HTTPException(422, "Enter the cash amount.")
    if user_id:
        _check_person(db, business, role, user_id)
    if kind != "deposit":
        count = None
    elif user_id:
        count = _person_counts(db, business, day, beat_id).get(user_id)
    else:
        count = _latest_count(db, business, day, beat_id)
    d = CashDeposit(business_id=business.id, beat_id=beat_id, user_id=user_id or None, date=day, kind=kind,
                    amount_paise=to_paise(amount), counted_cash_id=count.id if count else None,
                    note=note, created_by=user.id)
    db.add(d)
    db.commit()
    return deposit_dto(d, None)


def _deposit(db: Session, business: Business, deposit_id: str) -> CashDeposit:
    d = db.get(CashDeposit, deposit_id)
    if d is None or d.business_id != business.id or d.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deposit not found")
    return d


def delete_deposit(db: Session, business: Business, deposit_id: str) -> dict:
    """Remove a deposit recorded by mistake (kept as the record). A matched
    deposit must be undone first."""
    d = _deposit(db, business, deposit_id)
    if _deposit_lines(db, business, [d.id]):
        raise HTTPException(status.HTTP_409_CONFLICT, "Undo its bank match first.")
    d.deleted_at = now_iso()
    db.commit()
    return {"deleted": True}


def match_deposit(db: Session, business: Business, user: User, deposit_id: str, line_id: str) -> dict:
    """A deposit and its bank line: the line's remaining amount must equal the
    deposit exactly (a short deposit is a deposit plus a float row)."""
    d = _deposit(db, business, deposit_id)
    if d.kind != "deposit":
        raise HTTPException(422, "Cash kept back isn't in the bank, so it can't be matched.")
    [line] = _lock_lines(db, business, [line_id])
    if _deposit_lines(db, business, [d.id]):
        raise HTTPException(status.HTTP_409_CONFLICT, "This deposit is already matched.")
    left = line.amount_paise - _allocated(db, business, [line.id]).get(line.id, 0)
    if left <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "This bank line is already matched.")
    if left != d.amount_paise:
        raise HTTPException(422, f"The deposit is ₹{rupees(d.amount_paise)} but the bank line has "
                                 f"₹{rupees(left)}. They must match exactly.")
    db.add(BankMatch(business_id=business.id, bank_line_id=line.id, deposit_id=d.id,
                     amount_paise=d.amount_paise, group_id=gen_id(), confirmed_by=user.id))
    try:
        db.commit()
    except IntegrityError:  # two people matching the same deposit at once
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This deposit is already matched.")
    return {"deposit": deposit_dto(d, line.id), "bankLine": line_dto(line, 0)}


def deposit_line_candidates(db: Session, business: Business, deposit_id: str) -> list[dict]:
    """Open bank lines for a deposit: same amount first, then closest date."""
    d = _deposit(db, business, deposit_id)
    lines = sorted(_open_lines(db, business),
                   key=lambda x: (x[1] != d.amount_paise, _days(x[0].date, d.date), x[0].date))
    return [line_dto(l, left) for l, left in lines[:100]]


def deposit_dto(d: CashDeposit, line_id: str | None) -> dict:
    return {"id": d.id, "beatId": d.beat_id, "userId": d.user_id, "date": d.date, "kind": d.kind,
            "amount": rupees(d.amount_paise),
            "countedCashId": d.counted_cash_id, "note": d.note, "bankLineId": line_id,
            "matched": line_id is not None, "createdAt": d.created_at}


def imports(db: Session, business: Business, deleted: bool = False) -> list[dict]:
    """Imported statements (or, deleted=True, deleted ones to restore)."""
    gone = BankImport.deleted_at.is_not(None) if deleted else BankImport.deleted_at.is_(None)
    rows = db.execute(
        select(BankImport, func.count(BankLine.id), func.min(BankLine.date), func.max(BankLine.date))
        .join(BankLine, BankLine.import_id == BankImport.id, isouter=True)
        .where(BankImport.business_id == business.id, gone)
        .group_by(BankImport.id).order_by(BankImport.created_at.desc())).all()
    return [_import_dto(i, n, lo, hi) for i, n, lo, hi in rows]


def _import_dto(i: BankImport, n: int, lo: str | None, hi: str | None) -> dict:
    return {"id": i.id, "filename": i.filename, "createdAt": i.created_at, "lines": n,
            "from": lo, "to": hi, "deletedAt": i.deleted_at}


def restore_import(db: Session, business: Business, user: User, import_id: str) -> dict:
    """Bring a deleted statement back with its lines UNMATCHED: the matches
    undone at delete time stay undone; the owner re-confirms by hand. Refused
    if the same file or its lines were imported again since (they'd double).
    Already live: a no-op. Returns (statement, restored?)."""
    batch = db.get(BankImport, import_id)
    if batch is None or batch.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Statement not found")
    lines = list(db.scalars(select(BankLine).where(BankLine.import_id == batch.id)))
    summary = lambda: _import_dto(batch, len(lines), min((l.date for l in lines), default=None),  # noqa: E731
                                  max((l.date for l in lines), default=None))
    if batch.deleted_at is None:
        return {**summary(), "restored": False}
    if batch.deleted_file_hash and db.scalars(select(BankImport.id).where(
            BankImport.business_id == business.id, BankImport.file_hash == batch.deleted_file_hash)).first():
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This statement was imported again after it was deleted. Delete that copy first.")
    live = {(b.date, b.amount_paise, _clean(b.utr)) for b in db.scalars(select(BankLine).where(
        BankLine.business_id == business.id, BankLine.deleted_at.is_(None), BankLine.utr.is_not(None)))}
    clash = sum(1 for l in lines if l.utr and (l.date, l.amount_paise, _clean(l.utr)) in live)
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"{clash} of its bank lines are already in from another statement, so restoring "
                            f"would count them twice. Delete that statement first.")
    for l in lines:
        l.deleted_at = None
    if batch.deleted_file_hash:
        batch.file_hash = batch.deleted_file_hash
    batch.deleted_at = batch.deleted_by = batch.deleted_file_hash = None
    return {**summary(), "restored": True}


def delete_import(db: Session, business: Business, user: User, import_id: str) -> dict:
    """Soft-delete a statement: undo its matches first, hide its lines, and
    free its file hash so a corrected copy can be imported."""
    batch = db.get(BankImport, import_id)
    if batch is None or batch.business_id != business.id or batch.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Statement not found")
    line_ids = list(db.scalars(select(BankLine.id).where(BankLine.import_id == batch.id)))
    undone = _undo(db, business, user, line_ids, "statement deleted")
    stamp = now_iso()
    db.query(BankLine).filter(BankLine.import_id == batch.id).update(
        {BankLine.deleted_at: stamp}, synchronize_session=False)
    batch.deleted_at, batch.deleted_by = stamp, user.id
    batch.deleted_file_hash = batch.file_hash
    batch.file_hash = f"deleted:{batch.id}"
    db.commit()
    return {"deleted": True, "lines": len(line_ids), "matchesUndone": undone}


# --- Daily close -------------------------------------------------------------

def daily_close(db: Session, business: Business, user: User, role: str,
                beat_id: str | None, day: str) -> dict:
    """What a beat (or, for the owner, the whole business) recorded on a day.

    difference = collections − non-cash collections confirmed against the
    bank − cash deposits matched to the bank − cash kept back (float). So it
    is exactly 0.00 once every rupee is in the bank or recorded as kept back.
    """
    query = (select(LedgerEntry, Customer).join(Customer, LedgerEntry.customer_id == Customer.id)
             .where(Customer.business_id == business.id, LedgerEntry.date == day, in_books())
             .order_by(LedgerEntry.created_at))
    if beat_id:
        assert_beat_access(db, business, user, role, beat_id, allow_deleted=True)
        query = query.where(LedgerEntry.beat_id == beat_id)
    elif not role_can(role, DATA_VIEW):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Pick your beat to see its daily close.")
    rows = db.execute(query).all()
    # A cash GST sale (invoice + its payment at once) is a sale paid on the
    # spot, not credit given or a collection.
    settled = paid_at_sale([e for e, _ in rows])
    # A credit note lowers what's owed; it isn't money collected.
    rows = [(e, c) for e, c in rows if e.id not in settled and e.payment_method not in NOT_MONEY]
    ids = [e.id for e, _ in rows]
    verified = set(db.scalars(select(BankMatch.entry_id).where(
        *_active(business), BankMatch.entry_id.in_(ids)))) if ids else set()

    totals = dict.fromkeys(("collected", "cash", "upi", "bank", "other", "verified", "creditGiven"), 0)
    per: dict[str | None, dict] = {}
    collections = []
    for e, c in rows:
        p = to_paise(e.amount)
        m = per.setdefault(e.salesman_id or NO_SALESPERSON, dict.fromkeys(("collected", "cash", "creditGiven"), 0))
        if e.type == "credit":
            totals["creditGiven"] += p
            m["creditGiven"] += p
            continue
        m["collected"] += p
        if (e.payment_method or "").lower() == "cash":
            m["cash"] += p
        method = (e.payment_method or "").lower()
        totals["collected"] += p
        totals[method if method in ("cash", "upi", "bank") else "other"] += p
        if method != "cash" and e.id in verified:
            totals["verified"] += p
        collections.append({**collection_dto(e, c), "verified": e.id in verified})
    deposits = _deposits(db, business, day, beat_id)
    banked = _deposit_lines(db, business, [d.id for d in deposits])
    deposited = sum(d.amount_paise for d in deposits if d.kind == "deposit" and d.id in banked)
    pending = sum(d.amount_paise for d in deposits if d.kind == "deposit" and d.id not in banked)
    kept = sum(d.amount_paise for d in deposits if d.kind == "float")
    difference = totals["collected"] - totals["verified"] - deposited - kept
    count = _latest_count(db, business, day, beat_id)
    people = _person_counts(db, business, day, beat_id)
    # Per-person counts are in use if they're newer than the latest whole-beat count.
    by_person = bool(people) and (count is None or max(c.created_at for c in people.values()) >= count.created_at)
    for uid in [*(people if by_person else []), *(d.user_id for d in deposits if d.user_id)]:
        # counted or deposited for, though they collected nothing today
        per.setdefault(uid, dict.fromkeys(("collected", "cash", "creditGiven"), 0))
    sees_all = role_can(role, DATA_VIEW)
    names = dict(db.execute(select(BusinessMember.user_id, BusinessMember.display_name).where(
        BusinessMember.business_id == business.id)).all())
    mobiles = dict(db.execute(select(User.id, User.mobile).where(User.id.in_([k for k in per if k]))).all()) if per else {}

    def own_count(uid: str | None) -> dict:
        """A person's counted cash, over/short and cash deposited (matched to
        the bank); staff see only their own."""
        if not uid or not (sees_all or uid == user.id):
            return {"cashCounted": None, "cashOverShort": None, "cashDeposited": None}
        c = people.get(uid) if by_person else None
        mine = rupees(sum(d.amount_paise for d in deposits
                          if d.user_id == uid and d.kind == "deposit" and d.id in banked))
        if c is None:
            return {"cashCounted": None, "cashOverShort": None, "cashDeposited": mine}
        return {"cashCounted": rupees(c.counted_paise), "cashOverShort": rupees(c.counted_paise - per[uid]["cash"]),
                "cashDeposited": mine}

    members = [{"userId": uid, "name": names.get(uid), "mobile": mobiles.get(uid),
                **{k: rupees(v) for k, v in m.items()}, **own_count(uid)}
               for uid, m in sorted(per.items(), key=lambda kv: kv[1]["collected"], reverse=True)]
    if by_person:
        counted = sum(c.counted_paise for c in people.values())
        # The beat's over/short needs everyone holding cash counted (cash
        # with no salesperson is counted by the owner, as its own row).
        complete = all(uid in people for uid, m in per.items() if m["cash"])
        beat_count = {
            "cashCounted": rupees(counted) if sees_all else None,
            "cashOverShort": rupees(counted - totals["cash"]) if sees_all and complete else None,
            "cashCountedAt": max(c.created_at for c in people.values()),
        }
    else:
        beat_count = {
            "cashCounted": None if count is None else rupees(count.counted_paise),
            "cashOverShort": None if count is None else rupees(count.counted_paise - totals["cash"]),
            "cashCountedAt": None if count is None else count.created_at,
        }
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
        # Cash taken to the bank: matched to a bank line, or not in a statement yet.
        "cashDeposited": rupees(deposited),
        "cashDepositPending": rupees(pending),
        "cashKeptBack": rupees(kept),
        "deposits": [deposit_dto(d, banked.get(d.id)) for d in _visible(deposits, user, role)],
        # Cash in hand as counted, and over/short against the cash recorded.
        # Kept apart from `difference`: a count never edits a sale. Counted
        # per salesperson (the beat figure is their sum) or for the whole beat.
        **beat_count,
        "cashCountByPerson": by_person,
        # One close per beat: every member's collections, with each one's
        # subtotal and (per-person counts) their counted cash and over/short.
        "members": members,
    }


def _counts(business: Business, day: str, beat_id: str | None):
    q = select(CashCount).where(CashCount.business_id == business.id, CashCount.date == day)
    return q.where(CashCount.beat_id == beat_id) if beat_id else q.where(CashCount.beat_id.is_(None))


def _latest_count(db: Session, business: Business, day: str, beat_id: str | None) -> CashCount | None:
    """The latest whole-beat (or whole-business) count."""
    q = _counts(business, day, beat_id).where(CashCount.user_id.is_(None))
    return db.scalars(q.order_by(CashCount.created_at.desc(), CashCount.id.desc())).first()


def _person_counts(db: Session, business: Business, day: str, beat_id: str | None) -> dict[str, CashCount]:
    """Each salesperson's latest count (every count is kept)."""
    out: dict[str, CashCount] = {}
    q = _counts(business, day, beat_id).where(CashCount.user_id.is_not(None))
    for c in db.scalars(q.order_by(CashCount.created_at, CashCount.id)):
        out[c.user_id] = c
    return out


def record_count(db: Session, business: Business, user: User, role: str, *, day: str,
                 beat_id: str | None, counted: Decimal, note: str | None, user_id: str | None = None) -> dict:
    """Save a cash count, for one salesperson (user_id) or the whole beat.
    Staff count their own beat, and per person only their own cash; the
    whole-business count needs the owner (anyone who sees all beats)."""
    if beat_id:
        assert_beat_access(db, business, user, role, beat_id, allow_deleted=True)
    elif not role_can(role, DATA_VIEW):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Pick your beat to count its cash.")
    if user_id:
        if not role_can(role, DATA_VIEW) and user_id != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can count only your own cash.")
        _check_person(db, business, role, user_id)
    if counted < 0 or counted > Decimal("100000000"):
        raise HTTPException(422, "Enter the cash counted.")
    db.add(CashCount(business_id=business.id, date=day, beat_id=beat_id, user_id=user_id or None,
                     counted_paise=to_paise(counted), counted_by=user.id, note=note))
    db.commit()
    return daily_close(db, business, user, role, beat_id, day)


# --- DTOs ----------------------------------------------------------------------

def line_dto(l: BankLine, left: int | None = None) -> dict:
    left = l.amount_paise if left is None else left
    return {"id": l.id, "date": l.date, "amount": rupees(l.amount_paise), "utr": l.utr,
            "narration": l.narration, "remaining": rupees(left), "matched": left == 0}


def collection_dto(e: LedgerEntry, c: Customer) -> dict:
    return {"id": e.id, "customerId": c.id, "customerName": c.full_name, "date": e.date,
            "amount": rupees(to_paise(e.amount)), "mode": e.payment_method,
            "reference": e.reference_number, "beatId": e.beat_id, "salesmanId": e.salesman_id}
