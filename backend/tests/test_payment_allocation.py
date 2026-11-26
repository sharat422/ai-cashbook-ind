"""Payments against bills: a payment can be linked to one bill or split over
several; a part-payment leaves the rest of the bill open; a bill is "paid"
only when nothing is left; the open bills always add up to the balance; an old
payment with no link stays "not linked to a bill" and pays the oldest bills,
as the ageing always did."""

import json

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_ledger
from test_beats import _beat, _team
from test_gst import _gst_owner, _sale
from test_schemes import _bill as _item_bill, _item, _team as _billing_team

API = "/api/v1"


def _credit(client, headers, cid, key, amount, date=None, number=None):
    extra = {"invoice_number": number} if number else {}
    return add_ledger(client, headers, cid, type="credit", amount=amount, date=date or today_iso(),
                      client_id=key, **extra)["id"]


def _pay(client, headers, cid, key, amount, bills=(), **extra):
    data = {"type": "payment", "amount": str(amount), "date": today_iso(), "client_id": key,
            "payment_method": "cash", **extra}
    if bills:
        data["allocations"] = json.dumps([{"bill_id": b, "amount": a} for b, a in bills])
    return client.post(f"{API}/customers/{cid}/ledger", headers=headers, data=data)


def _bills(client, headers, cid, **params):
    r = client.get(f"{API}/customers/{cid}/bills", headers=headers, params=params)
    assert r.status_code == 200, r.text
    body = r.json()
    return body, {b["id"]: (b["paid"], b["left"], b["status"]) for b in body["bills"]}


def _balance(client, headers, cid):
    return client.get(f"{API}/customers/{cid}", headers=headers).json()["outstanding_amount"]


