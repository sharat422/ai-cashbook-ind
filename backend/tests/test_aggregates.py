"""E2E: dashboard summary, daily summary, and khata (credit-ledger) summary."""

from conftest import today_iso
from helpers import add_customer, add_expense, add_income, add_ledger


def test_dashboard_summary(user, client):
    today = today_iso()
    add_income(client, user.headers, amount=5000, date=today, client_id="d-i1")
    add_expense(client, user.headers, amount=1200, date=today, vendor="HP", client_id="d-e1")

    s = client.get("/api/v1/dashboard/summary", headers=user.headers).json()
    assert s["today_income"] == 5000.0
    assert s["today_expense"] == 1200.0
    assert s["cash_balance"] == 3800.0
    assert s["month_revenue"] == 5000.0
    assert s["month_expense"] == 1200.0
    assert "as_of" in s


def test_daily_summary_profit_and_top_categories(user, client):
    day = "2026-06-17"
    add_income(client, user.headers, amount=5000, date=day, client_id="ds-i1")
    add_expense(client, user.headers, amount=1200, date=day, category="Fuel",
                vendor="HP", client_id="ds-e1")
    add_expense(client, user.headers, amount=800, date=day, category="Food",
                vendor="Cafe", client_id="ds-e2")

    s = client.get(f"/api/v1/summary/daily?date={day}", headers=user.headers).json()
    assert s["income"] == 5000.0
    assert s["expense"] == 2000.0
    assert s["profit"] == 3000.0
    assert s["transaction_count"] == 3
    # Fuel is the biggest expense category → first, with a 0..1 share.
    top = s["top_expense_categories"]
    assert top[0]["category"] == "Fuel"
    assert abs(top[0]["share"] - 0.6) < 1e-6


def test_khata_summary_receivable(user, client):
    c = add_customer(client, user.headers)
    add_ledger(client, user.headers, c["id"], type="credit", amount=3000,
               date=today_iso(), client_id="k-1")
    ks = client.get(
        "/api/v1/khata/summary?from=2026-06-01&to=2026-06-30", headers=user.headers
    ).json()
    assert ks["total_receivable"] == 3000.0
    assert ks["total_payable"] == 0.0
    assert ks["top_defaulters"][0]["amount"] == 3000.0


def test_khata_summary_payable_when_overpaid(user, client):
    """Payments exceeding credit make the customer a payable (negative balance)."""
    c = add_customer(client, user.headers)
    add_ledger(client, user.headers, c["id"], type="credit", amount=1000,
               date=today_iso(), client_id="k-c")
    add_ledger(client, user.headers, c["id"], type="payment", amount=1500,
               date=today_iso(), client_id="k-p")
    ks = client.get(
        "/api/v1/khata/summary?from=2026-06-01&to=2026-06-30", headers=user.headers
    ).json()
    assert ks["total_receivable"] == 0.0
    assert ks["total_payable"] == 500.0


def test_khata_today_collections(user, client):
    c = add_customer(client, user.headers)
    add_ledger(client, user.headers, c["id"], type="credit", amount=2000,
               date=today_iso(), client_id="k-c2")
    add_ledger(client, user.headers, c["id"], type="payment", amount=700,
               date=today_iso(), client_id="k-p2")
    ks = client.get(
        f"/api/v1/khata/summary?from={today_iso()}&to={today_iso()}", headers=user.headers
    ).json()
    assert ks["today_collections"] == 700.0
