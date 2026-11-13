"""S2: van → godown returns and van → van moves, on the same transfer code
as a godown → van load. The source gives only what it has (one conditional
UPDATE); total stock never changes; history shows a transfer."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from conftest import today_iso
from app import stock
from app.database import SessionLocal
from app.models import Business, User
from test_stock import API, _item, _levels, _team, _transfer


def _move_between(client, headers, item_id, qty, frm, to, cid=None):
    """frm/to: "godown" or a van's user id."""
    body = {"itemId": item_id, "quantity": qty, "date": today_iso(), "clientId": cid,
            "fromLocation": "godown" if frm == "godown" else "van",
            "fromVanUserId": None if frm == "godown" else frm,
            "toLocation": "godown" if to == "godown" else "van",
            "vanUserId": None if to == "godown" else to}
    return client.post(f"{API}/stock/transfers", headers=headers, json=body)


def _loaded(make_user, client, qty=30):
    owner, [(a_id, staff_a), (b_id, staff_b)] = _team(make_user, client, "staff", "staff")
    item = _item(client, owner.headers, opening=50)
    assert _transfer(client, owner.headers, item, qty, a_id).status_code == 200
    return owner, (a_id, staff_a), (b_id, staff_b), item


def test_returning_ten_to_the_godown_moves_stock_and_keeps_the_total(make_user, client):
    owner, (a_id, staff_a), (b_id, _b), item = _loaded(make_user, client)
    before = _levels(client, owner.headers, item)
    assert (before["godown"], before["vans"][a_id], before["total"]) == ("20.000", "30.000", "50.000")

    r = _move_between(client, staff_a, item, 10, a_id, "godown")  # staff return their own van stock
    assert r.status_code == 200, r.text
    assert [(m["kind"], m["location"], m["quantity"]) for m in r.json()] == [
        ("transfer", "van", "-10.000"), ("transfer", "godown", "10.000")]
    lv = _levels(client, owner.headers, item)
    assert (lv["godown"], lv["vans"][a_id], lv["total"]) == ("30.000", "20.000", "50.000")

    # Van → van: A hands 5 to B; the total still doesn't move.
    assert _move_between(client, staff_a, item, 5, a_id, b_id).status_code == 200
    lv = _levels(client, owner.headers, item)
    assert (lv["vans"][a_id], lv["vans"][b_id], lv["total"]) == ("15.000", "5.000", "50.000")

    history = client.get(f"{API}/stock/moves", headers=owner.headers, params={"itemId": item}).json()
    kinds = {m["kind"] for m in history}
    assert kinds == {"opening", "transfer"}  # moves only: no sale, no count correction


def test_moving_more_than_the_van_holds_is_refused_and_changes_nothing(make_user, client):
    owner, (a_id, staff_a), _b, item = _loaded(make_user, client, qty=10)
    before = _levels(client, owner.headers, item)
    r = _move_between(client, staff_a, item, 11, a_id, "godown")
    assert r.status_code == 422, r.text
    assert _levels(client, owner.headers, item) == before
    assert _move_between(client, owner.headers, item, 1, a_id, a_id).status_code == 422  # same place


def test_two_moves_for_the_last_units_at_once_only_one_wins(make_user, client):
    owner, (a_id, _a), (b_id, _b), item = _loaded(make_user, client, qty=5)
    business_id = owner.business["id"]
    with SessionLocal() as db:
        user_id = db.get(Business, business_id).user_id
    start = threading.Barrier(2)

    def move(i: int) -> bool:
        start.wait()  # both go at the same instant
        for _ in range(200):
            with SessionLocal() as db:
                try:
                    stock.transfer(db, db.get(Business, business_id), db.get(User, user_id), "owner",
                                   item_id=item, qty=5, from_location="van", from_van_user_id=a_id,
                                   to_location="godown" if i else "van", van_user_id=None if i else b_id,
                                   day=today_iso(), client_id=f"race-{i}", note=None)
                    return True
                except HTTPException:  # "Only 0 box … in the van"
                    db.rollback()
                    return False
                except OperationalError:  # SQLite: another writer holds the lock — retry
                    db.rollback()
                    time.sleep(0.01)
        raise AssertionError("never got the lock")

    with ThreadPoolExecutor(2) as pool:
        assert sum(pool.map(move, range(2))) == 1
    lv = _levels(client, owner.headers, item)
    assert lv["vans"].get(a_id, "0.000") == "0.000" and lv["total"] == "50.000"  # an empty van isn't listed


def test_staff_cannot_move_stock_out_of_someone_elses_van(make_user, client):
    owner, (a_id, staff_a), (b_id, staff_b), item = _loaded(make_user, client)
    before = _levels(client, owner.headers, item)
    assert _move_between(client, staff_b, item, 1, a_id, "godown").status_code == 403
    assert _move_between(client, staff_b, item, 1, a_id, b_id).status_code == 403
    assert _move_between(client, staff_a, item, 1, "godown", a_id).status_code == 403  # loading is the owner's
    assert _levels(client, owner.headers, item) == before
