"""S6: units. Stock is held in the item's base unit (pieces); a box is 24 of
them. Moves can be entered in any of the item's units and are converted
before the stock check; factors lock once the item has movement."""

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Expense
from conftest import today_iso
from test_stock import API, _team, _transfer


def _soap(client, headers):
    r = client.post(f"{API}/items", headers=headers, json={
        "name": "Soap", "unit": "pcs", "purchase_price": 0, "sale_price": 10, "track_stock": True, "stock_qty": 0})
    assert r.status_code == 200, r.text
    item = r.json()["id"]
    r = client.put(f"{API}/items/{item}/units", headers=headers, json={"units": [{"unit": "box", "factor": "24"}]})
    assert r.status_code == 200, r.text
    return item


def _move(client, headers, item, kind, qty, unit=None, location="godown", van=None, cid=None, **extra):
    body = {"kind": kind, "itemId": item, "quantity": qty, "unit": unit, "location": location,
            "vanUserId": van, "date": today_iso(), "clientId": cid, **extra}
    if kind == "purchase":
        body |= {"supplier": "Hindustan Distributors", "unitPrice": "192", "billRef": "HD/1"}
    return client.post(f"{API}/stock/moves", headers=headers, json=body)


def _soap_level(client, headers, item):
    return next(i for i in client.get(f"{API}/stock", headers=headers).json()["items"] if i["id"] == item)


def test_ten_boxes_less_thirty_pieces_is_eight_boxes_eighteen_pieces(make_user, client):
    owner, _ = _team(make_user, client)
    item = _soap(client, owner.headers)
    buy = _move(client, owner.headers, item, "purchase", 10, unit="box")
    assert buy.status_code == 200, buy.text
    assert (buy.json()[0]["quantity"], buy.json()[0]["enteredUnit"], buy.json()[0]["enteredQty"]) == (
        "240.000", "box", "10.000")
    lv = _soap_level(client, owner.headers, item)
    assert (lv["godown"], lv["display"]) == ("240.000", "10 box")
    with SessionLocal() as db:  # bought at ₹192 a box: the expense is 10 × 192
        [e] = db.scalars(select(Expense).where(Expense.purchase_id == buy.json()[0]["id"])).all()
        assert e.amount == 1920.0
    assert _move(client, owner.headers, item, "sale", 30).status_code == 200  # in pieces (the base unit)
    lv = _soap_level(client, owner.headers, item)
    assert (lv["godown"], lv["display"], lv["units"]) == ("210.000", "8 box 18 pcs", [{"unit": "box", "factor": "24.000"}])


def test_a_factor_cannot_change_after_a_sale(make_user, client):
    owner, _ = _team(make_user, client)
    item = _soap(client, owner.headers)
    _move(client, owner.headers, item, "purchase", 2, unit="box")
    _move(client, owner.headers, item, "sale", 1)
    r = client.put(f"{API}/items/{item}/units", headers=owner.headers, json={"units": [{"unit": "box", "factor": "12"}]})
    assert r.status_code == 422 and "locked" in r.json()["detail"]
    info = client.get(f"{API}/items/{item}/units", headers=owner.headers).json()
    assert (info["locked"], info["units"]) == (True, [{"unit": "box", "factor": "24.000"}])  # unchanged


def test_pieces_of_a_box_stocked_item_pass_the_check_in_base_units(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    item = _soap(client, owner.headers)
    _move(client, owner.headers, item, "purchase", 1, unit="box")  # 24 pieces
    assert _move(client, owner.headers, item, "sale", 25).status_code == 422  # 25 pieces > 24: refused
    assert _move(client, owner.headers, item, "sale", 2, unit="box").status_code == 422  # 48 > 24
    assert _move(client, owner.headers, item, "sale", 24).status_code == 200  # exactly all of it
    assert _soap_level(client, owner.headers, item)["godown"] == "0.000"  # never negative
    # A transfer in boxes is converted too; an unknown unit is refused.
    _move(client, owner.headers, item, "purchase", 1, unit="box")
    r = client.post(f"{API}/stock/transfers", headers=owner.headers, json={
        "itemId": item, "quantity": 1, "unit": "box", "vanUserId": a_id, "date": today_iso()})
    assert r.status_code == 200 and r.json()[1]["quantity"] == "24.000"
    assert _move(client, owner.headers, item, "sale", 1, unit="crate").status_code == 422
