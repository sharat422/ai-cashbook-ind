"""Counted cash at day end: over/short shown on its own, sales never changed."""

from conftest import today_iso
from helpers import add_customer
from test_beats import _beat, _team

API = "/api/v1"


def _cash(client, headers, cid, amount, client_id, beat_id=None):
    data = {"type": "payment", "amount": str(amount), "date": today_iso(), "client_id": client_id,
            "payment_method": "cash"}
    if beat_id:
        data["beat_id"] = beat_id
    assert client.post(f"{API}/customers/{cid}/ledger", headers=headers, data=data).status_code == 200


def test_counted_cash_shows_over_or_short_and_changes_nothing_else(make_user, client):
    owner, [(a_id, staff_a), (b_id, staff_b), (_c, acc)] = _team(make_user, client, "staff", "staff", "accountant")
    shop = add_customer(client, owner.headers)["id"]
    beat = _beat(client, owner, "North", user_id=a_id, customers=[shop])
    other = _beat(client, owner, "South", user_id=b_id, customers=[shop])
    _cash(client, staff_a, shop, 1200, "c1", beat["id"])
    _cash(client, staff_a, shop, 300.5, "c2", beat["id"])
    close = client.get(f"{API}/daily-close", headers=staff_a, params={"beat_id": beat["id"]}).json()
    assert (close["cashInHand"], close["cashCounted"], close["cashOverShort"]) == ("1500.50", None, None)

    body = {"date": today_iso(), "beatId": beat["id"], "counted": "1450.50"}
    r = client.post(f"{API}/daily-close/cash-count", headers=staff_a, json=body)
    assert r.status_code == 200, r.text
    c = r.json()
    assert (c["cashCounted"], c["cashOverShort"]) == ("1450.50", "-50.00")   # short by ₹50
    # The count never changes the difference: the cash is still to deposit.
    assert (c["cashInHand"], c["creditCollected"], c["difference"]) == ("1500.50", "1500.50", "1500.50")
    # A recount replaces what's shown; both are kept.
    c = client.post(f"{API}/daily-close/cash-count", headers=staff_a, json={**body, "counted": "1510.50"}).json()
    assert c["cashOverShort"] == "10.00"
    ledger = client.get(f"{API}/customers/{shop}/ledger", headers=owner.headers).json()
    assert sorted(e["amount"] for e in ledger) == [300.5, 1200.0]  # sales/payments untouched

    # Staff count only their own beat; the whole-business count is the owner's.
    assert client.post(f"{API}/daily-close/cash-count", headers=staff_b, json=body).status_code == 403
    assert client.post(f"{API}/daily-close/cash-count", headers=staff_a,
                       json={"date": today_iso(), "counted": "1"}).status_code == 403
    assert client.post(f"{API}/daily-close/cash-count", headers=acc, json=body).status_code == 403
    whole = client.post(f"{API}/daily-close/cash-count", headers=owner.headers,
                        json={"date": today_iso(), "counted": "1500.50"}).json()
    assert whole["cashOverShort"] == "0.00" and whole["beatId"] is None
    assert client.post(f"{API}/daily-close/cash-count", headers=owner.headers,
                       json={"date": today_iso(), "counted": "-5"}).status_code == 422
    south = client.get(f"{API}/daily-close", headers=owner.headers, params={"beat_id": other["id"]}).json()
    assert south["cashCounted"] is None
