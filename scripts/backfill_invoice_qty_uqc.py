"""One-off: fill quantity and UQC on GST invoices saved before they were
asked for, from the item catalogue, without inventing anything.

  cd backend && .venv/Scripts/python.exe ../scripts/backfill_invoice_qty_uqc.py

Uses the server's DATABASE_URL (backend/.env). Run by hand, once; running it
again changes nothing. It only fills an empty gst_quantity / gst_uqc: no
amount, tax or invoice number changes.

Old sales don't record which item was sold, so the item counts as known only
when exactly one product in the business's catalogue has the invoice's HSN
and GST rate. Then:
  - UQC = the item's unit, when that unit is a UQC (bag → BAG, kg → KGS);
  - quantity = the price the owner entered ÷ the item's sale price, only when
    it comes out a whole number. The price entered is the taxable value, or
    the invoice total when the invoice was entered GST-inclusive.
Anything it can't derive stays blank, is listed with its reason, and keeps
a blank unit in the GSTR-1 HSN sheet for the CA to fill.
"""
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import or_, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.gst import uqc_for_unit  # noqa: E402
from app.models import Customer, Item, LedgerEntry  # noqa: E402


def _quantity(entry: LedgerEntry, item: Item) -> Decimal | None:
    if not item.sale_price or item.sale_price <= 0:
        return None
    entered = Decimal(str(entry.amount)) if entry.price_includes_gst else entry.taxable_value
    if entered is None:
        return None
    q = Decimal(str(entered)) / Decimal(str(item.sale_price))
    return q if q > 0 and q == q.to_integral_value() else None


def backfill(db: Session) -> dict:
    """Fill what can be derived; return the counts and what's still blank."""
    rows = db.execute(
        select(LedgerEntry, Customer).join(Customer, Customer.id == LedgerEntry.customer_id)
        .where(LedgerEntry.type == "credit", LedgerEntry.gst_rate.is_not(None),
               ~LedgerEntry.gst_lines.any(),  # several items: quantity and unit are per item, never blank
               or_(LedgerEntry.gst_quantity.is_(None), LedgerEntry.gst_uqc.is_(None)))
        .order_by(LedgerEntry.date, LedgerEntry.created_at)).all()
    catalogue: dict[str, list[Item]] = {}
    fixed, blank = 0, []
    for e, c in rows:
        if c.business_id not in catalogue:
            catalogue[c.business_id] = list(db.scalars(select(Item).where(
                Item.business_id == c.business_id, Item.type == "product")))
        hsn = "".join(ch for ch in (e.hsn_code or "") if ch.isdigit())
        same = [i for i in catalogue[c.business_id]
                if "".join(ch for ch in (i.hsn_sac or "") if ch.isdigit()) == hsn
                and Decimal(str(i.gst_rate)) == Decimal(e.gst_rate)]
        item = same[0] if hsn and len(same) == 1 else None
        changed = False
        if item and e.gst_uqc is None and (code := uqc_for_unit(item.unit)):
            e.gst_uqc, changed = code, True
        if item and e.gst_quantity is None and (q := _quantity(e, item)) is not None:
            e.gst_quantity, changed = q, True
        fixed += changed
        if e.gst_uqc is None or e.gst_quantity is None:
            if not hsn or not same:
                why = "no catalogue item with this HSN and rate"
            elif len(same) > 1:
                why = f"{len(same)} catalogue items share this HSN and rate"
            elif e.gst_uqc is None:
                why = f"the item's unit ({item.unit or 'none'}) isn't a UQC"
            elif not item.sale_price:
                why = "the item has no sale price"
            else:
                why = "the price doesn't divide by the item's sale price"
            blank.append({"entryId": e.id, "invoiceNumber": e.invoice_number, "customer": c.full_name,
                          "date": e.date, "hsn": e.hsn_code, "item": item.name if item else None, "why": why})
    db.commit()
    return {"fixed": fixed, "blank": blank}


def main() -> None:
    from app.database import SessionLocal
    with SessionLocal() as db:
        out = backfill(db)
    print(f"Lines fixed: {out['fixed']}")
    print(f"Lines still blank (the CA fills these in the HSN sheet): {len(out['blank'])}")
    for b in out["blank"]:
        print(f"  {b['invoiceNumber'] or '(no number)'} · {b['date']} · {b['customer']} · HSN {b['hsn']}"
              f" · {b['item'] or 'item not known'} · {b['why']}")


if __name__ == "__main__":
    main()
