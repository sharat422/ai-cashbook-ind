"""Stock basics for a distributor: godown and per-salesperson van stock.

Every change is a StockMove (the audit log) plus one atomic change to the
place's StockLevel. Taking stock out is a single conditional UPDATE
(`qty >= n`), so two sales at the same moment can never both take the last
box; a CHECK (qty >= 0) in the database is the backstop. Phase 1 only: no
warehouses/bins, batches, expiry or manufacturing.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .discards import refuse_if_discarded
from . import gst
from .errors import AppError
from .models import (Business, BusinessMember, Expense, Item, ItemUnit, StockLevel, StockMonthLock, StockMove,
                     Supplier, User, gen_id, supplier_key)
from .rbac import ENTRY_EDIT, role_can

QTY = Decimal("0.001")
ZERO = Decimal("0.000")
TOLERANCE = Decimal("0.02")  # a count within ±2% of system stock "matches"

Place = tuple[str, str | None]  # ("godown", None) | ("van", user_id)
GODOWN: Place = ("godown", None)


def _reject(msg: str, code: int = 422) -> HTTPException:
    return HTTPException(code, msg)


def quantity(value, *, allow_zero: bool = False) -> Decimal:
    """Positive (or ≥0) quantity with at most 3 decimals — never rounded."""
    try:
        q = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise _reject("Enter a quantity.") from None
    if not q.is_finite() or q != q.quantize(QTY) or q < 0 or (q == 0 and not allow_zero):
        raise _reject("Quantity must be more than 0, with up to 3 decimals.")
    if q > Decimal("999999999"):
        raise _reject("Quantity looks too large.")
    return q.quantize(QTY)


def owned_item(db: Session, business: Business, item_id: str) -> Item:
    item = db.get(Item, item_id)
    if item is None or item.business_id != business.id:
        raise _reject("Item not found", status.HTTP_404_NOT_FOUND)
    if item.type != "product":
        raise _reject("Services don't have stock.")
    return item


def place(db: Session, business: Business, user: User, role: str,
          location: str, van_user_id: str | None) -> Place:
    """Validate a stock place. Staff may only use their own van."""
    if location == "godown":
        if not role_can(role, ENTRY_EDIT):
            raise _reject("Only the owner can change godown stock.", 403)
        return GODOWN
    if location != "van":
        raise _reject("Location must be 'godown' or 'van'.")
    van_user_id = van_user_id or user.id
    if not role_can(role, ENTRY_EDIT) and van_user_id != user.id:
        raise _reject("You can only use your own van.", 403)
    member = db.scalars(select(BusinessMember).where(
        BusinessMember.business_id == business.id, BusinessMember.user_id == van_user_id,
        BusinessMember.status == "active")).first()
    if member is None:
        raise _reject("That salesperson isn't in this business.")
    return ("van", van_user_id)


# ---------------------------------------------------------------- month locks

def assert_open(db: Session, business: Business, day: str) -> None:
    """Refuse any stock entry dated in a locked (counted and confirmed) month."""
    if db.scalars(select(StockMonthLock.id).where(StockMonthLock.business_id == business.id,
                                                  StockMonthLock.month == day[:7],
                                                  StockMonthLock.locked.is_(True))).first():
        raise _reject("Month locked — add it to the open month.")


# ---------------------------------------------------------------- units

def _same_unit(a: str | None, b: str | None) -> bool:
    return (a or "").strip().casefold() == (b or "").strip().casefold()


def units_of(db: Session, item: Item) -> list[ItemUnit]:
    """The item's other units, biggest first."""
    return list(db.scalars(select(ItemUnit).where(ItemUnit.item_id == item.id).order_by(ItemUnit.factor.desc())))


