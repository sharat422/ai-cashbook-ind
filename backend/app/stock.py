"""Stock basics for a distributor: godown and per-salesperson van stock.

Stock at a place is the sum of its StockMove rows, so every change is in the
audit log by construction. Phase 1 only: no warehouses/bins, batches, expiry
or manufacturing.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import Business, BusinessMember, Item, StockMove, User, gen_id
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
            raise _reject("Only the owner or accountant can change godown stock.", 403)
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
    """{item_id: {place: qty}} from the move ledger."""
    q = (select(StockMove.item_id, StockMove.location, StockMove.van_user_id,
                func.sum(StockMove.quantity))
         .where(StockMove.business_id == business.id)
         .group_by(StockMove.item_id, StockMove.location, StockMove.van_user_id))
    if item_ids is not None:
        q = q.where(StockMove.item_id.in_(item_ids))
    out: dict[str, dict[Place, Decimal]] = defaultdict(dict)
    for item_id, loc, van, total in db.execute(q).all():
        out[item_id][(loc, van)] = Decimal(str(total or 0)).quantize(QTY)
    return out


def at(db: Session, business: Business, item: Item, where: Place) -> Decimal:
    return levels(db, business, [item.id]).get(item.id, {}).get(where, ZERO)


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
# ponytail: the "enough stock?" check isn't locked, so two sales at the same
# instant could both pass; add SELECT … FOR UPDATE on Postgres if that happens.

def record(db: Session, business: Business, user: User, role: str, *, kind: str,
           item_id: str, qty, location: str, van_user_id: str | None, day: str,
           client_id: str | None, note: str | None) -> list[StockMove]:
    """A purchase (into the godown) or a sale (out of the godown or a van)."""
    if (first := _existing(db, business, client_id)) is not None:
        return group(db, first)
    item = owned_item(db, business, item_id)
    q = quantity(qty)
    if kind == "purchase":
        if location != "godown":
            raise _reject("Purchases go into the godown; transfer to a van after.")
        where = place(db, business, user, role, "godown", None)
        signed = q
    elif kind == "sale":
        where = place(db, business, user, role, location, van_user_id)
        have = at(db, business, item, where)
        if have < q:
            raise _short(have, item, where)
        signed = -q
    else:
        raise _reject("Kind must be 'purchase' or 'sale'.")
    return _save(db, business, [item], [_move(business, item, where, kind, signed, day, user,
                                               note=note)], client_id)


def transfer(db: Session, business: Business, user: User, role: str, *, item_id: str, qty,
             van_user_id: str, day: str, client_id: str | None, note: str | None
             ) -> list[StockMove]:
    """Godown → van: two moves sharing a group_id."""
    if (first := _existing(db, business, client_id)) is not None:
        return group(db, first)
    if not role_can(role, ENTRY_EDIT):
        raise _reject("Only the owner or accountant can load a van.", 403)
    item = owned_item(db, business, item_id)
    q = quantity(qty)
    van = place(db, business, user, role, "van", van_user_id)
    have = at(db, business, item, GODOWN)
    if have < q:
        raise _short(have, item, GODOWN)
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
        raise _reject("Only the owner or accountant can enter a stock count.", 403)
    if (first := _existing(db, business, client_id)) is None:
        if not lines:
            raise _reject("Count at least one item.")
        if len({i for i, _ in lines}) != len(lines):
            raise _reject("Each item can be counted once per count.")
        where = place(db, business, user, role, location, van_user_id)
        items = [owned_item(db, business, i) for i, _ in lines]
        current = levels(db, business, [i.id for i in items])
        gid = gen_id()
        moves = []
        for item, (_, counted) in zip(items, lines):
            system = current.get(item.id, {}).get(where, ZERO)
            c = quantity(counted, allow_zero=True)
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
        db.add(StockMove(business_id=business.id, item_id=item.id, location="godown",
                         kind="opening", quantity=quantity(qty), date=item.created_at[:10],
                         created_by=user.id if user else None, note="opening stock"))
        _sync_total(db, business, item)
