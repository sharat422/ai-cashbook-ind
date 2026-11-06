"""Manual UPI/bank reconciliation + daily close."""

import io
from decimal import Decimal

import pytest
from openpyxl import Workbook

from conftest import _login, days_ago_iso, today_iso
from helpers import add_customer, add_ledger
from app.bank_statement import StatementError, parse_amount, parse_statement
from app.database import SessionLocal
from app.models import LedgerEntry

API = "/api/v1"


def _pay(client, headers, cid, amount, client_id, method="upi", ref=None, date=None, **extra):
    data = {"type": "payment", "amount": str(amount), "date": date or today_iso(),
            "client_id": client_id, "payment_method": method, **extra}
    if ref is not None:
        data["reference_number"] = ref
    return client.post(f"{API}/customers/{cid}/ledger", headers=headers, data=data)


def _upload(client, headers, content: bytes, name="statement.csv"):
    return client.post(f"{API}/reconciliation/import", headers=headers,
                       files={"file": (name, content, "text/csv")})


def _dd_mm(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{d}/{m}/{y}"


# --- 1. UTR is required for UPI, by the API --------------------------------------

def test_upi_payment_without_utr_is_rejected_by_the_api(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    for ref in (None, "", "   ", "12"):
        r = _pay(client, owner.headers, cid, 500, f"no-utr-{ref!r}", ref=ref)
        assert r.status_code == 422, (ref, r.text)
    assert _pay(client, owner.headers, cid, 500, "bad-mode", method="bitcoin", ref="x").status_code == 422
    # Cash needs none; UPI with a UTR is stored (spaces dropped); credit is untouched.
    assert _pay(client, owner.headers, cid, 500, "cash-ok", method="cash").status_code == 200
    r = _pay(client, owner.headers, cid, 500, "upi-ok", ref="4123 4567 8901")
    assert r.status_code == 200, r.text
    assert r.json()["reference_number"] == "412345678901"
    add_ledger(client, owner.headers, cid, type="credit", amount=900, date=today_iso(),
               client_id="credit-ok", payment_method="upi")


# --- 2. 100-line import suggests, confirms nothing -------------------------------

def test_hundred_line_import_suggests_matches_and_confirms_none(make_user, client):
    owner = make_user()
    day = days_ago_iso(1)
    customers = [add_customer(client, owner.headers, full_name=f"Shop {i}")["id"] for i in range(5)]
    # 40 UPI collections, each with its own amount and UTR.
    for i in range(40):
        r = _pay(client, owner.headers, customers[i % 5], f"{100 + i}.50", f"c{i}",
                 ref=f"5000000000{i:02d}", date=day)
        assert r.status_code == 200, r.text
    rows = ["Txn Date,Narration,Ref No./Cheque No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance"]
    for i in range(40):  # these match a collection
        rows.append(f"{_dd_mm(day)},UPI/5000000000{i:02d}/Shop,5000000000{i:02d},{_dd_mm(day)},,\"{100 + i}.50\",1")
    for i in range(50):  # money in that nobody recorded
        rows.append(f"{_dd_mm(day)},NEFT IN {i},,{_dd_mm(day)},,\"9,{i:03d}.00\",1")
    for i in range(10):  # money out is ignored
        rows.append(f"{_dd_mm(day)},ATM,,{_dd_mm(day)},500.00,,1")
    content = ("Statement of account\nAccount No: XXXX1234\n\n" + "\n".join(rows)).encode()
    assert len(rows) - 1 == 100

    r = _upload(client, owner.headers, content)
    assert r.status_code == 200, r.text
    assert r.json() | {"rejected": []} == {"imported": 90, "duplicates": 0, "skipped": 10,
                                            "rejected": [], "alreadyImported": False}

    sugg = client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json()
    assert len(sugg) == 40
    assert all(s["match"] == "utr" for s in sugg)
    assert all(s["bankLine"]["amount"] == s["collection"]["amount"] for s in sugg)
    # Nothing confirmed on its own.
    assert all(s["bankLine"]["matchedEntryId"] is None for s in sugg)
    exc = client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()
    assert len(exc["bankLines"]) == 50 and exc["collections"] == []

    # A person confirms one; it leaves the suggestions.
    first = sugg[0]
    r = client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                    json={"bankLineId": first["bankLine"]["id"], "entryId": first["collection"]["id"]})
    assert r.status_code == 200, r.text
    assert len(client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json()) == 39
    again = client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                        json={"bankLineId": first["bankLine"]["id"], "entryId": first["collection"]["id"]})
    assert again.status_code == 409


