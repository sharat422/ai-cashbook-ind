"""Reconciliation rework: split allocations (one bank line = several
collections), matching by hand, undo, deleting a statement, and the
column-mapping / date-format preview."""

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from conftest import _login, days_ago_iso, today_iso
from helpers import add_customer
from app.bank_statement import parse_statement
from app.database import Base, SessionLocal
from app.migrations import _move_bank_matches
from app.models import BankMatch

API = "/api/v1"


def _pay(client, headers, cid, amount, client_id, ref, date=None, method="upi"):
    r = client.post(f"{API}/customers/{cid}/ledger", headers=headers, data={
        "type": "payment", "amount": str(amount), "date": date or today_iso(), "client_id": client_id,
        "payment_method": method, "reference_number": ref})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _statement(rows, header="Date,Narration,Deposit,Withdrawal"):
    return (header + "\n" + "\n".join(rows) + "\n").encode()


def _dmy(iso):
    y, m, d = iso.split("-")
    return f"{d}/{m}/{y}"


def _import(client, headers, content, name="stmt.csv", **form):
    return client.post(f"{API}/reconciliation/import", headers=headers,
                       files={"file": (name, content, "text/csv")}, data=form)


def _lines(client, headers):
    """Every open bank line: with a suggestion or without."""
    sugg = [s["bankLine"] for s in client.get(f"{API}/reconciliation/suggestions", headers=headers).json()]
    lone = client.get(f"{API}/reconciliation/exceptions", headers=headers).json()["bankLines"]
    return sorted(sugg + lone, key=lambda l: (l["date"], l["id"]))


def _close(client, headers):
    return client.get(f"{API}/daily-close", headers=headers, params={"date": today_iso()}).json()


def test_one_bank_line_can_cover_two_collections(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers, full_name="Ravi")["id"]
    a = _pay(client, owner.headers, cid, 600, "a", "711111111111")
    b = _pay(client, owner.headers, cid, 400, "b", "711111111112")
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},UPI ravi,1000.00,"]))
    line = _lines(client, owner.headers)[0]
    assert (line["amount"], line["remaining"]) == ("1000.00", "1000.00")
    assert _close(client, owner.headers)["difference"] == "1000.00"

    r = client.post(f"{API}/reconciliation/match", headers=owner.headers,
                    json={"bankLineId": line["id"], "entryIds": [a, b, a]})
    assert r.status_code == 200, r.text
    assert r.json()["bankLine"]["matched"] is True and r.json()["bankLine"]["remaining"] == "0.00"
    assert _close(client, owner.headers)["difference"] == "0.00"
    assert _lines(client, owner.headers) == []
    matched = client.get(f"{API}/reconciliation/matched", headers=owner.headers).json()
    assert sorted(c["amount"] for c in matched[0]["collections"]) == ["400.00", "600.00"]


def test_allocations_never_exceed_the_bank_line(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    a = _pay(client, owner.headers, cid, 600, "a", "721111111111")
    big = _pay(client, owner.headers, cid, 500, "big", "721111111112")
    small = _pay(client, owner.headers, cid, 400, "small", "721111111113")
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},UPI,1000.00,"]))
    line = _lines(client, owner.headers)[0]

    r = client.post(f"{API}/reconciliation/match", headers=owner.headers,
                    json={"bankLineId": line["id"], "entryIds": [a, big]})
    assert r.status_code == 422 and r.json()["detail"] == "These add up to ₹1100.00 but the bank line has ₹1000.00 left."
    # Part now, the rest later: the line shows what's left.
    client.post(f"{API}/reconciliation/match", headers=owner.headers, json={"bankLineId": line["id"], "entryIds": [a]})
    assert _lines(client, owner.headers)[0]["remaining"] == "400.00"
    # A suggestion for what's left is exact; confirming it closes the line.
    sugg = client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json()
    assert [(s["collection"]["id"], s["bankLine"]["remaining"]) for s in sugg] == [(small, "400.00")]
    r = client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                    json={"bankLineId": line["id"], "entryId": small})
    assert r.status_code == 200 and r.json()["bankLine"]["matched"] is True
    assert client.post(f"{API}/reconciliation/match", headers=owner.headers,
                       json={"bankLineId": line["id"], "entryIds": [big]}).status_code == 409


