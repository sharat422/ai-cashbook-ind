"""BL8: a rate changed on the bill is kept as typed, re-runs the schemes on it,
and is marked "rate changed"; an untouched rate is the catalogue price, unmarked."""

from conftest import today_iso
from helpers import add_customer
from test_schemes import API, _item, _scheme


def _body(cid, item, qty, rate=None):
    line = {"itemId": item, "quantity": qty} | ({"rate": rate} if rate is not None else {})
    return {"customerId": cid, "date": today_iso(), "location": "godown", "lines": [line]}


def test_a_changed_rate_recomputes_the_bill_and_is_marked(make_user, client):
    owner = make_user()
    ghee = _item(client, owner.headers, "Ghee", price=120)
    _scheme(client, owner.headers, "Ghee 10% off", [ghee], kind="percent", percent=10)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]

    p = client.post(f"{API}/bills/preview", headers=owner.headers, json=_body(cid, ghee, "2", "110")).json()
    assert (p["lines"][0]["rate"], p["lines"][0]["amount"], p["lines"][0]["rateChanged"]) == ("110.00", "220.00", True)
    assert (p["subtotal"], p["discount"], p["total"]) == ("220.00", "22.00", "198.00")  # 10% of the new rate

    r = client.post(f"{API}/bills", headers=owner.headers, json=_body(cid, ghee, "2", "110"))
    assert r.status_code == 200, r.text
    [line] = r.json()["lines"]
    assert (line["rate"], line["amount"], line["rateChanged"], r.json()["total"]) == ("110.00", "220.00", True, "198.00")
    again = client.get(f"{API}/bills/{r.json()['id']}", headers=owner.headers).json()  # stored with the bill
    assert again["lines"][0]["rateChanged"] is True


def test_an_untouched_rate_is_the_catalogue_price_with_no_mark(make_user, client):
    owner = make_user()
    ghee = _item(client, owner.headers, "Ghee", price=120)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    for rate in (None, "120", "120.00"):  # left alone, or typed back to the same price
        [line] = client.post(f"{API}/bills", headers=owner.headers, json=_body(cid, ghee, "1", rate)).json()["lines"]
        assert (line["rate"], line["rateChanged"]) == ("120.00", False), rate
