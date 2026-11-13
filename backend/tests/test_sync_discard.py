"""IM5: a failed entry in a phone's offline queue can be edited (same client id,
so it still syncs exactly once) or discarded by the owner. A discard never
deletes a server row; it records the client id, so a late retry of the same
entry can't create it, and writes one audit row. Staff can't discard (403)."""

import uuid

from conftest import today_iso
from helpers import add_customer
from app.database import SessionLocal
from app.models import AccessLog, LedgerEntry
from test_beats import _team
from test_recon_rework import _pay

API = "/api/v1"


def _post_payment(client, headers, cid, client_id, utr, amount=500):
    return client.post(f"{API}/customers/{cid}/ledger", headers=headers, data={
        "type": "payment", "amount": str(amount), "date": today_iso(), "client_id": client_id,
        "payment_method": "upi", "reference_number": utr})


def _rows(client_id):
    with SessionLocal() as db:
        return db.query(LedgerEntry).filter(LedgerEntry.client_id == client_id).count()


def _utr():
    return "7" + str(uuid.uuid4().int)[:11]


def test_an_edited_failed_entry_syncs_exactly_once_with_the_same_client_id(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    taken = _utr()
    _pay(client, owner.headers, cid, 1500, f"first-{uuid.uuid4()}", taken)
    queued = f"q-{uuid.uuid4()}"
    # Offline, the phone queued a UPI payment with a UTR that's already used: the sync fails.
    failed = _post_payment(client, owner.headers, cid, queued, taken)
    assert failed.status_code == 409 and failed.json()["code"] == "duplicate_utr"
    assert _rows(queued) == 0
    # The owner edits the UTR on the Sync status screen; the same client id is synced again.
    fixed = _post_payment(client, owner.headers, cid, queued, _utr())
    assert fixed.status_code == 200, fixed.text
    again = _post_payment(client, owner.headers, cid, queued, _utr())  # a retry after a lost response
    assert again.status_code == 200 and again.json()["id"] == fixed.json()["id"]
    assert _rows(queued) == 1


def test_discarding_a_failed_entry_records_it_writes_one_audit_row_and_a_late_retry_cant_create_it(
        make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers, full_name="Ramesh Kirana")["id"]
    queued = f"q-{uuid.uuid4()}"
    body = {"clientId": queued, "kind": "ledger", "amount": 10000, "summary": "Payment · Ramesh Kirana"}
    r = client.post(f"{API}/sync/discard", headers=owner.headers, json=body)
    assert r.status_code == 200 and r.json() == {"discarded": True, "clientId": queued}
    assert client.post(f"{API}/sync/discard", headers=owner.headers, json=body).status_code == 200  # twice: fine
    with SessionLocal() as db:
        audit = db.query(AccessLog).filter(AccessLog.action == "discard", AccessLog.path.contains(queued)).all()
    assert len(audit) == 1 and "₹10,000.00 · Payment · Ramesh Kirana" in audit[0].path
    # A copy of the same entry arrives late: refused, nothing created.
    late = _post_payment(client, owner.headers, cid, queued, _utr())
    assert late.status_code == 410 and late.json()["code"] == "entry_discarded"
    assert _rows(queued) == 0


def test_an_entry_already_on_the_server_is_never_discarded(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    synced = f"s-{uuid.uuid4()}"
    _pay(client, owner.headers, cid, 300, synced, _utr())
    r = client.post(f"{API}/sync/discard", headers=owner.headers, json={"clientId": synced, "kind": "ledger"})
    assert r.status_code == 409 and r.json()["code"] == "already_synced"
    assert _rows(synced) == 1


def test_every_queue_refuses_a_discarded_client_id(make_user, client):
    owner = make_user()
    for kind, path, data in (
        ("income", "/incomes", {"amount": "100", "category": "Sales", "date": today_iso()}),
        ("expense", "/expenses", {"amount": "100", "category": "Fuel", "vendor": "HP Petrol", "date": today_iso()}),
    ):
        queued = f"q-{uuid.uuid4()}"
        assert client.post(f"{API}/sync/discard", headers=owner.headers,
                           json={"clientId": queued, "kind": kind, "amount": 100}).status_code == 200
        r = client.post(f"{API}{path}", headers=owner.headers, data={**data, "client_id": queued})
        assert r.status_code == 410 and r.json()["code"] == "entry_discarded", (kind, r.text)


def test_staff_and_accountants_cannot_discard(make_user, client):
    owner, [(_, staff), (_, accountant)] = _team(make_user, client, "staff", "accountant")
    for headers in (staff, accountant):
        r = client.post(f"{API}/sync/discard", headers=headers,
                        json={"clientId": f"q-{uuid.uuid4()}", "kind": "visit"})
        assert r.status_code == 403, r.text
