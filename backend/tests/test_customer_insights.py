"""E2E: customer aging buckets and smart-list insights."""

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_ledger


def test_aging_buckets(user, client):
    c = add_customer(client, user.headers, full_name="Aging Co")
    # Unpaid credits at different ages.
    add_ledger(client, user.headers, c["id"], type="credit", amount=1000,
               date=today_iso(), client_id="ag-cur")
    add_ledger(client, user.headers, c["id"], type="credit", amount=2000,
               date=days_ago_iso(15), client_id="ag-15")
    add_ledger(client, user.headers, c["id"], type="credit", amount=3000,
               date=days_ago_iso(45), client_id="ag-45")
    add_ledger(client, user.headers, c["id"], type="credit", amount=5000,
               date=days_ago_iso(120), client_id="ag-120")

    b = client.get("/api/v1/customer-aging", headers=user.headers).json()["buckets"]
    assert b["current"] == 1000
    assert b["d1_30"] == 2000
    assert b["d31_60"] == 3000
    assert b["d90_plus"] == 5000


def test_aging_fifo_applies_payments_to_oldest(user, client):
    c = add_customer(client, user.headers, full_name="FIFO Co")
    add_ledger(client, user.headers, c["id"], type="credit", amount=4000,
               date=days_ago_iso(120), client_id="f-old")  # oldest
    add_ledger(client, user.headers, c["id"], type="credit", amount=2000,
               date=today_iso(), client_id="f-new")
    # A 4000 payment clears the oldest credit entirely.
    add_ledger(client, user.headers, c["id"], type="payment", amount=4000,
               date=today_iso(), client_id="f-pay")

    b = client.get("/api/v1/customer-aging", headers=user.headers).json()["buckets"]
    assert b["d90_plus"] == 0      # oldest fully paid
    assert b["current"] == 2000    # newest remains


def test_insights_lists(user, client):
    big = add_customer(client, user.headers, full_name="Big Debtor")
    add_ledger(client, user.headers, big["id"], type="credit", amount=9000,
               date=days_ago_iso(45), client_id="i-big")  # overdue + high risk
    payer = add_customer(client, user.headers, full_name="Payer")
    add_ledger(client, user.headers, payer["id"], type="credit", amount=1000,
               date=today_iso(), client_id="i-c")
    add_ledger(client, user.headers, payer["id"], type="payment", amount=1000,
               date=today_iso(), client_id="i-p")

    data = client.get("/api/v1/customer-insights", headers=user.headers).json()
    assert data["top_debtors"][0]["name"] == "Big Debtor"
    assert data["overdue_count"] >= 1
    assert any(r["name"] == "Big Debtor" for r in data["overdue"])
    assert any(r["name"] == "Payer" and r["amount"] == 1000 for r in data["paid_this_month"])
    assert any(r["name"] == "Big Debtor" for r in data["high_risk"])


def test_insights_requires_auth(client):
    assert client.get("/api/v1/customer-insights").status_code in (401, 403)
