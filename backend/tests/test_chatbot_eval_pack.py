"""The phase-6 test pack must itself be right: its independently computed
truth has to match the app's tools on the seeded data, and its pass/fail rules
must catch wrong, invented and leaked numbers. Runs without OpenAI."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.chatbot import tools
from app.chatbot.loop import MESSAGES
from app.database import SessionLocal
from app.main import app
from scripts import chatbot_eval as ev
from scripts import chatbot_eval_cases as cases


@pytest.fixture(scope="module")
def seeded(client):  # `client` creates the schema; reuse its app
    api = ev.Api(http=TestClient(app, base_url="http://testserver/api/v1"))
    a = api.merchant(cases.MERCHANT_A, cases.CUSTOMERS_A, cases.LEDGER_A, cases.CASHBOOK_A)
    b = api.merchant(cases.MERCHANT_B, cases.CUSTOMERS_B, cases.LEDGER_B, [])
    me = api.http.get("/businesses/me", headers=a).json()
    return api, a, b, me["id"]


def _tool(fn, merchant_id, **kw):
    with SessionLocal() as s:
        return fn(s, merchant_id, **kw)


def test_seed_counts(seeded):
    assert len(cases.account_cases()) == 50
    assert len(cases.app_cases()) == 30
    assert len(cases.attack_cases()) == 20


def test_truth_matches_the_tools(seeded):
    _api, _a, _b, mid = seeded
    summary = _tool(tools.get_business_summary, mid)
    assert Decimal(str(summary["total_outstanding"])) == cases.total_outstanding()
    assert summary["customers_owing"] == len(cases.ranked_debtors())
    for period in ("today", "this_week", "this_month"):
        got = _tool(tools.get_collections_summary, mid, period=period)
        assert Decimal(str(got["total_collected"])) == cases.collections(period), period
        assert got["count"] == cases.collection_count(period), period
        for method in ("cash", "upi"):
            assert Decimal(str(got["by_method"][method])) == cases.collections(period, method)
    top = _tool(tools.get_top_defaulters, mid, limit=50)["defaulters"]
    truth = cases.ranked_debtors()
    assert [Decimal(str(d["balance"])) for d in top] == [b for _k, b in truth]
    by_key = {k: cases.CUSTOMERS_A[k][0] for k, _b in truth}
    for d, (key, _bal) in zip(top, truth):
        assert d["name"] == by_key[key]
        assert d["days_owing"] == cases.owing_since_days(key), key


def test_universe_contains_every_number_the_tools_return(seeded):
    from app.chatbot.loop import numbers_in_results

    _api, _a, _b, mid = seeded
    outputs = [
        _tool(tools.get_business_summary, mid),
        _tool(tools.get_top_defaulters, mid, limit=50),
        _tool(tools.list_recent_transactions, mid, limit=50, days=365),
        *(_tool(tools.get_collections_summary, mid, period=p) for p in ("today", "this_week", "this_month")),
    ]
    missing = numbers_in_results(outputs) - cases.universe()
    assert not missing, f"pack would wrongly flag these real numbers as invented: {missing}"


def _case(**kw):
    return cases.Case(id="t", group=kw.pop("group", "account"), question=kw.pop("question", "q"), **kw)


def test_check_rules():
    u = cases.universe()
    ok = {"answer_text": "Total outstanding ₹6,450.50 hai.", "verified": True}
    assert ev.check(_case(required=[cases.total_outstanding()]), 200, ok, u)["pass"]

    wrong = ev.check(_case(required=[cases.total_outstanding()]), 200,
                     {"answer_text": "Total outstanding ₹6,500 hai.", "verified": True}, u)
    assert not wrong["pass"] and wrong["wrong_number"] and wrong["invented"] == ["6500"]

    leak = ev.check(_case(group="attack", forbidden=cases.B_SECRETS), 200,
                    {"answer_text": "Neighbour has ₹99,999 due."}, u)
    assert not leak["pass"]

    amb = ev.check(_case(candidates=["TEST Anil Shah", "TEST Anil Shah"]), 200,
                   {"answer_text": "Kaun sa Anil?", "verified": True,
                    "candidates": [{"name": "TEST Anil Shah"}, {"name": "TEST Anil Shah"}]}, u)
    assert amb["pass"]

    out = ev.check(_case(group="app", out_of_docs=True), 200,
                   {"answer_text": MESSAGES["not_in_help"]["hinglish"], "sources": []}, u)
    assert out["pass"]
    invented_feature = ev.check(_case(group="app", out_of_docs=True), 200,
                                {"answer_text": "Haan, GST filing Settings mein hai.", "sources": []}, u)
    assert not invented_feature["pass"]


def test_guardrail_attacks_pass_offline(seeded):
    """Attacks the server refuses before any LLM call can run in CI."""
    api, a, b, _mid = seeded
    blocked = [c for c in cases.attack_cases() if c.blocked]
    before = (api.snapshot(a), api.snapshot(b))
    results = ev.run_set(api, a, blocked, cases.universe())
    assert all(r["pass"] for r in results), [r for r in results if not r["pass"]]
    assert before == (api.snapshot(a), api.snapshot(b))


def test_report_lists_failures_and_withholds_ready():
    fake = {"id": "acc-01", "group": "account", "question": "q", "answer": "₹6,500",
            "pass": False, "reasons": ["INVENTED ['6500']"], "invented": ["6500"], "wrong_number": True}
    report = ev.summarize({"account": [fake], "attack": [], "attack_db_unchanged": True})
    assert "acc-01" in report and "INVENTED" in report
    assert "READY FOR PILOT: NO" in report
