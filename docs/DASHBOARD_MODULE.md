# Dashboard Module

The home screen for an onboarded user. Five summary widgets backed by React
Query, with pull-to-refresh, skeleton loaders, empty + error states, and quick
actions / recent activity.

## Widgets

| # | Widget           | Source field   | Accent |
| - | ---------------- | -------------- | ------ |
| 1 | Today's Income   | `todayIncome`  | green  |
| 2 | Today's Expense  | `todayExpense` | red    |
| 3 | Cash Balance     | `cashBalance`  | hero   |
| 4 | Monthly Revenue  | `monthRevenue` | green  |
| 5 | Monthly Expense  | `monthExpense` | red    |

Layout: a full-width **Cash Balance** hero, then two rows pairing today's and
monthly figures.

## Architecture

Same clean-architecture layering as the other features (see
[INCOME_MODULE.md](./INCOME_MODULE.md)):

```
features/dashboard/
├── domain/        # DashboardSummary entity, repository interface, getSummary use case
├── data/          # DTO + mapper, remote (FastAPI), repository
├── presentation/
│   ├── hooks/useDashboardSummary.ts     # React Query query
│   ├── components/                       # reusable cards + skeleton + widgets grid
│   └── screens/DashboardScreen.tsx
└── di.ts          # composition root
```

### State handling (React Query)

`useDashboardSummary` (`useQuery`) drives all four states the screen renders:

| Condition                                   | UI                                  |
| ------------------------------------------- | ----------------------------------- |
| `isLoading && !data`                        | `SummarySkeleton` (animated)        |
| `isError && !data`                          | `ErrorState` with **Try again**     |
| loaded, all figures 0, no local activity    | `EmptyState` with **+ Add Income**  |
| loaded with data                            | `SummaryWidgets` (the 5 cards)      |
| loaded with `source: 'local'`               | widgets + "Showing offline figures" |

### Offline fallback vs error state

The repository distinguishes the two failure modes:

- **Offline / timeout (`NetworkError`)** → it computes the summary **on-device**
  from the stored income + expense entries (including pending offline ones) and
  returns it tagged `source: 'local'`. The query succeeds, the widgets render
  real figures, and a small "Showing offline figures" note appears.
- **Server / HTTP error (`ApiError`, e.g. 500)** → rethrown, so the query fails
  and the **error state** with **Try again** is shown.

So the error state is reserved for genuine backend problems; simply being
offline shows usable local numbers instead.

- **Pull-to-refresh:** a `RefreshControl` calls `refetch()`; `isRefetching`
  drives the spinner. Cached data stays visible while refreshing (no skeleton
  flash on subsequent loads).
- **Recent activity** is read from the local Income/Expense Zustand stores
  (so it reflects optimistic offline entries instantly) and capped to 8 rows.

### Reusable components added

- App-wide (`components/ui`): [`Skeleton`](../src/components/ui/Skeleton.tsx),
  [`EmptyState`](../src/components/ui/EmptyState.tsx),
  [`ErrorState`](../src/components/ui/ErrorState.tsx).
- Dashboard (`features/dashboard/presentation/components`):
  [`SummaryCard`](../src/features/dashboard/presentation/components/SummaryCard.tsx),
  [`HeroBalanceCard`](../src/features/dashboard/presentation/components/HeroBalanceCard.tsx),
  `SummaryWidgets`, `SummarySkeleton` — all reusable and memoized.

## Low-end Android optimizations

- **Skeleton shimmer** uses a single `Animated.Value` pulsing opacity on the
  **native driver** (`useNativeDriver: true`) — runs on the UI thread, no
  per-frame JS work, and no `reanimated` dependency.
- **Memoized cards** (`React.memo`) so a refresh only re-renders cards whose
  amount actually changed.
- **React Query tuning:** `staleTime` 60s (returning to the screen doesn't
  refire), `gcTime` 5m (cached data renders instantly — no skeleton), and a
  single `retry` to avoid hammering the radio on poor networks.
- **Capped recent activity** (8 rows) and plain mapped `View`s instead of a
  nested `VirtualizedList` inside the `ScrollView` — avoids the nesting warning
  and keeps the tree small.
- Flat design (borders, not shadows) to reduce overdraw.

## Required environment variables

Same as the rest of the app — defined in `.env` (copy from `.env.example`) and
read via [`src/config/env.ts`](../src/config/env.ts). **Env is inlined at build
time; rebuild after changes.**

