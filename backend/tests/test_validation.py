"""Server-side validation is the authoritative gate — never trust the client.

These hit the real endpoints with payloads a tampered/buggy client could send
(negative or absurd amounts, malformed phone numbers) and assert the server
rejects them with a human 422, so bad data never reaches the database.
"""

from conftest import today_iso


def _income(client, headers, amount):
    return client.post(
        "/api/v1/incomes",
        headers=headers,
        data={
            "amount": str(amount),
            "category": "Sales",
            "date": today_iso(),
            "client_id": f"inc-{amount}",
        },
    )


def _expense(client, headers, amount):
    return client.post(
        "/api/v1/expenses",
        headers=headers,
        data={
            "amount": str(amount),
            "category": "Fuel",
            "date": today_iso(),
            "vendor": "HP",
            "client_id": f"exp-{amount}",
        },
    )


# --- Amount ----------------------------------------------------------------

def test_income_rejects_non_positive_amount(user, client):
    for bad in ("0", "-50"):
        r = _income(client, user.headers, bad)
        assert r.status_code == 422, r.text
        assert "₹0" in r.json()["detail"]


def test_income_rejects_absurdly_large_amount(user, client):
    r = _income(client, user.headers, 99_999_999)
    assert r.status_code == 422
    assert "too large" in r.json()["detail"].lower()


def test_income_rejects_nan(user, client):
    r = _income(client, user.headers, "nan")
    assert r.status_code == 422


def test_income_accepts_a_valid_amount(user, client):
    r = _income(client, user.headers, 2500)
    assert r.status_code == 200, r.text


def test_expense_rejects_non_positive_amount(user, client):
    r = _expense(client, user.headers, "-1")
    assert r.status_code == 422


def test_ledger_rejects_bad_amount_and_type(make_user, client):
    u = make_user()
    r = client.post(
        "/api/v1/customers", headers=u.headers, json={"full_name": "Sita", "mobile": "9876500001"}
    )
    cid = r.json()["id"]

    r = client.post(
        f"/api/v1/customers/{cid}/ledger",
        headers=u.headers,
        data={"type": "credit", "amount": "0", "date": today_iso(), "client_id": "l1"},
    )
    assert r.status_code == 422, r.text

    r = client.post(
        f"/api/v1/customers/{cid}/ledger",
        headers=u.headers,
        data={"type": "bogus", "amount": "100", "date": today_iso(), "client_id": "l2"},
    )
    assert r.status_code == 422, r.text


# --- Mobile ----------------------------------------------------------------

def test_otp_request_rejects_malformed_mobile(client):
    for bad in ("12345", "1234567890", "abcd", ""):
        r = client.post("/api/v1/auth/otp/request", json={"mobile": bad})
        assert r.status_code == 422, f"{bad!r} -> {r.status_code}"


def test_otp_request_accepts_valid_mobile(client):
    r = client.post("/api/v1/auth/otp/request", json={"mobile": "9876543210"})
    assert r.status_code == 200, r.text


def test_customer_rejects_bad_mobile_but_allows_empty(make_user, client):
    u = make_user()
    # A malformed number is rejected...
    r = client.post(
        "/api/v1/customers", headers=u.headers, json={"full_name": "X", "mobile": "12345"}
    )
    assert r.status_code == 422, r.text
    # ...but party-by-name (no mobile) is still allowed.
    r = client.post(
        "/api/v1/customers", headers=u.headers, json={"full_name": "By Name", "mobile": ""}
    )
    assert r.status_code == 200, r.text


def test_customer_normalizes_mobile(make_user, client):
    u = make_user()
    r = client.post(
        "/api/v1/customers",
        headers=u.headers,
        json={"full_name": "Norm", "mobile": "+91 98765-43299"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["mobile"] == "9876543299"


# --- Friendly validation body ---------------------------------------------

def test_missing_required_field_returns_human_message(user, client):
    """A Pydantic-level failure (missing field) → one clean sentence, not the
    verbose default error array."""
    r = client.post("/api/v1/auth/otp/request", json={})  # missing 'mobile'
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert isinstance(detail, str)
    assert "check the details" in detail.lower()
