"""User account self-service: permanent account deletion.

``DELETE /api/v1/users/me`` lets the authenticated caller erase their own
account and personal data. This satisfies the Play Store "account deletion"
requirement and India's DPDP Act right to erasure.

Deletion policy (hard delete — this is the caller's own personal financial
data, so nothing is merely anonymized):

* Businesses OWNED by the caller (``business.user_id == user.id``) are
  deleted together with everything under them: incomes, expenses, recurring
  expenses, customers (+ their ledger entries), items, feedback, and AI
  decisions.
* The caller's ``BusinessMember`` rows are deleted EVERYWHERE — including
  memberships in other owners' businesses. Those other businesses themselves
  are NOT touched (they belong to someone else); only the caller's
  membership row is removed.
* ``Feedback`` rows filed by the caller are deleted.
* Finally the ``User`` row itself is deleted.

Deletes are explicit and ordered (children before parents) rather than
relying on DB-level ``ON DELETE CASCADE``, because SQLite does not enforce
foreign-key cascades unless ``PRAGMA foreign_keys=ON`` (and ``database.py``
does not enable it). On Postgres the explicit deletes are simply redundant
with the cascades — same end state either way.

Clients MUST confirm (typed confirmation) and re-authenticate the user
before calling this endpoint; the operation is irreversible. Returns
``204 No Content`` with an empty body.
"""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
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
)
from ..security import get_current_user

router = APIRouter(tags=["users"])


@router.delete("/users/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_account(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    # 1. Businesses owned by the caller, and everything under them.
    owned_ids = db.scalars(
        select(Business.id).where(Business.user_id == user.id)
    ).all()
    if owned_ids:
        for model in (Income, Expense, RecurringExpense, Item, AiDecision):
            db.execute(delete(model).where(model.business_id.in_(owned_ids)))
        customer_ids = db.scalars(
            select(Customer.id).where(Customer.business_id.in_(owned_ids))
        ).all()
        if customer_ids:
            db.execute(
                delete(LedgerEntry).where(LedgerEntry.customer_id.in_(customer_ids))
            )
        db.execute(delete(Customer).where(Customer.business_id.in_(owned_ids)))
        db.execute(delete(Feedback).where(Feedback.business_id.in_(owned_ids)))
        db.execute(delete(Business).where(Business.id.in_(owned_ids)))

    # 2. The caller's memberships everywhere (other owners' businesses stay).
    db.execute(delete(BusinessMember).where(BusinessMember.user_id == user.id))

    # 3. Feedback filed by the caller.
    db.execute(delete(Feedback).where(Feedback.user_id == user.id))

    # 4. The user row itself.
    db.execute(delete(User).where(User.id == user.id))

    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
