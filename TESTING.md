# Testing

Two suites cover the app end-to-end: the FastAPI backend (pytest) and the
React Native app's logic layers (Jest). Both run locally with no device or
deployed server.

## Backend — 45 E2E tests (pytest)

Drives the FastAPI app in-process via Starlette's `TestClient` against a
throwaway SQLite DB — real routers, auth, models. See
[backend/tests/README.md](backend/tests/README.md) for the full breakdown.

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # Windows
# source .venv/bin/activate                          # macOS/Linux
pip install -r requirements-dev.txt
python -m pytest
```

Covers: OTP auth + onboarding guards, income/expense idempotency, customer +
khata ledger (recompute, overdue), the unified transactions feed
(filter/search/sort/paginate), dashboard/daily/khata aggregates, AI fallback
paths, and multi-tenant isolation.

## Frontend — 43 tests (Jest)

Tests the app's real logic — utilities, domain rules, Zustand stores, use
cases and repositories — with only the true boundaries mocked (network via
`@api/client`, connectivity via NetInfo, storage via AsyncStorage). No
simulator required.

```bash
npm test              # or: npx jest
npm test -- --watch   # watch mode
```

Highlights:
- **Offline income flow** ([income.repository.test.ts](src/features/income/data/income.repository.test.ts)) —
  the flagship journey: create online → synced; create offline → queued +
  optimistic entry; connection blips → still queued; `syncPending` swaps
  optimistic → synced, and marks failures for retry.
- **Dashboard offline fallback** ([dashboard.repository.test.ts](src/features/dashboard/data/dashboard.repository.test.ts)) —
  the logic behind the "Showing offline figures" banner: remote → local on
  `NetworkError`, rethrow on a genuine `ApiError`.
- **Auth state machine** ([auth.store.test.ts](src/store/auth.store.test.ts)) —
  unauthenticated → pending-business → authenticated → logout.
- **Pure logic** — INR currency formatting, dates, income validation, keyword
  categorization, dashboard emptiness.

> A true device-driving E2E layer (Detox) would additionally require an
> iOS/Android build environment; the Jest suite above covers the same
> behaviour at the logic level without one.

## Run everything

```bash
npm test && (cd backend && python -m pytest)
```
