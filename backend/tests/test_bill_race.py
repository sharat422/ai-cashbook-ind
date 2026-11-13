"""BL11: two bills at the same moment for the last units — exactly one gets
them. Bills take stock with the stock race fix (one conditional UPDATE per
line, CHECK qty >= 0), in item order; a bill with any line short is refused
whole, with nothing posted."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from app import billing
from app.database import SessionLocal
from app.gst import financial_year
from app.models import Bill, Business, LedgerEntry, StockMove, User
from conftest import today_iso
from helpers import add_customer
from test_schemes import API, _bill, _item, _stock

FY = financial_year(today_iso())


def test_two_bills_for_the_last_ten_units_at_once_exactly_one_succeeds(make_user, client):
    owner = make_user()
    bid = owner.business["id"]
    soap = _item(client, owner.headers, "Soap", price=25, opening=10)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    with SessionLocal() as db:
        uid = db.get(Business, bid).user_id
    start = threading.Barrier(2)

    def bill(i: int) -> int:
        start.wait()  # both at the same instant
        for _ in range(300):
            with SessionLocal() as db:
                try:
                    billing.save(db, db.get(Business, bid), db.get(User, uid), "owner", customer_id=cid,
                                 day=today_iso(), location="godown", van_user_id=None,
                                 lines_in=[SimpleNamespace(item_id=soap, quantity="10", rate=None)],
                                 client_id=f"last-ten-{i}")
                    return 200
                except HTTPException as e:  # "Only 0 pcs of Soap in the godown."
                    db.rollback()
                    return e.status_code
                except OperationalError:  # SQLite: the other writer holds the lock — the test retries
                    db.rollback()
                    time.sleep(0.01)
        raise AssertionError("never got the lock")

    with ThreadPoolExecutor(2) as pool:
        codes = sorted(pool.map(bill, range(2)))
    assert codes == [200, 422]
    assert _stock(client, owner.headers, soap)["godown"] == "0.000"  # never below zero
    with SessionLocal() as db:
        bills = db.scalars(select(Bill).where(Bill.business_id == bid)).all()
    assert [b.bill_number for b in bills] == [f"B-{FY}-1"]  # the refused one used no number


def test_a_bill_with_one_short_line_is_refused_whole(make_user, client):
    owner = make_user()
    bid = owner.business["id"]
    soap = _item(client, owner.headers, "Soap", price=25, opening=10)
    oil = _item(client, owner.headers, "Oil", price=100, opening=2)
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    r = _bill(client, owner.headers, cid, [(soap, 5), (oil, 3)])
    assert r.status_code == 422 and "Only 2" in r.json()["detail"]
    assert _stock(client, owner.headers, soap)["godown"] == "10.000"  # the soap line wasn't posted either
    assert _stock(client, owner.headers, oil)["godown"] == "2.000"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Bill).where(Bill.business_id == bid)) == 0
        assert db.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.customer_id == cid)) == 0
        assert db.scalar(select(func.count()).select_from(StockMove).where(
            StockMove.business_id == bid, StockMove.kind == "sale")) == 0
    ok = _bill(client, owner.headers, cid, [(soap, 5), (oil, 2)])
    assert ok.status_code == 200 and ok.json()["billNumber"] == f"B-{FY}-1"
