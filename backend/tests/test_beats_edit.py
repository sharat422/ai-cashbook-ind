"""Editing and (soft-)deleting a beat, and the visit history."""

from datetime import datetime

from conftest import today_iso
from helpers import add_customer
from app.calc import IST
from test_beats import ALL_DAYS, _beat, _team, _visit

API = "/api/v1"


def test_owner_edits_name_days_and_salesperson(make_user, client):
    owner, [(a_id, staff_a), (b_id, staff_b), (_acc_id, acc)] = _team(make_user, client, "staff", "staff", "accountant")
    shop = add_customer(client, owner.headers, full_name="Gupta Stores")
    beat = _beat(client, owner, "North", user_id=a_id, customers=[shop["id"]])
    path = f"{API}/beats/{beat['id']}"

    r = client.put(path, headers=owner.headers, json={"name": "North Market", "weekdays": [6, 0, 0],
                                                       "assignedUserId": b_id})
    assert r.status_code == 200, r.text
    edited = r.json()
    assert (edited["name"], edited["weekdays"], edited["assigned_user_id"]) == ("North Market", [0, 6], b_id)
    assert [x["customer_id"] for x in edited["retailers"]] == [shop["id"]]  # shops untouched
    # The new salesperson has it; the old one doesn't.
    assert client.get(path, headers=staff_b).status_code == 200
    assert client.get(path, headers=staff_a).status_code == 403

    assert client.put(path, headers=owner.headers, json={"name": "X", "weekdays": [9]}).status_code == 422
    assert client.put(path, headers=owner.headers,
                      json={"name": "X", "weekdays": [1], "assignedUserId": "stranger"}).status_code == 422
    for who in (staff_b, acc):
        assert client.put(path, headers=who, json={"name": "Mine", "weekdays": [1]}).status_code == 403
        assert client.delete(path, headers=who).status_code == 403


def test_deleted_beat_leaves_the_lists_but_keeps_its_history(make_user, client):
    owner, [(a_id, staff_a)] = _team(make_user, client, "staff")
    shop = add_customer(client, owner.headers, full_name="Sri Ram Kirana")
    beat = _beat(client, owner, "Station Road", user_id=a_id, customers=[shop["id"]])
    keep = _beat(client, owner, "Market", user_id=a_id, customers=[shop["id"]])
    assert _visit(client, staff_a, beat["id"], shop["id"], "v1").status_code == 200
    client.post(f"{API}/customers/{shop['id']}/ledger", headers=staff_a, data={
        "type": "payment", "amount": "100", "date": today_iso(), "client_id": "p1", "payment_method": "cash",
        "beat_id": beat["id"]})

    assert client.delete(f"{API}/beats/{beat['id']}", headers=owner.headers).status_code == 204
    for who in (owner.headers, staff_a):
        assert [b["id"] for b in client.get(f"{API}/beats", headers=who).json()] == [keep["id"]]
        assert beat["id"] not in {b["id"] for b in client.get(f"{API}/beats/today", headers=who).json()}
    assert client.get(f"{API}/beats/{beat['id']}", headers=owner.headers).status_code == 404
    assert _visit(client, staff_a, beat["id"], shop["id"], "v2").status_code == 404  # no new visits
    assert client.delete(f"{API}/beats/{beat['id']}", headers=owner.headers).status_code == 404

    history = client.get(f"{API}/visits", headers=owner.headers, params={"customerId": shop["id"]}).json()
    assert [(v["beat_name"], v["customer_name"]) for v in history] == [("Station Road", "Sri Ram Kirana")]
    close = client.get(f"{API}/daily-close", headers=owner.headers,
                       params={"beat_id": beat["id"], "date": today_iso()})
    assert close.status_code == 200 and close.json()["creditCollected"] == "100.00"


def test_visit_history_filters_and_staff_see_only_their_own(make_user, client):
    owner, [(a_id, staff_a), (b_id, staff_b)] = _team(make_user, client, "staff", "staff")
    s1 = add_customer(client, owner.headers, full_name="Shop One")["id"]
    s2 = add_customer(client, owner.headers, full_name="Shop Two")["id"]
    beat_a = _beat(client, owner, "A beat", user_id=a_id, customers=[s1, s2])
    beat_b = _beat(client, owner, "B beat", user_id=b_id, customers=[s1])
    _visit(client, staff_a, beat_a["id"], s1, "a1")
    _visit(client, staff_a, beat_a["id"], s2, "a2", outcome="not_visited", reason="Shop closed")
    _visit(client, staff_b, beat_b["id"], s1, "b1")

    all_visits = client.get(f"{API}/visits", headers=owner.headers).json()
    assert len(all_visits) == 3 and all_visits[0]["visited_at"] >= all_visits[-1]["visited_at"]
    by_shop = client.get(f"{API}/visits", headers=owner.headers, params={"customerId": s1}).json()
    assert sorted(v["beat_name"] for v in by_shop) == ["A beat", "B beat"]
    by_staff = client.get(f"{API}/visits", headers=owner.headers, params={"userId": a_id}).json()
    assert {v["customer_name"] for v in by_staff} == {"Shop One", "Shop Two"}
    assert all(v["user_mobile"] for v in by_staff)

    # Staff asking for someone else's visits still get only their own.
    mine = client.get(f"{API}/visits", headers=staff_b, params={"userId": a_id}).json()
    assert [v["client_id"] for v in mine] == ["b1"]
    day = datetime.now(IST).date().isoformat()
    assert len(client.get(f"{API}/visits", headers=owner.headers, params={"from": day, "to": day}).json()) == 3
    assert client.get(f"{API}/visits", headers=owner.headers, params={"from": "2020-01-01", "to": "2020-01-02"}).json() == []
