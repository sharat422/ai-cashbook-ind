-- Smart CashBook — PostgreSQL reference schema.
-- The FastAPI app auto-creates these tables via SQLAlchemy on startup
-- (Base.metadata.create_all). This file is for manual/Postgres setup and review.

CREATE TABLE IF NOT EXISTS users (
    id         VARCHAR(40) PRIMARY KEY,
    mobile     VARCHAR(20) NOT NULL UNIQUE,
    created_at VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS businesses (
    id             VARCHAR(40) PRIMARY KEY,
    user_id        VARCHAR(40) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_name  TEXT NOT NULL,
    owner_name     TEXT NOT NULL,
    business_type  VARCHAR(60) NOT NULL,
    state          VARCHAR(80) NOT NULL,
    gst_registered BOOLEAN NOT NULL DEFAULT false,
    created_at     VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS incomes (
    id             VARCHAR(40) PRIMARY KEY,
    business_id    VARCHAR(40) NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    amount         DOUBLE PRECISION NOT NULL,
    category       VARCHAR(60) NOT NULL,
    date           VARCHAR(10) NOT NULL,
    notes          TEXT,
    attachment_url TEXT,
    client_id      VARCHAR(80),
    created_at     VARCHAR(40) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incomes_business_date ON incomes(business_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_incomes_client ON incomes(business_id, client_id);

CREATE TABLE IF NOT EXISTS expenses (
    id             VARCHAR(40) PRIMARY KEY,
    business_id    VARCHAR(40) NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    amount         DOUBLE PRECISION NOT NULL,
    category       VARCHAR(60) NOT NULL,
    vendor         TEXT NOT NULL,
    date           VARCHAR(10) NOT NULL,
    notes          TEXT,
    attachment_url TEXT,
    client_id      VARCHAR(80),
    created_at     VARCHAR(40) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON expenses(business_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_client ON expenses(business_id, client_id);

CREATE TABLE IF NOT EXISTS customers (
    id                    VARCHAR(40) PRIMARY KEY,
    business_id           VARCHAR(40) NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    full_name             TEXT NOT NULL,
    mobile                VARCHAR(20) NOT NULL,
    gst_number            VARCHAR(40),
    business_name         TEXT,
    address               TEXT,
    notes                 TEXT,
    outstanding_amount    DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_transaction_date VARCHAR(10),
    is_overdue            BOOLEAN NOT NULL DEFAULT false,
    created_at            VARCHAR(40) NOT NULL,
    updated_at            VARCHAR(40) NOT NULL,
    -- Optimistic-concurrency token: +1 on every edit so a stale edit from a
    -- second device is rejected (HTTP 409) instead of clobbering the other.
    version               INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id               VARCHAR(40) PRIMARY KEY,
    customer_id      VARCHAR(40) NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    type             VARCHAR(20) NOT NULL,
    amount           DOUBLE PRECISION NOT NULL,
    date             VARCHAR(10) NOT NULL,
    invoice_number   VARCHAR(80),
    notes            TEXT,
    payment_method   VARCHAR(20),
    reference_number VARCHAR(80),
    attachment_url   TEXT,
    client_id        VARCHAR(80),
    created_at       VARCHAR(40) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_customer_date ON ledger_entries(customer_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_client ON ledger_entries(customer_id, client_id);

CREATE TABLE IF NOT EXISTS ai_decisions (
    id          VARCHAR(40) PRIMARY KEY,
    business_id VARCHAR(40),
    kind        VARCHAR(40) NOT NULL,
    input_text  TEXT,
    output_json TEXT NOT NULL,
    confidence  DOUBLE PRECISION,
    created_at  VARCHAR(40) NOT NULL
);

-- ---------------------------------------------------------------------------
-- Migrations for EXISTING databases
-- ---------------------------------------------------------------------------
-- `CREATE TABLE IF NOT EXISTS` above never alters a table that already exists,
-- and the app's SQLAlchemy create_all() only adds missing *tables*, not missing
-- *columns*. Run these idempotent statements once against a live database to
-- bring an older `customers` table up to date. Safe to re-run.

-- 2026-08: customer optimistic-concurrency (two-device edit conflict handling).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at VARCHAR(40);
UPDATE customers SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
