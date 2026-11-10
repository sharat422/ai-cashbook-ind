"""GST-ready invoices and the CA/Tally exports (not filing, not e-invoicing)."""

import csv
import io
import json
import re
from decimal import Decimal
from pathlib import Path

import pytest
from openpyxl import load_workbook

from conftest import today_iso
from helpers import add_customer
from app import gst
from app.database import SessionLocal
from app.models import GstInvoiceNumber, GstRateChangeLog, LedgerEntry

API = "/api/v1"
D = Decimal


def _gstin(state: str, pan: str = "AAPFU0939F") -> str:
    """A GSTIN with a valid check digit."""
    body = f"{state}{pan}1Z"
    for ch in gst._CHARS:
        try:
            return gst.clean_gstin(body + ch)
        except Exception:  # noqa: BLE001 — wrong check digit, try the next
            pass
    raise AssertionError("no check digit")


KA, MH = _gstin("29"), _gstin("27")  # customers
SELLER = _gstin("29", "AAACS1234B")  # the business, in Karnataka


def _gst_owner(make_user, client):
    owner = make_user()
    r = client.patch(f"{API}/businesses/me", headers=owner.headers,
                     json={"gstRegistered": True, "gstin": SELLER})
    assert r.status_code == 200, r.text
    return owner


def _sale(client, headers, cid, cid_key, amount=1000, rate="18", **extra):
    data = {"type": "credit", "amount": str(amount), "date": extra.pop("date", today_iso()),
            "client_id": cid_key, "gst_rate": rate, "hsn_code": extra.pop("hsn_code", "1006"),
            "quantity": extra.pop("quantity", "10"), "uqc": extra.pop("uqc", "BAG"), **extra}
    return client.post(f"{API}/customers/{cid}/ledger", headers=headers, data=data)


def _book(client, headers, path):
    r = client.get(f"{API}/reports/{path}", headers=headers,
                   params={"from": today_iso(), "to": today_iso()})
    assert r.status_code == 200, r.text
    return r


# --- 1. Intra-state: CGST+SGST, no IGST. Inter-state: IGST only ------------------

def test_intra_state_is_cgst_sgst_and_inter_state_is_igst_only(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]

    intra = _sale(client, owner.headers, cid, "ka", customer_gstin=KA.lower()).json()["gst"]
    assert (intra["cgst"], intra["sgst"], intra["igst"]) == ("90.00", "90.00", "0.00")
    assert intra["customer_gstin"] == KA and intra["place_of_supply"] == "29"

    inter = _sale(client, owner.headers, cid, "mh", customer_gstin=MH).json()
    assert (inter["gst"]["cgst"], inter["gst"]["sgst"], inter["gst"]["igst"]) == ("0.00", "0.00", "180.00")
    assert inter["amount"] == 1180.0  # the customer owes the invoice total

    # No GSTIN: the picked state decides; none picked means the seller's state.
    kerala = _sale(client, owner.headers, cid, "kl", place_of_supply="Kerala").json()["gst"]
    assert kerala["igst"] == "180.00" and kerala["cgst"] == "0.00"
    local = _sale(client, owner.headers, cid, "local").json()["gst"]
    assert local["igst"] == "0.00" and local["cgst"] == "90.00"

    # The preview is the same server calculation, saving nothing.
    p = client.post(f"{API}/gst/preview", headers=owner.headers,
                    json={"amount": 1180, "rate": "18", "price_includes_gst": True,
                          "customer_gstin": MH}).json()
    assert p == {"place_of_supply": "27-Maharashtra", "inter_state": True, "taxable_value": "1000.00",
                 "cgst": "0.00", "sgst": "0.00", "igst": "180.00", "total": "1180.00"}


@pytest.mark.parametrize("rate", sorted(gst.GST_RATES))
def test_split_is_never_both_and_inclusive_keeps_the_price(rate):
    for paise in range(1, 200_001, 997):
        amount = D(paise) / 100
        for inclusive in (True, False):
            intra = gst.split(amount, rate, inclusive, inter_state=False)
            inter = gst.split(amount, rate, inclusive, inter_state=True)
            assert intra["igst"] == 0 and intra["cgst"] == intra["sgst"]
            assert inter["cgst"] == inter["sgst"] == 0
            for s in (intra, inter):
                assert s["total"] == s["taxable_value"] + s["cgst"] + s["sgst"] + s["igst"]
                assert (s["total"] if inclusive else s["taxable_value"]) == amount
                assert all(v == v.quantize(D("0.01")) for v in s.values())


