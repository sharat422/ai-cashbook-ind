"""Lightweight, idempotent startup migrations.

`Base.metadata.create_all` creates missing *tables* but never adds *columns* to
tables that already exist — so additive model changes silently break a live
database (e.g. Customer.version/updated_at → every /customers query 500s). This
runs after create_all to bring an existing schema up to date on boot, so a plain
deploy self-heals with no manual psql.

Everything here is idempotent (guarded by an existence check) and dialect-safe
(uses the SQLAlchemy inspector rather than `ADD COLUMN IF NOT EXISTS`, which
SQLite doesn't support).
"""

import logging
import uuid

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from .models import Business, BusinessMember

log = logging.getLogger("cashbook.migrations")


def run_startup_migrations(engine) -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    _add_customer_concurrency_columns(engine, inspector, tables)
    _backfill_owner_memberships(engine, tables)


def _add_customer_concurrency_columns(engine, inspector, tables: set[str]) -> None:
    """Customer.updated_at / version — added by the two-device conflict fix."""
    if "customers" not in tables:
        return
    columns = {c["name"] for c in inspector.get_columns("customers")}
    try:
        with engine.begin() as conn:
            if "updated_at" not in columns:
                conn.execute(text("ALTER TABLE customers ADD COLUMN updated_at VARCHAR(40)"))
                conn.execute(text("UPDATE customers SET updated_at = created_at WHERE updated_at IS NULL"))
                log.info("migration: added customers.updated_at")
            if "version" not in columns:
                conn.execute(text("ALTER TABLE customers ADD COLUMN version INTEGER DEFAULT 1"))
                conn.execute(text("UPDATE customers SET version = 1 WHERE version IS NULL"))
                log.info("migration: added customers.version")
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding customer concurrency columns")


def _backfill_owner_memberships(engine, tables: set[str]) -> None:
    """RBAC: every existing business needs an owner membership row so its
    creator keeps full access once roles are enforced (the get_current_membership
    fallback covers this too, but a real row makes /team correct)."""
    if not {"businesses", "business_members"} <= tables:
        return
    try:
        with Session(engine) as session:
            members_exist = {
                m.business_id
                for m in session.scalars(select(BusinessMember)).all()
            }
            added = 0
            for business in session.scalars(select(Business)).all():
                if business.id in members_exist:
                    continue
                session.add(
                    BusinessMember(
                        id=uuid.uuid4().hex,
                        business_id=business.id,
                        user_id=business.user_id,
                        role="owner",
                        status="active",
                        created_at=business.created_at,
                    )
                )
                added += 1
            if added:
                session.commit()
                log.info("migration: backfilled %d owner membership(s)", added)
    except Exception:  # noqa: BLE001
        log.exception("migration: failed backfilling owner memberships")
