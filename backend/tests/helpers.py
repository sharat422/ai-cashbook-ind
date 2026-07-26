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


def add_customer(client, headers, *, full_name="Ramesh Traders", mobile="8888888888", **extra):
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
