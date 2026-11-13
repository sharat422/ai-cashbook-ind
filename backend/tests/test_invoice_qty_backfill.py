"""G6: scripts/backfill_invoice_qty_uqc.py fills quantity/UQC on GST invoices
saved before they were asked for, from the catalogue, never inventing one.
No amount, tax or invoice number changes; safe to run twice.

The test database lives for the whole session, so each test checks its own
invoices, not the script's global counts."""

import importlib.util
from pathlib import Path

from sqlalchemy import select

from app.database import SessionLocal
from app.gst import uqc_for_unit
from app.models import LedgerEntry
from helpers import add_customer
from test_gst import _gst_owner, _sale
from test_items import _make_item

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "backfill_invoice_qty_uqc.py"
spec = importlib.util.spec_from_file_location("backfill_qty", SCRIPT)
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)


def _old_invoice(client, owner, cid, key, amount, hsn="3401", rate="18"):
    """A GST sale as saved before quantity/UQC existed."""
    r = _sale(client, owner.headers, cid, key, amount=amount, rate=rate, hsn_code=hsn)
    assert r.status_code == 200, r.text
    with SessionLocal() as db:
        e = db.get(LedgerEntry, r.json()["id"])
        e.gst_quantity = e.gst_uqc = None
        db.commit()
    return r.json()["id"]


def _snapshot():
    with SessionLocal() as db:
        return sorted((e.id, e.amount, e.taxable_value, e.cgst, e.sgst, e.igst, e.invoice_number,
                       e.gst_quantity, e.gst_uqc) for e in db.scalars(select(LedgerEntry)))


def _run():
    with SessionLocal() as db:
        return script.backfill(db)


def _line(entry_id):
    with SessionLocal() as db:
        e = db.get(LedgerEntry, entry_id)
        return e.gst_quantity, e.gst_uqc, e.invoice_number, e.amount


def test_an_old_line_gets_quantity_and_uqc_from_its_item(make_user, client):
    owner = _gst_owner(make_user, client)
    _make_item(client, owner.headers, name="Soap", unit="PCS", sale_price=100, hsn_sac="3401", gst_rate=18)
    cid = add_customer(client, owner.headers)["id"]
    old = _old_invoice(client, owner, cid, "o1", amount=500)
    number, amount = _line(old)[2:]
    out = _run()
    assert out["fixed"] >= 1 and old not in {b["entryId"] for b in out["blank"]}
    q, uqc, number_after, amount_after = _line(old)
    assert (q, uqc) == (5, "PCS")
    assert (number_after, amount_after) == (number, amount)  # no amount or number changes


def test_a_price_that_does_not_divide_evenly_stays_blank_and_is_counted(make_user, client):
    owner = _gst_owner(make_user, client)
    _make_item(client, owner.headers, name="Soap", unit="PCS", sale_price=120, hsn_sac="3401", gst_rate=18)
    _make_item(client, owner.headers, name="Oil A", unit="ltr", sale_price=100, hsn_sac="1512", gst_rate=5)
    _make_item(client, owner.headers, name="Oil B", unit="ltr", sale_price=200, hsn_sac="1512", gst_rate=5)
    cid = add_customer(client, owner.headers)["id"]
    uneven = _old_invoice(client, owner, cid, "o1", amount=500)              # 500 ÷ 120
    unknown = _old_invoice(client, owner, cid, "o2", amount=400, hsn="1512", rate="5")  # two oils
    out = _run()
    whys = {b["entryId"]: b["why"] for b in out["blank"]}
    assert whys[uneven] == "the price doesn't divide by the item's sale price"
    assert whys[unknown] == "2 catalogue items share this HSN and rate"
    assert _line(uneven)[:2] == (None, "PCS")  # the unit is known; the quantity isn't invented
    assert _line(unknown)[:2] == (None, None)  # which oil? not guessed
    mine = [b for b in out["blank"] if b["entryId"] in (uneven, unknown)]
    assert {b["invoiceNumber"] for b in mine} == {_line(uneven)[2], _line(unknown)[2]}  # listed by number


def test_running_it_twice_changes_nothing_the_second_time(make_user, client):
    owner = _gst_owner(make_user, client)
    _make_item(client, owner.headers, name="Soap", unit="PCS", sale_price=100, hsn_sac="3401", gst_rate=18)
    cid = add_customer(client, owner.headers)["id"]
    whole = _old_invoice(client, owner, cid, "o1", amount=500)
    half = _old_invoice(client, owner, cid, "o2", amount=450)  # 4.5: stays blank
    _run()
    assert _line(whole)[:2] == (5, "PCS") and _line(half)[:2] == (None, "PCS")  # o2 still gets its unit
    after_first = _snapshot()
    second = _run()
    assert second["fixed"] == 0 and half in {b["entryId"] for b in second["blank"]}
    assert _snapshot() == after_first  # no amount, tax, number or line changes


def test_catalogue_units_map_to_uqc_like_the_phone():
    assert [uqc_for_unit(u) for u in ("PCS", "bag", "kg", "Litre", "pkt.", "BOX", "heap", None)] == \
        ["PCS", "BAG", "KGS", "LTR", "PAC", "BOX", None, None]
