"""IM7: one-tap undo of a khata import. It removes exactly the rows that import
added (its ledger rows and the retailers it created, tracked by import id),
puts the other balances back, and writes one audit row. It never deletes later
work: refused (422, naming the rows) while something done since rests on the
import; refused twice; owner only."""

import uuid

import pytest
from sqlalchemy import select

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_ledger
from app.database import SessionLocal
from app.models import AccessLog, Customer, LedgerEntry, PaymentUtr
from test_beats import _team
from test_ledger_import import API, _counts, _csv, _post


def _balances(business_id):
    with SessionLocal() as db:
        return {c.full_name: round(c.outstanding_amount or 0, 2)
                for c in db.scalars(select(Customer).where(Customer.business_id == business_id))}


def _import(client, owner, rows):
    r = _post(client, owner, "/imports", _csv(rows), name=f"khata-{uuid.uuid4().hex[:6]}.csv")
    assert r.status_code == 200, r.text
    return r.json()


def _undo(client, who, log_id):
    return client.post(f"{API}/imports/{log_id}/undo", headers=who.headers if hasattr(who, "headers") else who)


def test_undo_removes_exactly_the_imports_rows_and_puts_the_balances_back(make_user, client):
    owner = make_user()
    biz = owner.business["id"]
    ravi = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    add_ledger(client, owner.headers, ravi, type="credit", amount=1000, date=days_ago_iso(9), client_id=f"b-{ravi}")
    counts_before, balances_before = _counts(biz), _balances(biz)

    log = _import(client, owner, [
        [days_ago_iso(3), "Ravi Stores", "B-1", "500", "udhar", ""],
        [days_ago_iso(2), "Sita Kirana", "B-2", "750", "udhar", ""],
        [days_ago_iso(1), "Ravi Stores", "", "200", "jama", ""],
    ])
    assert _balances(biz) == {"Ravi Stores": 1300.0, "Sita Kirana": 750.0}
    listed = client.get(f"{API}/imports", headers=owner.headers).json()[0]
    assert (listed["canUndo"], listed["blockers"], listed["undoneAt"]) == (True, [], None)

    r = _undo(client, owner, log["id"])
    assert r.status_code == 200, r.text
    assert r.json()["undoneAt"] and r.json()["canUndo"] is False
    # Exactly as before the import: Sita (created by it) gone, Ravi back to ₹1,000; the log stays.
    customers, entries, logs = _counts(biz)
    assert (customers, entries) == counts_before[:2] and logs == counts_before[2] + 1
    assert _balances(biz) == balances_before == {"Ravi Stores": 1000.0}
    with SessionLocal() as db:
        audit = db.scalars(select(AccessLog).where(AccessLog.action == "undo", AccessLog.path.contains(log["id"]))).all()
    assert len(audit) == 1 and "3 entries and 1 new retailers removed" in audit[0].path


def test_work_done_since_on_an_existing_retailer_is_kept(make_user, client):
    owner = make_user()
    biz = owner.business["id"]
    ravi = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    log = _import(client, owner, [[days_ago_iso(2), "Ravi Stores", "B-1", "500", "udhar", ""]])
    add_ledger(client, owner.headers, ravi, type="payment", amount=100, date=today_iso(), client_id=f"a-{ravi}")
    assert _undo(client, owner, log["id"]).status_code == 200
    assert _balances(biz) == {"Ravi Stores": -100.0}  # the later payment stays; only the import's ₹500 left
    with SessionLocal() as db:
        assert [e.client_id for e in db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id == ravi))] == [f"a-{ravi}"]


def test_undo_is_refused_while_later_work_rests_on_the_import_and_names_it(make_user, client):
    owner = make_user()
    log = _import(client, owner, [
        [days_ago_iso(3), "Sita Kirana", "B-2", "750", "udhar", ""],
        [days_ago_iso(2), "Gopal Traders", "B-3", "400", "udhar", ""],
        [days_ago_iso(1), "Hari Stores", "B-4", "300", "udhar", ""],
    ])
    with SessionLocal() as db:
        made = {c.full_name: c for c in db.scalars(select(Customer).where(Customer.import_id == log["id"]))}
        hari_entry = db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id == made["Hari Stores"].id)).one()
        hari_entry_id = hari_entry.id
    # Since the import: Sita's details edited, Gopal given a new sale, and a later row now points at Hari's
    # imported sale (a UTR row here; a bank match or a credit note is the same rule: any row pointing at it).
    sita = made["Sita Kirana"]
    assert client.patch(f"{API}/customers/{sita.id}", headers=owner.headers,
                      json={"full_name": "Sita Kirana", "mobile": "9876500001"}).status_code == 200
    add_ledger(client, owner.headers, made["Gopal Traders"].id, type="credit", amount=90, date=today_iso(),
               client_id=f"g-{uuid.uuid4()}")
    with SessionLocal() as db:
        db.add(PaymentUtr(business_id=owner.business["id"], utr_hash=uuid.uuid4().hex * 2, ledger_entry_id=hari_entry_id))
        db.commit()

    r = _undo(client, owner, log["id"])
    body = r.json()
    assert r.status_code == 422 and body["code"] == "import_undo_blocked"
    reasons = {(b["reason"], b["retailer"]) for b in body["blockers"]}
    assert reasons == {("retailer_edited", "Sita Kirana"), ("retailer_used", "Gopal Traders"),
                       ("entry_used", "Hari Stores")}
    hari = next(b for b in body["blockers"] if b["reason"] == "entry_used")
    assert (hari["row"], hari["amount"], hari["date"]) == (4, 300.0, days_ago_iso(1))   # the file row, named
    # Nothing was undone; the log shows why.
    assert set(_balances(owner.business["id"])) == {"Sita Kirana", "Gopal Traders", "Hari Stores"}
    listed = client.get(f"{API}/imports", headers=owner.headers).json()[0]
    assert listed["canUndo"] is False and len(listed["blockers"]) == 3


def test_a_newer_import_must_be_undone_first(make_user, client):
    owner = make_user()
    older = _import(client, owner, [[days_ago_iso(3), "Sita Kirana", "B-2", "750", "udhar", ""]])
    newer = _import(client, owner, [[days_ago_iso(2), "Ravi Stores", "B-9", "50", "udhar", ""]])
    r = _undo(client, owner, older["id"])
    assert r.status_code == 422 and r.json()["blockers"] == [{"reason": "later_import", "file": newer["fileName"]}]
    assert _undo(client, owner, newer["id"]).status_code == 200
    assert _undo(client, owner, older["id"]).status_code == 200


def test_undoing_twice_is_refused_and_staff_get_403(make_user, client):
    owner, [(_, staff), (_, accountant)] = _team(make_user, client, "staff", "accountant")
    log = _import(client, owner, [[days_ago_iso(2), "Sita Kirana", "B-2", "750", "udhar", ""]])
    for headers in (staff, accountant):
        assert _undo(client, headers, log["id"]).status_code == 403
    assert _undo(client, owner, log["id"]).status_code == 200
    again = _undo(client, owner, log["id"])
    assert again.status_code == 422 and again.json()["code"] == "import_already_undone"
    assert again.json()["params"]["date"] == today_iso()


@pytest.mark.parametrize("client_id,expected", [("imp_" + "a" * 32 + "_12", 12), ("x-1", None)])
def test_an_imported_rows_file_row_comes_from_its_client_id(client_id, expected):
    from app.ledger_import import _row_of
    assert _row_of(LedgerEntry(client_id=client_id)) == expected
