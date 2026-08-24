# Smart CashBook — Manual Test Plan

End-to-end manual test steps for the whole app, derived from the codebase.
Each case is **Steps → Expected**. Run on a TestFlight/dev build against the
deployed backend (`https://smart-cashbook-api.onrender.com`).

---

## 0. Prerequisites & setup

| # | Check | Expected |
|---|---|---|
| 0.1 | App is built from `main` with `API_BASE_URL=https://smart-cashbook-api.onrender.com` (see [.env.example](.env.example)) | App can reach the backend over HTTPS |
| 0.2 | Backend is awake: open `https://smart-cashbook-api.onrender.com/health` in a browser | `{"status":"ok"}` |
| 0.3 | **Auth mode**: confirm [`bypassAuth`](src/config/constants.ts) value | `false` → real login screens (test all of §1). `true` → app skips login and opens Dashboard directly, but has **no token**, so data calls fail — set to `false` to test end-to-end |
| 0.4 | Fresh install (or logged out) | App opens on the Splash → Login |

**Login credentials for testing:** any 10-digit mobile number + OTP **`123456`** (backend runs in DEBUG mode; the master OTP is always accepted — no real SMS).

> ⚠️ First launch after the backend has been idle >15 min may take ~30–60s to
> respond while the free Render instance cold-starts. The 45s client timeout
> covers it; if a screen shows offline figures, pull-to-refresh after a minute.

---

## 1. Authentication & onboarding

### 1.1 Splash
- **Steps:** Launch the app.
- **Expected:** Branded splash shows briefly (~1.5s), then routes to Login (no token), Onboarding (token, no business), or Dashboard (fully set up).

### 1.2 Mobile number validation
- **Steps:** On Login, tap **Continue** with the field empty; then type letters; then `12345`; then a valid `9876543210`.
- **Expected:** Empty/short/invalid show an inline error; only digits are accepted (max 10); `+91` prefix is fixed; a valid number enables the OTP request.

### 1.3 Request OTP
- **Steps:** Enter a valid 10-digit number → **Continue**.
- **Expected:** Button shows loading; navigates to the OTP screen showing "+91 <number>"; "Demo mode: use OTP 123456" hint is visible.

### 1.4 OTP entry & auto-submit
- **Steps:** Enter `123456`.
- **Expected:** Auto-submits on the 6th digit; on success routes onward (to Onboarding for a new user, or Dashboard if a business already exists).

### 1.5 Wrong OTP
- **Steps:** Enter `000000`.
- **Expected:** Inline error "Invalid OTP…"; stays on the screen.

### 1.6 Change number
- **Steps:** Tap **Change number**.
- **Expected:** Returns to Login with the number editable.

### 1.7 Resend cooldown
- **Steps:** On OTP screen, observe the resend timer; wait for it to reach 0; tap **Resend OTP**.
- **Expected:** Shows "Resend OTP in Ns" counting down from 30; after 0 the link is tappable; resend shows an "OTP sent" alert and resets the timer.

### 1.8 Create business (onboarding)
- **Steps:** Fill Business name, Owner name, select Business type, select State, choose GST registered Yes/No, pick a preferred content language → **Create business**.
- **Expected:** Missing required fields show inline errors; on success the app transitions to the Dashboard.

### 1.9 Onboarding validation
- **Steps:** Tap **Create business** with fields blank.
- **Expected:** Errors on business name, owner name, business type, state, and GST (must pick an option).

### 1.10 Session persistence
- **Steps:** Complete onboarding, close and reopen the app.
- **Expected:** Opens directly on the Dashboard (token + business persisted); no re-login.

### 1.11 Logout
- **Steps:** Dashboard → **Log out** → confirm.
- **Expected:** Confirmation alert; on confirm returns to Login; reopening the app stays logged out.

---

## 2. Dashboard

### 2.1 Layout
- **Steps:** Open the Dashboard.
- **Expected:** "Welcome back" + business name; notification bell (with unread badge if any); 5 summary figures (Today's Income, Today's Expense, Monthly Revenue, Monthly Expense, Cash balance); quick actions (+ Income, − Expense, 📷 Scan receipt, ✨ Categorize, 📅 Daily summary, 👥 Customers, 📒 Khata dashboard); Recent activity; Log out.

