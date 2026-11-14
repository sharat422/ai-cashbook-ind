"""Bank-transfer and cheque references: a repeat is a WARNING naming the
earlier payment, never a block (cheque numbers repeat across banks,
accounts and years). The UPI UTR rule is unchanged: a repeat is refused."""

from conftest import today_iso
from helpers import add_customer
from app.database import SessionLocal
from app.models import LedgerEntry

API = "/api/v1"


def _pay(client, headers, cid, client_id, method, ref, **extra):
    return client.post(f"{API}/customers/{cid}/ledger", headers=headers, data={
        "type": "payment", "amount": "1500", "date": today_iso(), "client_id": client_id,
        "payment_method": method, "reference_number": ref, "utr_rule": "true", **extra})


def test_a_repeated_cheque_saves_with_a_warning_naming_the_first(make_user, client):
    owner = make_user()
    ravi = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    sita = add_customer(client, owner.headers, full_name="Sita Traders")["id"]
    cheque = {"cheque_bank": "SBI Main Road", "cheque_account": "1234"}
    first = _pay(client, owner.headers, ravi, "c1", "cheque", "004512", **cheque)
    assert first.status_code == 200 and "warning" not in first.json()
    again = _pay(client, owner.headers, sita, "c2", "cheque", "004512", **cheque)
    assert again.status_code == 200, again.text
    w = again.json()["warning"]
    assert (w["entryId"], w["customerName"], w["amount"], w["date"]) == (
        first.json()["id"], "Ravi Stores", "1500.00", today_iso())
    assert "Ravi Stores" in w["message"]
    with SessionLocal() as db:  # saved, with the warning on record
        row = db.get(LedgerEntry, again.json()["id"])
        assert row.ref_duplicate_of == first.json()["id"] and row.cheque_bank == "SBI Main Road"


def test_the_same_cheque_number_from_another_bank_or_account_is_not_a_repeat(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    base = _pay(client, owner.headers, cid, "c1", "cheque", "004512", cheque_bank="SBI", cheque_account="1234")
    assert base.status_code == 200
    for n, extra in enumerate(({"cheque_bank": "HDFC", "cheque_account": "1234"},
                               {"cheque_bank": "SBI", "cheque_account": "9876"})):
        r = _pay(client, owner.headers, cid, f"o{n}", "cheque", "004512", **extra)
        assert r.status_code == 200 and "warning" not in r.json(), r.text


def test_a_repeated_bank_reference_saves_with_a_warning(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    assert "warning" not in _pay(client, owner.headers, cid, "b1", "bank", "SBIN426123456789").json()
    r = _pay(client, owner.headers, cid, "b2", "bank", "sbin 426123456789")  # case and spaces ignored
    assert r.status_code == 200 and r.json()["warning"]["customerName"] == "Ravi Stores"
    # Replaying the same upload returns the saved entry; nothing is added.
    assert _pay(client, owner.headers, cid, "b2", "bank", "SBIN426123456789").json()["id"] == r.json()["id"]


def test_upi_is_still_refused_and_never_mixed_with_bank_references(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    utr = "412345678901"
    first = _pay(client, owner.headers, cid, "u1", "upi", utr)
    assert first.status_code == 200
    dup = _pay(client, owner.headers, cid, "u2", "upi", utr)
    assert dup.status_code == 409 and "UTR" in dup.json()["detail"]
    # The same digits as a bank reference: a different rail, no warning, no block.
    bank = _pay(client, owner.headers, cid, "b1", "bank", utr)
    assert bank.status_code == 200 and "warning" not in bank.json()
    with SessionLocal() as db:
        assert db.get(LedgerEntry, first.json()["id"]).ref_hash is None  # UPI keeps its own unique index


def test_a_cheque_saved_with_its_number_only_still_warns_a_later_one_with_bank_and_account(make_user, client):
    """Cheques saved before bank and account were asked for have only a number.
    A later cheque with that number (now with bank and account) warns, saying
    the earlier one has no bank recorded; it may be another bank's cheque."""
    owner = make_user()
    ravi = add_customer(client, owner.headers, full_name="Ravi Stores")["id"]
    old = _pay(client, owner.headers, ravi, "old1", "cheque", "007788")   # number only, as old cheques were
    assert old.status_code == 200 and "warning" not in old.json()
    new = _pay(client, owner.headers, ravi, "new1", "cheque", "007788", cheque_bank="SBI", cheque_account="4321")
    assert new.status_code == 200, new.text
    w = new.json()["warning"]
    assert w["entryId"] == old.json()["id"] and w["numberOnly"] is True
    assert "no bank or account recorded" in w["message"]
    # A different number: nothing. And a full match still says the plain repeat.
    other = _pay(client, owner.headers, ravi, "new2", "cheque", "009999", cheque_bank="SBI", cheque_account="4321")
    assert "warning" not in other.json()
    again = _pay(client, owner.headers, ravi, "new3", "cheque", "007788", cheque_bank="SBI", cheque_account="4321")
    assert again.json()["warning"]["numberOnly"] is False and again.json()["warning"]["entryId"] == new.json()["id"]
