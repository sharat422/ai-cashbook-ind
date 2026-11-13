"""G8: GST credit notes (returns, discounts), Table 9B and Table 13.
The invoice is never edited; a registered buyer's credit note reduces the
GSTR-3B tax only once their ITC reversal is confirmed (proviso to s.34(2))."""

import io

from openpyxl import load_workbook

from app import gst
from app.database import SessionLocal
from app.models import LedgerEntry
from conftest import today_iso
from helpers import add_customer
from test_gst import API, KA, _gst_owner, _sale


def _note(client, headers, invoice_id, key, amount, reason="return", **extra):
    return client.post(f"{API}/gst/credit-notes", headers=headers, json={
        "clientId": key, "invoiceId": invoice_id, "reason": reason, "amount": str(amount),
        "date": extra.pop("date", today_iso()), **extra})


def _sheets(client, headers, path, start=None, end=None):
    r = client.get(f"{API}/reports/{path}", headers=headers,
                   params={"from": start or today_iso(), "to": end or today_iso()})
    assert r.status_code == 200, r.text
    wb = load_workbook(io.BytesIO(r.content))
    return {ws.title: [list(row) for row in ws.iter_rows(min_row=2, values_only=True)] for ws in wb.worksheets}


def _balance(client, headers, cid):
    c = client.get(f"{API}/customers/{cid}", headers=headers).json()
    return float(c.get("outstanding_amount", c.get("outstandingAmount")))


