from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_business
from ..models import Business, Item
from ..serializers import item_dto

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
    stock_qty: float = 0.0


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
    business: Business = Depends(get_current_business),
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
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    return item_dto(_owned_item(db, business, item_id))


@router.post("/items")
def create_item(
    body: ItemBody,
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    row = Item(business_id=business.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return item_dto(row)


@router.patch("/items/{item_id}")
def update_item(
    item_id: str,
    body: ItemBody,
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> dict:
    item = _owned_item(db, business, item_id)
    for key, value in body.model_dump().items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item_dto(item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: str,
    business: Business = Depends(get_current_business),
    db: Session = Depends(get_db),
) -> None:
    db.delete(_owned_item(db, business, item_id))
    db.commit()
