"""A UPI UTR identifies one transaction: the same UTR twice in one business is
refused with a warning naming the earlier payment, never saved twice."""

from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from conftest import days_ago_iso, today_iso
from helpers import add_customer
from app.crypto import blind_index
from app.database import Base, SessionLocal
from app.migrations import _backfill_payment_utrs
from app.models import Business, Customer, LedgerEntry, PaymentUtr, User

API = "/api/v1"


def _pay(client, headers, cid, utr, client_id, method="upi", amount=500, date=None):
    return client.post(f"{API}/customers/{cid}/ledger", headers=headers, data={
        "type": "payment", "amount": str(amount), "date": date or today_iso(),
        "client_id": client_id, "payment_method": method, "reference_number": utr})


def test_same_utr_twice_is_refused_with_the_earlier_payment(make_user, client):
    owner = make_user()
    ramesh = add_customer(client, owner.headers, full_name="Ramesh Kirana")["id"]
    suresh = add_customer(client, owner.headers, full_name="Suresh Stores")["id"]
    assert _pay(client, owner.headers, ramesh, "412345678901", "p1", date=days_ago_iso(2)).status_code == 200

    for utr in ("412345678901", "4123 4567 8901"):  # spaces don't make it a new UTR
        r = _pay(client, owner.headers, suresh, utr, f"dup-{utr}", amount=900)
        assert r.status_code == 409
        d = days_ago_iso(2)
        assert r.json()["detail"] == (f"This UTR is already on a UPI payment of ₹500.00 from Ramesh Kirana "
                                      f"on {d[8:10]}-{d[5:7]}-{d[:4]}. Each UPI payment has its own UTR — check for a typo.")
    ledger = client.get(f"{API}/customers/{suresh}/ledger", headers=owner.headers).json()
    assert ledger == []  # nothing saved

    # A retry of the first payment (same client_id) is not a duplicate.
    assert _pay(client, owner.headers, ramesh, "412345678901", "p1").status_code == 200
    # Cash and cheque references aren't UTRs.
    assert _pay(client, owner.headers, suresh, "412345678901", "c1", method="cheque").status_code == 200


def test_utrs_are_per_business_and_freed_when_the_entry_goes(make_user, client):
    a, b = make_user(), make_user()
    ca, cb = add_customer(client, a.headers)["id"], add_customer(client, b.headers)["id"]
    assert _pay(client, a.headers, ca, "512345678901", "a1").status_code == 200
    assert _pay(client, b.headers, cb, "512345678901", "b1").status_code == 200  # another distributor

    assert client.delete(f"{API}/customers/{ca}", headers=a.headers).status_code == 204
    again = add_customer(client, a.headers)["id"]
    assert _pay(client, a.headers, again, "512345678901", "a2").status_code == 200


def test_database_holds_one_row_per_business_and_utr(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    entry = _pay(client, owner.headers, cid, "612345678901", "x1").json()
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.add(PaymentUtr(business_id=owner.business["id"], utr_hash=blind_index("612345678901"),
                          ledger_entry_id=entry["id"]))
        db.commit()


def test_utrs_saved_before_the_index_are_indexed_once():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(id="u", mobile="9000000000"))
        db.add(Business(id="b", user_id="u", business_name="B", owner_name="O", business_type="Retail",
                        state="Karnataka"))
        db.add(Customer(id="c", business_id="b", full_name="C", mobile=""))
        db.flush()
        for n, (method, utr) in enumerate([("upi", "712345678901"), ("upi", "712345678901"),
                                           ("cash", "712345678902"), ("upi", "712345678903")]):
            db.add(LedgerEntry(id=f"e{n}", customer_id="c", type="payment", amount=1, date="2026-01-01",
                               payment_method=method, reference_number=utr, created_at=f"2026-01-01T00:00:0{n}"))
        db.commit()
    _backfill_payment_utrs(engine)
    _backfill_payment_utrs(engine)
    with Session(engine) as db:
        got = sorted(db.scalars(select(PaymentUtr.ledger_entry_id)).all())
    assert got == ["e0", "e3"]  # the old duplicate keeps only its first; cash isn't a UTR
