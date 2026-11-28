"""Sales on credit (khata) count as sales in Reports P&L and the Business
summary, once, at invoice value, and agree with the GST report's total for
the same period. Money collected on the khata is not sales; drafts and
cancelled invoices aren't sales."""

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_income, add_ledger
from test_gst import _gst_owner, _sale
from test_stock import _item, _team
from test_suppliers import _buy

API = "/api/v1"


def _pnl(client, headers, start, end):
    r = client.get(f"{API}/reports/summary", headers=headers, params={"from": start, "to": end})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_week_of_credit_sales_only_is_not_zero_sales_and_matches_the_gst_report(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers, full_name="Gupta Stores")["id"]
    days, totals = (6, 4, 1), []
    for n, amount in zip(days, (1000, 2500, 400)):  # no income entries at all
        r = _sale(client, owner.headers, cid, f"inv-{n}", amount=amount, date=days_ago_iso(n))
        assert r.status_code == 200, r.text
        totals.append(r.json()["amount"])  # with 18% GST
    week = (days_ago_iso(6), today_iso())

    pnl = _pnl(client, owner.headers, *week)
    assert pnl["income_total"] == pnl["credit_sales"] == sum(totals) == 4602.0
    assert pnl["cash_sales"] == 0 and pnl["profit"] == 4602.0
    assert [(c["category"], c["amount"]) for c in pnl["income_by_category"]] == [("Credit sales", 4602.0)]

    gst = client.get(f"{API}/reports/gst-summary", headers=owner.headers,
                     params={"from": week[0], "to": week[1]}).json()
    assert gst["invoices"] == 3 and float(gst["total"]) == pnl["credit_sales"]

    biz = client.get(f"{API}/business/summary", headers=owner.headers).json()
    assert biz["yesterday"]["sales"] == totals[2]
    this_month = today_iso()[:7]
    in_month = sum(t for n, t in zip(days, totals) if days_ago_iso(n).startswith(this_month))
    assert biz["month"]["sales"] == in_month
    assert biz["month"]["profit"] == biz["month"]["sales"] - biz["month"]["expenses"]


def test_a_credit_sale_counts_once_and_collections_are_not_sales(make_user, client):
    owner = make_user()
    cid = add_customer(client, owner.headers)["id"]
    day = today_iso()
    add_ledger(client, owner.headers, cid, type="credit", amount=1000, date=day, client_id="s1")
    add_ledger(client, owner.headers, cid, type="payment", amount=1000, date=day, client_id="p1",
               payment_method="cash")  # paying the sale off is not more sales
    add_income(client, owner.headers, amount=500, date=day, category="Sales", client_id="i1")  # a cash sale

    pnl = _pnl(client, owner.headers, day, day)
    assert (pnl["income_total"], pnl["credit_sales"], pnl["cash_sales"], pnl["income_count"]) == (1500.0, 1000.0, 500.0, 2)
    assert {c["category"]: c["amount"] for c in pnl["income_by_category"]} == {"Credit sales": 1000.0, "Sales": 500.0}
    biz = client.get(f"{API}/business/summary", headers=owner.headers).json()
    assert biz["month"]["sales"] == 1500.0 and biz["month"]["collections"] == 1000.0


def test_a_stock_purchase_is_one_expense_and_no_sale(make_user, client):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers)
    assert _buy(client, owner.headers, item, 10, "p1", supplier="Sharma Traders").status_code == 200  # 10 × ₹80
    day = today_iso()
    pnl = _pnl(client, owner.headers, day, day)
    assert (pnl["expense_total"], pnl["expense_count"]) == (800.0, 1)
    assert (pnl["income_total"], pnl["credit_sales"], pnl["cash_sales"]) == (0, 0, 0)
    biz = client.get(f"{API}/business/summary", headers=owner.headers).json()
    assert (biz["month"]["sales"], biz["month"]["expenses"]) == (0, 800.0)


def test_cash_gst_sale_counts_once_drafts_and_cancelled_invoices_not_at_all(make_user, client):
    owner = _gst_owner(make_user, client)
    cid = add_customer(client, owner.headers)["id"]
    cash = _sale(client, owner.headers, cid, "cash-1", amount=1000, paid_now="true").json()  # invoice + its payment
    assert _sale(client, owner.headers, cid, "draft-1", amount=5000, draft="true").status_code == 200
    gone = _sale(client, owner.headers, cid, "gone-1", amount=7000).json()
    assert client.post(f"{API}/customers/{cid}/ledger/{gone['id']}/cancel",
                       headers=owner.headers).status_code == 200

    day = today_iso()
    pnl = _pnl(client, owner.headers, day, day)
    assert pnl["income_total"] == pnl["credit_sales"] == cash["amount"] == 1180.0
    gst = client.get(f"{API}/reports/gst-summary", headers=owner.headers, params={"from": day, "to": day}).json()
    assert float(gst["total"]) == 1180.0