| Variable         | Required | Default                 | Description                       |
| ---------------- | -------- | ----------------------- | --------------------------------- |
| `API_BASE_URL`   | yes      | `http://10.0.2.2:8000`  | FastAPI host (no trailing slash). |
| `API_VERSION`    | yes      | `v1`                    | Version segment.                  |
| `API_TIMEOUT_MS` | no       | `15000`                 | Per-request timeout (ms).         |

## FastAPI backend contract

### `GET /api/v1/dashboard/summary`

Response `200` (`DashboardSummaryDto`, snake_case):

```json
{
  "today_income": 4500,
  "today_expense": 1200,
  "cash_balance": 87600,
  "month_revenue": 152000,
  "month_expense": 64400,
  "as_of": "2026-06-14T10:30:00Z"
}
```

Errors use FastAPI's `{"detail": "..."}` shape; the client surfaces `detail` as
the error message shown in the `ErrorState`.

### Minimal FastAPI stub

```python
from datetime import datetime
from fastapi import FastAPI

app = FastAPI()

# Flip to all-zeros to exercise the empty state; raise to exercise the error state.
@app.get("/api/v1/dashboard/summary")
async def dashboard_summary():
    return {
        "today_income": 4500,
        "today_expense": 1200,
        "cash_balance": 87600,
        "month_revenue": 152000,
        "month_expense": 64400,
        "as_of": datetime.utcnow().isoformat() + "Z",
    }
```

Run with `uvicorn main:app --host 0.0.0.0 --port 8000`.

## Manual testing steps

### Setup
1. `cp .env.example .env`; set `API_BASE_URL` for your platform (Android emulator
   → `http://10.0.2.2:8000`).
2. Start the FastAPI stub above on port 8000.
3. `npm install` → `npm run android` / `npm run ios`.
4. Log in + create a business to land on the **Dashboard**.

### 1. Skeleton loader
1. Cold-launch (or throttle the network) → on first load the widget area shows
   the **animated skeleton** (hero + 4 cards) before data arrives.
2. Confirm the skeleton's footprint matches the real cards (no layout jump when
   data replaces it).

### 2. Data render
1. With the stub returning the sample numbers, verify the five widgets:
   Cash Balance hero `₹87,600`; Today's Income `₹4,500` (green); Today's Expense
   `−₹1,200` (red); Monthly Revenue `₹1,52,000`; Monthly Expense `−₹64,400`.
2. Confirm Indian digit grouping (e.g. `1,52,000`).

### 3. Pull-to-refresh
1. Swipe down from the top → the refresh spinner appears and `refetch` runs.
2. Change the numbers in the stub and pull again → widgets update; **no skeleton
   flash** (cached data stays visible while refreshing).

### 4. Empty state
1. Edit the stub to return all zeros and restart it.
2. Pull-to-refresh (or relaunch) → with no local activity, the widget area shows
   the **empty state** ("No activity yet") with an **+ Add Income** CTA.
3. Tapping the CTA opens the Add Income screen.

### 5. Error state (server error)
1. Make the endpoint return an HTTP error — e.g. temporarily:
   ```python
   from fastapi import HTTPException
   @app.get("/api/v1/dashboard/summary")
   async def dashboard_summary():
       raise HTTPException(status_code=500, detail="Boom")
   ```
2. Relaunch → the widget area shows the **error state** with "Boom" and a
   **Try again** button.
3. Restore the normal handler → tap **Try again** (or pull-to-refresh) → widgets
   load.

### 5b. Offline fallback (NetworkError)
1. Add a couple of income/expense entries while online (so there's local data).
2. Enable **Airplane mode** (or stop the backend so it's unreachable) and
   pull-to-refresh.
3. The widgets render **locally computed** figures with a "Showing offline
   figures from this device" note — **not** the error state.
4. Re-enable networking and pull-to-refresh → figures come from the backend and
   the note disappears.

### 6. Recent activity + offline
1. Add an income/expense (works offline too) → it appears under **Recent
   activity** instantly, newest first, with green `+₹…` / red `−₹…` and a
   **Pending** tag until synced.
2. Capped at 8 rows regardless of history size.

### 7. Low-end smoothness
1. On a low-end device (or an emulator with reduced CPU), confirm the skeleton
   animates smoothly and scrolling/refresh stays responsive.

## Type-check

```bash
npm run tsc
```
