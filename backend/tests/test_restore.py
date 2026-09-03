"""GET /restore/summary — the counts the app uses to offer a restore step."""

from conftest import today_iso


def _add_income(client, headers, amount=100.0):
    return client.post(
        "/api/v1/incomes",
        headers=headers,
        data={
            "amount": str(amount),
            "category": "Sales",
            "date": today_iso(),
            "client_id": f"inc-{amount}-{today_iso()}",
        },
    )


def _add_expense(client, headers, amount=50.0):
    return client.post(
        "/api/v1/expenses",
        headers=headers,
        data={
            "amount": str(amount),
            "category": "Fuel",
            "date": today_iso(),
            "vendor": "HP",
            "client_id": f"exp-{amount}-{today_iso()}",
        },
    )


def test_restore_summary_zero_for_fresh_business(user, client):
    r = client.get("/api/v1/restore/summary", headers=user.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {
        "incomes": 0,
        "expenses": 0,
        "customers": 0,
        "ledger_entries": 0,
        "transactions": 0,
        "total": 0,
    }


def test_restore_summary_counts_all_data(make_user, client):
    u = make_user()
    assert _add_income(client, u.headers, 200).status_code == 200
    assert _add_income(client, u.headers, 300).status_code == 200
    assert _add_expense(client, u.headers, 75).status_code == 200

    # A customer with a ledger entry.
    r = client.post(
        "/api/v1/customers",
        headers=u.headers,
        json={"full_name": "Ramesh", "mobile": "9876543210"},
    )
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    r = client.post(
        f"/api/v1/customers/{cid}/ledger",
        headers=u.headers,
        data={
            "type": "credit",
            "amount": "500",
            "date": today_iso(),
            "client_id": "led-1",
        },
    )
    assert r.status_code in (200, 201), r.text

    body = client.get("/api/v1/restore/summary", headers=u.headers).json()
    assert body["incomes"] == 2
    assert body["expenses"] == 1
    assert body["transactions"] == 3
    assert body["customers"] == 1
    assert body["ledger_entries"] == 1
    assert body["total"] == 5


def test_restore_summary_is_business_scoped(make_user, client):
    """One tenant's data never leaks into another's restore counts."""
    a = make_user()
    b = make_user()
    _add_income(client, a.headers, 999)

    body_b = client.get("/api/v1/restore/summary", headers=b.headers).json()
    assert body_b["total"] == 0

    body_a = client.get("/api/v1/restore/summary", headers=a.headers).json()
    assert body_a["incomes"] == 1


def test_restore_summary_requires_auth(client):
    r = client.get("/api/v1/restore/summary")
    assert r.status_code in (401, 403)
