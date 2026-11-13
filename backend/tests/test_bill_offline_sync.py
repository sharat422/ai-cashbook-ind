"""SC7, server side of offline bills: a bill queued on the phone syncs once
(one bill, one number), and is refused — for the phone's conflict screen —
when its stock has since been sold or a scheme it gets has ended.
(The phone side is src/features/stock/data/stockQueue.test.ts.)"""

from sqlalchemy import func, select

from conftest import days_ago_iso, today_iso
from app.database import SessionLocal
from app.models import Bill, LedgerEntry
from helpers import add_customer
from test_schemes import API, _item, _scheme, _stock


def _queued(client, headers, cid, lines, key, day=None):
    return client.post(f"{API}/bills", headers=headers, json={
        "customerId": cid, "date": day or today_iso(), "location": "godown", "clientId": key, "queued": True,
        "lines": [{"itemId": i, "quantity": q} for i, q in lines]})


def test_an_offline_bill_synced_twice_is_one_bill_with_one_number(make_user, client):
    owner = make_user()
    soap = _item(client, owner.headers, "Soap", price=25, opening=50)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    first = _queued(client, owner.headers, cid, [(soap, 4)], "offline-bill-1")
    again = _queued(client, owner.headers, cid, [(soap, 4)], "offline-bill-1")  # the retry
    assert first.status_code == again.status_code == 200, first.text
    assert first.json()["id"] == again.json()["id"]
    assert first.json()["billNumber"] == again.json()["billNumber"]
    assert _stock(client, owner.headers, soap)["godown"] == "46.000"  # taken once
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Bill).where(Bill.client_id == "offline-bill-1")) == 1
        assert db.scalar(select(func.count()).select_from(LedgerEntry).where(
            LedgerEntry.customer_id == cid, LedgerEntry.type == "credit")) == 1


def test_a_queued_bill_for_stock_since_sold_is_refused_and_never_oversells(make_user, client):
    owner = make_user()
    oil = _item(client, owner.headers, "Oil", price=100, opening=5)
    cid = add_customer(client, owner.headers, full_name="Lakshmi Kirana")["id"]
    assert _queued(client, owner.headers, cid, [(oil, 4)], "sold-first").status_code == 200
    late = _queued(client, owner.headers, cid, [(oil, 3)], "offline-late-bill")
    assert late.status_code == 422 and "Only 1" in late.json()["detail"]
    assert _stock(client, owner.headers, oil)["godown"] == "1.000"  # never below zero
    with SessionLocal() as db:
        assert db.scalars(select(Bill).where(Bill.client_id == "offline-late-bill")).first() is None


def test_a_queued_bill_whose_scheme_ended_offline_is_refused_with_the_reason(make_user, client):
    owner = make_user()
    soap = _item(client, owner.headers, "Soap", price=25)
    _scheme(client, owner.headers, "Diwali 10+1", [soap], start=days_ago_iso(10), end=days_ago_iso(1),
            buyQty=10, freeQty=1)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    # Made yesterday (the scheme's last day) with no signal, synced today.
    r = _queued(client, owner.headers, cid, [(soap, 20)], "offline-diwali", day=days_ago_iso(1))
    assert r.status_code == 409
    assert "Diwali 10+1" in r.json()["detail"] and "ended" in r.json()["detail"]
    with SessionLocal() as db:
        assert db.scalars(select(Bill).where(Bill.client_id == "offline-diwali")).first() is None
    # A bill with no scheme, or a scheme still running, syncs as usual.
    assert _queued(client, owner.headers, cid, [(soap, 5)], "offline-no-scheme", day=days_ago_iso(1)).status_code == 200
