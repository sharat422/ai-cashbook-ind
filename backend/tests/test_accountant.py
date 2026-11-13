"""Accountant read-only access: views and exports only, scoped to the
businesses the owner assigned, revocable at once, every view/export logged."""

from datetime import datetime, timedelta

from fastapi.routing import APIRoute

from conftest import _login, days_ago_iso, today_iso
from helpers import add_customer, add_ledger
from app.main import app

API = "/api/v1"

# Self-service calls that touch only the accountant's own login/account, never
# the business's books. Everything else that writes must refuse them.
SELF_SERVICE = {
    ("POST", "/api/v1/auth/otp/request"), ("POST", "/api/v1/auth/otp/verify"),
    ("POST", "/api/v1/businesses"),  # starting their OWN business
    ("POST", "/api/v1/team/invites/accept"),  # joining ANOTHER business from an email invite (AC2)
    ("POST", "/api/v1/feedback"), ("PUT", "/api/v1/consents"),
    ("DELETE", "/api/v1/account"), ("DELETE", "/api/v1/chatbot/history"),
    # Ask AI only reads (all its tools are get_/search_); it logs the user's own question.
    ("POST", "/api/v1/chatbot/ask"), ("POST", "/api/v1/chatbot/feedback"),
    # Checking purchases against an uploaded GSTR-2B returns a sheet and saves nothing.
    ("POST", "/api/v1/reports/itc-review.xlsx"),
}


def _invite(client, owner, mobile, role="accountant"):
    r = client.post(f"{API}/team", headers=owner.headers, json={"mobile": mobile, "role": role})
    assert r.status_code == 200, r.text
    return r.json()["user_id"]


def _books(client, owner):
    cid = add_customer(client, owner.headers, full_name="Ramesh Kirana")["id"]
    entry = add_ledger(client, owner.headers, cid, type="credit", amount=1500, date=days_ago_iso(3),
                       client_id="c1", invoice_number="INV-1")
    return cid, entry["id"]


def _as(headers, business_id=None):
    return {**headers, **({"X-Business-Id": business_id} if business_id else {})}


def test_accountant_cannot_write_anything_via_the_api(make_user, client):
    owner = make_user()
    cid, entry_id = _books(client, owner)
    _invite(client, owner, "7311000001")
    acc = _login(client, "7311000001")

    allowed = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith(API):
            continue
        for method in route.methods & {"POST", "PUT", "PATCH", "DELETE"}:
            if (method, route.path) in SELF_SERVICE:
                continue
            path = route.path
            for name in route.param_convertors:
                path = path.replace("{%s}" % name, cid if "customer" in name else entry_id)
            r = client.request(method, path, headers=acc, json={})
            if r.status_code != 403:
                allowed.append((method, route.path, r.status_code))
    assert allowed == []

    # The books are exactly as the owner left them.
    ledger = client.get(f"{API}/customers/{cid}/ledger", headers=owner.headers).json()
    assert [(e["id"], e["amount"]) for e in ledger] == [(entry_id, 1500)]


def test_a_refused_accountant_write_names_the_change_not_a_bare_403(make_user, client):
    """AC1: accountants could add entries before this release. The refusal says
    what changed and what to do, with a code the app shows in the user's language."""
    owner = make_user()
    cid, _ = _books(client, owner)
    _invite(client, owner, "7311000009")
    acc = _login(client, "7311000009")
    r = client.post(f"{API}/customers/{cid}/ledger", headers=acc, data={
        "type": "payment", "amount": "100", "date": today_iso(), "client_id": "from-before-the-update",
        "payment_method": "cash"})
    body = r.json()
    assert r.status_code == 403 and body["code"] == "accountant_read_only"
    assert body["detail"] == "Accountants are read-only now — ask the owner to change your role."


def test_accountant_reads_ledgers_ageing_daily_close_gst_and_tally(make_user, client):
    owner = make_user()
    cid, _ = _books(client, owner)
    _invite(client, owner, "7311000002")
    acc = _login(client, "7311000002")
    period = f"from={days_ago_iso(30)}&to={today_iso()}"
    for path in (f"/customers/{cid}/ledger", "/customer-aging", f"/daily-close?date={today_iso()}",
                 f"/reports/gst-summary?{period}", f"/reports/gstr1.xlsx?{period}",
                 f"/reports/tally-export.csv?{period}", "/account/export.xlsx"):
        assert client.get(f"{API}{path}", headers=acc).status_code == 200, path
    me = client.get(f"{API}/businesses/me", headers=acc).json()
    assert me["role"] == "accountant"


