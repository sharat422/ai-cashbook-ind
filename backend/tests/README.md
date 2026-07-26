# Backend E2E test suite

End-to-end tests that drive the FastAPI app **in-process** through Starlette's
`TestClient` — real routers, real auth, real SQLAlchemy models against a
throwaway SQLite database. No running server and no network required, so they
run anywhere (including CI) in ~2s.

Because the app resolves the active business from the bearer token, each test
provisions its **own** authenticated user + business (`user` / `make_user`
fixtures in [`conftest.py`](conftest.py)). Tests are therefore isolated from
one another even though they share one SQLite file.

## Run

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate        # Windows
# source .venv/bin/activate                            # macOS/Linux
pip install -r requirements-dev.txt

python -m pytest            # all tests, quiet
python -m pytest -v         # verbose, one line per test
python -m pytest tests/test_customers_ledger.py   # a single file
```

> Run with `python -m pytest` (not bare `pytest`) so `backend/` is on the path
> and `import app...` resolves.

## What's covered (45 tests)

| File | Area | Key cases |
|---|---|---|
| `test_auth_onboarding.py` | Auth + onboarding | OTP request/verify, master-OTP login, wrong-OTP 400, same mobile → same user, missing/invalid token (403/401), "no business yet" 400 guard, create/fetch business |
| `test_income_expense.py` | Income & expense | create, **idempotency per `client_id`** (retried offline submit doesn't duplicate), distinct ids, listing scoped to caller |
| `test_customers_ledger.py` | Customers + khata ledger | CRUD, 404 on missing, search + cursor pagination, credit raises / payment lowers `outstanding_amount`, ledger idempotency, **overdue** detection (>30 days) |
| `test_transactions.py` | Unified feed | income+expense merge, filter by type/category/date-range, search vendor, sort by amount, cursor pagination |
| `test_aggregates.py` | Dashboard / daily / khata | today & month totals, cash balance, daily profit + top-category shares, receivable vs payable, today's collections |
| `test_ai_fallback.py` | AI (no keys) | keyword categorization → `Fuel`, unknown → `Miscellaneous`, receipt scan → empty draft, non-empty heuristic insights |
| `test_isolation.py` | Multi-tenant | incomes/customers/dashboard totals never bleed across businesses |

## Notes
- Date-sensitive tests use the same UTC "today" the backend uses, so they stay
  green regardless of when they run.
- The suite sets `DEBUG=true` + `MASTER_OTP=123456` and an isolated
  `DATABASE_URL` **before** importing the app (the engine is built at import).
- Artifacts (`test_e2e.db`, `.pytest_cache/`) are git-ignored.
