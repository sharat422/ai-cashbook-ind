# Daily Summary Engine + Notification Service

Generates an end-of-day summary — **income, expense, profit, and top expense
categories** — and delivers it through a pluggable notification service
(in-app today, **WhatsApp-ready** for later).

## What it generates

```
📊 Daily Summary — 14 Jun 2026
Income: ₹12,400
Expense: ₹7,150
Profit: ₹5,250
Top spend: Inventory ₹3,000, Fuel ₹1,840, Food ₹1,310
```

| Output | Source |
| --- | --- |
| Income summary | sum of the day's income |
| Expense summary | sum of the day's expenses |
| Profit summary | income − expense (loss shown in red) |
| Top expense categories | per-category totals + share of spend, highest first |

## Architecture (clean)

```
features/daily-summary/
├── domain/
│   ├── entities.ts        # DailySummary, CategoryTotal
│   ├── format.ts          # formatSummaryMessage / Title (shared by all channels)
│   ├── repository.ts
│   └── usecases/getDailySummary.ts
├── data/
│   ├── dailySummary.dto.ts
│   ├── dailySummary.remote.ts   # GET /summary/daily?date=
│   ├── dailySummary.local.ts    # offline compute from income+expense stores
│   └── dailySummary.repository.ts # remote → local fallback (NetworkError)
├── presentation/
│   ├── store/summarySettings.store.ts  # enabled, time, lastSentDate
│   ├── dispatch.ts                      # sendDailySummaryNow / isSummaryDue
│   ├── DailySummaryManager.tsx          # foreground scheduler (mounted in App)
│   ├── hooks/useDailySummary.ts
│   ├── components/                      # ProfitHeroCard, TopCategoriesList
│   └── screens/DailySummaryScreen.tsx

services/notifications/                  # reusable, feature-agnostic
├── types.ts                # NotificationChannel, NotificationPayload, AppNotification
├── inbox.store.ts          # persisted in-app inbox (the bell)
├── inAppChannel.ts         # default channel → inbox
├── whatsappChannel.ts      # WhatsApp channel (gated behind WHATSAPP_ENABLED)
└── notificationService.ts  # fans out to all available channels

features/notifications/presentation/screens/NotificationsScreen.tsx  # inbox UI
```

### Notification service — channel abstraction

The service fans a `NotificationPayload` out to every **available** channel,
best-effort (one channel failing never blocks another):

```ts
interface NotificationChannel {
  id: string;
  label: string;
  isAvailable(): Promise<boolean>;
  send(payload: NotificationPayload): Promise<void>;
}
```

- **`inAppChannel`** — always available; writes to the persisted inbox shown by
  the bell on the dashboard. No native permissions.
- **`whatsappChannel`** — wired now, dormant until `WHATSAPP_ENABLED=true` and a
  recipient mobile exists. `isAvailable()` returns false otherwise, so the
  service simply skips it.

Adding an **OS push / local-notification** channel later is just another
`NotificationChannel` registered via `notificationService.register(...)` — no
other code changes.

### Scheduling

`DailySummaryManager` (mounted in `App.tsx`) checks once a minute while the app
is foregrounded — and on every resume — whether the summary is **due** (enabled,
not yet sent today, past the configured time) and dispatches it once
(`lastSentDate` dedupes).

> ⚠️ **Foreground only.** This covers "app is open". **Background delivery (app
> closed)** needs an OS-level scheduler (`@notifee/react-native` triggers /
> `react-native-background-fetch`) or — recommended for reliability — a
> **backend cron** that computes the summary and sends a push + WhatsApp at the
> scheduled time. The channel/service abstraction here is exactly what that
> backend job would call; only the trigger moves server-side.

## Prepare for WhatsApp integration (later)

Everything client-side is ready:

1. The `whatsappChannel` already formats and POSTs the message.
2. The same `formatSummaryMessage()` produces the WhatsApp text.
3. Flip `WHATSAPP_ENABLED=true` once the backend endpoint exists.

**Backend to build later** — `POST /api/v1/notifications/whatsapp`:

```json
{ "to": "9876543210", "message": "📊 Daily Summary — ...\nIncome: ₹..." }
```