### 2.2 Loading & refresh
- **Steps:** Cold-open; then pull down to refresh.
- **Expected:** Skeletons on first load; pull-to-refresh re-fetches figures.

### 2.3 Empty state
- **Steps:** Use a brand-new business with no entries.
- **Expected:** "No activity yet" empty state with an "+ Add Income" action; recent activity shows "No transactions recorded yet."

### 2.4 Populated figures
- **Steps:** Add an income and an expense dated today (via §3/§4), return to Dashboard, refresh.
- **Expected:** Today's Income/Expense and Monthly figures update; Cash balance = total income − total expense; entries appear in Recent activity.

### 2.5 Offline banner
- **Steps:** Enable Airplane mode, reopen Dashboard.
- **Expected:** Amber "Offline" text; if there is local data, an amber "Showing offline figures from this device — pull to refresh when back online" banner appears above the widgets.

### 2.6 Error state
- **Steps:** Point the build at an unreachable backend (or keep the backend down) with online connectivity.
- **Expected:** Error card "Check your connection and try again." with a Retry button (a genuine server error, not a silent offline fallback).

### 2.7 Navigation
- **Steps:** Tap each quick action and the bell.
- **Expected:** Each routes to its screen (Add Income/Expense modal, Scan, Categorize, Daily summary, Customers, Khata, Notifications).

---

## 3. Add Income

### 3.1 Happy path (online)
- **Steps:** + Income → Amount `5000`, Category `Sales`, Date today, Notes optional → **Save income**.
- **Expected:** "Income added" alert → returns to Dashboard; entry visible in Recent activity as synced.

### 3.2 Amount validation
- **Steps:** Try Save with amount empty; `0`; `10000001` (> ₹1 crore).
- **Expected:** "Enter an amount" / "Amount must be greater than ₹0" / "Amount looks too large".

### 3.3 Category & date required
- **Steps:** Leave category unset; set a future date.
- **Expected:** "Select a category"; "Date cannot be in the future".

### 3.4 Notes limit
- **Steps:** Enter 281 characters of notes.
- **Expected:** "Notes must be 280 characters or fewer".

### 3.5 Attachment
- **Steps:** Tap the attachment picker → choose a photo.
- **Expected:** Photo attaches; entry saves with the attachment.

### 3.6 Offline capture
- **Steps:** Airplane mode → + Income → fill valid fields → Save.
- **Expected:** Amber offline banner on the form; "Saved offline — will sync automatically" alert; entry appears in Recent activity marked **Pending**.

### 3.7 Cancel
- **Steps:** Open form → **Cancel**.
- **Expected:** Returns without saving.

---

## 4. Add Expense

### 4.1 Happy path
- **Steps:** − Expense → Amount, Category chip (e.g. Fuel), Vendor `Indian Oil`, Date → **Save expense**.
- **Expected:** Saves and returns to Dashboard; appears in Recent activity (red/negative).

### 4.2 Vendor required
- **Steps:** Save with Vendor empty.
- **Expected:** Vendor error shown.

### 4.3 Category chips
- **Steps:** Tap through the category chips.
- **Expected:** Single selection with emoji icons (Rent 🏠, Fuel ⛽, Food 🍽️, etc.).

### 4.4 Offline capture
- **Steps:** Airplane mode → save a valid expense.
- **Expected:** Offline banner; entry queued as Pending, syncs on reconnect.

---

## 5. Receipt scanner (AI)

### 5.1 Capture
- **Steps:** 📷 Scan receipt → **Take photo** (grant camera) or **Choose from gallery**.
- **Expected:** Camera/gallery opens; on capture, routes to the Review screen; cancel returns cleanly.

### 5.2 Extraction & review
- **Steps:** After selecting an image, watch the scan.
- **Expected:** "Scanning receipt…" progress with the image; then a Review screen with per-field confidence (Vendor, Amount, Tax, Date, Invoice no., GST no., Category). *(With no `ANTHROPIC_API_KEY` on the backend, fields come back empty for you to fill.)*

### 5.3 Correct & create draft
- **Steps:** Edit any field → **Create expense draft**.
- **Expected:** Routes to Add Expense pre-filled (amount, category, vendor, date, notes composed from invoice/GST/tax), with the receipt attached.

