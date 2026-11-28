"""Owner corrections to an income or expense: edited or deleted in place, every
change in the audit log (AccessLog, in the owner's data export). Not reversal
rows: every reader of incomes and expenses (Reports, Dashboard, Business summary,
Ask AI, exports) sums the tables as they are, so a fix is right everywhere at once.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AccessLog, Business, DiscardedEntry, Expense, Income, User


def owned(db: Session, model: type[Income] | type[Expense], business: Business, entry_id: str):
    row = db.get(model, entry_id)
    if row is None or row.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} not found.")
    return row


def what(row: Income | Expense) -> str:
    vendor = getattr(row, "vendor", None)
    return " · ".join(x for x in (row.date, row.category, vendor, f"₹{row.amount:,.2f}") if x)


def _audit(db: Session, business: Business, user: User, action: str, method: str, text: str) -> None:
    db.add(AccessLog(business_id=business.id, user_id=user.id, mobile=user.mobile, action=action,
                     method=method, path=text[:300]))


def edit(db: Session, business: Business, user: User, row: Income | Expense, new: dict) -> None:
    """Apply the validated fields that differ, with one audit row; nothing changed, nothing logged.
    Notes are encrypted at rest: the log says they changed, never what they say."""
    changed = {k: v for k, v in new.items() if getattr(row, k) != v}
    if not changed:
        return
    show = lambda k, v: f"₹{v:,.2f}" if k == "amount" else (v or "—")  # noqa: E731
    parts = [f"{k} {show(k, getattr(row, k))} → {show(k, v)}" for k, v in changed.items() if k != "notes"]
    if "notes" in changed:
        parts.append("notes changed")
    kind = type(row).__name__.lower()
    was = what(row)
    for k, v in changed.items():
        setattr(row, k, v)
    _audit(db, business, user, "edit", "PATCH", f"Edited {kind} {was}: {'; '.join(parts)} ({row.id})")


def delete(db: Session, business: Business, user: User, row: Income | Expense, why: str = "") -> None:
    """Delete with an audit row. Its client id is kept, so a late retry of the same
    entry (another copy of the phone's queue) is refused instead of re-created."""
    kind = type(row).__name__.lower()
    if row.client_id and db.scalars(select(DiscardedEntry.id).where(
            DiscardedEntry.business_id == business.id, DiscardedEntry.client_id == row.client_id)).first() is None:
        db.add(DiscardedEntry(business_id=business.id, client_id=row.client_id, kind=kind, amount=row.amount,
                              summary=f"Deleted after sync: {what(row)}"[:200], discarded_by=user.id))
    _audit(db, business, user, "delete", "DELETE", f"Deleted {kind} {what(row)}{why} ({row.id})")
    db.delete(row)
