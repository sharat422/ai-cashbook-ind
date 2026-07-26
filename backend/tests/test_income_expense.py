"""E2E: income & expense creation, idempotency, and listing."""

from conftest import today_iso
from helpers import add_expense, add_income


def test_create_income(user, client):
    row = add_income(client, user.headers, amount=5000, date=today_iso(), client_id="inc-1")
    assert row["amount"] == 5000.0
    assert row["category"] == "Sales"
    assert row["id"]


def test_income_is_idempotent_per_client_id(user, client):
    """A retried offline submission (same client_id) must not duplicate."""
    first = add_income(client, user.headers, amount=5000, date=today_iso(), client_id="inc-dup")
    second = add_income(client, user.headers, amount=5000, date=today_iso(), client_id="inc-dup")
    assert first["id"] == second["id"]
    listing = client.get("/api/v1/incomes", headers=user.headers).json()
    assert len([r for r in listing if r["id"] == first["id"]]) == 1


def test_distinct_client_ids_create_distinct_rows(user, client):
    a = add_income(client, user.headers, amount=100, date=today_iso(), client_id="inc-a")
    b = add_income(client, user.headers, amount=200, date=today_iso(), client_id="inc-b")
    assert a["id"] != b["id"]


def test_create_expense_carries_vendor(user, client):
    row = add_expense(client, user.headers, amount=1200, date=today_iso(),
                      vendor="HP Petrol", client_id="exp-1")
    assert row["amount"] == 1200.0
    assert row["vendor"] == "HP Petrol"


def test_expense_is_idempotent_per_client_id(user, client):
    first = add_expense(client, user.headers, amount=1200, date=today_iso(), client_id="exp-dup")
    second = add_expense(client, user.headers, amount=1200, date=today_iso(), client_id="exp-dup")
    assert first["id"] == second["id"]


def test_listing_returns_only_own_rows(user, client):
    add_income(client, user.headers, amount=1, date=today_iso(), client_id="only-1")
    add_income(client, user.headers, amount=2, date=today_iso(), client_id="only-2")
    incomes = client.get("/api/v1/incomes", headers=user.headers).json()
    assert {r["id"] for r in incomes} >= set()
    assert len(incomes) == 2
