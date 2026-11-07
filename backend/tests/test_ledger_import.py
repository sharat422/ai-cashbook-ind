"""Khata import from Excel/CSV: column mapping, preview = dry run (writes
nothing), duplicate detection (re-import adds nothing), the import log and the
backup taken before each import."""

import csv
import io
import json
from decimal import Decimal

import pytest
from openpyxl import Workbook, load_workbook
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from conftest import _login, days_ago_iso
from helpers import add_customer, add_ledger
from app.database import SessionLocal
from app.models import Customer, Expense, ImportLog, Income, LedgerEntry

API = "/api/v1"
HEAD = ["Date", "Retailer", "Bill No", "Amount", "Type", "Opening"]


def _csv(rows, head=HEAD) -> bytes:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(head)
    w.writerows(rows)
    return out.getvalue().encode()


def _counts(business_id):
    with SessionLocal() as db:
        ids = select(Customer.id).where(Customer.business_id == business_id)
        return (
            db.scalar(select(func.count()).select_from(Customer).where(Customer.business_id == business_id)),
            db.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.customer_id.in_(ids))),
            db.scalar(select(func.count()).select_from(ImportLog).where(ImportLog.business_id == business_id)),
        )


def _post(client, user, path, data, name="khata.csv", mapping=None):
    form = {"mapping": json.dumps(mapping)} if mapping is not None else {}
    return client.post(f"{API}{path}", headers=user.headers, files={"file": (name, data)}, data=form)


def _khata_500():
    """500 data rows over 40 retailers: 10 opening balances, 5 rows repeated
    later in the file, 2 bad rows. Returns (csv bytes, expectations)."""
    rows, good = [], []
    for i in range(10):  # opening balances, no date (goes on the earliest day)
        r = ["", f"Shop {i}", "", f"{1000 + i}.50", "udhar" if i % 3 else "jama", "yes"]
        rows.append(r)
        good.append(r)
    for i in range(483):
        shop = f"Shop {i % 40}"
        r = [f"{(i % 28) + 1:02d}/03/2026", shop, f"B-{i}", f"{100 + i}", "udhar" if i % 2 else "jama", ""]
        rows.append(r)
        good.append(r)
    for r in good[20:25]:  # exact repeats → duplicates
        rows.append(list(r))
    rows.append(["05/03/2026", "Shop 1", "B-x", "abc", "udhar", ""])  # bad amount
    rows.append(["05/03/2026", "", "B-y", "50", "udhar", ""])  # no retailer
    assert len(rows) == 500
    signed = lambda r: Decimal(r[3]) * (1 if r[4] == "udhar" else -1)  # noqa: E731
    return _csv(rows), {
        "toImport": len(good),
        "opening": float(sum(signed(r) for r in good if r[5] == "yes")),
        "udhar": float(sum(Decimal(r[3]) for r in good if r[4] == "udhar")),
        "retailers": {r[1] for r in good},
    }


def test_500_row_preview_matches_the_file_and_saves_nothing(make_user, client):
    owner = make_user()
    add_customer(client, owner.headers, full_name="shop  7")  # existing retailer, other spelling
    before = _counts(owner.business["id"])
    data, want = _khata_500()

    r = _post(client, owner, "/imports/preview", data)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["mapping"] == {"date": 0, "retailer": 1, "billRef": 2, "amount": 3, "type": 4, "opening": 5}
    assert p["rowCount"] == 500
    assert p["toImport"] == want["toImport"] == 493
    assert p["duplicateCount"] == 5 and {d["against"] for d in p["duplicates"]} == {"file"}
    assert sorted((i["row"], i["reason"]) for i in p["issues"]) == [(500, "bad_amount"), (501, "missing_retailer")]
    assert p["skipped"] == 7
    assert len(p["newRetailers"]) == 39 and "Shop 7" not in p["newRetailers"]
    assert p["openingTotal"] == pytest.approx(want["opening"])
    assert p["udharTotal"] == pytest.approx(want["udhar"])

    assert _counts(owner.business["id"]) == before  # dry run: nothing written


