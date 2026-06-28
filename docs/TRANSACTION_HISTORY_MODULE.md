# Transaction History Module

A searchable, filterable, infinitely-scrolling ledger over all income + expense
entries — designed to stay smooth at **100,000+ records**.

## Features

- **Infinite scrolling** — cursor pagination via React Query `useInfiniteQuery`.
- **Search** — debounced free-text over category / vendor / notes.
- **Filters** — type (All / Income / Expense) and multi-select **category**.
- **Date range filter** — inclusive from/to.
- **Sort** — by date or amount, ascending or descending.
- Skeleton loader, empty state, error state, pull-to-refresh.

## Why server-side pagination

100k+ rows cannot be held and filtered on the device without janky scrolling and
memory pressure. So **all filtering, sorting, and pagination happen on the
backend**; the client only ever holds the pages it has scrolled through. This is
the single most important design choice for scale here.

## Architecture

```
features/transactions/
├── domain/        # Transaction, TransactionFilters/Query/Page, sort types, repository, use case
├── data/          # DTO + mapper, remote (cursor pagination), repository
├── presentation/
│   ├── hooks/      # useTransactions (infinite), useTransactionFilters
│   ├── components/ # TransactionRow (memoized, fixed height), FilterSheet
│   └── screens/TransactionHistoryScreen.tsx
└── di.ts
```

### FlatList optimization (100k+ records)

The list is tuned so the number of mounted rows stays roughly constant
regardless of dataset size:

| Technique                       | Why it matters                                            |
| ------------------------------- | --------------------------------------------------------- |
| `getItemLayout`                 | Fixed `ROW_HEIGHT` → no per-row measurement; instant jumps |
| `React.memo` row (ref equality) | Only changed rows re-render                                |
| `windowSize={9}`                | Small render window around the viewport                   |
| `initialNumToRender={12}`       | Fast first paint                                          |
| `maxToRenderPerBatch`/`updateCellsBatchingPeriod` | Bounded work per frame while scrolling  |
| `removeClippedSubviews`         | Detaches off-screen rows (Android win)                    |
| stable `keyExtractor`/`renderItem` (useCallback) | Avoids re-creating list internals       |
| Server-side pagination          | Client memory grows with *pages viewed*, not total rows   |

Search is debounced (350ms) so typing never fires a request per keystroke; only
the debounced value feeds the query key.

### Reusable components added

- App-wide (`components/ui`): [`BottomSheet`](../src/components/ui/BottomSheet.tsx).
- Filters (`components/filters`, all generic/reusable):
  [`SearchBar`](../src/components/filters/SearchBar.tsx),
  [`FilterChip`](../src/components/filters/FilterChip.tsx),
  [`DateRangeField`](../src/components/filters/DateRangeField.tsx),
  [`RadioList`](../src/components/filters/RadioList.tsx).
- Feature: `FilterSheet` (composes the above) and `TransactionRow`.

## Required environment variables

In `.env` (copy from `.env.example`), read via
[`src/config/env.ts`](../src/config/env.ts). **Env is inlined at build time —
rebuild after changes.**

| Variable                  | Required | Default                | Description                                  |
| ------------------------- | -------- | ---------------------- | -------------------------------------------- |
| `API_BASE_URL`            | yes      | `http://10.0.2.2:8000` | FastAPI host (no trailing slash).            |
| `API_VERSION`             | yes      | `v1`                   | Version segment.                             |
| `API_TIMEOUT_MS`          | no       | `15000`                | Per-request timeout (ms).                    |
| `TRANSACTIONS_PAGE_SIZE`  | no       | `20`                   | Rows fetched per infinite-scroll page.       |

## FastAPI backend contract

### `GET /api/v1/transactions`

Query params: `limit`, `sort_by` (`date`|`amount`), `sort_dir` (`asc`|`desc`),
`cursor` (opaque, omitted for first page), `search`, `type` (`income`|`expense`),
`categories` (comma-separated), `date_from`, `date_to` (`YYYY-MM-DD`).

Response `200` (`TransactionPageDto`):

```json
{
  "items": [
    {
      "id": "tx_000001",
      "type": "expense",
      "amount": 1200,
      "category": "Fuel",
      "date": "2026-06-10",
      "vendor": "Indian Oil",
      "notes": null,
      "created_at": "2026-06-10T08:00:00Z"
    }
  ],
  "next_cursor": "20",
  "total": 100000
}
```

`next_cursor` is `null` on the last page. Errors use FastAPI's
`{"detail": "..."}` shape (surfaced in the error state).

### Reference stub — serves 100,000 records with filter/sort/pagination

