"""S3: a supplier list, and every purchase books an expense in the same
transaction as the stock. The backfill never merges two spellings."""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import select

from app import stock
from app.database import SessionLocal
from app.models import Expense, StockMove, Supplier
from conftest import today_iso
from test_stock import API, _item, _levels, _team

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "backfill_suppliers.py"
spec = importlib.util.spec_from_file_location("backfill_suppliers", SCRIPT)
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)


def _buy(client, headers, item_id, qty, cid, **supplier):
    return client.post(f"{API}/stock/moves", headers=headers, json={
        "kind": "purchase", "itemId": item_id, "quantity": qty, "location": "godown", "date": today_iso(),
        "clientId": cid, "unitPrice": "80", "billRef": f"B-{cid}", **supplier})


def _suppliers(client, headers):
    return client.get(f"{API}/suppliers", headers=headers).json()


def _expenses_for(purchase_id):
    with SessionLocal() as db:
        return db.scalars(select(Expense).where(Expense.purchase_id == purchase_id)).all()


def test_a_purchase_from_a_new_supplier_adds_it_and_books_the_expense(make_user, client):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers)
    r = _buy(client, owner.headers, item, 10, "p1", supplier="Sharma Traders",
             gstRate="18", gstAmount="144")
    assert r.status_code == 200, r.text
    move = r.json()[0]
    [s] = _suppliers(client, owner.headers)
    assert (s["name"], move["supplierId"]) == ("Sharma Traders", s["id"])
    [e] = _expenses_for(move["id"])
    assert (e.amount, e.category, e.vendor, e.date) == (944.0, "Purchases", "Sharma Traders", today_iso())  # 10×80+144
    # It shows in the expenses list like any other expense.
    listed = client.get(f"{API}/expenses", headers=owner.headers).json()
    items = listed["items"] if isinstance(listed, dict) else listed
    assert [x["purchase_id"] for x in items if x["purchase_id"]] == [move["id"]]
    # A retried purchase books one expense, not two.
    assert _buy(client, owner.headers, item, 10, "p1", supplier="Sharma Traders").json()[0]["id"] == move["id"]
    assert len(_expenses_for(move["id"])) == 1


def test_picking_the_same_supplier_adds_no_duplicate(make_user, client):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers)
    first = _buy(client, owner.headers, item, 1, "p1", supplier="Sharma Traders").json()[0]
    assert _buy(client, owner.headers, item, 2, "p2", supplierId=first["supplierId"]).status_code == 200
    assert _buy(client, owner.headers, item, 3, "p3", supplier="  sharma   traders ").status_code == 200  # same spelling
    assert [s["name"] for s in _suppliers(client, owner.headers)] == ["Sharma Traders"]
    assert _buy(client, owner.headers, item, 1, "p4", supplierId="nope").status_code == 404


def test_if_the_expense_fails_the_stock_isnt_added_either(make_user, client, monkeypatch):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers, opening=5)
    before = _levels(client, owner.headers, item)

    def broken(*_a, **_k):
        raise RuntimeError("expense write failed")

    monkeypatch.setattr(stock, "purchase_expense", broken)
    with pytest.raises(RuntimeError):
        _buy(client, owner.headers, item, 10, "boom", supplier="Sharma Traders")
    assert _levels(client, owner.headers, item) == before  # still 5: the stock went back
    with SessionLocal() as db:
        assert db.scalars(select(StockMove).where(StockMove.client_id == "boom")).first() is None
        assert db.scalars(select(Supplier).where(Supplier.name == "Sharma Traders",
                                                 Supplier.business_id == owner.business["id"])).first() is None


def test_the_backfill_never_merges_two_spellings(make_user, client):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers)
    ids = [_buy(client, owner.headers, item, 1, f"o{i}", supplier=name).json()[0]["id"]
           for i, name in enumerate(("Sharma Traders", "Sharma Trader", "SHARMA TRADERS"))]
    with SessionLocal() as db:  # as saved before the supplier list existed
        for m in db.scalars(select(StockMove).where(StockMove.id.in_(ids))):
            m.supplier_id = None
        db.query(Supplier).filter(Supplier.business_id == owner.business["id"]).delete()
        db.commit()
    with SessionLocal() as db:
        out = script.backfill(db)
    assert sorted(n for n in out["suppliersCreated"] if n.lower().startswith("sharma")) == [
        "Sharma Trader", "Sharma Traders"]  # two rows; the all-caps one is the same spelling
    names = sorted(s["name"] for s in _suppliers(client, owner.headers))
    assert names == ["Sharma Trader", "Sharma Traders"]
    with SessionLocal() as db:
        again = script.backfill(db)
    assert again == {"suppliersCreated": [], "purchasesLinked": 0}