### 5.4 Scan error / manual fallback
- **Steps:** Force a scan failure (e.g., offline) → observe.
- **Expected:** "Couldn't read the receipt" with **Retry** and **Enter manually** (opens Add Expense with just the attachment).

---

## 6. AI categorization

### 6.1 Categorize text
- **Steps:** ✨ Categorize → type "Swiggy order — lunch for staff ₹640" → **Categorize**.
- **Expected:** Result card with a category (Food) and a confidence. *(No `OPENAI_API_KEY` → offline keyword engine; confidence capped ≤ 0.8.)*

### 6.2 Try an example
- **Steps:** Tap **Try an example** → **Categorize**.
- **Expected:** Fills the fuel sample; predicts **Fuel**.

### 6.3 Correction / learning log
- **Steps:** Pick a different category chip under "Not right?"; check the Learning log.
- **Expected:** "Saved for future learning."; the decision appears in the Learning log; **Clear** empties it.

### 6.4 Use in new expense
- **Steps:** Tap **Use in new expense**.
- **Expected:** Opens Add Expense pre-filled with the chosen category.

---

## 7. Transaction history

### 7.1 List & count
- **Steps:** Dashboard → Recent activity → **View all**.
- **Expected:** Combined income + expense list, newest first, with a total count; infinite scroll loads more; "You've reached the end" at the bottom.

### 7.2 Search
- **Steps:** Search a vendor/category/note substring.
- **Expected:** Debounced results filter to matches; count updates.

### 7.3 Filters
- **Steps:** ⚙︎ Filters → set Type = Expense; add a category; set a date range → apply.
- **Expected:** Results filter accordingly; active-filter chips appear and are removable; badge shows active filter count.

### 7.4 Sort
- **Steps:** Change sort (Newest/Oldest/Amount ↑/Amount ↓).
- **Expected:** Order updates; label reflects the choice.

### 7.5 Clear / empty
- **Steps:** Apply filters that match nothing.
- **Expected:** "No transactions found" with **Clear filters**.

---

## 8. Customers

### 8.1 List
- **Steps:** Dashboard → 👥 Customers.
- **Expected:** Customer list with count, search, **+ Add**; empty state "No customers yet" with an add action when none exist.

### 8.2 Create customer
- **Steps:** + Add → enter Full name, Mobile (required), optional GST/business name/address/notes → save.
- **Expected:** Customer created; appears in the list; outstanding starts at ₹0.

### 8.3 Search
- **Steps:** Search by name / business / mobile.
- **Expected:** Debounced filtered results; "No customers found" for no match.

### 8.4 Edit customer
- **Steps:** Open a customer → ✏️ Edit → change fields → save.
- **Expected:** Updated details persist.

### 8.5 Customer profile
- **Steps:** Tap a customer.
- **Expected:** Avatar, name, status badge (No dues / Pending / Overdue), Outstanding balance hero with credit/payment history totals, primary actions (Add credit, Receive payment), secondary actions (🔔 Reminder, 📄 Statement, 🤝 Collect, ✏️ Edit, 📞 Call), contact details, AI risk insight, and a transaction timeline filterable by All/Credit/Payments.

### 8.6 Call
- **Steps:** Tap 📞 Call.
- **Expected:** Opens the dialer with the customer's number.

---

## 9. Khata ledger (credit / payments)

### 9.1 Add credit (Udhaar)
- **Steps:** Customer profile → **Add credit** → enter amount (or tap quick-amounts ₹500/₹1000/₹5000/₹10000, which add up), date, optional invoice/notes/attachment → **Add credit**.
- **Expected:** Animated success overlay; returns to profile; **Outstanding increases** by the amount; credit appears in the timeline.

### 9.2 Credit validation
- **Steps:** Try Add credit with amount 0/empty.
- **Expected:** "Enter an amount greater than ₹0".

### 9.3 Save/restore draft
- **Steps:** Start a credit, tap **Save as draft** → leave → reopen Add credit for the same customer.
- **Expected:** "Draft saved" alert; on reopen "Draft restored" with values; **Discard** clears it.

### 9.4 Receive payment
- **Steps:** Customer profile → **Receive payment** → enter an amount (≤ outstanding), pick a **method** → submit.
- **Expected:** Method chips offer **Cash / UPI / Bank Transfer / Card / Cheque / Credit / Other**; a reference field adapts to the method (UPI txn ID, UTR, cheque no.). Confetti success overlay; **Outstanding decreases**; payment appears in the timeline; totals update.

