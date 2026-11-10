"""Shared beats: one beat, several staff (one primary), via beat_assignments."""

from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from conftest import today_iso
from helpers import add_customer
from app import beats as beat_svc
from app.database import Base, SessionLocal
from app.migrations import _backfill_beat_assignments
from app.models import BeatAssignment
from test_beats import ALL_DAYS, _beat, _team, _visit

API = "/api/v1"


def _shared(make_user, client):
    owner, [(a_id, a), (b_id, b), (c_id, c)] = _team(make_user, client, "staff", "staff", "staff")
    client.patch(f"{API}/team/{b_id}", headers=owner.headers, json={"name": "Bhaskar"})
    shop = add_customer(client, owner.headers, full_name="Market Kirana")["id"]
    beat = _beat(client, owner, "Market Road", user_id=a_id, customers=[shop])
    r = client.post(f"{API}/beats/{beat['id']}/assignments", headers=owner.headers,
                    json={"userId": b_id, "role": "secondary"})
    assert r.status_code == 200, r.text
    return owner, (a_id, a), (b_id, b), (c_id, c), shop, r.json()


def test_two_staff_see_the_beat_and_a_third_is_refused(make_user, client):
    owner, (a_id, a), (b_id, b), (_c_id, c), shop, beat = _shared(make_user, client)
    assert sorted((x["user_id"], x["role"]) for x in beat["assignments"]) == sorted(
        [(a_id, "primary"), (b_id, "secondary")])
    for staff in (a, b):
        assert [x["id"] for x in client.get(f"{API}/beats/today", headers=staff).json()] == [beat["id"]]
        assert client.get(f"{API}/beats/{beat['id']}", headers=staff).status_code == 200
    assert client.get(f"{API}/beats/today", headers=c).json() == []
    assert client.get(f"{API}/beats/{beat['id']}", headers=c).status_code == 403
    assert _visit(client, c, beat["id"], shop, "c1").status_code == 403
    assert client.put(f"{API}/beats/{beat['id']}/retailers/order", headers=c,
                      json={"customerIds": []}).status_code == 403
    # The same refusal for the secondary on reordering (staff never plan beats).
    assert client.put(f"{API}/beats/{beat['id']}/retailers/order", headers=b,
                      json={"customerIds": []}).status_code == 403


def test_a_visit_by_the_secondary_shows_their_name(make_user, client):
    owner, (_a_id, a), (_b_id, b), _c, shop, beat = _shared(make_user, client)
    assert _visit(client, b, beat["id"], shop, "b1").status_code == 200
    assert _visit(client, a, beat["id"], shop, "a1").status_code == 200
    history = client.get(f"{API}/visits", headers=owner.headers, params={"beatId": beat["id"]}).json()
    by_client = {v["client_id"]: v for v in history}
    assert by_client["b1"]["user_name"] == "Bhaskar"
    assert by_client["a1"]["user_name"] is None and by_client["a1"]["user_mobile"]  # no name: the number


def test_one_daily_close_totals_both_members_with_subtotals(make_user, client):
    owner, (a_id, a), (b_id, b), _c, shop, beat = _shared(make_user, client)
    for who, cid, amount in ((a, "pa", 500), (b, "pb", 300), (b, "pb2", 200.5)):
        r = client.post(f"{API}/customers/{shop}/ledger", headers=who, data={
            "type": "payment", "amount": str(amount), "date": today_iso(), "client_id": cid,
            "payment_method": "cash", "beat_id": beat["id"]})
        assert r.status_code == 200, r.text
    close = client.get(f"{API}/daily-close", headers=owner.headers, params={"beat_id": beat["id"]}).json()
    assert close["creditCollected"] == "1000.50" and close["cashInHand"] == "1000.50"
    subs = {m["userId"]: m["collected"] for m in close["members"]}
    assert subs == {a_id: "500.00", b_id: "500.50"}
    # The secondary sees the same single close for the beat.
    mine = client.get(f"{API}/daily-close", headers=b, params={"beat_id": beat["id"]}).json()
    assert mine["creditCollected"] == "1000.50"


