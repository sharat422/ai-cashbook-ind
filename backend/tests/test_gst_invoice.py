"""GST tax invoice: the split (CGST+SGST inside the state, IGST across), 12%
only for the building-material HSNs, the product's name on the invoice, the
invoice PDF through the consent-checked share, and the CA/Tally export for a
date range with every GST column and every invoice in it."""

import csv
import io
import json
from decimal import Decimal

from conftest import days_ago_iso, today_iso
from helpers import add_customer
from test_gst import KA, MH, _gst_owner, _sale
from test_pdf_share import _consent

API = "/api/v1"
D = Decimal


def _product(client, headers, name, hsn, rate):
    r = client.post(f"{API}/items", headers=headers, json={
        "name": name, "sale_price": 100, "purchase_price": 80, "hsn_sac": hsn, "gst_rate": rate, "unit": "BAG"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_intra_state_18_percent_and_the_invoice_pdf(make_user, client):
    owner = _gst_owner(make_user, client)  # seller in Karnataka
    cid = add_customer(client, owner.headers, full_name="Gupta Stores", gst_number=KA)["id"]
    rice = _product(client, owner.headers, "Sona Masoori Rice 25kg", "1006", 18)
    r = _sale(client, owner.headers, cid, "inv-1", amount=1000, customer_gstin=KA, item_id=rice)
    assert r.status_code == 200, r.text
    g = r.json()["gst"]
    taxable, cgst, sgst = D(g["taxable_value"]), D(g["cgst"]), D(g["sgst"])
    assert (taxable, cgst, sgst, D(g["igst"])) == (D("1000.00"), D("90.00"), D("90.00"), D("0.00"))
    assert cgst == sgst == taxable * D("0.09")
    assert D(str(r.json()["amount"])) == taxable + cgst + sgst == D("1180.00")
    # The product's name is on the invoice, looked up by the server (not sent as text).
    assert g["lines"][0]["item_name"] == "Sona Masoori Rice 25kg"

    entry = r.json()["id"]
    # The PDF only through the share (consent-checked, logged): email is always allowed.
    share = client.post(f"{API}/customers/{cid}/ledger/{entry}/invoice/share", headers=owner.headers,
                        json={"channel": "email"})
    assert share.status_code == 200, share.text
    pdf = client.get(f"{API}{share.json()['pdfUrl']}", headers=owner.headers)
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    assert client.get(f"{API}/customers/{cid}/ledger/{entry}/invoice.pdf", headers=owner.headers).status_code == 403
    # WhatsApp needs the retailer's opt-in.
    _consent(client, owner, cid, "opted_out")
    assert client.post(f"{API}/customers/{cid}/ledger/{entry}/invoice/share", headers=owner.headers,
                       json={"channel": "whatsapp"}).status_code == 409


def test_inter_state_is_igst_only(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers, full_name="Pune Traders")["id"]
    g = _sale(client, owner.headers, cid, "inv-2", amount=1000, customer_gstin=MH).json()["gst"]
    assert (D(g["igst"]), D(g["cgst"]), D(g["sgst"])) == (D("180.00"), D("0.00"), D("0.00"))
    assert D(g["igst"]) == D(g["taxable_value"]) * D("0.18")


def test_12_percent_only_for_bricks_and_tiles(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    bricks = _sale(client, owner.headers, cid, "inv-3", rate="12", hsn_code="69041000", quantity="1000", uqc="NOS")
    assert bricks.status_code == 200, bricks.text
    soap = _sale(client, owner.headers, cid, "inv-4", rate="12", hsn_code="3401", quantity="10", uqc="NOS")
    assert soap.status_code == 422 and "bricks" in soap.json()["detail"].lower()
    for old in ("28",):  # the old 28% slab ended on 1 Feb 2026
        assert _sale(client, owner.headers, cid, f"inv-{old}", rate=old).status_code == 422
    # Items: 12% only with such an HSN too.
    assert client.post(f"{API}/items", headers=owner.headers, json={
        "name": "Soap", "sale_price": 10, "hsn_sac": "3401", "gst_rate": 12}).status_code == 422


def test_ca_tally_export_has_every_column_and_every_invoice_in_range(make_user, client):
    owner = _gst_owner(make_user, client)
    a = add_customer(client, owner.headers, full_name="Gupta Stores")["id"]
    b = add_customer(client, owner.headers, full_name="Pune Traders")["id"]
    in_range = [
        _sale(client, owner.headers, a, "ex-1", amount=1000, customer_gstin=KA).json(),
        _sale(client, owner.headers, b, "ex-2", amount=500, customer_gstin=MH, date=days_ago_iso(2)).json(),
        _sale(client, owner.headers, a, "ex-3", amount=500, customer_gstin=KA, lines=json.dumps([
            {"amount": "200", "rate": "5", "hsn": "1006", "quantity": "2", "uqc": "BAG"},
            {"amount": "300", "rate": "18", "hsn": "3401", "quantity": "6", "uqc": "NOS"}])).json(),
    ]
    _sale(client, owner.headers, a, "ex-old", amount=999, customer_gstin=KA, date=days_ago_iso(40))  # outside

    r = client.get(f"{API}/reports/tally-export.csv", headers=owner.headers,
                   params={"from": days_ago_iso(7), "to": today_iso()})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    # date, invoice_no, customer, customer_GSTIN, HSN, taxable_value, CGST, SGST, IGST, total:
    for column in ("Voucher Date", "Bill Reference", "Party Name", "GSTIN", "HSN", "Taxable Value",
                   "CGST", "SGST", "IGST", "Invoice Value"):
        assert column in rows[0], column
    assert {row["Bill Reference"] for row in rows} == {e["invoice_number"] for e in in_range}
    assert len(rows) == 4  # one row per item: the two-item invoice has two
    two = [row for row in rows if row["Bill Reference"] == in_range[2]["invoice_number"]]
    assert {row["HSN"] for row in two} == {"1006", "3401"} and {row["Invoice Value"] for row in two} == {"564.00"}
    inter = next(row for row in rows if row["Bill Reference"] == in_range[1]["invoice_number"])
    assert (inter["GSTIN"], inter["IGST"], inter["CGST"], inter["SGST"]) == (MH, "90.00", "0.00", "0.00")
    xlsx = client.get(f"{API}/reports/tally-export.xlsx", headers=owner.headers,
                      params={"from": days_ago_iso(7), "to": today_iso()})
    assert xlsx.status_code == 200 and xlsx.content[:2] == b"PK"


def test_a_two_item_invoice_with_a_telugu_name_renders(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers, full_name="నరేన్ స్టోర్స్")["id"]
    oil = _product(client, owner.headers, "నూనె 1L", "1515", 5)
    entry = _sale(client, owner.headers, cid, "inv-te", amount=500, customer_gstin=KA, lines=json.dumps([
        {"amount": "200", "rate": "5", "hsn": "1515", "quantity": "2", "uqc": "LTR", "item_id": oil},
        {"amount": "300", "rate": "18", "hsn": "3401", "quantity": "6", "uqc": "NOS"}])).json()
    assert [ln["item_name"] for ln in entry["gst"]["lines"]] == ["నూనె 1L", None]
    url = client.post(f"{API}/customers/{cid}/ledger/{entry['id']}/invoice/share", headers=owner.headers,
                      json={"channel": "save"}).json()["pdfUrl"]
    assert client.get(f"{API}{url}", headers=owner.headers).content.startswith(b"%PDF")


def test_the_business_address_is_saved_and_goes_on_the_invoice(make_user, client):
    owner = _gst_owner(make_user, client)
    me = f"{API}/businesses/me"
    r = client.patch(me, headers=owner.headers, json={"address": "  14 Market Road, Mysuru 570001  "})
    assert r.status_code == 200 and r.json()["address"] == "14 Market Road, Mysuru 570001"
    # Changing something else leaves it; too long is refused; "" clears it.
    assert client.patch(me, headers=owner.headers, json={"ownerName": "Ravi"}).json()["address"] == \
        "14 Market Road, Mysuru 570001"
    assert client.patch(me, headers=owner.headers, json={"address": "x" * 301}).status_code == 422
    # Staff can't change it (business settings are the owner's).
    staff_mobile = "7" + owner.mobile[1:]
    assert client.post(f"{API}/team", headers=owner.headers, json={"mobile": staff_mobile, "role": "staff"}).status_code == 200
    from conftest import _login
    assert client.patch(me, headers=_login(client, staff_mobile), json={"address": "x"}).status_code == 403

    cid = add_customer(client, owner.headers, full_name="Gupta Stores")["id"]
    entry = _sale(client, owner.headers, cid, "addr-1", customer_gstin=KA).json()
    url = client.post(f"{API}/customers/{cid}/ledger/{entry['id']}/invoice/share", headers=owner.headers,
                      json={"channel": "save"}).json()["pdfUrl"]
    assert client.get(f"{API}{url}", headers=owner.headers).content.startswith(b"%PDF")
    assert client.patch(me, headers=owner.headers, json={"address": ""}).json()["address"] is None


def test_a_draft_has_no_invoice_pdf(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    draft = _sale(client, owner.headers, cid, "inv-d", customer_gstin=KA, draft="true").json()
    r = client.post(f"{API}/customers/{cid}/ledger/{draft['id']}/invoice/share", headers=owner.headers,
                    json={"channel": "email"})
    assert r.status_code == 422
