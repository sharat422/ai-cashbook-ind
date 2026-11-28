"""Payment reminders: the owner's rules say who needs chasing (a promise coming
due, or dues overdue by N days); the scheduled job sends the opted-in ones their
WhatsApp statement by itself; every reminder, automatic or sent by hand, is in
one history that any phone in the business sees."""

from datetime import date, datetime, time, timedelta

import pytest

from app import statement_send as sending
from app.calc import IST, today_iso
from app.config import settings
from conftest import days_ago_iso
from helpers import add_customer, add_ledger
from test_beats import _beat, _team, _visit

API = "/api/v1"


@pytest.fixture
def server(client, monkeypatch):
    """WhatsApp as the statement sends use it (an approved template), at 10 a.m. today."""
    monkeypatch.setattr(settings, "whatsapp_statement_template", "statement_ready")
    monkeypatch.setattr(settings, "cron_secret", "cr0n")
    monkeypatch.setattr(sending, "template_status", lambda name: "APPROVED")
    clock = {"now": datetime.combine(date.fromisoformat(today_iso()), time(10, 0), IST)}
    monkeypatch.setattr(sending, "ist_now", lambda: clock["now"])
    sent = []

    def send(to, name, params):
        sent.append((to, name, params))
        return {"messages": [{"id": f"wamid.{to}.{len(sent)}"}]}
    monkeypatch.setattr(sending, "send_whatsapp_template", send)
    cron = lambda: client.post(f"{API}/cron/reminders", headers={"X-Cron-Secret": "cr0n"})  # noqa: E731
    return sent, cron, clock


def _shop(client, owner, name, mobile, *, opted_in=True, days_old=33, amount=5000):
    cid = add_customer(client, owner.headers, full_name=name, mobile=mobile)["id"]
    add_ledger(client, owner.headers, cid, type="credit", amount=amount, date=days_ago_iso(days_old),
               client_id=f"c-{cid}")
    if opted_in:
        assert client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers,
                           json={"status": "opted_in", "confirm": True}).status_code == 200
    return cid


def _rules(client, owner, **over):
    body = {"enabled": True, "beforePromiseDays": 1, "overdueDays": 3, "repeatDays": 7, "beatId": None, **over}
    r = client.put(f"{API}/reminders/rules", headers=owner.headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _due(client, headers, beat_id=None):
    r = client.get(f"{API}/reminders/due", headers=headers, params={"beatId": beat_id} if beat_id else {})
    assert r.status_code == 200, r.text
    return r.json()


def _history(client, headers, cid):
    r = client.get(f"{API}/reminders", headers=headers, params={"customerId": cid})
    assert r.status_code == 200, r.text
    return r.json()


def test_overdue_by_three_days_is_reminded_on_schedule_and_every_phone_sees_it(make_user, client, server):
    sent, cron, _ = server
    owner, [(a, ravi), (b, sita)] = _team(make_user, client, "staff", "staff")
    client.patch(f"{API}/team/{a}", headers=owner.headers, json={"name": "Ravi"})
    shop = _shop(client, owner, "Gupta Stores", "9811100001")
    fresh = _shop(client, owner, "New Shop", "9811100002", days_old=32)  # 2 days past due: not yet
    beat = _beat(client, owner, "North", user_id=a, customers=[shop, fresh])
    client.post(f"{API}/beats/{beat['id']}/helpers", headers=owner.headers, json={"userId": b})
    _rules(client, owner)

    due = _due(client, ravi, beat["id"])
    assert due["auto"] is True
    assert [(d["fullName"], d["reason"], d["daysOverdue"], d["optedIn"]) for d in due["items"]] == [
        ("Gupta Stores", "overdue", 3, True)]

    assert cron().status_code == 200  # nobody tapped anything
    assert [(to, name) for to, name, _ in sent] == [("9811100001", "statement_ready")]
    for phone in (ravi, sita, owner.headers):  # the same history on every phone
        [ev] = _history(client, phone, shop)
        assert (ev["channel"], ev["reason"], ev["status"], ev["automatic"]) == ("whatsapp_server", "overdue", "sent", True)
    assert _due(client, ravi, beat["id"])["items"] == []  # chased: not again for 7 days
    cron()
    assert len(sent) == 1  # a repeated run sends nothing twice

    # A reminder sent by hand is in the same history, with who sent it.
    r = client.post(f"{API}/reminders", headers=ravi, json={
        "customerId": shop, "channel": "whatsapp", "message": "Hi Gupta ji, ₹5,000 is pending."})
    assert r.status_code == 200, r.text
    first, second = _history(client, sita, shop)
    assert (first["reason"], first["channel"], first["automatic"], first["sentByName"]) == (
        "manual", "whatsapp", False, "Ravi")
    assert first["message"] == "Hi Gupta ji, ₹5,000 is pending." and second["automatic"] is True


def test_not_opted_in_stays_on_the_list_to_send_by_hand(make_user, client, server):
    sent, cron, _ = server
    owner = make_user()
    shop = _shop(client, owner, "No Consent", "9811100003", opted_in=False, days_old=40)
    _rules(client, owner)
    cron()
    assert sent == [] and _history(client, owner.headers, shop) == []
    [d] = _due(client, owner.headers)["items"]
    assert (d["customerId"], d["optedIn"], d["mobile"]) == (shop, False, "9811100003")


def test_a_promise_coming_due_is_reminded_once_and_not_outside_9_to_8(make_user, client, server):
    sent, cron, clock = server
    owner, [(a, ravi)] = _team(make_user, client, "staff")
    shop = _shop(client, owner, "Promised", "9811100004", days_old=5)  # not overdue
    beat = _beat(client, owner, "North", user_id=a, customers=[shop])
    tomorrow = (date.fromisoformat(today_iso()) + timedelta(days=1)).isoformat()
    assert _visit(client, ravi, beat["id"], shop, "v1", promiseDate=tomorrow, promiseAmount=3000).status_code == 200
    _rules(client, owner, overdueDays=None)
    [d] = _due(client, ravi, beat["id"])["items"]
    assert (d["reason"], d["promiseDate"], d["promiseAmount"]) == ("promise", tomorrow, 3000)

    clock["now"] = clock["now"].replace(hour=21)  # 9 p.m.: nothing goes
    cron()
    assert sent == []
    clock["now"] = clock["now"].replace(hour=11)
    cron()
    assert len(sent) == 1 and _due(client, ravi, beat["id"])["items"] == []


def test_rules_are_the_owners_and_staff_see_only_their_beats(make_user, client, server):
    owner, [(a, ravi), (b, sita)] = _team(make_user, client, "staff", "staff")
    north = _shop(client, owner, "North Shop", "9811100005")
    south = _shop(client, owner, "South Shop", "9811100006")
    _beat(client, owner, "North", user_id=a, customers=[north])
    _beat(client, owner, "South", user_id=b, customers=[south])
    assert client.put(f"{API}/reminders/rules", headers=ravi, json={"enabled": True}).status_code == 403
    assert client.get(f"{API}/reminders/rules", headers=owner.headers).json()["enabled"] is False  # off until saved
    _rules(client, owner, enabled=False)
    assert [d["fullName"] for d in _due(client, ravi)["items"]] == ["North Shop"]
    assert client.get(f"{API}/reminders", headers=ravi, params={"customerId": south}).status_code == 403
    assert client.post(f"{API}/reminders", headers=ravi, json={
        "customerId": south, "channel": "sms", "message": "x"}).status_code == 403
    assert client.post(f"{API}/cron/reminders", headers={"X-Cron-Secret": "nope"}).status_code == 403
