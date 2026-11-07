from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import gst, stock
from ..database import get_db
from ..deps import require
from ..rbac import DATA_VIEW, SETTINGS_MANAGE
from ..models import Business, GstRateChangeLog, Item, SchemeItem, StockMove, User
from ..security import get_current_user
from ..serializers import item_dto
from ..validation import _reject

router = APIRouter(tags=["items"])


class ItemBody(BaseModel):
    name: str
    type: str = "product"  # product | service
    sale_price: float = 0.0
    purchase_price: float = 0.0
    unit: str | None = None
    hsn_sac: str | None = None
    gst_rate: float = 0.0
    track_stock: bool = False
    # Opening stock (into the godown) when creating; ignored on update — stock
    # then changes only through purchases, sales, transfers and counts.
    stock_qty: float = 0.0
    low_stock_threshold: float | None = None


def _validated(body: ItemBody) -> dict:
    if body.sale_price < 0:
        raise _reject("Sale price can't be negative.")
    if body.purchase_price < 0:
        raise _reject("Purchase price can't be negative.")
    gst.clean_rate(body.gst_rate)  # one rate list, in app/gst.py
    values = body.model_dump()
    if body.low_stock_threshold is not None:
        values["low_stock_threshold"] = stock.quantity(body.low_stock_threshold, allow_zero=True)
    if body.stock_qty:
        stock.quantity(body.stock_qty)
    return values


def _owned_item(db: Session, business: Business, item_id: str) -> Item:
    item = db.get(Item, item_id)
    if item is None or item.business_id != business.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Item not found"
        )
    return item


@router.get("/items")
def list_items(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
    search: str | None = None,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    base = select(Item).where(Item.business_id == business.id)
    if search:
        like = f"%{search}%"
        base = base.where(
            or_(Item.name.ilike(like), Item.hsn_sac.ilike(like))
        )

    total = len(db.scalars(base).all())
    offset = int(cursor) if (cursor and cursor.isdigit()) else 0
    rows = db.scalars(
        base.order_by(Item.name.asc()).offset(offset).limit(limit + 1)
    ).all()

    has_more = len(rows) > limit
    items = rows[:limit]
    return {
        "items": [item_dto(i) for i in items],
        "next_cursor": str(offset + limit) if has_more else None,
        "total": total,
    }


@router.get("/items/{item_id}")
def get_item(
    item_id: str,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    return item_dto(_owned_item(db, business, item_id))


@router.post("/items")
def create_item(
    body: ItemBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    values = _validated(body)
    opening = values.pop("stock_qty")
    row = Item(business_id=business.id, stock_qty=0.0, **values)
    db.add(row)
    db.flush()
    if row.type == "product":
        stock.opening(db, business, user, row, opening)
    db.commit()
    db.refresh(row)
    return item_dto(row)


@router.patch("/items/{item_id}")
def update_item(
    item_id: str,
    body: ItemBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    item = _owned_item(db, business, item_id)
    values = _validated(body)
    values.pop("stock_qty")  # stock is the move ledger's; see app/stock.py
    if item.stock_qty:
        values["track_stock"] = True
    old_rate, new_rate = Decimal(str(item.gst_rate)), Decimal(str(values["gst_rate"]))
    if old_rate != new_rate:
        # Logged, never applied backwards: saved invoices keep their own rate and tax.
        db.add(GstRateChangeLog(business_id=business.id, item_id=item.id, item_name=item.name,
                                old_rate=old_rate, new_rate=new_rate, changed_by=user.id))
    for key, value in values.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item_dto(item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: str,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> None:
    item = _owned_item(db, business, item_id)
    # Explicit for SQLite, which doesn't enforce the cascade.
    db.query(StockMove).filter(StockMove.item_id == item.id).delete(synchronize_session=False)
    db.query(SchemeItem).filter(SchemeItem.item_id == item.id).delete(synchronize_session=False)
    db.delete(item)
    db.commit()
