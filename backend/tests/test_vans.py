"""Vans: a name (and registration) on a team member's van stock, set by the owner.
The Stock screen's van list carries the van's name, never a phone number; the
stock itself is unchanged (still the driver's)."""

import json

from conftest import today_iso
from test_stock import API, _item, _levels, _team, _transfer


def _vans_in_stock(client, headers):
    return client.get(f"{API}/stock", headers=headers).json()["vans"]


def test_a_named_van_on_its_drivers_stock_with_no_phone_number(make_user, client):
    owner, [(sheeran, staff)] = _team(make_user, client, "staff")
    client.patch(f"{API}/team/{sheeran}", headers=owner.headers, json={"name": "Sheeran"})
    item = _item(client, owner.headers, opening=50)

    r = client.post(f"{API}/vans", headers=owner.headers,
                    json={"name": "Van 1", "registration": " ka 01 ab 1234 ", "userId": sheeran})
    assert r.status_code == 200, r.text
    van = r.json()
    assert (van["name"], van["registration"], van["userId"], van["staffName"]) == (
        "Van 1", "KA 01 AB 1234", sheeran, "Sheeran")
    assert _transfer(client, owner.headers, item, 20, sheeran, cid="t1").status_code == 200

    lv = _levels(client, owner.headers, item)
    assert (float(lv["godown"]), {k: float(v) for k, v in lv["vans"].items()}) == (30.0, {sheeran: 20.0})  # unchanged
    vans = _vans_in_stock(client, owner.headers)
    assert [(v["name"], v["userId"]) for v in vans] == [("Van 1", sheeran)]
    mobile = client.get(f"{API}/team", headers=owner.headers).json()
    phones = [m["mobile"] for m in (mobile if isinstance(mobile, list) else mobile.get("members", [])) if m.get("mobile")]
    assert phones and not any(p in json.dumps(vans) for p in phones)  # no phone number in the van list
    assert all("mobile" not in v for v in vans)
    assert client.get(f"{API}/vans", headers=owner.headers).json() == [van]


def test_one_van_each_names_unique_and_a_loaded_van_keeps_its_driver(make_user, client):
    owner, [(a, _), (b, _)] = _team(make_user, client, "staff", "staff")
    item = _item(client, owner.headers, opening=10)
    van = client.post(f"{API}/vans", headers=owner.headers, json={"name": "Van 1", "userId": a}).json()
    for body, code in (({"name": "van 1", "userId": b}, "van_name_taken"),
                       ({"name": "Van 2", "userId": a}, "van_staff_taken")):
        r = client.post(f"{API}/vans", headers=owner.headers, json=body)
        assert (r.status_code, r.json()["code"]) == (409, code), body

    assert _transfer(client, owner.headers, item, 4, a, cid="t1").status_code == 200
    r = client.patch(f"{API}/vans/{van['vanId']}", headers=owner.headers, json={"userId": b})
    assert (r.status_code, r.json()["code"]) == (409, "van_has_stock")
    # Back to the godown, then it can go to someone else; a rename is fine any time.
    assert client.post(f"{API}/stock/transfers", headers=owner.headers, json={
        "itemId": item, "quantity": 4, "fromLocation": "van", "fromVanUserId": a, "toLocation": "godown",
        "date": today_iso(), "clientId": "t2"}).status_code == 200
    r = client.patch(f"{API}/vans/{van['vanId']}", headers=owner.headers, json={"userId": b, "name": "Van A"})
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["userId"]) == ("Van A", b)


def test_stock_on_someone_with_no_van_named_still_shows_by_their_name(make_user, client):
    owner, [(a, _)] = _team(make_user, client, "staff")
    client.patch(f"{API}/team/{a}", headers=owner.headers, json={"name": "Ravi"})
    item = _item(client, owner.headers, opening=5)
    assert _transfer(client, owner.headers, item, 2, a, cid="t1").status_code == 200  # loaded before vans had names
    [v] = _vans_in_stock(client, owner.headers)
    assert (v["vanId"], v["name"], v["userId"], v["staffName"]) == (None, None, a, "Ravi")


def test_only_the_owner_sets_up_vans_and_a_driver_is_on_the_team(make_user, client):
    owner, [(a, staff), (_, accountant)] = _team(make_user, client, "staff", "accountant")
    for headers in (staff, accountant):
        assert client.post(f"{API}/vans", headers=headers, json={"name": "Van 1", "userId": a}).status_code == 403
        assert client.get(f"{API}/vans", headers=headers).status_code == 403
    r = client.post(f"{API}/vans", headers=owner.headers, json={"name": "Van 1", "userId": "not-on-the-team"})
    assert r.status_code == 422
    assert client.post(f"{API}/vans", headers=owner.headers, json={"name": "", "userId": a}).status_code == 422
