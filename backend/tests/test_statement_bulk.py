"""ST7: bulk statement sends — to opted-in retailers only (the rest skipped
and counted), with the approved template, at most one WhatsApp message per
retailer per day, only 9 a.m.–8 p.m. IST, and a batch that stops above 10%
failures with the reason. Every outcome is in the statement log. A monthly
schedule runs the same send once a month."""

from datetime import datetime

import pytest

from app import statement_send as sending
from app.calc import IST
from app.config import settings
from app.database import SessionLocal
from app.models import StatementEvent
from app.notifications import WhatsAppSendError
from helpers import add_customer
from test_statements import API

TEN_AM = datetime(2026, 11, 11, 10, 0, tzinfo=IST)


@pytest.fixture
def server_sends(monkeypatch):
    monkeypatch.setattr(settings, "whatsapp_statement_template", "statement_ready")
    monkeypatch.setattr(sending, "template_status", lambda name: "APPROVED")
    monkeypatch.setattr(sending, "ist_now", lambda: TEN_AM)
    sent = []

    def send(to, name, params):
        if to in send.fail_for:
            raise WhatsAppSendError("x", code=131026, reason="Message undeliverable")
        sent.append((to, name, params))
        return {"messages": [{"id": f"wamid.{to}.{len(sent)}"}]}
    send.fail_for = set()
    monkeypatch.setattr(sending, "send_whatsapp_template", send)
    return sent, send


def _retailers(client, owner, n, status, tag):
    ids = []
    for i in range(n):
        cid = add_customer(client, owner.headers, full_name=f"{tag} {i:02}",
                           mobile=f"9{abs(hash((owner.mobile, tag, i))) % 10**9:09d}")["id"]
        r = client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers,
                        json={"status": status, "confirm": status == "opted_in"})
        assert r.status_code == 200
        ids.append(cid)
    return ids


def _outcomes(cids):
    with SessionLocal() as db:
        return [(e.customer_id, e.kind, e.note) for e in db.query(StatementEvent)
                .filter(StatementEvent.customer_id.in_(cids), StatementEvent.note.like("Bulk send%"))]


def _bulk(client, owner, **body):
    return client.post(f"{API}/statements/bulk", headers=owner.headers, json=body)


def test_ten_opted_in_and_two_opted_out_sends_ten_skips_two_and_logs_twelve(make_user, client, server_sends):
    sent, _ = server_sends
    owner = make_user()
    yes = _retailers(client, owner, 10, "opted_in", "In")
    no = _retailers(client, owner, 2, "opted_out", "Out")
    preview = client.get(f"{API}/statements/bulk/preview", headers=owner.headers).json()
    assert (preview["optedIn"], preview["notOptedIn"], preview["willSend"], preview["inWindow"]) == (10, 2, 10, True)

    r = _bulk(client, owner)
    assert r.status_code == 200, r.text
    assert {k: r.json()[k] for k in ("sent", "notOptedIn", "alreadyToday", "failed", "stopped")} == \
        {"sent": 10, "notOptedIn": 2, "alreadyToday": 0, "failed": 0, "stopped": None}
    assert len(sent) == 10 and {name for _, name, _ in sent} == {"statement_ready"}  # the template only
    log = _outcomes(yes + no)
    assert len(log) == 12 and len({cid for cid, *_ in log}) == 12  # one outcome per retailer
    assert sorted(k for _, k, _ in log) == ["blocked"] * 2 + ["sent"] * 10
    assert all("no WhatsApp opt-in" in note for cid, k, note in log if k == "blocked")


def test_a_second_bulk_send_the_same_day_is_refused_by_the_cap(make_user, client, server_sends):
    sent, _ = server_sends
    owner = make_user()
    cids = _retailers(client, owner, 3, "opted_in", "Shop")
    assert _bulk(client, owner).json()["sent"] == 3
    again = _bulk(client, owner).json()
    assert (again["sent"], again["alreadyToday"]) == (0, 3) and len(sent) == 3
    capped = [n for _, k, n in _outcomes(cids) if k == "blocked"]
    assert len(capped) == 3 and all("already got a WhatsApp message today (1 a day)" in n for n in capped)