def test_ending_the_secondary_hides_the_beat_from_tomorrow_but_keeps_their_visits(make_user, client, monkeypatch):
    owner, _a, (b_id, b), _c, shop, beat = _shared(make_user, client)
    _visit(client, b, beat["id"], shop, "b-before")
    r = client.post(f"{API}/beats/{beat['id']}/assignments/{b_id}/end", headers=owner.headers)
    assert r.status_code == 200 and [x["user_id"] for x in r.json()["assignments"]] != []
    # Still theirs today (valid_to = today is the last day)…
    assert client.get(f"{API}/beats/{beat['id']}", headers=b).status_code == 200
    # …gone tomorrow.
    tomorrow = (date.fromisoformat(today_iso()) + timedelta(days=1)).isoformat()
    monkeypatch.setattr(beat_svc, "today_iso", lambda: tomorrow)
    assert client.get(f"{API}/beats/today", headers=b).json() == []
    assert client.get(f"{API}/beats/{beat['id']}", headers=b).status_code == 403
    history = client.get(f"{API}/visits", headers=owner.headers, params={"beatId": beat["id"]}).json()
    assert [v["client_id"] for v in history] == ["b-before"]
    assert client.post(f"{API}/beats/{beat['id']}/assignments/{b_id}/end", headers=owner.headers).status_code == 404


def test_database_refuses_a_second_open_primary(make_user, client):
    owner, (a_id, _a), (b_id, _b), _c, _shop, beat = _shared(make_user, client)
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.add(BeatAssignment(beat_id=beat["id"], user_id=b_id, role="primary", valid_from=today_iso()))
        db.commit()
    with SessionLocal() as db:
        open_primaries = db.scalars(select(BeatAssignment).where(
            BeatAssignment.beat_id == beat["id"], BeatAssignment.role == "primary",
            BeatAssignment.valid_to.is_(None))).all()
        assert [p.user_id for p in open_primaries] == [a_id]


def test_handing_over_the_primary_keeps_exactly_one(make_user, client):
    owner, (a_id, a), (b_id, b), _c, _shop, beat = _shared(make_user, client)
    r = client.post(f"{API}/beats/{beat['id']}/assignments", headers=owner.headers,
                    json={"userId": b_id, "role": "primary"})
    assert r.status_code == 200
    roles = {x["user_id"]: x["role"] for x in r.json()["assignments"]}
    assert roles == {b_id: "primary"} and r.json()["assigned_user_id"] == b_id
    assert client.get(f"{API}/beats/{beat['id']}", headers=a).status_code == 403  # handover is immediate
    with SessionLocal() as db:
        assert len(db.scalars(select(BeatAssignment).where(
            BeatAssignment.beat_id == beat["id"], BeatAssignment.role == "primary",
            BeatAssignment.valid_to.is_(None))).all()) == 1


def test_removing_a_member_from_the_team_ends_their_beats(make_user, client):
    owner, _a, (b_id, b), _c, shop, beat = _shared(make_user, client)
    _visit(client, b, beat["id"], shop, "kept")
    assert client.delete(f"{API}/team/{b_id}", headers=owner.headers).status_code == 204
    with SessionLocal() as db:
        row = db.scalars(select(BeatAssignment).where(BeatAssignment.user_id == b_id)).one()
        assert row.valid_to == today_iso()
    assert [v["client_id"] for v in client.get(f"{API}/visits", headers=owner.headers,
                                               params={"beatId": beat["id"]}).json()] == ["kept"]


def test_old_beats_get_their_salesperson_as_primary_once():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, mobile, created_at) VALUES ('u', '9', 'x')"))
        conn.execute(text("INSERT INTO businesses (id, user_id, business_name, owner_name, business_type, state, "
                          "gst_registered, created_at) VALUES ('b', 'u', 'B', 'O', 'R', 'Goa', 0, 'x')"))
        conn.execute(text("INSERT INTO beats (id, business_id, name, weekdays, assigned_user_id, created_at) "
                          "VALUES ('k', 'b', 'K', '0', 'u', '2026-03-04T10:00:00+00:00'), "
                          "('n', 'b', 'N', '0', NULL, '2026-03-04T10:00:00+00:00')"))
    _backfill_beat_assignments(engine)
    _backfill_beat_assignments(engine)
    with Session(engine) as db:
        rows = db.scalars(select(BeatAssignment)).all()
        assert [(r.beat_id, r.user_id, r.role, r.valid_from, r.valid_to) for r in rows] == [
            ("k", "u", "primary", "2026-03-04", None)]
