"""Restore a deleted beat: same shops, order, visits and closes; owner only."""

from sqlalchemy import select

from conftest import today_iso
from helpers import add_customer
from app.database import SessionLocal
from app.models import AccessLog
from test_beats import _beat, _team, _visit

API = "/api/v1"


def _restore(client, headers, beat_id):
    return client.put(f"{API}/beats/{beat_id}/restore", headers=headers)


def test_restore_brings_back_shops_order_visits_and_close(make_user, client):
    owner, [(s_id, staff)] = _team(make_user, client, "staff")
    shops = [add_customer(client, owner.headers, full_name=f"Shop {n}")["id"] for n in "DBCA"]
    beat = _beat(client, owner, "Market Road", user_id=s_id, customers=shops)
    _visit(client, staff, beat["id"], shops[2], "v1")
    r = client.post(f"{API}/customers/{shops[0]}/ledger", headers=staff, data={
        "type": "payment", "amount": "250", "date": today_iso(), "client_id": "p1",
        "payment_method": "cash", "beat_id": beat["id"]})
    assert r.status_code == 200, r.text

    assert client.delete(f"{API}/beats/{beat['id']}", headers=owner.headers).status_code == 204
    deleted = client.get(f"{API}/beats", headers=owner.headers, params={"deleted": "true"}).json()
    assert [b["id"] for b in deleted] == [beat["id"]]
    assert client.get(f"{API}/beats/today", headers=staff).json() == []

    r = _restore(client, owner.headers, beat["id"])
    assert r.status_code == 200, r.text
    assert [x["customer_id"] for x in r.json()["retailers"]] == shops
    assert r.json()["assigned_user_id"] == s_id and not r.json()["deleted"]
    assert [b["id"] for b in client.get(f"{API}/beats/today", headers=staff).json()] == [beat["id"]]
    assert client.get(f"{API}/beats", headers=owner.headers, params={"deleted": "true"}).json() == []
    history = client.get(f"{API}/visits", headers=owner.headers, params={"beatId": beat["id"]}).json()
    assert [v["client_id"] for v in history] == ["v1"]
    close = client.get(f"{API}/daily-close", headers=owner.headers, params={"beat_id": beat["id"]})
    assert close.status_code == 200 and close.json()["creditCollected"] == "250.00"
    with SessionLocal() as db:
        logs = db.scalars(select(AccessLog).where(AccessLog.path.contains(beat["id"]))).all()
        assert [(log.action, log.mobile, log.created_at[:10] > "2000") for log in logs] == [
            ("restore", owner.mobile, True)]
    # The owner's restore isn't shown as accountant activity.
    assert client.get(f"{API}/team/activity", headers=owner.headers).json() == []


def test_restoring_a_beat_whose_salesperson_left_needs_a_new_one(make_user, client):
    owner, [(a_id, a), (b_id, b)] = _team(make_user, client, "staff", "staff")
    shop = add_customer(client, owner.headers, full_name="Kirana")["id"]
    beat = _beat(client, owner, "Old Town", user_id=a_id, customers=[shop])
    client.post(f"{API}/beats/{beat['id']}/assignments", headers=owner.headers,
                json={"userId": b_id, "role": "secondary"})
    client.delete(f"{API}/beats/{beat['id']}", headers=owner.headers)
    assert client.delete(f"{API}/team/{a_id}", headers=owner.headers).status_code == 204

    r = _restore(client, owner.headers, beat["id"]).json()
    assert r["assigned_user_id"] is None and r["assignments"] == []
    assert [x["id"] for x in client.get(f"{API}/beats", headers=owner.headers).json()] == [beat["id"]]
    assert client.get(f"{API}/beats/today", headers=b).json() == []  # not even the helper
    assert client.get(f"{API}/beats/{beat['id']}", headers=b).status_code == 403

    picked = client.put(f"{API}/beats/{beat['id']}", headers=owner.headers, json={
        "name": "Old Town", "weekdays": list(range(7)), "assignedUserId": b_id})
    assert picked.status_code == 200, picked.text
    assert [x["id"] for x in client.get(f"{API}/beats/today", headers=b).json()] == [beat["id"]]


def test_only_the_owner_restores_and_a_live_beat_is_a_no_op(make_user, client):
    owner, [(s_id, staff), (_acc_id, accountant)] = _team(make_user, client, "staff", "accountant")
    beat = _beat(client, owner, "Ring Road", user_id=s_id)
    r = _restore(client, owner.headers, beat["id"])  # never deleted
    assert r.status_code == 200 and r.json()["assigned_user_id"] == s_id
    client.delete(f"{API}/beats/{beat['id']}", headers=owner.headers)
    assert _restore(client, staff, beat["id"]).status_code == 403
    assert _restore(client, accountant, beat["id"]).status_code == 403
    assert client.get(f"{API}/beats", headers=staff, params={"deleted": "true"}).status_code == 403
    assert _restore(client, owner.headers, "nope").status_code == 404
    with SessionLocal() as db:
        assert [log.action for log in db.scalars(select(AccessLog).where(
            AccessLog.path.contains(beat["id"]))).all()] == ["denied"]  # the accountant's try
