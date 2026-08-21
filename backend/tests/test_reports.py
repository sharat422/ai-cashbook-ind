"""E2E: the /reports/summary Profit & Loss + category-breakdown report."""

from helpers import add_expense, add_income


def test_profit_loss_and_category_breakdown(user, client):
    add_income(client, user.headers, amount=5000, date="2026-06-10", category="Sales", client_id="r-i1")
    add_income(client, user.headers, amount=2000, date="2026-06-12", category="Services", client_id="r-i2")
    add_expense(client, user.headers, amount=1200, date="2026-06-11", category="Fuel",
                vendor="HP", client_id="r-e1")
    add_expense(client, user.headers, amount=800, date="2026-06-13", category="Food",
                vendor="Cafe", client_id="r-e2")

    r = client.get(
        "/api/v1/reports/summary?from=2026-06-01&to=2026-06-30", headers=user.headers
    )
    assert r.status_code == 200
    data = r.json()
    assert data["income_total"] == 7000.0
    assert data["expense_total"] == 2000.0
    assert data["profit"] == 5000.0
    assert data["income_count"] == 2
    assert data["expense_count"] == 2

    # Biggest expense category first, with a 0..1 share summing to 1.
    exp = data["expense_by_category"]
    assert exp[0]["category"] == "Fuel"
    assert abs(sum(c["share"] for c in exp) - 1.0) < 1e-6


def test_report_respects_date_range(user, client):
    add_income(client, user.headers, amount=999, date="2026-05-31", category="Sales", client_id="r-old")
    add_income(client, user.headers, amount=100, date="2026-06-15", category="Sales", client_id="r-in")

    r = client.get(
        "/api/v1/reports/summary?from=2026-06-01&to=2026-06-30", headers=user.headers
    ).json()
    # The May entry is excluded.
    assert r["income_total"] == 100.0
    assert r["income_count"] == 1


def test_report_requires_auth(client):
    r = client.get("/api/v1/reports/summary?from=2026-06-01&to=2026-06-30")
    assert r.status_code in (401, 403)
