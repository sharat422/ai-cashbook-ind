"""Self-service data rights: export, business-profile correction, and account
deletion (with confirmation, real erasure, isolation, and a compliance log)."""

from sqlalchemy import select

from conftest import today_iso, _login
from helpers import add_customer, add_expense, add_income, add_ledger
from app.database import SessionLocal
from app.models import AccountDeletionLog, Business, Income, User
from app.routers.account import DELETE_CONFIRMATION


def _seed(client, headers):
    add_income(client, headers, amount=1000, date=today_iso(), client_id="acc-inc-1")
    add_expense(client, headers, amount=200, date=today_iso(), client_id="acc-exp-1")
    c = add_customer(client, headers, full_name="Debtor", mobile="7000000021")
    add_ledger(client, headers, c["id"], type="credit", amount=5000,
               date=today_iso(), client_id="acc-led-1")


# --- (1) Export --------------------------------------------------------------

def test_export_returns_full_account_data(user, client):
    _seed(client, user.headers)
    exp = client.get("/api/v1/account/export", headers=user.headers)
    assert exp.status_code == 200, exp.text
    data = exp.json()
    assert data["account"]["mobile"] == user.mobile
    assert len(data["businesses"]) == 1
    b = data["businesses"][0]
    assert [i["amount"] for i in b["incomes"]] == [1000.0]
    assert [e["amount"] for e in b["expenses"]] == [200.0]
    assert b["customers"][0]["full_name"] == "Debtor"
    assert b["ledger_entries"][0]["amount"] == 5000.0


def test_export_is_scoped_to_the_caller(make_user, client):
    a = make_user()
    b = make_user()
    add_income(client, b.headers, amount=9999, date=today_iso(), client_id="b-only")
    a_export = client.get("/api/v1/account/export", headers=a.headers).json()
    # A's export contains none of B's data.
    amounts = [i["amount"] for biz in a_export["businesses"] for i in biz["incomes"]]
    assert 9999.0 not in amounts


# --- (2) Correct business/account info --------------------------------------

def test_owner_can_correct_business_info(user, client):
    r = client.patch(
        "/api/v1/businesses/me",
        headers=user.headers,
        json={"businessName": "New Name", "ownerName": "Corrected Owner"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["businessName"] == "New Name"
    me = client.get("/api/v1/businesses/me", headers=user.headers).json()
    assert me["businessName"] == "New Name" and me["ownerName"] == "Corrected Owner"


def test_non_owner_cannot_edit_business(make_user, client):
    owner = make_user()
    r = client.post("/api/v1/team", headers=owner.headers,
                    json={"mobile": "8500009001", "role": "accountant"})
    assert r.status_code == 200, r.text
    acc = _login(client, "8500009001")
    assert client.patch("/api/v1/businesses/me", headers=acc,
                        json={"businessName": "Hijack"}).status_code == 403


# --- (3) + (4) Delete account (confirmation, erasure, log) -------------------

def test_delete_requires_exact_confirmation(user, client):
    _seed(client, user.headers)
    bad = client.request("DELETE", "/api/v1/account", headers=user.headers,
                         json={"confirmation": "delete"})
    assert bad.status_code == 422
    # Nothing deleted — data still accessible.
    assert client.get("/api/v1/account/export", headers=user.headers).status_code == 200


def test_delete_erases_all_data_and_logs_it(make_user, client):
    victim = make_user()
    other = make_user()  # must remain untouched
    _seed(client, victim.headers)
    other_biz_id = other.business["id"]

    r = client.request("DELETE", "/api/v1/account", headers=victim.headers,
                       json={"confirmation": DELETE_CONFIRMATION})
    assert r.status_code == 200, r.text
    counts = r.json()["counts"]
    assert counts["users"] == 1 and counts["businesses"] == 1
    assert counts["incomes"] >= 1 and counts["ledger_entries"] >= 1

    # The old token no longer authenticates (user is gone).
    assert client.get("/api/v1/businesses/me", headers=victim.headers).status_code == 401

    with SessionLocal() as s:
        # User + their business + incomes are actually gone.
        assert s.scalars(select(User).where(User.mobile == victim.mobile)).first() is None
        assert s.scalars(
            select(Business).where(Business.id == victim.business["id"])).first() is None
        # A PII-free deletion record was written.
        log = s.scalars(select(AccountDeletionLog)).all()
        assert any(row.mobile_masked.startswith("***") for row in log)
        assert all(victim.mobile not in row.mobile_masked for row in log)  # not full number
        # The other user's business is intact.
        assert s.scalars(select(Business).where(Business.id == other_biz_id)).first() is not None
