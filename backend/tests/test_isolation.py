"""E2E: multi-tenant isolation — one business can never see another's data."""

from conftest import today_iso
from helpers import add_customer, add_income


def test_incomes_are_isolated_per_business(make_user, client):
    a = make_user(business_name="Business A")
    b = make_user(business_name="Business B")

    add_income(client, a.headers, amount=1111, date=today_iso(), client_id="iso-a")
    add_income(client, b.headers, amount=2222, date=today_iso(), client_id="iso-b")

    a_incomes = client.get("/api/v1/incomes", headers=a.headers).json()
    b_incomes = client.get("/api/v1/incomes", headers=b.headers).json()

    assert [r["amount"] for r in a_incomes] == [1111.0]
    assert [r["amount"] for r in b_incomes] == [2222.0]


def test_cannot_read_another_businesss_customer(make_user, client):
    a = make_user()
    b = make_user()
    cust = add_customer(client, a.headers, full_name="A's Customer")

    # B tries to fetch A's customer by id → 404 (not found for this tenant).
    r = client.get(f"/api/v1/customers/{cust['id']}", headers=b.headers)
    assert r.status_code == 404


def test_dashboard_totals_do_not_bleed(make_user, client):
    a = make_user()
    b = make_user()
    add_income(client, a.headers, amount=9000, date=today_iso(), client_id="bleed-a")

    b_summary = client.get("/api/v1/dashboard/summary", headers=b.headers).json()
    assert b_summary["cash_balance"] == 0.0
    assert b_summary["today_income"] == 0.0
