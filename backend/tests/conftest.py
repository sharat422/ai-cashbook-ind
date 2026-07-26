"""Shared pytest fixtures for the backend end-to-end suite.

These tests exercise the FastAPI app in-process via Starlette's TestClient —
no running server, no network. Every request goes through the real routers,
auth, SQLAlchemy models and SQLite DB, so they are true end-to-end tests of
the backend contract the mobile app depends on.

Isolation strategy: the app resolves the active business from the bearer
token, so each test provisions its OWN user + business (via the `user` /
`make_user` fixtures). That keeps tests independent even though they share one
SQLite database — no cross-test bleed of incomes, customers, ledgers, etc.
"""

import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

# --- Point the app at an isolated test DB BEFORE importing it. --------------
# The engine is created at import time from these env vars, so they must be set
# first. DEBUG + MASTER_OTP let us log in with a fixed OTP and no SMS provider.
_TEST_DB_PATH = os.path.join(os.path.dirname(__file__), "test_e2e.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH}"
os.environ["DEBUG"] = "true"
os.environ["MASTER_OTP"] = "123456"
os.environ.setdefault("PUBLIC_BASE_URL", "http://testserver")
# Ensure the platform auto-URL logic doesn't override PUBLIC_BASE_URL here.
os.environ.pop("RENDER_EXTERNAL_URL", None)

from fastapi.testclient import TestClient  # noqa: E402
from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

MASTER_OTP = "123456"


def today_iso() -> str:
    """UTC 'today' — matches how the backend computes the current day."""
    return datetime.now(timezone.utc).date().isoformat()


def days_ago_iso(n: int) -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=n)).isoformat()


@pytest.fixture(scope="session")
def client():
    """A TestClient bound to a freshly-created schema for the whole session."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)
    # Best-effort cleanup of the on-disk test DB.
    try:
        engine.dispose()
        os.remove(_TEST_DB_PATH)
    except OSError:
        pass


def _unique_mobile() -> str:
    """A distinct 10-digit mobile per call so each login is a new user."""
    return str(9_000_000_000 + uuid.uuid4().int % 1_000_000_000)


def _login(client, mobile: str) -> dict:
    """Full OTP handshake → returns Authorization headers for `mobile`."""
    r = client.post("/api/v1/auth/otp/request", json={"mobile": mobile})
    assert r.status_code == 200, r.text
    verification_id = r.json()["verificationId"]
    r = client.post(
        "/api/v1/auth/otp/verify",
        json={"verificationId": verification_id, "mobile": mobile, "otp": MASTER_OTP},
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def make_user(client):
    """Factory: provision an authenticated user, optionally with a business.

    Returns a SimpleNamespace(mobile, headers, business) so tests can spin up
    as many independent tenants as they need.
    """

    def _make(*, with_business: bool = True, business_name: str = "Test Traders"):
        mobile = _unique_mobile()
        headers = _login(client, mobile)
        business = None
        if with_business:
            r = client.post(
                "/api/v1/businesses",
                headers=headers,
                json={
                    "businessName": business_name,
                    "ownerName": "Owner",
                    "businessType": "Retail",
                    "state": "Karnataka",
                    "gstRegistered": False,
                },
            )
            assert r.status_code == 200, r.text
            business = r.json()
        return SimpleNamespace(mobile=mobile, headers=headers, business=business)

    return _make


@pytest.fixture
def user(make_user):
    """The common case: one authenticated user with one onboarded business."""
    return make_user()
