"""Recurring expenses: pure scheduling logic + CRUD + posting occurrences."""

import pytest
from conftest import days_ago_iso, today_iso

from app.recurring import add_months, catch_up, is_due, next_occurrence


# --- Pure scheduling logic (no DB) -----------------------------------------

def test_weekly_and_custom_add_days():
    assert next_occurrence("2026-01-01", "weekly") == "2026-01-08"
    assert next_occurrence("2026-01-01", "weekly", 2) == "2026-01-15"
    assert next_occurrence("2026-01-01", "custom", 10) == "2026-01-11"


def test_monthly_clamps_short_months():
    # Jan 31 + 1 month must clamp to Feb 28 (2026 is not a leap year).
    assert next_occurrence("2026-01-31", "monthly") == "2026-02-28"
    # …and roll over the year end.
    assert next_occurrence("2026-12-15", "monthly") == "2027-01-15"


def test_monthly_anchor_day_returns_to_intended_day():
    # A rent due on the 31st keeps its intent: Feb clamps to 28, then Mar → 31.
    feb = next_occurrence("2026-01-31", "monthly", anchor_day=31)
    assert feb == "2026-02-28"
    mar = next_occurrence(feb, "monthly", anchor_day=31)
    assert mar == "2026-03-31"


def test_yearly_handles_leap_day():
    assert next_occurrence("2024-02-29", "yearly") == "2025-02-28"
    assert next_occurrence("2026-06-01", "yearly", 2) == "2028-06-01"


def test_add_months_helper():
    assert add_months(__import__("datetime").date(2026, 1, 31), 1).isoformat() == "2026-02-28"


def test_interval_must_be_positive():
    with pytest.raises(ValueError):
        next_occurrence("2026-01-01", "monthly", 0)


def test_is_due_and_catch_up():
    assert is_due("2026-01-01", "2026-01-01") is True
    assert is_due("2026-02-01", "2026-01-01") is False
    # A monthly template last due 3 months ago catches up to a future date.
    start = days_ago_iso(95)
    nxt = catch_up(start, "monthly", 1, today_iso())
    assert nxt > today_iso()


# --- API: CRUD --------------------------------------------------------------

def _make(client, headers, **over):
    body = {
        "name": "Shop rent",
        "amount": 15000,
        "category": "Rent",
        "vendor": "Landlord",
        "frequency": "monthly",
        "interval": 1,
        "next_due_date": today_iso(),
        **over,
    }
    r = client.post("/api/v1/recurring-expenses", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_lists_and_flags_due(user, client):
    rec = _make(client, user.headers)
    assert rec["name"] == "Shop rent"
    assert rec["frequency"] == "monthly"
    assert rec["anchor_day"] == int(today_iso()[8:10])  # derived from due date
    assert rec["is_due"] is True  # due today

    listing = client.get("/api/v1/recurring-expenses", headers=user.headers).json()
    assert listing["due_count"] == 1
    assert listing["due_total"] == 15000
    assert listing["monthly_total"] == 15000  # one monthly template


def test_future_template_is_not_due(user, client):
    rec = _make(client, user.headers, next_due_date="2099-01-01")
    assert rec["is_due"] is False
    listing = client.get("/api/v1/recurring-expenses", headers=user.headers).json()
    assert listing["due_count"] == 0


def test_validation_rejects_bad_input(user, client):
    for bad in ({"amount": 0}, {"frequency": "hourly"}, {"interval": 0}, {"name": "  "}):
        r = client.post(
            "/api/v1/recurring-expenses",
            headers=user.headers,
            json={
                "name": "X",
                "amount": 100,
                "category": "Rent",
                "frequency": "monthly",
                "interval": 1,
                "next_due_date": today_iso(),
                **bad,
            },
        )
        assert r.status_code == 422, r.text


def test_update_and_delete(user, client):
    rec = _make(client, user.headers)
    upd = client.patch(
        f"/api/v1/recurring-expenses/{rec['id']}",
        headers=user.headers,
        json={
            "name": "Shop rent",
            "amount": 18000,
            "category": "Rent",
            "vendor": "Landlord",
            "frequency": "monthly",
            "interval": 1,
            "next_due_date": today_iso(),
            "active": False,
        },
    )
    assert upd.status_code == 200
    assert upd.json()["amount"] == 18000
    assert upd.json()["active"] is False
    assert upd.json()["is_due"] is False  # inactive is never "due"

    assert (
        client.delete(
            f"/api/v1/recurring-expenses/{rec['id']}", headers=user.headers
        ).status_code
        == 204
    )
    listing = client.get("/api/v1/recurring-expenses", headers=user.headers).json()
    assert all(i["id"] != rec["id"] for i in listing["items"])


# --- API: posting an occurrence --------------------------------------------

def test_post_creates_expense_and_advances(user, client):
    rec = _make(client, user.headers, next_due_date=today_iso())
    due = rec["next_due_date"]

    r = client.post(
        f"/api/v1/recurring-expenses/{rec['id']}/post", headers=user.headers
    )
    assert r.status_code == 200, r.text
    payload = r.json()

    # An expense was created at the due date.
    assert payload["expense"]["amount"] == 15000
    assert payload["expense"]["date"] == due
    assert payload["expense"]["category"] == "Rent"

    # The schedule advanced to a future date and recorded last posted.
    assert payload["recurring"]["last_posted_date"] == due
    assert payload["recurring"]["next_due_date"] > today_iso()
    assert payload["recurring"]["is_due"] is False

    # It really landed in the expense ledger.
    expenses = client.get("/api/v1/expenses", headers=user.headers).json()
    assert any(e["date"] == due and e["amount"] == 15000 for e in expenses)


def test_post_is_idempotent_per_due_date(user, client):
    """Double-tapping "post" for the same due date must not double-charge."""
    rec = _make(client, user.headers, next_due_date=today_iso())
    first = client.post(
        f"/api/v1/recurring-expenses/{rec['id']}/post", headers=user.headers
    ).json()
    # Force the template back to the same due date, then post again.
    client.patch(
        f"/api/v1/recurring-expenses/{rec['id']}",
        headers=user.headers,
        json={
            "name": "Shop rent",
            "amount": 15000,
            "category": "Rent",
            "vendor": "Landlord",
            "frequency": "monthly",
            "interval": 1,
            "next_due_date": first["recurring"]["last_posted_date"],
        },
    )
    second = client.post(
        f"/api/v1/recurring-expenses/{rec['id']}/post", headers=user.headers
    ).json()
    assert first["expense"]["id"] == second["expense"]["id"]


def test_recurring_isolated_and_authed(make_user, client):
    a = make_user()
    b = make_user()
    rec = _make(client, a.headers, name="A only")
    # B cannot see, post, or delete A's template.
    assert client.get("/api/v1/recurring-expenses", headers=b.headers).json()["items"] == []
    assert (
        client.post(
            f"/api/v1/recurring-expenses/{rec['id']}/post", headers=b.headers
        ).status_code
        == 404
    )
    assert client.get("/api/v1/recurring-expenses").status_code in (401, 403)
