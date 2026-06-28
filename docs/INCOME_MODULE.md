# Income Entry Module

Record business income with offline support, image attachments, and INR
formatting. Built on clean architecture and synced to a FastAPI backend.

## Architecture

```
features/income/
├── domain/                      # innermost layer — no framework imports
│   ├── entities.ts              # Income, IncomeDraft, Attachment, categories
│   ├── repository.ts            # IncomeRepository interface, PendingIncome
│   ├── validation.ts            # pure draft validation rules
│   └── usecases/
│       ├── createIncome.ts      # validate → repo.create
│       └── syncPendingIncomes.ts# flush the offline queue
├── data/                        # implements the domain contract
│   ├── income.dto.ts            # FastAPI DTO + mapper to entity
│   ├── income.remote.ts         # REST data source (multipart upload)
│   ├── income.local.ts          # offline-durable source (wraps Zustand store)
│   └── income.repository.ts     # orchestrates remote + local + connectivity
├── presentation/                # UI layer
│   ├── store/income.store.ts    # Zustand store (persisted queue + entries)
│   ├── hooks/                    # useIncomeForm, useCreateIncome, useIncomeSync…
│   ├── screens/AddIncomeScreen.tsx
│   └── OfflineSyncManager.tsx   # headless background syncer
└── di.ts                        # composition root: use cases ← repository
```

**Dependency rule:** `presentation → domain ← data`. Screens and hooks call
use cases (via `di.ts`); they never import a data source directly. The
repository is the only place that knows about HTTP, AsyncStorage, and
connectivity.

### Offline flow

1. User submits → `createIncomeUseCase` validates the draft.
2. `incomeRepository.create`:
   - **Online:** `POST /incomes` (multipart) → store the synced entry.
   - **Offline (or request fails):** enqueue the draft + show an optimistic
     `pending` entry. Nothing is ever lost.
3. `OfflineSyncManager` (mounted in `App.tsx`) calls `syncPending` on app start,
   on every reconnect, and when the app returns to the foreground. Each queued
   draft carries a `client_id` so retries are **idempotent** on the server.

State (entries + queue) is persisted to AsyncStorage, so pending drafts survive
app restarts.

## Required environment variables

Defined in `.env` (copy from `.env.example`) and read through
[`src/config/env.ts`](../src/config/env.ts). **Env is inlined at build time —
rebuild the app after any change.**

| Variable         | Required | Default                 | Description                                              |
| ---------------- | -------- | ----------------------- | -------------------------------------------------------- |
| `API_BASE_URL`   | yes      | `http://10.0.2.2:8000`  | FastAPI host, no trailing slash, no `/api`.              |
| `API_VERSION`    | yes      | `v1`                    | Version segment; requests hit `{BASE}/api/{VERSION}/…`.  |
| `API_TIMEOUT_MS` | no       | `15000`                 | Per-request timeout in ms.                               |

Host reachability cheatsheet:

| Target            | `API_BASE_URL`              |
| ----------------- | --------------------------- |
| Android emulator  | `http://10.0.2.2:8000`      |
| iOS simulator     | `http://localhost:8000`     |
| Physical device   | `http://<your-LAN-ip>:8000` |

> Plain-HTTP localhost is allowed in debug builds. For release builds you'll
> need an HTTPS endpoint (or an ATS/network-security-config exception).

## FastAPI backend contract

The remote data source ([`income.remote.ts`](../src/features/income/data/income.remote.ts))
expects:

### `POST /api/v1/incomes` — create

`multipart/form-data`:

| Field        | Type   | Required | Notes                                  |
| ------------ | ------ | -------- | -------------------------------------- |
| `amount`     | number | yes      | Whole INR.                             |
| `category`   | string | yes      | One of the income categories.          |
| `date`       | string | yes      | `YYYY-MM-DD`.                          |
| `client_id`  | string | yes      | Idempotency key — dedupe on retries.   |
| `notes`      | string | no       | ≤ 280 chars.                           |
| `attachment` | file   | no       | Image (jpeg/png).                      |

Response `200` (`IncomeDto`):

