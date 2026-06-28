# Expense Entry Module

Record business expenses with offline-first persistence, optimistic updates,
image attachments, and INR formatting. Synced to a FastAPI backend.

## Fields

| Field        | Required | Notes                                            |
| ------------ | -------- | ------------------------------------------------ |
| Amount       | yes      | Whole INR, `> 0` and `≤ ₹1 cr`.                  |
| Category     | yes      | Rent, Salary, Fuel, Food, Travel, Utilities, Miscellaneous. |
| Date         | yes      | `YYYY-MM-DD`, not in the future.                 |
| Vendor       | yes      | Who was paid; ≤ 80 chars.                        |
| Notes        | no       | ≤ 280 chars.                                     |
| Attachment   | no       | Bill / receipt image (jpeg/png).                 |

## Architecture

Same clean-architecture layering as the Income module — see
[INCOME_MODULE.md](./INCOME_MODULE.md) for the rationale.

```
features/expense/
├── domain/                       # entities, repository interface, validation, use cases
├── data/                         # DTO + mapper, remote (FastAPI), local (store), repository
├── presentation/                 # Zustand store, hooks, AddExpenseScreen, ExpenseSyncManager
└── di.ts                         # composition root: use cases ← repository
```

Shared cross-feature types (`Attachment`, `SyncStatus`) live in
[`src/shared/types/attachment.ts`](../src/shared/types/attachment.ts) so Income
and Expense don't import each other's domain.

### Offline-first + optimistic flow

This is the key difference from Income's "online-then-fallback" approach — here
**every** create is optimistic:

1. Submit → `createExpenseUseCase` validates the draft.
2. `expenseRepository.create` **immediately**:
   - inserts an optimistic `pending` entry into the store (UI updates at once), and
   - enqueues the draft — then returns without awaiting the network.
3. `useCreateExpense.onSuccess` fires a background `syncPending()`. When online,
   the entry is confirmed within moments; the optimistic entry is swapped for
   the server version and dequeued. On failure it's flagged `failed` and stays
   queued.
4. `ExpenseSyncManager` (mounted in `App.tsx`) also flushes the queue on app
   start, on every reconnect, and on foreground. Each draft carries a
   `client_id`, so retries are **idempotent** server-side (no duplicates).

State (entries + queue) is persisted to AsyncStorage, so optimistic/pending
entries survive app restarts.

## Reusable UI added

- [`ChipSelect`](../src/components/form/ChipSelect.tsx) — wrapping pill selector
  with optional emoji icons (used for the category picker).
- [`TextField`](../src/components/form/TextField.tsx) — single-line control to
  pair with `FormField` (used for Vendor).

Both are generic/feature-agnostic and reusable elsewhere.

## Required environment variables

Identical to the Income module — defined in `.env` (copy from `.env.example`)
and read via [`src/config/env.ts`](../src/config/env.ts). **Env is inlined at
build time; rebuild after changes.**

| Variable         | Required | Default                 | Description                       |
| ---------------- | -------- | ----------------------- | --------------------------------- |
| `API_BASE_URL`   | yes      | `http://10.0.2.2:8000`  | FastAPI host (no trailing slash). |
| `API_VERSION`    | yes      | `v1`                    | Version segment.                  |
| `API_TIMEOUT_MS` | no       | `15000`                 | Per-request timeout (ms).         |

## FastAPI backend contract

### `POST /api/v1/expenses` — create

`multipart/form-data`:

| Field        | Type   | Required | Notes                         |
| ------------ | ------ | -------- | ----------------------------- |
| `amount`     | number | yes      | Whole INR.                    |
| `category`   | string | yes      | One of the 7 categories.      |
| `date`       | string | yes      | `YYYY-MM-DD`.                |
| `vendor`     | string | yes      | Payee.                        |
| `client_id`  | string | yes      | Idempotency key for retries.  |
| `notes`      | string | no       | ≤ 280 chars.                  |
| `attachment` | file   | no       | Image.                        |

