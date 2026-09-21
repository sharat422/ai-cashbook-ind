# Database hardening — decision memo

Status: **evidence prepared; migration-framework choice deferred to you.**
This memo captures what was found, what was fixed, what is safe to run now, and
the one architectural decision that gates the rest. Nothing here changes the
production migration path yet.

## 1. What the current DB layer does (and why it's a risk)

On every process start, `app/main.py` runs:

```
Base.metadata.create_all(bind=engine)     # creates missing TABLES only
run_startup_migrations(engine)            # ad-hoc ALTERs + data backfills
```

`run_startup_migrations` (app/migrations.py) mutates schema and data at import
time. Problems:

- **Unordered & unversioned** — no record of which migrations ran; ordering is
  implicit in call order; no way to know a DB's schema version.
- **No rollback** — additive-only, hand-written `ALTER TABLE`; no down path.
- **Silent** — every step is wrapped in `except Exception: log.exception(...)`,
  so a failed migration lets the app boot on a half-migrated schema.
- **Runs on import** — schema mutation is coupled to app start, so any instance
  (including a scaled-out replica) can race to ALTER the same table.

## 2. Concurrency races found (code-verified)

All are time-of-check/time-of-use races; none are enforced at the DB layer today
(only `users.mobile` and `(business_id, user_id)` are unique — `client_id` is
indexed but **not** unique anywhere).

| Flow | Site | Result under concurrent retry |
|---|---|---|
| Duplicate income/expense/ledger | lookup by `client_id` then insert (`routers/incomes.py:48`, etc.) | duplicate money rows |
| Recurring post | `client_id = "recur:<id>:<date>"` lookup then insert (`routers/recurring.py`) | duplicate posted expense |
| Customer version edit | `if version != expected: 409` then commit (`routers/customers.py:136`) | lost update |
| Onboarding | `SELECT business by user_id` then insert (`routers/auth.py:111`) | two businesses per user |
| Owner demote/remove | last-owner guard **now counts active owners** (fixed) but check-and-write still not atomic (`routers/team.py`) | two simultaneous requests → 0 active owners |

**Fixed already:** `team.py` last-active-owner miscount — see
`fix(team): count only active owners` + `tests/test_owner_guard.py`.

**Proper fixes for the rest are DB-level and therefore migrations:**
- unique constraint `(business_id, client_id)` on incomes/expenses; `(customer_id, client_id)` on ledger; `(business_id)` partial-unique for onboarding — then `INSERT ... ON CONFLICT DO NOTHING`/`RETURNING`.
- conditional `UPDATE customers SET ... WHERE id=:id AND version=:expected` (fail if 0 rows) for the version edit.
- `SELECT ... FOR UPDATE` on the owner rows inside demote/remove.

These need Postgres to test meaningfully (SQLite serializes writers) and a real
migration to add the constraints safely (existing duplicates must be reconciled
first — see §4).

## 3. The decision I need (gates everything below)

Replace boot-time mutation with **ordered, versioned migrations**. Two viable paths:

**A. Alembic (recommended).** Standard, versioned up/down revisions, offline SQL
for review, autogenerate from models. Cost: new dependency; must baseline
(`alembic stamp`) the existing prod DB before first `upgrade head`; deploy gains
an explicit `alembic upgrade head` step; boot stops calling `create_all` +
`run_startup_migrations`.

**B. Custom versioned runner (no new dependency).** A `schema_migrations` table
records applied revision ids; ordered migration modules run once via an explicit
command (not on import); readiness compares applied head vs code head. Cost: we
own and test the runner; reinvents a fraction of Alembic.

Either way, **readiness** becomes schema-aware: `/health` (or a new `/ready`)
reports `ok` only when the applied schema version equals the code's expected head
— so a half-migrated instance fails readiness instead of serving traffic.

> Reply with A or B and I'll implement it, migrate the constraints/locks in §2,
> and wire the readiness check.

## 4. Safe, framework-agnostic tooling delivered now

- **`backend/scripts/reconcile.py`** — READ-ONLY report. Detects duplicate
  idempotency-key groups (incomes/expenses/ledger/recurring) and owner/business
  anomalies (no active owner, creator-not-owner, >1 active owner). It opens a
  session, SELECTs, prints, and rolls back — it never writes or deletes. Run it
  against a **sanitized copy** before adding the unique constraints in §2:

  ```
  # from backend/, DATABASE_URL pointed at a disposable/sanitized DB
  DATABASE_URL="postgresql+psycopg2://user:pass@host:5432/cashbook_sanitized" \
      python -m scripts.reconcile          # or --json
  ```
  Exit 0 = clean, 1 = anomalies found. Deciding what to do with any duplicate
  money record is a human call; the tool only surfaces them.

- **Postgres test harness** — `tests/conftest.py` now honours
  `CASHBOOK_TEST_DATABASE_URL` (default stays throwaway SQLite). A safety rail
  **refuses any non-sqlite URL whose DB name doesn't contain `test`**, so the
  destructive suite can never drop a real database. Verified: `cashbook_prod`
  is refused; `cashbook_test` is allowed.

- **`backend-postgres` CI job** — spins up `postgres:16` with a disposable
  `cashbook_test`, runs the full suite against real Postgres, then runs the
  read-only reconciliation. **Needs a CI run to verify** (no Postgres in the
  local dev environment).

## 5. Backup / upgrade / rollback rehearsal (procedure — run on a copy)

Cannot be executed here (no Postgres, no DB copy). Once §3 is chosen:

1. **Backup**: `pg_dump --format=custom cashbook_prod > pre_migration.dump`;
   verify with `pg_restore --list`.
2. **Restore drill**: `createdb cashbook_restore && pg_restore -d cashbook_restore pre_migration.dump`; run `scripts.reconcile` against it.
3. **Upgrade rehearsal**: on `cashbook_restore`, run the new migration to head;
   confirm constraints exist and `reconcile` is clean; run the app smoke tests.
4. **Rollback rehearsal**: apply the down revision (Alembic) or restore the dump
   (custom); confirm schema returns to baseline.
5. Only then schedule the production window.

## 6. Blocked in this environment (not done, not faked)

- No PostgreSQL available → the PG concurrency suite and reconciliation-on-copy
  were **not run here**; the CI job carries them.
- `backend/app/db_preflight.py` and `docs/DATABASE_PREFLIGHT.md` referenced in
  the request **do not exist** in this checkout.
- The auth/private-file checks (public `/uploads` xfail) are **preserved** —
  unchanged by this work.
