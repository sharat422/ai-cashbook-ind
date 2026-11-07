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
    _add_ledger_collection_columns(engine, inspector, tables)
    _add_stock_columns(engine, inspector, tables)
    _widen_encrypted_columns(engine, inspector, tables)
    _add_client_id_unique_indexes(engine, tables)
    _backfill_owner_memberships(engine, tables)


# Same names as the model Index()es, so a fresh create_all makes these a no-op.
_CLIENT_ID_INDEXES = {
    "incomes": ("uq_income_client", "business_id"),
    "expenses": ("uq_expense_client", "business_id"),
    "ledger_entries": ("uq_ledger_client", "customer_id"),
}


def _add_client_id_unique_indexes(engine, tables: set[str]) -> None:
    """One row per offline client_id, enforced by the database. If old
    duplicates block an index it is skipped (logged) and the route's
    look-up-first check still applies."""
    for table, (name, scope) in _CLIENT_ID_INDEXES.items():
        if table not in tables:
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS {name} ON {table} ({scope}, client_id)"))
        except Exception:  # noqa: BLE001 — never let a migration crash boot
            log.exception("migration: could not add %s (duplicate client_ids?)", name)


# Columns that became application-encrypted (EncryptedText → TEXT). Ciphertext is
# far longer than the old VARCHAR(n) limits, so an existing Postgres schema must
# widen them to TEXT or encrypted writes overflow the column. Fresh databases get
# TEXT straight from create_all; this only fixes already-provisioned ones.
_ENCRYPTED_COLUMNS_TO_WIDEN = {
    "customers": ["gst_number"],
    "ledger_entries": ["payment_method", "reference_number"],
}


def _widen_encrypted_columns(engine, inspector, tables: set[str]) -> None:
    # Only Postgres enforces VARCHAR length; SQLite ignores it, so this is a
    # no-op there. Widening VARCHAR→TEXT is lossless and fast.
    if engine.dialect.name != "postgresql":
        return
    try:
        with engine.begin() as conn:
            for table, cols in _ENCRYPTED_COLUMNS_TO_WIDEN.items():
                if table not in tables:
                    continue
                existing = {c["name"]: c for c in inspector.get_columns(table)}
                for col in cols:
                    info = existing.get(col)
                    if info is None:
                        continue
                    if str(info["type"]).upper().startswith("TEXT"):
                        continue  # already widened
                    conn.execute(
                        text(f'ALTER TABLE {table} ALTER COLUMN {col} TYPE TEXT')
                    )
                    log.info("migration: widened %s.%s to TEXT", table, col)
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed widening encrypted columns")


def _add_customer_concurrency_columns(engine, inspector, tables: set[str]) -> None:
    """Customer.updated_at / version (two-device conflict fix) and credit_limit."""
    if "customers" not in tables:
        return
    columns = {c["name"] for c in inspector.get_columns("customers")}
    try:
        with engine.begin() as conn:
            if "updated_at" not in columns:
                conn.execute(text("ALTER TABLE customers ADD COLUMN updated_at VARCHAR(40)"))
                conn.execute(text("UPDATE customers SET updated_at = created_at WHERE updated_at IS NULL"))
                log.info("migration: added customers.updated_at")
            if "credit_limit" not in columns:
                conn.execute(text("ALTER TABLE customers ADD COLUMN credit_limit FLOAT"))
                log.info("migration: added customers.credit_limit")
            if "version" not in columns:
                conn.execute(text("ALTER TABLE customers ADD COLUMN version INTEGER DEFAULT 1"))
                conn.execute(text("UPDATE customers SET version = 1 WHERE version IS NULL"))
                log.info("migration: added customers.version")
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding customer concurrency columns")


# Added after launch: salesman/beat (daily close) and the GST invoice fields.
_LEDGER_COLUMNS = {
    "salesman_id": "VARCHAR(40)",
    "beat_id": "VARCHAR(40)",
    "customer_gstin": "TEXT",
    "hsn_code": "VARCHAR(8)",
    "place_of_supply": "VARCHAR(2)",
    "gst_rate": "NUMERIC(5,2)",
    "price_includes_gst": "BOOLEAN",
    "taxable_value": "NUMERIC(12,2)",
    "cgst": "NUMERIC(12,2)",
    "sgst": "NUMERIC(12,2)",
    "igst": "NUMERIC(12,2)",
}


def _add_ledger_collection_columns(engine, inspector, tables: set[str]) -> None:
    """New nullable LedgerEntry columns (see _LEDGER_COLUMNS)."""
    if "ledger_entries" not in tables:
        return
    columns = {c["name"] for c in inspector.get_columns("ledger_entries")}
    try:
        with engine.begin() as conn:
            for col, sql_type in _LEDGER_COLUMNS.items():
                if col not in columns:
                    conn.execute(text(f"ALTER TABLE ledger_entries ADD COLUMN {col} {sql_type}"))
                    log.info("migration: added ledger_entries.%s", col)
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding ledger collection columns")


def _add_stock_columns(engine, inspector, tables: set[str]) -> None:
    """Item.low_stock_threshold, and an opening godown move for items whose
    stock was typed on the item form before the stock ledger existed."""
    if "items" not in tables:
        return
    columns = {c["name"] for c in inspector.get_columns("items")}
    try:
        with engine.begin() as conn:
            if "low_stock_threshold" not in columns:
                conn.execute(text("ALTER TABLE items ADD COLUMN low_stock_threshold NUMERIC(12,3)"))
                log.info("migration: added items.low_stock_threshold")
            rows = conn.execute(text(
                "SELECT id, business_id, stock_qty, created_at FROM items "
                "WHERE type = 'product' AND stock_qty <> 0 AND id NOT IN "
                "(SELECT DISTINCT item_id FROM stock_moves)")).all()
            for item_id, business_id, qty, created_at in rows:
                conn.execute(text(
                    "INSERT INTO stock_moves (id, business_id, item_id, location, kind, "
                    "quantity, date, note, created_at) VALUES (:id, :b, :i, 'godown', "
                    "'opening', :q, :d, 'opening stock (from item form)', :c)"),
                    {"id": uuid.uuid4().hex, "b": business_id, "i": item_id,
                     "q": round(qty, 3), "d": (created_at or "")[:10], "c": created_at})
            if rows:
                log.info("migration: opening stock moves for %d items", len(rows))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding stock columns")


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
