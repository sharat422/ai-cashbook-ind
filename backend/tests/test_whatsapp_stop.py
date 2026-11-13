"""ST2: a retailer who replies STOP (or band karo / mat bhejo / unsubscribe /
stop please) to a server-sent statement is opted out for that distributor,
logged with their words, and sent nothing back. Other replies are logged and
left alone. Each Meta message id is acted on once; unsigned requests: 403."""

import uuid

import pytest

from app import notifications
from app.config import settings
from app.database import SessionLocal
from app.models import StatementEvent
from app import statement_send as sending
from app.routers import statements as route
from test_statement_template import _hook
from test_statements import API, _shop

URL = f"{API}/whatsapp/inbound"


@pytest.fixture
def statement_sent(make_user, client, monkeypatch):
    """Ravi Stores (98765 43210) opted in and got a server-sent statement (wamid.S1)."""
    monkeypatch.setattr(settings, "whatsapp_app_secret", "s3cret")
    monkeypatch.setattr(settings, "whatsapp_statement_template", "statement_ready")
    monkeypatch.setattr(sending, "template_status", lambda name: "APPROVED")
    sends = []  # Meta's message ids are unique, so the tests' are too (the test DB is shared)
    monkeypatch.setattr(sending, "send_whatsapp_template",
                        lambda to, name, params: sends.append(_id()) or {"messages": [{"id": sends[-1]}]})

    def no_free_text(*a, **k):
        raise AssertionError("nothing may be sent back")
    monkeypatch.setattr(notifications, "send_whatsapp_text", no_free_text)
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 2)])
    client.patch(f"{API}/customers/{cid}", headers=owner.headers, json={"full_name": "Ravi Stores", "mobile": "9876543210"})
    assert client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers,
                       json={"status": "opted_in", "confirm": True}).status_code == 200
    assert _send(client, owner, cid).json()["status"] == "sent"
    return owner, cid, sends


def _id() -> str:
    return f"wamid.{uuid.uuid4().hex}"


def _send(client, owner, cid):
    return client.post(f"{API}/customers/{cid}/statement-whatsapp", headers=owner.headers, json={"via": "server"})


def _reply(client, text, mid, sender="919876543210", context=None):
    msg = {"from": sender, "id": mid, "type": "text", "text": {"body": text}}
    if context:
        msg["context"] = {"id": context}
    r = _hook(client, {"entry": [{"changes": [{"value": {"messages": [msg]}}]}]}, secret="s3cret")
    assert r.status_code == 200, r.text
    return r


def _consent(client, owner, cid):
    return client.get(f"{API}/customers/{cid}/statement-consent", headers=owner.headers).json()["status"]


def _events(cid, kind):
    with SessionLocal() as db:
        return [(e.source, e.channel, e.note, e.message_id) for e in db.query(StatementEvent)
                .filter_by(customer_id=cid, kind=kind)]


def test_stop_opts_the_retailer_out_logs_it_and_the_next_send_is_refused(statement_sent, client):
    owner, cid, sends = statement_sent
    mid = _id()
    _reply(client, "  STOP ", mid, context=sends[0])
    assert _consent(client, owner, cid) == "opted_out"
    assert _events(cid, "opt_out") == [("retailer", "whatsapp_reply", 'Replied "STOP" on WhatsApp', mid)]
    r = _send(client, owner, cid)
    assert r.status_code == 409 and len(sends) == 1  # refused; nothing more went out
    assert any(note == "No WhatsApp opt-in from this retailer" for _, _, note, _ in _events(cid, "blocked"))


@pytest.mark.parametrize("words", ["band karo", "Mat Bhejo", "unsubscribe", "Stop please", "stop."])
def test_the_other_stop_words_opt_out_too(statement_sent, client, words):
    owner, cid, _ = statement_sent
    _reply(client, words, _id())  # no reply context: the latest statement to that number
    assert _consent(client, owner, cid) == "opted_out"


@pytest.mark.parametrize("words", ["thanks", "stop sending me the old balance, it is wrong", "ok"])
def test_any_other_reply_is_logged_and_changes_nothing(statement_sent, client, words):
    owner, cid, sends = statement_sent
    mid = _id()
    _reply(client, words, mid)
    assert _consent(client, owner, cid) == "opted_in"
    assert _events(cid, "inbound") == [("retailer", "whatsapp_reply", words, mid)]
    assert _send(client, owner, cid).json()["status"] == "sent" and len(sends) == 2  # and no auto-answer


def test_the_same_message_id_twice_is_one_opt_out(statement_sent, client):
    owner, cid, _ = statement_sent
    mid = _id()
    for _ in range(3):  # Meta retries
        _reply(client, "STOP", mid)
    assert len(_events(cid, "opt_out")) == 1


def test_a_reply_from_a_number_we_never_messaged_changes_nothing(statement_sent, client):
    owner, cid, _ = statement_sent
    _reply(client, "STOP", _id(), sender="919000000001")
    assert _consent(client, owner, cid) == "opted_in"


def test_an_unverified_request_gets_403_and_changes_nothing(statement_sent, client, caplog):
    owner, cid, _ = statement_sent
    body = {"entry": [{"changes": [{"value": {"messages": [
        {"from": "919876543210", "id": "wamid.F1", "type": "text", "text": {"body": "STOP"}}]}}]}]}
    assert _hook(client, body, secret="forged").status_code == 403
    assert client.post(URL, json=body).status_code == 403  # no signature at all
    assert _consent(client, owner, cid) == "opted_in"
    assert "unverified request" in caplog.text
