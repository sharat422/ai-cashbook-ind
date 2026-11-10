"""Stock basics for a distributor: godown and per-salesperson van stock.

Every change is a StockMove (the audit log) plus one atomic change to the
place's StockLevel. Taking stock out is a single conditional UPDATE
(`qty >= n`), so two sales at the same moment can never both take the last
box; a CHECK (qty >= 0) in the database is the backstop. Phase 1 only: no
warehouses/bins, batches, expiry or manufacturing.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import Business, BusinessMember, Item, StockLevel, StockMove, User, gen_id
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
    name = "the godown" if where == GODOWN else "this van"
    return _reject(f"Only {have:f} {item.unit or ''} of {item.name} in {name}.".replace("  ", " "))


# ---------------------------------------------------------------- operations

def purchase_details(supplier: str | None, unit_price, bill_ref: str | None) -> dict:
    """A purchase must say who it was bought from, at what price, on which bill."""
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
    return {"supplier": name, "unit_price": price, "bill_ref": ref}


def record(db: Session, business: Business, user: User, role: str, *, kind: str,
           item_id: str, qty, location: str, van_user_id: str | None, day: str,
           client_id: str | None, note: str | None, purchase: dict | None = None) -> list[StockMove]:
    """A purchase (into the godown, with supplier, price and bill) or a sale
    (out of the godown or a van)."""
    if (first := _existing(db, business, client_id)) is not None:
        return group(db, first)
    item = owned_item(db, business, item_id)
    q = quantity(qty)
    extra: dict = {}
    if kind == "purchase":
        if location != "godown":
            raise _reject("Purchases go into the godown; transfer to a van after.")
        where = place(db, business, user, role, "godown", None)
        extra = purchase_details(**(purchase or {}))
        item.purchase_price = float(extra["unit_price"])  # the latest price paid
        signed = q
    elif kind == "sale":
        where = place(db, business, user, role, location, van_user_id)
        signed = -q
    else:
        raise _reject("Kind must be 'purchase' or 'sale'.")
    (put if signed > 0 else take)(db, business, item, where, abs(signed))
    return _save(db, business, [item], [_move(business, item, where, kind, signed, day, user,
                                               note=note, **extra)], client_id)


def transfer(db: Session, business: Business, user: User, role: str, *, item_id: str, qty,
             van_user_id: str, day: str, client_id: str | None, note: str | None
             ) -> list[StockMove]:
    """Godown → van: two moves sharing a group_id."""
    if (first := _existing(db, business, client_id)) is not None:
        return group(db, first)
    if not role_can(role, ENTRY_EDIT):
        raise _reject("Only the owner can load a van.", 403)
    item = owned_item(db, business, item_id)
    q = quantity(qty)
    van = place(db, business, user, role, "van", van_user_id)
    take(db, business, item, GODOWN, q)
    put(db, business, item, van, q)
    gid = gen_id()
    moves = [_move(business, item, GODOWN, "transfer", -q, day, user, group_id=gid, note=note),
             _move(business, item, van, "transfer", q, day, user, group_id=gid, note=note)]
    return _save(db, business, [item], moves, client_id)


def count(db: Session, business: Business, user: User, role: str, *, location: str,
          van_user_id: str | None, day: str, lines: list[tuple[str, object]],
          client_id: str | None) -> list[dict]:
    """Physical count of one place: one 'count' move per item, quantity =
    counted − system (0 when it matched), so the log shows every count."""
    if not role_can(role, ENTRY_EDIT):
        raise _reject("Only the owner can enter a stock count.", 403)
    if (first := _existing(db, business, client_id)) is None:
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