def test_a_batch_with_over_ten_percent_failures_stops_and_says_why(make_user, client, server_sends):
    sent, send = server_sends
    owner = make_user()
    cids = _retailers(client, owner, 20, "opted_in", "Bad")
    with SessionLocal() as db:
        from app.models import Customer
        send.fail_for = {db.get(Customer, c).mobile for c in cids[::2]}  # every other number fails
    r = _bulk(client, owner).json()
    assert r["stopped"].startswith("Stopped: 5 of 10 sends failed (over 10%)")
    assert "131026" in r["stopped"] and "Message undeliverable" in r["stopped"]
    assert (r["sent"], r["failed"], r["notTried"]) == (5, 5, 10)
    assert len(_outcomes(cids)) == 10  # the 10 not tried have no outcome: nothing was done to them


def test_outside_9_to_8_ist_or_without_an_approved_template_nothing_is_sent(make_user, client, server_sends,
                                                                           monkeypatch):
    sent, _ = server_sends
    owner = make_user()
    _retailers(client, owner, 2, "opted_in", "Late")
    monkeypatch.setattr(sending, "ist_now", lambda: datetime(2026, 11, 11, 20, 0, tzinfo=IST))
    r = _bulk(client, owner)
    assert r.status_code == 422 and "9 a.m. and 8 p.m. IST" in r.json()["detail"]
    monkeypatch.setattr(sending, "ist_now", lambda: TEN_AM)
    monkeypatch.setattr(sending, "template_status", lambda name: "PENDING")
    r = _bulk(client, owner)
    assert r.status_code == 409 and "PENDING" in r.json()["detail"] and sent == []


def test_the_monthly_schedule_runs_once_a_month_and_turns_off_in_one_call(make_user, client, server_sends,
                                                                         monkeypatch):
    sent, _ = server_sends
    owner = make_user()
    _retailers(client, owner, 2, "opted_in", "Month")
    r = client.put(f"{API}/statements/schedule", headers=owner.headers, json={"enabled": True, "day": 1, "hour": 10})
    assert r.status_code == 200 and r.json()["enabled"] is True
    monkeypatch.setattr(settings, "cron_secret", "cr0n")
    cron = lambda: client.post(f"{API}/cron/statement-schedules", headers={"X-Cron-Secret": "cr0n"})  # noqa: E731

    def at(day, hour):
        moment = datetime(2026, 12, day, hour, 30, tzinfo=IST)
        monkeypatch.setattr(sending, "ist_now", lambda: moment)
    at(1, 9)
    assert not [x for x in cron().json()["ran"] if x["businessId"] == owner.business["id"]]  # before 10 a.m.
    at(1, 10)
    mine = [x for x in cron().json()["ran"] if x["businessId"] == owner.business["id"]]
    assert len(mine) == 1 and mine[0]["sent"] == 2
    at(1, 11)
    assert not [x for x in cron().json()["ran"] if x["businessId"] == owner.business["id"]]  # once a month
    shown = client.get(f"{API}/statements/schedule", headers=owner.headers).json()
    assert shown["lastRunMonth"] == "2026-12" and shown["lastResult"]["sent"] == 2
    off = client.put(f"{API}/statements/schedule", headers=owner.headers, json={"enabled": False})
    assert off.json()["enabled"] is False
    assert client.post(f"{API}/cron/statement-schedules", headers={"X-Cron-Secret": "nope"}).status_code == 403


def test_only_the_owner_sends_in_bulk_or_sets_the_schedule(make_user, client, server_sends):
    from test_stock import _team
    owner, [(_, staff)] = _team(make_user, client, "staff")
    assert _bulk(client, type("U", (), {"headers": staff})).status_code == 403
    assert client.put(f"{API}/statements/schedule", headers=staff, json={"enabled": True}).status_code == 403
