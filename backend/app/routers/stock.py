from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import gst
from .. import stock as svc
from ..calc import today_iso
from ..database import get_db
from ..deps import get_current_membership, require
from ..models import AccessLog, Business, BusinessMember, Item, ItemUnit, StockMonthLock, StockMove, Supplier, User, now_iso
from ..rbac import DATA_VIEW, ENTRY_CREATE, ENTRY_EDIT, role_can
from ..security import get_current_user
from ..validation import validate_date, validate_notes

router = APIRouter(tags=["stock"])


class MoveBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    client_id: str | None = Field(default=None, alias="clientId", max_length=80)
    kind: str  # purchase | sale
    item_id: str = Field(alias="itemId")
    quantity: str | float
    unit: str | None = Field(default=None, max_length=20)  # one of the item's units; default its base unit
    location: str = "godown"  # godown | van
    van_user_id: str | None = Field(default=None, alias="vanUserId")
    date: str
    note: str | None = None
    # Purchases: required — a supplier from the list (supplierId) or a name
    # (a new name is added to the list).
    supplier_id: str | None = Field(default=None, alias="supplierId", max_length=40)
    supplier: str | None = Field(default=None, max_length=200)
    unit_price: str | float | None = Field(default=None, alias="unitPrice")
    bill_ref: str | None = Field(default=None, alias="billRef", max_length=40)
    # Purchases, optional: the supplier's GSTIN and the GST on their bill.
    supplier_gstin: str | None = Field(default=None, alias="supplierGstin", max_length=20)
    gst_rate: str | float | None = Field(default=None, alias="gstRate")
    gst_amount: str | float | None = Field(default=None, alias="gstAmount")


class TransferBody(BaseModel):
    """godown → van (the default), van → godown or van → van."""
    model_config = ConfigDict(populate_by_name=True)
    client_id: str | None = Field(default=None, alias="clientId", max_length=80)
    item_id: str = Field(alias="itemId")
    quantity: str | float
    unit: str | None = Field(default=None, max_length=20)
    from_location: str = Field(default="godown", alias="fromLocation")
    from_van_user_id: str | None = Field(default=None, alias="fromVanUserId")
    to_location: str = Field(default="van", alias="toLocation")
    van_user_id: str | None = Field(default=None, alias="vanUserId")  # the destination van
    date: str
    note: str | None = None


