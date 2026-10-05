"""Self-service data rights (DPDP): export everything, and delete the account.

- GET  /account/export  — the user's full data as JSON (right to access/port).
- DELETE /account       — hard-delete the user and everything they own, after an
                          explicit typed confirmation, and log the deletion for
                          our compliance record (right to erasure).

Business-profile correction lives in auth.py (PATCH /businesses/me).
"""

import json
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    AccountDeletionLog,
    AiDecision,
    Business,
    BusinessMember,
    Customer,
    Expense,
    Feedback,
    Income,
    Item,
    LedgerEntry,
    RecurringExpense,
    User,
    now_iso,
)
from ..security import get_current_user
from ..serializers import (
    business_dto,
    customer_dto,
    expense_dto,
    income_dto,
    item_dto,
    ledger_dto,
    recurring_expense_dto,
)

router = APIRouter(tags=["account"])

# The user must type this exactly to delete (there's no password — OTP auth).
DELETE_CONFIRMATION = "DELETE MY ACCOUNT"


def _owned_businesses(db: Session, user: User) -> list[Business]:
    return db.scalars(select(Business).where(Business.user_id == user.id)).all()


@router.get("/account/export")
def export_account(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Everything we hold for this user, as portable JSON."""
    out: dict = {
        "schema_version": 1,
        "exported_at": now_iso(),
        "account": {
            "id": user.id,
            "mobile": user.mobile,
            "created_at": user.created_at,
        },
        "businesses": [],
    }
    for b in _owned_businesses(db, user):
        customers = db.scalars(
            select(Customer).where(Customer.business_id == b.id)
        ).all()
        cust_ids = [c.id for c in customers]
        ledger = (
            db.scalars(
                select(LedgerEntry).where(LedgerEntry.customer_id.in_(cust_ids))
            ).all()
            if cust_ids
            else []
        )
        out["businesses"].append({
            "business": business_dto(b),
            "incomes": [income_dto(x) for x in db.scalars(
                select(Income).where(Income.business_id == b.id)).all()],
            "expenses": [expense_dto(x) for x in db.scalars(
                select(Expense).where(Expense.business_id == b.id)).all()],
            "customers": [customer_dto(c) for c in customers],
            "ledger_entries": [ledger_dto(x) for x in ledger],
            "items": [item_dto(x) for x in db.scalars(
                select(Item).where(Item.business_id == b.id)).all()],
            "recurring_expenses": [recurring_expense_dto(x) for x in db.scalars(
                select(RecurringExpense).where(RecurringExpense.business_id == b.id)).all()],
            "team": [
                {"user_id": m.user_id, "role": m.role, "status": m.status,
                 "invited_by_mobile": m.invited_by_mobile}
                for m in db.scalars(
                    select(BusinessMember).where(BusinessMember.business_id == b.id)).all()
            ],
        })
    return out


class DeleteAccountBody(BaseModel):
    confirmation: str


@router.delete("/account")
def delete_account(
    body: DeleteAccountBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Permanently delete the user and everything they own. Requires the exact
    confirmation phrase. Writes a PII-free deletion record for compliance."""
    if body.confirmation.strip().upper() != DELETE_CONFIRMATION:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f'Type "{DELETE_CONFIRMATION}" exactly to confirm deletion.',
        )

    counts: dict[str, int] = defaultdict(int)
    businesses = _owned_businesses(db, user)
    biz_ids = [b.id for b in businesses]

    if biz_ids:
        cust_ids = [
            c.id for c in db.scalars(
                select(Customer).where(Customer.business_id.in_(biz_ids))).all()
        ]
        # Children first, then parents — explicit so it works regardless of
        # whether the DB enforces ON DELETE CASCADE (SQLite often doesn't).
        if cust_ids:
            counts["ledger_entries"] += db.query(LedgerEntry).filter(
                LedgerEntry.customer_id.in_(cust_ids)
            ).delete(synchronize_session=False)
        for model in (Income, Expense, Item, RecurringExpense, Customer, AiDecision):
            counts[model.__tablename__] += db.query(model).filter(
                model.business_id.in_(biz_ids)
            ).delete(synchronize_session=False)
        counts["business_members"] += db.query(BusinessMember).filter(
            BusinessMember.business_id.in_(biz_ids)
        ).delete(synchronize_session=False)
        counts["businesses"] += db.query(Business).filter(
            Business.id.in_(biz_ids)
        ).delete(synchronize_session=False)

    # The user's memberships in OTHER people's businesses, and their feedback.
    counts["business_members"] += db.query(BusinessMember).filter(
        BusinessMember.user_id == user.id
    ).delete(synchronize_session=False)
    counts["feedback"] += db.query(Feedback).filter(
        Feedback.user_id == user.id
    ).delete(synchronize_session=False)

    # Record the deletion (no PII) BEFORE removing the user row.
    mobile = user.mobile or ""
    masked = f"***{mobile[-4:]}" if len(mobile) >= 4 else "***"
    db.add(AccountDeletionLog(
        user_id=user.id,
        mobile_masked=masked,
        counts_json=json.dumps(dict(counts)),
    ))

    counts["users"] += db.query(User).filter(
        User.id == user.id
    ).delete(synchronize_session=False)

    db.commit()
    return {"deleted": True, "counts": dict(counts)}
