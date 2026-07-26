"""E2E: the unified /transactions feed — merge, filter, search, sort, paginate."""

from conftest import today_iso
from helpers import add_expense, add_income


def _seed(client, headers):
    add_income(client, headers, amount=5000, date="2026-06-10", category="Sales", client_id="t-i1")
    add_income(client, headers, amount=2000, date="2026-06-12", category="Interest", client_id="t-i2")
    add_expense(client, headers, amount=1200, date="2026-06-11", category="Fuel",
                vendor="HP Petrol", client_id="t-e1")
    add_expense(client, headers, amount=800, date="2026-06-13", category="Food",
                vendor="Cafe Coffee", client_id="t-e2")


def test_feed_merges_income_and_expense(user, client):
    _seed(client, user.headers)
    body = client.get("/api/v1/transactions?limit=50", headers=user.headers).json()
    assert body["total"] == 4
    kinds = {r["type"] for r in body["items"]}
    assert kinds == {"income", "expense"}


def test_filter_by_type(user, client):
    _seed(client, user.headers)
    inc = client.get("/api/v1/transactions?type=income&limit=50", headers=user.headers).json()
    assert inc["total"] == 2
    assert all(r["type"] == "income" for r in inc["items"])
    exp = client.get("/api/v1/transactions?type=expense&limit=50", headers=user.headers).json()
    assert exp["total"] == 2
    assert all(r["type"] == "expense" for r in exp["items"])


def test_filter_by_category(user, client):
    _seed(client, user.headers)
    body = client.get("/api/v1/transactions?categories=Fuel&limit=50", headers=user.headers).json()
    assert body["total"] == 1
    assert body["items"][0]["category"] == "Fuel"


def test_filter_by_date_range(user, client):
    _seed(client, user.headers)
    body = client.get(
        "/api/v1/transactions?date_from=2026-06-11&date_to=2026-06-12&limit=50",
        headers=user.headers,
    ).json()
    dates = sorted(r["date"] for r in body["items"])
    assert dates == ["2026-06-11", "2026-06-12"]


def test_search_matches_vendor(user, client):
    _seed(client, user.headers)
    body = client.get("/api/v1/transactions?search=petrol&limit=50", headers=user.headers).json()
    assert body["total"] == 1
    assert body["items"][0]["vendor"] == "HP Petrol"


def test_sort_by_amount_desc(user, client):
    _seed(client, user.headers)
    body = client.get(
        "/api/v1/transactions?sort_by=amount&sort_dir=desc&limit=50", headers=user.headers
    ).json()
    amounts = [r["amount"] for r in body["items"]]
    assert amounts == sorted(amounts, reverse=True)
    assert amounts[0] == 5000.0


def test_pagination_cursor(user, client):
    _seed(client, user.headers)
    page1 = client.get("/api/v1/transactions?limit=2", headers=user.headers).json()
    assert page1["total"] == 4
    assert page1["next_cursor"] is not None
    page2 = client.get(
        f"/api/v1/transactions?limit=2&cursor={page1['next_cursor']}", headers=user.headers
    ).json()
    ids = {r["id"] for r in page1["items"]} | {r["id"] for r in page2["items"]}
    assert len(ids) == 4
    assert page2["next_cursor"] is None