### 9.5 Overpayment / balance sign
- **Steps:** Record payments exceeding total credit.
- **Expected:** Outstanding does not go negative in the hero (clamped at ₹0); the customer is treated as a payable in Khata totals (see §10).

### 9.6 Overdue detection
- **Steps:** Add a credit dated **>30 days ago** with no later payment; reopen the profile / customer list.
- **Expected:** Status becomes **Overdue**; days-overdue reflected; appears under Top Defaulters in Khata.

### 9.7 Statement
- **Steps:** Profile → 📄 Statement.
- **Expected:** Customer statement view opens (shareable/exportable).

### 9.8 Offline ledger
- **Steps:** Airplane mode → Add credit / Receive payment.
- **Expected:** Offline banner; saved on-device ("will sync when online"); syncs on reconnect without duplicating.

---

## 10. Khata dashboard & insights

### 10.1 Dashboard figures
- **Steps:** Dashboard → 📒 Khata dashboard.
- **Expected:** Total Receivable, Total Payable, Overdue Amount, Today's Collections cards; Payment Trend chart; Top Defaulters list.

### 10.2 Date presets & custom range
- **Steps:** Tap Today / Week / Month / Quarter; then pick a custom range.
- **Expected:** Figures and trend recompute for the range; selecting custom dates switches the preset to custom.

### 10.3 Branch / business filters
- **Steps:** Change Branch and Business selects.
- **Expected:** Accepted (single-business stub returns the same data); no crash.

### 10.4 Empty & offline
- **Steps:** New business (no khata) / Airplane mode.
- **Expected:** "No khata activity" empty state; offline shows an amber "Offline — on-device trend & collections only" note.

### 10.5 AI insights
- **Steps:** Tap the ✨ AI Insights banner.
- **Expected:** A list of insight cards (collection trend, overdue risk, top defaulter, concentration). *(No `OPENAI_API_KEY` → heuristic insights; still non-empty when data exists, else a "Not enough data yet" card.)*

---

## 11. Collection assistant

### 11.1 Generate messages
- **Steps:** Customer profile → 🤝 Collect.
- **Expected:** Assistant intro summarizing name/amount/days overdue; editable context (name, outstanding, days overdue, relationship: Strong/Neutral/New); language chips; **3 message options** (tones) that update live as context/language change.

### 11.2 Send / share
- **Steps:** Tap a message's WhatsApp / Share.
- **Expected:** Opens WhatsApp to the customer's number with the prefilled text (falls back to SMS if WhatsApp absent); Share opens the OS share sheet.

---

## 12. Reminders

### 12.1 Send reminder
- **Steps:** Customer profile → 🔔 Reminder.
- **Expected:** Reminder sheet opens with the customer + outstanding + business name context; lets you compose/send a reminder.

---

## 13. Daily summary & notifications

### 13.1 Today's summary
- **Steps:** Dashboard → 📅 Daily summary.
- **Expected:** Income / Expense / Profit hero for today; Top expense categories with shares; empty state when nothing is recorded today.

### 13.2 Notification schedule
- **Steps:** Toggle the daily-summary notification On/Off; adjust delivery time with − / +.
- **Expected:** Setting persists; time wraps 00–23.

### 13.3 Send now
- **Steps:** **Send summary now**.
- **Expected:** "Summary sent" alert listing channels; a new item appears in the Notifications inbox (bell badge increments on the Dashboard).

### 13.4 Notification inbox
- **Steps:** Bell (Dashboard) or Daily summary → **Open notifications**.
- **Expected:** Inbox list; unread dots; opening marks all read (badge clears); **Clear all** empties; empty state when none.

---

## 14. Offline & sync (cross-cutting)

### 14.1 Queue while offline
- **Steps:** Airplane mode → create several incomes/expenses/ledger entries.
- **Expected:** All saved locally and shown as **Pending**; Dashboard shows "Offline · N pending sync".

### 14.2 Auto-sync on reconnect
- **Steps:** Disable Airplane mode; wait / reopen the app.
- **Expected:** The background sync flushes the queue; Pending → synced; "Syncing N items…" appears then clears; figures reconcile with the server.

