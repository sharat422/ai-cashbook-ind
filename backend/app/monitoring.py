"""Breach detection & alerting.

Two jobs:

1. Error/crash monitoring — initialise Sentry (optional, via SENTRY_DSN) so
   unhandled exceptions and captured security events reach you by email in real
   time instead of dying silently in the server log.

2. Anomaly alerts — cheap in-process sliding-window counters flag the classic
   breach indicators (a spike in failed logins, a burst of API errors from one
   account, an unusual volume of data exports) and raise an alert the moment a
   threshold is crossed.

`alert()` is the single fan-out point: it always writes a structured ERROR log
(so it shows in Render logs), sends the event to Sentry (email), and — if an
owner alert number is configured — pushes a WhatsApp message (SMS-like).

NOTE: the counters are per-process and in-memory. On a single Render instance
that's fine; if you scale to multiple instances, move these windows to Redis so
the thresholds are global. The thresholds fire once per crossing (not on every
hit past the line) to avoid alert storms.
"""

import logging
import threading
import time
from collections import defaultdict, deque

from .config import settings

log = logging.getLogger("cashbook.security")

# --- Sentry (optional) ------------------------------------------------------
_sentry_enabled = False


def init_sentry() -> None:
    """Initialise Sentry if SENTRY_DSN is set. No-op otherwise (dev/tests)."""
    global _sentry_enabled
    if not settings.sentry_dsn:
        return
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment="production" if not settings.debug else "development",
            # We don't need performance traces for breach detection; keep costs low.
            traces_sample_rate=0.0,
            # Never ship raw request bodies / PII to a third party.
            send_default_pii=False,
        )
        _sentry_enabled = True
        log.info("Sentry initialised")
    except Exception:  # noqa: BLE001 — monitoring must never break boot
        log.exception("Sentry init failed; continuing without it")


def capture_exception(exc: BaseException) -> None:
    if not _sentry_enabled:
        return
    try:
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
    except Exception:  # noqa: BLE001
        log.exception("Sentry capture_exception failed")


def _capture_message(message: str, level: str) -> None:
    if not _sentry_enabled:
        return
    try:
        import sentry_sdk

        sentry_sdk.capture_message(message, level=level)
    except Exception:  # noqa: BLE001
        log.exception("Sentry capture_message failed")


# --- Central alert fan-out --------------------------------------------------
def alert(kind: str, message: str, level: str = "error", **context) -> None:
    """Raise a security alert through every configured channel."""
    log.error("SECURITY ALERT [%s] %s | %s", kind, message, context or "")
    _capture_message(f"[{kind}] {message}", level)
    _notify_owner(kind, message)


def _notify_owner(kind: str, message: str) -> None:
    number = settings.owner_alert_mobile
    if not number:
        return
    try:
        # Imported lazily so a missing/!=configured WhatsApp setup never breaks alerts.
        from .notifications import send_whatsapp_text, whatsapp_configured

        if whatsapp_configured():
            send_whatsapp_text(number, f"🔐 Security alert — {kind}: {message}")
    except Exception:  # noqa: BLE001
        log.exception("owner WhatsApp alert failed")


# --- Sliding-window counters ------------------------------------------------
class SlidingWindow:
    """Counts events per key within a rolling time window (thread-safe)."""

    def __init__(self, window_seconds: int) -> None:
        self.window = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, now: float | None = None) -> int:
        """Record one event for `key`; return the count within the window."""
        ts = now if now is not None else time.monotonic()
        with self._lock:
            dq = self._events[key]
            dq.append(ts)
            cutoff = ts - self.window
            while dq and dq[0] <= cutoff:
                dq.popleft()
            return len(dq)


_failed_logins = SlidingWindow(settings.failed_login_window_s)
_account_errors = SlidingWindow(settings.account_error_window_s)
_exports = SlidingWindow(settings.export_window_s)


def record_failed_login(mobile: str) -> None:
    """A wrong/expired OTP attempt. Alerts on a global spike (credential-stuffing)
    and on a single number being hammered (targeted brute force)."""
    masked = _mask(mobile)
    if _failed_logins.hit("__all__") == settings.failed_login_threshold:
        alert(
            "failed-login-spike",
            f"{settings.failed_login_threshold}+ failed logins in "
            f"{settings.failed_login_window_s}s across all accounts.",
        )
    if _failed_logins.hit(f"m:{mobile}") == settings.failed_login_per_mobile_threshold:
        alert(
            "failed-login-targeted",
            f"{settings.failed_login_per_mobile_threshold}+ failed logins for {masked}.",
        )


def record_api_error(account: str, status_code: int) -> None:
    """A 4xx/5xx for an authenticated account. A burst from ONE account is a
    common sign of scripted abuse / probing."""
    if _account_errors.hit(account) == settings.account_error_threshold:
        alert(
            "account-error-spike",
            f"{settings.account_error_threshold}+ API errors in "
            f"{settings.account_error_window_s}s from account {account}.",
        )


def record_export(account: str) -> None:
    """A data-export / bulk-read action. An unusual volume from one account can
    mean data exfiltration."""
    if _exports.hit(account) == settings.export_threshold:
        alert(
            "export-volume",
            f"{settings.export_threshold}+ data exports in "
            f"{settings.export_window_s}s from account {account}.",
            level="warning",
        )


def _mask(mobile: str) -> str:
    return f"***{mobile[-4:]}" if mobile and len(mobile) >= 4 else "***"


# --- Request rate limiting --------------------------------------------------
# Separate windows for per-IP, per-user and the stricter auth-path per-IP budget.
_rl_ip = SlidingWindow(settings.rate_limit_window_s)
_rl_user = SlidingWindow(settings.rate_limit_window_s)
_rl_auth_ip = SlidingWindow(settings.rate_limit_window_s)

# Auth/OTP paths get the stricter per-IP budget (brute-force / stuffing surface).
_AUTH_MARKERS = ("/auth/",)


def _is_auth_path(path: str) -> bool:
    return any(marker in path for marker in _AUTH_MARKERS)


def check_rate_limit(
    ip: str | None, user_id: str | None, path: str
) -> str | None:
    """Record this request against the rolling windows and return a short reason
    string if a budget is now exceeded, else None. Callers translate a non-None
    result into an HTTP 429. No-op (always None) unless enabled and not in debug."""
    if not settings.rate_limit_enabled or settings.debug:
        return None

    if _is_auth_path(path):
        if ip and _rl_auth_ip.hit(f"auth:{ip}") > settings.rate_limit_auth_per_ip:
            return "auth-ip"
    if ip and _rl_ip.hit(ip) > settings.rate_limit_per_ip:
        return "ip"
    if user_id and _rl_user.hit(user_id) > settings.rate_limit_per_user:
        return "user"
    return None


# --- Request-scoped helpers (used by the HTTP middleware) -------------------
# Paths treated as data exports / bulk reads for the export-volume check.
_EXPORT_MARKERS = ("/reports/summary", "/statement")


def is_export(path: str) -> bool:
    return any(marker in path for marker in _EXPORT_MARKERS)


def peek_user_id(auth_header: str | None) -> str | None:
    """Best-effort account id from a bearer token, WITHOUT a DB hit — for keying
    anomaly counters in middleware. Returns None if absent/invalid."""
    if not auth_header or not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    try:
        import jwt

        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        sub = payload.get("sub")
        return str(sub) if sub else None
    except Exception:  # noqa: BLE001 — invalid/expired token → just don't key on it
        return None
