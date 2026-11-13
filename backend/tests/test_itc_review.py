"""G9: GST on purchases and an ITC review sheet for the CA. A report only:
Bolcash never works out an ITC claim (GSTR-3B table 4 comes from GSTR-2B)."""

import io
import json

from openpyxl import Workbook, load_workbook

from app.main import app
from conftest import today_iso
from test_accountant import _invite
from test_gst import KA, MH, _gst_owner
from test_beats import _login
from test_stock import API, _item, _move

SUPPLIER_KA = KA  # same state as the seller: CGST + SGST
SUPPLIER_MH = MH  # another state: IGST


def _sheet(client, headers, method="get", files=None):
    params = {"from": today_iso(), "to": today_iso()}
    r = getattr(client, method)(f"{API}/reports/itc-review.xlsx", headers=headers, params=params,
                                **({"files": files} if files else {}))
    assert r.status_code == 200, r.text
    return [list(row) for row in load_workbook(io.BytesIO(r.content))["ITC review"].iter_rows(
        min_row=2, values_only=True)]


def _purchases(client, owner):
    item = _item(client, owner.headers)
    assert _move(client, owner.headers, item, "purchase", 10, cid="p1", billRef="KA/7",
                 supplierGstin=SUPPLIER_KA, gstRate="18", gstAmount="144.01").status_code == 200
    assert _move(client, owner.headers, item, "purchase", 5, cid="p2", billRef="MH/9",
                 supplierGstin=SUPPLIER_MH, gstRate="5", gstAmount="20").status_code == 200
    assert _move(client, owner.headers, item, "purchase", 3, cid="p3", billRef="NOGST/1").status_code == 200
    return item


def _2b_xlsx(*bills) -> bytes:
    """Shaped like the portal's GSTR-2B Excel: title rows, then two header rows."""
    wb = Workbook()
    ws = wb.active
    ws.title = "B2B"
    ws.append(["Goods and Services Tax - GSTR 2B"])
    ws.append([])
    ws.append(["GSTIN of supplier", "Trade/Legal name", "Invoice details", "", ""])
    ws.append(["", "", "Invoice number", "Invoice type", "Invoice Date"])
    for gstin, number in bills:
        ws.append([gstin, "Supplier", number, "Regular", "01/11/2026"])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def test_purchases_with_gst_are_on_the_review_sheet_and_others_are_not(make_user, client):
    owner = _gst_owner(make_user, client)
    _purchases(client, owner)
    rows = _sheet(client, owner.headers)
    assert [(r[1], r[2], r[3], float(r[6])) for r in rows] == [
        ("Hindustan Distributors", SUPPLIER_KA, "KA/7", 144.01),
        ("Hindustan Distributors", SUPPLIER_MH, "MH/9", 20.0)]  # the no-GST bill isn't there
    ka, mh = rows
    assert (float(ka[8]), float(ka[9]), float(ka[7])) == (72.0, 72.01, 0.0)  # intra-state: halves add up
    assert (float(mh[7]), float(mh[8])) == (20.0, 0.0)                        # inter-state: IGST
    assert {r[11] for r in rows} == {"2B not checked"}
    # The purchase keeps its GST; bad input is refused.
    item = _item(client, owner.headers, name="Tea")
    assert _move(client, owner.headers, item, "purchase", 1, cid="x1", gstRate="18").status_code == 422
    assert _move(client, owner.headers, item, "purchase", 1, cid="x2", supplierGstin="29ABC").status_code == 422


def test_a_2b_file_marks_matches_and_keeps_lines_not_in_it(make_user, client):
    owner = _gst_owner(make_user, client)
    _purchases(client, owner)
    xlsx = _2b_xlsx((SUPPLIER_KA, "ka/7"))  # case and spaces don't matter
    rows = _sheet(client, owner.headers, "post", {"gstr2b": ("2B.xlsx", xlsx)})
    assert {r[3]: r[11] for r in rows} == {"KA/7": "matched", "MH/9": "not in 2B"}  # not dropped
    portal_json = {"data": {"docdata": {"b2b": [{"ctin": SUPPLIER_MH, "inv": [{"inum": "MH/9"}]}]}}}
    rows = _sheet(client, owner.headers, "post", {"gstr2b": ("2B.json", json.dumps(portal_json).encode())})
    assert {r[3]: r[11] for r in rows} == {"KA/7": "not in 2B", "MH/9": "matched"}
    r = client.post(f"{API}/reports/itc-review.xlsx", headers=owner.headers,
                    params={"from": today_iso(), "to": today_iso()}, files={"gstr2b": ("x.xlsx", b"not a file")})
    assert r.status_code == 422
    # The CA's read-only login can check a 2B too (it saves nothing).
    _invite(client, owner, "9123400001")
    acc = _login(client, "9123400001")
    assert len(_sheet(client, acc, "post", {"gstr2b": ("2B.xlsx", xlsx)})) == 2


def test_no_net_itc_claim_anywhere_and_table_4_is_review_only(make_user, client):
    owner = _gst_owner(make_user, client)
    _purchases(client, owner)
    r = client.get(f"{API}/reports/gstr3b-summary.xlsx", headers=owner.headers,
                   params={"from": today_iso(), "to": today_iso()})
    wb = load_workbook(io.BytesIO(r.content))
    [table4] = [ws for ws in wb.worksheets if ws.title.startswith("4 ITC")]
    assert "not a claim" in table4.title
    header, row = [list(x) for x in table4.iter_rows(values_only=True)]
    assert "review only" in header[0] and "not a claim" in header[0]
    assert [float(v) for v in row[1:]] == [20.0, 72.0, 72.01, 0.0]  # totals of the review sheet
    text = " ".join(str(c.value) for ws in wb.worksheets for r in ws.iter_rows() for c in r if c.value)
    assert "net itc" not in text.lower() and "eligible itc" not in text.lower()
    # No route or response field offers a net ITC claim figure.
    schema = json.dumps(app.openapi()).lower()
    for phrase in ("net_itc", "netitc", "itc_claim", "itcclaim", "eligible_itc"):
        assert phrase not in schema
