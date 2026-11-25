"""Closing a beat's day: figures worked out by the server, counted cash and
difference stored, one close per beat per day, the day's entries locked until
the owner reopens it — and another beat's day untouched."""

import pytest

from conftest import today_iso
from helpers import add_customer, add_ledger
from app.database import SessionLocal
from app.errors import AppError
from app.models import LedgerEntry
from test_beats import _beat, _team

API = "/api/v1"


def _entry(client, headers, cid, client_id, beat_id, **extra):
    return client.post(f"{API}/customers/{cid}/ledger", headers=headers, data={
        "date": today_iso(), "client_id": client_id, "beat_id": beat_id, **{k: str(v) for k, v in extra.items()}})


def _close(client, headers, beat_id, counted):
    return client.post(f"{API}/daily-close", headers=headers,
                       json={"beat_id": beat_id, "date": today_iso(), "cash_counted": counted})


def test_close_a_beat_day_lock_it_and_reopen(make_user, client):
    owner, [(a_id, staff_a), (b_id, staff_b)] = _team(make_user, client, "staff", "staff")
    shop = add_customer(client, owner.headers, full_name="Gupta Stores")
    other = add_customer(client, owner.headers, full_name="Rao Kirana")
    north = _beat(client, owner, "North", user_id=a_id, customers=[shop["id"]])
    south = _beat(client, owner, "South", user_id=b_id, customers=[other["id"]])
    n = north["id"]
    day = today_iso()

    # One day on North: cash, UPI, a credit, and a bank collection.
    add_ledger(client, staff_a, shop["id"], type="payment", amount=1000, date=day, client_id="dc-1",
               payment_method="cash", beat_id=n)
    add_ledger(client, staff_a, shop["id"], type="payment", amount=500.5, date=day, client_id="dc-2",
               payment_method="upi", reference_number="412300000901", beat_id=n)
    add_ledger(client, staff_a, shop["id"], type="credit", amount=2000, date=day, client_id="dc-3", beat_id=n)
    bank = add_ledger(client, staff_a, shop["id"], type="payment", amount=300, date=day, client_id="dc-4",
                      payment_method="bank", reference_number="NEFT0001", beat_id=n)

    figures = client.get(f"{API}/daily-close", headers=staff_a, params={"beat_id": n, "date": day}).json()
    assert (figures["cashInHand"], figures["upiClaimed"], figures["creditGiven"], figures["creditCollected"]) == (
        "1000.00", "500.50", "2000.00", "1800.50")
    assert figures["close"] is None

    # Staff close their own beat: the server's figures, counted 950 -> 50 short.
    closed = _close(client, staff_a, n, "950")
    assert closed.status_code == 200, closed.text
    c = closed.json()["close"]
    assert (c["status"], c["cashExpected"], c["cashCounted"], c["difference"]) == ("closed", "1000.00", "950.00", "-50.00")
    assert (c["upiTotal"], c["creditGiven"], c["creditCollected"]) == ("500.50", "2000.00", "1800.50")
    assert c["closedBy"] == a_id and c["closedAt"]

    # Once per beat per day.
    again = _close(client, owner.headers, n, "1000")
    assert again.status_code == 400 and again.json()["code"] == "day_already_closed"

    # Locked: no new entry, no delete, for North that day.
    r = _entry(client, staff_a, shop["id"], "dc-5", n, type="payment", amount=10, payment_method="cash")
    assert r.status_code == 400 and r.json()["code"] == "day_closed"
    assert r.json()["params"] == {"beat": "North", "date": day}
    with SessionLocal() as s, pytest.raises(AppError):  # any path, not only the routes: a change…
        s.get(LedgerEntry, bank["id"]).amount = 301
        s.commit()
    with SessionLocal() as s, pytest.raises(AppError):  # …or a delete
        s.delete(s.get(LedgerEntry, bank["id"]))
        s.commit()
    with SessionLocal() as s:  # a note isn't a figure: still fixable on a closed day
        s.get(LedgerEntry, bank["id"]).notes = "cheque cleared"
        s.commit()

    # Another beat, and entries with no beat, aren't affected.
    assert _entry(client, staff_b, other["id"], "dc-6", south["id"], type="payment", amount=20,
                  payment_method="cash").status_code == 200
    assert _entry(client, owner.headers, shop["id"], "dc-7", "", type="credit", amount=5).status_code == 200
    assert client.get(f"{API}/daily-close", headers=owner.headers,
                      params={"beat_id": south["id"], "date": day}).json()["close"] is None
    # Staff see only their own beat's close.
    assert client.get(f"{API}/daily-close", headers=staff_b, params={"beat_id": n, "date": day}).status_code == 403
    assert _close(client, staff_b, n, "1").status_code == 403

    # Only the owner reopens; then entries go in again, and closing again updates the same close.
    assert client.post(f"{API}/daily-close/{c['id']}/reopen", headers=staff_a).status_code == 403
    reopened = client.post(f"{API}/daily-close/{c['id']}/reopen", headers=owner.headers)
    assert reopened.status_code == 200 and reopened.json()["status"] == "open"
    assert _entry(client, staff_a, shop["id"], "dc-8", n, type="payment", amount=50,
                  payment_method="cash").status_code == 200
    second = _close(client, owner.headers, n, "1050").json()["close"]
    assert (second["id"], second["cashExpected"], second["difference"]) == (c["id"], "1050.00", "0.00")