def test_a_payment_for_one_bill_marks_it_paid(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    bill = _credit(client, owner.headers, cid, "s1", 6000, number="INV-1")
    assert _bills(client, owner.headers, cid)[1][bill] == ("0.00", "6000.00", "open")

    r = _pay(client, owner.headers, cid, "p1", 6000, bills=[(bill, 6000)])
    assert r.status_code == 200, r.text
    assert r.json()["bills"] == [{"bill_id": bill, "number": "INV-1", "date": today_iso(), "amount": "6000.00"}]
    body, bills = _bills(client, owner.headers, cid)
    assert bills[bill] == ("6000.00", "0.00", "paid")
    assert body["left"] == "0.00" and _balance(client, owner.headers, cid) == 0


def test_a_part_payment_leaves_the_rest_of_the_bill_open(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    bill = _credit(client, owner.headers, cid, "s1", 5000)
    assert _pay(client, owner.headers, cid, "p1", 2000, bills=[(bill, 2000)]).status_code == 200
    body, bills = _bills(client, owner.headers, cid)
    assert bills[bill] == ("2000.00", "3000.00", "part")
    assert body["left"] == "3000.00" and _balance(client, owner.headers, cid) == 3000


def test_a_payment_bigger_than_a_bill_splits_over_bills_in_order(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    first = _credit(client, owner.headers, cid, "s1", 5000, date=days_ago_iso(10))
    second = _credit(client, owner.headers, cid, "s2", 3000, date=days_ago_iso(5))
    third = _credit(client, owner.headers, cid, "s3", 4000)
    r = _pay(client, owner.headers, cid, "p1", 7000, bills=[(first, 5000), (second, 2000)])
    assert [(b["bill_id"], b["amount"]) for b in r.json()["bills"]] == [(first, "5000.00"), (second, "2000.00")]
    body, bills = _bills(client, owner.headers, cid)
    assert bills == {first: ("5000.00", "0.00", "paid"), second: ("2000.00", "1000.00", "part"),
                     third: ("0.00", "4000.00", "open")}
    # Total outstanding is still credits − payments, and the open bills add up to it.
    assert body["left"] == "5000.00" and _balance(client, owner.headers, cid) == 5000


def test_an_old_payment_is_not_linked_and_pays_the_oldest_bills(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    old = _credit(client, owner.headers, cid, "s1", 5000, date=days_ago_iso(40))
    new = _credit(client, owner.headers, cid, "s2", 5000)
    add_ledger(client, owner.headers, cid, type="payment", amount=6000, date=today_iso(), client_id="p0",
               payment_method="cash")  # as every payment before bills could be picked
    body, bills = _bills(client, owner.headers, cid)
    assert bills == {old: ("5000.00", "0.00", "paid"), new: ("1000.00", "4000.00", "part")}
    assert body["unlinked"] == "6000.00" and body["left"] == "4000.00"
    ledger = client.get(f"{API}/customers/{cid}/ledger", headers=owner.headers).json()
    payment = next(e for e in ledger if e["type"] == "payment")
    assert payment["bills"] == []  # the app shows "Not linked to a bill"
    assert all("bills" not in e for e in ledger if e["type"] == "credit")


def test_a_payment_for_the_newest_bill_leaves_the_oldest_open_in_the_ageing(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    old = _credit(client, owner.headers, cid, "s1", 5000, date=days_ago_iso(45))
    new = _credit(client, owner.headers, cid, "s2", 5000)
    _pay(client, owner.headers, cid, "p1", 5000, bills=[(new, 5000)])
    assert _bills(client, owner.headers, cid)[1] == {old: ("0.00", "5000.00", "open"),
                                                    new: ("5000.00", "0.00", "paid")}
    aging = client.get(f"{API}/customer-aging", headers=owner.headers).json()["buckets"]
    assert aging["d31_60"] == 5000 and aging["current"] == 0


def test_overpaying_is_an_advance_and_a_stale_pick_still_saves_the_payment(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    bill = _credit(client, owner.headers, cid, "s1", 1000)
    assert _pay(client, owner.headers, cid, "p1", 1000, bills=[(bill, 1000)]).status_code == 200
    # Queued offline before that: the bill is paid now, so nothing more goes on it.
    r = _pay(client, owner.headers, cid, "p2", 500, bills=[(bill, 400), ("no-such-bill", 100)])
    assert r.status_code == 200 and r.json()["bills"] == []
    body, bills = _bills(client, owner.headers, cid)
    assert bills[bill] == ("1000.00", "0.00", "paid")
    assert body["advance"] == "500.00" and _balance(client, owner.headers, cid) == -500


def test_bills_that_add_up_to_more_than_the_payment_are_refused(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    bill = _credit(client, owner.headers, cid, "s1", 5000)
    assert _pay(client, owner.headers, cid, "p1", 1000, bills=[(bill, 2000)]).status_code == 422
    assert _pay(client, owner.headers, cid, "p2", 1000, bills=[(bill, 500), (bill, 500)]).status_code == 422
    bad = client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
        "type": "payment", "amount": "100", "date": today_iso(), "client_id": "p3", "allocations": "{oops"})
    assert bad.status_code == 422
    credit = client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
        "type": "credit", "amount": "100", "date": today_iso(), "client_id": "s2",
        "allocations": json.dumps([{"bill_id": bill, "amount": 100}])})
    assert credit.status_code == 422
    assert _balance(client, owner.headers, cid) == 5000  # nothing saved


def test_a_cash_gst_sale_is_a_paid_bill(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    r = _sale(client, owner.headers, cid, "inv-1", amount=1000, paid_now="true")
    assert r.status_code == 200, r.text
    body, bills = _bills(client, owner.headers, cid)
    assert bills[r.json()["id"]] == ("1180.00", "0.00", "paid")
    assert body["unlinked"] == "0.00"


def test_staff_see_the_bills_of_a_retailer_on_their_beat(make_user, client):
    owner, [(staff_id, staff)] = _team(make_user, client, "staff")
    cid = add_customer(client, owner.headers)["id"]
    other = add_customer(client, owner.headers, full_name="Not on the beat")["id"]
    beat = _beat(client, owner, "North", user_id=staff_id, customers=[cid])
    bill = _credit(client, owner.headers, cid, "s1", 2000)
    assert _bills(client, staff, cid, beat_id=beat["id"])[1][bill] == ("0.00", "2000.00", "open")
    assert client.get(f"{API}/customers/{cid}/bills", headers=staff).status_code == 403
    assert client.get(f"{API}/customers/{other}/bills", headers=staff,
                      params={"beat_id": beat["id"]}).status_code == 403
    # And they can collect against it on the beat.
    r = _pay(client, staff, cid, "p1", 2000, bills=[(bill, 2000)], beat_id=beat["id"])
    assert r.status_code == 200, r.text
    assert _bills(client, owner.headers, cid)[1][bill] == ("2000.00", "0.00", "paid")


def test_an_item_bill_returned_is_paid_by_its_return_not_the_oldest_bill(make_user, client):
    owner, _sid, _staff = _billing_team(make_user, client)
    soap = _item(client, owner.headers, "Soap", price=25)
    cid = add_customer(client, owner.headers)["id"]
    older = _credit(client, owner.headers, cid, "s1", 1000, date=days_ago_iso(10))
    bill = _item_bill(client, owner.headers, cid, [(soap, 20)]).json()  # 500
    r = client.post(f"{API}/bills/{bill['id']}/cancel", headers=owner.headers, json={"itemIds": []})
    assert r.status_code == 200, r.text
    body, bills = _bills(client, owner.headers, cid)
    item_entry = next(b for b in body["bills"] if b["id"] != older)["id"]
    assert bills == {older: ("0.00", "1000.00", "open"), item_entry: ("500.00", "0.00", "paid")}
    assert body["left"] == "1000.00" and body["unlinked"] == "0.00"
