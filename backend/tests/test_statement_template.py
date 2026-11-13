"""ST1: server-sent statements use only Meta's approved UTILITY template, with
its four variables — never free text. Not approved (or re-categorised as
marketing): the server send is refused, logged, and the owner's-phone fallback
is offered. A refusal — at send time or later on the webhook (131026) — is
logged with its reason."""

import hashlib
import hmac
import inspect
import json

import pytest

from app import notifications
from app.config import settings
from app.database import SessionLocal
from app.models import StatementEvent
from app import statement_send as sending
from app.routers import statements as route
from test_statements import API, _shop

TEMPLATE = "statement_ready"


@pytest.fixture
def opted_in(make_user, client, monkeypatch):
    monkeypatch.setattr(settings, "whatsapp_statement_template", TEMPLATE)
    owner = make_user(business_name="Sri Lakshmi Agencies")
    cid = _shop(client, owner, "Ravi Stores", [("credit", 1500, 3)])
    r = client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers,
                    json={"status": "opted_in", "confirm": True})
    assert r.status_code == 200
    return owner, cid


def _share(client, owner, cid):
    return client.post(f"{API}/customers/{cid}/statement-whatsapp", headers=owner.headers, json={"via": "server"})


def _events(cid):
    with SessionLocal() as db:
        return [(e.kind, e.channel, e.note, e.message_id) for e in db.query(StatementEvent)
                .filter_by(customer_id=cid).order_by(StatementEvent.created_at, StatementEvent.id)]


class _FakeHttp:
    """Stands in for httpx.Client: records what would go to Meta."""
    calls: list = []
    reply: dict = {}
    code = 200

    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def _resp(self):
        body, code = _FakeHttp.reply, _FakeHttp.code
        return type("R", (), {"status_code": code, "json": lambda self: body, "text": json.dumps(body)})()

    def post(self, url, json=None, headers=None):
        _FakeHttp.calls.append(("POST", url, json))
        return self._resp()

    def get(self, url, params=None, headers=None):
        _FakeHttp.calls.append(("GET", url, params))
        return self._resp()


def test_a_server_send_is_the_approved_template_with_four_variables_only(opted_in, client, monkeypatch):
    owner, cid = opted_in
    monkeypatch.setattr(sending, "template_status", lambda name: "APPROVED")
    monkeypatch.setattr(settings, "whatsapp_access_token", "t")
    monkeypatch.setattr(settings, "whatsapp_phone_number_id", "123")
    monkeypatch.setattr(notifications.httpx, "Client", _FakeHttp)
    _FakeHttp.calls, _FakeHttp.code = [], 200
    _FakeHttp.reply = {"messages": [{"id": "wamid.ABC", "message_status": "accepted"}]}

    r = _share(client, owner, cid)
    assert r.status_code == 200 and r.json()["status"] == "sent" and r.json()["template"] == TEMPLATE
    [(_, url, payload)] = _FakeHttp.calls
    assert url.endswith("/123/messages") and payload["type"] == "template" and "text" not in payload
    tpl = payload["template"]
    assert tpl["name"] == TEMPLATE and tpl["language"] == {"code": "en"}
    params = [p["text"] for p in tpl["components"][0]["parameters"]]
    assert params[:3] == ["Ravi Stores", "Sri Lakshmi Agencies", "1,500.00"] and "/s/" in params[3]
    assert ("sent", "whatsapp_server", f"Template {TEMPLATE}: accepted", "wamid.ABC") in _events(cid)
    # No free-form server text anywhere on this path.
    assert "send_whatsapp_text" not in inspect.getsource(route)  # the free-text sender isn't on the path
    assert "send_whatsapp_text" not in inspect.getsource(sending)


