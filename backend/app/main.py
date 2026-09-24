import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import Base, engine
from .errors import install_error_handlers
from .migrations import run_startup_migrations
from .monitoring import (
    check_rate_limit,
    init_sentry,
    is_export,
    peek_user_id,
    record_api_error,
    record_export,
)
from .routers import (
    account,
    ai_routes,
    assistant,
    auth,
    business,
    consent,
    customers,
    daily_summary,
    summary_insights,
    dashboard,
    expenses,
    customer_insights,
    incomes,
    items,
    feedback,
    khata,
    notifications,
    recurring,
    reports,
    restore,
    team,
    transactions,
)
from .storage import UPLOAD_DIR

logging.basicConfig(level=logging.INFO)

# Create missing tables, then apply idempotent additive-column migrations that
# create_all can't (it never alters existing tables). Keeps a live DB in sync
# with the models on every deploy without manual psql. See app/migrations.py.
Base.metadata.create_all(bind=engine)
run_startup_migrations(engine)

# Start error/crash monitoring before the app so unhandled exceptions are
# captured and alerted (no-op unless SENTRY_DSN is set).
init_sentry()

app = FastAPI(title="Smart CashBook API", version="1.0.0")

# Log every unhandled failure with its traceback + request context.
install_error_handlers(app)


def _client_ip(request) -> str | None:
    """Real client IP. On Render the app sits behind a proxy, so trust the first
    hop of X-Forwarded-For when present; fall back to the socket peer."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


@app.middleware("http")
async def _rate_limit(request, call_next):
    """Reject callers over their rolling per-IP / per-user budget with 429.
    Auth paths use a stricter per-IP budget. No-op when DEBUG is on."""
    try:
        ip = _client_ip(request)
        user_id = peek_user_id(request.headers.get("authorization"))
        reason = check_rate_limit(ip, user_id, request.url.path)
    except Exception:  # noqa: BLE001 — limiter must never break the request path
        reason = None
    if reason:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please slow down and retry."},
            headers={"Retry-After": str(settings.rate_limit_window_s)},
        )
    return await call_next(request)


@app.middleware("http")
async def _breach_monitor(request, call_next):
    """Feed anomaly detectors: per-account API errors and data-export volume.
    Failure here must never affect the response."""
    response = await call_next(request)
    try:
        account = peek_user_id(request.headers.get("authorization"))
        if account:
            if response.status_code >= 400:
                record_api_error(account, response.status_code)
            if request.method == "GET" and is_export(request.url.path):
                record_export(account)
    except Exception:  # noqa: BLE001
        pass
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=False,  # Bearer-token API; no cross-origin cookies.
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"
for module in (
    auth,
    incomes,
    expenses,
    customers,
    transactions,
    dashboard,
    daily_summary,
    summary_insights,
    khata,
    ai_routes,
    notifications,
    reports,
    items,
    customer_insights,
    business,
    assistant,
    recurring,
    restore,
    team,
    feedback,
    account,
    consent,
):
    app.include_router(module.router, prefix=API_PREFIX)

os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/")
def root() -> dict:
    """Friendly landing payload so hitting the bare URL doesn't 404. The real
    API lives under /api/v1; interactive docs are at /docs."""
    return {
        "status": "ok",
        "service": "Smart CashBook API",
        "docs": "/docs",
        "health": "/health",
        "api": "/api/v1",
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
