"""FMCG schemes at billing: apply, show as a separate line, log — no claims."""

import random
from decimal import Decimal

from conftest import _login, days_ago_iso, today_iso
from helpers import add_customer
from app import schemes as eng
from app.database import SessionLocal
from app.models import Bill, Customer, LedgerEntry, SchemeApplication

API = "/api/v1"
D = Decimal


def _team(make_user, client):
    owner = make_user()
    mobile = "8" + str(abs(hash((owner.mobile, "schemes"))) % 10**9).zfill(9)
    r = client.post(f"{API}/team", headers=owner.headers, json={"mobile": mobile, "role": "staff"})
    assert r.status_code == 200, r.text
    return owner, r.json()["user_id"], _login(client, mobile)


def _item(client, headers, name, price=10, opening=1000):
    r = client.post(f"{API}/items", headers=headers, json={
        "name": name, "unit": "pcs", "sale_price": price, "track_stock": True, "stock_qty": opening})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _scheme(client, headers, name, items, kind="buy_get", priority=1, start=None, end=None, **cfg):
    body = {"name": name, "type": kind, "itemIds": items, "priority": priority,
            "validFrom": start or days_ago_iso(30), "validTo": end or today_iso(), **cfg}
    return client.post(f"{API}/schemes", headers=headers, json=body)


def _bill(client, headers, cid, lines, day=None, location="godown", van=None, cid_key=None):
    return client.post(f"{API}/bills", headers=headers, json={
        "customerId": cid, "date": day or today_iso(), "location": location, "vanUserId": van,
        "clientId": cid_key, "lines": [{"itemId": i, "quantity": q} for i, q in lines]})


def _stock(client, headers, item_id):
    return next(i for i in client.get(f"{API}/stock", headers=headers).json()["items"] if i["id"] == item_id)


# --- 1. 10+1 on 20 units: 2 free, shown as its own line ------------------------------

def test_ten_plus_one_on_twenty_adds_two_free_as_a_separate_line(make_user, client):
    owner = make_user()
    soap = _item(client, owner.headers, "Soap", price=25)
    assert _scheme(client, owner.headers, "Soap 10+1", [soap], buyQty=10, freeQty=1).status_code == 200
    cid = add_customer(client, owner.headers)["id"]

    r = _bill(client, owner.headers, cid, [(soap, 20)])
    assert r.status_code == 200, r.text
    bill = r.json()
    assert bill["lines"] == [{"itemId": soap, "name": "Soap", "unit": "pcs", "quantity": "20.000",
                              "rate": "25.00", "amount": "500.00"}]
    [line] = bill["schemes"]
    assert (line["schemeName"], line["status"], line["freeItemName"], line["freeQty"]) == (
        "Soap 10+1", "applied", "Soap", "2.000")
    assert (line["discount"], line["value"]) == ("0.00", "50.00")  # 2 free × ₹25
    assert (bill["subtotal"], bill["discount"], bill["total"]) == ("500.00", "0.00", "500.00")

    # Paid and free goods leave stock; the total goes on the retailer's credit.
    assert _stock(client, owner.headers, soap)["godown"] == "978.000"
    with SessionLocal() as db:
        entry = db.get(LedgerEntry, bill["ledgerEntryId"])
        assert (entry.type, entry.amount, entry.invoice_number) == ("credit", 500.0, bill["billNumber"])
        assert db.get(Customer, cid).outstanding_amount == 500.0

    # 19 units = one set of 10 = 1 free; 9 units = none.
    preview = client.post(f"{API}/bills/preview", headers=owner.headers, json={
        "customerId": cid, "date": today_iso(), "lines": [{"itemId": soap, "quantity": 19}]}).json()
    assert preview["lines"][0]["scheme"]["freeQty"] == "1.000"
    preview = client.post(f"{API}/bills/preview", headers=owner.headers, json={
        "customerId": cid, "date": today_iso(), "lines": [{"itemId": soap, "quantity": 9}]}).json()
    assert preview["lines"][0]["scheme"] is None


# --- 2. Expired (or not yet started, or switched off) never applies -------------------

def test_an_expired_scheme_is_never_applied(make_user, client):
    owner = make_user()
    tea = _item(client, owner.headers, "Tea", price=100)
    _scheme(client, owner.headers, "Ended", [tea], kind="percent", percent=10, priority=1,
            start=days_ago_iso(30), end=days_ago_iso(1))
    _scheme(client, owner.headers, "Future", [tea], kind="percent", percent=20, priority=2,
            start="2099-01-01", end="2099-12-31")
    off = _scheme(client, owner.headers, "Off", [tea], kind="percent", percent=30, priority=3).json()
    client.patch(f"{API}/schemes/{off['id']}", headers=owner.headers, json={
        **{k: off[k] for k in ("name", "type", "itemIds", "validFrom", "validTo", "priority", "percent")},
        "active": False})
    cid = add_customer(client, owner.headers)["id"]

    bill = _bill(client, owner.headers, cid, [(tea, 5)]).json()
    assert bill["schemes"] == [] and bill["total"] == "500.00"
    # On its last valid day it still applies (dates are inclusive).
    bill = _bill(client, owner.headers, cid, [(tea, 5)], day=days_ago_iso(1)).json()
    assert [s["schemeName"] for s in bill["schemes"]] == ["Ended"] and bill["total"] == "450.00"