def test_matching_rules(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    d = days_ago_iso(5)
    a = _pay(client, owner.headers, cid, "250.00", "a", ref="SCB1AB2C3", date=d).json()
    b = _pay(client, owner.headers, cid, "250.00", "b", ref="777777777777", date=d).json()
    _pay(client, owner.headers, cid, "250.00", "cash", method="cash", date=d)  # never matched
    _pay(client, owner.headers, cid, "250.01", "penny", ref="888888888888", date=d)
    content = "\n".join([
        "Date,Description,Amount,Dr/Cr",
        f"{days_ago_iso(4)},UPI-PAYMENT SCB1AB2C3 RAMESH,250.00,CR",  # ref in narration
        f"{days_ago_iso(5)},UPI 999999999999,250,CR",  # same amount, no ref hit
        f"{days_ago_iso(5)},UPI 111111111111,250.00,DR",  # money out
        f"{days_ago_iso(20)},OLD,250.00,CR",  # too far from any collection
        f"{days_ago_iso(5)},ROUNDING,250.009,CR",  # three decimals: rejected, not rounded
    ]).encode()
    body = _upload(client, owner.headers, content).json()
    assert body["imported"] == 3 and body["skipped"] == 1
    assert [x["row"] for x in body["rejected"]] == [6]
    sugg = client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json()
    pairs = {(s["bankLine"]["narration"], s["collection"]["id"], s["match"]) for s in sugg}
    assert pairs == {("UPI-PAYMENT SCB1AB2C3 RAMESH", a["id"], "utr"),
                     ("UPI 999999999999", b["id"], "amount_date")}
    exc = client.get(f"{API}/reconciliation/exceptions", headers=owner.headers).json()
    assert [l["narration"] for l in exc["bankLines"]] == ["OLD"]
    assert [c["amount"] for c in exc["collections"]] == ["250.01"]
    # Wrong pairs are refused.
    old = exc["bankLines"][0]["id"]
    penny = exc["collections"][0]["id"]
    r = client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                    json={"bankLineId": old, "entryId": penny})
    assert r.status_code == 422


# --- 3. Daily close ------------------------------------------------------------

def test_daily_close_is_zero_when_reconciled_else_exact_difference(make_user, client):
    owner = make_user()
    mobile = "7" + str(abs(hash(owner.mobile)) % 10**9).zfill(9)
    r = client.post(f"{API}/team", headers=owner.headers, json={"mobile": mobile, "role": "staff"})
    staff_id, staff = r.json()["user_id"], _login(client, mobile)
    shop = add_customer(client, owner.headers)["id"]
    other_shop = add_customer(client, owner.headers)["id"]
    beat = client.post(f"{API}/beats", headers=owner.headers, json={
        "name": "North", "weekdays": list(range(7)), "assignedUserId": staff_id,
        "customerIds": [shop]}).json()
    other = client.post(f"{API}/beats", headers=owner.headers, json={
        "name": "South", "weekdays": list(range(7)), "customerIds": [other_shop]}).json()
    day = days_ago_iso(1)

    # Staff record on their beat; the server stamps who recorded it.
    upi = _pay(client, staff, shop, "1000.10", "s1", ref="123412341234", date=day, beat_id=beat["id"])
    assert upi.status_code == 200, upi.text
    assert upi.json()["beat_id"] == beat["id"] and upi.json()["salesman_id"] == staff_id
    assert _pay(client, staff, shop, "200.20", "s2", ref="BANKREF001", method="bank",
                date=day, beat_id=beat["id"]).status_code == 200
    assert _pay(client, staff, shop, "0.30", "s3", method="cash", date=day, beat_id=beat["id"]).status_code == 200
    add_ledger(client, staff, shop, type="credit", amount="750.00", date=day, client_id="s4", beat_id=beat["id"])
    # Not their beat / not a shop on the beat.
    assert _pay(client, staff, other_shop, "5", "x1", method="cash", beat_id=other["id"]).status_code == 403
    assert _pay(client, owner.headers, other_shop, "5", "x2", method="cash", beat_id=beat["id"]).status_code == 422

    def close(headers=staff, beat_id=beat["id"]):
        r = client.get(f"{API}/daily-close", headers=headers, params={"beat_id": beat_id, "date": day})
        assert r.status_code == 200, r.text
        return r.json()

    c = close()
    assert c | {"collections": None} == {
        "date": day, "beatId": beat["id"], "collections": None,
        "creditCollected": "1200.60", "cashInHand": "0.30", "upiClaimed": "1000.10",
        "bankClaimed": "200.20", "otherClaimed": "0.00", "verified": "0.00",
        "creditGiven": "750.00", "difference": "1200.30"}
    assert Decimal(c["difference"]) == Decimal("1200.30")  # exact, no float drift

    stmt = f"Date,Narration,Credit,Debit\n{day},UPI/123412341234,1000.10,\n{day},NEFT BANKREF001,200.20,\n"
    _upload(client, owner.headers, stmt.encode())
    for s in client.get(f"{API}/reconciliation/suggestions", headers=owner.headers).json():
        client.post(f"{API}/reconciliation/confirm", headers=owner.headers,
                    json={"bankLineId": s["bankLine"]["id"], "entryId": s["collection"]["id"]})
    after = close()
    assert after["verified"] == "1200.30" and after["difference"] == "0.00"
    assert all(x["verified"] for x in after["collections"] if x["mode"] != "cash")

    # Isolation: staff can't see another beat's close, or the whole business.
    assert client.get(f"{API}/daily-close", headers=staff,
                      params={"beat_id": other["id"], "date": day}).status_code == 403
    assert client.get(f"{API}/daily-close", headers=staff, params={"date": day}).status_code == 403
    assert close(owner.headers, "")["creditCollected"] == "1200.60"
    # Staff can't import or confirm.
    assert _upload(client, staff, stmt.encode()).status_code == 403
    assert client.get(f"{API}/reconciliation/suggestions", headers=staff).status_code == 403