### 14.3 No duplication on retry
- **Steps:** After syncing, pull-to-refresh and re-open lists.
- **Expected:** Each queued item appears exactly once (idempotent client_id dedupe on the server).

### 14.4 Sync failure handling
- **Steps:** Simulate a server error during sync (e.g., backend down briefly while online).
- **Expected:** Item stays queued and is marked **Failed** with a retry count; retries on the next sync.

### 14.5 Persistence across restarts
- **Steps:** Queue offline entries, force-quit the app, reopen (still offline), then go online.
- **Expected:** Pending entries survived the restart and sync once online.

---

## 15. Language / localization

### 15.1 Onboarding language
- **Steps:** During onboarding pick Hindi (or other supported) as preferred content language.
- **Expected:** Preference is saved to the profile.

### 15.2 Switch language in Settings (live localization)
- **Steps:** Settings → Preferences → Content language → pick **Hindi**.
- **Expected:** The app **immediately** re-renders in Hindi where localized — the **Dashboard** (आय / व्यय / नकद शेष / रिपोर्ट / hero labels / quick actions / recent activity / logout) and the **Settings** screen. Switch back to English to revert.

### 15.3 Fallback languages
- **Steps:** Pick Kannada / Tamil / Telugu.
- **Expected:** Currently falls back to English on localized screens (Hindi is the translated set so far) — no missing text or crash. Other screens remain English until localized.

---

## 16. Backend / connectivity edge cases

| # | Steps | Expected |
|---|---|---|
| 16.1 | Open `…/health`, `…/docs`, `…/` on the backend URL | 200 `{"status":"ok"}`; Swagger UI; friendly JSON at root (not "Not Found") |
| 16.2 | Cold start: leave the app idle >15 min, then open it | First call slow (~30–60s) then recovers; not a permanent offline |
| 16.3 | Wrong/HTTP-only API URL in a build | App shows offline figures / connection error (reproduces the original bug) |
| 16.4 | Expired/invalid token (if testable) | 401 → app should route back to login |

---

## 17. App Lock & Settings

### 17.1 Open Settings
- **Steps:** Dashboard → tap the ⚙️ button (top-right, next to the bell).
- **Expected:** Settings screen with sections: **Security** (App lock), **Preferences** (Content language), **Business** (Item catalog, Notifications), and **Log out**.

### 17.2 Enable app lock (set PIN)
- **Steps:** Settings → App lock → **On** → enter a 4-digit PIN → re-enter the same PIN on "Confirm your PIN".
- **Expected:** "App lock enabled" alert; toggle stays **On**.

### 17.3 PIN mismatch
- **Steps:** Enable app lock, but enter a different 4 digits on the confirm step.
- **Expected:** "PINs did not match. Start again." and it returns to the "Set a PIN" step.

### 17.4 Lock on background
- **Steps:** With app lock on, background the app (Home) and reopen it.
- **Expected:** A full-screen 🔒 "Enter your PIN" overlay appears before any content.

### 17.5 Unlock
- **Steps:** On the lock screen, enter the correct PIN.
- **Expected:** Overlay disappears and the app returns exactly where it was (state preserved).

### 17.6 Wrong PIN
- **Steps:** Enter an incorrect PIN on the lock screen.
- **Expected:** "Incorrect PIN. Try again."; the field clears; the app stays locked.

### 17.7 Cold-start lock
- **Steps:** Fully close (swipe away) and relaunch the app.
- **Expected:** The PIN screen appears before the Dashboard/splash content.

### 17.8 Disable app lock
- **Steps:** Settings → App lock → **Off** → confirm "Turn off app lock?".
- **Expected:** PIN removed; relaunching the app no longer prompts for a PIN.

### 17.9 Change content language
- **Steps:** Settings → Preferences → pick a different language.
- **Expected:** Selection persists (still selected after leaving and returning).

### 17.10 Log out from Settings
- **Steps:** Settings → **Log out** → confirm.
- **Expected:** Returns to Login; reopening stays logged out.

---

## 18. Reports & exports

### 18.1 Open Reports
- **Steps:** Dashboard → **📊 Reports**.
- **Expected:** Reports screen with date-range chips (Today/Week/Month/Quarter), a custom range field, a Net-profit hero, and category tables.

### 18.2 Date range
- **Steps:** Tap each preset; then pick a custom from/to range.
- **Expected:** Figures recompute for the range; picking custom dates switches the selection to custom.

