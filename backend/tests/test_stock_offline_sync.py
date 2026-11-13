"""S5, server side of the offline queue: a stock entry sent twice with the same
client id (a sync retry after a lost response) is saved once; a queued sale
for stock that has since gone is refused and the place never goes below 0.
(The phone side — queueing, conflicts, counts refused offline — is
src/features/stock/data/stockQueue.test.ts.)"""

from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import StockMove
from test_stock import API, _item, _levels, _move, _team, _transfer


def test_a_van_sale_synced_twice_is_saved_once(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    item = _item(client, owner.headers, opening=20)
    _transfer(client, owner.headers, item, 10, a_id)
    first = _move(client, staff_a, item, "sale", 3, location="van", cid="offline-s1")
    again = _move(client, staff_a, item, "sale", 3, location="van", cid="offline-s1")  # the retry
    assert first.status_code == again.status_code == 200
    assert first.json()[0]["id"] == again.json()[0]["id"]
    assert _levels(client, owner.headers, item)["vans"][a_id] == "7.000"  # taken once
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(StockMove).where(StockMove.client_id == "offline-s1")) == 1
    # A queued transfer replayed is saved once too.
    t1 = _transfer(client, owner.headers, item, 2, a_id, cid="offline-t1").json()
    t2 = _transfer(client, owner.headers, item, 2, a_id, cid="offline-t1").json()
    assert {m["id"] for m in t1} == {m["id"] for m in t2}  # the same two rows (order may differ)
    assert _levels(client, owner.headers, item)["vans"][a_id] == "9.000"


def test_a_queued_sale_for_stock_since_sold_is_refused_and_never_oversells(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    item = _item(client, owner.headers, opening=5)
    _transfer(client, owner.headers, item, 5, a_id)
    assert _move(client, owner.headers, item, "sale", 4, location="van", van=a_id).status_code == 200  # sold first
    queued = _move(client, staff_a, item, "sale", 3, location="van", cid="offline-late")
    assert queued.status_code == 422  # the phone turns this into a conflict
    assert _levels(client, owner.headers, item)["vans"][a_id] == "1.000"  # never below zero
    with SessionLocal() as db:
        assert db.scalars(select(StockMove).where(StockMove.client_id == "offline-late")).first() is None
