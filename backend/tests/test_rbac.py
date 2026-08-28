"""Role-based access control: owner / accountant / staff enforcement."""

from conftest import MASTER_OTP, today_iso, _login
from helpers import add_customer, add_income


def _add_member(client, owner_headers, mobile, role):
    r = client.post(
        "/api/v1/team", headers=owner_headers, json={"mobile": mobile, "role": role}
    )
    assert r.status_code == 200, r.text
    return r.json()


def _member(make_user, client, role):
    """An owner + a member of the given role, returning both their headers."""
    owner = make_user()  # has a business + an owner membership
    mobile = "9" + str(abs(hash((owner.mobile, role))) % 10**9).zfill(9)
    _add_member(client, owner.headers, mobile, role)
    member_headers = _login(client, mobile)
    return owner, member_headers


# --- Owner: full access -----------------------------------------------------

def test_owner_has_full_access(user, client):
    assert client.get("/api/v1/dashboard/summary", headers=user.headers).status_code == 200
    assert client.get("/api/v1/reports/summary?from=2026-01-01&to=2026-12-31", headers=user.headers).status_code == 200
    assert client.get("/api/v1/team", headers=user.headers).status_code == 200
    c = add_customer(client, user.headers)
    assert client.delete(f"/api/v1/customers/{c['id']}", headers=user.headers).status_code == 204


def test_businesses_me_reports_owner_role(user, client):
    me = client.get("/api/v1/businesses/me", headers=user.headers).json()
    assert me["role"] == "owner"


# --- Accountant: view + export + add/edit, NO delete/settings/team ----------

def test_accountant_can_view_and_add_but_not_delete(make_user, client):
    owner, acc = _member(make_user, client, "accountant")

    # View + reports allowed.
    assert client.get("/api/v1/dashboard/summary", headers=acc).status_code == 200
    assert client.get("/api/v1/reports/summary?from=2026-01-01&to=2026-12-31", headers=acc).status_code == 200
    # Add allowed.
    add_income(client, acc, amount=100, date=today_iso(), client_id="acc-1")
    # Edit allowed.
    c = add_customer(client, acc, full_name="Edit Me", mobile="8000000001")
    upd = client.patch(f"/api/v1/customers/{c['id']}", headers=acc, json={"full_name": "Edited", "mobile": "8000000001"})
    assert upd.status_code == 200
    # Delete NOT allowed.
    assert client.delete(f"/api/v1/customers/{c['id']}", headers=acc).status_code == 403
    # Settings (item catalog) NOT allowed.
    assert client.post("/api/v1/items", headers=acc, json={"name": "X"}).status_code == 403
    # Team management NOT allowed.
    assert client.get("/api/v1/team", headers=acc).status_code == 403


def test_accountant_role_reported(make_user, client):
    _owner, acc = _member(make_user, client, "accountant")
    assert client.get("/api/v1/businesses/me", headers=acc).json()["role"] == "accountant"


# --- Staff: add entries only ------------------------------------------------

def test_staff_can_only_add(make_user, client):
    owner, staff = _member(make_user, client, "staff")

    # Add allowed (income, expense, ledger, customer-by-name for AI flows).
    add_income(client, staff, amount=250, date=today_iso(), client_id="staff-1")
    assert client.post("/api/v1/customers", headers=staff, json={"full_name": "Walk-in", "mobile": ""}).status_code == 200

    # Everything else is blocked.
    assert client.get("/api/v1/dashboard/summary", headers=staff).status_code == 403
    assert client.get("/api/v1/transactions", headers=staff).status_code == 403
    assert client.get("/api/v1/customers", headers=staff).status_code == 403
    assert client.get("/api/v1/reports/summary?from=2026-01-01&to=2026-12-31", headers=staff).status_code == 403
    assert client.get("/api/v1/incomes", headers=staff).status_code == 403  # can add, not list
    assert client.post("/api/v1/items", headers=staff, json={"name": "X"}).status_code == 403
    assert client.get("/api/v1/team", headers=staff).status_code == 403


# --- Team management (owner only) -------------------------------------------

def test_owner_can_manage_team_lifecycle(make_user, client):
    owner = make_user()
    added = _add_member(client, owner.headers, "8111111111", "staff")
    assert added["role"] == "staff"

    listing = client.get("/api/v1/team", headers=owner.headers).json()
    assert len(listing) == 2  # owner + staff
    assert any(m["is_self"] and m["role"] == "owner" for m in listing)

    # Promote staff → accountant.
    upd = client.patch(f"/api/v1/team/{added['user_id']}", headers=owner.headers, json={"role": "accountant"})
    assert upd.status_code == 200 and upd.json()["role"] == "accountant"

    # Remove them.
    assert client.delete(f"/api/v1/team/{added['user_id']}", headers=owner.headers).status_code == 204
    assert len(client.get("/api/v1/team", headers=owner.headers).json()) == 1


def test_adding_existing_mobile_updates_role_not_duplicate(make_user, client):
    owner = make_user()
    _add_member(client, owner.headers, "8222222222", "staff")
    _add_member(client, owner.headers, "8222222222", "accountant")  # same mobile again
    team = client.get("/api/v1/team", headers=owner.headers).json()
    matches = [m for m in team if m["mobile"] == "8222222222"]
    assert len(matches) == 1 and matches[0]["role"] == "accountant"


def test_cannot_remove_or_demote_the_last_owner(make_user, client):
    owner = make_user()
    me = client.get("/api/v1/businesses/me", headers=owner.headers)
    # Find own user_id from the team list.
    team = client.get("/api/v1/team", headers=owner.headers).json()
    self_id = next(m["user_id"] for m in team if m["is_self"])

    demote = client.patch(f"/api/v1/team/{self_id}", headers=owner.headers, json={"role": "staff"})
    assert demote.status_code == 400
    remove = client.delete(f"/api/v1/team/{self_id}", headers=owner.headers)
    assert remove.status_code == 400


def test_invalid_role_rejected(make_user, client):
    owner = make_user()
    r = client.post("/api/v1/team", headers=owner.headers, json={"mobile": "8333333333", "role": "superadmin"})
    assert r.status_code == 422
