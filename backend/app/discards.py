"""IM5: a queued entry the owner discarded never gets created, even if a copy of
it is retried later. Every create path that takes a client id calls this after
its "already saved?" check (an entry already on the server can't be discarded)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import AppError
from .models import DiscardedEntry


def refuse_if_discarded(db: Session, business_id: str, client_id: str | None) -> None:
    if client_id and db.scalars(select(DiscardedEntry.id).where(
            DiscardedEntry.business_id == business_id, DiscardedEntry.client_id == client_id)).first():
        raise AppError(410, "entry_discarded", "The owner discarded this entry on the phone, so it isn't saved.")
