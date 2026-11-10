"""B4: the owner adds and removes helpers (secondaries) on a beat. Removing
ends the assignment (valid_to = today), never deletes it; the primary can't
be removed or re-added here. Owner only."""

from sqlalchemy import select

from conftest import today_iso
from helpers import add_customer
from app.database import SessionLocal
from app.models import BeatAssignment
from test_beats import _beat, _team, _visit

API = "/api/v1"


def _setup(make_user, client):
    owner, [(a_id, a), (b_id, b), (c_id, c)] = _team(make_user, client, "staff", "staff", "staff")
    client.patch(f"{API}/team/{b_id}", headers=owner.headers, json={"name": "Bhaskar"})
    shop = add_customer(client, owner.headers, full_name="Market Kirana")["id"]
    beat = _beat(client, owner, "Market Road", user_id=a_id, customers=[shop])
    return owner, (a_id, a), (b_id, b), (c_id, c), shop, beat


def _add(client, headers, beat_id, user_id):
    return client.post(f"{API}/beats/{beat_id}/helpers", headers=headers, json={"userId": user_id})


def _remove(client, headers, beat_id, user_id):
    return client.delete(f"{API}/beats/{beat_id}/helpers/{user_id}", headers=headers)


def test_an_added_helper_sees_the_beat_today_and_a_third_staff_does_not(make_user, client):
    owner, _a, (b_id, b), (_c_id, c), _shop, beat = _setup(make_user, client)
    assert client.get(f"{API}/beats/today", headers=b).json() == []
    r = _add(client, owner.headers, beat["id"], b_id)
    assert r.status_code == 200, r.text
    assert (b_id, "secondary") in {(x["user_id"], x["role"]) for x in r.json()["assignments"]}
    assert [x["id"] for x in client.get(f"{API}/beats/today", headers=b).json()] == [beat["id"]]  # same day
    assert client.get(f"{API}/beats/{beat['id']}", headers=c).status_code == 403
    with SessionLocal() as db:
        row = db.scalars(select(BeatAssignment).where(BeatAssignment.user_id == b_id)).one()
        assert (row.valid_from, row.valid_to) == (today_iso(), None)


def test_removing_a_helper_ends_the_row_and_keeps_their_visits(make_user, client):
    owner, _a, (b_id, b), _c, shop, beat = _setup(make_user, client)
    _add(client, owner.headers, beat["id"], b_id)
    assert _visit(client, b, beat["id"], shop, "b1").status_code == 200
    r = _remove(client, owner.headers, beat["id"], b_id)
    assert r.status_code == 200, r.text
    with SessionLocal() as db:  # ended, not deleted
        [row] = db.scalars(select(BeatAssignment).where(BeatAssignment.user_id == b_id)).all()
        assert row.valid_to == today_iso()
    history = client.get(f"{API}/visits", headers=owner.headers, params={"beatId": beat["id"]}).json()
    assert [(v["client_id"], v["user_name"]) for v in history] == [("b1", "Bhaskar")]
    assert _remove(client, owner.headers, beat["id"], b_id).status_code == 404  # already removed
    # Re-added the same day (an owner's undo): the same row reopens, no second row.
    assert _add(client, owner.headers, beat["id"], b_id).status_code == 200
    with SessionLocal() as db:
        [row] = db.scalars(select(BeatAssignment).where(BeatAssignment.user_id == b_id)).all()
        assert row.valid_to is None


def test_duplicates_the_primary_and_staff_are_refused(make_user, client):
    owner, (a_id, a), (b_id, b), (c_id, _c), _shop, beat = _setup(make_user, client)
    assert _add(client, owner.headers, beat["id"], b_id).status_code == 200
    assert _add(client, owner.headers, beat["id"], b_id).status_code == 422  # twice
    assert _add(client, owner.headers, beat["id"], a_id).status_code == 422  # the primary as a helper
    assert _remove(client, owner.headers, beat["id"], a_id).status_code == 422  # the primary
    for staff in (a, b):  # even staff on the beat
        assert _add(client, staff, beat["id"], c_id).status_code == 403
        assert _remove(client, staff, beat["id"], b_id).status_code == 403
    with SessionLocal() as db:  # still exactly one open primary, unchanged
        primaries = db.scalars(select(BeatAssignment).where(
            BeatAssignment.beat_id == beat["id"], BeatAssignment.role == "primary",
            BeatAssignment.valid_to.is_(None))).all()
        assert [p.user_id for p in primaries] == [a_id]