def test_import_logs_backs_up_and_reimport_adds_nothing(make_user, client):
    owner = make_user()
    existing = add_customer(client, owner.headers, full_name="Shop 7")
    data, want = _khata_500()

    r = _post(client, owner, "/imports", data)
    assert r.status_code == 200, r.text
    log = r.json()
    assert (log["rowsImported"], log["rowsSkipped"], log["newRetailers"]) == (493, 7, 39)
    assert log["fileName"] == "khata.csv" and log["importedBy"].startswith("owner · ")
    customers, entries, logs = _counts(owner.business["id"])
    assert (customers, entries, logs) == (40, 493, 1)

    with SessionLocal() as db:  # balances recomputed from the imported ledger
        shop7 = db.get(Customer, existing["id"])
        rows = db.scalars(select(LedgerEntry).where(LedgerEntry.customer_id == shop7.id)).all()
        assert shop7.outstanding_amount == pytest.approx(
            sum(e.amount if e.type == "credit" else -e.amount for e in rows))
        opening = [e for e in rows if e.notes == "Opening balance (imported)"]
        assert len(opening) == 1 and opening[0].date == "2026-03-01"  # earliest day in the file

    # The backup is the books as they were before: one customer, no entries.
    b = client.get(f"{API}/imports/{log['id']}/backup.xlsx", headers=owner.headers)
    assert b.status_code == 200
    wb = load_workbook(io.BytesIO(b.content))
    assert wb["Customers"].max_row == 2 and wb["Ledger"].max_row == 1

    # Re-import the same file: 0 new rows, every row a duplicate of the books.
    again = _post(client, owner, "/imports/preview", data).json()
    assert again["toImport"] == 0 and again["newRetailers"] == []
    assert again["duplicateCount"] == 498  # 493 in the books + 5 repeats
    r2 = _post(client, owner, "/imports", data).json()
    assert r2["rowsImported"] == 0 and r2["rowsSkipped"] == 500
    assert _counts(owner.business["id"]) == (40, 493, 2)

    history = client.get(f"{API}/imports", headers=owner.headers).json()
    assert [h["rowsImported"] for h in history] == [0, 493]


def test_excel_with_telugu_headers_and_manual_mapping(make_user, client):
    owner = make_user()
    wb = Workbook()
    ws = wb.active
    ws.append(["రమేష్ ఖాతా"])  # preamble line above the header
    ws.append(["తేదీ", "దుకాణం", "బిల్లు", "మొత్తం", "రకం", "Notes"])
    ws.append([days_ago_iso(2), "లక్ష్మి స్టోర్స్", 1042.0, 1500, "అప్పు", "paid by cheque"])
    ws.append([days_ago_iso(1), "లక్ష్మి స్టోర్స్", None, 0.1 + 0.2, "జమ", ""])
    ws.append([days_ago_iso(1), "Ravi", None, -250, None, ""])  # no type: minus = jama
    buf = io.BytesIO()
    wb.save(buf)
    data = buf.getvalue()

    p = _post(client, owner, "/imports/preview", data, name="khata.xlsx").json()
    assert p["headerRow"] == 2
    assert p["mapping"] == {"date": 0, "retailer": 1, "billRef": 2, "amount": 3, "type": 4, "opening": None}
    assert [(s["billRef"], s["amount"], s["type"]) for s in p["sample"]] == [
        ("1042", 1500.0, "credit"), ("", 0.3, "payment"), ("", 250.0, "payment")]

    # The person can point a field at another column, or leave required ones out.
    m = dict(p["mapping"], opening=5)
    p2 = _post(client, owner, "/imports/preview", data, name="khata.xlsx", mapping=m).json()
    assert p2["toImport"] == 2 and [i["reason"] for i in p2["issues"]] == ["bad_opening"]
    p3 = _post(client, owner, "/imports/preview", data, name="khata.xlsx",
               mapping=dict(p["mapping"], amount=None)).json()
    assert p3["missing"] == ["amount"] and p3["toImport"] == 0
    r = _post(client, owner, "/imports", data, name="khata.xlsx", mapping=dict(p["mapping"], amount=None))
    assert r.status_code == 422
    r = _post(client, owner, "/imports/preview", data, name="khata.xlsx", mapping=dict(p["mapping"], amount=9))
    assert r.status_code == 422


