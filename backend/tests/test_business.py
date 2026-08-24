"""E2E: the /business/summary morning digest + profit + trends + forecast."""

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_expense, add_income, add_ledger


def test_business_summary(user, client):
    # Today's + yesterday's activity.
    add_income(client, user.headers, amount=8000, date=today_iso(), client_id="b-i-today")
    add_income(client, user.headers, amount=5000, date=days_ago_iso(1), client_id="b-i-yday")
    add_expense(client, user.headers, amount=800, date=today_iso(), vendor="X", client_id="b-e-today")
    add_expense(client, user.headers, amount=1200, date=days_ago_iso(1), vendor="Y", client_id="b-e-yday")

    c = add_customer(client, user.headers, full_name="BizCo")
    add_ledger(client, user.headers, c["id"], type="credit", amount=3000,
               date=today_iso(), client_id="b-cr")
    add_ledger(client, user.headers, c["id"], type="payment", amount=2000,
               date=days_ago_iso(1), client_id="b-pay")

    s = client.get("/api/v1/business/summary", headers=user.headers).json()

    # Yesterday digest (#26)
    assert s["yesterday"]["sales"] == 5000
    assert s["yesterday"]["expenses"] == 1200
    assert s["yesterday"]["collections"] == 2000

    # Receivables
    assert s["outstanding"] == 1000  # 3000 credit − 2000 payment
    assert s["expected_collection_today"] > 0

    # Profit dashboard (#29) — consistency + includes today's ₹8,000 sale
    assert s["month"]["sales"] >= 8000
    assert s["month"]["profit"] == s["month"]["sales"] - s["month"]["expenses"]

    # Trends (#30) + forecast (#31) present
    assert "sales_pct" in s["trends"]
    assert "expected_collections" in s["forecast"]
    assert "net" in s["forecast"]


def test_business_summary_requires_auth(client):
    assert client.get("/api/v1/business/summary").status_code in (401, 403)