### 18.3 Profit & Loss figures
- **Steps:** Record some income and expenses (via §3/§4) in the range, open Reports.
- **Expected:** **Net profit = income − expense**; Income and Expense subtotals shown; profit turns red when negative.

### 18.4 Category breakdown
- **Steps:** With mixed categories, view the report.
- **Expected:** "Income by category" and "Expense by category" lists, largest first, each with an amount and a proportional share bar.

### 18.5 Empty range
- **Steps:** Choose a range with no entries.
- **Expected:** "Nothing to report" empty state.

### 18.6 Export PDF
- **Steps:** Tap **⬇ PDF**.
- **Expected:** OS share sheet opens; the shared file is a clean, branded P&L PDF (open it / print / send to WhatsApp).

### 18.7 Export CSV (Excel)
- **Steps:** Tap **⬇ CSV (Excel)**.
- **Expected:** Share sheet opens with a `.csv`; opening it in Excel/Sheets shows totals + category rows.

### 18.8 Offline reports
- **Steps:** Enable Airplane mode → open/refresh Reports.
- **Expected:** Amber "Offline — figures computed on this device" banner; figures come from local entries; export still works.

---

## 19. Item / product catalog (GST)

### 19.1 Open the catalog
- **Steps:** Settings → Business → **🏷️ Item catalog**.
- **Expected:** Items list with search + **+ Add**; "No items yet" empty state when empty.

### 19.2 Add a product
- **Steps:** + Add → Name, Type = **Product**, Sale price, (optional) Purchase price, Unit, HSN code, GST slab chip (e.g. **18%**), Track stock **On** + opening qty → **Add item**.
- **Expected:** Item saved and shown in the list with price, GST %, and stock.

### 19.3 Add a service
- **Steps:** + Add → Type = **Service**, SAC code, GST **18%**, price → save.
- **Expected:** Saved; row shows "Service".

### 19.4 Validation
- **Steps:** Try saving with an empty name; then with no sale price.
- **Expected:** "Enter an item name" / "Enter a valid sale price".

### 19.5 Search
- **Steps:** Search by name or HSN/SAC.
- **Expected:** Debounced filtering; "No items found" for no match.

### 19.6 Edit
- **Steps:** Tap an item → change price/GST → **Save changes**.
- **Expected:** Updated values persist in the list.

### 19.7 Delete
- **Steps:** Open an item → **Delete item** → confirm.
- **Expected:** Removed from the catalog.

---

## 20. Auth / onboarding UI (visual)

### 20.1 New card layout
- **Steps:** Log out and step through Login → OTP → (new user) Create business.
- **Expected:** Each screen shows the refreshed look — a centered **₹ Smart CashBook** wordmark, a bold centered heading, and a white rounded card holding the form. All fields, validation, and flows behave exactly as before.

---

## 21. WhatsApp delivery & returning-user session

### 21.1 WhatsApp notification (only when configured)
- **Steps:** With `WHATSAPP_ENABLED=true` in the app build **and** server `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` set: Daily summary → **Send summary now**.
- **Expected:** The summary arrives on WhatsApp; `GET /api/v1/notifications/whatsapp/status` returns `{"configured": true}`. If not configured, the channel is silently skipped and the in-app inbox still receives it (no error to the user).

### 21.2 Returning user on a new device
- **Steps:** On a fresh install (or after clearing storage), log in with a number that already has a business.
- **Expected:** Lands directly on the **Dashboard** (business fetched via `/businesses/me`) — not pushed back through onboarding, and no duplicate business is created.

---

## 22. AI transaction entry (natural language / voice)

Open from the Dashboard **🎤 AI Entry** button. Type a sentence **or** tap the
phone keyboard's 🎤 and speak. Works in English, Hindi, Hinglish, Telugu, Tamil,
Kannada, Marathi, Gujarati, Bengali, Malayalam, Punjabi.

> Full multilingual accuracy needs `OPENAI_API_KEY` set on the backend
> (§4 of PRODUCTION_SETUP.md). With it blank, a **basic offline parser** handles
> digits, Hindi number words ("teen hazaar"=3000), and common English/Hinglish
> patterns — the cases below all pass on the basic parser.

