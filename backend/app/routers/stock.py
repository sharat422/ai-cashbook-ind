from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import stock as svc
from ..database import get_db
from ..deps import get_current_membership, require
from ..models import Business, BusinessMember, Item, StockMove, User
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
    location: str = "godown"  # godown | van
    van_user_id: str | None = Field(default=None, alias="vanUserId")
    date: str
    note: str | None = None
    # Purchases: required.
    supplier: str | None = Field(default=None, max_length=200)
    unit_price: str | float | None = Field(default=None, alias="unitPrice")
    bill_ref: str | None = Field(default=None, alias="billRef", max_length=40)


class TransferBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    client_id: str | None = Field(default=None, alias="clientId", max_length=80)
    item_id: str = Field(alias="itemId")
    quantity: str | float
    van_user_id: str = Field(alias="vanUserId")
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
            "supplier": m.supplier, "billRef": m.bill_ref,
            "unitPrice": None if m.unit_price is None else f"{Decimal(m.unit_price):.2f}",
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


def _item_dto(item: Item, places: dict) -> dict:
    total = sum(places.values(), svc.ZERO)
    threshold = item.low_stock_threshold
    return {
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
    return {"items": [_item_dto(i, levels.get(i.id, {})) for i in _stock_items(db, business)],
            "vans": _vans(db, business)}


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
                       qty=body.quantity, location=body.location, van_user_id=body.van_user_id,
                       day=validate_date(body.date), client_id=body.client_id,
                       note=validate_notes(body.note, 500),
                       purchase={"supplier": body.supplier, "unit_price": body.unit_price,
                                 "bill_ref": body.bill_ref})
    return [move_dto(m) for m in moves]


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
                         client_id=body.client_id, note=validate_notes(body.note, 500))
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
