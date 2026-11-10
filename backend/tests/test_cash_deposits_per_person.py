"""R10: cash deposits per salesperson. Each person's deposit matches its own
bank line through the same allocations; a whole-beat deposit (user_id
NULL, as every deposit was before) still matches and reconciles."""

from conftest import today_iso
from app.database import SessionLocal
from app.models import Beat, CashDeposit
from test_cash_count_per_person import _close, _collect, _count
from test_recon_rework import _dmy, _import, _lines, _statement
from test_shared_beats import _shared

API = "/api/v1"


def _two_collected(make_user, client):
    owner, (a_id, a), (b_id, b), (c_id, c), shop, beat = _shared(make_user, client)
    _collect(client, a, shop, beat["id"], 8000, "a1")
    _collect(client, b, shop, beat["id"], 5000, "b1")
    return owner, (a_id, a), (b_id, b), (c_id, c), beat["id"]


def _deposit(client, headers, beat_id, amount, user_id=None):
    r = client.post(f"{API}/reconciliation/deposits", headers=headers, json={
        "date": today_iso(), "beatId": beat_id, "amount": str(amount), "kind": "deposit", "userId": user_id})
    return r


def _bank(client, owner, *amounts):
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},CASH DEP {i},{a:.2f},"
                                               for i, a in enumerate(amounts)]))
    return {l["amount"]: l["id"] for l in _lines(client, owner.headers)}


def _match(client, headers, deposit_id, line_id):
    return client.post(f"{API}/reconciliation/deposits/{deposit_id}/match", headers=headers,
                       json={"bankLineId": line_id})


def test_each_persons_deposit_matches_its_own_line(make_user, client):
    owner, (a_id, a), (b_id, _b), _c, beat_id = _two_collected(make_user, client)
    _count(client, a, beat_id, 7900, a_id)
    before = _close(client, owner.headers, beat_id).json()["difference"]
    assert before == "13000.00"
    da = _deposit(client, owner.headers, beat_id, 7900, a_id)
    db_ = _deposit(client, owner.headers, beat_id, 5000, b_id)
    assert da.status_code == 200 and db_.status_code == 200, (da.text, db_.text)
    assert (da.json()["userId"], db_.json()["userId"]) == (a_id, b_id)
    with SessionLocal() as db:  # A's deposit points at A's own count
        assert db.get(CashDeposit, da.json()["id"]).counted_cash_id is not None
    lines = _bank(client, owner, 7900, 5000)
    assert _match(client, owner.headers, da.json()["id"], lines["7900.00"]).status_code == 200
    assert _match(client, owner.headers, db_.json()["id"], lines["5000.00"]).status_code == 200
    close = _close(client, owner.headers, beat_id).json()
    assert close["difference"] == "100.00"  # dropped by ₹12,900
    assert close["cashDeposited"] == "12900.00"
    assert {m["userId"]: m["cashDeposited"] for m in close["members"]} == {a_id: "7900.00", b_id: "5000.00"}


def test_an_old_whole_beat_deposit_still_matches_and_reconciles(make_user, client):
    owner, _a, _b, _c, beat_id = _two_collected(make_user, client)
    with SessionLocal() as db:  # as saved before this release: no user_id
        d = CashDeposit(business_id=db.get(Beat, beat_id).business_id, beat_id=beat_id, date=today_iso(),
                        kind="deposit", amount_paise=1_300_000)
        db.add(d)
        db.commit()
        old_id = d.id
    lines = _bank(client, owner, 13000)
    assert _match(client, owner.headers, old_id, lines["13000.00"]).status_code == 200
    close = _close(client, owner.headers, beat_id).json()
    assert (close["difference"], close["cashDeposited"]) == ("0.00", "13000.00")
    assert all(m["cashDeposited"] == "0.00" for m in close["members"])  # not anyone's in particular
    # A whole-beat deposit recorded today works the same way.
    assert _deposit(client, owner.headers, beat_id, 10).json()["userId"] is None


def test_staff_cannot_see_or_match_another_beats_deposits(make_user, client):
    owner, (a_id, a), (b_id, b), (_c_id, c), beat_id = _two_collected(make_user, client)
    da = _deposit(client, owner.headers, beat_id, 7900, a_id).json()
    _deposit(client, owner.headers, beat_id, 5000, b_id)
    whole = _deposit(client, owner.headers, beat_id, 100).json()
    lines = _bank(client, owner, 7900)
    params = {"date": today_iso(), "beatId": beat_id}
    assert client.get(f"{API}/reconciliation/deposits", headers=c, params=params).status_code == 403
    assert _match(client, c, da["id"], lines["7900.00"]).status_code == 403
    assert _match(client, b, da["id"], lines["7900.00"]).status_code == 403  # staff never match
    # On their own beat, staff see their own and whole-beat deposits, not a colleague's.
    mine = client.get(f"{API}/reconciliation/deposits", headers=b, params=params).json()
    assert {(d["userId"], d["amount"]) for d in mine} == {(b_id, "5000.00"), (None, "100.00")}
    close = _close(client, b, beat_id).json()
    assert {d["id"] for d in close["deposits"]} == {d["id"] for d in mine} and whole["id"] in {d["id"] for d in mine}
    assert _deposit(client, owner.headers, beat_id, 1, "nobody").status_code == 422
