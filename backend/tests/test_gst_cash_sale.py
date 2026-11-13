"""G7: a GST invoice on a cash sale. It's the same invoice (fields, number,
exports) as a credit GST invoice, paid in full at once by a linked cash
payment, so it's never debt: not in ageing, collections or the daily close."""

import io

from openpyxl import load_workbook

from app import gst
from app.database import SessionLocal
from app.models import GstInvoiceNumber
from conftest import days_ago_iso, today_iso
from helpers import add_customer
from test_gst import API, KA, _book, _gst_owner, _sale


def _cash_sale(client, headers, cid, key, amount=1180, rate="18", **extra):
    return _sale(client, headers, cid, key, amount=amount, rate=rate, price_includes_gst="true",
                 paid_now="true", **extra)


def test_a_cash_sale_is_an_invoice_with_the_next_number_and_in_gstr1(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    fy = gst.financial_year(today_iso())
    # A registered buyer, so the GSTR-1 file lists each invoice (B2B) by number.
    assert _sale(client, owner.headers, cid, "c1", customer_gstin=KA).json()["invoice_number"] == f"{fy}/00001"
    r = _cash_sale(client, owner.headers, cid, "s1", customer_gstin=KA)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["invoice_number"] == f"{fy}/00002"
    assert (inv["gst"]["taxable_value"], inv["gst"]["cgst"], inv["gst"]["sgst"]) == ("1000.00", "90.00", "90.00")
    # Paid in full at once: the balance only carries the earlier credit sale.
    ledger = client.get(f"{API}/customers/{cid}/ledger", headers=owner.headers).json()
    entries = ledger["items"] if isinstance(ledger, dict) else ledger
    [pay] = [e for e in entries if e.get("paid_entry_id") == inv["id"]]
    assert (pay["type"], pay["payment_method"], float(pay["amount"])) == ("payment", "cash", 1180)
    cust = client.get(f"{API}/customers/{cid}", headers=owner.headers).json()
    assert float(cust.get("outstanding_amount", cust.get("outstandingAmount"))) == 1180  # the c1 credit only
    # In the GSTR-1-ready file exactly like a credit invoice.
    wb = load_workbook(io.BytesIO(_book(client, owner.headers, "gstr1.xlsx").content))
    cells = {str(c.value) for ws in wb.worksheets for row in ws.iter_rows() for c in row if c.value is not None}
    assert f"{fy}/00002" in cells and f"{fy}/00001" in cells
    # A retry returns the same invoice and adds no second payment.
    again = _cash_sale(client, owner.headers, cid, "s1", customer_gstin=KA).json()
    assert again["id"] == inv["id"]
    ledger = client.get(f"{API}/customers/{cid}/ledger", headers=owner.headers).json()
    entries = ledger["items"] if isinstance(ledger, dict) else ledger
    assert sum(1 for e in entries if e.get("paid_entry_id") == inv["id"]) == 1


def test_a_cash_sale_is_not_in_ageing_collections_or_the_daily_close(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    old = client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
        "type": "credit", "amount": "5000", "date": days_ago_iso(40), "client_id": "old"})
    assert old.status_code == 200
    before = client.get(f"{API}/daily-close", headers=owner.headers, params={"date": today_iso()}).json()
    assert _cash_sale(client, owner.headers, cid, "s1").status_code == 200
    # Ageing: the old ₹5,000 is still 31-60 days, not paid down by the cash sale.
    aging = client.get(f"{API}/customer-aging", headers=owner.headers).json()["buckets"]
    assert (aging["d31_60"], aging["current"]) == (5000, 0)
    # Not a collection to find in the bank, nor credit given or collected today.
    ex = client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()
    assert ex["collections"] == [] and ex["missingUtr"] == []
    close = client.get(f"{API}/daily-close", headers=owner.headers, params={"date": today_iso()}).json()
    for k in ("creditGiven", "creditCollected", "cashInHand", "difference"):
        assert close[k] == before[k], k
    assert close["collections"] == []


def test_numbers_stay_consecutive_across_cash_and_credit_and_are_never_reused(make_user, client):
    owner = _gst_owner(make_user, client)
    fy = gst.financial_year(today_iso())
    gone = add_customer(client, owner.headers)["id"]
    cid = add_customer(client, owner.headers)["id"]
    nums = [_sale(client, owner.headers, cid, "a").json()["invoice_number"],
            _cash_sale(client, owner.headers, gone, "b").json()["invoice_number"],
            _cash_sale(client, owner.headers, cid, "c").json()["invoice_number"],
            _sale(client, owner.headers, cid, "d").json()["invoice_number"]]
    assert nums == [f"{fy}/0000{i}" for i in range(1, 5)]
    assert client.delete(f"{API}/customers/{gone}", headers=owner.headers).status_code == 204  # deletes #2
    assert _cash_sale(client, owner.headers, cid, "e").json()["invoice_number"] == f"{fy}/00005"
    with SessionLocal() as db:
        rows = db.query(GstInvoiceNumber).filter_by(business_id=owner.business["id"]).all()
        assert sorted((r.serial, r.ledger_entry_id is None) for r in rows) == \
            [(1, False), (2, True), (3, False), (4, False), (5, False)]


def test_only_a_gst_invoice_can_be_paid_now(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    r = client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
        "type": "credit", "amount": "500", "date": today_iso(), "client_id": "p", "paid_now": "true"})
    assert r.status_code == 422