The backend owns the **WhatsApp Business Cloud API** call (Meta Graph API):
`POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages` with a
`Bearer {WHATSAPP_TOKEN}`. Free-form text only works inside the 24-hour customer
window; outside it you must send a pre-approved **template** — so a daily
summary push typically uses an approved template with the figures as variables.

Backend env (for later): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_TEMPLATE_NAME`.

## Required environment variables

App `.env`, read via [`src/config/env.ts`](../src/config/env.ts):

| Variable                     | Required | Default                | Description                                          |
| ---------------------------- | -------- | ---------------------- | ---------------------------------------------------- |
| `API_BASE_URL`               | yes      | `https://smart-cashbook-api.onrender.com` (staging) | FastAPI host.                                        |
| `API_VERSION`                | yes      | `v1`                   | Version segment.                                     |
| `DAILY_SUMMARY_DEFAULT_HOUR` | no       | `20`                   | Default delivery hour (0–23, local).                 |
| `WHATSAPP_ENABLED`           | no       | `false`                | Turns on the WhatsApp channel (needs backend ready). |

## Backend contract

### `GET /api/v1/summary/daily?date=YYYY-MM-DD`

```json
{
  "date": "2026-06-14",
  "income": 12400,
  "expense": 7150,
  "profit": 5250,
  "transaction_count": 9,
  "top_expense_categories": [
    {"category": "Inventory", "amount": 3000, "share": 0.42},
    {"category": "Fuel", "amount": 1840, "share": 0.26},
    {"category": "Food", "amount": 1310, "share": 0.18}
  ]
}
```

When offline / on a `NetworkError`, the app computes the same shape **on-device**
from the income + expense stores (tagged "offline figures"). A server HTTP error
surfaces the error state.

### Minimal FastAPI stub

```python
from datetime import date as date_type
from fastapi import FastAPI

app = FastAPI()

@app.get("/api/v1/summary/daily")
def daily_summary(date: str | None = None):
    d = date or date_type.today().isoformat()
    return {
        "date": d,
        "income": 12400,
        "expense": 7150,
        "profit": 12400 - 7150,
        "transaction_count": 9,
        "top_expense_categories": [
            {"category": "Inventory", "amount": 3000, "share": 0.42},
            {"category": "Fuel", "amount": 1840, "share": 0.26},
            {"category": "Food", "amount": 1310, "share": 0.18},
        ],
    }
```

Run: `uvicorn main:app --host 0.0.0.0 --port 8000`.

## Manual testing steps

### Setup
1. Backend: run the stub on port 8000 (or rely on the offline fallback).
2. App: `cp .env.example .env`, set `API_BASE_URL`; `npm install` →
   `npm run android` / `npm run ios`.
3. Log in + create a business → Dashboard.

### 1. View the summary
1. Tap **📅 Daily summary**.
2. Confirm the hero shows **Income / Expense / Profit** (loss in red) and **Top
   expense categories** render as labelled bars with % shares.
3. With the stub down but local entries present, add an expense or two for today
   and confirm the summary computes **offline** (tagged "offline figures").

### 2. Send now → in-app inbox
1. On the summary screen tap **Send summary now**.
2. Expect an alert "Delivered to: in-app". Go back to the Dashboard → the **🔔
   bell** shows an unread badge.
3. Tap the bell → the **Notifications** inbox shows the summary (title + body);
   opening it marks it read and clears the badge.

### 3. Schedule controls
1. Set the delivery time (− / +) to one minute from now and ensure the toggle is
   **On**.
2. Keep the app open ~1 minute → the summary auto-dispatches once (the bell
   badge appears). It won't fire again the same day (deduped by `lastSentDate`).
3. Turn the toggle **Off** → no further auto-dispatch.

### 4. WhatsApp readiness
1. With `WHATSAPP_ENABLED=false` (default), **Send now** delivers only to in-app
   — the WhatsApp channel reports unavailable and is skipped.
2. Set `WHATSAPP_ENABLED=true`, rebuild, and point `API_BASE_URL` at a backend
   implementing `POST /notifications/whatsapp`. **Send now** should then also
   attempt WhatsApp; a failing/absent endpoint is swallowed and never blocks the
   in-app delivery.

### 5. Persistence
1. Force-quit and reopen → the inbox history persists; an already-sent day stays
   deduped.

## Type-check

```bash
npm run tsc
```
