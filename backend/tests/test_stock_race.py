"""Two sales at the same moment can't both take the last box: taking stock
out is one conditional UPDATE (qty >= n), and CHECK (qty >= 0) backs it up."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from conftest import today_iso
from app import stock
from app.database import Base, SessionLocal
from app.migrations import _backfill_stock_levels
from app.models import Business, Item, StockLevel, StockMove, User

API = "/api/v1"


def _item(client, owner, opening):
    r = client.post(f"{API}/items", headers=owner.headers,
                    json={"name": "Biscuits", "type": "product", "sale_price": 10, "unit": "box",
                          "track_stock": True, "stock_qty": opening})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _level(business_id, item_id):
    with SessionLocal() as db:
        return db.scalar(select(func.sum(StockLevel.qty)).where(
            StockLevel.business_id == business_id, StockLevel.item_id == item_id)) or 0


def test_twenty_sales_at_once_never_oversell_ten_boxes(make_user, client):
    owner = make_user()
    business_id = owner.business["id"]
    item_id = _item(client, owner, 10)
    with SessionLocal() as db:
        user_id = db.get(Business, business_id).user_id
    start = threading.Barrier(20)

    def sell(i: int) -> bool:
        start.wait()  # all twenty go at the same instant
        for _ in range(200):
            with SessionLocal() as db:
                try:
                    stock.record(db, db.get(Business, business_id), db.get(User, user_id), "owner",
                                 kind="sale", item_id=item_id, qty=1, location="godown",
                                 van_user_id=None, day=today_iso(), client_id=f"race-{i}", note=None)
                    return True
                except HTTPException:  # "Only 0 box … in the godown"
                    db.rollback()
                    return False
                except OperationalError:  # SQLite: another writer holds the lock — retry
                    db.rollback()
                    time.sleep(0.01)
        raise AssertionError("never got the lock")

    with ThreadPoolExecutor(20) as pool:
        sold = sum(pool.map(sell, range(20)))

    assert sold == 10
    assert _level(business_id, item_id) == 0
    with SessionLocal() as db:  # the audit log agrees with the level
        moves = db.scalar(select(func.sum(StockMove.quantity)).where(StockMove.item_id == item_id))
    assert Decimal(str(moves)) == 0
    r = client.get(f"{API}/stock", headers=owner.headers)
    assert r.status_code == 200


def test_selling_more_than_there_is_changes_nothing(make_user, client):
    owner = make_user()
    item_id = _item(client, owner, 5)
    r = client.post(f"{API}/stock/moves", headers=owner.headers,
                    json={"kind": "sale", "itemId": item_id, "quantity": 6, "location": "godown",
                          "date": today_iso(), "clientId": "too-many"})
    assert r.status_code == 422 and "Only 5" in r.json()["detail"]
    assert _level(owner.business["id"], item_id) == 5
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(StockMove)
                         .where(StockMove.item_id == item_id)) == 1  # just the opening stock


def test_database_refuses_negative_stock(make_user, client):
    owner = make_user()
    item_id = _item(client, owner, 3)
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.execute(update(StockLevel).where(StockLevel.item_id == item_id)
                   .values(qty=StockLevel.qty - 4))
    assert _level(owner.business["id"], item_id) == 3


def test_levels_are_built_once_from_the_old_move_ledger():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(id="u", mobile="9000000000"))
        db.add(Business(id="b", user_id="u", business_name="B", owner_name="O",
                        business_type="Retail", state="Karnataka"))
        db.flush()
        db.add_all([Item(id=i, business_id="b", name=i, sale_price=1) for i in ("i1", "i2")])
        db.flush()
        moves = [("i1", "godown", None, 30), ("i1", "godown", None, -20), ("i1", "van", "u", 20),
                 ("i2", "godown", None, 5), ("i2", "godown", None, -7)]  # i2 oversold by the old race
        for n, (item, loc, van, q) in enumerate(moves):
            db.add(StockMove(id=f"m{n}", business_id="b", item_id=item, location=loc, van_user_id=van,
                             kind="sale", quantity=Decimal(q), date="2026-01-01"))
        db.commit()
    _backfill_stock_levels(engine)
    _backfill_stock_levels(engine)  # runs once: a second boot changes nothing
    with Session(engine) as db:
        got = {(lv.item_id, lv.location, lv.van_key): lv.qty for lv in db.scalars(select(StockLevel)).all()}
    assert got == {("i1", "godown", ""): 10, ("i1", "van", "u"): 20, ("i2", "godown", ""): 0}