def test_accountant_of_a_cannot_see_b(make_user, client):
    a, b, c = make_user(business_name="A Traders"), make_user(business_name="B Traders"), make_user(business_name="C Traders")
    _books(client, a)
    b_cid, _ = _books(client, b)
    _invite(client, a, "7311000003")
    _invite(client, c, "7311000003")  # the same CA also serves C
    acc = _login(client, "7311000003")

    mine = client.get(f"{API}/me/businesses", headers=acc).json()
    assert {x["businessName"] for x in mine} == {"A Traders", "C Traders"}
    b_id = b.business["id"]
    for path in ("/customers", "/dashboard/summary", f"/customers/{b_cid}/ledger", "/businesses/me"):
        assert client.get(f"{API}{path}", headers=_as(acc, b_id)).status_code == 403, path
    # In A's context, B's customer is simply not there.
    assert client.get(f"{API}/customers/{b_cid}/ledger", headers=_as(acc, a.business["id"])).status_code == 404
    names = [x["full_name"] for x in client.get(f"{API}/customers", headers=_as(acc, c.business["id"])).json()["items"]]
    assert "Ramesh Kirana" not in names  # C has no customers; A's and B's never leak
    assert client.get(f"{API}/businesses/me", headers=_as(acc, c.business["id"])).json()["businessName"] == "C Traders"


def test_revoked_accountant_is_refused_on_the_next_call(make_user, client):
    owner = make_user()
    cid, _ = _books(client, owner)
    uid = _invite(client, owner, "7311000004")
    acc = _login(client, "7311000004")  # token stays valid; access must not
    ctx = _as(acc, owner.business["id"])
    assert client.get(f"{API}/customers/{cid}/ledger", headers=ctx).status_code == 200

    assert client.delete(f"{API}/team/{uid}", headers=owner.headers).status_code == 204
    for headers in (ctx, acc):  # with or without the business header
        r = client.get(f"{API}/customers/{cid}/ledger", headers=headers)
        assert r.status_code == 403 and r.headers["x-bolcash-access"] == "revoked"
    assert client.get(f"{API}/reports/tally-export.csv?from={days_ago_iso(9)}&to={today_iso()}",
                      headers=ctx).status_code == 403
    assert uid not in [m["user_id"] for m in client.get(f"{API}/team", headers=owner.headers).json()]

    _invite(client, owner, "7311000004")  # invited again → access again
    assert client.get(f"{API}/customers/{cid}/ledger", headers=ctx).status_code == 200


def test_owner_sees_what_the_accountant_viewed_and_exported_in_ist(make_user, client):
    owner = make_user()
    cid, _ = _books(client, owner)
    uid = _invite(client, owner, "7311000005")
    acc = _as(_login(client, "7311000005"), owner.business["id"])
    client.get(f"{API}/businesses/me", headers=acc)  # housekeeping: not logged
    client.get(f"{API}/customers/{cid}/ledger", headers=acc)
    client.get(f"{API}/reports/tally-export.csv?from={days_ago_iso(9)}&to={today_iso()}", headers=acc)
    client.delete(f"{API}/customers/{cid}", headers=acc)  # refused, and logged
    client.get(f"{API}/customer-aging", headers=owner.headers)  # owner: not logged

    assert client.get(f"{API}/team/activity", headers=acc).status_code == 403
    log = client.get(f"{API}/team/activity?user_id={uid}", headers=owner.headers).json()
    assert [(e["action"], e["area"], e["customer"]) for e in log] == [
        ("denied", "other", None),  # tried to open this very log
        ("denied", "customers", "Ramesh Kirana"),
        ("export", "reports", None),
        ("view", "ledger", "Ramesh Kirana"),
    ]
    assert all(e["mobile"] == "7311000005" for e in log)
    first = log[-1]
    ist = datetime.fromisoformat(first["at"]) + timedelta(hours=5, minutes=30)
    assert first["atIst"] == ist.strftime("%d %b %Y, %I:%M %p IST")
