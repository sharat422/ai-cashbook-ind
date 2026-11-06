"""Beat plan + beat-isolated staff view."""

from datetime import datetime, timedelta

from conftest import _login, days_ago_iso, today_iso
from helpers import add_customer, add_ledger
from app.calc import IST
from app.database import SessionLocal
from app.models import Visit

ALL_DAYS = list(range(7))


def _team(make_user, client, *roles):
    owner = make_user()
    members = []
    for i, role in enumerate(roles):
        mobile = "7" + str(abs(hash((owner.mobile, role, i))) % 10**9).zfill(9)
        r = client.post("/api/v1/team", headers=owner.headers, json={"mobile": mobile, "role": role})
        assert r.status_code == 200, r.text
        members.append((r.json()["user_id"], _login(client, mobile)))
    return owner, members


def _beat(client, owner, name, *, user_id=None, customers=(), weekdays=ALL_DAYS):
    r = client.post("/api/v1/beats", headers=owner.headers, json={
        "name": name, "weekdays": weekdays, "assignedUserId": user_id, "customerIds": list(customers)})
    assert r.status_code == 200, r.text
    return r.json()


def _visit(client, headers, beat_id, customer_id, client_id, **extra):
    return client.post("/api/v1/visits", headers=headers, json={
        "clientId": client_id, "beatId": beat_id, "customerId": customer_id,
        "outcome": "visited_no_order", **extra})


# --- 1. Staff isolation ------------------------------------------------------

def test_staff_sees_only_their_beat_and_gets_403_on_anyone_elses(make_user, client):
    owner, [(a_id, staff_a), (b_id, staff_b)] = _team(make_user, client, "staff", "staff")
    shop = add_customer(client, owner.headers, full_name="Gupta Stores")
    beat_a = _beat(client, owner, "North", user_id=a_id, customers=[shop["id"]])
    beat_b = _beat(client, owner, "South", user_id=b_id, customers=[shop["id"]])

    today = client.get("/api/v1/beats/today", headers=staff_a).json()
    assert [b["id"] for b in today] == [beat_a["id"]]
    assert [b["id"] for b in client.get("/api/v1/beats", headers=staff_a).json()] == [beat_a["id"]]

    # Another staff member's beat, by ID, on every route: 403.
    assert client.get(f"/api/v1/beats/{beat_b['id']}", headers=staff_a).status_code == 403
    assert _visit(client, staff_a, beat_b["id"], shop["id"], "a-1").status_code == 403
    assert client.put(f"/api/v1/beats/{beat_b['id']}/retailers/order", headers=staff_a,
                      json={"customerIds": []}).status_code == 403
    # Staff can't plan beats, even their own.
    assert client.post("/api/v1/beats", headers=staff_a, json={"name": "X", "weekdays": [0]}).status_code == 403
    assert client.put(f"/api/v1/beats/{beat_a['id']}/retailers/order", headers=staff_a,
                      json={"customerIds": []}).status_code == 403
    # Their own beat works.
    assert client.get(f"/api/v1/beats/{beat_a['id']}", headers=staff_a).status_code == 200
    assert _visit(client, staff_a, beat_a["id"], shop["id"], "a-2").status_code == 200

    # Owner sees both.
    assert {b["id"] for b in client.get("/api/v1/beats/today", headers=owner.headers).json()} == {
        beat_a["id"], beat_b["id"]}


