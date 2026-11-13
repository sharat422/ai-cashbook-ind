"""'Your data' exports: Excel of everything and a balances PDF, free on every
plan (no plan, payment or trial check), scoped to the caller's business."""

import ast
import io
import re
import textwrap
import inspect

from openpyxl import load_workbook
from pypdf import PdfReader

from conftest import _login, days_ago_iso, today_iso
from helpers import add_customer, add_expense, add_income, add_ledger
from app import data_export
from app.routers import account

API = "/api/v1"


def _seed(client, owner):
    cid = add_customer(client, owner.headers, full_name="రమేష్ ట్రేడర్స్")["id"]
    add_ledger(client, owner.headers, cid, type="credit", amount=1500, date=days_ago_iso(3),
               client_id="c1", invoice_number="INV-1")
    add_ledger(client, owner.headers, cid, type="payment", amount=400.5, date=days_ago_iso(1),
               client_id="p1", payment_method="cash")
    add_income(client, owner.headers, amount=900, date=days_ago_iso(2), client_id="i1")
    add_expense(client, owner.headers, amount=250, date=days_ago_iso(2), client_id="e1")
    return cid


def test_brand_new_free_business_exports_excel_and_pdf(make_user, client):
    owner = make_user(business_name="Sri Lakshmi Agencies")  # never paid for anything
    _seed(client, owner)

    x = client.get(f"{API}/account/export.xlsx", headers=owner.headers)
    assert x.status_code == 200, x.text
    assert x.headers["content-type"].startswith("application/vnd.openxmlformats")
    wb = load_workbook(io.BytesIO(x.content))
    assert wb.sheetnames[:4] == ["Customers", "Ledger", "Income", "Expenses"]
    assert {"customers (all)", "ledger_entries (all)", "incomes (all)", "team (all)"} <= set(wb.sheetnames)
    cust = [list(r) for r in wb["Customers"].iter_rows(min_row=2, values_only=True)]
    assert cust[0][0] == "రమేష్ ట్రేడర్స్" and float(cust[0][4]) == 1099.5
    ledger = [list(r) for r in wb["Ledger"].iter_rows(min_row=2, values_only=True)]
    assert [(r[2], float(r[3])) for r in ledger] == [("Sale (credit)", 1500.0), ("Payment", 400.5)]
    assert wb["Income"].max_row == 2 and wb["Expenses"].max_row == 2

    p = client.get(f"{API}/account/balances.pdf", headers=owner.headers)
    assert p.status_code == 200 and p.headers["content-type"] == "application/pdf"
    text = "\n".join(pg.extract_text() for pg in PdfReader(io.BytesIO(p.content)).pages)
    assert "Sri Lakshmi Agencies" in text and "₹1,099.50" in text and "Total (1 customers)" in text


def test_export_never_checks_a_plan_or_payment():
    # The promise is "free to export even if you stop paying". Guard it in code:
    # nothing on the export path may look at plans, payments or trials.
    names = set()
    for obj in (data_export, account.export_workbook, account.export_balances):
        for node in ast.walk(ast.parse(textwrap.dedent(inspect.getsource(obj)))):
            if isinstance(node, ast.Name):
                names.add(node.id)
            elif isinstance(node, ast.Attribute):
                names.add(node.attr)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                names.update(a.name for a in node.names)
                names.add(getattr(node, "module", None) or "")
    gated = [n for n in names if re.search(r"plan|subscri|trial|billing|premium|paywall", n, re.I)]
    assert gated == []


def test_export_is_scoped_and_staff_cannot_download(make_user, client):
    a, b = make_user(), make_user(business_name="Other Co")
    _seed(client, a)
    wb = load_workbook(io.BytesIO(client.get(f"{API}/account/export.xlsx", headers=b.headers).content))
    assert wb["Customers"].max_row == 1 and wb["Ledger"].max_row == 1  # B sees none of A's data

    r = client.post(f"{API}/team", headers=a.headers, json={"mobile": "7012345678", "role": "staff"})
    assert r.status_code == 200, r.text
    staff = _login(client, "7012345678")
    assert client.get(f"{API}/account/export.xlsx", headers=staff).status_code == 403
    assert client.get(f"{API}/account/balances.pdf", headers=staff).status_code == 403



def test_every_business_table_is_exported_or_deliberately_left_out(make_user, client):
    # One shared builder: a new business table must be added to sections()
    # (or to this short list of things that must never leave the server).
    from app.database import Base
    never = {"statement_links": "token hashes", "payment_utrs": "UTR index hashes",
             "ai_decisions": "Ask AI log, deleted on request", "access_logs": None,
             "businesses": "exported as 'business'", "feedback": "messages to the Bolcash team"}
    exported = {"customers", "ledger_entries", "gst_invoice_numbers", "gst_rate_change_logs", "incomes",
                "expenses", "recurring_expenses", "items", "stock_levels", "stock_moves", "schemes",
                "scheme_items", "bills", "bill_lines", "bill_series", "scheme_applications", "beats", "beat_retailers",
                "visits", "beat_assignments", "bank_imports", "bank_lines", "bank_matches", "cash_counts", "cash_deposits", "credit_notes", "ca_test_results", "suppliers", "item_units", "stock_month_locks", "statement_events", "statement_schedules",
                "import_logs", "business_members", "discarded_entries", "team_invites"}
    owned = {t.name for t in Base.metadata.sorted_tables if "business_id" in t.c or "customer_id" in t.c
             or t.name in {"scheme_items", "bill_lines", "beat_retailers", "beat_assignments"}}
    assert owned - exported - set(never) == set()
    # The records that prove a charge also get readable sheets (BL12), even when empty.
    readable = {"bills": "Bills", "bill_lines": "Bills", "scheme_applications": "Scheme log"}
    owner = make_user()
    wb = load_workbook(io.BytesIO(client.get(f"{API}/account/export.xlsx", headers=owner.headers).content))
    assert set(readable.values()) <= set(wb.sheetnames), wb.sheetnames


