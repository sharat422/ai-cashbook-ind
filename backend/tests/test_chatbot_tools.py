"""Chatbot read-only tools (phase 1). All data here is clearly labelled TEST data.

Covers the acceptance list: the right merchant gets exact data, a wrong merchant
gets nothing, a missing customer is empty, similar names return every match,
plus audit logging, masking and "never writes"."""

import json
import logging
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from conftest import days_ago_iso, today_iso
from helpers import add_customer, add_expense, add_income, add_ledger
from app.chatbot.tools import (
    ACCOUNT_TOOLS,
    TOOLS,
    get_business_summary,
    get_collections_summary,
    get_customer_balance,
    get_top_defaulters,
    list_recent_transactions,
    run_tool,
    search_customer,
)
from app.database import SessionLocal
from app.models import Customer, Expense, Income, LedgerEntry


def _call(fn, merchant_id, **params):
    with SessionLocal() as s:
        return fn(s, merchant_id, **params)


def _seed(client, user):
    """TEST merchant: two Rameshes (ambiguity), one Suresh, khata + income/expense."""
    h = user.headers
    ramesh = add_customer(client, h, full_name="TEST Ramesh", mobile="9876543210",
                          address="TEST secret address", gst_number="29ABCDE1234F1Z5")
    traders = add_customer(client, h, full_name="TEST Ramesh Traders")
    suresh = add_customer(client, h, full_name="TEST Suresh")
    # Ramesh: 5000 credit 40 days ago, 2000 credit 10 days ago, 5000.10 paid today
    # -> oldest credit fully covered, owing 1999.90 since 10 days ago.
    add_ledger(client, h, ramesh["id"], type="credit", amount=5000, date=days_ago_iso(40), client_id="t-c1")
    add_ledger(client, h, ramesh["id"], type="credit", amount=2000, date=days_ago_iso(10), client_id="t-c2")
    add_ledger(client, h, ramesh["id"], type="payment", amount=5000.1, date=today_iso(),
               client_id="t-p1", payment_method="upi")
    add_ledger(client, h, traders["id"], type="credit", amount=800.2, date=today_iso(), client_id="t-c3")
    add_ledger(client, h, suresh["id"], type="credit", amount=300, date=days_ago_iso(40), client_id="t-c4")
    add_ledger(client, h, suresh["id"], type="payment", amount=300, date=today_iso(),
               client_id="t-p2", payment_method="cash")
    add_income(client, h, amount=10000, date=today_iso(), client_id="t-i1")
    add_expense(client, h, amount=2500, date=today_iso(), client_id="t-e1")
    return ramesh, traders, suresh


@pytest.fixture
def merchant(make_user, client):
    u = make_user()
    return u.business["id"], _seed(client, u)


# --- Correct merchant gets correct, exact data -------------------------------

def test_business_summary_exact(merchant):
    mid, _ = merchant
    out = _call(get_business_summary, mid)
    assert out["total_outstanding"] == 2800.1          # 1999.9 + 800.2, no float noise
    assert out["customers_owing"] == 2
    assert out["collected_this_month"] == 5300.1
    assert out["collections_by_method"] == {"cash": 300.0, "upi": 5000.1}
    assert out["as_of"] == today_iso()


def test_customer_balance_by_id_and_unique_name(merchant):
    mid, (ramesh, _, suresh) = merchant
    out = _call(get_customer_balance, mid, customer_id=ramesh["id"])
    assert out["status"] == "found" and out["customer"]["balance"] == 1999.9
    by_name = _call(get_customer_balance, mid, customer_name="test suresh")
    assert by_name["status"] == "found" and by_name["customer"]["balance"] == 0


def test_recent_transactions(merchant):
    mid, _ = merchant
    out = _call(list_recent_transactions, mid, limit=50, days=7)
    assert out["to"] == today_iso()
    dates = [t["date"] for t in out["transactions"]]
    assert dates == sorted(dates, reverse=True) and min(dates) >= days_ago_iso(6)
    types = {t["type"] for t in out["transactions"]}
    assert {"income", "expense", "credit", "payment"} <= types
    khata = [t for t in out["transactions"] if t["type"] in ("credit", "payment")]
    assert all(t["customer"] for t in khata)
    assert _call(list_recent_transactions, mid, limit=1)["transactions"].__len__() == 1


def test_top_defaulters_with_owing_since(merchant):
    mid, _ = merchant
    out = _call(get_top_defaulters, mid)
    first, second = out["defaulters"]
    assert (first["name"], first["balance"]) == ("TEST Ramesh", 1999.9)
    assert first["owing_since"] == days_ago_iso(10) and first["days_owing"] == 10
    assert (second["name"], second["owing_since"], second["days_owing"]) == ("TEST Ramesh Traders", today_iso(), 0)
    assert len(_call(get_top_defaulters, mid, limit=1)["defaulters"]) == 1