```json
{
  "id": "inc_123",
  "amount": 1500,
  "category": "Sales",
  "date": "2026-06-14",
  "notes": "Counter sale",
  "attachment_url": "https://.../receipt.jpg",
  "created_at": "2026-06-14T09:30:00Z"
}
```

Errors should use FastAPI's default `{"detail": "..."}` shape — the client
surfaces `detail` as the user-facing message.

### Minimal FastAPI stub for local testing

```python
from datetime import datetime
from fastapi import FastAPI, Form, File, UploadFile

app = FastAPI()

@app.post("/api/v1/incomes")
async def create_income(
    amount: float = Form(...),
    category: str = Form(...),
    date: str = Form(...),
    client_id: str = Form(...),
    notes: str | None = Form(None),
    attachment: UploadFile | None = File(None),
):
    return {
        "id": client_id,
        "amount": amount,
        "category": category,
        "date": date,
        "notes": notes,
        "attachment_url": attachment.filename if attachment else None,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
```

Run it: `uvicorn main:app --host 0.0.0.0 --port 8000` (use `0.0.0.0` so an
emulator/device can reach it).

## Native setup for attachments

`react-native-image-picker` needs permission strings:

- **iOS** — add to `ios/<App>/Info.plist`:
  - `NSCameraUsageDescription` — "Attach photos of receipts to income entries."
  - `NSPhotoLibraryUsageDescription` — "Attach images from your library."
- **Android** — camera capture uses a runtime `CAMERA` permission; the library
  requests it. No manifest entry needed for gallery on Android 13+.

After adding native deps: `cd ios && pod install` (iOS), then rebuild.

## Manual testing steps

### Setup
1. `cp .env.example .env` and set `API_BASE_URL` for your platform (table above).
2. Start the FastAPI stub on port 8000.
3. `npm install` → (`cd ios && pod install`) → `npm run android` / `npm run ios`.
4. Log in and complete business creation to reach the **Dashboard**.

### 1. Happy path (online)
1. Tap **+ Add Income**.
2. Enter amount `1500` → confirm it renders as `15,00` grouping while typing
   (e.g. `12,34,567` for larger values) with a fixed ₹ symbol.
3. Pick a **Category**, leave **Date** as today, add a note.
4. Tap **Save income** → expect "Income added" → back on Dashboard the entry
   appears under **Recent income** as `₹1,500` with **no** Pending badge.
5. Confirm the FastAPI server received the `POST /api/v1/incomes`.

### 2. Form validation
1. Open the form and tap **Save income** immediately.
2. Expect inline errors: Amount ("Enter an amount"), Category, Date is
   prefilled so valid.
3. Enter amount `0` → "Amount must be greater than ₹0".
4. Enter `99999999` (> ₹1 cr) → "Amount looks too large".
5. Type a 281-character note → "Notes must be 280 characters or fewer" and the
   counter turns capped.
6. Fix fields → errors clear as you type (touched-field validation).

### 3. Image attachment
1. Tap **+ Add receipt / image** → choose camera or gallery.
2. Select/take a photo → a thumbnail + filename appear with a **Remove** action.
3. Save → confirm the backend received a file part named `attachment`.
4. Re-open the form, attach, then **Remove** → thumbnail clears.

### 4. Offline support (core)
1. Enable **Airplane mode** (or stop the backend).
2. Add an income entry and save → expect "Saved offline" alert.
3. Dashboard shows the entry with a **Pending** badge and an
   **"Offline · 1 pending sync"** header.
4. Force-quit and reopen the app → the pending entry is still there (persisted).
5. Turn networking back on → within a moment the badge clears, the header shows
   "Syncing…" then disappears, and the backend receives the queued `POST`.
6. Verify the same `client_id` was used (idempotent retry — no duplicate).

### 5. Mid-request drop
1. Add throttling/kill the server right as you tap Save.
2. The request fails but the entry is still queued (not lost) and syncs on the
   next reconnect.

### 6. Currency formatting
- ₹0 input shows placeholder `0`.
- `100000` displays as `1,00,000`; dashboard list shows `₹1,00,000`.

## Type-check

```bash
npm run tsc
```
