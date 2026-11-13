"""SC3: bill-level schemes — checked once per bill, on the total after line
schemes, as their own line; one per bill by priority; optionally one retailer."""

from conftest import today_iso
from helpers import add_customer
from test_schemes import API, _bill, _item


def _bill_scheme(client, headers, name, priority=1, **cfg):
    body = {"name": name, "type": cfg.pop("type", "amount_off"), "itemIds": [], "priority": priority,
            "validFrom": "2020-01-01", "validTo": "2099-12-31", "level": "bill", **cfg}
    r = client.post(f"{API}/schemes", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _whole_bill(bill):
    return [s for s in bill["schemes"] if s["itemName"] == "Whole bill"]


def test_500_off_above_10000_applies_on_12000_and_not_on_9000(make_user, client):
    owner = make_user()
    tv = _item(client, owner.headers, "TV", price=1000)
    cid = add_customer(client, owner.headers)["id"]
    _bill_scheme(client, owner.headers, "₹500 off above ₹10,000", amountOff="500", minBillValue="10000")
    big = _bill(client, owner.headers, cid, [(tv, 12)]).json()
    assert (big["subtotal"], big["discount"], big["total"]) == ("12000.00", "500.00", "11500.00")
    [line] = _whole_bill(big)
    assert (line["schemeName"], line["status"], line["discount"]) == ("₹500 off above ₹10,000", "applied", "500.00")
    small = _bill(client, owner.headers, cid, [(tv, 9)]).json()
    assert (small["total"], _whole_bill(small)) == ("9000.00", [])


def test_a_retailer_specific_scheme_applies_to_that_retailer_only(make_user, client):
    owner = make_user()
    tv = _item(client, owner.headers, "TV", price=1000)
    ravi = add_customer(client, owner.headers, full_name="Ravi")["id"]
    sita = add_customer(client, owner.headers, full_name="Sita")["id"]
    _bill_scheme(client, owner.headers, "5% for Ravi", type="percent", percent="5", minBillValue="0", retailerId=ravi)
    assert _bill(client, owner.headers, ravi, [(tv, 2)]).json()["total"] == "1900.00"
    assert _bill(client, owner.headers, sita, [(tv, 2)]).json()["total"] == "2000.00"
    # Preview tells the same story before saving.
    p = client.post(f"{API}/bills/preview", headers=owner.headers, json={
        "customerId": ravi, "date": today_iso(), "location": "godown",
        "lines": [{"itemId": tv, "quantity": 2}]}).json()
    assert p["billScheme"]["name"] == "5% for Ravi" and p["total"] == "1900.00"


def test_two_bill_schemes_one_applies_the_other_says_why_not(make_user, client):
    owner = make_user()
    tv = _item(client, owner.headers, "TV", price=1000)
    soap = _item(client, owner.headers, "Soap", price=100)
    cid = add_customer(client, owner.headers)["id"]
    # A line scheme first: 10% off Soap; the bill scheme is on what's left.
    client.post(f"{API}/schemes", headers=owner.headers, json={
        "name": "Soap 10%", "type": "percent", "itemIds": [soap], "priority": 3, "percent": "10",
        "validFrom": "2020-01-01", "validTo": "2099-12-31"})
    _bill_scheme(client, owner.headers, "₹500 off above ₹10,000", priority=1, amountOff="500", minBillValue="10000")
    _bill_scheme(client, owner.headers, "2% off above ₹5,000", priority=2, type="percent", percent="2",
                 minBillValue="5000")
    bill = _bill(client, owner.headers, cid, [(tv, 11), (soap, 10)]).json()
    # 11,000 + 1,000 − 100 (Soap 10%) = 11,900, then ₹500 off.
    assert (bill["subtotal"], bill["discount"], bill["total"]) == ("12000.00", "600.00", "11400.00")
    whole = {s["schemeName"]: (s["status"], s["reason"]) for s in _whole_bill(bill)}
    assert whole["₹500 off above ₹10,000"] == ("applied", None)
    assert whole["2% off above ₹5,000"] == (
        "not_applied", "Not applied: '₹500 off above ₹10,000' has priority (1 before 2).")
    # A bill scheme can't be ₹ off a line, and a line scheme can't be ₹ off.
    assert client.post(f"{API}/schemes", headers=owner.headers, json={
        "name": "Bad", "type": "amount_off", "itemIds": [tv], "priority": 1, "amountOff": "5",
        "validFrom": "2020-01-01", "validTo": "2099-12-31"}).status_code == 422
