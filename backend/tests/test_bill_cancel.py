"""SC5: cancelling or returning an item bill by reversal — never an edit. A
reversal bill points at the original; goods go back; what the retailer owes
drops; the scheme report nets it out."""

from conftest import today_iso
from helpers import add_customer
from test_schemes import API, _bill, _item, _scheme, _stock, _team


def _balance(client, headers, cid):
    c = client.get(f"{API}/customers/{cid}", headers=headers).json()
    return float(c.get("outstanding_amount", c.get("outstandingAmount")))


def _cancel(client, headers, bill_id, item_ids=None):
    return client.post(f"{API}/bills/{bill_id}/cancel", headers=headers, json={"itemIds": item_ids or []})


def _report(client, headers):
    return client.get(f"{API}/schemes/report", headers=headers,
                      params={"from": today_iso(), "to": today_iso()}).json()


def test_cancelling_a_bill_lowers_the_credit_and_returns_the_goods(make_user, client):
    owner, _sid, staff = _team(make_user, client)
    soap = _item(client, owner.headers, "Soap", price=25)
    oil = _item(client, owner.headers, "Oil", price=100)
    _scheme(client, owner.headers, "Soap 10+1", [soap], buyQty=10, freeQty=1)
    cid = add_customer(client, owner.headers)["id"]
    bill = _bill(client, owner.headers, cid, [(soap, 20), (oil, 2)]).json()  # 500 + 200; 2 free soap
    assert _balance(client, owner.headers, cid) == 700
    assert (_stock(client, owner.headers, soap)["godown"], _stock(client, owner.headers, oil)["godown"]) == (
        "978.000", "998.000")
    assert _cancel(client, staff, bill["id"]).status_code == 403  # owner only

    r = _cancel(client, owner.headers, bill["id"])
    assert r.status_code == 200, r.text
    rev = r.json()
    assert (rev["reversesId"], rev["total"], rev["subtotal"]) == (bill["id"], "-700.00", "-700.00")
    assert _balance(client, owner.headers, cid) == 0
    assert (_stock(client, owner.headers, soap)["godown"], _stock(client, owner.headers, oil)["godown"]) == (
        "1000.000", "1000.000")  # paid and free goods back
    original = client.get(f"{API}/bills/{bill['id']}", headers=owner.headers).json()
    assert original["status"] == "cancelled" and original["total"] == "700.00"  # kept as it was, marked
    assert [x["id"] for x in original["reversals"]] == [rev["id"]]
    # The retailer's ledger shows the return as its own entry, not an edit of the bill's credit.
    ledger = client.get(f"{API}/customers/{cid}/ledger", headers=owner.headers).json()
    entries = ledger["items"] if isinstance(ledger, dict) else ledger
    kinds = sorted((e["type"], e["payment_method"], float(e["amount"])) for e in entries)
    assert kinds == [("credit", None, 700.0), ("payment", "bill_return", 700.0)]


def test_returning_one_line_returns_only_that_lines_goods_and_credit(make_user, client):
    owner, _sid, _staff = _team(make_user, client)
    soap = _item(client, owner.headers, "Soap", price=25)
    oil = _item(client, owner.headers, "Oil", price=100)
    cid = add_customer(client, owner.headers)["id"]
    bill = _bill(client, owner.headers, cid, [(soap, 20), (oil, 2)]).json()
    rev = _cancel(client, owner.headers, bill["id"], [oil]).json()
    assert rev["total"] == "-200.00" and [ln["itemId"] for ln in rev["lines"]] == [oil]
    assert _balance(client, owner.headers, cid) == 500
    assert (_stock(client, owner.headers, soap)["godown"], _stock(client, owner.headers, oil)["godown"]) == (
        "980.000", "1000.000")
    original = client.get(f"{API}/bills/{bill['id']}", headers=owner.headers).json()
    assert original["status"] == "partly_returned"
    assert {ln["itemId"]: ln["returned"] for ln in original["lines"]} == {soap: False, oil: True}
    assert _cancel(client, owner.headers, bill["id"], [oil]).status_code == 422  # that line's gone already
    assert _cancel(client, owner.headers, bill["id"]).json()["total"] == "-500.00"  # the rest
    assert client.get(f"{API}/bills/{bill['id']}", headers=owner.headers).json()["status"] == "cancelled"


def test_cancelling_twice_is_refused_and_the_scheme_report_nets_out(make_user, client):
    owner, _sid, _staff = _team(make_user, client)
    soap = _item(client, owner.headers, "Soap", price=25)
    _scheme(client, owner.headers, "Soap 10+1", [soap], buyQty=10, freeQty=1)
    cid = add_customer(client, owner.headers)["id"]
    keep = _bill(client, owner.headers, cid, [(soap, 10)]).json()  # stays: 1 free
    gone = _bill(client, owner.headers, cid, [(soap, 20)]).json()  # cancelled: 2 free
    before = _report(client, owner.headers)
    assert before["totalFreeQty"] == "3.000" and before["rows"][0]["bills"] == 2
    _cancel(client, owner.headers, gone["id"])
    again = _cancel(client, owner.headers, gone["id"])
    assert again.status_code == 422 and "already cancelled" in again.json()["detail"]
    after = _report(client, owner.headers)
    assert (after["totalFreeQty"], after["totalValue"], after["rows"][0]["bills"]) == ("1.000", "25.00", 1)
    assert keep["id"] != gone["id"]
