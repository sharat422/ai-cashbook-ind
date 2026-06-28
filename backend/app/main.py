import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import Base, engine
from .routers import (
    ai_routes,
    auth,
    customers,
    daily_summary,
    dashboard,
    expenses,
    incomes,
    khata,
    transactions,
)
from .storage import UPLOAD_DIR

logging.basicConfig(level=logging.INFO)

# Create tables on startup. For schema migrations in production use Alembic;
# the bundled schema.sql mirrors these models for PostgreSQL.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Smart CashBook API", version="1.0.0")

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
):
    app.include_router(module.router, prefix=API_PREFIX)

os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
