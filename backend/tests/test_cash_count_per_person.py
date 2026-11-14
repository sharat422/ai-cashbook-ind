"""B6: counted cash per salesperson. A short is attributed to the person
whose cash it is; the beat figure is the sum. A whole-beat count (user_id
NULL, as every count was before) still loads and reconciles."""

from conftest import today_iso
from app.database import SessionLocal
from app.models import Beat, CashCount
from test_shared_beats import _shared

API = "/api/v1"


def _collect(client, headers, shop, beat_id, amount, client_id):
    r = client.post(f"{API}/customers/{shop}/ledger", headers=headers, data={
        "type": "payment", "amount": str(amount), "date": today_iso(), "client_id": client_id,
        "payment_method": "cash", "beat_id": beat_id})
    assert r.status_code == 200, r.text


def _count(client, headers, beat_id, counted, user_id=None):
    return client.post(f"{API}/daily-close/cash-count", headers=headers, json={
        "date": today_iso(), "beatId": beat_id, "counted": str(counted), "userId": user_id})


def _close(client, headers, beat_id):
    return client.get(f"{API}/daily-close", headers=headers, params={"beat_id": beat_id, "date": today_iso()})


def _two_collected(make_user, client):
    owner, (a_id, a), (b_id, b), (c_id, c), shop, beat = _shared(make_user, client)
    _collect(client, a, shop, beat["id"], 8000, "a1")
    _collect(client, b, shop, beat["id"], 5000, "b1")
    return owner, (a_id, a), (b_id, b), (c_id, c), beat["id"]


def test_a_short_is_put_against_the_person_whose_cash_it_is(make_user, client):
    owner, (a_id, a), (b_id, _b), _c, beat_id = _two_collected(make_user, client)
    before = _close(client, owner.headers, beat_id).json()
    assert _count(client, a, beat_id, 7900, a_id).status_code == 200            # A counts their own
    assert _count(client, owner.headers, beat_id, 5000, b_id).status_code == 200  # the owner counts B's
    close = _close(client, owner.headers, beat_id).json()
    people = {m["userId"]: (m["cash"], m["cashCounted"], m["cashOverShort"]) for m in close["members"]}
    assert people == {a_id: ("8000.00", "7900.00", "-100.00"), b_id: ("5000.00", "5000.00", "0.00")}
    assert [m["userId"] for m in close["members"]] == [a_id, b_id]  # biggest collection first
    assert (close["cashCounted"], close["cashOverShort"], close["cashCountByPerson"]) == ("12900.00", "-100.00", True)
    # Counting changes no sale or payment.
    for k in ("creditCollected", "cashInHand", "difference", "collections"):
        assert close[k] == before[k]
    # A recount replaces that person's figure (every count is kept).
    _count(client, a, beat_id, 8000, a_id)
    assert _close(client, owner.headers, beat_id).json()["cashOverShort"] == "0.00"


def test_an_old_whole_beat_count_still_loads_and_reconciles(make_user, client):
    owner, _a, _b, _c, beat_id = _two_collected(make_user, client)
    with SessionLocal() as db:  # as saved before this release: no user_id
        db.add(CashCount(business_id=db.get(Beat, beat_id).business_id, date=today_iso(), beat_id=beat_id,
                         counted_paise=1_290_000))
        db.commit()
    close = _close(client, owner.headers, beat_id).json()
    assert (close["cashCounted"], close["cashOverShort"], close["cashCountByPerson"]) == ("12900.00", "-100.00", False)
    assert all(m["cashCounted"] is None for m in close["members"])
    # A whole-beat count entered today still works the same way.
    assert _count(client, owner.headers, beat_id, 13000).json()["cashOverShort"] == "0.00"


def test_staff_see_and_count_only_their_own_cash(make_user, client):
    owner, (a_id, a), (b_id, b), (_c_id, c), beat_id = _two_collected(make_user, client)
    _count(client, owner.headers, beat_id, 7900, a_id)
    _count(client, owner.headers, beat_id, 5000, b_id)
    mine = _close(client, b, beat_id).json()
    rows = {m["userId"]: m["cashCounted"] for m in mine["members"]}
    assert rows == {a_id: None, b_id: "5000.00"}  # A's count isn't shown to B
    assert mine["cashCounted"] is None and mine["cashOverShort"] is None  # nor the beat sum
    assert _count(client, b, beat_id, 1, a_id).status_code == 403          # B can't count A's cash
    assert _close(client, c, beat_id).status_code == 403                    # another beat's close
    assert _count(client, c, beat_id, 1, _c_id).status_code == 403          # or its counts
    assert _count(client, owner.headers, beat_id, 1, "nobody").status_code == 422


def test_cash_with_no_salesperson_is_its_own_row_the_owner_counts(make_user, client):
    from sqlalchemy import update
    from app.models import LedgerEntry
    owner, (a_id, a), (b_id, b), _c, beat_id = _two_collected(make_user, client)
    shop = _close(client, owner.headers, beat_id).json()["collections"][0]["customerId"]
    _collect(client, owner.headers, shop, beat_id, 2000, "old1")
    with SessionLocal() as db:  # saved before who-recorded-it was kept
        db.execute(update(LedgerEntry).where(LedgerEntry.client_id == "old1").values(salesman_id=None))
        db.commit()
    _count(client, a, beat_id, 8000, a_id)
    _count(client, b, beat_id, 5000, b_id)
    close = _close(client, owner.headers, beat_id).json()
    assert {m["userId"]: m["cash"] for m in close["members"]}["none"] == "2000.00"
    assert close["cashOverShort"] is None  # waits for the 2000 to be counted
    assert _count(client, b, beat_id, 2000, "none").status_code == 403  # staff can't count it
    close = _count(client, owner.headers, beat_id, 1900, "none").json()
    assert (close["cashCounted"], close["cashOverShort"]) == ("14900.00", "-100.00")
    none = next(m for m in close["members"] if m["userId"] == "none")
    assert (none["cashCounted"], none["cashOverShort"]) == ("1900.00", "-100.00")
    r = client.post(f"{API}/reconciliation/deposits", headers=owner.headers, json={
        "date": today_iso(), "beatId": beat_id, "amount": "1900", "kind": "deposit", "userId": "none"})
    assert r.status_code == 200, r.text
