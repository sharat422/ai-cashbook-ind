"""Breach-detection anomaly counters and the middleware/auth hooks that feed
them. Alerts are asserted by patching the alert fan-out (no real Sentry/WhatsApp)."""

import app.main as main_mod
import app.monitoring as mon
import app.routers.auth as auth_mod
from app.monitoring import SlidingWindow
from app.security import create_access_token


# --- Pure sliding-window logic ---------------------------------------------

def test_sliding_window_counts_and_expires():
    w = SlidingWindow(window_seconds=100)
    assert w.hit("k", now=0) == 1
    assert w.hit("k", now=10) == 2
    assert w.hit("k", now=50) == 3
    # At now=120 the events at 0 and 10 have fallen out of the 100s window.
    assert w.hit("k", now=120) == 2  # (50, 120)
    # Different keys are independent.
    assert w.hit("other", now=120) == 1


# --- record_* fire an alert exactly once at the threshold -------------------

def _capture_alerts(monkeypatch) -> list[tuple]:
    fired: list[tuple] = []
    monkeypatch.setattr(mon, "alert", lambda kind, message, **kw: fired.append((kind, message)))
    return fired


def test_failed_login_targeted_threshold(monkeypatch):
    fired = _capture_alerts(monkeypatch)
    monkeypatch.setattr(mon, "_failed_logins", SlidingWindow(300))
    monkeypatch.setattr(mon.settings, "failed_login_per_mobile_threshold", 3)
    monkeypatch.setattr(mon.settings, "failed_login_threshold", 999)  # isolate per-mobile
    for _ in range(3):
        mon.record_failed_login("9998887777")
    kinds = [k for k, _ in fired]
    assert "failed-login-targeted" in kinds
    assert kinds.count("failed-login-targeted") == 1  # once per crossing, not spammy


def test_account_error_threshold(monkeypatch):
    fired = _capture_alerts(monkeypatch)
    monkeypatch.setattr(mon, "_account_errors", SlidingWindow(300))
    monkeypatch.setattr(mon.settings, "account_error_threshold", 3)
    for _ in range(3):
        mon.record_api_error("acct-1", 500)
    assert [k for k, _ in fired] == ["account-error-spike"]


def test_export_volume_threshold(monkeypatch):
    fired = _capture_alerts(monkeypatch)
    monkeypatch.setattr(mon, "_exports", SlidingWindow(3600))
    monkeypatch.setattr(mon.settings, "export_threshold", 2)
    for _ in range(2):
        mon.record_export("acct-2")
    assert [k for k, _ in fired] == ["export-volume"]


# --- peek_user_id -----------------------------------------------------------

def test_peek_user_id():
    token = create_access_token("user-123")
    assert mon.peek_user_id(f"Bearer {token}") == "user-123"
    assert mon.peek_user_id("Bearer garbage") is None
    assert mon.peek_user_id(None) is None
    assert mon.peek_user_id("Basic xyz") is None


def test_is_export():
    assert mon.is_export("/api/v1/reports/summary")
    assert not mon.is_export("/api/v1/customers")


# --- Wiring: the hooks are actually called on real requests -----------------

def test_middleware_records_error_for_authenticated_account(user, client, monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(main_mod, "record_api_error", lambda acct, code: calls.append((acct, code)))
    # An authenticated 404 (owned-customer check) must be counted.
    r = client.get("/api/v1/customers/does-not-exist", headers=user.headers)
    assert r.status_code == 404
    assert len(calls) == 1 and calls[0][1] == 404


def test_middleware_records_export(user, client, monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(main_mod, "record_export", lambda acct: calls.append(acct))
    r = client.get(
        "/api/v1/reports/summary?from=2026-01-01&to=2026-12-31", headers=user.headers
    )
    assert r.status_code == 200
    assert len(calls) == 1


def test_failed_otp_records_failed_login(client, monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(auth_mod, "record_failed_login", lambda mobile: calls.append(mobile))
    mobile = "9123456780"
    vid = client.post("/api/v1/auth/otp/request", json={"mobile": mobile}).json()["verificationId"]
    r = client.post(
        "/api/v1/auth/otp/verify",
        json={"verificationId": vid, "mobile": mobile, "otp": "000000"},
    )
    assert r.status_code == 400
    assert calls == [mobile]
