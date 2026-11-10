"""One collection split across two bank lines (₹1,000 paid as ₹600 + ₹400):
the mirror of one line covering several collections (test_recon_rework)."""

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from conftest import today_iso
from helpers import add_customer
from app.migrations import _add_bank_match_split
from test_recon_rework import _close, _dmy, _import, _lines, _pay, _statement

API = "/api/v1"


def _setup(make_user, client, *amounts):
    owner = make_user()
    cid = add_customer(client, owner.headers, full_name="Ravi")["id"]
    entry = _pay(client, owner.headers, cid, 1000, "e", "781111111111")
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},transfer {i},{a:.2f},"
                                               for i, a in enumerate(amounts)]))
    by_amount = {l["amount"]: l["id"] for l in _lines(client, owner.headers)}
    return owner, entry, by_amount


def _exceptions(client, owner):
    return client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()


def _confirm(client, owner, line_ids, entry):
    return client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                       json={"bankLineIds": line_ids, "entryId": entry})


def test_one_collection_matched_to_two_lines(make_user, client):
    owner, entry, lines = _setup(make_user, client, 600, 400)
    assert _close(client, owner.headers)["difference"] == "1000.00"
    ex = _exceptions(client, owner)
    assert len(ex["bankLines"]) == 2 and [c["id"] for c in ex["collections"]] == [entry]
    # The by-hand list for the collection offers both lines.
    offered = client.get(f"{API}/reconciliation/collections/{entry}/lines", headers=owner.headers).json()
    assert sorted(l["remaining"] for l in offered) == ["400.00", "600.00"]

    r = _confirm(client, owner, [lines["600.00"], lines["400.00"]], entry)
    assert r.status_code == 200, r.text
    assert [l["remaining"] for l in r.json()["bankLines"]] == ["0.00", "0.00"]
    ex = _exceptions(client, owner)
    assert ex["bankLines"] == [] and ex["collections"] == []
    assert client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json() == []
    assert _close(client, owner.headers)["difference"] == "0.00"
    # Already matched: a second match of the collection is refused.
    assert client.post(f"{API}/reconciliation/match", headers=owner.headers,
                       json={"bankLineId": lines["600.00"], "entryIds": [entry]}).status_code == 409


@pytest.mark.parametrize("amounts", [(600, 300), (600, 500)])
def test_under_or_over_allocation_is_refused(make_user, client, amounts):
    owner, entry, lines = _setup(make_user, client, *amounts)
    r = _confirm(client, owner, list(lines.values()), entry)
    assert r.status_code == 422, r.text
    assert len(_exceptions(client, owner)["bankLines"]) == 2  # nothing saved
    assert _close(client, owner.headers)["difference"] == "1000.00"


def test_undo_reopens_both_lines_and_the_collection(make_user, client):
    owner, entry, lines = _setup(make_user, client, 600, 400)
    assert _confirm(client, owner, [lines["600.00"], lines["400.00"]], entry).status_code == 200
    # Undo from either line takes back the whole split.
    r = client.post(f"{API}/reconciliation/lines/{lines['400.00']}/undo", headers=owner.headers)
    assert r.status_code == 200
    ex = _exceptions(client, owner)
    assert len(ex["bankLines"]) == 2 and [c["id"] for c in ex["collections"]] == [entry]
    assert _close(client, owner.headers)["difference"] == "1000.00"
    assert client.get(f"{API}/reconciliation/matched", headers=owner.headers).json() == []
    # And it can be matched again.
    assert _confirm(client, owner, [lines["600.00"], lines["400.00"]], entry).status_code == 200


def test_an_overfull_line_or_no_line_is_refused(make_user, client):
    owner, entry, lines = _setup(make_user, client, 600, 400)
    other = _pay(client, owner.headers, add_customer(client, owner.headers)["id"], 1000, "o", "791111111111")
    r = client.post(f"{API}/reconciliation/match", headers=owner.headers,
                    json={"bankLineId": lines["600.00"], "entryIds": [entry, other]})
    assert r.status_code == 422  # 2,000 doesn't fit in 600
    assert client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                       json={"bankLineIds": [], "entryId": entry}).status_code == 422


def test_migration_moves_the_one_match_index_to_entry_and_part():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE bank_matches (id TEXT PRIMARY KEY, business_id TEXT, bank_line_id TEXT, "
                          "entry_id TEXT, amount_paise INTEGER, confirmed_by TEXT, confirmed_at TEXT, "
                          "undone_by TEXT, undone_at TEXT, undo_reason TEXT)"))
        conn.execute(text("CREATE UNIQUE INDEX uq_bank_match_active_entry ON bank_matches (entry_id) "
                          "WHERE undone_at IS NULL"))
        conn.execute(text("INSERT INTO bank_matches (id, entry_id, bank_line_id) VALUES ('old', 'e', 'l0')"))
    for _ in range(2):  # runs on every boot
        _add_bank_match_split(engine, inspect(engine), {"bank_matches"})
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO bank_matches (id, entry_id, bank_line_id, part) VALUES ('x', 'e', 'l1', 1)"))
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("INSERT INTO bank_matches (id, entry_id, bank_line_id) VALUES ('y', 'e', 'l2')"))
