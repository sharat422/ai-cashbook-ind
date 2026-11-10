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
    _add_business_gstin(engine, inspector, tables)
    _backfill_stock_levels(engine)
    _add_bank_soft_delete_columns(engine, inspector, tables)
    _move_bank_matches(engine)
    _add_bank_match_split(engine, inspector, tables)
    _add_bank_match_deposits(engine, inspector, tables)
    _add_bank_import_restore(engine, inspector, tables)
    _add_cash_count_user(engine, inspector, tables)
    _add_cash_deposit_user(engine, inspector, tables)
    _backfill_payment_utrs(engine)
    _backfill_beat_assignments(engine)
    _backfill_owner_memberships(engine, tables)


def _add_business_gstin(engine, inspector, tables: set[str]) -> None:
    """Business.gstin: the seller's own GSTIN (required for GST invoices)."""
    if "businesses" not in tables:
        return
    if "gstin" in {c["name"] for c in inspector.get_columns("businesses")}:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE businesses ADD COLUMN gstin TEXT"))
        log.info("migration: added businesses.gstin")
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding businesses.gstin")


def _backfill_stock_levels(engine) -> None:
    """stock_levels arrived after stock_moves: build it once from the move
    ledger. A place whose moves sum below zero (the old race) starts at 0 and
    is logged — the next stock count corrects it."""
    try:
        with engine.begin() as conn:
            if conn.execute(text("SELECT 1 FROM stock_levels LIMIT 1")).first() is not None:
                return
            rows = conn.execute(text(
                "SELECT business_id, item_id, location, COALESCE(van_user_id, ''), SUM(quantity) "
                "FROM stock_moves GROUP BY business_id, item_id, location, COALESCE(van_user_id, '')"
            )).all()
            for business_id, item_id, location, van_key, total in rows:
                qty = total or 0
                if qty < 0:
                    log.warning("migration: stock below zero for item %s at %s %s (%s); starting at 0",
                                item_id, location, van_key, qty)
                    qty = 0
                conn.execute(text(
                    "INSERT INTO stock_levels (id, business_id, item_id, location, van_key, qty) "
                    "VALUES (:id, :b, :i, :l, :v, :q)"),
                    {"id": uuid.uuid4().hex, "b": business_id, "i": item_id, "l": location,
                     "v": van_key, "q": qty})
            if rows:
                log.info("migration: built stock_levels for %d places", len(rows))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed building stock_levels")


def _backfill_payment_utrs(engine) -> None:
    """Index UTRs of UPI payments saved before payment_utrs existed. Runs while
    the table is empty. An older duplicate keeps only its first payment
    indexed (logged); it isn't changed or deleted."""
    from .crypto import blind_index
    from .models import Customer, LedgerEntry, PaymentUtr

    try:
        with Session(engine) as db:
            if db.scalars(select(PaymentUtr.id).limit(1)).first() is not None:
                return
            rows = db.execute(
                select(LedgerEntry, Customer.business_id)
                .join(Customer, Customer.id == LedgerEntry.customer_id)
                .where(LedgerEntry.type == "payment", LedgerEntry.reference_number.is_not(None))
                .order_by(LedgerEntry.created_at)).all()
            seen: set[tuple[str, str]] = set()
            for entry, business_id in rows:
                if (entry.payment_method or "").lower() != "upi" or not entry.reference_number:
                    continue
                key = (business_id, blind_index(entry.reference_number.upper()))
                if key in seen:
                    log.warning("migration: duplicate UTR on ledger entry %s (kept the first)", entry.id)
                    continue
                seen.add(key)
                db.add(PaymentUtr(business_id=business_id, utr_hash=key[1], ledger_entry_id=entry.id))
            db.commit()
            if seen:
                log.info("migration: indexed %d UPI UTRs", len(seen))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed indexing UTRs")


def _add_bank_soft_delete_columns(engine, inspector, tables: set[str]) -> None:
    wanted = {"bank_imports": {"deleted_at": "VARCHAR(40)", "deleted_by": "VARCHAR(40)"},
              "bank_lines": {"deleted_at": "VARCHAR(40)"},
              "beats": {"deleted_at": "VARCHAR(40)"},
              "business_members": {"display_name": "VARCHAR(60)"},
              "stock_moves": {"supplier": "VARCHAR(200)", "unit_price": "NUMERIC(12,2)",
                              "bill_ref": "VARCHAR(40)"}}
    try:
        with engine.begin() as conn:
            for table, cols in wanted.items():
                if table not in tables:
                    continue
                have = {c["name"] for c in inspector.get_columns(table)}
                for col, sql_type in cols.items():
                    if col not in have:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {sql_type}"))
                        log.info("migration: added %s.%s", table, col)
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding bank soft-delete columns")


