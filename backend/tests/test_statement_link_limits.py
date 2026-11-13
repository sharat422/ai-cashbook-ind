"""ST8: rate limits on the public statement links — 60 requests a minute per
IP, 100 opens an hour per link; past them a plain 429, logged with IP, link
and time on that retailer's statement log. A rate, not a ban: the next window
works again, and a link's first open always goes through."""

import html
import logging

import pytest

from app import link_limits
from app.database import SessionLocal
from app.models import StatementEvent
from test_statements import API, _shop, _token


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(link_limits, "_clock", lambda: now[0])
    return now


def _link(client, owner, cid):
    url = client.post(f"{API}/customers/{cid}/statement-link", headers=owner.headers, json={}).json()["url"]
    return _token(url)


def _open(client, token, ip, path=""):
    return client.get(f"/s/{token}{path}", headers={"X-Forwarded-For": ip})


def _hits(cid):
    with SessionLocal() as db:
        return [(e.note, e.created_at) for e in db.query(StatementEvent).filter_by(customer_id=cid, kind="rate_limited")]


def test_the_61st_request_in_a_minute_from_one_ip_gets_429_and_another_ip_doesnt(make_user, client, clock):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    token = _link(client, owner, cid)
    codes = [_open(client, token, "1.1.1.1", "/statement.pdf" if i % 2 else "").status_code for i in range(61)]
    assert codes[:60] == [200] * 60 and codes[60] == 429
    r = _open(client, token, "1.1.1.1")
    assert r.status_code == 429 and "Too many requests — try again later" in html.unescape(r.text)
    assert r.headers["Retry-After"] == "60"
    assert _open(client, token, "2.2.2.2").status_code == 200   # a different IP is unaffected
    clock[0] += 61
    assert _open(client, token, "1.1.1.1").status_code == 200   # a rate, not a ban


def test_101_opens_of_one_link_in_an_hour_get_429_and_it_works_again_the_next_hour(make_user, client, clock):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    token = _link(client, owner, cid)
    codes = [_open(client, token, f"10.0.0.{i % 20}").status_code for i in range(101)]  # a group chat: many phones
    assert codes[:100] == [200] * 100 and codes[100] == 429
    other = _link(client, owner, cid)
    assert _open(client, other, "10.0.0.99").status_code == 200  # the other link has its own count
    clock[0] += 3601
    assert _open(client, token, "10.0.0.1").status_code == 200


def test_a_limit_hit_is_logged_with_ip_link_and_time_once_per_window(make_user, client, clock, caplog):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    token = _link(client, owner, cid)
    with caplog.at_level(logging.WARNING, logger="cashbook.whatsapp"):
        for _ in range(70):
            _open(client, token, "3.3.3.3")
    [(note, at)] = _hits(cid)  # 10 over the limit, one log line
    links = client.get(f"{API}/customers/{cid}/statement-links", headers=owner.headers).json()
    link_id = links[0]["id"]
    assert note == f"Too many requests (60 a minute from one IP) from IP 3.3.3.3 on link {link_id}" and at
    assert links[0]["limitedAt"] == at  # the owner sees it on the statement screen
    assert token not in note  # the token itself is never written down: it opens the statement
    assert sum("rate limit" in r.getMessage() and "3.3.3.3" in r.getMessage() for r in caplog.records) == 1


def test_the_limit_never_blocks_a_links_first_open(make_user, client, clock):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    busy, fresh = _link(client, owner, cid), _link(client, owner, cid)
    for _ in range(60):
        _open(client, busy, "4.4.4.4")  # this IP is now at its limit (a shop's shared Wi-Fi, say)
    assert _open(client, busy, "4.4.4.4").status_code == 429
    assert _open(client, fresh, "4.4.4.4").status_code == 200  # a first open still goes through
    assert _open(client, fresh, "4.4.4.4").status_code == 429  # after that, the rate applies