def test_match_by_hand_any_date_and_undo(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers, full_name="Lakshmi Stores")["id"]
    other = add_customer(client, owner.headers, full_name="Other")["id"]
    old = _pay(client, owner.headers, cid, 750, "old", "731111111111", date=days_ago_iso(12))
    _pay(client, owner.headers, other, 99, "noise", "731111111112", date=days_ago_iso(1))
    _pay(client, owner.headers, cid, 750, "cash", "x", method="cash")  # cash is never a candidate
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},NEFT LAKSHMI,750.00,"]))
    line = _lines(client, owner.headers)[0]
    assert client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json() == []  # 12 days apart

    cands = client.get(f"{API}/reconciliation/lines/{line['id']}/candidates", headers=owner.headers,
                       params={"search": "laksh"}).json()
    assert [c["id"] for c in cands] == [old]
    assert client.post(f"{API}/reconciliation/match", headers=owner.headers,
                       json={"bankLineId": line["id"], "entryIds": [old]}).status_code == 200

    r = client.post(f"{API}/reconciliation/lines/{line['id']}/undo", headers=owner.headers)
    assert r.status_code == 200 and r.json()["remaining"] == "750.00"
    assert _lines(client, owner.headers)[0]["id"] == line["id"]  # open again
    with SessionLocal() as db:  # the undone match stays as the record
        rows = db.scalars(select(BankMatch).where(BankMatch.entry_id == old)).all()
        assert len(rows) == 1 and rows[0].undone_at and rows[0].undo_reason == "undone"
    # It can be matched again after an undo.
    assert client.post(f"{API}/reconciliation/match", headers=owner.headers,
                       json={"bankLineId": line["id"], "entryIds": [old]}).status_code == 200
    assert client.post(f"{API}/reconciliation/lines/{line['id']}/undo", headers=owner.headers).status_code == 200
    assert client.post(f"{API}/reconciliation/lines/{line['id']}/undo", headers=owner.headers).status_code == 404


def test_database_allows_one_active_match_per_collection(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    e = _pay(client, owner.headers, cid, 100, "e", "741111111111")
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},a,100.00,", f"{_dmy(today_iso())},b,100.00,"]))
    l1, l2 = (x["id"] for x in _lines(client, owner.headers))
    client.post(f"{API}/reconciliation/match", headers=owner.headers, json={"bankLineId": l1, "entryIds": [e]})
    assert client.post(f"{API}/reconciliation/match", headers=owner.headers,
                       json={"bankLineId": l2, "entryIds": [e]}).status_code == 409
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.add(BankMatch(business_id=owner.business["id"], bank_line_id=l2, entry_id=e, amount_paise=10000))
        db.commit()


def test_deleting_a_statement_undoes_its_matches_and_allows_reimport(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    e = _pay(client, owner.headers, cid, 250, "e", "751111111111")
    content = _statement([f"{_dmy(today_iso())},UPI/751111111111,250.00,"])
    assert _import(client, owner.headers, content).json()["imported"] == 1
    line = _lines(client, owner.headers)[0] if _lines(client, owner.headers) else None
    sugg = client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json()
    client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                json={"bankLineId": sugg[0]["bankLine"]["id"], "entryId": e})
    assert _close(client, owner.headers)["difference"] == "0.00"

    stmt = client.get(f"{API}/reconciliation/imports", headers=owner.headers).json()
    assert [s["lines"] for s in stmt] == [1]
    r = client.delete(f"{API}/reconciliation/imports/{stmt[0]['id']}", headers=owner.headers)
    assert r.json() == {"deleted": True, "lines": 1, "matchesUndone": 1}
    assert client.get(f"{API}/reconciliation/imports", headers=owner.headers).json() == []
    assert client.get(f"{API}/reconciliation/matched", headers=owner.headers).json() == []
    assert _close(client, owner.headers)["difference"] == "250.00"  # not in the bank any more
    assert line is None or line["id"] not in {x["id"] for x in _lines(client, owner.headers)}
    again = _import(client, owner.headers, content).json()  # a deleted file can come back
    assert again["alreadyImported"] is False and again["imported"] == 1
    assert client.delete(f"{API}/reconciliation/imports/{stmt[0]['id']}", headers=owner.headers).status_code == 404


def test_column_mapping_and_date_format(make_user, client):
    owner = make_user()
    odd = _statement(["11/07/2026,412345678901,2500.00", "12/30/2026,412345678902,10.00"],
                     header="Posted On,Ref,Money In")
    r = client.post(f"{API}/reconciliation/preview", headers=owner.headers, files={"file": ("x.csv", odd)})
    p = r.json()
    assert p["needsMapping"] is True and p["headers"] == ["Posted On", "Ref", "Money In"]
    assert _import(client, owner.headers, odd).status_code == 422  # can't guess the columns

    m = '{"headerRow": 0, "date": 0, "credit": 2, "utr": 1}'
    p = client.post(f"{API}/reconciliation/preview", headers=owner.headers, files={"file": ("x.csv", odd)},
                    data={"mapping": m, "dateFormat": "MDY"}).json()
    assert p["needsMapping"] is False and p["lines"] == 2
    assert [(s["date"], s["amount"], s["utr"]) for s in p["sample"]] == [
        ("2026-11-07", "2500.00", "412345678901"), ("2026-12-30", "10.00", "412345678902")]
    # Day-first (the default) reads 11/07 as 11 July and can't read 12/30.
    dmy = client.post(f"{API}/reconciliation/preview", headers=owner.headers, files={"file": ("x.csv", odd)},
                      data={"mapping": m}).json()
    assert dmy["sample"][0]["date"] == "2026-07-11" and dmy["rejectedCount"] == 1

    r = _import(client, owner.headers, odd, mapping=m, dateFormat="MDY")
    assert r.status_code == 200 and r.json()["imported"] == 2
    bad = client.post(f"{API}/reconciliation/preview", headers=owner.headers, files={"file": ("x.csv", odd)},
                      data={"mapping": '{"headerRow": 0, "date": 9, "credit": 2}'})
    assert bad.status_code == 422