def _add_bank_match_split(engine, inspector, tables: set[str]) -> None:
    """One collection across several bank lines: group_id + part, and the
    one-active-match index moves from (entry_id) to (entry_id, part)."""
    if "bank_matches" not in tables:
        return
    cols = {c["name"] for c in inspector.get_columns("bank_matches")}
    try:
        with engine.begin() as conn:
            if "group_id" not in cols:
                conn.execute(text("ALTER TABLE bank_matches ADD COLUMN group_id VARCHAR(40)"))
            if "part" not in cols:
                conn.execute(text("ALTER TABLE bank_matches ADD COLUMN part INTEGER NOT NULL DEFAULT 0"))
            conn.execute(text("DROP INDEX IF EXISTS uq_bank_match_active_entry"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_match_active_part "
                              "ON bank_matches (entry_id, part) WHERE undone_at IS NULL"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_bank_matches_group_id ON bank_matches (group_id)"))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding bank match splits")


def _add_bank_match_deposits(engine, inspector, tables: set[str]) -> None:
    """A bank line can be matched to a cash deposit: bank_matches.deposit_id,
    and entry_id becomes optional (one of the two is set)."""
    if "bank_matches" not in tables:
        return
    cols = {c["name"]: c for c in inspector.get_columns("bank_matches")}
    try:
        with engine.begin() as conn:
            if "deposit_id" not in cols:
                conn.execute(text("ALTER TABLE bank_matches ADD COLUMN deposit_id VARCHAR(40)"))
            if engine.dialect.name == "postgresql" and not cols["entry_id"]["nullable"]:
                conn.execute(text("ALTER TABLE bank_matches ALTER COLUMN entry_id DROP NOT NULL"))
            # ponytail: SQLite can't drop NOT NULL in place; only old local dev
            # databases keep it (deposit matches fail there). Prod is Postgres.
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_match_active_deposit "
                              "ON bank_matches (deposit_id) WHERE undone_at IS NULL AND deposit_id IS NOT NULL"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_bank_matches_deposit_id ON bank_matches (deposit_id)"))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding bank match deposits")


def _add_cash_deposit_user(engine, inspector, tables: set[str]) -> None:
    """cash_deposits.user_id: deposits per salesperson. Old rows stay NULL
    and keep meaning the whole beat."""
    if "cash_deposits" not in tables:
        return
    if "user_id" in {c["name"] for c in inspector.get_columns("cash_deposits")}:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE cash_deposits ADD COLUMN user_id VARCHAR(40)"))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding cash_deposits.user_id")


def _add_cash_count_user(engine, inspector, tables: set[str]) -> None:
    """cash_counts.user_id: counted cash per salesperson. Old rows stay NULL
    and keep meaning the whole beat."""
    if "cash_counts" not in tables:
        return
    if "user_id" in {c["name"] for c in inspector.get_columns("cash_counts")}:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE cash_counts ADD COLUMN user_id VARCHAR(40)"))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding cash_counts.user_id")


def _add_bank_import_restore(engine, inspector, tables: set[str]) -> None:
    """bank_imports.deleted_file_hash, for restoring a deleted statement.
    Statements deleted before it have none; their restore checks the lines."""
    if "bank_imports" not in tables:
        return
    if "deleted_file_hash" in {c["name"] for c in inspector.get_columns("bank_imports")}:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE bank_imports ADD COLUMN deleted_file_hash VARCHAR(64)"))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed adding bank_imports.deleted_file_hash")


def _move_bank_matches(engine) -> None:
    """Old one-to-one matches (bank_lines.matched_entry_id) become bank_matches
    rows, once; the old column is then cleared so there's one source of truth."""
    try:
        with engine.begin() as conn:
            rows = conn.execute(text(
                "SELECT id, business_id, matched_entry_id, amount_paise, confirmed_by, confirmed_at "
                "FROM bank_lines WHERE matched_entry_id IS NOT NULL")).all()
            for line_id, business_id, entry_id, paise, by, at in rows:
                conn.execute(text(
                    "INSERT INTO bank_matches (id, business_id, bank_line_id, entry_id, amount_paise, "
                    "confirmed_by, confirmed_at) VALUES (:id, :b, :l, :e, :p, :by, :at)"),
                    {"id": uuid.uuid4().hex, "b": business_id, "l": line_id, "e": entry_id, "p": paise,
                     "by": by, "at": at or ""})
            if rows:
                conn.execute(text("UPDATE bank_lines SET matched_entry_id = NULL WHERE matched_entry_id IS NOT NULL"))
                log.info("migration: moved %d bank matches", len(rows))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed moving bank matches")


def _backfill_beat_assignments(engine) -> None:
    """Beats from before shared beats: their salesperson becomes the primary
    assignment from the beat's creation date. Only beats with no assignment
    yet, so it is safe on every boot."""
    try:
        with engine.begin() as conn:
            rows = conn.execute(text(
                "SELECT b.id, b.assigned_user_id, b.created_at FROM beats b "
                "WHERE b.assigned_user_id IS NOT NULL AND NOT EXISTS "
                "(SELECT 1 FROM beat_assignments a WHERE a.beat_id = b.id)")).all()
            for beat_id, user_id, created in rows:
                conn.execute(text(
                    "INSERT INTO beat_assignments (id, beat_id, user_id, role, valid_from, created_at) "
                    "VALUES (:id, :b, :u, 'primary', :f, :c)"),
                    {"id": uuid.uuid4().hex, "b": beat_id, "u": user_id, "f": (created or "")[:10] or "2000-01-01",
                     "c": created or ""})
            if rows:
                log.info("migration: %d beats got their primary assignment", len(rows))
    except Exception:  # noqa: BLE001 — never let a migration crash boot
        log.exception("migration: failed backfilling beat assignments")


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
            if "credit_limit_version" not in columns:
                conn.execute(text("ALTER TABLE customers ADD COLUMN credit_limit_version INTEGER DEFAULT 0"))
                conn.execute(text("UPDATE customers SET credit_limit_version = CASE WHEN credit_limit IS NULL "
                                  "THEN 0 ELSE 1 END WHERE credit_limit_version IS NULL"))
                log.info("migration: added customers.credit_limit_version")
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
    "utr_missing": "BOOLEAN",
    "gst_quantity": "NUMERIC(12,3)",
    "gst_uqc": "VARCHAR(3)",
    "cheque_bank": "TEXT",
    "cheque_account": "TEXT",
    "ref_hash": "VARCHAR(64)",
    "ref_duplicate_of": "VARCHAR(40)",
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
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ledger_entries_ref_hash ON ledger_entries (ref_hash)"))
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
