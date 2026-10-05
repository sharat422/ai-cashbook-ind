"""The read-only reconciliation report detects duplicate idempotency keys and
owner/business anomalies without mutating anything.

Duplicates are seeded via direct inserts (the API is idempotent and won't create
them), simulating rows a concurrent race already left behind.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    Business,
    BusinessMember,
    Customer,
    Expense,
    Income,
    LedgerEntry,
    User,
)
from scripts.reconcile import reconcile


def _mk_business(s: Session, *, with_active_owner: bool = True) -> Business:
    uid = uuid.uuid4().hex
    s.add(User(id=uid, mobile="9" + uuid.uuid4().int.__str__()[:9]))
    biz = Business(
        id=uuid.uuid4().hex,
        user_id=uid,
        business_name="Recon Co",
        owner_name="Owner",
        business_type="Retail",
        state="KA",
    )
    s.add(biz)
    if with_active_owner:
        s.add(BusinessMember(id=uuid.uuid4().hex, business_id=biz.id, user_id=uid, role="owner", status="active"))
    s.commit()
    return biz


def test_detects_duplicate_client_ids_and_owner_anomalies():
    dup = f"dup-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as s:
        biz = _mk_business(s)
        # Two incomes + two expenses sharing one (business_id, client_id).
        for _ in range(2):
            s.add(Income(id=uuid.uuid4().hex, business_id=biz.id, amount=100, category="Sales", date="2026-09-20", client_id=dup))
            s.add(Expense(id=uuid.uuid4().hex, business_id=biz.id, amount=50, category="Fuel", vendor="HP", date="2026-09-20", client_id=dup))
        # A recurring-post style duplicate.
        recur_cid = f"recur:{uuid.uuid4().hex}:2026-09-20"
        for _ in range(2):
            s.add(Expense(id=uuid.uuid4().hex, business_id=biz.id, amount=20000, category="Rent", vendor="LL", date="2026-09-20", client_id=recur_cid))
        # Two ledger entries sharing one (customer_id, client_id).
        cust = Customer(id=uuid.uuid4().hex, business_id=biz.id, full_name="C", mobile="7000000123")
        s.add(cust)
        s.flush()
        for _ in range(2):
            s.add(LedgerEntry(id=uuid.uuid4().hex, customer_id=cust.id, type="payment", amount=10, date="2026-09-20", client_id=dup))
        s.commit()

        # A business with NO active owner (locked out) and creator-not-owner.
        orphan = _mk_business(s, with_active_owner=False)

        # Capture ids while the instances are still session-bound.
        biz_id, cust_id, orphan_id = biz.id, cust.id, orphan.id
        report = reconcile(s)

    inc_keys = {(g["business_id"], g["client_id"]) for g in report["duplicates"]["incomes"]["sample"]}
    exp_keys = {(g["business_id"], g["client_id"]) for g in report["duplicates"]["expenses"]["sample"]}
    led_keys = {(g["customer_id"], g["client_id"]) for g in report["duplicates"]["ledger_entries"]["sample"]}

    assert (biz_id, dup) in inc_keys
    assert (biz_id, dup) in exp_keys
    assert (cust_id, dup) in led_keys
    assert report["duplicates"]["recurring_posts"]["groups"] >= 1

    assert orphan_id in report["owners"]["businesses_without_active_owner"]
    creators = {c["business_id"] for c in report["owners"]["creator_not_active_owner"]}
    assert orphan_id in creators
    assert report["clean"] is False


def test_reconcile_makes_no_writes():
    """Running the report must not change row counts (read-only guarantee)."""
    with SessionLocal() as s:
        before = {
            m.__name__: s.query(m).count()
            for m in (Income, Expense, LedgerEntry, Customer, Business, BusinessMember, User)
        }
        reconcile(s)
        s.rollback()
        after = {
            m.__name__: s.query(m).count()
            for m in (Income, Expense, LedgerEntry, Customer, Business, BusinessMember, User)
        }
    assert before == after
