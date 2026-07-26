"""E2E: customer CRUD, ledger recompute, and overdue detection."""

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_ledger


def test_create_and_get_customer(user, client):
    c = add_customer(client, user.headers, full_name="Ramesh Traders", mobile="8888888888")
    assert c["outstanding_amount"] == 0.0
    fetched = client.get(f"/api/v1/customers/{c['id']}", headers=user.headers)
    assert fetched.status_code == 200
    assert fetched.json()["full_name"] == "Ramesh Traders"


def test_get_missing_customer_is_404(user, client):
    r = client.get("/api/v1/customers/does-not-exist", headers=user.headers)
    assert r.status_code == 404


def test_update_customer(user, client):
    c = add_customer(client, user.headers)
    r = client.patch(
        f"/api/v1/customers/{c['id']}",
        headers=user.headers,
        json={"full_name": "Renamed", "mobile": "7777777777", "notes": "VIP"},
    )
    assert r.status_code == 200
    assert r.json()["full_name"] == "Renamed"
    assert r.json()["notes"] == "VIP"


def test_delete_customer(user, client):
    c = add_customer(client, user.headers)
    assert client.delete(f"/api/v1/customers/{c['id']}", headers=user.headers).status_code == 204
    assert client.get(f"/api/v1/customers/{c['id']}", headers=user.headers).status_code == 404


def test_list_customers_search_and_pagination(user, client):
    for i in range(3):
        add_customer(client, user.headers, full_name=f"Alpha {i}", mobile=f"90000000{i:02d}")
    add_customer(client, user.headers, full_name="Bravo One", mobile="9111111111")

    # Search narrows by name.
    found = client.get("/api/v1/customers?search=Bravo", headers=user.headers).json()
    assert found["total"] == 1
    assert found["items"][0]["full_name"] == "Bravo One"

    # Pagination: page size 2 over 4 customers yields a next_cursor.
    page1 = client.get("/api/v1/customers?limit=2", headers=user.headers).json()
    assert page1["total"] == 4
    assert page1["next_cursor"] is not None
    page2 = client.get(
        f"/api/v1/customers?limit=2&cursor={page1['next_cursor']}", headers=user.headers
    ).json()
    ids = {c["id"] for c in page1["items"]} | {c["id"] for c in page2["items"]}
    assert len(ids) == 4  # no overlap across pages


def test_ledger_credit_increases_outstanding(user, client):
    c = add_customer(client, user.headers)
    add_ledger(client, user.headers, c["id"], type="credit", amount=3000,
               date=today_iso(), client_id="led-1")
    refreshed = client.get(f"/api/v1/customers/{c['id']}", headers=user.headers).json()
    assert refreshed["outstanding_amount"] == 3000.0


def test_ledger_payment_reduces_outstanding(user, client):
    c = add_customer(client, user.headers)
    add_ledger(client, user.headers, c["id"], type="credit", amount=3000,
               date=today_iso(), client_id="led-c")
    add_ledger(client, user.headers, c["id"], type="payment", amount=1000,
               date=today_iso(), client_id="led-p")
    refreshed = client.get(f"/api/v1/customers/{c['id']}", headers=user.headers).json()
    assert refreshed["outstanding_amount"] == 2000.0


def test_ledger_is_idempotent(user, client):
    c = add_customer(client, user.headers)
    a = add_ledger(client, user.headers, c["id"], type="credit", amount=500,
                   date=today_iso(), client_id="led-dup")
    b = add_ledger(client, user.headers, c["id"], type="credit", amount=500,
                   date=today_iso(), client_id="led-dup")
    assert a["id"] == b["id"]
    refreshed = client.get(f"/api/v1/customers/{c['id']}", headers=user.headers).json()
    assert refreshed["outstanding_amount"] == 500.0  # not double-counted


def test_recent_credit_is_not_overdue(user, client):
    c = add_customer(client, user.headers)
    add_ledger(client, user.headers, c["id"], type="credit", amount=1000,
               date=today_iso(), client_id="led-fresh")
    refreshed = client.get(f"/api/v1/customers/{c['id']}", headers=user.headers).json()
    assert refreshed["is_overdue"] is False


def test_old_outstanding_credit_is_overdue(user, client):
    """Outstanding > 0 and last activity older than 30 days → overdue."""
    c = add_customer(client, user.headers)
    add_ledger(client, user.headers, c["id"], type="credit", amount=1000,
               date=days_ago_iso(45), client_id="led-old")
    refreshed = client.get(f"/api/v1/customers/{c['id']}", headers=user.headers).json()
    assert refreshed["is_overdue"] is True
