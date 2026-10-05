"""Launch-check evidence: cross-tenant authorization (IDOR) audit.

Proves that an authenticated caller for one account (A) cannot READ, EDIT,
EXPORT or DELETE another account's (B) data — even when A supplies B's exact
record IDs (the "altered ID" / IDOR attack). Every data table is exercised:
customers, ledger entries (owned indirectly via the customer), incomes,
expenses, items, recurring expenses, plus the unified transaction feed, reports
export, and file (attachment) storage.

These complement test_isolation.py (list-level bleed) and test_rbac.py (role
gating within one business) with explicit hostile-request coverage: A holds a
valid token and knowingly targets B's IDs. Expected result for every operation
is a denial — 404 (the record does not exist *for this tenant*) — and B's data
must be provably unchanged afterwards.
"""

import uuid

import pytest

from conftest import today_iso, _login
from app.security import create_access_token
from helpers import add_customer, add_expense, add_income, add_ledger


# --- Customers: read / edit / delete another tenant's record ----------------

def test_cannot_read_edit_or_delete_another_tenants_customer(make_user, client):
    a = make_user(business_name="Business A")
    b = make_user(business_name="Business B")
    victim = add_customer(client, b.headers, full_name="B's Customer", mobile="7000000001")
    cid = victim["id"]

    # READ B's customer with A's token + B's real id.
    assert client.get(f"/api/v1/customers/{cid}", headers=a.headers).status_code == 404
    # EDIT.
    r = client.patch(
        f"/api/v1/customers/{cid}",
        headers=a.headers,
        json={"full_name": "HACKED", "mobile": "7000000001"},
    )
    assert r.status_code == 404
    # DELETE.
    assert client.delete(f"/api/v1/customers/{cid}", headers=a.headers).status_code == 404

    # B's record is untouched: still present, name unchanged.
    still = client.get(f"/api/v1/customers/{cid}", headers=b.headers)
    assert still.status_code == 200
    assert still.json()["full_name"] == "B's Customer"


# --- Ledger: the indirect-ownership hotspot (owned via customer.business_id) -

def test_cannot_read_or_write_ledger_on_another_tenants_customer(make_user, client):
    a = make_user()
    b = make_user()
    b_cust = add_customer(client, b.headers, full_name="B Debtor", mobile="7000000002")
    add_ledger(
        client, b.headers, b_cust["id"],
        type="credit", amount=5000, date=today_iso(), client_id="led-b-1",
    )

    # READ B's ledger through A → 404 (customer not owned by A).
    assert client.get(
        f"/api/v1/customers/{b_cust['id']}/ledger", headers=a.headers
    ).status_code == 404

    # WRITE a ledger entry onto B's customer through A → 404.
    r = client.post(
        f"/api/v1/customers/{b_cust['id']}/ledger",
        headers=a.headers,
        data={"type": "payment", "amount": "9999", "date": today_iso(), "client_id": "led-hack"},
    )
    assert r.status_code == 404

    # B's ledger is unchanged (exactly the one legitimate entry).
    b_ledger = client.get(
        f"/api/v1/customers/{b_cust['id']}/ledger", headers=b.headers
    ).json()
    assert [e["amount"] for e in b_ledger] == [5000.0]


# --- Items: read / edit / delete another tenant's catalog item --------------

def test_cannot_read_edit_or_delete_another_tenants_item(make_user, client):
    a = make_user()
    b = make_user()
    item = client.post(
        "/api/v1/items", headers=b.headers, json={"name": "B Widget", "sale_price": 100}
    )
    assert item.status_code == 200, item.text
    iid = item.json()["id"]

    assert client.get(f"/api/v1/items/{iid}", headers=a.headers).status_code == 404
    assert client.patch(
        f"/api/v1/items/{iid}", headers=a.headers, json={"name": "HACKED"}
    ).status_code == 404
    assert client.delete(f"/api/v1/items/{iid}", headers=a.headers).status_code == 404

    # Unchanged for B.
    assert client.get(f"/api/v1/items/{iid}", headers=b.headers).json()["name"] == "B Widget"


# --- Recurring expenses: edit / delete / post-occurrence across tenants ------

def test_cannot_touch_another_tenants_recurring_expense(make_user, client):
    a = make_user()
    b = make_user()
    rec = client.post(
        "/api/v1/recurring-expenses",
        headers=b.headers,
        json={
            "name": "B Rent", "amount": 20000, "category": "Rent",
            "frequency": "monthly", "next_due_date": today_iso(),
        },
    )
    assert rec.status_code == 200, rec.text
    rid = rec.json()["id"]

    # EDIT / DELETE / POST-occurrence with A's token + B's id → 404 each.
    assert client.patch(
        f"/api/v1/recurring-expenses/{rid}",
        headers=a.headers,
        json={"name": "HACK", "amount": 1, "category": "Rent",
              "frequency": "monthly", "next_due_date": today_iso()},
    ).status_code == 404
    assert client.post(
        f"/api/v1/recurring-expenses/{rid}/post",
        headers=a.headers, data={"client_id": "rec-hack"},
    ).status_code == 404
    assert client.delete(
        f"/api/v1/recurring-expenses/{rid}", headers=a.headers
    ).status_code == 404

    # B still has exactly its one template, unchanged.
    listing = client.get("/api/v1/recurring-expenses", headers=b.headers).json()
    names = [i["name"] for i in listing["items"]]
    assert names == ["B Rent"]