def test_collections_summary_periods(merchant, client, make_user):
    mid, (ramesh, _, _) = merchant
    today = date.fromisoformat(today_iso())
    monday = today - timedelta(days=today.weekday())
    with SessionLocal() as s:  # one payment the Sunday before this week's Monday
        s.add(LedgerEntry(customer_id=ramesh["id"], type="payment", amount=7,
                          date=(monday - timedelta(days=1)).isoformat(), payment_method="cash"))
        s.commit()
    assert _call(get_collections_summary, mid, period="today")["total_collected"] == 5300.1
    week = _call(get_collections_summary, mid, period="this_week")
    assert week["from"] == monday.isoformat() and week["total_collected"] == 5300.1
    month = _call(get_collections_summary, mid, period="this_month")
    expected = 5300.1 + (7 if (monday - timedelta(days=1)).month == today.month else 0)
    assert month["total_collected"] == expected


# --- Similar names return every match; missing customer is empty -------------

def test_similar_names_return_all_matches(merchant):
    mid, (ramesh, traders, _) = merchant
    found = _call(search_customer, mid, name="  RAMESH ")
    assert {m["customer_id"] for m in found["matches"]} == {ramesh["id"], traders["id"]}
    amb = _call(get_customer_balance, mid, customer_name="ramesh")
    assert amb["status"] == "ambiguous" and amb["customer"] is None
    assert len(amb["matches"]) == 2
    # An exact full name resolves even though "TEST Ramesh Traders" also contains it.
    exact = _call(get_customer_balance, mid, customer_name="test ramesh")
    assert exact["status"] == "found" and exact["customer"]["customer_id"] == ramesh["id"]


def test_two_customers_with_the_same_exact_name_stay_ambiguous(make_user, client):
    u = make_user()
    add_customer(client, u.headers, full_name="TEST Anil")
    add_customer(client, u.headers, full_name="TEST Anil")
    out = _call(get_customer_balance, u.business["id"], customer_name="test anil")
    assert out["status"] == "ambiguous" and len(out["matches"]) == 2


def test_missing_customer_is_empty(merchant):
    mid, _ = merchant
    assert _call(search_customer, mid, name="Mahesh") == {"matches": []}
    assert _call(get_customer_balance, mid, customer_name="Mahesh") == {"status": "not_found", "customer": None}
    assert _call(get_customer_balance, mid, customer_id="no-such-id") == {"status": "not_found", "customer": None}


# --- Wrong merchant gets nothing ---------------------------------------------

def test_wrong_merchant_gets_nothing(merchant, make_user):
    _, (ramesh, _, _) = merchant
    other = make_user().business["id"]
    assert _call(search_customer, other, name="ramesh") == {"matches": []}
    assert _call(get_customer_balance, other, customer_id=ramesh["id"]) == {"status": "not_found", "customer": None}
    assert _call(get_top_defaulters, other)["defaulters"] == []
    assert _call(list_recent_transactions, other)["transactions"] == []
    assert _call(get_business_summary, other)["total_outstanding"] == 0
    assert _call(get_collections_summary, other)["total_collected"] == 0


def test_unknown_merchant_gets_empty_results(merchant):
    for name, fn in TOOLS.items():
        params = {"name": "ramesh"} if name == "search_customer" else {}
        if name == "get_customer_balance":
            params = {"customer_name": "ramesh"}
        out = _call(fn, "not-a-real-merchant", **params)
        assert "error" not in out
        assert not any(v for k, v in out.items() if k in ("matches", "defaulters", "transactions", "customer"))


def test_llm_cannot_override_merchant_id(merchant, make_user):
    mid, _ = merchant
    other = make_user().business["id"]
    with SessionLocal() as s:  # LLM tries to pass the victim's id as an argument
        out = run_tool(s, other, "search_customer", {"name": "ramesh", "merchant_id": mid})
    assert out == {"matches": []}


# --- Safety: masking, bad input, read-only, audit log -------------------------

def test_no_full_phone_or_sensitive_fields(merchant):
    mid, (ramesh, _, _) = merchant
    blob = json.dumps([
        _call(search_customer, mid, name="ramesh"),
        _call(get_customer_balance, mid, customer_id=ramesh["id"]),
        _call(get_top_defaulters, mid, limit=50),
    ])
    assert "9876543210" not in blob and "***3210" in blob
    assert "TEST secret address" not in blob and "29ABCDE1234F1Z5" not in blob