def test_accountant_can_look_but_not_match_undo_or_delete(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    e = _pay(client, owner.headers, cid, 90, "e", "761111111111")
    _import(client, owner.headers, _statement([f"{_dmy(today_iso())},x,90.00,"]))
    line = _lines(client, owner.headers)[0]
    client.post(f"{API}/team", headers=owner.headers, json={"mobile": "7311000099", "role": "accountant"})
    acc = _login(client, "7311000099")
    assert client.get(f"{API}/reconciliation/lines/{line['id']}/candidates", headers=acc).status_code == 200
    assert client.get(f"{API}/reconciliation/matched", headers=acc).status_code == 200
    assert client.post(f"{API}/reconciliation/match", headers=acc,
                       json={"bankLineId": line["id"], "entryIds": [e]}).status_code == 403
    assert client.post(f"{API}/reconciliation/lines/{line['id']}/undo", headers=acc).status_code == 403
    imp = client.get(f"{API}/reconciliation/imports", headers=acc).json()[0]
    assert client.delete(f"{API}/reconciliation/imports/{imp['id']}", headers=acc).status_code == 403


def test_old_one_to_one_matches_move_into_bank_matches():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, mobile, created_at) VALUES ('u', '9', 'x')"))
        conn.execute(text("INSERT INTO businesses (id, user_id, business_name, owner_name, business_type, state, "
                          "gst_registered, created_at) VALUES ('b', 'u', 'B', 'O', 'R', 'Goa', 0, 'x')"))
        conn.execute(text("INSERT INTO customers (id, business_id, full_name, mobile, outstanding_amount, is_overdue, "
                          "created_at, updated_at, version) VALUES ('c', 'b', 'C', '', 0, 0, 'x', 'x', 1)"))
        conn.execute(text("INSERT INTO ledger_entries (id, customer_id, type, amount, date, created_at) "
                          "VALUES ('e', 'c', 'payment', 5, '2026-01-01', 'x')"))
        conn.execute(text("INSERT INTO bank_imports (id, business_id, file_hash, created_at) VALUES ('i', 'b', 'h', 'x')"))
        conn.execute(text("INSERT INTO bank_lines (id, business_id, import_id, date, amount_paise, matched_entry_id, "
                          "confirmed_by, confirmed_at) VALUES ('l', 'b', 'i', '2026-01-01', 500, 'e', 'u', 't')"))
    _move_bank_matches(engine)
    _move_bank_matches(engine)  # second boot: nothing more
    with Session(engine) as db:
        rows = db.scalars(select(BankMatch)).all()
        assert [(m.bank_line_id, m.entry_id, m.amount_paise, m.confirmed_by) for m in rows] == [("l", "e", 500, "u")]
        assert db.execute(text("SELECT matched_entry_id FROM bank_lines")).scalar() is None


def test_us_dates_parse_only_with_mdy():
    content = _statement(["03/14/2026,x,5.00,"])
    assert parse_statement(content, "x.csv").rejected[0]["reason"].startswith("Date not readable")
    assert parse_statement(content, "x.csv", date_format="MDY").lines[0].date == "2026-03-14"


def test_old_app_upi_payment_without_utr_is_kept_flagged_and_fixable(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers, full_name="Old Phone Shop")["id"]
    other = add_customer(client, owner.headers)["id"]
    _pay(client, owner.headers, other, 10, "taken", "771111111111")
    # An app from before the UTR rule syncs a UPI payment queued offline, no UTR.
    r = client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
        "type": "payment", "amount": "300", "date": today_iso(), "client_id": "old-1", "payment_method": "upi"})
    assert r.status_code == 200, r.text
    entry = r.json()
    assert entry["utr_missing"] is True and entry["reference_number"] is None
    missing = client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()["missingUtr"]
    assert [m["id"] for m in missing] == [entry["id"]]

    path = f"{API}/customers/{cid}/ledger/{entry['id']}/utr"
    assert client.patch(path, headers=owner.headers, json={"utr": "12"}).status_code == 422
    assert client.patch(path, headers=owner.headers, json={"utr": "771111111111"}).status_code == 409
    fixed = client.patch(path, headers=owner.headers, json={"utr": "7711 1111 1112"})
    assert fixed.status_code == 200 and fixed.json()["reference_number"] == "771111111112"
    assert fixed.json()["utr_missing"] is False
    assert client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()["missingUtr"] == []
    assert client.patch(path, headers=owner.headers, json={"utr": "771111111113"}).status_code == 404
