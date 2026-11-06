"""Stock basics: godown and per-salesperson van stock, transfers, low-stock
alerts and the month-end count."""

import pytest

from conftest import _login, today_iso
from app.database import SessionLocal
from app.models import Item, StockMove

API = "/api/v1"


def _team(make_user, client, *roles):
    owner = make_user()
    members = []
    for i, role in enumerate(roles):
        mobile = "6" + str(abs(hash((owner.mobile, role, i, "stock"))) % 10**9).zfill(9)
        r = client.post(f"{API}/team", headers=owner.headers, json={"mobile": mobile, "role": role})
        assert r.status_code == 200, r.text
        members.append((r.json()["user_id"], _login(client, mobile)))
    return owner, members


def _item(client, headers, name="Biscuits", opening=0, threshold=None, unit="box"):
    r = client.post(f"{API}/items", headers=headers, json={
        "name": name, "unit": unit, "purchase_price": 80, "sale_price": 100,
        "track_stock": True, "stock_qty": opening, "low_stock_threshold": threshold})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _levels(client, headers, item_id):
    items = {i["id"]: i for i in client.get(f"{API}/stock", headers=headers).json()["items"]}
    return items[item_id]


def _move(client, headers, item_id, kind, qty, location="godown", van=None, cid=None):
    return client.post(f"{API}/stock/moves", headers=headers, json={
        "kind": kind, "itemId": item_id, "quantity": qty, "location": location,
        "vanUserId": van, "date": today_iso(), "clientId": cid})


def _transfer(client, headers, item_id, qty, van, cid=None):
    return client.post(f"{API}/stock/transfers", headers=headers, json={
        "itemId": item_id, "quantity": qty, "vanUserId": van, "date": today_iso(), "clientId": cid})


# --- 1 + 2. Van sale and godown → van transfer --------------------------------------

def test_transfer_moves_stock_and_a_van_sale_leaves_the_godown_alone(make_user, client):
    owner, [(a_id, staff_a), (b_id, staff_b)] = _team(make_user, client, "staff", "staff")
    item = _item(client, owner.headers, opening=50)
    assert _move(client, owner.headers, item, "purchase", 30).status_code == 200
    assert _levels(client, owner.headers, item)["godown"] == "80.000"

    r = _transfer(client, owner.headers, item, 20, a_id)
    assert r.status_code == 200, r.text
    assert [(m["location"], m["quantity"]) for m in r.json()] == [("godown", "-20.000"), ("van", "20.000")]
    lv = _levels(client, owner.headers, item)
    assert (lv["godown"], lv["vans"], lv["total"]) == ("60.000", {a_id: "20.000"}, "80.000")

    # Staff A sells 10 from their own van: van −10, godown unchanged.
    r = _move(client, staff_a, item, "sale", 10, location="van")
    assert r.status_code == 200, r.text
    lv = _levels(client, owner.headers, item)
    assert (lv["godown"], lv["vans"][a_id], lv["total"]) == ("60.000", "10.000", "70.000")
    assert client.get(f"{API}/stock/van", headers=staff_a).json()[0]["quantity"] == "10.000"

    # A godown sale leaves the van alone.
    assert _move(client, owner.headers, item, "sale", 5).status_code == 200
    lv = _levels(client, owner.headers, item)
    assert (lv["godown"], lv["vans"][a_id]) == ("55.000", "10.000")
    with SessionLocal() as db:
        assert db.get(Item, item).stock_qty == 65.0  # the cached total follows the ledger

    # Staff B's van is empty and separate; B can't sell from A's van or the godown.
    assert _move(client, staff_b, item, "sale", 1, location="van").status_code == 422
    assert _move(client, staff_b, item, "sale", 1, location="van", van=a_id).status_code == 403
    assert _move(client, staff_b, item, "sale", 1).status_code == 403
    assert client.get(f"{API}/stock/van", headers=staff_b, params={"userId": a_id}).status_code == 403
    assert _levels(client, owner.headers, item)["vans"] == {a_id: "10.000"}


