"""E2E: authentication (OTP) and onboarding (business) guardrails."""

from conftest import MASTER_OTP


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_root_is_friendly_not_404(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["service"] == "Smart CashBook API"


def test_otp_request_returns_verification_id(client):
    r = client.post("/api/v1/auth/otp/request", json={"mobile": "9123456780"})
    assert r.status_code == 200
    body = r.json()
    assert body["mobile"] == "9123456780"
    assert body["verificationId"].startswith("otp-")


def test_login_with_master_otp_returns_token_and_user(client):
    vid = client.post(
        "/api/v1/auth/otp/request", json={"mobile": "9123456781"}
    ).json()["verificationId"]
    r = client.post(
        "/api/v1/auth/otp/verify",
        json={"verificationId": vid, "mobile": "9123456781", "otp": MASTER_OTP},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["token"]
    assert body["user"]["mobile"] == "9123456781"


def test_wrong_otp_is_rejected(client):
    vid = client.post(
        "/api/v1/auth/otp/request", json={"mobile": "9123456782"}
    ).json()["verificationId"]
    r = client.post(
        "/api/v1/auth/otp/verify",
        json={"verificationId": vid, "mobile": "9123456782", "otp": "000000"},
    )
    assert r.status_code == 400


def test_same_mobile_maps_to_same_user(client):
    """Logging in twice with the same number must not create two identities."""
    def login(mobile):
        vid = client.post(
            "/api/v1/auth/otp/request", json={"mobile": mobile}
        ).json()["verificationId"]
        return client.post(
            "/api/v1/auth/otp/verify",
            json={"verificationId": vid, "mobile": mobile, "otp": MASTER_OTP},
        ).json()["user"]["id"]

    assert login("9123456783") == login("9123456783")


def test_protected_endpoint_requires_auth(client):
    r = client.get("/api/v1/dashboard/summary")
    assert r.status_code in (401, 403)


def test_invalid_token_is_401(client):
    r = client.get(
        "/api/v1/dashboard/summary",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert r.status_code == 401


def test_business_required_guard(make_user, client):
    """Authenticated but no business yet → clear 400, not a leak or 500."""
    u = make_user(with_business=False)
    r = client.get("/api/v1/dashboard/summary", headers=u.headers)
    assert r.status_code == 400
    assert "business" in r.json()["detail"].lower()


def test_create_and_fetch_business(user, client):
    assert user.business["businessName"] == "Test Traders"
    assert user.business["state"] == "Karnataka"
    me = client.get("/api/v1/businesses/me", headers=user.headers).json()
    assert me["id"] == user.business["id"]
    assert me["ownerName"] == "Owner"


def _relogin(client, mobile: str) -> dict:
    """Fresh token for an already-registered mobile (a returning-user login)."""
    vid = client.post(
        "/api/v1/auth/otp/request", json={"mobile": mobile}
    ).json()["verificationId"]
    token = client.post(
        "/api/v1/auth/otp/verify",
        json={"verificationId": vid, "mobile": mobile, "otp": MASTER_OTP},
    ).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_create_business_is_idempotent(user, client):
    """A second create must not spawn a duplicate — it returns the existing one,
    so a user's data can never split across two businesses."""
    again = client.post(
        "/api/v1/businesses",
        headers=user.headers,
        json={
            "businessName": "A Totally Different Name",
            "ownerName": "Someone Else",
            "businessType": "Services",
            "state": "Maharashtra",
            "gstRegistered": True,
        },
    )
    assert again.status_code == 200
    # Same business id as the original, and the original fields are unchanged.
    assert again.json()["id"] == user.business["id"]
    assert again.json()["businessName"] == "Test Traders"


def test_returning_login_pulls_existing_business(user, client):
    """Logging in again with a registered number resolves the same business
    (no re-onboarding, no data on a fresh empty business)."""
    new_headers = _relogin(client, user.mobile)
    me = client.get("/api/v1/businesses/me", headers=new_headers)
    assert me.status_code == 200
    assert me.json()["id"] == user.business["id"]


def test_business_data_is_isolated_between_users(make_user, client):
    """One user's expense must never appear for another (data is per-business)."""
    from helpers import add_expense
    from conftest import today_iso

    a = make_user()
    b = make_user()
    add_expense(client, a.headers, amount=999, date=today_iso(), client_id="iso-x")

    a_list = client.get("/api/v1/expenses", headers=a.headers).json()
    b_list = client.get("/api/v1/expenses", headers=b.headers).json()
    assert any(e["amount"] == 999 for e in a_list)
    assert all(e["amount"] != 999 for e in b_list)
    assert b_list == []
