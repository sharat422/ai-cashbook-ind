"""G10: GST invoice drafts. A draft has no number, can be edited and deleted,
and isn't in the books or the exports. Issuing numbers it (the same
allocation) and locks it; an issued invoice is only cancelled or credited."""

from app import gst
from app.database import SessionLocal
from app.models import GstInvoiceNumber
from conftest import today_iso
from helpers import add_customer
from test_credit_notes import _balance, _note, _sheets
from test_gst import API, KA, _gst_owner, _sale


def _draft(client, headers, cid, key, amount=1000, **extra):
    r = _sale(client, headers, cid, key, amount=amount, rate="18", customer_gstin=KA, draft="true", **extra)
    assert r.status_code == 200, r.text
    return r.json()


def _issue(client, headers, cid, entry_id):
    return client.post(f"{API}/customers/{cid}/ledger/{entry_id}/issue", headers=headers)


def _edit(client, headers, cid, entry_id, amount):
    return client.put(f"{API}/customers/{cid}/ledger/{entry_id}", headers=headers, data={
        "amount": str(amount), "date": today_iso(), "gst_rate": "18", "hsn_code": "1006",
        "quantity": "10", "uqc": "BAG", "customer_gstin": KA})


def _numbers(owner):
    with SessionLocal() as db:
        return sorted((r.number, r.ledger_entry_id is None) for r in
                      db.query(GstInvoiceNumber).filter_by(business_id=owner.business["id"]).all())


def test_a_draft_is_edited_and_deleted_without_ever_taking_a_number(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    d = _draft(client, owner.headers, cid, "d1")
    assert (d["gst_status"], d["invoice_number"]) == ("draft", None)
    assert _balance(client, owner.headers, cid) == 0  # not in the books
    edited = _edit(client, owner.headers, cid, d["id"], 2000)
    assert edited.status_code == 200 and edited.json()["gst"]["taxable_value"] == "2000.00"
    assert edited.json()["invoice_number"] is None
    gstr1 = _sheets(client, owner.headers, "gstr1.xlsx")
    assert gstr1["b2b"] == [] and gstr1["docs"] == [] and gstr1["docs (cancelled)"] == []
    assert client.delete(f"{API}/customers/{cid}/ledger/{d['id']}", headers=owner.headers).status_code == 204
    assert _numbers(owner) == []  # no trace in Table 13
    fy = gst.financial_year(today_iso())
    assert _sale(client, owner.headers, cid, "s1").json()["invoice_number"] == f"{fy}/00001"


def test_issuing_two_drafts_gives_two_consecutive_numbers_once_each(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    a, b = _draft(client, owner.headers, cid, "a"), _draft(client, owner.headers, cid, "b")
    fy = gst.financial_year(today_iso())
    ia, ib = _issue(client, owner.headers, cid, a["id"]).json(), _issue(client, owner.headers, cid, b["id"]).json()
    assert (ia["invoice_number"], ib["invoice_number"]) == (f"{fy}/00001", f"{fy}/00002")
    assert ia["gst_status"] == ib["gst_status"] == "issued"
    # Issuing again (a retry) changes nothing and allocates nothing.
    assert _issue(client, owner.headers, cid, a["id"]).json()["invoice_number"] == f"{fy}/00001"
    assert _numbers(owner) == [(f"{fy}/00001", False), (f"{fy}/00002", False)]
    assert _balance(client, owner.headers, cid) == 2360  # both now in the books
    assert [r[2] for r in _sheets(client, owner.headers, "gstr1.xlsx")["b2b"]] == [f"{fy}/00001", f"{fy}/00002"]


def test_an_issued_invoice_is_locked_and_cancelling_keeps_its_number(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    fy = gst.financial_year(today_iso())
    inv = _sale(client, owner.headers, cid, "i1", customer_gstin=KA).json()
    edit = _edit(client, owner.headers, cid, inv["id"], 5)
    assert edit.status_code == 422 and "credit note" in edit.json()["detail"]
    assert client.delete(f"{API}/customers/{cid}/ledger/{inv['id']}", headers=owner.headers).status_code == 422

    r = client.post(f"{API}/customers/{cid}/ledger/{inv['id']}/cancel", headers=owner.headers)
    assert r.status_code == 200 and r.json()["gst_status"] == "cancelled"
    assert r.json()["invoice_number"] == f"{fy}/00001"
    assert _balance(client, owner.headers, cid) == 0
    gstr1 = _sheets(client, owner.headers, "gstr1.xlsx")
    assert gstr1["b2b"] == []  # out of the exports
    assert gstr1["docs (cancelled)"] == [["Invoices for outward supply", f"{fy}/00001", "Cancelled"]]
    assert _sale(client, owner.headers, cid, "i2").json()["invoice_number"] == f"{fy}/00002"  # not reused
    assert _edit(client, owner.headers, cid, inv["id"], 5).status_code == 422
    assert _note(client, owner.headers, inv["id"], "cn", 10).status_code == 404  # no credit note on it


def test_a_cancelled_cash_sale_takes_its_payment_with_it(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    inv = _sale(client, owner.headers, cid, "c1", amount=1180, price_includes_gst="true", paid_now="true").json()
    assert _balance(client, owner.headers, cid) == 0
    client.post(f"{API}/customers/{cid}/ledger/{inv['id']}/cancel", headers=owner.headers)
    assert _balance(client, owner.headers, cid) == 0  # not −₹1,180
    # A credited invoice can't be cancelled; a draft can't be cancelled (delete it).
    credited = _sale(client, owner.headers, cid, "c2").json()
    _note(client, owner.headers, credited["id"], "n", 10)
    assert client.post(f"{API}/customers/{cid}/ledger/{credited['id']}/cancel",
                       headers=owner.headers).status_code == 422
    d = _draft(client, owner.headers, cid, "d")
    assert client.post(f"{API}/customers/{cid}/ledger/{d['id']}/cancel", headers=owner.headers).status_code == 422