def test_staff_with_no_beat_today_gets_an_empty_list(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    not_today = [d for d in ALL_DAYS if d != datetime.now(IST).weekday()]
    _beat(client, owner, "Other days", user_id=a_id, weekdays=not_today)
    assert client.get("/api/v1/beats/today", headers=staff_a).json() == []


def test_another_business_beat_is_not_found(make_user, client):
    owner = make_user()
    stranger = make_user()
    beat = _beat(client, owner, "Mine")
    assert client.get(f"/api/v1/beats/{beat['id']}", headers=stranger.headers).status_code == 404
    other_shop = add_customer(client, stranger.headers)
    r = client.post("/api/v1/beats", headers=owner.headers,
                    json={"name": "Steal", "weekdays": [0], "customerIds": [other_shop["id"]]})
    assert r.status_code == 422


# --- 2. Reordering is per beat ----------------------------------------------

def test_reordering_changes_only_that_beat(make_user, client):
    owner = make_user()
    c1, c2, c3 = (add_customer(client, owner.headers, full_name=n)["id"] for n in ("A", "B", "C"))
    one = _beat(client, owner, "One", customers=[c1, c2, c3])
    two = _beat(client, owner, "Two", customers=[c1, c2, c3])

    r = client.put(f"/api/v1/beats/{one['id']}/retailers/order", headers=owner.headers,
                   json={"customerIds": [c3, c1, c2]})
    assert r.status_code == 200, r.text
    order = lambda b: [x["customer_id"] for x in client.get(  # noqa: E731
        f"/api/v1/beats/{b['id']}", headers=owner.headers).json()["retailers"]]
    assert order(one) == [c3, c1, c2]
    assert order(two) == [c1, c2, c3]

    dup = client.put(f"/api/v1/beats/{one['id']}/retailers/order", headers=owner.headers,
                     json={"customerIds": [c1, c1]})
    assert dup.status_code == 422


# --- 3. Offline visit syncs exactly once --------------------------------------

def test_a_retried_offline_visit_is_saved_once(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    shop = add_customer(client, owner.headers)
    beat = _beat(client, owner, "North", user_id=a_id, customers=[shop["id"]])
    two_hours_ago = (datetime.now(IST) - timedelta(hours=2)).astimezone().isoformat()

    first = _visit(client, staff_a, beat["id"], shop["id"], "offline-1", visitedAt=two_hours_ago)
    again = _visit(client, staff_a, beat["id"], shop["id"], "offline-1", visitedAt=two_hours_ago)
    assert first.status_code == again.status_code == 200
    assert first.json()["id"] == again.json()["id"]
    assert first.json()["visited_at"].endswith("+05:30")
    with SessionLocal() as db:
        assert db.query(Visit).filter(Visit.client_id == "offline-1").count() == 1


def test_visit_validation(make_user, client):
    owner = make_user()
    shop, elsewhere = add_customer(client, owner.headers), add_customer(client, owner.headers)
    beat = _beat(client, owner, "North", customers=[shop["id"]])
    assert _visit(client, owner.headers, beat["id"], shop["id"], "v1", outcome="maybe").status_code == 422
    assert _visit(client, owner.headers, beat["id"], elsewhere["id"], "v2").status_code == 422
    tomorrow = (datetime.now(IST) + timedelta(days=1)).isoformat()
    assert _visit(client, owner.headers, beat["id"], shop["id"], "v3", visitedAt=tomorrow).status_code == 422
    assert _visit(client, owner.headers, beat["id"], shop["id"], "v4",
                  promiseDate=days_ago_iso(3)).status_code == 422
    assert _visit(client, owner.headers, beat["id"], shop["id"], "v5", reason="x" * 281).status_code == 422


# --- Day-list figures ----------------------------------------------------------

def test_day_list_shows_balance_overdue_limit_and_promise(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    shop = add_customer(client, owner.headers, full_name="Gupta Stores")
    add_ledger(client, owner.headers, shop["id"], type="credit", amount=1000, date=days_ago_iso(45), client_id="c1")
    add_ledger(client, owner.headers, shop["id"], type="credit", amount=500, date=today_iso(), client_id="c2")
    add_ledger(client, owner.headers, shop["id"], type="payment", amount=300, date=today_iso(), client_id="p1")
    r = client.put(f"/api/v1/customers/{shop['id']}/credit-limit", headers=owner.headers,
                   json={"creditLimit": 5000})
    assert r.status_code == 200 and r.json()["credit_limit"] == 5000
    beat = _beat(client, owner, "North", user_id=a_id, customers=[shop["id"]])
    promise = (datetime.now(IST).date() + timedelta(days=7)).isoformat()
    assert _visit(client, staff_a, beat["id"], shop["id"], "pv", promiseDate=promise).status_code == 200

    [row] = client.get("/api/v1/beats/today", headers=staff_a).json()[0]["retailers"]
    assert row["outstanding_amount"] == 1200
    assert row["overdue_amount"] == 700  # 1000 old credit − 300 paid (oldest first)
    assert row["credit_limit"] == 5000
    assert row["last_promise_date"] == promise
    assert row["today_visit"]["outcome"] == "visited_no_order"

    cleared = client.put(f"/api/v1/customers/{shop['id']}/credit-limit", headers=owner.headers,
                         json={"creditLimit": None})
    assert cleared.json()["credit_limit"] is None
    # Staff can't change limits.
    assert client.put(f"/api/v1/customers/{shop['id']}/credit-limit", headers=staff_a,
                      json={"creditLimit": 1}).status_code == 403
