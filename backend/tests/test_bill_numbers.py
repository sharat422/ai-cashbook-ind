"""BL10: bill numbers are {prefix}-{FY}-{n} — the GST invoice rule: given by
the server, consecutive and unique per business per financial year, never
reused. The prefix is the owner's; old B-1… numbers stay as they are."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app import billing
from app.database import SessionLocal
from app.gst import financial_year
from app.models import Bill, Business, User
from conftest import days_ago_iso, today_iso
from helpers import add_customer
from test_schemes import API, _bill, _item

FY = financial_year(today_iso())


def _setup(make_user, client):
    owner = make_user()
    soap = _item(client, owner.headers, "Soap", price=25)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    return owner, soap, cid


def test_bills_made_at_the_same_moment_get_consecutive_numbers_once_each(make_user, client):
    owner, soap, cid = _setup(make_user, client)
    bid = owner.business["id"]
    with SessionLocal() as db:
        uid = db.get(Business, bid).user_id
    n = 10
    start = threading.Barrier(n)

    def make(i: int) -> str:
        start.wait()  # all at the same instant
        for _ in range(300):
            with SessionLocal() as db:
                try:
                    return billing.save(db, db.get(Business, bid), db.get(User, uid), "owner", customer_id=cid,
                                        day=today_iso(), location="godown", van_user_id=None,
                                        lines_in=[SimpleNamespace(item_id=soap, quantity="1", rate=None)],
                                        client_id=f"race-bill-{i}").bill_number
                except OperationalError:  # SQLite: another writer holds the lock — retry
                    db.rollback()
                    time.sleep(0.01)
        raise AssertionError("never got the lock")

    with ThreadPoolExecutor(n) as pool:
        numbers = list(pool.map(make, range(n)))
    assert sorted(numbers, key=lambda x: int(x.rsplit("-", 1)[1])) == [f"B-{FY}-{k}" for k in range(1, n + 1)]
    with SessionLocal() as db:
        assert len(db.scalars(select(Bill).where(Bill.business_id == bid)).all()) == n


def test_a_cancelled_bills_number_is_never_reused(make_user, client):
    owner, soap, cid = _setup(make_user, client)
    first = _bill(client, owner.headers, cid, [(soap, 2)]).json()
    assert first["billNumber"] == f"B-{FY}-1"
    ret = client.post(f"{API}/bills/{first['id']}/cancel", headers=owner.headers, json={"itemIds": []})
    assert ret.status_code == 200, ret.text
    assert ret.json()["billNumber"] == f"B-{FY}-2"  # the return takes the next number
    nxt = _bill(client, owner.headers, cid, [(soap, 1)]).json()
    assert nxt["billNumber"] == f"B-{FY}-3"
    again = client.get(f"{API}/bills/{first['id']}", headers=owner.headers).json()
    assert (again["billNumber"], again["status"]) == (f"B-{FY}-1", "cancelled")  # it keeps its number


def test_a_new_prefix_applies_to_new_bills_only(make_user, client):
    owner, soap, cid = _setup(make_user, client)
    old = _bill(client, owner.headers, cid, [(soap, 1)]).json()
    assert client.get(f"{API}/bill-series", headers=owner.headers).json() == {
        "prefix": "B", "financialYear": FY, "nextNumber": f"B-{FY}-2"}
    r = client.put(f"{API}/bill-series", headers=owner.headers, json={"prefix": "sb"})
    assert r.status_code == 200 and r.json()["nextNumber"] == f"SB-{FY}-2"
    new = _bill(client, owner.headers, cid, [(soap, 1)]).json()
    assert new["billNumber"] == f"SB-{FY}-2"  # still consecutive in the year
    assert client.get(f"{API}/bills/{old['id']}", headers=owner.headers).json()["billNumber"] == f"B-{FY}-1"
    for bad in ("S-B", "TOOLONG1", "₹"):
        assert client.put(f"{API}/bill-series", headers=owner.headers, json={"prefix": bad}).status_code == 422


def test_only_the_owner_sets_the_prefix(make_user, client):
    from test_stock import _team
    owner, [(_, staff)] = _team(make_user, client, "staff")
    assert client.put(f"{API}/bill-series", headers=staff, json={"prefix": "X"}).status_code == 403
    assert client.get(f"{API}/bill-series", headers=owner.headers).json()["prefix"] == "B"


def test_old_numbers_stay_and_the_series_carries_on_after_them(make_user, client):
    owner, soap, cid = _setup(make_user, client)
    bid = owner.business["id"]
    with SessionLocal() as db:  # bills numbered the old way, this year and the year before
        for i, day in enumerate([today_iso(), today_iso(), days_ago_iso(400)], start=1):
            db.add(Bill(business_id=bid, customer_id=cid, bill_number=f"B-{i}", date=day, location="godown",
                        subtotal=0, discount=0, total=0))
        db.commit()
    nxt = _bill(client, owner.headers, cid, [(soap, 1)]).json()
    assert nxt["billNumber"] == f"B-{FY}-3"  # two old bills this year, so this is the third
    with SessionLocal() as db:
        assert sorted(b.bill_number for b in db.scalars(select(Bill).where(Bill.business_id == bid))) == \
            sorted(["B-1", "B-2", "B-3", f"B-{FY}-3"])
