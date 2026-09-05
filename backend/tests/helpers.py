"""Small request helpers so the E2E tests read like user journeys.

Each mirrors exactly how the mobile app calls the API: incomes/expenses/ledger
are multipart form posts (they can carry an attachment); customers is JSON.
"""


def add_income(client, headers, *, amount, date, category="Sales", client_id, notes=None):
    data = {
        "amount": str(amount),
        "category": category,
        "date": date,
        "client_id": client_id,
    }
    if notes is not None:
        data["notes"] = notes
    r = client.post("/api/v1/incomes", headers=headers, data=data)
    assert r.status_code == 200, r.text
    return r.json()


def add_expense(client, headers, *, amount, date, category="Fuel", vendor="HP Petrol", client_id, notes=None):
    data = {
        "amount": str(amount),
        "category": category,
        "vendor": vendor,
        "date": date,
        "client_id": client_id,
    }
    if notes is not None:
        data["notes"] = notes
    r = client.post("/api/v1/expenses", headers=headers, data=data)
    assert r.status_code == 200, r.text
    return r.json()


_mobile_seq = 8_000_000_000


def add_customer(client, headers, *, full_name="Ramesh Traders", mobile=None, **extra):
    # A mobile is unique per business (see _assert_mobile_unique), so default to a
    # fresh valid 10-digit number each call unless the test pins one explicitly.
    global _mobile_seq
    if mobile is None:
        _mobile_seq += 1
        mobile = str(_mobile_seq)
    body = {"full_name": full_name, "mobile": mobile, **extra}
    r = client.post("/api/v1/customers", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def add_ledger(client, headers, customer_id, *, type, amount, date, client_id, **extra):
    data = {
        "type": type,
        "amount": str(amount),
        "date": date,
        "client_id": client_id,
        **{k: str(v) for k, v in extra.items()},
    }
    r = client.post(f"/api/v1/customers/{customer_id}/ledger", headers=headers, data=data)
    assert r.status_code == 200, r.text
    return r.json()