Response `200` (`ExpenseDto`):

```json
{
  "id": "exp_123",
  "amount": 25000,
  "category": "Rent",
  "date": "2026-06-01",
  "vendor": "Landlord",
  "notes": "June rent",
  "attachment_url": "https://.../bill.jpg",
  "created_at": "2026-06-14T10:00:00Z"
}
```

Errors use FastAPI's `{"detail": "..."}` shape; the client surfaces `detail`.

### Minimal FastAPI stub

```python
from datetime import datetime
from fastapi import FastAPI, Form, File, UploadFile

app = FastAPI()

@app.post("/api/v1/expenses")
async def create_expense(
    amount: float = Form(...),
    category: str = Form(...),
    date: str = Form(...),
    vendor: str = Form(...),
    client_id: str = Form(...),
    notes: str | None = Form(None),
    attachment: UploadFile | None = File(None),
):
    return {
        "id": client_id,
        "amount": amount,
        "category": category,
        "date": date,
        "vendor": vendor,
        "notes": notes,
        "attachment_url": attachment.filename if attachment else None,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
```

Run with `uvicorn main:app --host 0.0.0.0 --port 8000`.

## Native setup for attachments

Same as Income — `react-native-image-picker` needs the iOS `Info.plist`
`NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` strings. See
[INCOME_MODULE.md](./INCOME_MODULE.md#native-setup-for-attachments).

## Manual testing steps

### Setup
1. `cp .env.example .env`; set `API_BASE_URL` for your platform.
2. Start the FastAPI stub (above) on port 8000.
3. `npm install` → (`cd ios && pod install`) → `npm run android` / `npm run ios`.
4. Log in + create a business to reach the **Dashboard**.

### 1. Optimistic update (online)
1. Tap **− Expense**.
2. Enter amount `25000`, pick **Rent**, set Vendor `Landlord`, leave today's date.
3. Tap **Save expense** → the screen closes **instantly** and the entry appears
   at the top of **Recent activity** in red as `−₹25,000`.
4. Within a moment its **Pending** tag disappears (confirmed by the server).
   Verify the backend received `POST /api/v1/expenses`.

### 2. Validation
1. Open the form and tap **Save expense** immediately → inline errors on
   Amount, Category, and Vendor (Date is prefilled).
2. Amount `0` → "Amount must be greater than ₹0"; `99999999` → "looks too large".
3. Clear Vendor → "Enter a vendor / payee".
4. Errors clear per-field as you correct them (touched-field validation).

### 3. Category chips
1. Tap through categories — only one stays selected (filled blue) and each
   shows its emoji. The selected value drives the saved `category`.

### 4. Image attachment
1. **+ Add receipt / image** → camera or gallery → thumbnail + **Remove** appear.
2. Save → backend receives an `attachment` file part. Re-open → **Remove** clears it.

### 5. Offline-first (core)
1. Enable **Airplane mode** (or stop the backend).
2. Save an expense → it still appears immediately with a **Pending** tag, and the
   Dashboard header shows **"Offline · N pending sync"**.
3. Force-quit and reopen → the pending entry is still there (persisted).
4. Restore networking → within a moment the **Pending** tag clears, the header
   shows "Syncing…" then disappears, and the backend receives the queued `POST`
   with the **same `client_id`** (idempotent — no duplicate).

### 6. Failed sync retry
1. Keep the device online but stop the backend.
2. Save an expense → optimistic entry shows; sync fails → tag flips to **Failed**
   and it stays queued.
3. Start the backend and background/foreground the app → it retries and syncs.

### 7. Currency + dashboard
- `100000` shows `−₹1,00,000` (Indian grouping). Income rows show `+₹…` in green,
  expense rows `−₹…` in red, sorted newest first.

## Type-check

```bash
npm run tsc
```