# --- 3. Scheme log total = sum of scheme lines on the period's bills -------------------

def test_scheme_report_matches_the_scheme_lines_on_bills(make_user, client):
    owner = make_user()
    a, b, gift = (_item(client, owner.headers, n, price=p) for n, p in (("A", 12.5), ("B", 40), ("Gift", 7)))
    _scheme(client, owner.headers, "A 10+1", [a], buyQty=10, freeQty=1, priority=1)
    _scheme(client, owner.headers, "B slab", [b], kind="slab", priority=2,
            slabs=[[10, 2], [50, "4.5"]])
    _scheme(client, owner.headers, "B gift", [b], kind="free_goods", priority=3,
            minQty=24, freeQty=1, freeItemId=gift)
    cids = [add_customer(client, owner.headers, full_name=f"Shop {i}")["id"] for i in range(3)]

    rng = random.Random(7)
    inside, outside = [], []
    for n in range(12):
        day = days_ago_iso(rng.choice([0, 1, 2, 40]))
        lines = [(a, rng.randint(1, 35)), (b, rng.randint(1, 80))]
        bill = _bill(client, owner.headers, rng.choice(cids), lines, day=day).json()
        (outside if day == days_ago_iso(40) else inside).append(bill)

    applied = [s for bill in inside for s in bill["schemes"] if s["status"] == "applied"]
    report = client.get(f"{API}/schemes/report", headers=owner.headers,
                        params={"from": days_ago_iso(2), "to": today_iso()}).json()
    assert D(report["totalValue"]) == sum(D(s["value"]) for s in applied)
    assert D(report["totalDiscount"]) == sum(D(bill["discount"]) for bill in inside)
    assert D(report["totalFreeQty"]) == sum(D(s["freeQty"]) for s in applied)
    by_scheme = {(r["schemeName"], r["itemName"]) for r in report["rows"]}
    assert by_scheme <= {("A 10+1", "A"), ("B slab", "B")}  # "B gift" lost on priority

    # Per retailer and per bill, the log shows applied and not-applied rows.
    log = client.get(f"{API}/schemes/log", headers=owner.headers,
                     params={"from": days_ago_iso(2), "to": today_iso(), "customerId": cids[0]}).json()
    assert all(x["customerId"] == cids[0] for x in log)
    one = inside[0]
    log = client.get(f"{API}/schemes/log", headers=owner.headers,
                     params={"from": one["date"], "to": one["date"], "billId": one["id"]}).json()
    assert {x["id"] for x in log} == {s["id"] for s in one["schemes"]}
    assert client.get(f"{API}/schemes/report", headers=owner.headers,
                      params={"from": today_iso(), "to": days_ago_iso(1)}).status_code == 422


# --- Two schemes could apply: only the owner's priority applies -----------------------

def test_priority_decides_and_the_other_is_logged_not_applied(make_user, client):
    owner = make_user()
    oil = _item(client, owner.headers, "Oil", price=150)
    _scheme(client, owner.headers, "Oil 5% off", [oil], kind="percent", percent=5, priority=2)
    _scheme(client, owner.headers, "Oil 12+1", [oil], buyQty=12, freeQty=1, priority=1)
    cid = add_customer(client, owner.headers)["id"]

    bill = _bill(client, owner.headers, cid, [(oil, 12)]).json()
    by = {s["schemeName"]: s for s in bill["schemes"]}
    assert by["Oil 12+1"]["status"] == "applied" and by["Oil 12+1"]["freeQty"] == "1.000"
    assert by["Oil 5% off"]["status"] == "not_applied"
    assert by["Oil 5% off"]["reason"] == "Not applied: 'Oil 12+1' has priority (1 before 2)."
    assert by["Oil 5% off"]["value"] == "0.00" and bill["total"] == "1800.00"
    # Below 12 the 12+1 doesn't qualify, so the 5% applies with nothing to explain.
    bill = _bill(client, owner.headers, cid, [(oil, 4)]).json()
    assert [(s["schemeName"], s["status"]) for s in bill["schemes"]] == [("Oil 5% off", "applied")]
    assert (bill["discount"], bill["total"]) == ("30.00", "570.00")

    # The same priority twice is refused.
    r = _scheme(client, owner.headers, "Clash", [oil], kind="percent", percent=1, priority=1)
    assert r.status_code == 422 and "Oil 12+1" in r.text


# --- 4. No scheme makes a bill negative -----------------------------------------------