### 22.1 Credit — Hinglish
- **Steps:** Enter `Ramesh ko 2500 ka maal diya` → **Read transaction**.
- **Expected:** Review shows Customer **Ramesh**, Type **Gave · Udhaar (credit)**, Amount **₹2,500**, Date **today**.

### 22.2 Payment — Hinglish
- **Steps:** Enter `Suresh se teen hazaar mile` → Read.
- **Expected:** Customer **Suresh**, Type **Received (payment)**, Amount **₹3,000**.

### 22.3 Credit — English
- **Steps:** Enter `gave ramesh 500 for groceries` → Read.
- **Expected:** Customer **Ramesh** (capitalized), Type **credit**, Amount **₹500**, Category **Groceries**.

### 22.4 Payment — English
- **Steps:** Enter `ramesh paid 2000` → Read.
- **Expected:** Customer **Ramesh**, Type **payment**, Amount **₹2,000**.

### 22.5 Voice via keyboard mic
- **Steps:** Tap the sentence box → tap the 🎤 on the keyboard → speak a transaction in your language → Read.
- **Expected:** Speech becomes text, then parses as above. *(Requires the keyboard/dictation language installed on the phone.)*

### 22.6 Edit before saving
- **Steps:** After parsing, change any field (customer, type, amount, date) in the review card.
- **Expected:** Edits are respected on save.

### 22.7 Confirm & save (find-or-create customer)
- **Steps:** With a new name, tap **Confirm & save**.
- **Expected:** A customer is created (or matched if the name already exists) and the credit/payment is added to their khata; a success alert offers **View customer** (opens the profile with the new entry in the timeline).

### 22.8 Validation
- **Steps:** Clear the customer name, or leave the amount empty, then Confirm.
- **Expected:** Inline "Enter the customer name" / "Enter an amount".

### 22.9 Example chips
- **Steps:** Tap a suggested example chip.
- **Expected:** Fills the input so you can parse it in one tap.

### 22.10 Never blind-creates — confirmation card
- **Steps:** Parse any sentence.
- **Expected:** Nothing is saved until you review the **"I understood — confirm"** card and tap **Confirm & save**. Every field is editable first.

