"""A closed beat-day is locked: no entry on that beat and date can be added,
changed or deleted until the owner reopens the day (POST /daily-close/{id}/reopen).

One listener on every session flush, so each path that writes a khata entry —
the customer screen, bills, credit notes, offline sync, imports — is covered,
not only the routes someone remembered to guard. An edit counts only when it
changes what the close is worked out from; fixing a note, a UTR or an
attachment on a closed day is still allowed.
"""

from sqlalchemy import and_, event, inspect, or_, select
from sqlalchemy.orm import Session

from .errors import AppError
from .models import Beat, DailyClose, LedgerEntry

# What a close's figures come from (calc.paid_at_sale, in_books, the totals).
_FIGURES = ("customer_id", "type", "amount", "date", "payment_method", "beat_id", "gst_status", "paid_entry_id")


def _was(entry: LedgerEntry, field: str):
    """The value before this flush's change (the current one if unchanged)."""
    old = inspect(entry).attrs[field].history.deleted
    return old[0] if old else getattr(entry, field)


def _days(session: Session) -> set[tuple[str, str]]:
    days: set[tuple] = set()
    for e in session.new:
        if isinstance(e, LedgerEntry):
            days.add((e.beat_id, e.date))
    for e in session.deleted:
        if isinstance(e, LedgerEntry):
            days.add((_was(e, "beat_id"), _was(e, "date")))
    for e in session.dirty:
        if isinstance(e, LedgerEntry) and any(inspect(e).attrs[f].history.has_changes() for f in _FIGURES):
            days |= {(e.beat_id, e.date), (_was(e, "beat_id"), _was(e, "date"))}
    return {(b, d) for b, d in days if b and d}


@event.listens_for(Session, "before_flush")
def _refuse_closed_days(session: Session, _context, _instances) -> None:
    days = _days(session)
    if not days:
        return
    with session.no_autoflush:
        hit = session.execute(
            select(Beat.name, DailyClose.date).join(Beat, Beat.id == DailyClose.beat_id)
            .where(DailyClose.status == "closed",
                   or_(*(and_(DailyClose.beat_id == b, DailyClose.date == d) for b, d in days)))
        ).first()
    if hit:
        raise AppError(400, "day_closed",
                       f"{hit.name} is closed for {hit.date}. Ask the owner to reopen that day to change its entries.",
                       beat=hit.name, date=hit.date)
