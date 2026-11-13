"""AC2: invite an accountant by email as well as by mobile. The same invite
and the same membership; only the delivery differs. The email's link is signed,
works once for 7 days, holds only the invite id, and a re-send replaces it."""

import re
from datetime import datetime, timedelta, timezone

import pytest

from conftest import _login
from helpers import add_customer
from app.database import SessionLocal
from app.models import TeamInvite
from test_beats import _team

API = "/api/v1"


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr("app.mailer.send_email", lambda to, subject, body: sent.append((to, subject, body)))
    return sent


def _link(mail) -> str:
    return re.search(r"(https?://\S+/invite/\S+)", mail[2]).group(1)


def _token(link: str) -> str:
    return link.rsplit("/invite/", 1)[1]


def _invite(client, owner, email="ca.sharma@example.com", role="accountant"):
    r = client.post(f"{API}/team/invites/email", headers=owner.headers, json={"email": email, "role": role})
    assert r.status_code == 200, r.text
    return r.json()


def _accept(client, headers, token):
    return client.post(f"{API}/team/invites/accept", headers=headers, json={"token": token})


def test_an_email_invite_gives_the_same_membership_as_a_phone_invite(make_user, client, outbox):
    owner = make_user(business_name="Sri Lakshmi Agencies")
    biz = owner.business["id"]
    add_customer(client, owner.headers, full_name="Ramesh Kirana")
    # By phone, as before.
    assert client.post(f"{API}/team", headers=owner.headers,
                       json={"mobile": "7944000001", "role": "accountant"}).status_code == 200
    by_phone = _login(client, "7944000001")
    # By email: the CA logs in with their own mobile, then opens the link in the app.
    sent = _invite(client, owner)
    assert sent["status"] == "pending" and sent["channel"] == "email"
    assert outbox[0][0] == "ca.sharma@example.com" and "Sri Lakshmi Agencies" in outbox[0][1]
    by_email = _login(client, "7944000002")
    r = _accept(client, by_email, _token(_link(outbox[0])))
    assert r.status_code == 200 and r.json() == {"businessId": biz, "businessName": "Sri Lakshmi Agencies",
                                                 "role": "accountant"}
    # The same membership: same role and status on the team, same reads, same read-only refusal.
    team = {m["mobile"]: (m["role"], m["status"]) for m in client.get(f"{API}/team", headers=owner.headers).json()}
    assert team["7944000001"] == team["7944000002"] == ("accountant", "active")
    for headers in (by_phone, by_email):
        h = {**headers, "X-Business-Id": biz}
        assert [c["full_name"] for c in client.get(f"{API}/customers", headers=h).json()["items"]] == ["Ramesh Kirana"]
        w = client.post(f"{API}/customers", headers=h, json={"full_name": "X"})
        assert w.status_code == 403 and w.json()["code"] == "accountant_read_only"
    # The invite log: channel, who sent it, when, and the outcome.
    log = client.get(f"{API}/team/invites", headers=owner.headers).json()
    assert [(i["channel"], i["status"]) for i in log] == [("email", "accepted"), ("phone", "accepted")]
    assert all(i["sentBy"].startswith("owner · ") and i["sentAt"] for i in log)
    # One use.
    assert _accept(client, by_email, _token(_link(outbox[0]))).json()["code"] == "invite_used"


def test_an_expired_link_is_refused_and_lists_as_expired(make_user, client, outbox):
    owner = make_user()
    sent = _invite(client, owner)
    with SessionLocal() as db:  # 8 days later
        inv = db.get(TeamInvite, sent["id"])
        inv.expires_at = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        db.commit()
    # The token carried the old expiry, so it no longer matches; a fresh token for the old row would be refused too.
    r = _accept(client, _login(client, "7944000003"), _token(_link(outbox[0])))
    assert r.status_code in (404, 410)
    from app.routers.team import _invite_token
    with SessionLocal() as db:
        late = _invite_token(db.get(TeamInvite, sent["id"]))
    r = _accept(client, _login(client, "7944000003"), late)
    assert r.status_code == 410 and r.json()["code"] == "invite_expired"
    assert client.get(f"{API}/team/invites", headers=owner.headers).json()[0]["status"] == "expired"


def test_re_sending_makes_a_new_link_and_the_old_one_stops_working(make_user, client, outbox):
    owner = make_user()
    first = _invite(client, owner)
    again = client.post(f"{API}/team/invites/{first['id']}/resend", headers=owner.headers)
    assert again.status_code == 200 and again.json()["id"] != first["id"]
    ca = _login(client, "7944000004")
    old = _accept(client, ca, _token(_link(outbox[0])))
    assert old.status_code == 410 and old.json()["code"] == "invite_replaced"
    assert _accept(client, ca, _token(_link(outbox[1]))).status_code == 200
    statuses = {i["id"]: i["status"] for i in client.get(f"{API}/team/invites", headers=owner.headers).json()}
    assert statuses == {first["id"]: "replaced", again.json()["id"]: "accepted"}


def test_the_link_holds_no_business_data(make_user, client, outbox):
    owner = make_user(business_name="Sri Lakshmi Agencies")
    sent = _invite(client, owner)
    link = _link(outbox[0])
    for secret in (owner.business["id"], "Sri Lakshmi", "Lakshmi", owner.mobile, "ca.sharma", "example.com"):
        assert secret not in link, secret
    invite_id, exp, mac = _token(link).split(".")
    assert invite_id == sent["id"] and exp.isdigit() and re.fullmatch(r"[0-9a-f]{32}", mac)
    # The page it opens names no business either, and offers the app.
    page = client.get(f"/invite/{_token(link)}")
    assert page.status_code == 200 and "Sri Lakshmi" not in page.text and "bolcash://invite/" in page.text
    # A forged token is refused.
    assert _accept(client, _login(client, "7944000005"), f"{invite_id}.{exp}.{'0' * 32}").json()["code"] == \
        "invite_invalid"


def test_owner_only_and_the_owner_cannot_demote_themselves_by_opening_the_link(make_user, client, outbox):
    owner, [(_, staff), (_, accountant)] = _team(make_user, client, "staff", "accountant")
    for headers in (staff, accountant):
        r = client.post(f"{API}/team/invites/email", headers=headers, json={"email": "a@b.co", "role": "accountant"})
        assert r.status_code == 403
    _invite(client, owner)
    r = _accept(client, owner.headers, _token(_link(outbox[0])))
    assert r.status_code == 409 and r.json()["code"] == "invite_already_member"
    me = [m for m in client.get(f"{API}/team", headers=owner.headers).json() if m["is_self"]][0]
    assert me["role"] == "owner"


def test_without_email_set_up_nothing_is_saved(make_user, client):
    owner = make_user()
    r = client.post(f"{API}/team/invites/email", headers=owner.headers, json={"email": "a@b.co", "role": "accountant"})
    assert r.status_code == 503 and r.json()["code"] == "email_unavailable"
    assert client.get(f"{API}/team/invites", headers=owner.headers).json() == []
    bad = client.post(f"{API}/team/invites/email", headers=owner.headers, json={"email": "not-an-email", "role": "staff"})
    assert bad.status_code == 422 and bad.json()["code"] == "email_invalid"