def test_no_scheme_makes_a_bill_negative(make_user, client):
    owner = make_user()
    pen, cap = _item(client, owner.headers, "Pen", price=0.1), _item(client, owner.headers, "Cap", price=3)
    _scheme(client, owner.headers, "Pens free", [pen], kind="percent", percent=100, priority=1)
    _scheme(client, owner.headers, "Cap slab", [cap], kind="slab", priority=2, slabs=[[1, 100]])
    cid = add_customer(client, owner.headers)["id"]
    bill = _bill(client, owner.headers, cid, [(pen, 3), (cap, 2)]).json()
    assert (bill["subtotal"], bill["discount"], bill["total"]) == ("6.30", "6.30", "0.00")
    assert bill["ledgerEntryId"] is None  # nothing owed, so no credit entry
    for bad in ({"percent": 101}, {"percent": 0}, {"percent": -5}):
        assert _scheme(client, owner.headers, "Bad", [pen], kind="percent", priority=9, **bad).status_code == 422


def test_engine_sweep_never_goes_negative():
    rng = random.Random(3)
    rules = [eng.Rule(id=f"r{i}", name=f"r{i}", type="slab" if i % 2 else "percent",
                      item_ids={"x"}, valid_from="2026-01-01", valid_to="2026-12-31", priority=i,
                      percent=D(rng.choice(["0.01", "33.33", "99.99", "100"])),
                      min_qty=D(rng.randint(0, 5)),
                      slabs=[(D(1), D("50")), (D(3), D("100"))]) for i in range(1, 7)]
    for _ in range(3000):
        qty = D(rng.randint(1, 9000)) / 1000
        amount = eng.money(qty * D(rng.randint(0, 99999)) / 100)
        [res] = eng.evaluate([{"item_id": "x", "quantity": qty, "amount": amount}], rules, "2026-06-01",
                             lambda _: D("1"))
        if res["applied"]:
            assert 0 <= res["applied"]["benefit"].discount <= amount
            assert res["applied"]["rule"].priority == min(
                [res["applied"]["rule"].priority] + [x["rule"].priority for x in res["not_applied"]])


# --- Stock, roles, retries -------------------------------------------------------------

def test_van_bill_by_staff_free_goods_stock_and_retries(make_user, client):
    owner, staff_id, staff = _team(make_user, client)
    shampoo = _item(client, owner.headers, "Shampoo", price=60, opening=100)
    sachet = _item(client, owner.headers, "Sachet", price=2, opening=100)
    _scheme(client, owner.headers, "24 → 1 sachet", [shampoo], kind="free_goods",
            minQty=24, freeQty=1, freeItemId=sachet)
    for item, q in ((shampoo, 50), (sachet, 1)):
        client.post(f"{API}/stock/transfers", headers=owner.headers, json={
            "itemId": item, "quantity": q, "vanUserId": staff_id, "date": today_iso()})
    cid = add_customer(client, owner.headers)["id"]

    # 48 → 2 sachets free, but the van holds 1: the whole bill is refused.
    r = _bill(client, staff, cid, [(shampoo, 48)], location="van")
    assert r.status_code == 422 and "Sachet" in r.text
    with SessionLocal() as db:
        assert db.query(Bill).filter_by(customer_id=cid).count() == 0
    for _ in range(2):  # 24 → 1 sachet; a retry is saved once
        r = _bill(client, staff, cid, [(shampoo, 24)], location="van", cid_key="bill-1")
        assert r.status_code == 200, r.text
    bill = r.json()
    assert bill["schemes"][0]["freeItemName"] == "Sachet" and bill["schemes"][0]["value"] == "2.00"
    van = {i["name"]: i["quantity"] for i in client.get(f"{API}/stock/van", headers=staff).json()}
    assert van == {"Shampoo": "26.000"}  # the sachet left the van too
    assert _stock(client, owner.headers, shampoo)["godown"] == "50.000"  # godown untouched
    with SessionLocal() as db:
        assert db.query(Bill).filter_by(customer_id=cid).count() == 1
        assert db.query(SchemeApplication).filter_by(bill_id=bill["id"]).count() == 1

    # Staff bill only from their own van; only the owner sets up schemes.
    assert _bill(client, staff, cid, [(shampoo, 1)], location="godown").status_code == 403
    assert _scheme(client, staff, "Mine", [shampoo], kind="percent", percent=5, priority=7).status_code == 403
    assert client.get(f"{API}/schemes/report", headers=staff,
                      params={"from": today_iso(), "to": today_iso()}).status_code == 403
    # Bad scheme set-ups are refused.
    for cfg in ({"kind": "slab", "slabs": [[10, 5], [5, 8]]}, {"kind": "buy_get", "buyQty": "1.5", "freeQty": 1},
                {"kind": "free_goods", "minQty": 2, "freeQty": 1}, {"kind": "bogo"}):
        assert _scheme(client, owner.headers, "Bad", [shampoo], priority=8, **cfg).status_code == 422, cfg
    assert _scheme(client, owner.headers, "Backwards", [shampoo], kind="percent", percent=1, priority=8,
                   start=today_iso(), end=days_ago_iso(1)).status_code == 422
