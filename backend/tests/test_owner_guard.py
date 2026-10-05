"""Last-active-owner guard: an inactive owner row must never let the sole
*active* owner be demoted or removed (which would leave the business with no
owner who can manage it).

Regression for routers/team.py::_owner_count, which counted owners of any
status. These use a direct DB write to mark an owner inactive because there is
no endpoint that deactivates a member — the state arises from invites that were
never accepted or from future soft-removal, and the guard must be correct for it.
"""

from sqlalchemy import select

from app.database import SessionLocal
from app.models import BusinessMember


def _add_owner(client, owner_headers, mobile) -> dict:
    r = client.post(
        "/api/v1/team", headers=owner_headers, json={"mobile": mobile, "role": "owner"}
    )
    assert r.status_code == 200, r.text
    return r.json()


def _self_id(client, headers) -> str:
    team = client.get("/api/v1/team", headers=headers).json()
    return next(m["user_id"] for m in team if m["is_self"])


def _set_member_status(business_id: str, user_id: str, status: str) -> None:
    with SessionLocal() as s:
        member = s.scalars(
            select(BusinessMember).where(
                BusinessMember.business_id == business_id,
                BusinessMember.user_id == user_id,
            )
        ).first()
        assert member is not None
        member.status = status
        s.commit()


def test_inactive_owner_does_not_permit_demoting_last_active_owner(user, client):
    # user is the sole active owner (A). Add a second owner B, then mark B
    # inactive: active owners = {A}, but the *total* owner rows = 2.
    b = _add_owner(client, user.headers, "8500000001")
    _set_member_status(user.business["id"], b["user_id"], "inactive")

    a_id = _self_id(client, user.headers)

    # PATCH: demoting A (the last ACTIVE owner) must be blocked.
    demote = client.patch(
        f"/api/v1/team/{a_id}", headers=user.headers, json={"role": "staff"}
    )
    assert demote.status_code == 400, demote.text

    # DELETE: removing A must be blocked too.
    remove = client.delete(f"/api/v1/team/{a_id}", headers=user.headers)
    assert remove.status_code == 400, remove.text

    # A is still an active owner.
    team = client.get("/api/v1/team", headers=user.headers).json()
    a = next(m for m in team if m["user_id"] == a_id)
    assert a["role"] == "owner" and a["status"] == "active"


def test_inactive_owner_itself_can_be_removed_when_an_active_owner_remains(user, client):
    # A (active) + B owner marked inactive. Removing B is safe (A still owns the
    # business) and must be allowed — B is not the last active owner.
    b = _add_owner(client, user.headers, "8500000002")
    _set_member_status(user.business["id"], b["user_id"], "inactive")

    remove = client.delete(f"/api/v1/team/{b['user_id']}", headers=user.headers)
    assert remove.status_code == 204, remove.text


def test_two_active_owners_allow_demoting_one_then_protect_the_last(user, client):
    # A stays the acting owner throughout so TEAM_MANAGE is never lost.
    b = _add_owner(client, user.headers, "8500000003")  # active by default
    a_id = _self_id(client, user.headers)

    # Two active owners → demoting B is allowed (A remains an active owner).
    demote_b = client.patch(
        f"/api/v1/team/{b['user_id']}", headers=user.headers, json={"role": "staff"}
    )
    assert demote_b.status_code == 200, demote_b.text

    # A is now the sole active owner → demoting A is blocked.
    demote_a = client.patch(
        f"/api/v1/team/{a_id}", headers=user.headers, json={"role": "staff"}
    )
    assert demote_a.status_code == 400, demote_a.text