def to_base(db: Session, item: Item, qty: Decimal, unit: str | None) -> tuple[Decimal, str | None]:
    """A quantity in any of the item's units → base units (stock is always
    held in base). Returns (base quantity, the unit if it wasn't the base)."""
    if not unit or _same_unit(unit, item.unit):
        return qty, None
    u = next((x for x in units_of(db, item) if _same_unit(x.unit, unit)), None)
    if u is None:
        raise _reject(f"{item.name} isn't counted in '{unit}'.")
    base = qty * Decimal(u.factor)
    if base != base.quantize(QTY):
        raise _reject("That quantity doesn't come to a whole number of base units.")
    return base.quantize(QTY), u.unit


def breakdown(qty: Decimal, base_unit: str | None, units: list[ItemUnit]) -> str:
    """240 pieces with box = 24 → "10 box"; 210 → "8 box 18 pcs" (biggest
    unit first, the rest in base). Negative or no other units: base only."""
    base = f"{qty.normalize():f} {base_unit or ''}".strip()
    if qty <= 0 or not units:
        return base
    parts, left = [], qty
    for u in units:
        n = (left // Decimal(u.factor))
        if n > 0:
            parts.append(f"{n:f} {u.unit}")
            left -= n * Decimal(u.factor)
    if left > 0 or not parts:
        parts.append(f"{left.normalize():f} {base_unit or ''}".strip())
    return " ".join(parts)


def has_movement(db: Session, item: Item) -> bool:
    """Anything but the opening stock: a purchase, sale, transfer or count."""
    return db.scalars(select(StockMove.id).where(StockMove.item_id == item.id,
                                                 StockMove.kind != "opening")).first() is not None


def set_units(db: Session, item: Item, units: list[tuple[str, Decimal]]) -> list[ItemUnit]:
    """Replace the item's other units — only before it has any movement."""
    if has_movement(db, item):
        raise _reject("This item already has stock movements, so its units are locked. "
                      "Add a new item if the pack size changed.")
    seen = set()
    for name, factor in units:
        if not name.strip() or _same_unit(name, item.unit) or name.strip().casefold() in seen:
            raise _reject("Each unit needs its own name, different from the base unit.")
        if not (Decimal(factor) > 0) or Decimal(factor) != Decimal(factor).quantize(QTY):
            raise _reject("A unit's size must be more than 0, with up to 3 decimals.")
        seen.add(name.strip().casefold())
    db.query(ItemUnit).filter(ItemUnit.item_id == item.id).delete()
    db.add_all(ItemUnit(item_id=item.id, unit=n.strip()[:20], factor=Decimal(f)) for n, f in units)
    db.flush()
    return units_of(db, item)


def levels(db: Session, business: Business, item_ids: list[str] | None = None
           ) -> dict[str, dict[Place, Decimal]]:
    """{item_id: {place: qty}} — current stock per place."""
    q = select(StockLevel).where(StockLevel.business_id == business.id)
    if item_ids is not None:
        q = q.where(StockLevel.item_id.in_(item_ids))
    out: dict[str, dict[Place, Decimal]] = defaultdict(dict)
    for lv in db.scalars(q).all():
        out[lv.item_id][(lv.location, lv.van_key or None)] = Decimal(str(lv.qty)).quantize(QTY)
    return out


def at(db: Session, business: Business, item: Item, where: Place) -> Decimal:
    return levels(db, business, [item.id]).get(item.id, {}).get(where, ZERO)


def _place_filter(business: Business, item: Item, where: Place):
    return (StockLevel.business_id == business.id, StockLevel.item_id == item.id,
            StockLevel.location == where[0], StockLevel.van_key == (where[1] or ""))


def take(db: Session, business: Business, item: Item, where: Place, q: Decimal) -> None:
    """Take q out of a place in ONE statement that only succeeds if the stock
    is there. Never read-then-write: that's how two sales oversold."""
    done = db.execute(update(StockLevel).where(*_place_filter(business, item, where), StockLevel.qty >= q)
                      .values(qty=StockLevel.qty - q))
    if done.rowcount != 1:
        raise _short(at(db, business, item, where), item, where)


def put(db: Session, business: Business, item: Item, where: Place, q: Decimal) -> None:
    """Add q to a place (creating its level row on first use), atomically."""
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = insert(StockLevel).values(id=gen_id(), business_id=business.id, item_id=item.id,
                                     location=where[0], van_key=where[1] or "", qty=q)
    db.execute(stmt.on_conflict_do_update(
        index_elements=["business_id", "item_id", "location", "van_key"],
        set_={"qty": StockLevel.qty + stmt.excluded.qty}))


def set_count(db: Session, business: Business, item: Item, where: Place, counted: Decimal) -> Decimal:
    """Set a place to the physically counted figure; returns what it was. The
    row lock keeps a sale from slipping in between read and write."""
    put(db, business, item, where, ZERO)  # make sure the row exists
    lv = db.scalars(select(StockLevel).where(*_place_filter(business, item, where))
                    .with_for_update()).one()
    db.refresh(lv)
    before = Decimal(str(lv.qty)).quantize(QTY)
    lv.qty = counted
    return before


def _sync_total(db: Session, business: Business, item: Item) -> None:
    db.flush()
    item.stock_qty = float(sum(levels(db, business, [item.id]).get(item.id, {}).values(), ZERO))
    item.track_stock = True


def _move(business: Business, item: Item, where: Place, kind: str, qty: Decimal, day: str,
          user: User, **extra) -> StockMove:
    return StockMove(business_id=business.id, item_id=item.id, location=where[0],
                     van_user_id=where[1], kind=kind, quantity=qty, date=day,
                     created_by=user.id, **extra)


def _existing(db: Session, business: Business, client_id: str | None) -> StockMove | None:
    if not client_id:
        return None
    return db.scalars(select(StockMove).where(
        StockMove.business_id == business.id, StockMove.client_id == client_id)).first()


def _save(db: Session, business: Business, items: list[Item], moves: list[StockMove],
          client_id: str | None) -> list[StockMove]:
    """Add the moves (client_id on the first), update totals, commit. A retry
    with the same client_id returns the moves saved the first time."""
    moves[0].client_id = client_id
    db.add_all(moves)
    try:
        for item in items:
            _sync_total(db, business, item)
        db.commit()
    except IntegrityError:
        db.rollback()
        first = _existing(db, business, client_id)
        if first is None:
            raise
        return group(db, first)
    return moves


def group(db: Session, first: StockMove) -> list[StockMove]:
    if first.group_id is None:
        return [first]
    return list(db.scalars(select(StockMove).where(StockMove.group_id == first.group_id)
                           .order_by(StockMove.created_at, StockMove.id)).all())


def _short(have: Decimal, item: Item, where: Place) -> HTTPException:
    godown = where == GODOWN
    return AppError(422, "stock_short_godown" if godown else "stock_short_van",
                    f"Only {have:f} {item.unit or ''} of {item.name} in {'the godown' if godown else 'this van'}."
                    .replace("  ", " "), qty=f"{have:f}", unit=item.unit or "", item=item.name)


# ---------------------------------------------------------------- operations

def purchase_details(supplier: str | None, unit_price, bill_ref: str | None, supplier_gstin: str | None = None,
                     gst_rate=None, gst_amount=None) -> dict:
    """A purchase must say who it was bought from, at what price, on which bill.
    GST is optional: the supplier's GSTIN, and the rate and tax as on their
    bill (both or neither), recorded as billed for the CA's ITC review."""
    name = " ".join((supplier or "").split())
    if not name or len(name) > 200:
        raise _reject("Enter the supplier you bought from.")
    ref = (bill_ref or "").strip()
    if not ref or len(ref) > 40:
        raise _reject("Enter the supplier's bill number (up to 40 characters).")
    try:
        price = Decimal(str(unit_price)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise _reject("Enter the purchase price per unit.") from None
    if not price.is_finite() or price < 0 or price > Decimal("10000000"):
        raise _reject("Enter the purchase price per unit.")
    out = {"supplier": name, "unit_price": price, "bill_ref": ref,
           "supplier_gstin": gst.clean_gstin(supplier_gstin)}
    if (gst_rate in (None, "")) != (gst_amount in (None, "")):
        raise _reject("Enter both the GST rate and the GST amount from the supplier's bill, or neither.")
    if gst_rate not in (None, ""):
        try:
            rate = Decimal(str(gst_rate)).quantize(Decimal("0.01"))
            tax = Decimal(str(gst_amount)).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError, TypeError):
            raise _reject("Enter the GST rate and amount as numbers.") from None
        # As billed: any rate the supplier charged, not only the ones Bolcash sells at.
        if not (0 <= rate <= 40) or not (0 <= tax <= Decimal("100000000")):
            raise _reject("Enter the GST rate (0–40%) and the GST amount from the supplier's bill.")
        out.update(gst_rate=rate, gst_amount=tax)
    return out


def supplier_for(db: Session, business: Business, *, supplier_id: str | None, name: str | None,
                 gstin: str | None = None) -> Supplier:
    """The supplier picked from the list, or the one with this name (same
    spelling), or a new one added to the list."""
    if supplier_id:
        s = db.get(Supplier, supplier_id)
        if s is None or s.business_id != business.id:
            raise _reject("Supplier not found", status.HTTP_404_NOT_FOUND)
        return s
    clean = " ".join((name or "").split())
    if not clean or len(clean) > 200:
        raise _reject("Enter the supplier you bought from.")
    s = db.scalars(select(Supplier).where(Supplier.business_id == business.id,
                                          Supplier.name_key == supplier_key(clean))).first()
    if s is None:
        s = Supplier(business_id=business.id, name=clean, name_key=supplier_key(clean), gstin=gstin)
        db.add(s)
        db.flush()
    elif gstin and not s.gstin:
        s.gstin = gstin
    return s


PURCHASES = "Purchases"  # the expense category a purchase is booked under


def purchase_expense(business: Business, move: StockMove, item: Item, day: str,
                     client_id: str | None) -> Expense:
    """The purchase as an expense: quantity × price per unit, plus the GST on
    the supplier's bill — what left the business."""
    # The price is per the unit it was bought in (₹ per box when bought in boxes).
    qty, unit = ((move.entered_qty, move.entered_unit) if move.entered_qty is not None
                 else (move.quantity, item.unit or ""))
    total = (qty * move.unit_price + (move.gst_amount or 0)).quantize(Decimal("0.01"))
    return Expense(business_id=business.id, amount=float(total), category=PURCHASES, vendor=move.supplier,
                   date=day, purchase_id=move.id,
                   client_id=f"purchase:{client_id}"[:80] if client_id else None,
                   notes=f"{qty.normalize():f} {unit} × {item.name} @ ₹{move.unit_price:.2f}, bill {move.bill_ref}".replace("  ", " "))


def record(db: Session, business: Business, user: User, role: str, *, kind: str,
           item_id: str, qty, location: str, van_user_id: str | None, day: str,
           client_id: str | None, note: str | None, purchase: dict | None = None,
           unit: str | None = None) -> list[StockMove]:
    """A purchase (into the godown, with supplier, price and bill) or a sale
    (out of the godown or a van)."""
    if (first := _existing(db, business, client_id)) is not None:
        return group(db, first)
    refuse_if_discarded(db, business.id, client_id)  # IM5: discarded by the owner on the phone
    assert_open(db, business, day)
    item = owned_item(db, business, item_id)
    entered = quantity(qty)
    q, entered_unit = to_base(db, item, entered, unit)  # stock is held in base units
    extra: dict = {"entered_unit": entered_unit, "entered_qty": entered if entered_unit else None}
    if kind == "purchase":
        if location != "godown":
            raise _reject("Purchases go into the godown; transfer to a van after.")
        where = place(db, business, user, role, "godown", None)
        purchase = dict(purchase or {})
        supplier_id = purchase.pop("supplier_id", None)
        if supplier_id:  # picked from the list: its name is the one on record
            purchase["supplier"] = supplier_for(db, business, supplier_id=supplier_id, name=None).name
        extra |= purchase_details(**purchase)
        sup = supplier_for(db, business, supplier_id=supplier_id, name=extra["supplier"],
                           gstin=extra.get("supplier_gstin"))
        extra.update(supplier=sup.name, supplier_id=sup.id)
        # The latest price paid, per base unit.
        item.purchase_price = float(extra["unit_price"] * entered / q) if q else float(extra["unit_price"])
        signed = q
    elif kind == "sale":
        where = place(db, business, user, role, location, van_user_id)
        signed = -q
    else:
        raise _reject("Kind must be 'purchase' or 'sale'.")
    (put if signed > 0 else take)(db, business, item, where, abs(signed))
    move = _move(business, item, where, kind, signed, day, user, note=note, **extra)
    if kind == "purchase":
        # The expense goes in the same transaction as the stock: both or neither.
        move.id = gen_id()
        db.add(purchase_expense(business, move, item, day, client_id))
    return _save(db, business, [item], [move], client_id)


def reverse(db: Session, business: Business, user: User, role: str, move_id: str, day: str) -> list[StockMove]:
    """Undo a stock entry with a mirror entry (same item and place, opposite
    quantity, reverses_id = the original); the original stays in history,
    marked reversed. A transfer is reversed as a pair, so total stock never
    moves. Not reversible: counts (a new count corrects a count), reversal
    rows, and anything already reversed. Taking stock back out is the same
    conditional UPDATE as a sale: refused if it's no longer there. A sale's
    credit entry and a purchase's expense are left as they are."""
    first = db.get(StockMove, move_id)
    if first is None or first.business_id != business.id:
        raise _reject("Stock entry not found", status.HTTP_404_NOT_FOUND)
    if first.kind == "count":
        raise _reject("A count can't be reversed; record a new count instead.")
    if first.reverses_id is not None:
        raise _reject("This entry is itself a reversal.")
    rows = group(db, first) if first.kind == "transfer" else [first]
    assert_open(db, business, first.date)  # the entry's own month
    assert_open(db, business, day)         # and the reversal's
    if any(m.reversed_at for m in rows):
        raise _reject("This entry has already been reversed.")
    item = owned_item(db, business, first.item_id)
    for m in rows:  # staff only on their own van; only the owner touches the godown
        place(db, business, user, role, m.location, m.van_user_id)
    stamp = datetime.now(timezone.utc).isoformat()
    # Mark the originals first, conditionally: of two reversals at once, one wins.
    done = db.execute(update(StockMove).where(StockMove.id.in_([m.id for m in rows]),
                                              StockMove.reversed_at.is_(None))
                      .values(reversed_at=stamp, reversed_by=user.id))
    if done.rowcount != len(rows):
        db.rollback()
        raise _reject("This entry has already been reversed.")
    gid = gen_id() if len(rows) > 1 else None
    mirrors = []
    # Take out first (the part that can fail), then put back.
    for m in sorted(rows, key=lambda m: m.quantity > 0, reverse=True):
        where = (m.location, m.van_user_id)
        q = Decimal(str(m.quantity))
        (take if q > 0 else put)(db, business, item, where, abs(q))
        mirrors.append(_move(business, item, where, m.kind, -q, day, user, group_id=gid,
                             reverses_id=m.id, note=f"Reversal of {m.kind} on {m.date}"))
    return _save(db, business, [item], mirrors, None)


def transfer(db: Session, business: Business, user: User, role: str, *, item_id: str, qty,
             van_user_id: str | None = None, day: str, client_id: str | None, note: str | None,
             from_location: str = "godown", from_van_user_id: str | None = None,
             to_location: str = "van", unit: str | None = None) -> list[StockMove]:
    """Move stock between places: godown → van (a load), van → godown (a
    return) or van → van. Two moves sharing a group_id; total stock never
    changes. The source only gives what it has (one conditional UPDATE, as
    for a sale); staff can move only out of their own van. `van_user_id` is
    the destination van."""
    if (first := _existing(db, business, client_id)) is not None:
        return group(db, first)
    refuse_if_discarded(db, business.id, client_id)  # IM5: discarded by the owner on the phone
    assert_open(db, business, day)
    item = owned_item(db, business, item_id)
    entered = quantity(qty)
    q, entered_unit = to_base(db, item, entered, unit)
    src = place(db, business, user, role, from_location, from_van_user_id)
    # The destination is any active van or the godown: staff may return stock
    # to the godown or hand it to a colleague; it's the source that's theirs.
    if to_location == "van" and not van_user_id:
        raise _reject("Pick the van to move the stock to.")
    dst = place(db, business, user, "owner", to_location, van_user_id)
    if src == dst:
        raise _reject("Pick a different place to move the stock to.")
    take(db, business, item, src, q)
    put(db, business, item, dst, q)
    gid = gen_id()
    shown = {"entered_unit": entered_unit, "entered_qty": entered if entered_unit else None}
    moves = [_move(business, item, src, "transfer", -q, day, user, group_id=gid, note=note, **shown),
             _move(business, item, dst, "transfer", q, day, user, group_id=gid, note=note, **shown)]
    return _save(db, business, [item], moves, client_id)


def count(db: Session, business: Business, user: User, role: str, *, location: str,
          van_user_id: str | None, day: str, lines: list[tuple[str, object]],
          client_id: str | None) -> list[dict]:
    """Physical count of one place: one 'count' move per item, quantity =
    counted − system (0 when it matched), so the log shows every count."""
    if not role_can(role, ENTRY_EDIT):
        raise _reject("Only the owner can enter a stock count.", 403)
    if (first := _existing(db, business, client_id)) is None:
        assert_open(db, business, day)
        if not lines:
            raise _reject("Count at least one item.")
        if len({i for i, _ in lines}) != len(lines):
            raise _reject("Each item can be counted once per count.")
        where = place(db, business, user, role, location, van_user_id)
        items = [owned_item(db, business, i) for i, _ in lines]
        gid = gen_id()
        moves = []
        for item, (_, counted) in zip(items, lines):
            c = quantity(counted, allow_zero=True)
            system = set_count(db, business, item, where, c)
            moves.append(_move(business, item, where, "count", c - system, day, user,
                               group_id=gid, counted=c, note="stock count"))
        moves = _save(db, business, items, moves, client_id)
    else:
        moves = group(db, first)
    return [count_line(m) for m in moves]


def count_line(m: StockMove) -> dict:
    """Result of one counted item, read back from its move."""
    counted = Decimal(m.counted).quantize(QTY)
    diff = Decimal(m.quantity).quantize(QTY)
    system = counted - diff
    pct = None if system == 0 else (diff / system * 100).quantize(Decimal("0.01"))
    within = diff == 0 if system == 0 else abs(diff) <= abs(system) * TOLERANCE
    return {"itemId": m.item_id, "system": f"{system:f}", "counted": f"{counted:f}",
            "difference": f"{diff:f}", "differencePct": None if pct is None else f"{pct:f}",
            "withinTolerance": within}


def opening(db: Session, business: Business, user: User | None, item: Item, qty: float) -> None:
    """Opening stock entered on the item form goes into the godown."""
    if qty:
        db.flush()  # the item row must exist before its stock level
        put(db, business, item, GODOWN, quantity(qty))
        db.add(StockMove(business_id=business.id, item_id=item.id, location="godown",
                         kind="opening", quantity=quantity(qty), date=item.created_at[:10],
                         created_by=user.id if user else None, note="opening stock"))
        _sync_total(db, business, item)
