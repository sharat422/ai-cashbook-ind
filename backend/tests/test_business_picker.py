"""AC3: after login, a CA with more than one business picks which to open. The
list is the server's active memberships only (business, owner, when they last
opened it): a revoked one is gone at once, and a business that never assigned
them never shows. With one business they go straight in (no header needed)."""

from conftest import _login

API = "/api/v1"


def _invite(client, owner, mobile):
    r = client.post(f"{API}/team", headers=owner.headers, json={"mobile": mobile, "role": "accountant"})
    assert r.status_code == 200, r.text
    return r.json()["user_id"]


def _picker(client, headers):
    r = client.get(f"{API}/me/businesses", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_ca_with_three_businesses_sees_all_three_and_opens_the_one_they_pick(make_user, client):
    owners = [make_user(business_name=f"{n} Traders") for n in ("Anil", "Balaji", "Chandra")]
    for o in owners:
        _invite(client, o, "7955000001")
    stranger = make_user(business_name="Never Assigned Agencies")  # never invited this CA
    ca = _login(client, "7955000001")

    picker = _picker(client, ca)
    assert [b["businessName"] for b in picker] == ["Anil Traders", "Balaji Traders", "Chandra Traders"]
    assert all(b["role"] == "accountant" and b["ownerName"] and b["lastOpenedAt"] is None for b in picker)
    assert stranger.business["id"] not in {b["id"] for b in picker}

    # They pick Balaji: that business opens (the server re-checks the membership) and is stamped.
    pick = picker[1]["id"]
    opened = client.get(f"{API}/businesses/me", headers={**ca, "X-Business-Id": pick})
    assert opened.status_code == 200 and opened.json()["businessName"] == "Balaji Traders"
    after = {b["id"]: b["lastOpenedAt"] for b in _picker(client, ca)}
    assert after[pick] is not None and [v for k, v in after.items() if k != pick] == [None, None]
    # A business that never assigned them can't be opened either.
    assert client.get(f"{API}/businesses/me", headers={**ca, "X-Business-Id": stranger.business["id"]}).status_code == 403


def test_with_one_business_they_go_straight_in(make_user, client):
    owner = make_user(business_name="Only Traders")
    _invite(client, owner, "7955000002")
    ca = _login(client, "7955000002")
    assert len(_picker(client, ca)) == 1                      # the app skips the picker
    r = client.get(f"{API}/businesses/me", headers=ca)        # no header: their one business
    assert r.status_code == 200 and r.json()["businessName"] == "Only Traders"


def test_a_revoked_business_is_gone_from_the_picker_on_next_login(make_user, client):
    a, b = make_user(business_name="Anil Traders"), make_user(business_name="Balaji Traders")
    _invite(client, a, "7955000003")
    uid = _invite(client, b, "7955000003")
    assert len(_picker(client, _login(client, "7955000003"))) == 2
    assert client.delete(f"{API}/team/{uid}", headers=b.headers).status_code == 204
    again = _picker(client, _login(client, "7955000003"))
    assert [x["businessName"] for x in again] == ["Anil Traders"]
