"""E2E: account self-deletion (DELETE /api/v1/users/me)."""

import uuid

from helpers import add_customer, add_expense, add_income

from app.database import SessionLocal
from app.models import Business, BusinessMember, Customer, Expense, Income, User


def _user_id_for(mobile: str) -> str | None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.mobile == mobile).one_or_none()
        return user.id if user is not None else None
    finally:
        db.close()


def _seed_business_data(client, headers) -> None:
    add_income(
        client, headers, amount=500, date="2026-09-01", client_id=uuid.uuid4().hex
    )
    add_expense(
        client, headers, amount=120, date="2026-09-02", client_id=uuid.uuid4().hex
    )
    add_customer(client, headers)


def test_delete_account_requires_auth(client):
    r = client.delete(
        "/api/v1/users/me", headers={"Authorization": "Bearer bogus-token"}
    )
    assert r.status_code == 401


def test_delete_account_removes_user_and_all_data(client, make_user):
    u = make_user()
    _seed_business_data(client, u.headers)
    uid = _user_id_for(u.mobile)
    bid = u.business["id"]
    assert uid is not None

    r = client.delete("/api/v1/users/me", headers=u.headers)
    assert r.status_code == 204
    assert r.content == b""

    # The bearer token is dead: the user row no longer exists.
    assert client.get("/api/v1/businesses/me", headers=u.headers).status_code == 401

    db = SessionLocal()
    try:
        assert db.get(User, uid) is None
        assert db.get(Business, bid) is None
        assert db.query(Income).filter(Income.business_id == bid).count() == 0
        assert db.query(Expense).filter(Expense.business_id == bid).count() == 0
        assert db.query(Customer).filter(Customer.business_id == bid).count() == 0
    finally:
        db.close()


def test_delete_account_twice_second_is_rejected(client, make_user):
    u = make_user(with_business=False)
    assert client.delete("/api/v1/users/me", headers=u.headers).status_code == 204
    # Same token, user gone → the auth layer rejects it.
    assert client.delete("/api/v1/users/me", headers=u.headers).status_code == 401


def test_delete_account_leaves_other_users_alone(client, make_user):
    keeper = make_user()
    leaver = make_user()
    add_income(
        client,
        keeper.headers,
        amount=999,
        date="2026-09-03",
        client_id=uuid.uuid4().hex,
    )
    keeper_bid = keeper.business["id"]

    assert client.delete("/api/v1/users/me", headers=leaver.headers).status_code == 204

    # Keeper is still authenticated and their data is intact.
    assert client.get("/api/v1/businesses/me", headers=keeper.headers).status_code == 200
    db = SessionLocal()
    try:
        assert db.query(Income).filter(Income.business_id == keeper_bid).count() == 1
    finally:
        db.close()


def test_delete_account_removes_membership_but_not_others_business(
    client, make_user
):
    keeper = make_user()
    leaver = make_user(with_business=False)
    keeper_bid = keeper.business["id"]
    leaver_uid = _user_id_for(leaver.mobile)
    assert leaver_uid is not None

    # Leaver joins the keeper's business as staff (direct insert — the team
    # invite API is covered in test_rbac.py; the membership row is what matters).
    db = SessionLocal()
    try:
        db.add(
            BusinessMember(
                business_id=keeper_bid,
                user_id=leaver_uid,
                role="staff",
                status="active",
            )
        )
        db.commit()
    finally:
        db.close()

    assert client.delete("/api/v1/users/me", headers=leaver.headers).status_code == 204

    db = SessionLocal()
    try:
        # The other owner's business survives…
        assert db.get(Business, keeper_bid) is not None
        # …but the leaver's membership and user row are gone.
        assert (
            db.query(BusinessMember)
            .filter(BusinessMember.user_id == leaver_uid)
            .count()
            == 0
        )
        assert db.get(User, leaver_uid) is None
    finally:
        db.close()
