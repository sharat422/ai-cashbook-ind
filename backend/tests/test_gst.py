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
from app.models import GstRateChangeLog, LedgerEntry

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


KA, MH = _gstin("29"), _gstin("27")  # seller is in Karnataka


def _gst_owner(make_user, client):
    owner = make_user()
    r = client.patch(f"{API}/businesses/me", headers=owner.headers, json={"gstRegistered": True})
    assert r.status_code == 200, r.text
    return owner


def _sale(client, headers, cid, cid_key, amount=1000, rate="18", **extra):
    data = {"type": "credit", "amount": str(amount), "date": today_iso(), "client_id": cid_key,
            "invoice_number": extra.pop("invoice_number", f"INV/{cid_key}"[:16]),
            "gst_rate": rate, "hsn_code": extra.pop("hsn_code", "1006"), **extra}
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
                       ("rate", {"rate": "7"}), ("inv", {"invoice_number": ""}),
                       ("inv2", {"invoice_number": "INVOICE-NUMBER-TOO-LONG"}),
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
    _sale(client, owner.headers, reg, "a", amount=1000, invoice_number="A-1", customer_gstin=MH)
    _sale(client, owner.headers, walk_in, "b", amount="525.50", rate="5", invoice_number="A-2",
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
                       "A-1", "18", "27-Maharashtra", "1180.00"]
    assert rows[2] == [ddmm, "'=HYPERLINK(\"x\")", "", "19053100", "500.48", "12.51", "12.51",
                       "0.00", "A-2", "5", "29-Karnataka", "525.50"]

    tally = load_workbook(io.BytesIO(_book(client, owner.headers, "tally-export.xlsx").content))["Sales"]
    cell = tally["B3"]
    assert cell.value == "=HYPERLINK(\"x\")" and cell.data_type == "s"  # text, not a formula
    assert [c.value for c in tally[2]][4:8] == [1000, 0, 0, 180]

    book = load_workbook(io.BytesIO(_book(client, owner.headers, "gstr1.xlsx").content))
    assert book.sheetnames == ["b2b", "b2cl", "b2cs", "hsn(b2b)", "hsn(b2c)", "rate changes"]
    b2b = [c.value for c in book["b2b"][2]]
    assert b2b[:3] == [MH, "Ravi Stores", "A-1"] and b2b[4] == 1180 and b2b[5] == "27-Maharashtra"
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
