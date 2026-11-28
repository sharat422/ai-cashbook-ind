"""Promise to pay: an amount with the date, a list of promises due today or
overdue (day list and home screen), and a payment clears it."""

from datetime import datetime, timedelta

from app.calc import IST
from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_ledger
from test_beats import _beat, _team, _visit

API = "/api/v1"


def _at(days_ago: int) -> str:
    return (datetime.now(IST) - timedelta(days=days_ago)).isoformat(timespec="seconds")


def _due(client, headers):
    r = client.get(f"{API}/promises/due", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _pay(client, headers, cid, amount, n):
    add_ledger(client, headers, cid, type="payment", amount=amount, date=today_iso(), client_id=f"pay-{n}",
               payment_method="cash")


def _day_promise(client, headers, cid):
    [beat] = client.get(f"{API}/beats/today", headers=headers).json()
    return next(r for r in beat["retailers"] if r["customer_id"] == cid)["promise"]


def test_promised_yesterday_for_today_is_due_and_clears_as_it_is_paid(make_user, client):
    owner, [(sid, staff)] = _team(make_user, client, "staff")
    shop = add_customer(client, owner.headers, full_name="Gupta Stores")
    add_ledger(client, owner.headers, shop["id"], type="credit", amount=8000, date=days_ago_iso(5), client_id="c1")
    beat = _beat(client, owner, "North", user_id=sid, customers=[shop["id"]])
    r = _visit(client, staff, beat["id"], shop["id"], "v1", visitedAt=_at(1), promiseDate=today_iso(), promiseAmount=5000)
    assert r.status_code == 200, r.text
    assert (r.json()["promise_date"], r.json()["promise_amount"]) == (today_iso(), 5000)

    [row] = _due(client, staff)
    assert (row["full_name"], row["amount"], row["remaining"], row["overdue"], row["beat_id"], row["beat_name"],
            row["outstanding_amount"]) == ("Gupta Stores", 5000, 5000, False, beat["id"], "North", 8000)
    assert _day_promise(client, staff, shop["id"]) == {"date": today_iso(), "amount": 5000, "remaining": 5000}
    assert [p["customer_id"] for p in _due(client, owner.headers)] == [shop["id"]]  # the owner sees every beat's

    _pay(client, staff, shop["id"], 2000, 1)  # part of it: still due, for the rest
    assert _due(client, staff)[0]["remaining"] == 3000
    _pay(client, owner.headers, shop["id"], 3000, 2)  # from any screen: the rest
    assert _due(client, staff) == [] and _due(client, owner.headers) == []
    assert _day_promise(client, staff, shop["id"]) is None


def test_overdue_first_and_cash_taken_before_the_promise_does_not_count(make_user, client):
    owner, [(sid, staff)] = _team(make_user, client, "staff")
    late = add_customer(client, owner.headers, full_name="Late Traders")
    now = add_customer(client, owner.headers, full_name="Arun Kirana")
    beat = _beat(client, owner, "North", user_id=sid, customers=[late["id"], now["id"]])
    assert _visit(client, staff, beat["id"], late["id"], "v1", visitedAt=_at(3), promiseDate=days_ago_iso(1),
                  promiseAmount=1200).status_code == 200
    _pay(client, staff, now["id"], 1000, 1)  # collected at the counter, then the rest promised
    assert _visit(client, staff, beat["id"], now["id"], "v2", promiseDate=today_iso(),
                  promiseAmount=4000).status_code == 200
    assert [(p["full_name"], p["remaining"], p["overdue"]) for p in _due(client, staff)] == [
        ("Late Traders", 1200, True), ("Arun Kirana", 4000, False)]
    # A promise for later isn't due yet; a newer promise replaces the older one.
    assert _visit(client, staff, beat["id"], late["id"], "v3", promiseDate=(
        datetime.now(IST) + timedelta(days=2)).date().isoformat(), promiseAmount=1200).status_code == 200
    assert [p["full_name"] for p in _due(client, staff)] == ["Arun Kirana"]


def test_no_amount_any_payment_keeps_it_and_staff_see_only_their_beats(make_user, client):
    owner, [(a, staff_a), (b, staff_b)] = _team(make_user, client, "staff", "staff")
    shop = add_customer(client, owner.headers, full_name="Gupta Stores")
    other = add_customer(client, owner.headers, full_name="South Shop")
    north = _beat(client, owner, "North", user_id=a, customers=[shop["id"]])
    south = _beat(client, owner, "South", user_id=b, customers=[other["id"]])
    assert _visit(client, staff_a, north["id"], shop["id"], "v1", promiseDate=today_iso()).status_code == 200
    assert _visit(client, staff_b, south["id"], other["id"], "v2", promiseDate=today_iso()).status_code == 200
    [mine] = _due(client, staff_a)
    assert (mine["full_name"], mine["amount"], mine["remaining"]) == ("Gupta Stores", None, None)
    assert [p["full_name"] for p in _due(client, staff_b)] == ["South Shop"]
    _pay(client, staff_a, shop["id"], 100, 1)
    assert _due(client, staff_a) == []

    # An amount needs the date; it must be a real amount.
    assert _visit(client, staff_a, north["id"], shop["id"], "v3", promiseAmount=500).status_code == 422
    assert _visit(client, staff_a, north["id"], shop["id"], "v4", promiseDate=today_iso(),
                  promiseAmount=0).status_code == 422
