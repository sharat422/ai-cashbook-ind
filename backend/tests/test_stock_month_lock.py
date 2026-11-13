"""S8: the month-end count reminder and the month lock. Locking covers stock
only: a stock entry dated in a locked month is refused; sales and payments
(the ledger) stay open. Unlocking is the owner's and is audit-logged."""

from sqlalchemy import select

from app.database import SessionLocal
from app.models import AccessLog
from helpers import add_customer
from test_stock import API, _item, _team


def _status(client, headers, day):
    r = client.get(f"{API}/stock/month-status", headers=headers, params={"date": day})
    assert r.status_code == 200, r.text
    return r.json()


def _count(client, headers, item, day, counted="5"):
    return client.post(f"{API}/stock/counts", headers=headers, json={
        "location": "godown", "date": day, "lines": [{"itemId": item, "counted": counted}]})


def _sale(client, headers, item, day):
    return client.post(f"{API}/stock/moves", headers=headers, json={
        "kind": "sale", "itemId": item, "quantity": 1, "location": "godown", "date": day})


def test_the_reminder_shows_on_the_last_three_days_until_the_month_is_counted(make_user, client):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers, opening=5)
    assert _status(client, owner.headers, "2026-10-28")["reminderDue"] is False  # 4 days before the end
    for day in ("2026-10-29", "2026-10-30", "2026-10-31"):
        assert _status(client, owner.headers, day)["reminderDue"] is True
    assert _status(client, owner.headers, "2026-02-26")["reminderDue"] is True   # a short month
    # Counting alone isn't confirming: the card stays until the month is locked.
    assert _count(client, owner.headers, item, "2026-10-30").status_code == 200
    s = _status(client, owner.headers, "2026-10-30")
    assert (s["counted"], s["reminderDue"]) == (True, True)
    lock = client.post(f"{API}/stock/months/2026-10/lock", headers=owner.headers)
    assert lock.status_code == 200, lock.text
    assert _status(client, owner.headers, "2026-10-31")["reminderDue"] is False  # gone
    # A month with no count can't be confirmed.
    assert client.post(f"{API}/stock/months/2026-09/lock", headers=owner.headers).status_code == 422


def test_a_locked_month_refuses_stock_entries_and_the_open_month_takes_them(make_user, client):
    owner, _ = _team(make_user, client)
    item = _item(client, owner.headers, opening=20)
    _count(client, owner.headers, item, "2026-10-31", counted="20")
    client.post(f"{API}/stock/months/2026-10/lock", headers=owner.headers)
    late = _sale(client, owner.headers, item, "2026-10-15")
    assert late.status_code == 422 and late.json()["detail"] == "Month locked — add it to the open month."
    assert _count(client, owner.headers, item, "2026-10-31", counted="19").status_code == 422  # counted again
    assert _sale(client, owner.headers, item, "2026-11-01").status_code == 200  # the open month
    # Only stock is locked: a credit sale dated in the locked month still saves.
    cid = add_customer(client, owner.headers)["id"]
    r = client.post(f"{API}/customers/{cid}/ledger", headers=owner.headers, data={
        "type": "credit", "amount": "100", "date": "2026-10-20", "client_id": "ledger-oct"})
    assert r.status_code == 200, r.text


def test_unlocking_is_the_owners_and_is_logged(make_user, client):
    owner, [(_sid, staff)] = _team(make_user, client, "staff")
    item = _item(client, owner.headers, opening=5)
    _count(client, owner.headers, item, "2026-10-31")
    client.post(f"{API}/stock/months/2026-10/lock", headers=owner.headers)
    assert client.post(f"{API}/stock/months/2026-10/unlock", headers=staff).status_code == 403
    r = client.post(f"{API}/stock/months/2026-10/unlock", headers=owner.headers)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["locked"] is False and s["unlockedAt"] and s["unlockedBy"]["userId"]
    with SessionLocal() as db:
        [log] = db.scalars(select(AccessLog).where(AccessLog.action == "unlock",
                                                   AccessLog.path.contains("2026-10"),
                                                   AccessLog.business_id == owner.business["id"])).all()
        assert log.mobile == owner.mobile
    assert _sale(client, owner.headers, item, "2026-10-15").status_code == 200  # open again
    status = _status(client, owner.headers, "2026-10-31")
    assert status["unlockedBy"]["userId"] == s["unlockedBy"]["userId"]  # the lock screen shows who and when