def test_gst_inputs_are_checked(make_user, client):
    plain = make_user()  # not GST registered
    cid = add_customer(client, plain.headers)["id"]
    assert _sale(client, plain.headers, cid, "x").status_code == 422

    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    bad_digit = KA[:-1] + ("0" if KA[-1] != "0" else "1")
    for key, extra in [("gstin", {"customer_gstin": bad_digit}), ("hsn", {"hsn_code": "12"}),
                       ("rate", {"rate": "7"}), ("retired12", {"rate": "12"}), ("retired28", {"rate": "28"}),
                       ("noqty", {"quantity": ""}), ("zeroqty", {"quantity": "0"}), ("uqc", {"uqc": "BOXES"}),
                       ("nouqc", {"uqc": ""}),
                       ("state", {"place_of_supply": "Atlantis"}),
                       ("pay", {"type": "payment", "payment_method": "cash"})]:
        r = _sale(client, owner.headers, cid, key, **extra)
        assert r.status_code == 422, (key, r.text)
    with SessionLocal() as db:
        assert db.query(LedgerEntry).filter(LedgerEntry.customer_id == cid).count() == 0


# --- 2. A rate change is logged and leaves old invoices alone --------------------

def test_rate_change_is_logged_and_old_invoices_keep_their_tax(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    item = client.post(f"{API}/items", headers=owner.headers,
                       json={"name": "Rice 25kg", "hsn_sac": "1006", "gst_rate": 18}).json()
    old = _sale(client, owner.headers, cid, "before", rate="18").json()

    body = {"name": "Rice 25kg", "hsn_sac": "1006", "gst_rate": 5}
    assert client.patch(f"{API}/items/{item['id']}", headers=owner.headers, json=body).status_code == 200
    # Saving again with the same rate is not a change.
    assert client.patch(f"{API}/items/{item['id']}", headers=owner.headers, json=body).status_code == 200

    with SessionLocal() as db:
        logs = db.query(GstRateChangeLog).filter_by(item_id=item["id"]).all()
        assert [(x.old_rate, x.new_rate, x.item_name) for x in logs] == [(D("18"), D("5"), "Rice 25kg")]
        assert logs[0].changed_by is not None
        row = db.get(LedgerEntry, old["id"])
        assert (row.gst_rate, row.taxable_value, row.cgst, row.sgst) == (D("18"), D("1000"), D("90"), D("90"))

    ws = load_workbook(io.BytesIO(_book(client, owner.headers, "gstr1.xlsx").content))
    assert [c.value for c in ws["rate changes"][2]][1:] == ["Rice 25kg", 18, 5]
    assert ws["b2cs"]["D2"].value == 18  # the old invoice is still at 18%


# --- Exports: types, names, contents ----------------------------------------------

def test_exports_hold_the_saved_figures(make_user, client):
    owner = _gst_owner(make_user, client)
    reg = add_customer(client, owner.headers, full_name="Ravi", business_name="Ravi Stores")["id"]
    walk_in = add_customer(client, owner.headers, full_name="=HYPERLINK(\"x\")")["id"]
    fy = gst.financial_year(today_iso())
    A1, A2 = f"{fy}/00001", f"{fy}/00002"
    _sale(client, owner.headers, reg, "a", amount=1000, customer_gstin=MH)
    _sale(client, owner.headers, walk_in, "b", amount="525.50", rate="5",
          hsn_code="19053100", price_includes_gst="true")
    client.post(f"{API}/customers/{reg}/ledger", headers=owner.headers,  # not a GST invoice
                data={"type": "credit", "amount": "99", "date": today_iso(), "client_id": "plain"})

    summary = _book(client, owner.headers, "gst-summary").json()
    assert summary["invoices"] == 2
    assert (summary["igst"], summary["cgst"], summary["sgst"]) == ("180.00", "12.51", "12.51")
    assert summary["total"] == "1705.50"

    expected = {
        "gstr1.xlsx": ("GSTR1_ready_", gst_xlsx := "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "gstr3b-summary.xlsx": ("GSTR3B_summary_", gst_xlsx),
        "tally-export.xlsx": ("Tally_sales_", gst_xlsx),
        "tally-export.csv": ("Tally_sales_", "text/csv; charset=utf-8"),
    }
    for path, (prefix, media) in expected.items():
        r = _book(client, owner.headers, path)
        assert r.headers["content-type"] == media
        ext = path.rsplit(".", 1)[1]
        assert re.fullmatch(f'attachment; filename="{prefix}{today_iso()}_{today_iso()}.{ext}"',
                            r.headers["content-disposition"])

    rows = list(csv.reader(io.StringIO(_book(client, owner.headers, "tally-export.csv").content.decode("utf-8-sig"))))
    assert rows[0][:9] == ["Voucher Date", "Party Name", "GSTIN", "HSN", "Taxable Value",
                           "CGST", "SGST", "IGST", "Bill Reference"]
    d = today_iso()
    ddmm = f"{d[8:10]}-{d[5:7]}-{d[:4]}"
    assert rows[1] == [ddmm, "Ravi Stores", MH, "1006", "1000.00", "0.00", "0.00", "180.00",
                       A1, "18", "27-Maharashtra", "1180.00"]
    assert rows[2] == [ddmm, "'=HYPERLINK(\"x\")", "", "19053100", "500.48", "12.51", "12.51",
                       "0.00", A2, "5", "29-Karnataka", "525.50"]

    tally = load_workbook(io.BytesIO(_book(client, owner.headers, "tally-export.xlsx").content))["Sales"]
    cell = tally["B3"]
    assert cell.value == "=HYPERLINK(\"x\")" and cell.data_type == "s"  # text, not a formula
    assert [c.value for c in tally[2]][4:8] == [1000, 0, 0, 180]

    book = load_workbook(io.BytesIO(_book(client, owner.headers, "gstr1.xlsx").content))
    assert book.sheetnames == ["b2b", "b2cl", "b2cs", "hsn(b2b)", "hsn(b2c)", "rate changes"]
    b2b = [c.value for c in book["b2b"][2]]
    assert b2b[:3] == [MH, "Ravi Stores", A1] and b2b[4] == 1180 and b2b[5] == "27-Maharashtra"
    assert [c.value for c in book["b2cs"][2]][:5] == ["OE", "29-Karnataka", None, 5, 500.48]
    assert book["b2cl"].max_row == 1

    b3 = load_workbook(io.BytesIO(_book(client, owner.headers, "gstr3b-summary.xlsx").content))
    assert [c.value for c in b3["3.1 Outward supplies"][2]][1:5] == [1500.48, 180, 12.51, 12.51]


def test_only_report_viewers_can_download(make_user, client):
    owner = _gst_owner(make_user, client)
    staff_mobile = "7" + owner.mobile[-9:]
    assert client.post(f"{API}/team", headers=owner.headers,
                       json={"mobile": staff_mobile, "role": "staff"}).status_code == 200
    from conftest import _login
    staff = _login(client, staff_mobile)
    r = client.get(f"{API}/reports/tally-export.csv", headers=staff,
                   params={"from": today_iso(), "to": today_iso()})
    assert r.status_code == 403
    r = client.get(f"{API}/reports/gstr1.xlsx", headers=owner.headers,
                   params={"from": "2026-02-01", "to": "2026-01-01"})
    assert r.status_code == 422


# --- 4. Nothing claims GST filing or e-invoicing ----------------------------------

def test_no_text_claims_filing_or_e_invoicing():
    root = Path(__file__).resolve().parents[2]
    # "file" as a verb or "filing" — not the noun ("the GSTR-1-ready file").
    claim = re.compile(r"(?i)e-?invoic|\bfil(e|es|ed|ing)\s+(your\s+|the\s+)?(gst|gstr|returns?)\b"
                       r"|\b(gst|gstr\S*)\s+(returns?\s+)?filing\b")
    denial = re.compile(r"(?i)\b(not|doesn't|does not|never|no)\b")
    texts = list(json.loads((root / "src/i18n/locales/en.json").read_text("utf-8")).values())
    texts += [p.read_text("utf-8") for p in (root / "backend/app/chatbot/help_docs").glob("*.md")]
    texts += [(root / f"backend/app/{f}").read_text("utf-8") for f in ("gst.py", "gst_reports.py")]
    for text in texts:
        for sentence in re.split(r"(?<=[.!?\n])", text):
            if claim.search(sentence):
                assert denial.search(sentence), sentence


# --- Rates by date, the seller's GSTIN, invoice numbers ---------------------------

def test_rates_follow_the_invoice_date():
    # GST 2.0 from 22 Sep 2025: 0/5/18/40 (+3 gold, 0.25 rough diamonds); 12% ended
    # then; 28% stayed for tobacco until 1 Feb 2026.
    assert gst.rates_on(None) == {D(r) for r in ("0", "0.25", "3", "5", "18", "40")}
    assert D("12") in gst.rates_on("2025-09-21") and D("12") not in gst.rates_on("2025-09-22")
    assert D("28") in gst.rates_on("2026-01-31") and D("28") not in gst.rates_on("2026-02-01")
    for bad in ("7", "1.5", "6"):
        with pytest.raises(Exception):
            gst.clean_rate(bad, "2025-01-01")


def test_old_invoice_can_still_use_a_retired_rate(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    r = _sale(client, owner.headers, cid, "old12", rate="12", date="2025-09-21")
    assert r.status_code == 200, r.text
    assert r.json()["gst"]["rate"] == "12"
    assert _sale(client, owner.headers, cid, "new12", rate="12", date="2025-09-22").status_code == 422
    assert _sale(client, owner.headers, cid, "old28", rate="28", date="2026-01-31").status_code == 200
    r = _sale(client, owner.headers, cid, "new28", rate="28")
    assert r.status_code == 422 and "ended on 2026-02-01" in r.json()["detail"]


def test_gst_invoice_needs_the_sellers_own_gstin(make_user, client):
    owner = make_user()
    me = f"{API}/businesses/me"
    assert client.patch(me, headers=owner.headers, json={"gstRegistered": True}).status_code == 200
    cid = add_customer(client, owner.headers)["id"]
    r = _sale(client, owner.headers, cid, "nogstin")
    assert r.status_code == 422 and "GSTIN" in r.json()["detail"]
    # The GSTIN's state must be the business state, now and after a state change.
    r = client.patch(me, headers=owner.headers, json={"gstin": MH})
    assert r.status_code == 422 and "Maharashtra" in r.json()["detail"]
    assert client.patch(me, headers=owner.headers, json={"gstin": SELLER.lower()}).json()["gstin"] == SELLER
    assert client.patch(me, headers=owner.headers, json={"state": "Kerala"}).status_code == 422
    assert client.patch(me, headers=owner.headers, json={"gstin": ""}).json()["gstin"] is None


@pytest.mark.parametrize("state, code", [("Jammu and Kashmir", "01"), ("Ladakh", "38"),
                                         ("Chandigarh", "04"), ("Puducherry", "34"),
                                         ("Lakshadweep", "31"), ("Andaman and Nicobar Islands", "35"),
                                         ("Dadra and Nagar Haveli and Daman and Diu", "26"),
                                         ("Delhi", "07")])
def test_every_union_territory_works_as_the_business_state(make_user, client, state, code):
    owner = make_user()
    r = client.patch(f"{API}/businesses/me", headers=owner.headers,
                     json={"state": state, "gstRegistered": True, "gstin": _gstin(code, "AAACS1234B")})
    assert r.status_code == 200, r.text
    cid = add_customer(client, owner.headers)["id"]
    local = _sale(client, owner.headers, cid, "ut").json()["gst"]
    assert local["place_of_supply"] == code and local["cgst"] == "90.00"


def test_app_state_list_matches_the_server():
    # Every state the app offers must be one the server knows (36 states and UTs).
    src = (Path(__file__).parents[2] / "src/config/constants.ts").read_text(encoding="utf-8")
    start = src.index("INDIAN_STATES = [")
    block = src[start:src.index("] as const", start)]
    app_states = set(re.findall(r"'([^']+)'", block))
    assert app_states == set(gst.STATE_CODES) - {"Other Territory"}
    assert len(app_states) == 36


def test_invoice_numbers_are_consecutive_per_business_per_financial_year(make_user, client):
    a, b = _gst_owner(make_user, client), _gst_owner(make_user, client)
    ca, cb = add_customer(client, a.headers)["id"], add_customer(client, b.headers)["id"]
    fy = gst.financial_year(today_iso())

    nums = [_sale(client, a.headers, ca, f"n{i}", invoice_number="MY-OWN-1").json()["invoice_number"]
            for i in range(3)]
    assert nums == [f"{fy}/00001", f"{fy}/00002", f"{fy}/00003"]  # the app's number is ignored
    assert all(len(n) <= 16 for n in nums)
    assert _sale(client, b.headers, cb, "b1").json()["invoice_number"] == f"{fy}/00001"  # per business
    # A retry of the same entry gets the same number, not a new one.
    assert _sale(client, a.headers, ca, "n0").json()["invoice_number"] == f"{fy}/00001"
    # Last financial year has its own series.
    last_fy = _sale(client, a.headers, ca, "old", date="2025-03-31", rate="12").json()
    assert last_fy["invoice_number"] == "24-25/00001"
    # Plain credits never take a GST number.
    plain = client.post(f"{API}/customers/{ca}/ledger", headers=a.headers,
                        data={"type": "credit", "amount": "5", "date": today_iso(), "client_id": "p",
                              "invoice_number": "BILL-9"}).json()
    assert plain["invoice_number"] == "BILL-9"


def test_deleted_invoice_numbers_are_never_reused(make_user, client):
    owner = _gst_owner(make_user, client)
    fy = gst.financial_year(today_iso())
    gone = add_customer(client, owner.headers)["id"]
    _sale(client, owner.headers, gone, "x1")
    assert client.delete(f"{API}/customers/{gone}", headers=owner.headers).status_code == 204
    cid = add_customer(client, owner.headers)["id"]
    assert _sale(client, owner.headers, cid, "x2").json()["invoice_number"] == f"{fy}/00002"
    with SessionLocal() as db:
        rows = db.query(GstInvoiceNumber).filter_by(business_id=owner.business["id"]).all()
        assert sorted((r.serial, r.ledger_entry_id is None) for r in rows) == [(1, True), (2, False)]


def test_financial_year_boundaries():
    assert gst.financial_year("2026-03-31") == "25-26"
    assert gst.financial_year("2026-04-01") == "26-27"
    assert gst.financial_year("2099-12-31") == "99-00"


def test_phone_formula_vectors_still_match_the_server():
    # src/features/gst/domain/gstSplitVectors.json was generated from split();
    # the app's gstSplit.test.ts checks the phone against the same file.
    root = Path(__file__).parents[2] / "src/features/gst/domain"
    for v in json.loads((root / "gstSplitVectors.json").read_text(encoding="utf-8")):
        s = gst.split(v["amount"], D(v["rate"]), v["inclusive"], v["interState"])
        assert {k: f"{x:.2f}" for k, x in s.items()} == {k: v[k] for k in s}, v
    ts = (root / "gstSplit.ts").read_text(encoding="utf-8")
    pairs = dict(re.findall(r"'?([A-Za-z][A-Za-z ]+?)'?: '(\d\d)'", ts))
    assert pairs == {k: c for k, c in gst.STATE_CODES.items() if k != "Other Territory"}



def test_gst_line_quantity_and_uqc_reach_the_hsn_sheet(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    a = _sale(client, owner.headers, cid, "q1", quantity="2.5", uqc="kgs").json()
    assert (a["gst"]["quantity"], a["gst"]["uqc"]) == ("2.5", "KGS")
    _sale(client, owner.headers, cid, "q2", quantity="4", uqc="KGS")
    _sale(client, owner.headers, cid, "q3", quantity="3", uqc="BAG")
    book = load_workbook(io.BytesIO(_book(client, owner.headers, "gstr1.xlsx").content))
    rows = sorted([c.value for c in r][:5] for r in book["hsn(b2c)"].iter_rows(min_row=2))
    assert rows == [["1006", None, "BAG-BAGS", 3, 1180], ["1006", None, "KGS-KILOGRAMS", 6.5, 2360]]