### 22.11 Payment method (for received payments)
- **Steps:** Parse a payment (e.g. `ramesh paid 2000`) → in review, Type = **Received** → a **Payment method** row appears.
- **Expected:** Choose Cash / UPI / Bank Transfer / Card / Cheque / Other; the chosen method is saved on the ledger entry. *(Credit entries don't show a method.)*

### 22.12 Ambiguous customer — "Which Ramesh?"
- **Steps:** Have two or more customers whose names match (e.g. "Ramesh Kumar", "Ramesh Traders"). Enter `Ramesh ko 500 diye` → Confirm & save.
- **Expected:** Instead of creating blindly, a **"Which 'Ramesh'?"** picker lists the matching customers (name · business · mobile · outstanding). Pick one → the entry is added to that customer. A **"➕ Create new 'Ramesh'"** option is also offered.

### 22.13 Exact / single match auto-resolves
- **Steps:** Enter a name that exactly matches exactly one existing customer → Confirm.
- **Expected:** No picker — it saves straight to that customer. A brand-new name creates the customer directly.

---

## 23. Crash resilience (error boundary)

### 23.1 Recoverable errors
- **Steps:** If any screen hits an unexpected error (e.g. a future bug).
- **Expected:** Instead of the whole app white-screening/crashing, a **"Something went wrong"** card appears showing the error message with a **Try again** button. (This is what surfaced the customer-open bug.)

---

## 24. UPI payment collection

Collect dues straight into your own UPI — no payment gateway. (Payment **links**
with a hosted pay page, **auto-reconciliation**, and **auto-scheduling** are
roadmap items that need a gateway/native scheduling — not in this build.)

### 24.1 Set your UPI ID
- **Steps:** Settings → **Payments** → enter your UPI ID (e.g. `shop@okhdfcbank`) + payee name → **Save UPI details**.
- **Expected:** Saved. An invalid format (no `@bank`) shows "Invalid UPI ID".

### 24.2 Request payment (QR + details)
- **Steps:** Customer profile → **💳 Request** (secondary action).
- **Expected:** "Request payment" screen with the amount (defaults to the customer's outstanding, editable), a **UPI QR code**, and details (UPI ID, Amount, Customer, Reference, Status = Pending).

### 24.3 Not configured yet
- **Steps:** Open Request payment before setting a UPI ID.
- **Expected:** An amber prompt "Add your UPI ID to collect payments" with a **Set UPI ID in Settings** button (no QR shown).

### 24.4 Amount drives the QR
- **Steps:** Change the amount.
- **Expected:** The QR regenerates for the new amount (encodes `upi://pay?pa=…&am=…`).

### 24.5 Send on WhatsApp
- **Steps:** Tap **Send request on WhatsApp**.
- **Expected:** WhatsApp opens to the customer's number pre-filled with the amount, your UPI ID, a tappable `upi://` link, and the reference (falls back to SMS if WhatsApp isn't installed).

### 24.6 Share request
- **Steps:** Tap **Share payment request**.
- **Expected:** OS share sheet with the same message/link.

### 24.7 Customer pays + Mark as received
- **Steps:** Customer scans the QR (or taps the link) and pays into your UPI. Then tap **✓ Mark as received**.
- **Expected:** A **UPI payment** for the amount is recorded on the customer's khata (method = UPI, with the reference); **outstanding decreases**; it appears in the timeline.

### 24.8 QR resilience
- **Expected:** If the QR fails to render on a device, the screen still shows the link/details and the "Something went wrong" card only replaces the QR area (not the whole screen).

---

## 25. Customer intelligence

### 25.1 Payment Score (#17)
- **Steps:** Open a customer with some ledger history.
- **Expected:** A **Payment Score /100** card (higher = better payer) with a risk pill (Low/Medium/High) and stats: **Usually pays** (avg delay in days), **Current overdue** (₹), and **History** (txn count). Derived from payment delays, outstanding, frequency and history.

### 25.2 Credit limit — set (#18)
- **Steps:** Customer profile → **🎯 Limit** → enter e.g. ₹50,000 → **Save limit**.
- **Expected:** Limit saved for that customer (persists across app restarts). "Remove limit" clears it.

### 25.3 Credit limit — approaching / exceeded warnings
- **Steps:** With a ₹50,000 limit, take the customer's dues to ~₹47,500, then over ₹50,000 (add credit).
- **Expected:** At ≥95% → amber **"⚠️ Approaching credit limit"** on the profile; over the limit → red **"🚨 Credit limit exceeded by ₹X"**. Adding credit that would breach the limit shows the same warning on the **Add credit** screen before saving.

### 25.4 Receivables aging (#19)
- **Steps:** Khata dashboard → **🔎 Customer intelligence** → Receivables aging.
- **Expected:** Buckets **Current / 1–30 / 31–60 / 61–90 / 90+ days** with amounts + a total. Payments are applied to the **oldest** dues first (FIFO), so clearing an old credit empties the old bucket.

### 25.5 Customer insights — smart lists (#20)
- **Steps:** Same screen, scroll the question cards.
- **Expected:** **Who owes the most** (top debtors), **Who is late** (overdue + days), **Who paid this month**, **Who hasn't purchased recently** (dormant >30 days), **Which customers are high risk** (score). Tapping a row jumps to that customer (search).

---

## Regression checklist (quick smoke)

1. Login with `123456` → onboarding → Dashboard.
2. Add income + expense (today) → Dashboard figures update.
3. Add a customer → add credit → receive payment → outstanding correct.
4. Khata dashboard shows receivable/overdue; insights load.
5. Airplane mode → add entries (Pending) → reconnect → all sync, no dupes.
6. Reports → Month → figures correct → export PDF opens the share sheet.
7. Settings → enable App lock → background & reopen → unlock with PIN.
8. Settings → Item catalog → add a product with an 18% GST slab → appears in the list.
9. 🎤 AI Entry → `ramesh paid 2000` → Read → Confirm & save → customer + payment created.
10. Settings → switch language to Hindi → Dashboard renders in Hindi.
11. Settings → Payments → set UPI ID → customer → 💳 Request → QR shows → Mark as received.
12. Khata → 🔎 Customer intelligence → aging buckets + "who owes the most" populated.
13. Log out → back to Login.

---

### Automated coverage
Much of the above logic is also covered by automated tests — run them before a
release: `npm test` (frontend, 75) and `cd backend && python -m pytest`
(backend, 67). See [TESTING.md](TESTING.md).