```python
from datetime import date, datetime, timedelta
from fastapi import FastAPI
import random

app = FastAPI()

INCOME_CATS = ["Sales", "Services", "Interest", "Refund", "Investment", "Other"]
EXPENSE_CATS = ["Rent", "Salary", "Fuel", "Food", "Travel", "Utilities", "Miscellaneous"]
VENDORS = ["Indian Oil", "Landlord", "Staff", "Amazon", "Swiggy", "BSES", "Uber"]

# Generate 100k deterministic rows once at startup.
def _seed(n=100_000):
    random.seed(42)
    rows = []
    for i in range(n):
        is_income = random.random() < 0.45
        cat = random.choice(INCOME_CATS if is_income else EXPENSE_CATS)
        d = date(2026, 6, 14) - timedelta(days=random.randint(0, 720))
        rows.append({
            "id": f"tx_{i:06d}",
            "type": "income" if is_income else "expense",
            "amount": random.randint(50, 500000),
            "category": cat,
            "date": d.isoformat(),
            "vendor": None if is_income else random.choice(VENDORS),
            "notes": None,
            "created_at": datetime.utcnow().isoformat() + "Z",
        })
    return rows

ROWS = _seed()

@app.get("/api/v1/transactions")
async def transactions(
    limit: int = 20, cursor: str | None = None,
    sort_by: str = "date", sort_dir: str = "desc",
    search: str | None = None, type: str | None = None,
    categories: str | None = None,
    date_from: str | None = None, date_to: str | None = None,
):
    data = ROWS
    if type in ("income", "expense"):
        data = [r for r in data if r["type"] == type]
    if categories:
        wanted = set(categories.split(","))
        data = [r for r in data if r["category"] in wanted]
    if date_from:
        data = [r for r in data if r["date"] >= date_from]
    if date_to:
        data = [r for r in data if r["date"] <= date_to]
    if search:
        s = search.lower()
        data = [r for r in data
                if s in r["category"].lower()
                or (r["vendor"] or "").lower().find(s) >= 0]

    reverse = sort_dir == "desc"
    key = (lambda r: r["amount"]) if sort_by == "amount" else (lambda r: r["date"])
    data = sorted(data, key=key, reverse=reverse)

    total = len(data)
    start = int(cursor) if cursor else 0
    page = data[start:start + limit]
    next_cursor = str(start + limit) if start + limit < total else None
    return {"items": page, "next_cursor": next_cursor, "total": total}
```

Run with `uvicorn main:app --host 0.0.0.0 --port 8000` (seeding 100k rows takes a
second on startup).

## Manual testing steps

### Setup
1. `cp .env.example .env`; set `API_BASE_URL` for your platform; optionally lower
   `TRANSACTIONS_PAGE_SIZE` to see more pagination.
2. Start the reference stub (100k rows) on port 8000.
3. `npm install` → `npm run android` / `npm run ios`.
4. Log in + create a business → on the Dashboard tap **View all** (next to
   Recent activity) to open Transaction History.

### 1. Infinite scroll @ 100k
1. The header shows `100,000 results`.
2. Fling-scroll fast and far → rows keep loading, the footer shows a spinner at
   page boundaries, and scrolling stays smooth (no blank rows lingering).
3. Scroll to the very end (use a filter to shorten) → footer shows
   "You've reached the end".

### 2. Search (debounced)
1. Type `fuel` → after a brief pause the list refreshes to matching rows and the
   results count updates. Confirm it does **not** refetch on every keystroke.
2. Tap the ✕ in the search box → full list returns.

### 3. Type + category filters
1. Tap **⚙︎ Filters** → set Type = **Expense**, select **Fuel** and **Food**.
2. The badge on **Filters** shows the active count; removable chips appear under
   the controls; the list + count update. Tap a chip's ✕ to remove that filter.

### 4. Date range
1. In the sheet, set **From** and **To** dates → list narrows to that range; a
   date chip appears. **Clear dates** removes it.

### 5. Sort
1. In the sheet, choose **Amount: High to Low** → top rows are the largest
   amounts; the header **Sort** label updates. Try **Date: Oldest first**.

### 6. Empty state
1. Search for gibberish (e.g. `zzzzz`) → **No transactions found** with a
   **Clear filters** action that resets and restores the list.

### 7. Error state + refresh
1. Stop the backend → pull-to-refresh (or relaunch) shows the **error state**
   with **Try again**.
2. Restart the backend → **Try again** loads the list.
3. Pull down from the top at any time to refresh the first page.

### 8. Low-end smoothness
1. On a low-end device / throttled emulator, repeat the fast-scroll test — frame
   rate should hold and memory should stay roughly flat (only viewed pages are
   retained).

## Type-check

```bash
npm run tsc
```