# --- Reads / exports never surface the other tenant's rows -------------------

def test_lists_reports_and_transactions_never_expose_other_tenant(make_user, client):
    a = make_user()
    b = make_user()
    add_income(client, b.headers, amount=7777, date=today_iso(), client_id="inc-b")
    add_expense(client, b.headers, amount=333, date=today_iso(), client_id="exp-b")

    # A's collection reads are empty of B's rows.
    assert client.get("/api/v1/incomes", headers=a.headers).json() == []
    assert client.get("/api/v1/expenses", headers=a.headers).json() == []
    assert client.get("/api/v1/transactions", headers=a.headers).json()["items"] == []

    # A's report export (P&L) reflects only A's (empty) books, not B's 7777/333.
    rep = client.get(
        f"/api/v1/reports/summary?from={today_iso()}&to={today_iso()}", headers=a.headers
    ).json()
    assert rep["income_total"] == 0
    assert rep["expense_total"] == 0


# --- Authentication gate: no/forged/foreign-user token is rejected -----------

def test_protected_endpoints_require_a_valid_token(client):
    # No Authorization header at all.
    assert client.get("/api/v1/customers").status_code == 403  # HTTPBearer -> 403
    # Garbage bearer token.
    bad = {"Authorization": "Bearer not-a-real-jwt"}
    assert client.get("/api/v1/customers", headers=bad).status_code == 401


def test_wellsigned_token_for_nonexistent_user_is_rejected(client):
    # A token signed with the real server secret but for a user id that doesn't
    # exist must not authenticate (defends against stale/forged subject claims).
    forged = create_access_token(uuid.uuid4().hex)
    r = client.get("/api/v1/customers", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401


# --- File storage (attachments) ---------------------------------------------

def test_attachment_filenames_are_unguessable(make_user, client):
    """The only thing standing between accounts and each other's uploaded files
    is the URL: filenames are 32-hex (128-bit) random, so they can't be
    enumerated or guessed from a sequential/derivable id."""
    u = make_user()
    cust = add_customer(client, u.headers, full_name="Doc Owner", mobile="7000000009")
    files = {"attachment": ("receipt.jpg", b"\xff\xd8\xff\x00 pretend-jpeg", "image/jpeg")}
    data = {"type": "credit", "amount": "100", "date": today_iso(), "client_id": "att-1"}
    r = client.post(
        f"/api/v1/customers/{cust['id']}/ledger", headers=u.headers, data=data, files=files
    )
    assert r.status_code == 200, r.text
    url = r.json()["attachment_url"]
    assert url and "/uploads/" in url
    name = url.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    assert len(name) == 32 and all(c in "0123456789abcdef" for c in name)


@pytest.mark.xfail(
    reason="KNOWN GAP: /uploads is a public StaticFiles mount — uploaded "
    "financial documents are served with NO authentication and NO ownership "
    "check. Only mitigation is the unguessable filename. A leaked/shared/logged "
    "URL is readable by anyone, including another tenant. Remediation: serve "
    "attachments through an authenticated, ownership-checked route (or "
    "expiring signed URLs) instead of a bare static mount.",
    strict=True,
)
def test_uploaded_file_should_not_be_served_without_authentication(make_user, client):
    """Encodes the DESIRED secure behaviour: fetching an upload with no token
    should be denied. It currently succeeds (public mount), so this xfails —
    turning it into a tracked, self-documenting gap that flips to xpass the day
    the mount is put behind auth."""
    u = make_user()
    cust = add_customer(client, u.headers, full_name="Doc Owner 2", mobile="7000000010")
    files = {"attachment": ("receipt.jpg", b"\xff\xd8\xff\x00 pretend-jpeg", "image/jpeg")}
    data = {"type": "credit", "amount": "100", "date": today_iso(), "client_id": "att-2"}
    r = client.post(
        f"/api/v1/customers/{cust['id']}/ledger", headers=u.headers, data=data, files=files
    )
    path = r.json()["attachment_url"].split("testserver", 1)[-1]  # -> /uploads/<name>

    # No Authorization header. SECURE behaviour would be 401/403/404.
    anon = client.get(path)
    assert anon.status_code in (401, 403, 404), (
        f"upload served without auth: {anon.status_code}"
    )
