"""E2E: AI business assistant / NL analytics (heuristic classifier, no key).

The LLM only classifies intent; numbers are computed from the DB, so these
assert the computed answers regardless of whether a key is set.
"""

from conftest import today_iso
from helpers import add_customer, add_expense, add_income, add_ledger


def _seed(client, headers):
    raj = add_customer(client, headers, full_name="Raj Traders")
    small = add_customer(client, headers, full_name="Small Co")
    add_ledger(client, headers, raj["id"], type="credit", amount=5000,
               date=today_iso(), client_id="a-raj-cr")
    add_ledger(client, headers, raj["id"], type="payment", amount=2000,
               date=today_iso(), client_id="a-raj-pay")
    add_ledger(client, headers, small["id"], type="credit", amount=1000,
               date=today_iso(), client_id="a-small-cr")
    add_income(client, headers, amount=8000, date=today_iso(), client_id="a-inc")
    add_expense(client, headers, amount=1200, date=today_iso(), category="Fuel",
                vendor="HP", client_id="a-exp")


def ask(client, headers, q):
    r = client.post("/api/v1/assistant/ask", headers=headers, json={"question": q})
    assert r.status_code == 200, r.text
    return r.json()


def test_who_owes_most(user, client):
    _seed(client, user.headers)
    a = ask(client, user.headers, "who owes me the most?")
    assert a["intent"] == "top_debtors"
    assert a["items"][0]["name"] == "Raj Traders"
    assert a["items"][0]["amount"] == 3000  # 5000 credit − 2000 payment


def test_collections_this_month(user, client):
    _seed(client, user.headers)
    a = ask(client, user.headers, "how much did I collect this month?")
    assert a["intent"] == "collections"
    assert a["amount"] == 2000


def test_sales_this_month(user, client):
    _seed(client, user.headers)
    a = ask(client, user.headers, "how much did I sell this month?")
    assert a["intent"] == "sales"
    assert a["amount"] == 8000


def test_biggest_expenses(user, client):
    _seed(client, user.headers)
    a = ask(client, user.headers, "what were my biggest expenses this month?")
    assert a["intent"] == "top_expenses"
    assert a["items"][0]["name"] == "Fuel"


def test_customer_purchases(user, client):
    _seed(client, user.headers)
    a = ask(client, user.headers, "how much did Raj Traders purchase in the last 3 months?")
    assert a["intent"] == "customer_purchases"
    assert a["customer"] == "Raj Traders"
    assert a["total"] == 5000


def test_compare_months(user, client):
    _seed(client, user.headers)
    a = ask(client, user.headers, "compare this month with last month")
    assert a["intent"] == "compare_months"
    assert a["this_month"]["sales"] == 8000


def test_assistant_requires_auth(client):
    assert client.post(
        "/api/v1/assistant/ask", json={"question": "hi"}
    ).status_code in (401, 403)
