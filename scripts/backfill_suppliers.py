"""One-off: build the supplier list from the names typed on purchases saved
before it existed, and link each purchase to its supplier.

  cd backend && .venv/Scripts/python.exe ../scripts/backfill_suppliers.py

Uses the server's DATABASE_URL (backend/.env). Run by hand, once; running it
again changes nothing. Names are matched as the same spelling only (case and
spaces ignored): "Sharma Traders" and "Sharma Trader" stay two suppliers for
the owner to merge by hand. It doesn't create expenses for old purchases.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.models import StockMove, Supplier, supplier_key  # noqa: E402


def backfill(db: Session) -> dict:
    rows = db.scalars(select(StockMove).where(
        StockMove.kind == "purchase", StockMove.supplier_id.is_(None), StockMove.supplier.is_not(None))
        .order_by(StockMove.created_at)).all()
    created, linked = [], 0
    known: dict[tuple[str, str], Supplier] = {
        (s.business_id, s.name_key): s for s in db.scalars(select(Supplier))}
    for m in rows:
        name = " ".join(m.supplier.split())
        if not name:
            continue
        key = (m.business_id, supplier_key(name))
        s = known.get(key)
        if s is None:
            s = Supplier(business_id=m.business_id, name=name, name_key=key[1], gstin=m.supplier_gstin)
            db.add(s)
            db.flush()
            known[key] = s
            created.append(name)
        m.supplier_id = s.id
        linked += 1
    db.commit()
    return {"suppliersCreated": created, "purchasesLinked": linked}


def main() -> None:
    from app.database import SessionLocal
    with SessionLocal() as db:
        out = backfill(db)
    print(f"Purchases linked to a supplier: {out['purchasesLinked']}")
    print(f"Suppliers created: {len(out['suppliersCreated'])}")
    for name in out["suppliersCreated"]:
        print(f"  {name}")
    print("Names that differ by more than case or spaces are separate suppliers; merge them by hand.")


if __name__ == "__main__":
    main()
