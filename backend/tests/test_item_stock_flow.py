"""An item's stock in and out, as the item detail screen uses it: a purchase
(stock in, with its bill) and a sale (stock out) change the item's quantity and
write the movement together; stock never goes below zero; the item's history
lists both, newest first; a service has no stock."""

from conftest import today_iso
from test_stock import API, _item, _move


def _qty(client, headers, item_id):
    return client.get(f"{API}/items/{item_id}", headers=headers).json()["stock_qty"]


def test_stock_in_and_out_keep_the_quantity_and_the_history_together(make_user, client):
    owner = make_user()
    item = _item(client, owner.headers, name="Soap", opening=0, unit="box")

    assert _move(client, owner.headers, item, "purchase", 10, billRef="HD/101").status_code == 200
    assert _qty(client, owner.headers, item) == 10
    assert _move(client, owner.headers, item, "sale", 3).status_code == 200
    assert _qty(client, owner.headers, item) == 7

    short = _move(client, owner.headers, item, "sale", 8)
    assert short.status_code == 422 and short.json()["code"] == "stock_short_godown"
    assert "Only 7.000 box of Soap in the godown" in short.json()["detail"]
    assert _qty(client, owner.headers, item) == 7  # nothing taken, no movement written

    log = client.get(f"{API}/stock/moves", headers=owner.headers, params={"itemId": item}).json()
    assert [(m["kind"], m["quantity"], m["billRef"], m["date"]) for m in log if m["kind"] != "opening"] == [
        ("sale", "-3.000", None, today_iso()),
        ("purchase", "10.000", "HD/101", today_iso()),
    ]
    # The quantity is the sum of the movements, always.
    assert sum(float(m["quantity"]) for m in log) == _qty(client, owner.headers, item)


def test_a_service_has_no_stock(make_user, client):
    owner = make_user()
    r = client.post(f"{API}/items", headers=owner.headers, json={
        "name": "Delivery", "type": "service", "sale_price": 50})
    assert r.status_code == 200, r.text
    refused = _move(client, owner.headers, r.json()["id"], "purchase", 1)
    assert refused.status_code == 422 and "Services don't have stock" in refused.text
