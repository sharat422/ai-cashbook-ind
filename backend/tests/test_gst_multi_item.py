"""A GST invoice with several items: each item's tax worked out and rounded on
its own, one invoice number, and every report reading the items (GSTR-1 rate
rows and HSN summary, GSTR-3B, Tally). A credit note names the item it corrects.
One-item invoices are stored and reported exactly as before."""

import csv
import io
import json
from decimal import Decimal as D

from conftest import today_iso
from helpers import add_customer
from test_credit_notes import _note, _sheets
from test_gst import KA, MH, _book, _gst_owner, _sale

API = "/api/v1"

RICE = {"amount": "1000", "rate": "5", "hsn": "1006", "quantity": "10", "uqc": "BAG"}
SOAP = {"amount": "500", "rate": "18", "hsn": "3401", "quantity": "5", "uqc": "PCS"}
RICE2 = {**RICE, "amount": "2000", "quantity": "20"}


def _multi(client, headers, cid, key, lines, **extra):
    data = {"type": "credit", "amount": str(sum(D(x["amount"]) for x in lines)), "date": today_iso(),
            "client_id": key, "lines": json.dumps(lines), **extra}
    return client.post(f"{API}/customers/{cid}/ledger", headers=headers, data=data)


def test_three_items_one_invoice_each_taxed_on_its_own(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    r = _multi(client, owner.headers, cid, "m1", [RICE, SOAP, RICE2], customer_gstin=KA)
    assert r.status_code == 200, r.text
    e = r.json()
    g = e["gst"]
    assert [(x["hsn"], x["rate"], x["quantity"], x["uqc"], x["cgst"]) for x in g["lines"]] == [
        ("1006", "5", "10", "BAG", "25.00"), ("3401", "18", "5", "PCS", "45.00"), ("1006", "5", "20", "BAG", "50.00")]
    assert (g["taxable_value"], g["cgst"], g["sgst"], g["igst"]) == ("3500.00", "120.00", "120.00", "0.00")
    assert e["amount"] == 3740 and e["invoice_number"]  # one number for the whole invoice
    assert g["hsn"] is None and g["quantity"] is None  # per item, not on the invoice
    # Shows in the ledger the same way.
    listed = next(x for x in client.get(f"{API}/customers/{cid}/ledger", headers=owner.headers).json()
                  if x["id"] == e["id"])
    assert len(listed["gst"]["lines"]) == 3

    book = _sheets(client, owner.headers, "gstr1.xlsx")
    # b2b: one row per rate, the invoice value on each.
    assert sorted((r[10], r[11], r[4]) for r in book["b2b"]) == [(5, 3000, 3740), (18, 500, 3740)]
    assert sorted((r[0], r[2], r[3], r[6]) for r in book["hsn(b2b)"]) == [
        ("1006", "BAG-BAGS", 30, 3000), ("3401", "PCS-PIECES", 5, 500)]
    b3 = _sheets(client, owner.headers, "gstr3b-summary.xlsx")["3.1 Outward supplies"][0]
    assert b3[1:5] == [3500, 0, 120, 120]
    tally = list(csv.reader(io.StringIO(_book(client, owner.headers, "tally-export.csv").content.decode("utf-8-sig"))))
    assert [(r[3], r[4], r[8]) for r in tally[1:]] == [
        ("1006", "1000.00", e["invoice_number"]), ("3401", "500.00", e["invoice_number"]),
        ("1006", "2000.00", e["invoice_number"])]


def test_a_bad_item_refuses_the_whole_invoice(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    r = _multi(client, owner.headers, cid, "m2", [RICE, {**SOAP, "uqc": ""}])
    assert r.status_code == 422 and "UQC" in r.json()["detail"]
    r = _multi(client, owner.headers, cid, "m3", [RICE, {**SOAP, "amount": "0"}])
    assert r.status_code == 422
    assert client.get(f"{API}/customers/{cid}/ledger", headers=owner.headers).json() == []
    assert _multi(client, owner.headers, cid, "m4", []).status_code == 422
    bad = client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
        "type": "credit", "amount": "10", "date": today_iso(), "client_id": "m5", "lines": "not json"})
    assert bad.status_code == 422