def test_download_my_data_holds_beats_visits_bank_gst_and_stock(make_user, client):
    from test_beats import _beat, _team, _visit
    from test_recon_rework import _dmy, _import, _pay, _statement
    owner, [(a_id, staff)] = _team(make_user, client, "staff")
    cid = _seed(client, owner)
    beat = _beat(client, owner, "Market", user_id=a_id, customers=[cid])
    _visit(client, staff, beat["id"], cid, "v1")
    e = _pay(client, owner.headers, cid, 75, "u1", "791111111111")
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},UPI 791111111111,75.00,"]))
    sugg = client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json()
    client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                json={"bankLineId": sugg[0]["bankLine"]["id"], "entryId": e})
    client.post(f"{API}/items", headers=owner.headers, json={"name": "Soap", "sale_price": 25,
                                                             "track_stock": True, "stock_qty": 40})

    data = client.get(f"{API}/account/export", headers=owner.headers).json()
    assert data["schema_version"] == 2
    t = data["businesses"][0]["all_tables"]
    assert [b["name"] for b in t["beats"]] == ["Market"] and len(t["beat_retailers"]) == 1
    assert len(t["visits"]) == 1 and t["visits"][0]["outcome"] == "visited_no_order"
    assert len(t["bank_lines"]) == 1 and t["bank_matches"][0]["entry_id"] == e
    assert "file_hash" not in t["bank_statements"][0]
    assert t["stock_levels"][0]["qty"] == "40.000" and t["stock_moves"][0]["kind"] == "opening"
    assert {"gst_invoice_numbers", "gst_rate_changes", "cash_counts", "khata_imports"} <= set(t)
    assert any(x["invoice_number"] == "INV-1" for x in t["ledger_entries"])
    wb = load_workbook(io.BytesIO(client.get(f"{API}/account/export.xlsx", headers=owner.headers).content))
    assert {f"{n} (all)" for n in ("beats", "visits", "bank_lines", "bank_matches", "stock_levels",
                                   "stock_moves")} <= set(wb.sheetnames)


def test_download_my_data_has_bills_and_the_scheme_log_with_cancelled_bills_marked(make_user, client):
    from test_schemes import _bill, _item, _scheme
    from app.gst import financial_year
    owner = make_user()
    fy = financial_year(today_iso())
    soap = _item(client, owner.headers, "Soap", price=25)
    _scheme(client, owner.headers, "Soap 10+1", [soap], buyQty=10, freeQty=1, priority=1)
    _scheme(client, owner.headers, "Soap 5% off", [soap], kind="percent", percent=5, priority=2)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    bill = _bill(client, owner.headers, cid, [(soap, 20)]).json()
    assert client.post(f"{API}/bills/{bill['id']}/cancel", headers=owner.headers, json={"itemIds": []}).status_code == 200

    wb = load_workbook(io.BytesIO(client.get(f"{API}/account/export.xlsx", headers=owner.headers).content))
    rows = [[c for c in r] for r in wb["Bills"].iter_rows(values_only=True)]
    assert rows[0] == ["Bill number", "Date", "Retailer", "Lines", "Scheme lines", "Subtotal", "Scheme discount",
                       "Total", "Status"]
    by_no = {r[0]: r for r in rows[1:]}
    orig = by_no[f"B-{fy}-1"]
    assert orig[2] == "Ravi Stores" and orig[3] == "Soap 20 pcs × ₹25.00 = ₹500.00 (returned)"
    assert orig[4] == "Soap 10+1 (Soap): 2 Soap free"
    assert (float(orig[7]), orig[8]) == (500.0, "Cancelled")  # not deleted: marked
    assert by_no[f"B-{fy}-2"][8] == f"Return of B-{fy}-1"

    log = [r for r in wb["Scheme log"].iter_rows(values_only=True)]
    assert log[0] == ("Bill", "Date", "Retailer", "Scheme", "SKU", "Quantity", "Status", "Free goods",
                      "Discount", "Value", "Reason not applied", "Group")
    got = {(r[0], r[3], r[6]): r for r in log[1:]}
    applied = got[(f"B-{fy}-1", "Soap 10+1", "Applied")]
    assert (applied[4], applied[5], applied[7]) == ("Soap", "20", "2 Soap")
    skipped = got[(f"B-{fy}-1", "Soap 5% off", "Not applied")]
    assert "priority" in skipped[10]
    assert (f"B-{fy}-2", "Soap 10+1", "Reversed (bill returned)") in got
    # The JSON backup has them too (the same builder's tables).
    t = client.get(f"{API}/account/export", headers=owner.headers).json()["businesses"][0]["all_tables"]
    assert {b["status"] for b in t["bills"]} >= {"cancelled"} and len(t["scheme_applications"]) == len(log) - 1
