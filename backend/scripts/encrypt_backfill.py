"""Re-encrypt existing rows' sensitive fields.

Field encryption is transparent and backward-compatible: rows written before it
was enabled read back as plaintext and get encrypted the next time they're
saved. This script forces that eagerly so no plaintext lingers.

It reads each row through the ORM (decrypting legacy plaintext) and rewrites the
encrypted fields, so running it more than once is safe. Point DATABASE_URL at
the target DB and run from backend/:

    python -m scripts.encrypt_backfill --yes
"""

import argparse
import sys

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.database import engine
from app.models import Customer, Expense, Income, LedgerEntry

# Model → the EncryptedText fields to rewrite.
_TARGETS = {
    Customer: ["gst_number", "address", "notes"],
    Income: ["notes"],
    Expense: ["notes"],
    LedgerEntry: ["payment_method", "reference_number", "notes"],
}


def backfill(session: Session) -> dict[str, int]:
    counts: dict[str, int] = {}
    for model, fields in _TARGETS.items():
        n = 0
        for row in session.scalars(session.query(model).statement).all():
            touched = False
            for f in fields:
                if getattr(row, f) is not None:
                    flag_modified(row, f)  # force re-encryption on flush
                    touched = True
            if touched:
                n += 1
        counts[model.__name__] = n
    session.commit()
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Re-encrypt sensitive fields")
    parser.add_argument("--yes", action="store_true", help="confirm the write")
    args = parser.parse_args(argv)
    if not args.yes:
        print("This rewrites rows in DATABASE_URL. Re-run with --yes to proceed.")
        return 1
    with Session(engine) as session:
        counts = backfill(session)
    print("Re-encrypted rows:", counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
