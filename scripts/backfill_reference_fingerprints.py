"""One-off: give bank-transfer and cheque payments saved before the duplicate
warning existed the same reference fingerprint new payments get, so the
warning also compares against them.

  cd backend && .venv/Scripts/python.exe ../scripts/backfill_reference_fingerprints.py

Uses the server's DATABASE_URL (backend/.env). Run by hand, once; running it
again finds nothing to do. It only fills ledger_entries.ref_hash: no amount
changes, nothing is deleted, nothing is marked. Payments with no reference
stored are left alone and counted, never guessed. UPI is not touched (its
UTR rule is separate). Cheques saved before bank/account were asked for are
fingerprinted on their number alone, so they match only a later cheque
entered without bank and account.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.models import Customer, LedgerEntry  # noqa: E402
from app.routers.customers import _ref_key  # noqa: E402  (the warning's own rule)


def backfill(db: Session) -> dict:
    """Fingerprint old bank/cheque payments; return the counts and the
    repeated references among the ones fingerprinted now."""
    # payment_method is encrypted, so the bank/cheque filter runs here, not in SQL.
    # ponytail: loads every unfingerprinted payment at once; batch with yield_per past ~1M rows.
    rows = db.execute(
        select(LedgerEntry, Customer).join(Customer, Customer.id == LedgerEntry.customer_id)
        .where(LedgerEntry.type == "payment", LedgerEntry.ref_hash.is_(None))).all()
    done, skipped = [], 0
    for e, c in rows:
        method = (e.payment_method or "").lower()
        if method not in ("bank", "cheque"):
            continue
        key = _ref_key(method, e.reference_number, e.cheque_bank, e.cheque_account)
        if key is None:  # no reference stored
            skipped += 1
            continue
        e.ref_hash = key
        done.append((c.business_id, key))
    db.flush()

    duplicates = []
    for business_id, key in dict.fromkeys(done):  # each repeated reference once
        same = db.execute(
            select(LedgerEntry, Customer).join(Customer, Customer.id == LedgerEntry.customer_id)
            .where(Customer.business_id == business_id, LedgerEntry.ref_hash == key)
            .order_by(LedgerEntry.created_at)).all()
        if len(same) > 1:
            duplicates.append([{"entryId": e.id, "reference": e.reference_number, "customer": c.full_name,
                                "amount": f"{e.amount:.2f}", "date": e.date} for e, c in same])
    db.commit()
    return {"fingerprinted": len(done), "skipped": skipped, "duplicates": duplicates}


def main() -> None:
    from app.database import SessionLocal
    with SessionLocal() as db:
        out = backfill(db)
    print(f"Fingerprinted: {out['fingerprinted']}")
    print(f"Skipped (no reference stored): {out['skipped']}")
    print(f"Repeated references found: {len(out['duplicates'])}")
    for group in out["duplicates"]:
        print("  " + " | ".join(f"{d['reference']} · {d['customer']} · ₹{d['amount']} · {d['date']}" for d in group))


if __name__ == "__main__":
    main()
