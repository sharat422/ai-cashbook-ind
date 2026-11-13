"""ST4: the owner can revoke a statement link before its 30 days; it then says
"This link has been revoked" (not a 404) and its PDF is gone. Revoked stays
revoked (422; send a fresh link). Any opt-out revokes all the retailer's live
links for that distributor, and every revocation is logged."""

import html

from app.database import SessionLocal
from app.models import StatementEvent
from test_statements import API, _shop, _token

REVOKED = "This link has been revoked."


def _link(client, owner, cid):
    r = client.post(f"{API}/customers/{cid}/statement-link", headers=owner.headers, json={})
    assert r.status_code == 200, r.text
    return _token(r.json()["url"])


def _links(client, owner, cid):
    return client.get(f"{API}/customers/{cid}/statement-links", headers=owner.headers).json()


def _revoked_events(cid):
    with SessionLocal() as db:
        return [(e.source, e.note) for e in db.query(StatementEvent).filter_by(customer_id=cid, kind="link_revoked")]


def test_a_revoked_link_says_so_at_once_and_its_pdf_no_longer_opens(make_user, client):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    token, keep = _link(client, owner, cid), _link(client, owner, cid)
    assert client.get(f"/s/{token}").status_code == 200
    assert client.get(f"/s/{token}/statement.pdf").status_code == 200

    r = client.post(f"{API}/statements/{token}/revoke", headers=owner.headers)  # by the token from the URL
    assert r.status_code == 200 and r.json()["status"] == "revoked" and r.json()["revokedAt"]
    page = client.get(f"/s/{token}")
    assert page.status_code == 410 and REVOKED in html.unescape(page.text)  # a sentence, not a 404
    pdf = client.get(f"/s/{token}/statement.pdf")
    assert pdf.status_code == 410 and pdf.headers["content-type"].startswith("text/html")
    assert client.post(f"/s/{token}/opt-out").status_code == 410  # nothing works on it any more
    assert client.get(f"/s/{keep}").status_code == 200  # the other link is untouched
    assert _revoked_events(cid)[0][0] == "owner"
    # By id, as the app does.
    other = next(x for x in _links(client, owner, cid) if x["status"] == "live")
    assert client.post(f"{API}/statements/{other['id']}/revoke", headers=owner.headers).status_code == 200
    assert client.get(f"/s/{keep}").status_code == 410


def test_a_revoked_link_cannot_be_reactivated(make_user, client):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    token = _link(client, owner, cid)
    assert client.post(f"{API}/statements/{token}/revoke", headers=owner.headers).status_code == 200
    again = client.post(f"{API}/statements/{token}/revoke", headers=owner.headers)
    assert again.status_code == 422 and "fresh link" in again.json()["detail"]
    assert client.get(f"/s/{token}").status_code == 410  # still revoked
    # Opting back in doesn't bring it back either; a new link works.
    client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers,
                json={"status": "opted_in", "confirm": True})
    assert client.get(f"/s/{token}").status_code == 410
    assert client.get(f"/s/{_link(client, owner, cid)}").status_code == 200


def test_opting_out_revokes_all_live_links_for_that_retailer(make_user, client):
    owner = make_user()
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    other_shop = _shop(client, owner, "Lakshmi Kirana", [("credit", 90, 1)])
    a, b, theirs = _link(client, owner, cid), _link(client, owner, cid), _link(client, owner, other_shop)
    r = client.post(f"{API}/customers/{cid}/statement-consent", headers=owner.headers, json={"status": "opted_out"})
    assert r.status_code == 200
    assert client.get(f"/s/{a}").status_code == client.get(f"/s/{b}").status_code == 410
    assert client.get(f"/s/{theirs}").status_code == 200  # another retailer's link stays
    assert {x["status"] for x in _links(client, owner, cid)} == {"revoked"}
    assert _revoked_events(cid) == [("system", "2 live link(s) revoked: the retailer opted out")]
    # The retailer's own opt-out from a link does the same.
    c = _link(client, owner, other_shop)
    assert client.post(f"/s/{c}/opt-out").status_code == 200
    assert client.get(f"/s/{theirs}").status_code == client.get(f"/s/{c}").status_code == 410


def test_only_the_owner_revokes_and_only_their_own_links(make_user, client):
    from test_stock import _team
    owner, [(_, staff)] = _team(make_user, client, "staff")
    cid = _shop(client, owner, "Ravi Stores", [("credit", 500, 3)])
    token = _link(client, owner, cid)
    assert client.post(f"{API}/statements/{token}/revoke", headers=staff).status_code == 403
    stranger = make_user()
    assert client.post(f"{API}/statements/{token}/revoke", headers=stranger.headers).status_code == 404
    assert client.get(f"/s/{token}").status_code == 200
