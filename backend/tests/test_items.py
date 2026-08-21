"""E2E: item/product catalog CRUD (foundation for GST invoicing)."""


def _make_item(client, headers, **over):
    body = {
        "name": "Cement Bag",
        "type": "product",
        "sale_price": 400,
        "purchase_price": 350,
        "unit": "bag",
        "hsn_sac": "2523",
        "gst_rate": 28,
        "track_stock": True,
        "stock_qty": 100,
        **over,
    }
    r = client.post("/api/v1/items", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_and_get_item(user, client):
    item = _make_item(client, user.headers)
    assert item["name"] == "Cement Bag"
    assert item["gst_rate"] == 28
    assert item["hsn_sac"] == "2523"
    got = client.get(f"/api/v1/items/{item['id']}", headers=user.headers)
    assert got.status_code == 200
    assert got.json()["sale_price"] == 400


def test_list_search_and_pagination(user, client):
    _make_item(client, user.headers, name="Alpha", hsn_sac="1001")
    _make_item(client, user.headers, name="Beta", hsn_sac="1002")
    _make_item(client, user.headers, name="Gamma", hsn_sac="1003")

    found = client.get("/api/v1/items?search=Beta", headers=user.headers).json()
    assert found["total"] == 1
    assert found["items"][0]["name"] == "Beta"

    page1 = client.get("/api/v1/items?limit=2", headers=user.headers).json()
    assert page1["total"] == 3
    assert page1["next_cursor"] is not None
    page2 = client.get(
        f"/api/v1/items?limit=2&cursor={page1['next_cursor']}", headers=user.headers
    ).json()
    ids = {i["id"] for i in page1["items"]} | {i["id"] for i in page2["items"]}
    assert len(ids) == 3


def test_update_and_delete_item(user, client):
    item = _make_item(client, user.headers)
    upd = client.patch(
        f"/api/v1/items/{item['id']}",
        headers=user.headers,
        json={"name": "Cement Bag 50kg", "sale_price": 420, "gst_rate": 28},
    )
    assert upd.status_code == 200
    assert upd.json()["name"] == "Cement Bag 50kg"
    assert upd.json()["sale_price"] == 420

    assert client.delete(f"/api/v1/items/{item['id']}", headers=user.headers).status_code == 204
    assert client.get(f"/api/v1/items/{item['id']}", headers=user.headers).status_code == 404


def test_items_isolated_and_authed(make_user, client):
    a = make_user()
    b = make_user()
    item = _make_item(client, a.headers, name="A only")
    # B cannot see A's item.
    assert client.get(f"/api/v1/items/{item['id']}", headers=b.headers).status_code == 404
    # Unauthenticated is rejected.
    assert client.get("/api/v1/items").status_code in (401, 403)
