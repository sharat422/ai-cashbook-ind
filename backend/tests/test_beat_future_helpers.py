"""B5: cover planned ahead ("Ravi covers from Monday"). A helper's dates set
valid_from / valid_to; the access rule ("today within the dates") is
unchanged — these tests only prove it holds for future and ended cover."""

from datetime import date, timedelta

from sqlalchemy import select

from conftest import today_iso
from app import beats as beat_svc
from app.database import SessionLocal
from app.models import BeatAssignment
from test_beat_helpers import _add, _remove, _setup
from test_beats import _visit

API = "/api/v1"


def _day(n: int) -> str:
    return (date.fromisoformat(today_iso()) + timedelta(days=n)).isoformat()


def _on(monkeypatch, day: str) -> None:
    monkeypatch.setattr(beat_svc, "today_iso", lambda: day)


def _sees(client, headers, beat_id) -> bool:
    today = [x["id"] for x in client.get(f"{API}/beats/today", headers=headers).json()]
    code = client.get(f"{API}/beats/{beat_id}", headers=headers).status_code
    assert (beat_id in today) == (code == 200), (today, code)
    return code == 200


def test_cover_shows_from_its_start_date_and_stops_after_its_end_date(make_user, client, monkeypatch):
    owner, _a, (b_id, b), _c, _shop, beat = _setup(make_user, client)
    r = client.post(f"{API}/beats/{beat['id']}/helpers", headers=owner.headers,
                    json={"userId": b_id, "validFrom": _day(3), "validTo": _day(5)})
    assert r.status_code == 200, r.text
    helper = next(x for x in r.json()["assignments"] if x["user_id"] == b_id)  # listed with its dates
    assert (helper["role"], helper["valid_from"], helper["valid_to"]) == ("secondary", _day(3), _day(5))

    assert not _sees(client, b, beat["id"])            # today
    _on(monkeypatch, _day(2))
    assert not _sees(client, b, beat["id"])            # the day before it starts
    _on(monkeypatch, _day(3))
    assert _sees(client, b, beat["id"])                # the start date
    _on(monkeypatch, _day(5))
    assert _sees(client, b, beat["id"])                # the end date is the last day
    _on(monkeypatch, _day(6))
    assert not _sees(client, b, beat["id"])            # after it: 403 again


def test_past_starts_and_ends_before_starts_are_refused(make_user, client):
    owner, _a, (b_id, _b), _c, _shop, beat = _setup(make_user, client)
    add = lambda **dates: client.post(f"{API}/beats/{beat['id']}/helpers", headers=owner.headers,  # noqa: E731
                                      json={"userId": b_id, **dates})
    assert add(validFrom=_day(-1)).status_code == 422
    assert add(validFrom=_day(4), validTo=_day(3)).status_code == 422
    assert add(validFrom="16/11/2026").status_code == 422
    assert add(validFrom=_day(2), validTo=_day(4)).status_code == 200
    assert add(validFrom=_day(4)).status_code == 422   # overlaps the planned cover
    assert add(validFrom=_day(5)).status_code == 200   # after it: fine
    with SessionLocal() as db:
        assert db.scalars(select(BeatAssignment).where(BeatAssignment.user_id == b_id)).all().__len__() == 2


def test_future_cover_changes_nothing_before_it_starts(make_user, client):
    owner, (_a_id, a), (b_id, b), _c, shop, beat = _setup(make_user, client)
    assert _visit(client, a, beat["id"], shop, "a1").status_code == 200
    params = {"date": today_iso(), "beatId": beat["id"]}
    close_before = client.get(f"{API}/daily-close", headers=owner.headers, params=params).json()
    history_before = client.get(f"{API}/visits", headers=owner.headers, params={"beatId": beat["id"]}).json()

    assert client.post(f"{API}/beats/{beat['id']}/helpers", headers=owner.headers,
                       json={"userId": b_id, "validFrom": _day(2)}).status_code == 200
    assert client.get(f"{API}/daily-close", headers=owner.headers, params=params).json() == close_before
    assert client.get(f"{API}/visits", headers=owner.headers, params={"beatId": beat["id"]}).json() == history_before
    assert _visit(client, b, beat["id"], shop, "b-early").status_code == 403  # can't record before the start


def test_removing_cover_that_has_not_started_cancels_it(make_user, client):
    owner, _a, (b_id, _b), _c, _shop, beat = _setup(make_user, client)
    _add(client, owner.headers, beat["id"], b_id)  # B4 form: from today, still works
    assert _remove(client, owner.headers, beat["id"], b_id).status_code == 200
    assert client.post(f"{API}/beats/{beat['id']}/helpers", headers=owner.headers,
                       json={"userId": b_id, "validFrom": _day(7)}).status_code == 200
    assert _remove(client, owner.headers, beat["id"], b_id).status_code == 200
    with SessionLocal() as db:  # today's row ended and kept; the planned one gone
        rows = db.scalars(select(BeatAssignment).where(BeatAssignment.user_id == b_id)).all()
        assert [(r.valid_from, r.valid_to) for r in rows] == [(today_iso(), today_iso())]
    # Leaving the team cancels planned cover too.
    client.post(f"{API}/beats/{beat['id']}/helpers", headers=owner.headers, json={"userId": b_id, "validFrom": _day(7)})
    assert client.delete(f"{API}/team/{b_id}", headers=owner.headers).status_code in (200, 204)
    with SessionLocal() as db:
        assert not db.scalars(select(BeatAssignment).where(BeatAssignment.user_id == b_id,
                                                           BeatAssignment.valid_from > today_iso())).all()