def test_stock_never_goes_negative_and_retries_count_once(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    item = _item(client, owner.headers, opening=10)
    r = _transfer(client, owner.headers, item, 11, a_id)
    assert r.status_code == 422 and "Only 10.000 box of Biscuits in the godown" in r.text
    assert _move(client, staff_a, item, "sale", 1, location="van").status_code == 422

    for _ in range(2):  # a retried transfer and sale are saved once
        assert _transfer(client, owner.headers, item, 4, a_id, cid="t-1").status_code == 200
        assert _move(client, staff_a, item, "sale", 3, location="van", cid="s-1").status_code == 200
    lv = _levels(client, owner.headers, item)
    assert (lv["godown"], lv["vans"][a_id]) == ("6.000", "1.000")

    for bad in (0, -1, "1.2345", "abc"):
        assert _move(client, owner.headers, item, "purchase", bad).status_code == 422, bad
    assert _move(client, owner.headers, item, "purchase", 5, location="van", van=a_id).status_code == 422
    assert _transfer(client, staff_a, item, 1, a_id).status_code == 403  # only owner/accountant load vans

    # Every change is in the audit log, transfers as a pair.
    log = client.get(f"{API}/stock/moves", headers=owner.headers, params={"itemId": item}).json()
    assert sorted(m["kind"] for m in log) == ["opening", "sale", "transfer", "transfer"]
    assert all(m["createdBy"] for m in log)
    assert client.get(f"{API}/stock/moves", headers=staff_a).status_code == 403


# --- 3. Low-stock alert only below the threshold --------------------------------------

def test_low_stock_alert_only_below_the_threshold(make_user, client):
    owner, [(a_id, _)] = _team(make_user, client, "staff")
    item = _item(client, owner.headers, opening=12, threshold=10)
    _item(client, owner.headers, name="No threshold", opening=0)
    low = lambda: [i["name"] for i in client.get(f"{API}/stock/low", headers=owner.headers).json()]  # noqa: E731

    assert low() == []
    _move(client, owner.headers, item, "sale", 2)          # 10 = threshold → not low
    assert low() == []
    _transfer(client, owner.headers, item, 5, a_id)       # van stock still counts: total 10
    assert low() == []
    _move(client, owner.headers, item, "sale", "0.5")      # 9.5 < 10 → low
    assert low() == ["Biscuits"]
    assert _levels(client, owner.headers, item)["low"] is True
    _move(client, owner.headers, item, "purchase", 1)      # back to 10.5
    assert low() == []


# --- 4. Month-end count: within ±2% or the exact difference ---------------------------

def test_month_end_count_shows_match_or_exact_difference(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    rice = _item(client, owner.headers, name="Rice", opening=100, unit="kg")
    oil = _item(client, owner.headers, name="Oil", opening=50)
    soap = _item(client, owner.headers, name="Soap", opening=0)

    body = {"clientId": "count-oct", "location": "godown", "date": today_iso(), "lines": [
        {"itemId": rice, "counted": "98.5"},  # −1.5 of 100 = −1.5%: within ±2%
        {"itemId": oil, "counted": 47},       # −3 of 50 = −6%: outside
        {"itemId": soap, "counted": 0}]}       # 0 of 0: matches
    for _ in range(2):  # a retried count is saved once
        r = client.post(f"{API}/stock/counts", headers=owner.headers, json=body)
        assert r.status_code == 200, r.text
    lines = {x["itemId"]: x for x in r.json()["lines"]}
    assert lines[rice] == {"itemId": rice, "system": "100.000", "counted": "98.500",
                           "difference": "-1.500", "differencePct": "-1.50", "withinTolerance": True}
    assert (lines[oil]["difference"], lines[oil]["differencePct"], lines[oil]["withinTolerance"]) == (
        "-3.000", "-6.00", False)
    assert lines[soap]["withinTolerance"] is True and lines[soap]["differencePct"] is None
    assert r.json()["allWithinTolerance"] is False

    # The correction is logged and stock now equals the physical count.
    assert _levels(client, owner.headers, rice)["godown"] == "98.500"
    assert _levels(client, owner.headers, oil)["godown"] == "47.000"
    with SessionLocal() as db:
        counts = db.query(StockMove).filter(StockMove.kind == "count",
                                            StockMove.item_id.in_([rice, oil, soap])).all()
        assert sorted(str(m.quantity) for m in counts) == ["-1.500", "-3.000", "0.000"]

    # Exactly 2% is within; a van is counted on its own.
    _transfer(client, owner.headers, oil, 10, a_id)
    r = client.post(f"{API}/stock/counts", headers=owner.headers, json={
        "location": "van", "vanUserId": a_id, "date": today_iso(),
        "lines": [{"itemId": oil, "counted": "9.8"}]})
    line = r.json()["lines"][0]
    assert (line["system"], line["difference"], line["withinTolerance"]) == ("10.000", "-0.200", True)
    assert _levels(client, owner.headers, oil)["godown"] == "37.000"
    assert client.post(f"{API}/stock/counts", headers=staff_a, json={
        "location": "van", "date": today_iso(), "lines": [{"itemId": oil, "counted": 1}]}).status_code == 403


@pytest.mark.parametrize("payload", [
    {"lines": []},
    {"lines": [{"itemId": "x", "counted": 1}]},
    {"lines": [{"itemId": "SELF", "counted": -1}]},
    {"lines": [{"itemId": "SELF", "counted": 1}, {"itemId": "SELF", "counted": 2}]},
])
def test_bad_counts_are_rejected(make_user, client, payload):
    owner = make_user()
    item = _item(client, owner.headers, opening=5)
    lines = [{**x, "itemId": item if x["itemId"] == "SELF" else x["itemId"]} for x in payload["lines"]]
    r = client.post(f"{API}/stock/counts", headers=owner.headers,
                    json={"location": "godown", "date": today_iso(), "lines": lines})
    assert r.status_code in (404, 422), r.text
    assert _levels(client, owner.headers, item)["godown"] == "5.000"


def test_item_form_stock_is_opening_only(make_user, client):
    owner = make_user()
    item = _item(client, owner.headers, opening=7)
    # Editing the item can't overwrite stock; only moves change it.
    r = client.patch(f"{API}/items/{item}", headers=owner.headers, json={
        "name": "Biscuits", "unit": "box", "track_stock": True, "stock_qty": 999,
        "low_stock_threshold": 3})
    assert r.status_code == 200 and r.json()["stock_qty"] == 7.0
    assert r.json()["low_stock_threshold"] == 3.0
    service = client.post(f"{API}/items", headers=owner.headers,
                          json={"name": "Delivery", "type": "service"}).json()["id"]
    assert _move(client, owner.headers, service, "purchase", 1).status_code == 422
    assert client.delete(f"{API}/items/{item}", headers=owner.headers).status_code == 204
    with SessionLocal() as db:
        assert db.query(StockMove).filter_by(item_id=item).count() == 0
