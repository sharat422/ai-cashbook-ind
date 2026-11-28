"""A wrongly entered income can be fixed or deleted by the owner. Reports change at
once (they sum the table as it is), and every change is in the audit log."""

from sqlalchemy import select

from app.database import SessionLocal
from app.models import AccessLog
from conftest import today_iso
from helpers import add_income
from test_stock import _team

API = "/api/v1"


def _pnl(client, headers):
    day = today_iso()
    return client.get(f"{API}/reports/summary", headers=headers, params={"from": day, "to": day}).json()


def _audit(business_id, action):
    with SessionLocal() as db:
        return [r.path for r in db.scalars(select(AccessLog).where(
            AccessLog.business_id == business_id, AccessLog.action == action))]


def _business_id(client, headers):
    return client.get(f"{API}/businesses/me", headers=headers).json()["id"]


def test_the_owner_fixes_a_wrong_amount_and_reports_show_it_with_an_audit_row(make_user, client):
    owner = make_user()
    inc = add_income(client, owner.headers, amount=5000, date=today_iso(), client_id="i1", notes="Ramesh, cash")
    assert _pnl(client, owner.headers)["income_total"] == 5000

    r = client.patch(f"{API}/incomes/{inc['id']}", headers=owner.headers,
                     json={"amount": 500, "category": "Services", "notes": "Ramesh, UPI"})
    assert r.status_code == 200, r.text
    assert (r.json()["amount"], r.json()["category"], r.json()["notes"]) == (500, "Services", "Ramesh, UPI")
    pnl = _pnl(client, owner.headers)
    assert pnl["income_total"] == pnl["cash_sales"] == 500
    assert [(c["category"], c["amount"]) for c in pnl["income_by_category"]] == [("Services", 500)]

    [log] = _audit(_business_id(client, owner.headers), "edit")
    assert "amount ₹5,000.00 → ₹500.00" in log and "category Sales → Services" in log and inc["id"] in log
    assert "notes changed" in log and "Ramesh" not in log  # notes are private: changed, never quoted

    # Saving the same values again changes nothing and logs nothing.
    assert client.patch(f"{API}/incomes/{inc['id']}", headers=owner.headers, json={"amount": 500}).status_code == 200
    assert len(_audit(_business_id(client, owner.headers), "edit")) == 1


def test_a_deleted_income_leaves_reports_is_logged_and_a_late_retry_cannot_bring_it_back(make_user, client):
    owner = make_user()
    keep = add_income(client, owner.headers, amount=300, date=today_iso(), client_id="keep")
    gone = add_income(client, owner.headers, amount=5000, date=today_iso(), client_id="dup")
    assert _pnl(client, owner.headers)["income_total"] == 5300

    assert client.delete(f"{API}/incomes/{gone['id']}", headers=owner.headers).status_code == 204
    assert _pnl(client, owner.headers)["income_total"] == 300
    assert [i["id"] for i in client.get(f"{API}/incomes", headers=owner.headers).json()] == [keep["id"]]
    [log] = _audit(_business_id(client, owner.headers), "delete")
    assert f"Deleted income {today_iso()} · Sales · ₹5,000.00 ({gone['id']})" == log

    # The phone's queue retrying the same entry (same client id) is refused, not re-created.
    r = client.post(f"{API}/incomes", headers=owner.headers,
                    data={"amount": "5000", "category": "Sales", "date": today_iso(), "client_id": "dup"})
    assert r.status_code == 410 and r.json()["code"] == "entry_discarded"
    assert _pnl(client, owner.headers)["income_total"] == 300
    assert client.delete(f"{API}/incomes/{gone['id']}", headers=owner.headers).status_code == 404


def test_only_the_owner_edits_or_deletes_and_only_their_own(make_user, client):
    owner, [(_, staff), (_, accountant)] = _team(make_user, client, "staff", "accountant")
    inc = add_income(client, owner.headers, amount=1000, date=today_iso(), client_id="i1")
    for headers in (staff, accountant):
        assert client.patch(f"{API}/incomes/{inc['id']}", headers=headers, json={"amount": 1}).status_code == 403
        assert client.delete(f"{API}/incomes/{inc['id']}", headers=headers).status_code == 403
    other = make_user()
    assert client.patch(f"{API}/incomes/{inc['id']}", headers=other.headers, json={"amount": 1}).status_code == 404
    assert client.delete(f"{API}/incomes/{inc['id']}", headers=other.headers).status_code == 404
    bad = client.patch(f"{API}/incomes/{inc['id']}", headers=owner.headers, json={"amount": 0})
    assert bad.status_code == 422
    assert _pnl(client, owner.headers)["income_total"] == 1000
