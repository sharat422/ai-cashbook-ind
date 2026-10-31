"""Server-side copies of the app's form rules: a tampered or outdated client
gets a human 422 instead of persisting data the app would have blocked."""

from datetime import date, timedelta
from uuid import uuid4

import pytest

from conftest import today_iso
from helpers import add_customer, add_expense, add_income
from app.database import SessionLocal
from app.models import Income


def _tomorrow() -> str:
    return (date.fromisoformat(today_iso()) + timedelta(days=1)).isoformat()


def _post(client, headers, kind, **over):
    data = {"amount": "100", "category": "Sales", "date": today_iso(),
            "vendor": "HP", "client_id": uuid4().hex, **over}
    return client.post(f"/api/v1/{kind}", headers=headers, data=data)


# --- Incomes / expenses -------------------------------------------------------

@pytest.mark.parametrize("kind", ["incomes", "expenses"])
def test_future_date_rejected(user, client, kind):
    r = _post(client, user.headers, kind, date=_tomorrow())
    assert r.status_code == 422
    assert r.json()["detail"] == "Date can't be in the future."


@pytest.mark.parametrize("kind", ["incomes", "expenses"])
def test_today_is_accepted(user, client, kind):
    assert _post(client, user.headers, kind, date=today_iso()).status_code == 200


def test_income_notes_capped_at_280(user, client):
    add_income(client, user.headers, amount=1, date=today_iso(),
               client_id="n280", notes="x" * 280)
    r = _post(client, user.headers, "incomes", notes="x" * 281)
    assert r.status_code == 422
    assert r.json()["detail"] == "Notes must be 280 characters or fewer."


def test_expense_notes_capped_at_5000_for_receipt_text(user, client):
    # Expenses carry full receipt transcriptions, so their cap is higher.
    add_expense(client, user.headers, amount=1, date=today_iso(),
                client_id="n5000", notes="x" * 5000)
    r = _post(client, user.headers, "expenses", notes="x" * 5001)
    assert r.status_code == 422
    assert r.json()["detail"] == "Notes must be 5000 characters or fewer."


# --- Customers ----------------------------------------------------------------

def test_customer_mobile_is_optional_for_name_only_parties(user, client):
    # Deliberately optional: AI/voice entry creates customers by name only.
    # The app's customer form still requires a mobile.
    assert add_customer(client, user.headers, full_name="Walk-in", mobile="")["mobile"] == ""


# --- Items --------------------------------------------------------------------

def _item(client, headers, method="post", path="/api/v1/items", **over):
    body = {"name": "Ring", "sale_price": 100, "purchase_price": 80,
            "gst_rate": 3, **over}
    return client.request(method.upper(), path, headers=headers, json=body)


@pytest.mark.parametrize("field,label", [
    ("sale_price", "Sale price"), ("purchase_price", "Purchase price"),
])
def test_item_negative_price_rejected(user, client, field, label):
    r = _item(client, user.headers, **{field: -1})
    assert r.status_code == 422
    assert r.json()["detail"] == f"{label} can't be negative."


@pytest.mark.parametrize("rate", [0, 0.25, 3, 5, 12, 18, 28])
def test_item_valid_gst_rates_accepted(user, client, rate):
    assert _item(client, user.headers, gst_rate=rate).status_code == 200


@pytest.mark.parametrize("rate", [7, -5, 100])
def test_item_invalid_gst_rate_rejected(user, client, rate):
    r = _item(client, user.headers, gst_rate=rate)
    assert r.status_code == 422
    assert "GST rate must be one of" in r.json()["detail"]


def test_item_patch_validated_too(user, client):
    item = _item(client, user.headers).json()
    path = f"/api/v1/items/{item['id']}"
    assert _item(client, user.headers, "patch", path, sale_price=-1).status_code == 422
    assert _item(client, user.headers, "patch", path, gst_rate=7).status_code == 422
    assert client.get(path, headers=user.headers).json()["sale_price"] == 100


# --- Feedback -----------------------------------------------------------------

def test_feedback_over_2000_chars_rejected(user, client):
    ok = client.post("/api/v1/feedback", headers=user.headers, json={"message": "x" * 2000})
    assert ok.status_code == 200
    r = client.post("/api/v1/feedback", headers=user.headers, json={"message": "x" * 2001})
    assert r.status_code == 422
    assert r.json()["detail"] == "Feedback must be 2,000 characters or fewer."


# --- Dashboard ignores legacy future-dated rows -------------------------------

def test_dashboard_excludes_future_dated_rows(user, client):
    add_income(client, user.headers, amount=500, date=today_iso(), client_id="dash-now")
    with SessionLocal() as s:  # simulate a row saved before validation existed
        s.add(Income(business_id=user.business["id"], amount=9000, category="Sales",
                     date=_tomorrow(), client_id="dash-future"))
        s.commit()
    summary = client.get("/api/v1/dashboard/summary", headers=user.headers).json()
    assert summary["today_income"] == 500
    assert summary["cash_balance"] == 500