def test_bad_arguments_return_errors(merchant):
    mid, _ = merchant
    assert "period" in _call(get_collections_summary, mid, period="next_year")["error"]
    assert "limit" in _call(get_top_defaulters, mid, limit="lots")["error"]
    assert "name" in _call(search_customer, mid)["error"]
    assert "invalid parameters" in _call(search_customer, mid, nme="x")["error"]
    with SessionLocal() as s:
        assert "unknown tool" in run_tool(s, mid, "delete_customer", {})["error"]
        assert "object" in run_tool(s, mid, "search_customer", ["x"])["error"]


def test_tools_never_write(merchant):
    mid, (ramesh, _, _) = merchant

    def counts():
        with SessionLocal() as s:
            return [s.scalar(select(func.count()).select_from(m)) for m in (Customer, LedgerEntry, Income, Expense)]

    before = counts()
    _call(get_business_summary, mid)
    _call(get_customer_balance, mid, customer_id=ramesh["id"])
    _call(list_recent_transactions, mid)
    _call(get_top_defaulters, mid)
    _call(get_collections_summary, mid)
    _call(search_customer, mid, name="ramesh")
    assert counts() == before


def test_every_call_is_audited_with_masked_names(merchant, caplog):
    mid, (ramesh, traders, _) = merchant
    with caplog.at_level(logging.INFO, logger="cashbook.chatbot.audit"):
        _call(search_customer, mid, name="Ramesh")
        _call(get_business_summary, mid)
    records = [json.loads(r.getMessage()) for r in caplog.records if r.name == "cashbook.chatbot.audit"]
    assert [r["tool"] for r in records] == ["search_customer", "get_business_summary"]
    search = records[0]
    assert search["merchant_id"] == mid and search["ts"]
    assert search["params"] == {"name": "R*****"}
    assert set(search["result_customer_ids"]) == {ramesh["id"], traders["id"]}
    assert "Ramesh" not in caplog.text and "9876543210" not in caplog.text


def test_check_script_runs_all_account_tools(merchant, capsys):
    from scripts.chatbot_tools_check import main

    mid, _ = merchant
    assert main([mid, "--customer", "ramesh", "--period", "today"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert set(out) == set(ACCOUNT_TOOLS)
    assert out["get_business_summary"]["total_outstanding"] == 2800.1
    assert out["get_customer_balance"]["status"] == "ambiguous"


def test_cashbook_summary_income_and_expenses(merchant, make_user):
    from app.chatbot.tools import get_cashbook_summary

    mid, _ = merchant
    out = _call(get_cashbook_summary, mid, period="today")
    assert (out["income_total"], out["expense_total"], out["net"]) == (10000.0, 2500.0, 7500.0)
    assert (out["income_count"], out["expense_count"]) == (1, 1)
    assert out["from"] == out["to"] == today_iso()
    # Income is not collections (khata payments): 5300.1 must not leak in here.
    assert 5300.1 not in out.values()
    other = make_user().business["id"]
    assert _call(get_cashbook_summary, other, period="today")["income_total"] == 0
    assert "period" in _call(get_cashbook_summary, mid, period="yesterday")["error"]


def test_defaulters_sorted_by_oldest_debt(merchant):
    mid, _ = merchant
    oldest = _call(get_top_defaulters, mid, sort="oldest")["defaulters"]
    # Ramesh (since 10 days) before Ramesh Traders (since today).
    assert [d["name"] for d in oldest] == ["TEST Ramesh", "TEST Ramesh Traders"]
    assert oldest[0]["days_owing"] == 10
    assert "sort" in _call(get_top_defaulters, mid, sort="newest")["error"]


def test_transactions_older_than(merchant):
    mid, _ = merchant
    out = _call(list_recent_transactions, mid, older_than_days=30, limit=50)
    assert out["from"] is None and out["to"] == days_ago_iso(30)
    assert {(t["type"], t["amount"]) for t in out["transactions"]} == {("credit", 5000.0), ("credit", 300.0)}
    assert all(t["date"] <= days_ago_iso(30) for t in out["transactions"])
    assert _call(list_recent_transactions, mid, older_than_days=365)["transactions"] == []


def test_defaulters_include_the_exact_total(merchant):
    mid, _ = merchant
    out = _call(get_top_defaulters, mid, limit=1)
    # Total of ALL customers owing, not just the rows returned (1999.9 + 800.2).
    assert out["total_outstanding"] == 2800.1 and len(out["defaulters"]) == 1
