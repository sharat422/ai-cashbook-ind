"""A wrongly typed expense can be fixed or deleted by the owner: Reports change at
once and every change is in the audit log. A stock purchase's expense goes only by
reversing the purchase in Stock, which deletes it with the reversal."""

from sqlalchemy import select

from app.database import SessionLocal
from app.models import AccessLog
from conftest import today_iso
from helpers import add_expense
from test_stock import _item, _team
from test_suppliers import _buy, _expenses_for

API = "/api/v1"


def _pnl(client, headers):
    day = today_iso()
    return client.get(f"{API}/reports/summary", headers=headers, params={"from": day, "to": day}).json()


def _audit(client, headers, action):
    bid = client.get(f"{API}/businesses/me", headers=headers).json()["id"]
    with SessionLocal() as db:
        return [r.path for r in db.scalars(select(AccessLog).where(
            AccessLog.business_id == bid, AccessLog.action == action))]


def test_the_owner_fixes_a_wrong_expense_and_then_deletes_it(make_user, client):
    owner = make_user()
    exp = add_expense(client, owner.headers, amount=8000, date=today_iso(), client_id="e1", vendor="HP Petrol")
    assert _pnl(client, owner.headers)["expense_total"] == 8000

    r = client.patch(f"{API}/expenses/{exp['id']}", headers=owner.headers,
                     json={"amount": 800, "vendor": "Indian Oil", "notes": "diesel"})
    assert r.status_code == 200, r.text
    assert (r.json()["amount"], r.json()["vendor"], r.json()["category"]) == (800, "Indian Oil", "Fuel")
    pnl = _pnl(client, owner.headers)
    assert (pnl["expense_total"], pnl["profit"]) == (800, -800)
    [log] = _audit(client, owner.headers, "edit")
    assert log.startswith(f"Edited expense {today_iso()} · Fuel · HP Petrol · ₹8,000.00: ")
    assert "amount ₹8,000.00 → ₹800.00; vendor HP Petrol → Indian Oil; notes changed" in log and "diesel" not in log

    assert client.delete(f"{API}/expenses/{exp['id']}", headers=owner.headers).status_code == 204
    assert _pnl(client, owner.headers)["expense_total"] == 0
    assert client.get(f"{API}/expenses", headers=owner.headers).json() == []
    [log] = _audit(client, owner.headers, "delete")
    assert log == f"Deleted expense {today_iso()} · Fuel · Indian Oil · ₹800.00 ({exp['id']})"
    r = client.post(f"{API}/expenses", headers=owner.headers, data={  # the phone's queue retrying it
        "amount": "8000", "category": "Fuel", "date": today_iso(), "client_id": "e1"})
    assert r.status_code == 410 and r.json()["code"] == "entry_discarded"


def test_only_the_owner_and_only_their_own(make_user, client):
    owner, [(_, staff), (_, accountant)] = _team(make_user, client, "staff", "accountant")
    exp = add_expense(client, owner.headers, amount=500, date=today_iso(), client_id="e1")
    for headers in (staff, accountant):
        assert client.patch(f"{API}/expenses/{exp['id']}", headers=headers, json={"amount": 1}).status_code == 403
        assert client.delete(f"{API}/expenses/{exp['id']}", headers=headers).status_code == 403
    other = make_user()
    assert client.delete(f"{API}/expenses/{exp['id']}", headers=other.headers).status_code == 404
    assert _pnl(client, owner.headers)["expense_total"] == 500


def test_a_purchase_expense_goes_only_with_the_reversal_of_its_purchase(make_user, client):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers)
    move = _buy(client, owner.headers, item, 10, "p1", supplier="Sharma Traders").json()[0]  # 10 × ₹80
    [exp] = _expenses_for(move["id"])
    for r in (client.patch(f"{API}/expenses/{exp.id}", headers=owner.headers, json={"amount": 1}),
              client.delete(f"{API}/expenses/{exp.id}", headers=owner.headers)):
        assert r.status_code == 409 and r.json()["code"] == "purchase_expense"
    assert _pnl(client, owner.headers)["expense_total"] == 800

    r = client.post(f"{API}/stock/moves/{move['id']}/reverse", headers=owner.headers)
    assert r.status_code == 200, r.text
    assert _expenses_for(move["id"]) == []
    assert _pnl(client, owner.headers)["expense_total"] == 0
    [log] = _audit(client, owner.headers, "delete")
    assert log.startswith(f"Deleted expense {today_iso()} · Purchases · Sharma Traders · ₹800.00, "
                          f"with the reversal of its stock purchase on {today_iso()}")
    # Buying it again (a new entry) books a new expense as usual.
    again = _buy(client, owner.headers, item, 10, "p2", supplier="Sharma Traders").json()[0]
    assert len(_expenses_for(again["id"])) == 1 and _pnl(client, owner.headers)["expense_total"] == 800
