"""Restore a deleted statement: its lines come back UNMATCHED (the matches
undone at delete stay undone), the owner re-confirms by hand. Owner only."""

from sqlalchemy import select

from conftest import today_iso
from helpers import add_customer
from app.database import SessionLocal
from app.models import AccessLog, BankMatch
from test_beats import _team
from test_recon_rework import _close, _dmy, _import, _lines, _pay, _statement

API = "/api/v1"


def _matched_statement(make_user, client):
    owner, [(_s, staff), (_a, accountant)] = _team(make_user, client, "staff", "accountant")
    cid = add_customer(client, owner.headers)["id"]
    entry = _pay(client, owner.headers, cid, 250, "e", "751111111111")
    content = _statement([f"{_dmy(today_iso())},UPI/751111111111,250.00,", f"{_dmy(today_iso())},NEFT X,99.00,"])
    assert _import(client, owner.headers, content).json()["imported"] == 2
    [s] = client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json()
    assert client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                       json={"bankLineId": s["bankLine"]["id"], "entryId": entry}).status_code == 200
    [stmt] = client.get(f"{API}/reconciliation/imports", headers=owner.headers).json()
    return owner, staff, accountant, entry, content, stmt, s["bankLine"]["id"]


def _restore(client, headers, stmt_id):
    return client.post(f"{API}/reconciliation/statements/{stmt_id}/restore", headers=headers)


def test_restore_brings_the_lines_back_unmatched(make_user, client):
    owner, _staff, _acc, entry, _content, stmt, line_id = _matched_statement(make_user, client)
    before_delete = _close(client, owner.headers)["difference"]
    assert before_delete == "0.00"
    client.delete(f"{API}/reconciliation/imports/{stmt['id']}", headers=owner.headers)
    after_delete = _close(client, owner.headers)["difference"]
    assert after_delete == "250.00" and _lines(client, owner.headers) == []
    deleted = client.get(f"{API}/reconciliation/imports", headers=owner.headers, params={"deleted": "true"}).json()
    assert [d["id"] for d in deleted] == [stmt["id"]] and deleted[0]["deletedAt"]

    r = _restore(client, owner.headers, stmt["id"])
    assert r.status_code == 200 and r.json()["restored"] is True and r.json()["lines"] == 2, r.text
    assert sorted(l["remaining"] for l in _lines(client, owner.headers)) == ["250.00", "99.00"]  # all unmatched
    assert client.get(f"{API}/reconciliation/matched", headers=owner.headers).json() == []
    with SessionLocal() as db:  # the old match is not silently re-created
        assert db.scalars(select(BankMatch).where(BankMatch.entry_id == entry,
                                                  BankMatch.undone_at.is_(None))).all() == []
        [log] = db.scalars(select(AccessLog).where(AccessLog.path.contains(stmt["id"]))).all()
        assert (log.action, log.mobile) == ("restore", owner.mobile)
    # Lines present, unmatched: the close shows the collection as not in the bank yet…
    assert _close(client, owner.headers)["difference"] == after_delete
    assert [d["id"] for d in client.get(f"{API}/reconciliation/imports", headers=owner.headers).json()] == [stmt["id"]]
    # …until the owner re-confirms by hand: then it's back to the pre-delete value.
    [s] = client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json()
    assert s["bankLine"]["id"] == line_id
    client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                json={"bankLineId": line_id, "entryId": entry})
    assert _close(client, owner.headers)["difference"] == before_delete


def test_restoring_a_live_statement_is_a_no_op(make_user, client):
    owner, _staff, _acc, _entry, _content, stmt, _line = _matched_statement(make_user, client)
    r = _restore(client, owner.headers, stmt["id"])
    assert r.status_code == 200 and r.json()["restored"] is False
    assert len(client.get(f"{API}/reconciliation/matched", headers=owner.headers).json()) == 1  # untouched
    with SessionLocal() as db:
        assert db.scalars(select(AccessLog).where(AccessLog.path.contains(stmt["id"]))).all() == []


def test_staff_and_accountants_cannot_restore(make_user, client):
    owner, staff, accountant, _entry, _content, stmt, _line = _matched_statement(make_user, client)
    client.delete(f"{API}/reconciliation/imports/{stmt['id']}", headers=owner.headers)
    assert _restore(client, staff, stmt["id"]).status_code == 403
    assert _restore(client, accountant, stmt["id"]).status_code == 403
    assert _restore(client, owner.headers, "nope").status_code == 404
    assert _lines(client, owner.headers) == []  # still deleted


def test_a_statement_imported_again_since_cannot_be_restored_twice_over(make_user, client):
    owner, _staff, _acc, _entry, content, stmt, _line = _matched_statement(make_user, client)
    client.delete(f"{API}/reconciliation/imports/{stmt['id']}", headers=owner.headers)
    assert _import(client, owner.headers, content).json()["imported"] == 2  # the workaround
    r = _restore(client, owner.headers, stmt["id"])
    assert r.status_code == 409 and "imported again" in r.json()["detail"]
    assert len(_lines(client, owner.headers)) == 2  # nothing doubled


def test_lines_already_in_from_an_overlapping_statement_block_the_restore(make_user, client):
    owner, _staff, _acc, _entry, _content, stmt, _line = _matched_statement(make_user, client)
    client.delete(f"{API}/reconciliation/imports/{stmt['id']}", headers=owner.headers)
    wider = _statement([f"{_dmy(today_iso())},UPI/751111111111,250.00,", f"{_dmy(today_iso())},OTHER,10.00,"])
    assert _import(client, owner.headers, wider).json()["imported"] == 2
    r = _restore(client, owner.headers, stmt["id"])
    assert r.status_code == 409 and "already in" in r.json()["detail"]
