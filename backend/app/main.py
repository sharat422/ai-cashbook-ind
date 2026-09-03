import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import Base, engine
from .errors import install_error_handlers
from .migrations import run_startup_migrations
from .routers import (
    ai_routes,
    assistant,
    auth,
    business,
    customers,
    daily_summary,
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

app = FastAPI(title="Smart CashBook API", version="1.0.0")

# Log every unhandled failure with its traceback + request context.
install_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
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