def test_a_return_reduces_table_9b_and_the_balance_and_leaves_the_invoice_alone(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    inv = _sale(client, owner.headers, cid, "i1", amount=1000, rate="18", customer_gstin=KA,
                quantity="10").json()  # ₹1,000 + ₹180
    with SessionLocal() as db:
        before = {k: getattr(db.get(LedgerEntry, inv["id"]), k)
                  for k in ("amount", "taxable_value", "cgst", "sgst", "invoice_number")}
    assert _balance(client, owner.headers, cid) == 1180

    r = _note(client, owner.headers, inv["id"], "n1", 300, quantity="3")  # 3 of 10 came back
    assert r.status_code == 200, r.text
    note = r.json()
    fy = gst.financial_year(today_iso())
    assert note["number"] == f"CN{fy}/00001"
    assert (note["taxableValue"], note["cgst"], note["sgst"], note["total"]) == ("300.00", "27.00", "27.00", "354.00")
    assert note["invoiceNumber"] == inv["invoice_number"] and note["buyerRegistered"] is True

    assert _balance(client, owner.headers, cid) == 826  # 1,180 − 354
    with SessionLocal() as db:  # the invoice itself is untouched
        assert {k: getattr(db.get(LedgerEntry, inv["id"]), k) for k in before} == before
    gstr1 = _sheets(client, owner.headers, "gstr1.xlsx")
    [row] = gstr1["cdnr"]
    assert (row[0], row[2], row[4], float(row[8]), float(row[11])) == (KA, note["number"], "C", 354, 300)
    # Not a collection, not in the daily close.
    ex = client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()
    assert ex["collections"] == []
    close = client.get(f"{API}/daily-close", headers=owner.headers, params={"date": today_iso()}).json()
    assert close["creditCollected"] == "0.00"
    # Can't credit more than is left on the invoice.
    too_much = _note(client, owner.headers, inv["id"], "n2", 701)
    assert too_much.status_code == 422 and "700.00" in too_much.json()["detail"]
    # A retry returns the same note, no second number.
    assert _note(client, owner.headers, inv["id"], "n1", 300).json()["id"] == note["id"]


def test_a_discount_note_reduces_3b_only_once_the_buyer_reverses_itc(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    inv = _sale(client, owner.headers, cid, "i1", amount=1000, rate="18", customer_gstin=KA).json()
    note = _note(client, owner.headers, inv["id"], "d1", 100, reason="discount").json()
    assert note["buyerItcReversed"] is False and note["reducesTax"] is False

    def outward():
        return _sheets(client, owner.headers, "gstr3b-summary.xlsx")["3.1 Outward supplies"][0]

    gstr1 = _sheets(client, owner.headers, "gstr1.xlsx")
    assert [r[2] for r in gstr1["cdnr"]] == [note["number"]]  # in Table 9B either way
    row = outward()
    assert (float(row[1]), float(row[3]), float(row[4])) == (1000, 90, 90)  # not reduced yet
    assert [r[0] for r in _sheets(client, owner.headers, "gstr3b-summary.xlsx")["Credit notes pending ITC"]] \
        == [note["number"]]

    r = client.patch(f"{API}/gst/credit-notes/{note['id']}", headers=owner.headers, json={"buyerItcReversed": True})
    assert r.status_code == 200 and r.json()["reducesTax"] is True
    row = outward()
    assert (float(row[1]), float(row[3]), float(row[4])) == (900, 81, 81)
    assert _sheets(client, owner.headers, "gstr3b-summary.xlsx")["Credit notes pending ITC"] == []


def test_a_deleted_invoice_number_is_listed_cancelled_in_table_13_in_order(make_user, client):
    owner = _gst_owner(make_user, client)
    fy = gst.financial_year(today_iso())
    keep = add_customer(client, owner.headers)["id"]
    gone = add_customer(client, owner.headers)["id"]
    _sale(client, owner.headers, keep, "a")
    _sale(client, owner.headers, gone, "b")
    _sale(client, owner.headers, keep, "c")
    assert client.delete(f"{API}/customers/{gone}", headers=owner.headers).status_code == 204
    assert _sale(client, owner.headers, keep, "d").json()["invoice_number"] == f"{fy}/00004"  # never reused
    gstr1 = _sheets(client, owner.headers, "gstr1.xlsx")
    assert gstr1["docs"] == [["Invoices for outward supply", f"{fy}/00001", f"{fy}/00004", 4, 1]]
    assert [r[1:] for r in gstr1["docs (cancelled)"]] == [
        [f"{fy}/00001", "Issued"], [f"{fy}/00002", "Cancelled"], [f"{fy}/00003", "Issued"], [f"{fy}/00004", "Issued"]]


def test_a_note_after_30_november_following_the_fy_is_refused(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    inv = _sale(client, owner.headers, cid, "old", amount=1000, rate="12", date="2025-03-31").json()  # FY 24-25
    late = _note(client, owner.headers, inv["id"], "late", 100, date="2025-12-01")
    assert late.status_code == 422 and "30 Nov 2025" in late.json()["detail"]
    on_time = _note(client, owner.headers, inv["id"], "ok", 100, date="2025-11-30")
    assert on_time.status_code == 200, on_time.text
    assert on_time.json()["rate"] == "12"  # at the invoice's own rate


def test_unregistered_buyers_and_permissions(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    inv = _sale(client, owner.headers, cid, "i1", amount=1000, rate="18").json()  # B2C small
    note = _note(client, owner.headers, inv["id"], "u1", 200).json()
    assert note["buyerRegistered"] is False and note["reducesTax"] is True  # no ITC to reverse
    assert client.patch(f"{API}/gst/credit-notes/{note['id']}", headers=owner.headers,
                        json={"buyerItcReversed": True}).status_code == 422
    gstr1 = _sheets(client, owner.headers, "gstr1.xlsx")
    assert gstr1["cdnr"] == [] and gstr1["cdnur"] == []
    assert float(gstr1["b2cs"][0][4]) == 800  # netted off the B2C small row
    assert client.post(f"{API}/gst/credit-notes", headers=owner.headers, json={
        "clientId": "x", "invoiceId": "nope", "reason": "return", "amount": "1",
        "date": today_iso()}).status_code == 404
    assert _note(client, owner.headers, inv["id"], "bad", 1, reason="whim").status_code == 422