def test_duplicate_of_an_entry_already_in_the_books(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers, full_name="Sri Balaji Kirana")["id"]
    add_ledger(client, owner.headers, cid, type="credit", amount=1200, date=days_ago_iso(3),
               client_id="c1", invoice_number="INV-9")
    day = days_ago_iso(3)
    data = _csv([
        [day, "SRI BALAJI KIRANA", "inv-9", "1,200.00", "udhar", ""],  # same entry → dup
        [day, "Sri Balaji Kirana", "INV-10", "1200", "udhar", ""],  # other bill → new
        [days_ago_iso(-5), "Sri Balaji Kirana", "INV-11", "10", "udhar", ""],  # future
        [day, "Sri Balaji Kirana", "INV-12", "10", "maybe", ""],  # unknown type
    ])
    p = _post(client, owner, "/imports/preview", data).json()
    assert p["toImport"] == 1 and p["newRetailers"] == []
    assert [(d["row"], d["against"]) for d in p["duplicates"]] == [(2, "books")]
    assert [i["reason"] for i in p["issues"]] == ["future_date", "bad_type"]


def test_two_customers_with_the_same_name_are_not_guessed(make_user, client):
    owner = make_user()
    add_customer(client, owner.headers, full_name="Ganesh Stores")
    add_customer(client, owner.headers, full_name="Ganesh Stores")
    p = _post(client, owner, "/imports/preview", _csv([[days_ago_iso(1), "Ganesh Stores", "", "10", "", ""]])).json()
    assert p["toImport"] == 0 and p["issues"][0]["reason"] == "ambiguous_retailer"


def test_staff_cannot_import_and_backups_are_scoped(make_user, client):
    a, b = make_user(), make_user()
    log = _post(client, a, "/imports", _csv([[days_ago_iso(1), "X", "", "10", "", ""]])).json()
    assert client.get(f"{API}/imports/{log['id']}/backup.xlsx", headers=b.headers).status_code == 404
    assert client.get(f"{API}/imports", headers=b.headers).json() == []

    r = client.post(f"{API}/team", headers=a.headers, json={"mobile": "7012345699", "role": "staff"})
    assert r.status_code == 200, r.text
    staff = _login(client, "7012345699")
    for path in ("/imports/preview", "/imports"):
        r = client.post(f"{API}{path}", headers=staff, files={"file": ("k.csv", b"a,b\n1,2\n")})
        assert r.status_code == 403


@pytest.mark.parametrize("model,scope", [(Income, "business_id"), (Expense, "business_id"),
                                         (LedgerEntry, "customer_id")])
def test_database_refuses_a_second_row_for_one_client_id(make_user, client, model, scope):
    # Two offline retries racing each other both pass the route's look-up;
    # the unique index makes the database keep exactly one.
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    base = {"amount": 1.0, "date": days_ago_iso(1), "client_id": "dup-1"}
    if model is LedgerEntry:
        base |= {"customer_id": cid, "type": "credit"}
    else:
        base |= {"business_id": owner.business["id"], "category": "Sales"}
        if model is Expense:
            base["vendor"] = "V"
    with SessionLocal() as db:
        db.add(model(**base))
        db.commit()
        db.add(model(**base))
        with pytest.raises(IntegrityError):
            db.commit()
