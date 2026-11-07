"""'Your data' exports: Excel of everything and a balances PDF, free on every
plan (no plan, payment or trial check), scoped to the caller's business."""

import ast
import io
import re
import textwrap
import inspect

from openpyxl import load_workbook
from pypdf import PdfReader

from conftest import _login, days_ago_iso
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
    assert wb.sheetnames == ["Customers", "Ledger", "Income", "Expenses"]
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