@pytest.mark.parametrize("meta", [
    [],  # not submitted / not found
    [{"name": TEMPLATE, "status": "PENDING", "category": "UTILITY", "language": "en"}],
    [{"name": TEMPLATE, "status": "REJECTED", "category": "UTILITY", "language": "en"}],
    [{"name": TEMPLATE, "status": "APPROVED", "category": "MARKETING", "language": "en"}],  # re-categorised
])
def test_without_an_approved_utility_template_the_server_send_is_refused_and_the_phone_is_offered(
        opted_in, client, monkeypatch, meta):
    owner, cid = opted_in
    monkeypatch.setattr(settings, "whatsapp_access_token", "t")
    monkeypatch.setattr(settings, "whatsapp_phone_number_id", "123")
    monkeypatch.setattr(settings, "whatsapp_business_account_id", "waba")
    monkeypatch.setattr(notifications, "_template_cache", {})
    monkeypatch.setattr(notifications.httpx, "Client", _FakeHttp)
    _FakeHttp.calls, _FakeHttp.code, _FakeHttp.reply = [], 200, {"data": meta}

    r = _share(client, owner, cid)
    body = r.json()
    assert r.status_code == 200 and body["status"] == "ready" and body["fallback"] is True
    assert body["message"] and body["mobile"]  # what the app opens on the owner's phone
    assert all(method == "GET" for method, *_ in _FakeHttp.calls)  # nothing was sent
    kinds = [(k, ch) for k, ch, _, _ in _events(cid)]
    assert ("blocked", "whatsapp_server") in kinds and ("sent", "whatsapp_phone") in kinds
    assert "Server send off" in body["reason"]


def test_with_no_template_set_nothing_asks_meta_and_the_phone_is_offered(opted_in, client, monkeypatch):
    owner, cid = opted_in
    monkeypatch.setattr(settings, "whatsapp_statement_template", "")
    r = _share(client, owner, cid).json()
    assert r["fallback"] is True and "NOT_SET" in r["reason"]


def test_a_refused_send_is_logged_with_its_reason(opted_in, client, monkeypatch):
    owner, cid = opted_in
    monkeypatch.setattr(sending, "template_status", lambda name: "APPROVED")

    def refuse(to, name, params):
        raise notifications.WhatsAppSendError("x", code=131026, reason="Message undeliverable")
    monkeypatch.setattr(sending, "send_whatsapp_template", refuse)
    r = _share(client, owner, cid).json()
    assert r["fallback"] is True and r["reason"] == "WhatsApp refused (131026): Message undeliverable"
    assert ("blocked", "whatsapp_server", "WhatsApp refused (131026): Message undeliverable", None) in _events(cid)


def _hook(client, payload, secret="s3cret"):
    raw = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return client.post("/api/v1/whatsapp/inbound", content=raw,
                       headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"})


def test_delivery_statuses_from_meta_are_logged_and_a_failure_keeps_its_reason(opted_in, client, monkeypatch):
    owner, cid = opted_in
    monkeypatch.setattr(settings, "whatsapp_app_secret", "s3cret")
    monkeypatch.setattr(sending, "template_status", lambda name: "APPROVED")
    ids = iter(["wamid.OK", "wamid.FAIL"])
    monkeypatch.setattr(sending, "send_whatsapp_template", lambda to, name, params: {"messages": [{"id": next(ids)}]})
    _share(client, owner, cid)
    _share(client, owner, cid)

    def status(mid, st, **extra):
        return {"entry": [{"changes": [{"value": {"statuses": [{"id": mid, "status": st, **extra}]}}]}]}
    failed = status("wamid.FAIL", "failed", errors=[{"code": 131026, "title": "Message undeliverable",
                                                     "error_data": {"details": "Receiver is incapable of receiving this message"}}])
    for payload in (status("wamid.OK", "delivered"), failed, failed):  # Meta retries: logged once
        assert _hook(client, payload).status_code == 200
    ev = _events(cid)
    assert [e for e in ev if e[0] == "delivered"][0][3] == "wamid.OK"
    refusals = [e for e in ev if e[0] == "blocked" and e[3] == "wamid.FAIL"]
    assert len(refusals) == 1
    assert refusals[0][2] == "WhatsApp refused (131026): Receiver is incapable of receiving this message"
    # Unsigned or wrongly signed: refused, nothing logged.
    assert _hook(client, status("wamid.OK", "delivered"), secret="wrong").status_code == 403
    assert client.get("/api/v1/whatsapp/inbound", params={"hub.mode": "subscribe", "hub.verify_token": "x",
                                                    "hub.challenge": "1"}).status_code == 403
