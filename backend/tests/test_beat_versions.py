"""IM3: two phones editing one beat can't silently lose an edit. Every save
carries the beat version it started from; a stale one is refused (409
beat_changed) with the current beat, and nothing is saved. Versions are a
server counter, never a device clock. Items, schemes and team settings stay
last-write-wins on purpose (comments on those routes)."""

from helpers import add_customer
from test_beats import _beat, _team

API = "/api/v1"


def _shops(client, owner, names):
    return [add_customer(client, owner.headers, full_name=n)["id"] for n in names]


def _order(beat: dict) -> list[str]:
    return [r["customer_id"] for r in beat["retailers"]]


def test_two_phones_reorder_one_beat_the_second_gets_409_and_the_first_edit_stays(make_user, client):
    owner, [(_, second_owner)] = _team(make_user, client, "owner")
    a, b, c = _shops(client, owner, ["Anil Stores", "Balaji Kirana", "Chandra Traders"])
    beat = _beat(client, owner, "Ring Road", customers=[a, b, c])
    # Both phones open the beat at the same version.
    seen = client.get(f"{API}/beats/{beat['id']}", headers=second_owner).json()["version"]
    assert seen == beat["version"]

    first = client.put(f"{API}/beats/{beat['id']}/retailers/order", headers=owner.headers,
                       json={"customerIds": [c, a, b], "baseVersion": beat["version"]})
    assert first.status_code == 200 and first.json()["version"] == beat["version"] + 1

    second = client.put(f"{API}/beats/{beat['id']}/retailers/order", headers=second_owner,
                        json={"customerIds": [b, c, a], "baseVersion": seen})
    body = second.json()
    assert second.status_code == 409 and body["code"] == "beat_changed"
    assert body["detail"] == "Ring Road: changed on another phone — review and save again."
    assert body["params"] == {"beat": "Ring Road"}
    assert _order(body["beat"]) == [c, a, b] and body["beat"]["version"] == beat["version"] + 1  # the current beat

    now = client.get(f"{API}/beats/{beat['id']}", headers=owner.headers).json()
    assert _order(now) == [c, a, b] and now["version"] == beat["version"] + 1  # the first edit is intact


def test_an_edit_with_the_current_version_saves_and_a_stale_one_saves_nothing(make_user, client):
    owner, [(staff_id, _)] = _team(make_user, client, "staff")
    beat = _beat(client, owner, "Market", weekdays=[0])
    ok = client.put(f"{API}/beats/{beat['id']}", headers=owner.headers,
                    json={"name": "Market Road", "weekdays": [0, 3], "baseVersion": beat["version"]})
    assert ok.status_code == 200, ok.text
    assert (ok.json()["name"], ok.json()["weekdays"], ok.json()["version"]) == ("Market Road", [0, 3], beat["version"] + 1)

    # Another phone assigns the salesperson: an edit opened before that is now stale,
    # so it can't put "unassigned" back.
    assert client.post(f"{API}/beats/{beat['id']}/assignments", headers=owner.headers,
                       json={"userId": staff_id, "role": "primary"}).status_code == 200
    stale = client.put(f"{API}/beats/{beat['id']}", headers=owner.headers,
                       json={"name": "Old name", "weekdays": [1], "assignedUserId": None,
                             "baseVersion": ok.json()["version"]})
    assert stale.status_code == 409 and stale.json()["code"] == "beat_changed"
    now = client.get(f"{API}/beats/{beat['id']}", headers=owner.headers).json()
    assert (now["name"], now["assigned_user_id"]) == ("Market Road", staff_id)


def test_an_older_app_without_a_version_still_saves(make_user, client):
    owner, _ = _team(make_user, client)
    beat = _beat(client, owner, "Station")
    r = client.put(f"{API}/beats/{beat['id']}", headers=owner.headers, json={"name": "Station Road", "weekdays": [2]})
    assert r.status_code == 200 and r.json()["name"] == "Station Road" and r.json()["version"] == beat["version"] + 1
