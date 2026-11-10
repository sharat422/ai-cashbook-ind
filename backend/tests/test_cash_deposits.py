"""Cash deposits: cash the owner took to the bank, matched to its bank line
through the same allocations (bank_matches) as collections. A short deposit
is a deposit plus a float row (cash kept back), never an edited deposit."""

from conftest import today_iso
from helpers import add_customer
from test_beats import _beat, _team
from test_recon_rework import _dmy, _import, _statement

API = "/api/v1"


def _setup(make_user, client, deposits=(5000,)):
    owner, [(a_id, a), (_b_id, b)] = _team(make_user, client, "staff", "staff")
    shop = add_customer(client, owner.headers, full_name="Kirana")["id"]
    beat = _beat(client, owner, "Market", user_id=a_id, customers=[shop])
    r = client.post(f"{API}/customers/{shop}/ledger", headers=a, data={
        "type": "payment", "amount": "5000", "date": today_iso(), "client_id": "cash1",
        "payment_method": "cash", "beat_id": beat["id"]})
    assert r.status_code == 200, r.text
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},CASH DEP BR {i},{v:.2f},"
                                               for i, v in enumerate(deposits)]))
    return owner, a, b, beat


def _record(client, owner, beat, amount, kind="deposit"):
    r = client.post(f"{API}/reconciliation/deposits", headers=owner.headers, json={
        "date": today_iso(), "beatId": beat["id"], "amount": str(amount), "kind": kind})
    assert r.status_code == 200, r.text
    return r.json()


def _close(client, headers, beat):
    return client.get(f"{API}/daily-close", headers=headers, params={"beat_id": beat["id"]}).json()


def _lone_lines(client, owner):
    return client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()["bankLines"]


def _match(client, owner, deposit, line_id):
    return client.post(f"{API}/reconciliation/deposits/{deposit['id']}/match", headers=owner.headers,
                       json={"bankLineId": line_id})


def test_a_matched_deposit_closes_the_day(make_user, client):
    owner, _a, _b, beat = _setup(make_user, client)
    assert _close(client, owner.headers, beat)["difference"] == "5000.00"  # cash not banked yet
    dep = _record(client, owner, beat, 5000)
    close = _close(client, owner.headers, beat)
    assert (close["cashDepositPending"], close["cashDeposited"], close["difference"]) == ("5000.00", "0.00", "5000.00")
    [line] = _lone_lines(client, owner)
    offered = client.get(f"{API}/reconciliation/deposits/{dep['id']}/lines", headers=owner.headers).json()
    assert offered[0]["id"] == line["id"]

    r = _match(client, owner, dep, line["id"])
    assert r.status_code == 200, r.text
    assert _lone_lines(client, owner) == []
    close = _close(client, owner.headers, beat)
    assert (close["cashDeposited"], close["difference"]) == ("5000.00", "0.00")
    assert close["deposits"][0]["bankLineId"] == line["id"]
    matched = client.get(f"{API}/reconciliation/matched", headers=owner.headers).json()
    assert [(m["bankLine"]["id"], [d["id"] for d in m["deposits"]], m["collections"]) for m in matched] == [
        (line["id"], [dep["id"]], [])]
    assert _match(client, owner, dep, line["id"]).status_code == 409  # already matched
    # A deposit match has no collection: unmatched UPI collections still show.
    shop = add_customer(client, owner.headers)["id"]
    upi = client.post(f"{API}/customers/{shop}/ledger", headers=owner.headers, data={
        "type": "payment", "amount": "300", "date": today_iso(), "client_id": "u1",
        "payment_method": "upi", "reference_number": "761111111111"}).json()["id"]
    lone = client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()["collections"]
    assert [c["id"] for c in lone] == [upi]


def test_a_deposit_and_a_line_of_different_amounts_are_refused(make_user, client):
    owner, _a, _b, beat = _setup(make_user, client, deposits=(4500,))
    dep = _record(client, owner, beat, 5000)
    [line] = _lone_lines(client, owner)
    r = _match(client, owner, dep, line["id"])
    assert r.status_code == 422, r.text
    assert len(_lone_lines(client, owner)) == 1 and _close(client, owner.headers, beat)["difference"] == "5000.00"


def test_a_short_deposit_is_a_deposit_plus_cash_kept_back(make_user, client):
    owner, _a, _b, beat = _setup(make_user, client, deposits=(4500,))
    dep = _record(client, owner, beat, 4500)
    kept = _record(client, owner, beat, 500, kind="float")
    [line] = _lone_lines(client, owner)
    assert _match(client, owner, kept, line["id"]).status_code == 422  # kept back isn't in the bank
    assert _match(client, owner, dep, line["id"]).status_code == 200
    close = _close(client, owner.headers, beat)
    assert (close["cashDeposited"], close["cashKeptBack"], close["difference"]) == ("4500.00", "500.00", "0.00")


def test_undo_reopens_the_deposit_and_the_line(make_user, client):
    owner, _a, _b, beat = _setup(make_user, client)
    dep = _record(client, owner, beat, 5000)
    [line] = _lone_lines(client, owner)
    assert _match(client, owner, dep, line["id"]).status_code == 200
    # A matched deposit can't be deleted until it's undone.
    assert client.delete(f"{API}/reconciliation/deposits/{dep['id']}", headers=owner.headers).status_code == 409
    assert client.post(f"{API}/reconciliation/lines/{line['id']}/undo", headers=owner.headers).status_code == 200
    assert [l["id"] for l in _lone_lines(client, owner)] == [line["id"]]
    close = _close(client, owner.headers, beat)
    assert (close["cashDeposited"], close["cashDepositPending"], close["difference"]) == ("0.00", "5000.00", "5000.00")
    assert close["deposits"][0]["matched"] is False
    assert _match(client, owner, dep, line["id"]).status_code == 200  # matchable again


def test_staff_see_only_their_beat_and_never_match(make_user, client):
    owner, a, b, beat = _setup(make_user, client)
    dep = _record(client, owner, beat, 5000)
    [line] = _lone_lines(client, owner)
    params = {"beatId": beat["id"], "date": today_iso()}
    mine = client.get(f"{API}/reconciliation/deposits", headers=a, params=params)
    assert mine.status_code == 200 and [d["id"] for d in mine.json()] == [dep["id"]]
    assert client.get(f"{API}/reconciliation/deposits", headers=b, params=params).status_code == 403
    assert client.get(f"{API}/reconciliation/deposits", headers=b, params={"date": today_iso()}).status_code == 403
    for staff in (a, b):
        assert client.post(f"{API}/reconciliation/deposits/{dep['id']}/match", headers=staff,
                           json={"bankLineId": line["id"]}).status_code == 403
        assert client.post(f"{API}/reconciliation/deposits", headers=staff, json={
            "date": today_iso(), "beatId": beat["id"], "amount": "1", "kind": "deposit"}).status_code == 403
