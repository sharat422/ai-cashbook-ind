# Customer Management Module

A premium CRM for the Business OS — searchable, infinitely-scrolling customer
list with full CRUD, profiles, and dues status indicators (CRED / Google Pay
feel).

## Features

| Feature | Where |
| --- | --- |
| Customer list (cards) | [CustomerListScreen](../src/features/customers/presentation/screens/CustomerListScreen.tsx) |
| Add / Edit | [CustomerFormScreen](../src/features/customers/presentation/screens/CustomerFormScreen.tsx) |
| Delete | [CustomerProfileScreen](../src/features/customers/presentation/screens/CustomerProfileScreen.tsx) |
| Search (debounced) | `SearchBar` → query key |
| Infinite scroll | `useInfiniteQuery` + `getItemLayout` |
| Pull to refresh | `RefreshControl` |
| Profile + tap-to-call | profile screen |

**Fields:** Full Name, Mobile, GST Number, Business Name, Address, Notes.
**Derived:** outstanding amount, last transaction date, overdue flag → status.

**Status indicators:** `No dues` (green), `Pending` (amber), `Overdue` (red) —
tokens in [statusStyle.ts](../src/features/customers/presentation/components/statusStyle.ts).

## Architecture (clean)

```
features/customers/
├── domain/        # Customer/Draft, customerStatus(), validation (GSTIN/mobile), repository, use cases
├── data/          # DTO + mapper, remote (REST CRUD), repository
├── presentation/
│   ├── hooks/      # useCustomers (infinite+search), useCustomerForm, useCustomerMutations
│   ├── components/ # CustomerCard, CustomerForm, StatusBadge (+ reusable Avatar in components/ui)
│   └── screens/    # List, Form, Profile
└── di.ts
```

### Optimistic updates

[`useCustomerMutations`](../src/features/customers/presentation/hooks/useCustomerMutations.ts)
applies **optimistic updates** to the cached infinite list so the UI responds
instantly:

- **Create** prepends a placeholder customer to the first page (and bumps the
  count).
- **Update** patches the matching customer in place.
- **Delete** removes it from the list.

On error it **rolls back** to the snapshot; `onSettled` it **invalidates** the
list so the server's authoritative data (real id, outstanding amount, overdue
flag) replaces the optimistic copy.

> This is the optimistic layer suited to a **server-paginated** list — instant
> feedback without fighting the pagination model. It is *not* full offline
> persistence (surviving a restart while offline): customers are owned by the
> backend, which computes the ledger fields. If you want true offline create
> queuing like the expense module, that's a separate local-store layer.

## Required environment variables

Reuses the existing API config (no new vars):

| Variable       | Required | Default                | Description           |
| -------------- | -------- | ---------------------- | --------------------- |
| `API_BASE_URL` | yes      | `http://10.0.2.2:8000` | FastAPI host.         |
| `API_VERSION`  | yes      | `v1`                   | Version segment.      |

## Backend contract

| Method | Path | Body / Query | Returns |
| --- | --- | --- | --- |
| GET | `/api/v1/customers` | `limit`, `cursor`, `search` | `{items, next_cursor, total}` |
| GET | `/api/v1/customers/{id}` | — | `CustomerDto` |
| POST | `/api/v1/customers` | customer body | `CustomerDto` |
| PATCH | `/api/v1/customers/{id}` | customer body | `CustomerDto` |
| DELETE | `/api/v1/customers/{id}` | — | `204` |

`CustomerDto` (snake_case):

```json
{
  "id": "cus_001",
  "full_name": "Rajesh Sharma",
  "mobile": "9876543210",
  "gst_number": "29ABCDE1234F1Z5",
  "business_name": "Sharma Traders",
  "address": "12 MG Road, Bengaluru",
  "notes": "Prefers UPI",
  "outstanding_amount": 4200,
  "last_transaction_date": "2026-06-12",
  "is_overdue": true,
  "created_at": "2026-05-01T10:00:00Z"
}
```