def test_inter_state_unregistered_and_a_nil_rated_item(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    milk = {"amount": "300", "rate": "0", "hsn": "0401", "quantity": "10", "uqc": "LTR"}
    r = _multi(client, owner.headers, cid, "m6", [SOAP, milk], place_of_supply="Maharashtra")
    assert r.status_code == 200, r.text
    assert (r.json()["gst"]["igst"], r.json()["gst"]["cgst"]) == ("90.00", "0.00")
    b3 = _sheets(client, owner.headers, "gstr3b-summary.xlsx")
    assert b3["3.1 Outward supplies"][0][1:3] == [500, 90]
    assert b3["3.1 Outward supplies"][1][1] == 300  # the 0% item is nil-rated
    assert b3["3.2 Inter-state unregistered"] == [["27-Maharashtra", 500, 90]]
    assert sorted((r[3], r[4]) for r in _sheets(client, owner.headers, "gstr1.xlsx")["b2cs"]) == [(0, 300), (18, 500)]


def test_a_credit_note_names_the_item(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    inv = _multi(client, owner.headers, cid, "m7", [RICE, SOAP], customer_gstin=MH).json()
    r = _note(client, owner.headers, inv["id"], "n1", 100)
    assert r.status_code == 422 and "Pick the item" in r.json()["detail"]
    r = _note(client, owner.headers, inv["id"], "n2", 600, line=2)
    assert r.status_code == 422 and "item 2" in r.json()["detail"] and "500.00" in r.json()["detail"]
    r = _note(client, owner.headers, inv["id"], "n3", 100, line=2, quantity="1")
    assert r.status_code == 200, r.text
    n = r.json()
    assert (n["hsn"], n["rate"], n["uqc"], n["igst"]) == ("3401", "18", "PCS", "18.00")
    # Item 1 still has its own full value to credit.
    assert _note(client, owner.headers, inv["id"], "n4", 1000, line=1).status_code == 200
    assert _note(client, owner.headers, inv["id"], "n5", 1, line=1).status_code == 422
    # A one-item invoice: no item to name (as before), and only item 1 exists.
    one = _sale(client, owner.headers, cid, "m8").json()
    assert _note(client, owner.headers, one["id"], "n6", 10).status_code == 200
    assert _note(client, owner.headers, one["id"], "n7", 10, line=2).status_code == 422


def test_a_draft_with_items_is_edited_then_issued(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    d = _multi(client, owner.headers, cid, "m9", [RICE, SOAP], draft="true").json()
    assert d["gst_status"] == "draft" and len(d["gst"]["lines"]) == 2
    r = client.put(f"{API}/customers/{cid}/ledger/{d['id']}", headers=owner.headers, data={
        "amount": "3500", "date": today_iso(), "lines": json.dumps([RICE, SOAP, RICE2])})
    assert r.status_code == 200, r.text
    assert len(r.json()["gst"]["lines"]) == 3 and r.json()["amount"] == 3740
    # Back to one item: stored on the entry again, no item rows.
    r = client.put(f"{API}/customers/{cid}/ledger/{d['id']}", headers=owner.headers, data={
        "amount": "1000", "date": today_iso(), "gst_rate": "5", "hsn_code": "1006", "quantity": "10", "uqc": "BAG"})
    assert r.json()["gst"]["hsn"] == "1006" and len(r.json()["gst"]["lines"]) == 1
    issued = client.post(f"{API}/customers/{cid}/ledger/{d['id']}/issue", headers=owner.headers).json()
    assert issued["invoice_number"] and issued["gst"]["lines"][0]["cgst"] == "25.00"


def test_the_preview_adds_up_the_items(make_user, client):
    owner = _gst_owner(make_user, client)
    r = client.post(f"{API}/gst/preview", headers=owner.headers, json={
        "amount": 1500, "rate": "5", "lines": [{"amount": "1000", "rate": "5"}, {"amount": "500", "rate": "18"}]})
    assert r.status_code == 200, r.text
    assert (r.json()["taxable_value"], r.json()["cgst"], r.json()["total"]) == ("1500.00", "70.00", "1640.00")
