"""R8: several bank lines paying several collections in one match (₹900 +
₹600 for three ₹500 bills). Same allocations table; every line and every
collection fully allocated, both sides equal, or the server refuses."""

from sqlalchemy import select

from conftest import today_iso
from helpers import add_customer
from app.database import SessionLocal
from app.models import BankMatch
from test_recon_rework import _close, _dmy, _import, _lines, _pay, _statement

API = "/api/v1"


def _setup(make_user, client, lines=(900, 600), bills=(500, 500, 500)):
    owner = make_user()
    cid = add_customer(client, owner.headers, full_name="Ravi")["id"]
    entries = [_pay(client, owner.headers, cid, a, f"e{i}", f"78{i:010d}") for i, a in enumerate(bills)]
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},transfer {i},{a:.2f},"
                                               for i, a in enumerate(lines)]))
    line_ids = [l["id"] for l in sorted(_lines(client, owner.headers), key=lambda l: -float(l["amount"]))]
    return owner, line_ids, entries


def _confirm(client, owner, line_ids, entry_ids):
    return client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                       json={"bankLineIds": line_ids, "entryIds": entry_ids})


def _exceptions(client, owner):
    return client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()


def test_two_lines_pay_three_collections(make_user, client):
    owner, line_ids, entries = _setup(make_user, client)
    before = _close(client, owner.headers)["difference"]
    assert before == "1500.00"
    r = _confirm(client, owner, line_ids, entries)
    assert r.status_code == 200, r.text
    assert [l["remaining"] for l in r.json()["bankLines"]] == ["0.00", "0.00"]
    ex = _exceptions(client, owner)
    assert ex["bankLines"] == [] and ex["collections"] == []  # all leave the unmatched lists
    assert _close(client, owner.headers)["difference"] == "0.00"  # dropped by ₹1,500
    with SessionLocal() as db:  # both invariants, in the one allocations table, one match
        rows = db.scalars(select(BankMatch).where(BankMatch.entry_id.in_(entries),
                                                  BankMatch.undone_at.is_(None))).all()
        per_line, per_entry = {}, {}
        for m in rows:
            per_line[m.bank_line_id] = per_line.get(m.bank_line_id, 0) + m.amount_paise
            per_entry[m.entry_id] = per_entry.get(m.entry_id, 0) + m.amount_paise
        assert per_line == {line_ids[0]: 90_000, line_ids[1]: 60_000}
        assert per_entry == dict.fromkeys(entries, 50_000)
        assert len({m.group_id for m in rows}) == 1


def test_unequal_sides_or_an_under_allocated_collection_are_refused(make_user, client):
    # Lines ₹1,500 against collections ₹1,400.
    owner, line_ids, entries = _setup(make_user, client, bills=(500, 500, 400))
    r = _confirm(client, owner, line_ids, entries)
    assert r.status_code == 422 and "must match exactly" in r.json()["detail"]
    # Lines ₹1,500 against ₹1,600: one collection would be left part-paid.
    owner, line_ids, entries = _setup(make_user, client, bills=(500, 500, 600))
    assert _confirm(client, owner, line_ids, entries).status_code == 422
    # Nothing was written either time.
    with SessionLocal() as db:
        assert db.scalars(select(BankMatch).where(BankMatch.entry_id.in_(entries))).all() == []


def test_undo_reopens_every_line_and_collection(make_user, client):
    owner, line_ids, entries = _setup(make_user, client)
    assert _confirm(client, owner, line_ids, entries).status_code == 200
    r = client.post(f"{API}/reconciliation/lines/{line_ids[1]}/undo", headers=owner.headers)
    assert r.status_code == 200, r.text
    ex = _exceptions(client, owner)
    assert len(ex["bankLines"]) == 2 and sorted(c["id"] for c in ex["collections"]) == sorted(entries)
    assert sorted(l["remaining"] for l in _lines(client, owner.headers)) == ["600.00", "900.00"]
    assert _close(client, owner.headers)["difference"] == "1500.00"
    # And it can be matched again.
    assert _confirm(client, owner, line_ids, entries).status_code == 200


def test_the_other_open_lines_are_offered_from_a_line(make_user, client):
    owner, line_ids, entries = _setup(make_user, client)
    offered = client.get(f"{API}/reconciliation/lines/{line_ids[0]}/lines", headers=owner.headers).json()
    assert [l["id"] for l in offered] == [line_ids[1]]
    assert client.get(f"{API}/reconciliation/lines/nope/lines", headers=owner.headers).status_code == 404