class CountLine(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    item_id: str = Field(alias="itemId")
    counted: str | float


class CountBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    client_id: str | None = Field(default=None, alias="clientId", max_length=80)
    location: str
    van_user_id: str | None = Field(default=None, alias="vanUserId")
    date: str
    lines: list[CountLine] = Field(max_length=2000)


def _q(x: Decimal) -> str:
    return f"{Decimal(x).quantize(svc.QTY):f}"


def move_dto(m: StockMove) -> dict:
    return {"id": m.id, "itemId": m.item_id, "location": m.location, "vanUserId": m.van_user_id,
            "kind": m.kind, "quantity": _q(m.quantity), "date": m.date, "groupId": m.group_id,
            "counted": None if m.counted is None else _q(m.counted), "note": m.note,
            "supplier": m.supplier, "supplierId": m.supplier_id, "billRef": m.bill_ref,
            "unitPrice": None if m.unit_price is None else f"{Decimal(m.unit_price):.2f}",
            "supplierGstin": m.supplier_gstin,
            "gstRate": None if m.gst_rate is None else f"{Decimal(m.gst_rate).normalize():f}",
            "gstAmount": None if m.gst_amount is None else f"{Decimal(m.gst_amount):.2f}",
            "enteredUnit": m.entered_unit,
            "enteredQty": None if m.entered_qty is None else _q(m.entered_qty),
            "reversesId": m.reverses_id, "reversed": m.reversed_at is not None, "reversedAt": m.reversed_at,
            "createdBy": m.created_by, "createdAt": m.created_at}


def _vans(db: Session, business: Business) -> list[dict]:
    rows = db.execute(
        select(BusinessMember, User).join(User, User.id == BusinessMember.user_id)
        .where(BusinessMember.business_id == business.id, BusinessMember.status == "active")
    ).all()
    return [{"userId": u.id, "mobile": u.mobile, "role": m.role, "name": m.display_name}
            for m, u in sorted(rows, key=lambda r: (r[0].role != "staff", r[0].display_name or r[1].mobile))]


def _stock_items(db: Session, business: Business) -> list[Item]:
    return list(db.scalars(select(Item).where(
        Item.business_id == business.id, Item.type == "product", Item.track_stock.is_(True)
    ).order_by(Item.name)).all())


def _item_dto(item: Item, places: dict, units: list | None = None) -> dict:
    total = sum(places.values(), svc.ZERO)
    threshold = item.low_stock_threshold
    units = units or []
    return {
        # Quantities are in the base unit (`unit`); `units` are its other units
        # (box = 24) and `display` reads the total in them ("8 box 18 pcs").
        "units": [{"unit": u.unit, "factor": _q(u.factor)} for u in units],
        "display": svc.breakdown(total, item.unit, units),
        "id": item.id, "name": item.name, "unit": item.unit,
        "purchasePrice": item.purchase_price, "salePrice": item.sale_price,
        "lowStockThreshold": None if threshold is None else _q(threshold),
        "godown": _q(places.get(svc.GODOWN, svc.ZERO)),
        "vans": {van: _q(q) for (loc, van), q in places.items() if loc == "van" and q != 0},
        "total": _q(total),
        # Strictly below: at the threshold is not low.
        "low": threshold is not None and total < Decimal(threshold),
    }


@router.get("/stock")
def stock_levels(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """Every stocked item: godown, each van, total, and whether it's low."""
    levels = svc.levels(db, business)
    items = _stock_items(db, business)
    units: dict[str, list] = {}
    for u in db.scalars(select(ItemUnit).where(ItemUnit.item_id.in_([i.id for i in items]))
                        .order_by(ItemUnit.factor.desc())):
        units.setdefault(u.item_id, []).append(u)
    return {"items": [_item_dto(i, levels.get(i.id, {}), units.get(i.id)) for i in items],
            "vans": _vans(db, business)}


class UnitLine(BaseModel):
    unit: str = Field(min_length=1, max_length=20)
    factor: Decimal


class UnitsBody(BaseModel):
    units: list[UnitLine] = Field(max_length=10)


def _units_dto(item: Item, units: list, locked: bool) -> dict:
    return {"itemId": item.id, "baseUnit": item.unit, "locked": locked,
            "units": [{"unit": u.unit, "factor": _q(u.factor)} for u in units]}


# --- Month-end count: reminder and lock (stock only; the ledger stays open) -----

def _month(value: str) -> str:
    import re
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
        raise HTTPException(422, "The month must look like 2026-11.")
    return value


def _lock_row(db: Session, business: Business, month: str) -> StockMonthLock | None:
    return db.scalars(select(StockMonthLock).where(StockMonthLock.business_id == business.id,
                                                   StockMonthLock.month == month)).first()


def _month_status(db: Session, business: Business, day: str) -> dict:
    import calendar
    from datetime import date as Date
    d = Date.fromisoformat(day)
    month = day[:7]
    last = calendar.monthrange(d.year, d.month)[1]
    counted = db.scalars(select(StockMove.id).where(StockMove.business_id == business.id, StockMove.kind == "count",
                                                    StockMove.date.startswith(month))).first() is not None
    lock = _lock_row(db, business, month)
    names = dict(db.execute(select(BusinessMember.user_id, BusinessMember.display_name).where(
        BusinessMember.business_id == business.id)).all())
    who = lambda uid: None if uid is None else {"userId": uid, "name": names.get(uid)}  # noqa: E731
    locked = bool(lock and lock.locked)
    return {
        "month": month, "counted": counted, "locked": locked,
        # The card: the last 3 days of the month, until the month is counted and locked.
        "reminderDue": d.day > last - 3 and not locked,
        "lockedAt": lock.locked_at if lock else None, "lockedBy": who(lock.locked_by) if lock else None,
        "unlockedAt": lock.unlocked_at if lock else None, "unlockedBy": who(lock.unlocked_by) if lock else None,
    }


@router.get("/stock/month-status")
def month_status(
    date: str | None = Query(None),
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """This month's count: due (last 3 days), counted, locked — and who
    last locked or unlocked it."""
    return _month_status(db, business, validate_date(date) if date else today_iso())


@router.post("/stock/months/{month}/lock")
def lock_month(
    month: str,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: confirm the month's count. No stock entry dated in the month can
    then be added, reversed or counted again."""
    month = _month(month)
    if not db.scalars(select(StockMove.id).where(StockMove.business_id == business.id, StockMove.kind == "count",
                                                 StockMove.date.startswith(month))).first():
        raise HTTPException(422, "Enter this month's stock count first.")
    lock = _lock_row(db, business, month)
    if lock is None:
        lock = StockMonthLock(business_id=business.id, month=month, locked_at=now_iso())
        db.add(lock)
    lock.locked, lock.locked_at, lock.locked_by = True, now_iso(), user.id
    db.commit()
    return _month_status(db, business, f"{month}-01") | {"month": month}


@router.post("/stock/months/{month}/unlock")
def unlock_month(
    month: str,
    request: Request,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner only: reopen a locked month. Writes one audit-log row; the lock
    screen shows who unlocked it and when."""
    month = _month(month)
    lock = _lock_row(db, business, month)
    if lock is None or not lock.locked:
        raise HTTPException(422, "This month isn't locked.")
    lock.locked, lock.unlocked_at, lock.unlocked_by = False, now_iso(), user.id
    db.add(AccessLog(business_id=business.id, user_id=user.id, mobile=user.mobile, action="unlock",
                     method="POST", path=request.url.path[:300]))
    db.commit()
    return _month_status(db, business, f"{month}-01") | {"month": month}


@router.get("/items/{item_id}/units")
def item_units(
    item_id: str,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """The item's base unit, its other units, and whether they're locked."""
    item = svc.owned_item(db, business, item_id)
    return _units_dto(item, svc.units_of(db, item), svc.has_movement(db, item))


@router.put("/items/{item_id}/units")
def set_item_units(
    item_id: str,
    body: UnitsBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Set the item's other units (box = 24 base units). Refused (422) once
    the item has any stock movement: the fix then is a new item."""
    item = svc.owned_item(db, business, item_id)
    if not item.unit:
        raise HTTPException(422, "Give the item its base unit (e.g. pcs) first.")
    units = svc.set_units(db, item, [(u.unit, u.factor) for u in body.units])
    db.commit()
    return _units_dto(item, units, False)


@router.get("/stock/low")
def low_stock(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    levels = svc.levels(db, business)
    rows = [_item_dto(i, levels.get(i.id, {})) for i in _stock_items(db, business)]
    return [r for r in rows if r["low"]]


@router.get("/stock/van")
def van_stock(
    user_id: str | None = Query(None, alias="userId"),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """One van's stock. Staff see only their own van."""
    business, role = membership
    where = svc.place(db, business, user, role, "van", user_id)
    levels = svc.levels(db, business)
    out = []
    for item in _stock_items(db, business):
        qty = levels.get(item.id, {}).get(where, svc.ZERO)
        if qty != 0:
            out.append({"id": item.id, "name": item.name, "unit": item.unit,
                        "salePrice": item.sale_price, "quantity": _q(qty)})
    return out


@router.get("/stock/moves")
def stock_moves(
    item_id: str | None = Query(None, alias="itemId"),
    limit: int = Query(100, ge=1, le=500),
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """The audit log, newest first."""
    q = select(StockMove).where(StockMove.business_id == business.id)
    if item_id:
        q = q.where(StockMove.item_id == item_id)
    rows = db.scalars(q.order_by(StockMove.created_at.desc(), StockMove.id).limit(limit)).all()
    return [move_dto(m) for m in rows]


class SupplierBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=20)
    gstin: str | None = Field(default=None, max_length=20)


def supplier_dto(s: Supplier) -> dict:
    return {"id": s.id, "name": s.name, "phone": s.phone, "gstin": s.gstin}


@router.get("/suppliers")
def list_suppliers(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Who the business buys from, A–Z."""
    rows = db.scalars(select(Supplier).where(Supplier.business_id == business.id).order_by(Supplier.name_key))
    return [supplier_dto(s) for s in rows]


@router.post("/suppliers")
def add_supplier(
    body: SupplierBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Add a supplier (or return the one already on the list with that spelling)."""
    s = svc.supplier_for(db, business, supplier_id=None, name=body.name, gstin=gst.clean_gstin(body.gstin))
    if body.phone and not s.phone:
        s.phone = body.phone.strip()
    db.commit()
    return supplier_dto(s)


@router.post("/stock/moves")
def add_move(
    body: MoveBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    business, role = membership
    if not role_can(role, ENTRY_CREATE):
        raise HTTPException(403, "You don't have permission to do that.")
    moves = svc.record(db, business, user, role, kind=body.kind, item_id=body.item_id,
                       qty=body.quantity, unit=body.unit, location=body.location, van_user_id=body.van_user_id,
                       day=validate_date(body.date), client_id=body.client_id,
                       note=validate_notes(body.note, 500),
                       purchase={"supplier_id": body.supplier_id, "supplier": body.supplier,
                                 "unit_price": body.unit_price,
                                 "bill_ref": body.bill_ref, "supplier_gstin": body.supplier_gstin,
                                 "gst_rate": body.gst_rate, "gst_amount": body.gst_amount})
    return [move_dto(m) for m in moves]


@router.post("/stock/moves/{move_id}/reverse")
def reverse_move(
    move_id: str,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Undo a stock entry with a reversal (never an edit). Returns the mirror rows."""
    business, role = membership
    if not role_can(role, ENTRY_CREATE):
        raise HTTPException(403, "You don't have permission to do that.")
    return [move_dto(m) for m in svc.reverse(db, business, user, role, move_id, today_iso())]


@router.post("/stock/transfers")
def add_transfer(
    body: TransferBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    business, role = membership
    moves = svc.transfer(db, business, user, role, item_id=body.item_id, qty=body.quantity,
                         van_user_id=body.van_user_id, day=validate_date(body.date),
                         client_id=body.client_id, note=validate_notes(body.note, 500),
                         from_location=body.from_location, from_van_user_id=body.from_van_user_id,
                         to_location=body.to_location, unit=body.unit)
    return [move_dto(m) for m in moves]


@router.post("/stock/counts")
def add_count(
    body: CountBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    business, role = membership
    if not role_can(role, ENTRY_EDIT):
        raise HTTPException(403, "Only the owner can enter a stock count.")
    lines = svc.count(db, business, user, role, location=body.location,
                      van_user_id=body.van_user_id, day=validate_date(body.date),
                      lines=[(line.item_id, line.counted) for line in body.lines],
                      client_id=body.client_id)
    return {"date": body.date, "location": body.location, "vanUserId": body.van_user_id,
            "lines": lines,
            "allWithinTolerance": all(line["withinTolerance"] for line in lines)}
