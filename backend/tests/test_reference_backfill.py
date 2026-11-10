"""R9: scripts/backfill_reference_fingerprints.py gives payments saved before
the duplicate warning the same fingerprint, so the warning covers them too.
Fills ref_hash only; skips (and counts) payments with no reference."""

import importlib.util
from pathlib import Path

from sqlalchemy import select

from app.database import SessionLocal
from app.models import LedgerEntry
from helpers import add_customer
from test_reference_warning import _pay

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "backfill_reference_fingerprints.py"
spec = importlib.util.spec_from_file_location("backfill_refs", SCRIPT)
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)

CHEQUE = {"cheque_bank": "SBI Main Road", "cheque_account": "1234"}


def _as_before_the_warning(*ids):
    """Saved before fingerprints existed: no ref_hash."""
    with SessionLocal() as db:
        for i in ids:
            db.get(LedgerEntry, i).ref_hash = None
        db.commit()


def _snapshot():
    with SessionLocal() as db:
        return sorted((e.id, e.amount, e.date, e.reference_number, e.ref_hash, e.ref_duplicate_of)
                      for e in db.scalars(select(LedgerEntry)))


def _run():
    with SessionLocal() as db:
        return script.backfill(db)


def test_an_old_cheque_is_warned_about_after_the_backfill(make_user, client):
    owner = make_user()
    ravi = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    sita = add_customer(client, owner.headers, full_name="Sita Traders")["id"]
    old = _pay(client, owner.headers, ravi, "o1", "cheque", "004512", **CHEQUE).json()["id"]
    old_bank = _pay(client, owner.headers, ravi, "o2", "bank", "SBIN426123456789").json()["id"]
    _as_before_the_warning(old, old_bank)
    # Before the backfill the old cheque is invisible to the warning.
    n0 = _pay(client, owner.headers, sita, "n0", "cheque", "004512", **CHEQUE).json()
    assert "warning" not in n0
    _as_before_the_warning(n0["id"])  # this one is old history too

    out = _run()
    assert out["fingerprinted"] == 3 and out["skipped"] == 0
    [group] = out["duplicates"]  # the two cheques, oldest first
    assert [(d["entryId"], d["customer"], d["amount"]) for d in group][0] == (old, "Ravi Stores", "1500.00")
    assert [d["reference"] for d in group] == ["004512", "004512"]

    again = _pay(client, owner.headers, sita, "n1", "cheque", "004512", **CHEQUE).json()
    assert again["warning"]["entryId"] == old and again["warning"]["customerName"] == "Ravi Stores"
    bank = _pay(client, owner.headers, sita, "n2", "bank", "sbin 426123456789").json()
    assert bank["warning"]["entryId"] == old_bank


def test_running_it_twice_changes_nothing_the_second_time(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    ids = [_pay(client, owner.headers, cid, f"c{i}", "cheque", f"00451{i}", **CHEQUE).json()["id"] for i in range(2)]
    _as_before_the_warning(*ids)
    assert _run()["fingerprinted"] == 2
    after_first = _snapshot()
    second = _run()
    assert (second["fingerprinted"], second["duplicates"]) == (0, [])
    assert _snapshot() == after_first


def test_a_payment_with_no_reference_is_skipped_counted_and_still_saves(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    r = client.post("/api/v1/customers/" + cid + "/ledger", headers=owner.headers, data={
        "type": "payment", "amount": "700", "date": "2026-01-05", "client_id": "nr",
        "payment_method": "bank"})
    assert r.status_code == 200, r.text
    before = _snapshot()
    out = _run()
    assert (out["fingerprinted"], out["skipped"]) == (0, 1)
    assert _snapshot() == before  # left alone, never guessed
    # And another payment with no reference still saves, with no warning.
    r2 = client.post("/api/v1/customers/" + cid + "/ledger", headers=owner.headers, data={
        "type": "payment", "amount": "700", "date": "2026-01-05", "client_id": "nr2", "payment_method": "bank"})
    assert r2.status_code == 200 and "warning" not in r2.json()