`outstanding_amount`, `last_transaction_date`, and `is_overdue` are computed by
the backend from the customer's ledger; the app derives the colour status from
them.

### Reference FastAPI stub (in-memory CRUD + cursor search)

```python
# pip install fastapi "uvicorn[standard]" pydantic
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel

app = FastAPI()

class CustomerIn(BaseModel):
    full_name: str
    mobile: str
    gst_number: Optional[str] = None
    business_name: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None

DB: dict[str, dict] = {}
SEQ = 0

def _dto(c: dict) -> dict:
    # outstanding/last_txn/is_overdue would come from the ledger; stubbed here.
    return {**c}

@app.get("/api/v1/customers")
def list_customers(limit: int = 20, cursor: Optional[str] = None, search: Optional[str] = None):
    rows = list(DB.values())
    if search:
        s = search.lower()
        rows = [c for c in rows if s in c["full_name"].lower()
                or s in (c.get("business_name") or "").lower()
                or s in c["mobile"]]
    rows.sort(key=lambda c: c["created_at"], reverse=True)
    start = int(cursor) if cursor else 0
    page = rows[start:start + limit]
    nxt = str(start + limit) if start + limit < len(rows) else None
    return {"items": [_dto(c) for c in page], "next_cursor": nxt, "total": len(rows)}

@app.get("/api/v1/customers/{cid}")
def get_customer(cid: str):
    if cid not in DB:
        raise HTTPException(404, "Not found")
    return _dto(DB[cid])

@app.post("/api/v1/customers")
def create_customer(body: CustomerIn):
    global SEQ
    SEQ += 1
    cid = f"cus_{SEQ:04d}"
    c = {
        "id": cid, **body.model_dump(),
        "outstanding_amount": 0, "last_transaction_date": None,
        "is_overdue": False, "created_at": datetime.utcnow().isoformat() + "Z",
    }
    DB[cid] = c
    return _dto(c)

@app.patch("/api/v1/customers/{cid}")
def update_customer(cid: str, body: CustomerIn):
    if cid not in DB:
        raise HTTPException(404, "Not found")
    DB[cid].update(body.model_dump())
    return _dto(DB[cid])

@app.delete("/api/v1/customers/{cid}", status_code=204)
def delete_customer(cid: str):
    DB.pop(cid, None)
    return Response(status_code=204)
```

Run: `uvicorn main:app --host 0.0.0.0 --port 8000`.

> To exercise the status colours, seed a couple of rows with non-zero
> `outstanding_amount` and `is_overdue: true` in `DB`.

## Manual testing steps

### Setup
1. Run the stub on port 8000 (seed a few customers for visible statuses).
2. App: `cp .env.example .env`, set `API_BASE_URL`; `npm install` →
   `npm run android` / `npm run ios`.
3. Log in + create a business → Dashboard → **👥 Customers**.

### 1. List, cards, status
1. Confirm each card shows the avatar (initials + colour), name, business /
   mobile, last transaction date, outstanding amount, and a status pill
   (green/amber/red).
2. The header shows the total count.

### 2. Add (optimistic)
1. Tap **+ Add** → fill Full name + a valid 10-digit mobile (others optional).
2. Try an invalid GSTIN → inline error; fix it.
3. Save → the new customer appears at the top of the list **immediately**
   (optimistic), then reconciles with the server.

### 3. Edit
1. Open a customer → **Edit** → change the business name → **Save changes**.
2. The card updates instantly; the profile reflects the change.

### 4. Delete
1. Profile → **Delete customer** → confirm → it disappears from the list at once.
2. If the backend rejects it, the row reappears (rollback).

### 5. Search
1. Type a name / business / number → after a brief pause the list filters.
2. Clear (✕) → full list returns.

### 6. Infinite scroll + pull to refresh
1. With > 20 customers, fast-scroll → more pages load (footer spinner).
2. Pull down from the top → the first page refreshes.

### 7. Profile actions
1. Tap **Mobile** or **Call** → the dialer opens with the number.

## Type-check

```bash
npm run tsc
```
