"""Failed entries in a phone's offline queue (IM5).

- POST /sync/discard  owner only: a queued entry that never synced is dropped for
                      good. Its client id is recorded (a late retry can't create
                      it) and one audit row is written. A server row is never
                      deleted: an entry that already synced is refused (409).

Editing a failed entry happens on the phone: it changes the queued entry and keeps
its client id, so the next sync creates it exactly once (the create routes dedupe
on the client id).
"""
from __future__ import annotations

from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require
from ..errors import AppError
from ..models import (AccessLog, Bill, Business, Customer, DiscardedEntry, Expense, Income, LedgerEntry, StockMove,
                      User, Visit)
from ..rbac import ENTRY_DELETE
from ..security import get_current_user

router = APIRouter(tags=["sync"])

Kind = Literal["income", "expense", "ledger", "visit", "stock", "bill"]


class DiscardBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    client_id: str = Field(alias="clientId", min_length=1, max_length=80)
    kind: Kind
    # What the phone's confirm screen named, kept in the audit row.
    amount: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    summary: str = Field(default="", max_length=200)


def _on_server(db: Session, business: Business, kind: str, client_id: str) -> bool:
    if kind == "ledger":  # ledger rows belong to a customer of the business
        q = select(LedgerEntry.id).join(Customer, Customer.id == LedgerEntry.customer_id).where(
            Customer.business_id == business.id, LedgerEntry.client_id == client_id)
    else:
        model = {"income": Income, "expense": Expense, "visit": Visit, "stock": StockMove, "bill": Bill}[kind]
        q = select(model.id).where(model.business_id == business.id, model.client_id == client_id)
    return db.scalars(q).first() is not None


@router.post("/sync/discard")
def discard_queued(
    body: DiscardBody,
    business: Business = Depends(require(ENTRY_DELETE)),  # owner only: staff and accountants get 403
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if _on_server(db, business, body.kind, body.client_id):
        raise AppError(status.HTTP_409_CONFLICT, "already_synced",
                       "This entry already reached the server, so it can't be discarded. "
                       "It clears from the phone on the next sync.")
    already = db.scalars(select(DiscardedEntry).where(
        DiscardedEntry.business_id == business.id, DiscardedEntry.client_id == body.client_id)).first()
    if already is None:  # discarding twice is fine: one record, one audit row
        summary = body.summary.strip()
        db.add(DiscardedEntry(business_id=business.id, client_id=body.client_id, kind=body.kind,
                              amount=body.amount, summary=summary, discarded_by=user.id))
        what = " · ".join(x for x in (f"₹{body.amount:,.2f}" if body.amount is not None else "", summary) if x)
        db.add(AccessLog(business_id=business.id, user_id=user.id, mobile=user.mobile, action="discard",
                         method="POST", path=f"Discarded a queued {body.kind}: {what} ({body.client_id})"[:300]))
        db.commit()
    return {"discarded": True, "clientId": body.client_id}
