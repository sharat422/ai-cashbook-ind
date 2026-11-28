"""Recurring expenses (and income) post themselves on their due date: the scheduled
job (cron/recurring, like the statement schedules) books what Mark paid would,
once per due date, and records when it did."""

from datetime import date, timedelta

import pytest

from app.calc import today_iso
from app.config import settings

API = "/api/v1"


@pytest.fixture
def cron(client, monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "cr0n")
    return lambda: client.post(f"{API}/cron/recurring", headers={"X-Cron-Secret": "cr0n"})


def _template(client, headers, **over):
    body = {"name": "Shop rent", "amount": 10000, "category": "Rent", "vendor": "Landlord",
            "frequency": "monthly", "next_due_date": today_iso(), **over}
    r = client.post(f"{API}/recurring-expenses", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _books(client, headers, path):
    rows = client.get(f"{API}/{path}", headers=headers).json()
    return rows["items"] if isinstance(rows, dict) else rows


def _pnl(client, headers):
    day = today_iso()
    return client.get(f"{API}/reports/summary", headers=headers, params={"from": day, "to": day}).json()


def test_a_monthly_expense_due_today_posts_itself_once(make_user, client, cron):
    owner = make_user()
    rec = _template(client, owner.headers)
    assert rec["auto_post"] is True and rec["kind"] == "expense"  # new templates post themselves

    assert cron().status_code == 200
    [exp] = _books(client, owner.headers, "expenses")
    assert (exp["amount"], exp["category"], exp["vendor"], exp["date"]) == (10000, "Rent", "Landlord", today_iso())
    assert _pnl(client, owner.headers)["expense_total"] == 10000
    [shown] = _books(client, owner.headers, "recurring-expenses")
    assert shown["last_posted_date"] == today_iso() and shown["last_auto_posted_at"]
    assert shown["next_due_date"] > today_iso() and shown["is_due"] is False

    assert cron().status_code == 200  # a repeated or late run books nothing twice
    assert len(_books(client, owner.headers, "expenses")) == 1
    # Mark paid on the same occurrence can't double it either (one entry per due date).


def test_recurring_income_posts_an_income(make_user, client, cron):
    owner = make_user()
    rec = _template(client, owner.headers, name="Shop on rent to Ravi", amount=4000, category="Other",
                    vendor="", kind="income")
    assert rec["kind"] == "income"
    cron()
    [inc] = _books(client, owner.headers, "incomes")
    assert (inc["amount"], inc["category"], inc["date"]) == (4000, "Other", today_iso())
    assert _books(client, owner.headers, "expenses") == []
    pnl = _pnl(client, owner.headers)
    assert (pnl["income_total"], pnl["expense_total"]) == (4000, 0)
    listed = client.get(f"{API}/recurring-expenses", headers=owner.headers).json()
    assert (listed["income_monthly_total"], listed["monthly_total"]) == (4000, 0)


def test_only_due_active_automatic_ones_and_missed_weeks_each_get_booked(make_user, client, cron):
    owner = make_user()
    tomorrow = (date.fromisoformat(today_iso()) + timedelta(days=1)).isoformat()
    _template(client, owner.headers, name="Later", next_due_date=tomorrow)
    _template(client, owner.headers, name="By hand", auto_post=False)
    paused = _template(client, owner.headers, name="Paused")
    client.patch(f"{API}/recurring-expenses/{paused['id']}", headers=owner.headers,
                 json={**{k: paused[k] for k in ("name", "amount", "category", "vendor", "frequency",
                                                 "next_due_date")}, "active": False})
    three_weeks = (date.fromisoformat(today_iso()) - timedelta(days=21)).isoformat()
    weekly = _template(client, owner.headers, name="Helper wages", amount=700, category="Salary",
                       frequency="weekly", next_due_date=three_weeks)
    cron()
    dates = sorted(e["date"] for e in _books(client, owner.headers, "expenses"))
    assert dates == sorted((date.fromisoformat(today_iso()) - timedelta(days=d)).isoformat() for d in (21, 14, 7, 0))
    [w] = [r for r in _books(client, owner.headers, "recurring-expenses") if r["id"] == weekly["id"]]
    assert w["next_due_date"] == (date.fromisoformat(today_iso()) + timedelta(days=7)).isoformat()


def test_an_older_app_editing_a_template_keeps_its_setting_and_the_job_needs_the_secret(make_user, client, cron):
    owner = make_user()
    rec = _template(client, owner.headers, auto_post=False)
    body = {k: rec[k] for k in ("name", "amount", "category", "vendor", "frequency", "next_due_date")}
    r = client.patch(f"{API}/recurring-expenses/{rec['id']}", headers=owner.headers, json=body)  # no auto_post
    assert (r.json()["auto_post"], r.json()["kind"]) == (False, "expense")
    assert client.post(f"{API}/cron/recurring", headers={"X-Cron-Secret": "nope"}).status_code == 403
    assert client.post(f"{API}/recurring-expenses", headers=owner.headers, json={
        **body, "name": "X", "kind": "gift"}).status_code == 422