# --- 4. Same file twice → 0 rows -------------------------------------------------

def test_reimporting_the_same_file_imports_nothing(make_user, client):
    owner = make_user()
    with SessionLocal() as db:
        entries_before = db.query(LedgerEntry).count()
    content = f"Date,Narration,Credit\n{today_iso()},UPI/222233334444,10.00\n{today_iso()},CASH DEP,20.00\n".encode()
    first = _upload(client, owner.headers, content).json()
    assert first["imported"] == 2
    second = _upload(client, owner.headers, content).json()
    assert second == {"imported": 0, "duplicates": 0, "skipped": 0, "rejected": [], "alreadyImported": True}
    # An overlapping statement (different file) skips the line it already has, by UTR.
    overlap = content + f"{today_iso()},UPI/555566667777,30.00\n".encode()
    third = _upload(client, owner.headers, overlap).json()
    assert third["imported"] == 2 and third["duplicates"] == 1  # 20.00 has no UTR, so it can't be told apart
    # Another business importing the same file is its own import.
    assert _upload(client, make_user().headers, content).json()["imported"] == 2
    with SessionLocal() as db:  # importing never creates collections
        assert db.query(LedgerEntry).count() == entries_before


# --- Parser ----------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("1,23,456.78", Decimal("123456.78")), ("₹ 500", Decimal("500")), ("(42.10)", Decimal("-42.10")),
    ("100.00 Cr", Decimal("100.00")), ("100.00 Dr", Decimal("-100.00")), (" ", None), ("-", None),
    (1500, Decimal("1500")), (99.5, Decimal("99.5")),
])
def test_parse_amount(raw, expected):
    assert parse_amount(raw) == expected


@pytest.mark.parametrize("raw", ["12.345", "1.2.3", "abc", "1e5", "₹12,34x"])
def test_parse_amount_rejects_instead_of_guessing(raw):
    with pytest.raises(ValueError):
        parse_amount(raw)


def test_xlsx_and_bad_files():
    wb = Workbook()
    ws = wb.active
    ws.append(["Transaction Date", "Particulars", "UTR", "Deposit Amount (INR)", "Withdrawal Amount (INR)"])
    from datetime import datetime
    ws.append([datetime(2026, 11, 2), "UPI IN", "'321098765432", 1250.5, None])
    ws.append([datetime(2026, 11, 2), "RENT", None, None, 9000])
    ws.append(["Opening balance", None, None, None, None])
    buf = io.BytesIO()
    wb.save(buf)
    parsed = parse_statement(buf.getvalue(), "s.xlsx")
    assert [(l.date, l.amount, l.utr) for l in parsed.lines] == [("2026-11-02", Decimal("1250.50"), "321098765432")]
    assert parsed.skipped == 1 and parsed.rejected == []
    with pytest.raises(StatementError):
        parse_statement(b"a,b\n1,2\n", "s.csv")
    with pytest.raises(StatementError):
        parse_statement(b"\xd0\xcf\x11\xe0", "s.xls")
