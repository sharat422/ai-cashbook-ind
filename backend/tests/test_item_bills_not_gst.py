"""SC1: until the CA rules on GST for item bills and schemes (free goods,
% off, slabs), an item bill is never a GST invoice: it isn't in the GSTR-1
file or the Tally exports. GST invoices stay on Add credit. If this test
has to change, the CA's written ruling must come first (docs/CA_TALLY_TEST.md)."""

import csv
import io

from openpyxl import load_workbook

from conftest import today_iso
from helpers import add_customer
from test_gst import API, KA, _gst_owner, _sale
from test_schemes import _bill, _item


def test_an_item_bill_is_not_in_gstr1_or_tally(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    soap = _item(client, owner.headers, "Soap", price=10)
    bill = _bill(client, owner.headers, cid, [(soap, 11)])
    assert bill.status_code == 200, bill.text
    gst_sale = _sale(client, owner.headers, cid, "g1", customer_gstin=KA).json()  # a real GST invoice
    params = {"from": today_iso(), "to": today_iso()}

    gstr1 = load_workbook(io.BytesIO(client.get(f"{API}/reports/gstr1.xlsx", headers=owner.headers,
                                                params=params).content))
    numbers = {str(c.value) for ws in gstr1.worksheets for row in ws.iter_rows() for c in row if c.value}
    assert gst_sale["invoice_number"] in numbers
    assert bill.json()["billNumber"] not in numbers

    tally = client.get(f"{API}/reports/tally-export.csv", headers=owner.headers, params=params).content
    refs = [row[8] for row in csv.reader(io.StringIO(tally.decode("utf-8-sig")))][1:]
    assert refs == [gst_sale["invoice_number"]]  # the bill isn't there
