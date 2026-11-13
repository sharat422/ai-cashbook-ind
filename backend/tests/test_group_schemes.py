"""SC2: group ("any 10") schemes. The scheme's SKUs count together; free
goods go on the cheapest line; single-SKU schemes still check line by line."""

from conftest import today_iso
from helpers import add_customer
from test_schemes import API, _bill, _item, _scheme


def _setup(make_user, client):
    owner = make_user()
    a = _item(client, owner.headers, "Soap A", price=10)
    b = _item(client, owner.headers, "Soap B", price=8)  # the cheaper one
    cid = add_customer(client, owner.headers)["id"]
    return owner, a, b, cid


def test_any_ten_applies_on_six_plus_four_and_not_on_six_plus_three(make_user, client):
    owner, a, b, cid = _setup(make_user, client)
    r = _scheme(client, owner.headers, "Any 10 soap, 1 free", [a, b], buyQty=10, freeQty=1, scope="sku_group")
    assert r.status_code == 200 and r.json()["scope"] == "sku_group", r.text

    bill = _bill(client, owner.headers, cid, [(a, 6), (b, 4)])
    assert bill.status_code == 200, bill.text
    by_item = {s["itemId"]: s for s in bill.json()["schemes"]}
    assert by_item[b]["freeQty"] == "1.000" and by_item[b]["freeItemName"] == "Soap B"  # cheapest line
    assert by_item[a]["status"] == "applied" and by_item[a]["freeQty"] == "0.000"     # counted, not free
    assert (by_item[b]["value"], by_item[a]["value"]) == ("8.00", "0.00")  # 1 free × ₹8

    short = _bill(client, owner.headers, cid, [(a, 6), (b, 3)])
    assert short.status_code == 200 and short.json()["schemes"] == []  # 9: not applied


def test_a_single_sku_scheme_still_checks_line_by_line(make_user, client):
    owner, a, b, cid = _setup(make_user, client)
    _scheme(client, owner.headers, "A 10+1", [a, b], buyQty=10, freeQty=1)  # scope defaults to single_sku
    bill = _bill(client, owner.headers, cid, [(a, 6), (b, 4)]).json()
    assert bill["schemes"] == []  # 6 of A isn't 10 of A
    bill = _bill(client, owner.headers, cid, [(a, 10), (b, 4)]).json()
    assert [(s["itemId"], s["freeQty"]) for s in bill["schemes"]] == [(a, "1.000")]


def test_the_scheme_log_records_the_group_and_the_free_line(make_user, client):
    owner, a, b, cid = _setup(make_user, client)
    _scheme(client, owner.headers, "Any 10 soap, 1 free", [a, b], buyQty=10, freeQty=1, scope="sku_group",
            priority=2)
    bill = _bill(client, owner.headers, cid, [(a, 6), (b, 4)]).json()
    notes = {s["groupNote"] for s in bill["schemes"]}
    assert notes == {"6 Soap A + 4 Soap B = 10 · free: Soap B"}
    log = client.get(f"{API}/schemes/log", headers=owner.headers,
                     params={"from": today_iso(), "to": today_iso(), "customerId": cid}).json()
    assert {(r["itemName"], r["groupNote"]) for r in log} == {
        ("Soap A", "6 Soap A + 4 Soap B = 10 · free: Soap B"), ("Soap B", "6 Soap A + 4 Soap B = 10 · free: Soap B")}
    # A higher-priority single-SKU scheme takes its line first; the group doesn't count it twice.
    _scheme(client, owner.headers, "A 5% off", [a], kind="percent", percent="5", minQty="1", priority=1)
    bill = _bill(client, owner.headers, cid, [(a, 6), (b, 4)]).json()
    applied = {s["itemId"]: (s["schemeName"], s["status"]) for s in bill["schemes"] if s["status"] == "applied"}
    assert applied == {a: ("A 5% off", "applied")}  # B alone (4) doesn't reach 10
    assert any(s["status"] == "not_applied" and s["itemId"] == a for s in bill["schemes"])
    # Scope is checked.
    assert _scheme(client, owner.headers, "Bad", [a], scope="sku_group", buyQty=10, freeQty=1).status_code == 422
