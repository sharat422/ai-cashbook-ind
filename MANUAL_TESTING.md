# Smart CashBook — End-to-End Manual Test Plan (Production Release)

End-to-end manual test steps for the whole app, derived from the codebase.
Each case is **Steps → Expected**. Run on a TestFlight / internal-track build
against the deployed backend (`https://smart-cashbook-api.onrender.com`).

This is the **production sign-off** document. Work top to bottom; log any
deviation from *Expected* as a blocker. A [Production readiness sign-off](#38-production-readiness-sign-off)
checklist is at the end.

> **Automated coverage runs first.** Before manual testing a build, run the
> automated suites (they must be green): `npm test` (frontend Jest — **162**
> tests) and `cd backend && python -m pytest` (backend pytest — **214** tests,
> +1 xfail). See [TESTING.md](TESTING.md). Manual testing verifies the
> device/UX layer those suites can't reach.

---

## 0. Prerequisites & setup

| # | Check | Expected |
|---|---|---|
| 0.1 | App built with `API_BASE_URL=https://smart-cashbook-api.onrender.com` (see [.env.example](.env.example)) | App reaches the backend over HTTPS |
| 0.2 | Backend awake: open `https://smart-cashbook-api.onrender.com/health` | `{"status":"ok"}` |
| 0.3 | **Login is always enforced** — there is no auth bypass in this build. A fresh install opens on Splash → Login. | No shortcut into the app without a real token |
| 0.4 | Fresh install (or logged out) | App opens on Splash → Login |
| 0.5 | Backend mode: production backend runs with `DEBUG=false` → **rate limiting is ON** and the master OTP is **not** accepted. A staging/dev backend runs with `DEBUG=true` → master OTP works, rate limiting off. | Know which backend you're pointed at before testing auth/limits |

**Login credentials for testing (staging/DEBUG backend only):** any 10-digit
mobile number + OTP **`123456`** (master OTP; no real SMS). Against a
production backend you must use a number wired to a real OTP delivery channel.

> ⚠️ First launch after the backend has been idle >15 min may take ~30–60s while
> the free Render instance cold-starts. The client timeout covers it; if a
> screen shows offline figures, pull-to-refresh after a minute.

> 🔐 **AI features are consent-gated.** Every AI feature (§14–§20) sends data to
> an AI provider **only** if the user has turned **AI processing consent ON**
> (it is **OFF by default** — see §22). With it off, pure-AI endpoints return a
> "turn on AI processing" message and insights fall back to on-device heuristics.
> Toggle it in Settings → Privacy & consent before testing the AI sections.

---

# PART A — Authentication, consent & onboarding

## 1. Authentication

### 1.1 Splash
- **Steps:** Launch the app.
- **Expected:** Branded splash (~1.5s), then routes to Login (no token), Onboarding (token, no business), or Dashboard (fully set up).

### 1.2 Mobile number validation
- **Steps:** On Login, tap **Continue** empty; then letters; then `12345`; then `9876543210`.
- **Expected:** Empty/short/invalid show an inline error; only digits accepted (max 10); `+91` prefix is fixed; a valid number enables the OTP request.

### 1.3 Request OTP
- **Steps:** Enter a valid 10-digit number → **Continue**.
- **Expected:** Button shows loading; navigates to OTP screen showing "+91 <number>".

### 1.4 OTP entry & auto-submit
- **Steps:** Enter the OTP (`123456` on staging).
- **Expected:** Auto-submits on the 6th digit; routes onward (Consent/Onboarding for a new user, Dashboard if a business exists).

### 1.5 Wrong OTP
- **Steps:** Enter `000000`.
- **Expected:** Inline "Invalid OTP…"; stays on screen. (Repeated wrong OTPs feed the backend anomaly counters — see §37.)

### 1.6 Change number
- **Steps:** Tap **Change number**.
- **Expected:** Returns to Login with the number editable.

### 1.7 Resend cooldown
- **Steps:** On OTP screen watch the resend timer; wait to 0; tap **Resend OTP**.
- **Expected:** "Resend OTP in Ns" counts down from 30; after 0 it's tappable; resend shows "OTP sent" and resets the timer.

### 1.8 OTP request throttling (auth rate limit)
- **Steps:** Request an OTP for the **same** number repeatedly in quick succession.
- **Expected:** After the per-mobile cap the backend returns **429 "Too many requests"** (or "please wait"); the app surfaces the error and does not crash. (Backend caps OTP requests per mobile + a global store cap.)

### 1.9 Login → Consent → Onboarding (new user)
- **Steps:** Log in with a brand-new number.
- **Expected:** Routes to the **Consent** screen (§2.1) first, then **Create business** (§3), then Dashboard.

### 1.10 Session persistence
- **Steps:** Complete onboarding, close and reopen the app.
- **Expected:** Opens directly on the Dashboard; no re-login. (Token now lives in the Keychain/Keystore, not plaintext — see §36.)

### 1.11 Logout
- **Steps:** Dashboard/Settings → **Log out** → confirm.
- **Expected:** Confirmation alert; on confirm returns to Login; reopening stays logged out.

### 1.12 Returning login pulls the existing business
- **Steps:** Register a business, add data, log out, log in again with the **same** number.
- **Expected:** Lands on **your** Dashboard with existing business/data — **not** Create Business. Holds for a same-session re-login (no restart), and the backend refuses to create a duplicate business.

### 1.13 Data is business-specific (no cross-account leak)
- **Steps:** As user A add income/expenses/customers. Log out. Log in as a **different** number (user B) and onboard.
- **Expected:** User B's Dashboard, activity, customers, notifications, UPI settings and drafts are **empty**. Logging back as A restores A's server data. Device-local caches (offline queues, drafts, UPI id) are cleared on logout/switch.

## 2. Consent capture (onboarding)

### 2.1 Granular consent screen
- **Steps:** As a new user, reach the Consent screen after OTP.
- **Expected:** Three **independent** rows — **Core** (required, locked ON), **Marketing** (optional, **OFF** by default), **AI processing** (optional, **OFF** by default). Not a single bundled "I agree".

### 2.2 Agree & continue
- **Steps:** Leave optional toggles as-is (or toggle) → **Agree & continue**.
- **Expected:** Choices saved server-side; proceeds to Create business. AI/marketing remain off unless you turned them on.

### 2.3 Consent is skipped once satisfied
- **Steps:** If you dropped off after consent but before business creation, log in again.
- **Expected:** If required consent for the current policy version is already recorded, the Consent step is skipped straight to Create business.

## 3. Create business (onboarding)

### 3.1 Happy path
- **Steps:** Fill Business name, Owner name, Business type, State, GST registered Yes/No, preferred content language → **Create business**.
- **Expected:** On success the app transitions to the Dashboard.

### 3.2 Validation
- **Steps:** Tap **Create business** with fields blank.
- **Expected:** Errors on business name, owner name, business type, state, and GST (must pick an option).

### 3.3 New card layout (visual)
- **Steps:** Step through Login → OTP → Consent → Create business.
- **Expected:** Refreshed look — centered **₹ Smart CashBook** wordmark, bold centered heading, white rounded card holding the form; all validation/flows behave as specified.

---

# PART B — Core money features

## 4. Dashboard

### 4.1 Layout
- **Steps:** Open the Dashboard.
- **Expected:** "Welcome back" + business name; notification bell (unread badge if any); settings ⚙️; 5 summary figures (Today's Income, Today's Expense, Monthly Revenue, Monthly Expense, Cash balance); quick actions (AI Entry, + Income, − Expense, Scan receipt, Categorize, Daily summary, Customers, Khata, Reports, Business summary, Ask AI, Recurring); Recent activity; Log out.

### 4.2 Loading & refresh
- **Steps:** Cold-open; then pull to refresh.
- **Expected:** Skeletons on first load; pull-to-refresh re-fetches figures.

### 4.3 Empty state
- **Steps:** Brand-new business, no entries.
- **Expected:** "No activity yet" with "+ Add Income"; recent activity "No transactions recorded yet."

### 4.4 Populated figures
- **Steps:** Add an income and an expense dated today, return, refresh.
- **Expected:** Today/Monthly figures update; Cash balance = total income − total expense; entries in Recent activity.

### 4.5 Offline banner
- **Steps:** Airplane mode, reopen Dashboard.
- **Expected:** Amber "Offline"; if local data exists, an amber "Showing offline figures from this device — pull to refresh when back online" banner above the widgets.

### 4.6 Error state
- **Steps:** Point at an unreachable backend while online.
- **Expected:** Error card "Check your connection and try again." with **Retry** (a genuine server error, not a silent offline fallback).

### 4.7 Device integrity warning (rooted/jailbroken)
- **Steps:** Run the build on a rooted/jailbroken device or emulator flagged by the detector.
- **Expected:** A **non-blocking** amber banner "⚠️ Device security warning… appears rooted or jailbroken". App remains fully usable (flag, don't block). Dismiss ✕ hides it for the session; it re-evaluates next launch. The occurrence is logged once to Diagnostics (§30). On a clean device: **no** banner.

## 5. Add Income

### 5.1 Happy path (online)
- **Steps:** + Income → Amount `5000`, Category `Sales`, Date today, optional Notes → **Save income**.
- **Expected:** "Income added" → returns to Dashboard; entry in Recent activity as synced.

### 5.2 Amount validation
- **Steps:** Save with amount empty; `0`; `10000001` (> ₹1 crore).
- **Expected:** "Enter an amount" / "Amount must be greater than ₹0" / "Amount looks too large".

### 5.3 Category & date required
- **Steps:** Leave category unset; set a future date.
- **Expected:** "Select a category"; "Date cannot be in the future".

### 5.4 Notes limit
- **Steps:** Enter 281 characters of notes.
- **Expected:** "Notes must be 280 characters or fewer".

### 5.5 Attachment
- **Steps:** Attachment picker → choose a photo.
- **Expected:** Photo attaches; entry saves with the attachment.

### 5.6 Offline capture
- **Steps:** Airplane mode → + Income → valid fields → Save.
- **Expected:** Amber offline banner; "Saved offline — will sync automatically"; entry in Recent activity marked **Pending**.

### 5.7 Cancel
- **Steps:** Open form → **Cancel**.
- **Expected:** Returns without saving.

## 6. Add Expense

### 6.1 Happy path
- **Steps:** − Expense → Amount, Category chip (e.g. Fuel), Vendor `Indian Oil`, Date → **Save expense**.
- **Expected:** Saves and returns; appears in Recent activity (red/negative).

### 6.2 Vendor required
- **Steps:** Save with Vendor empty.
- **Expected:** Vendor error shown.

### 6.3 Category chips
- **Steps:** Tap through the chips.
- **Expected:** Single selection with emoji icons (Rent 🏠, Fuel ⛽, Food 🍽️, etc.).

### 6.4 Offline capture
- **Steps:** Airplane mode → save a valid expense.
- **Expected:** Offline banner; queued Pending; syncs on reconnect.

## 7. Transaction history

### 7.1 List & count
- **Steps:** Recent activity → **View all**.
- **Expected:** Combined income + expense list, newest first, total count; infinite scroll; "You've reached the end" at the bottom.

### 7.2 Search
- **Steps:** Search a vendor/category/note substring.
- **Expected:** Debounced results filter to matches; count updates.

### 7.3 Filters
- **Steps:** ⚙︎ Filters → Type = Expense; add a category; set a date range → apply.
- **Expected:** Results filter; active-filter chips appear and are removable; badge shows active count.

### 7.4 Sort
- **Steps:** Change sort (Newest/Oldest/Amount ↑/Amount ↓).
- **Expected:** Order updates; label reflects the choice.

### 7.5 Clear / empty
- **Steps:** Apply filters matching nothing.
- **Expected:** "No transactions found" with **Clear filters**.

## 8. Reports & exports

### 8.1 Open Reports
- **Steps:** Dashboard → **Reports**.
- **Expected:** Date-range chips (Today/Week/Month/Quarter), custom range, Net-profit hero, category tables.

### 8.2 Date range
- **Steps:** Tap each preset; then a custom from/to range.
- **Expected:** Figures recompute; custom dates switch the selection to custom.

### 8.3 Profit & Loss figures
- **Steps:** Record income + expenses in the range, open Reports.
- **Expected:** **Net profit = income − expense**; subtotals shown; profit turns red when negative.

### 8.4 Category breakdown
- **Steps:** With mixed categories, view the report.
- **Expected:** "Income by category" and "Expense by category", largest first, each with an amount and a proportional share bar.

### 8.5 Empty range
- **Steps:** Range with no entries.
- **Expected:** "Nothing to report".

### 8.6 Export PDF
- **Steps:** Pick a custom range → **⬇ PDF**.
- **Expected:** Share sheet with a branded PDF: P&L summary + category breakdown **and** a full transaction table for the range. File name encodes the range.

### 8.7 Export Excel (.xlsx)
- **Steps:** **⬇ Excel (.xlsx)**.
- **Expected:** A real `.xlsx` with two sheets — **P&L Summary** and **Transactions** (Date/Type/Category/Vendor-Payer/Income/Expense/Notes + Totals row). Amounts are **numbers**.

### 8.8 Export covers the selected range
- **Steps:** Change the range and re-export.
- **Expected:** Both PDF and Excel reflect the new range's totals and only that range's lines.

### 8.9 Offline export
- **Steps:** Airplane mode → Reports → export either format.
- **Expected:** Amber "Offline — figures computed on this device"; export built from **local entries** (incl. pending); P&L and transaction list populate.

---

# PART C — Customers & khata (credit ledger)

## 9. Customers

### 9.1 List
- **Steps:** Dashboard → Customers.
- **Expected:** List with count, search, **+ Add**; empty state "No customers yet" when none.

### 9.2 Create customer
- **Steps:** + Add → Full name, Mobile (required), optional GST/business name/address/notes → save.
- **Expected:** Created; in the list; outstanding ₹0.

### 9.3 Search
- **Steps:** Search by name / business / mobile.
- **Expected:** Debounced results; "No customers found" for no match.

### 9.4 Edit customer
- **Steps:** Open a customer → ✏️ Edit → change fields → save.
- **Expected:** Updated details persist.

### 9.5 Customer profile
- **Steps:** Tap a customer.
- **Expected:** Avatar, name, status badge (No dues / Pending / Overdue), Outstanding balance hero with credit/payment totals, primary actions (Add credit, Receive payment), secondary (🔔 Reminder, 📄 Statement, 🤝 Collect, 💳 Request, 🎯 Limit, ✏️ Edit, 📞 Call), contact details, AI risk insight (§16), a transaction timeline filterable by All/Credit/Payments.

### 9.6 Call
- **Steps:** Tap 📞 Call.
- **Expected:** Opens the dialer with the customer's number.

## 10. Khata ledger (credit / payments)

### 10.1 Add credit (Udhaar)
- **Steps:** Profile → **Add credit** → amount (or quick-amounts ₹500/₹1000/₹5000/₹10000, additive), date, optional invoice/notes/attachment → **Add credit**.
- **Expected:** Animated success overlay; **Outstanding increases**; credit in the timeline.

### 10.2 Credit validation
- **Steps:** Add credit with amount 0/empty.
- **Expected:** "Enter an amount greater than ₹0".

### 10.3 Save/restore draft
- **Steps:** Start a credit → **Save as draft** → leave → reopen Add credit for the same customer.
- **Expected:** "Draft saved"; on reopen "Draft restored" with values; **Discard** clears it.

### 10.4 Receive payment
- **Steps:** Profile → **Receive payment** → amount (≤ outstanding) → pick **method** → submit.
- **Expected:** Method chips: **Cash / UPI / Bank Transfer / Card / Cheque / Credit / Other**; a reference field adapts (UPI txn ID, UTR, cheque no.). Confetti overlay; **Outstanding decreases**; payment in the timeline; totals update.

### 10.5 Overpayment / balance sign
- **Steps:** Record payments exceeding total credit.
- **Expected:** Outstanding clamped at ₹0 in the hero; treated as a payable in Khata totals (§11).

### 10.6 Overdue detection
- **Steps:** Add a credit dated **>30 days ago** with no later payment; reopen profile/list.
- **Expected:** Status **Overdue**; days-overdue shown; appears under Top Defaulters in Khata.

### 10.7 Statement
- **Steps:** Profile → 📄 Statement.
- **Expected:** Customer statement view opens (shareable/exportable).

### 10.8 Offline ledger
- **Steps:** Airplane mode → Add credit / Receive payment.
- **Expected:** Offline banner; saved on-device; syncs on reconnect without duplicating.

## 11. Khata dashboard & insights

### 11.1 Dashboard figures
- **Steps:** Dashboard → Khata dashboard.
- **Expected:** Total Receivable, Total Payable, Overdue Amount, Today's Collections; Payment Trend chart; Top Defaulters.

### 11.2 Date presets & custom range
- **Steps:** Today / Week / Month / Quarter; then a custom range.
- **Expected:** Figures/trend recompute; custom dates switch preset to custom.

### 11.3 Branch / business filters
- **Steps:** Change Branch and Business selects.
- **Expected:** Accepted (single-business stub returns same data); no crash.

### 11.4 Empty & offline
- **Steps:** New business / Airplane mode.
- **Expected:** "No khata activity" empty state; offline shows "Offline — on-device trend & collections only".

### 11.5 AI insights (consent-gated)
- **Steps:** With **AI consent ON** (§22), tap the ✨ AI Insights banner.
- **Expected:** Insight cards (collection trend, overdue risk, top defaulter, concentration). **With AI consent OFF** or no `OPENAI_API_KEY`: heuristic insights still render (non-empty when data exists, else "Not enough data yet") — no error, and no data is sent to a provider.

## 12. Collection assistant

### 12.1 Generate messages
- **Steps:** Profile → 🤝 Collect.
- **Expected:** Intro summarizing name/amount/days overdue; editable context (name, outstanding, days overdue, relationship Strong/Neutral/New); language chips; **3 message options** (tones) that update live.

### 12.2 Send / share
- **Steps:** Tap a message's WhatsApp / Share.
- **Expected:** Opens WhatsApp to the customer's number with prefilled text (SMS fallback if absent); Share opens the OS sheet.

## 13. Reminders

### 13.1 Send reminder
- **Steps:** Profile → 🔔 Reminder.
- **Expected:** Reminder sheet with customer + outstanding + business name context; compose/send a reminder.

---

# PART D — AI features (all consent-gated — see §22)

> For every case in this part: with **AI consent OFF**, the pure-AI path returns
> a clear "AI processing is turned off — turn it on in Settings" message (no
> crash, no data sent). Turn **AI consent ON** in Settings → Privacy & consent
> to exercise the online path. An offline keyword/heuristic fallback exists for
> some features when no server AI key is set — noted per section.

## 14. Receipt scanner (AI)

### 14.1 Capture
- **Steps:** Scan receipt → **Take photo** (grant camera) or **Choose from gallery**.
- **Expected:** Camera/gallery opens; on capture routes to Review; cancel returns cleanly.

### 14.2 Extraction & review
- **Steps:** After selecting an image, watch the scan.
- **Expected:** "Scanning receipt…" progress; then a Review screen with per-field confidence (Vendor, Amount, Tax, Date, Invoice no., GST no., Category). *(No `ANTHROPIC_API_KEY` → fields empty to fill.)*

### 14.3 Correct & create draft
- **Steps:** Edit any field → **Create expense draft**.
- **Expected:** Add Expense pre-filled (amount, category, vendor, date, notes from invoice/GST/tax), receipt attached.

### 14.4 Scan error / manual fallback
- **Steps:** Force a failure (offline).
- **Expected:** "Couldn't read the receipt" with **Retry** and **Enter manually** (Add Expense with just the attachment).

## 15. AI categorization

### 15.1 Categorize text
- **Steps:** Categorize → "Swiggy order — lunch for staff ₹640" → **Categorize**.
- **Expected:** Result card with a category (Food) + confidence. *(No `OPENAI_API_KEY` → offline keyword engine; confidence ≤ 0.8.)*

### 15.2 Try an example
- **Steps:** **Try an example** → **Categorize**.
- **Expected:** Fills the fuel sample; predicts **Fuel**.

### 15.3 Correction / learning log
- **Steps:** Pick a different chip under "Not right?"; check the Learning log.
- **Expected:** "Saved for future learning."; decision appears in the log; **Clear** empties it.

### 15.4 Use in new expense
- **Steps:** **Use in new expense**.
- **Expected:** Add Expense pre-filled with the chosen category.

## 16. Customer intelligence

### 16.1 Payment Score
- **Steps:** Open a customer with ledger history.
- **Expected:** **Payment Score /100** card with a risk pill (Low/Medium/High) and stats: **Usually pays** (avg delay), **Current overdue** (₹), **History** (txn count).

### 16.2 Credit limit — set
- **Steps:** Profile → **🎯 Limit** → ₹50,000 → **Save limit**.
- **Expected:** Limit persists across restarts. "Remove limit" clears it.

### 16.3 Credit limit — warnings
- **Steps:** With a ₹50,000 limit, take dues to ~₹47,500, then over ₹50,000.
- **Expected:** ≥95% → amber "⚠️ Approaching credit limit"; over → red "🚨 Credit limit exceeded by ₹X". Adding credit that would breach shows the warning on **Add credit** before saving.

### 16.4 Receivables aging
- **Steps:** Khata → 🔎 Customer intelligence → Receivables aging.
- **Expected:** Buckets **Current / 1–30 / 31–60 / 61–90 / 90+** with amounts + total. Payments apply to **oldest** dues first (FIFO).

### 16.5 Smart lists
- **Steps:** Same screen, scroll the question cards.
- **Expected:** Who owes the most, Who is late, Who paid this month, Who hasn't purchased recently (dormant >30 days), Which customers are high risk. Tapping a row jumps to that customer.

## 17. AI transaction entry (natural language / voice)

Open from Dashboard **🎤 AI Entry**. Type a sentence **or** tap the keyboard 🎤
and speak. Languages: English, Hindi, Hinglish, Telugu, Tamil, Kannada, Marathi,
Gujarati, Bengali, Malayalam, Punjabi.

> Full multilingual accuracy needs `OPENAI_API_KEY` + AI consent. Without a key,
> a **basic offline parser** handles digits, Hindi number words ("teen
> hazaar"=3000), and common English/Hinglish — the cases below pass on it.

### 17.1 Credit — Hinglish
- **Steps:** `Ramesh ko 2500 ka maal diya` → **Read transaction**.
- **Expected:** Customer **Ramesh**, Type **Gave · Udhaar (credit)**, Amount **₹2,500**, Date **today**.

### 17.2 Payment — Hinglish
- **Steps:** `Suresh se teen hazaar mile` → Read.
- **Expected:** Customer **Suresh**, Type **Received (payment)**, Amount **₹3,000**.

### 17.3 Credit — English
- **Steps:** `gave ramesh 500 for groceries` → Read.
- **Expected:** Customer **Ramesh**, Type **credit**, Amount **₹500**, Category **Groceries**.

### 17.4 Payment — English
- **Steps:** `ramesh paid 2000` → Read.
- **Expected:** Customer **Ramesh**, Type **payment**, Amount **₹2,000**.

### 17.5 Voice via keyboard mic
- **Steps:** Tap the box → keyboard 🎤 → speak a transaction → Read.
- **Expected:** Speech → text → parses as above. *(Requires the dictation language installed.)*

### 17.6 Edit before saving
- **Steps:** After parsing, change any field.
- **Expected:** Edits respected on save.

### 17.7 Confirm & save (find-or-create)
- **Steps:** With a new name, **Confirm & save**.
- **Expected:** Customer created (or matched) and the credit/payment added; success alert offers **View customer**.

### 17.8 Validation
- **Steps:** Clear the name, or leave amount empty, then Confirm.
- **Expected:** "Enter the customer name" / "Enter an amount".

### 17.9 Never blind-creates
- **Steps:** Parse any sentence.
- **Expected:** Nothing saves until you review the "I understood — confirm" card and tap **Confirm & save**. Every field editable first.

### 17.10 Payment method (received payments)
- **Steps:** Parse `ramesh paid 2000` → Type = Received → a **Payment method** row appears.
- **Expected:** Choose Cash/UPI/Bank Transfer/Card/Cheque/Other; saved on the ledger entry. *(Credits show no method.)*

### 17.11 Ambiguous customer picker
- **Steps:** Two customers matching "Ramesh". `Ramesh ko 500 diye` → Confirm.
- **Expected:** A "Which 'Ramesh'?" picker (name · business · mobile · outstanding) + "➕ Create new 'Ramesh'". Pick one → added to that customer.

### 17.12 Exact/single match auto-resolves
- **Steps:** A name matching exactly one customer → Confirm.
- **Expected:** No picker; saves straight to that customer. A brand-new name creates directly.

## 18. Business summary (AI daily digest)

Open from Dashboard **📈 Business summary**.

### 18.1 Morning digest
- **Steps:** Record sales/expenses/payments dated yesterday, open Business summary.
- **Expected:** Time-based greeting + a **Yesterday** card (Sales/Collections/Expenses), a dark card (Outstanding, Overdue, Expected today), and "N customers need attention".

### 18.2 Profit dashboard
- **Expected:** **This month** card with Sales, Expenses, **Estimated profit** (green/red), **Margin %**.

### 18.3 Trends vs last month
- **Steps:** Activity in this and last month.
- **Expected:** Sales/Collections/Expenses with ▲/▼ and %. Up-sales/collections green; up-expenses red. "No prior data" when last month empty.

### 18.4 Cash-flow forecast
- **Expected:** Based on last 3 months: **Expected in**, **Expected out**, **Net** (green when positive).

### 18.5 Offline / empty
- **Steps:** New business / airplane mode.
- **Expected:** Zeros and "No prior data" where applicable; retryable error card if backend unreachable.

## 19. AI Business Assistant (Ask AI)

Open from Dashboard **🤖 Ask AI**. Numbers are **computed from your data**, never
invented. Needs AI consent + `OPENAI_API_KEY` for full phrasing; a keyword
classifier handles the common questions below.

### 19.1 Who owes the most — "Who owes me the most?" → biggest debtor + amount, then the next few.
### 19.2 Collections — "How much did I collect this month?" → "You collected ₹X this month." (try "last week"/"today").
### 19.3 Who is late — "Which customers are late?" → count + total overdue + who to chase (or "No overdue customers").
### 19.4 Biggest expenses — "What were my biggest expenses?" → top categories with amounts.
### 19.5 Sales — "How much did I sell last week?" → "You sold ₹X last week."
### 19.6 Compare months — "Compare this month with last month." → Sales/Collections/Expenses this vs last, each with %.
### 19.7 Per-customer purchases — "How much did Raj Traders purchase in the last 3 months?" → month-by-month + total, matched to the named customer.
### 19.8 Unknown / help — ask something unrelated → a friendly list of what it can answer (no crash, no wrong number).

## 20. UPI payment collection

Collect dues into your own UPI — no gateway.

### 20.1 Set your UPI ID
- **Steps:** Settings → **Payments** → UPI ID (e.g. `shop@okhdfcbank`) + payee name → **Save UPI details**.
- **Expected:** Saved. Invalid format (no `@bank`) → "Invalid UPI ID".

### 20.2 Request payment (QR + details)
- **Steps:** Profile → **💳 Request**.
- **Expected:** Amount (defaults to outstanding, editable), a **UPI QR**, details (UPI ID, Amount, Customer, Reference, Status = Pending).

### 20.3 Not configured yet
- **Steps:** Open Request payment before setting a UPI ID.
- **Expected:** Amber "Add your UPI ID to collect payments" + **Set UPI ID in Settings** (no QR).

### 20.4 Amount drives the QR
- **Steps:** Change the amount.
- **Expected:** QR regenerates (encodes `upi://pay?pa=…&am=…`).

### 20.5 Send on WhatsApp
- **Steps:** **Send request on WhatsApp**.
- **Expected:** WhatsApp opens to the customer with amount, UPI ID, tappable `upi://` link, reference (SMS fallback).

### 20.6 Share request
- **Steps:** **Share payment request**.
- **Expected:** OS share sheet with the same message/link.

### 20.7 Mark as received
- **Steps:** After the customer pays, **✓ Mark as received**.
- **Expected:** A **UPI payment** recorded on the khata (method = UPI, with reference); **outstanding decreases**; appears in timeline.

### 20.8 QR resilience
- **Expected:** If the QR fails to render, the screen still shows link/details; only the QR area shows the error card, not the whole screen.

---

# PART E — Business tools

## 21. Item / product catalog (GST)

### 21.1 Open the catalog
- **Steps:** Settings → Business → **Item catalog**.
- **Expected:** Items list with search + **+ Add**; "No items yet" when empty.

### 21.2 Add a product
- **Steps:** + Add → Name, Type **Product**, Sale price, (optional) Purchase price, Unit, HSN code, GST slab (e.g. **18%**), Track stock **On** + opening qty → **Add item**.
- **Expected:** Saved with price, GST %, stock.

### 21.3 Add a service
- **Steps:** + Add → Type **Service**, SAC code, GST **18%**, price → save.
- **Expected:** Saved; row shows "Service".

### 21.4 Validation
- **Steps:** Save with empty name; then no sale price.
- **Expected:** "Enter an item name" / "Enter a valid sale price".

### 21.5 Search / Edit / Delete
- **Steps:** Search by name/HSN/SAC; edit price/GST → Save changes; open an item → Delete → confirm.
- **Expected:** Debounced filtering; edits persist; delete removes the row.

## 22. Recurring expenses

Open from Dashboard **🔁 Recurring**.

### 22.1 Add a recurring expense
- **Steps:** + Add → "Shop rent", ₹15,000, Rent, paid to "Landlord", **Monthly**, repeat every 1, next due today → **Add recurring expense**.
- **Expected:** Row "Every month · Rent · next <date>" ₹15,000; due today → **DUE** badge + amber border.

### 22.2 Frequencies & interval
- **Steps:** Add Weekly, Yearly, Custom; use − / + to set "repeat every 2".
- **Expected:** Hint reads "Every 2 weeks / years / days". Custom = every N days.

### 22.3 Summary header
- **Expected:** With ≥1 template, a dark card: **Due now** (count), **Due amount** (₹), **Per month** (run-rate; weekly ₹1,000 ≈ ₹4,333/mo).

### 22.4 Mark paid & record
- **Steps:** On a **DUE** row → **Mark paid & record** → confirm.
- **Expected:** An expense for that amount/category is created dated the due date; next due advances one cycle to a **future** date; DUE clears; "Due now" drops.

### 22.5 Month-end handling
- **Steps:** Monthly template next due **Jan 31** → mark paid.
- **Expected:** Next due lands **Feb 28** (clamped), then **Mar 31** — intended day-of-month preserved.

### 22.6 Missed cycles catch up
- **Steps:** Monthly template due ~3 months ago → mark paid once.
- **Expected:** One expense recorded; next due jumps to the next **future** occurrence.

### 22.7 Idempotent posting
- **Steps:** Rapidly tap **Mark paid** twice for the same due date.
- **Expected:** Only **one** expense created (no double-charge).

### 22.8 Edit / pause / delete
- **Steps:** Change amount, Status → **Paused**, save. Then Delete.
- **Expected:** Paused never shows DUE and is excluded from run-rate; edits persist; delete removes the row.

### 22.9 Validation & empty state
- **Steps:** Save with blank name / zero amount / no category.
- **Expected:** Inline errors block save. New business shows "No recurring expenses yet" + CTA.

## 23. Cash counter

### 23.1 Count physical cash
- **Steps:** Settings → Business → **🪙 Cash counter**. Enter ₹500 × 10, ₹200 × 5, ₹100 × 8, ₹50 × 4.
- **Expected:** Row subtotals (₹5,000 / ₹1,000 / ₹800 / ₹200); bottom bar **Total ₹7,000** with piece count (27). Only digits accepted.

### 23.2 Reset
- **Steps:** **Reset**.
- **Expected:** Counts clear; total ₹0.

---

# PART F — Daily summary & notifications

## 24. Daily summary & notifications

### 24.1 Today's summary
- **Steps:** Dashboard → Daily summary.
- **Expected:** Income / Expense / Profit hero for today; Top expense categories with shares; empty state when nothing today.

### 24.2 Notification schedule
- **Steps:** Toggle the daily-summary notification On/Off; adjust delivery time − / +.
- **Expected:** Persists; time wraps 00–23.

### 24.3 Send now
- **Steps:** **Send summary now**.
- **Expected:** "Summary sent" listing channels; a new item in the inbox (bell badge increments).

### 24.4 Notification inbox
- **Steps:** Bell (Dashboard) or Daily summary → **Open notifications**.
- **Expected:** Inbox list; unread dots; opening marks all read (badge clears); **Clear all** empties; empty state when none.

### 24.5 WhatsApp delivery (only when configured)
- **Steps:** With `WHATSAPP_ENABLED=true` in the build **and** server `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` set: Daily summary → **Send summary now**.
- **Expected:** Summary arrives on WhatsApp; `GET /api/v1/notifications/whatsapp/status` → `{"configured": true}`. If not configured, the channel is silently skipped and the in-app inbox still receives it (no error).

---

# PART G — Offline & sync (cross-cutting)

## 25. Offline & sync

### 25.1 Queue while offline
- **Steps:** Airplane mode → create several incomes/expenses/ledger entries.
- **Expected:** All saved locally, shown **Pending**; Dashboard shows "Offline · N pending sync".

### 25.2 Auto-sync on reconnect
- **Steps:** Disable Airplane mode; wait / reopen.
- **Expected:** Background sync flushes the queue; Pending → synced; "Syncing N items…" appears then clears; figures reconcile.

### 25.3 No duplication on retry
- **Steps:** After syncing, pull-to-refresh and reopen lists.
- **Expected:** Each queued item appears exactly once (idempotent client_id dedupe server-side).

### 25.4 Sync failure handling
- **Steps:** Simulate a server error during sync.
- **Expected:** Item stays queued, marked **Failed** with a retry count; retries on the next sync.

### 25.5 Persistence across restarts
- **Steps:** Queue offline entries, force-quit, reopen (still offline), then go online.
- **Expected:** Pending entries survived and sync once online.

### 25.6 Two-device edit conflict (customers)
- **Context:** Income/expense/ledger are **create-only + idempotent** (never conflict). The editable record is the **customer profile**, which uses optimistic concurrency (a `version` token).
- **Steps:** Open the same customer on **two devices**. On A edit the name and **Save**. On B (old copy) edit and **Save**.
- **Expected:** A saves. B is **rejected with "Edited on another device"** and taken back — A's change is not overwritten. Reopening on B shows A's latest; editing from there saves fine.

---

# PART H — Security, privacy & data rights

## 26. App lock (PIN)

### 26.1 Open Settings
- **Steps:** Dashboard → ⚙️ (top-right).
- **Expected:** Settings with sections: **Security** (App lock, security info card), **Preferences** (Content + Voice language), **Payments** (owner), **Business** (Team/Items/Cash counter/Notifications/Privacy & consent/Help/Diagnostics/Restore), **Your data & privacy**, **Privacy & Grievances**, Privacy Policy, Terms, Log out.

### 26.2 Enable app lock (set PIN)
- **Steps:** App lock → **On** → 4-digit PIN → re-enter on "Confirm your PIN".
- **Expected:** "App lock enabled"; toggle stays **On**.

### 26.3 PIN mismatch
- **Steps:** Enter a different 4 digits on confirm.
- **Expected:** "PINs did not match. Start again." → back to "Set a PIN".

### 26.4 Lock on background
- **Steps:** With app lock on, background and reopen.
- **Expected:** Full-screen 🔒 "Enter your PIN" overlay before any content.

### 26.5 Unlock
- **Steps:** Enter the correct PIN.
- **Expected:** Overlay disappears; app returns exactly where it was.

### 26.6 Wrong PIN
- **Steps:** Enter an incorrect PIN.
- **Expected:** "Incorrect PIN. Try again."; field clears; stays locked.

### 26.7 Cold-start lock
- **Steps:** Swipe-close and relaunch.
- **Expected:** PIN screen before the Dashboard/splash.

### 26.8 Disable app lock
- **Steps:** App lock → **Off** → confirm "Turn off app lock?".
- **Expected:** PIN removed; relaunch no longer prompts.

## 27. Biometric unlock

### 27.1 Enable biometric
- **Steps:** With app lock **On** and a device that has fingerprint/Face set up: Settings → Security → **Biometric unlock** → **On**.
- **Expected:** OS enrolls it; toggle stays On. On a device with no biometrics the row is hidden, or enabling shows "Biometrics unavailable — no fingerprint or face unlock set up".

### 27.2 Unlock with biometric
- **Steps:** Background/relaunch with biometric on → present face/finger at the lock screen.
- **Expected:** OS biometric prompt; success unlocks. Cancel/failure falls back to the PIN entry (never locks you out).

### 27.3 Disable biometric
- **Steps:** Security → Biometric unlock → **Off**.
- **Expected:** Enrolment cleared; next lock uses PIN only.

## 28. Your data & privacy (self-service data rights — DPDP)

### 28.1 Download my data
- **Steps:** Settings → Your data & privacy → **Download my data**.
- **Expected:** Button shows loading; the app fetches the full export, writes `smart-cashbook-data-YYYY-MM-DD.json`, and opens the OS share sheet (Files/Drive/email). "Export ready" confirmation. Cancelling the share is **not** treated as an error.

### 28.2 Export contents
- **Steps:** Open the shared JSON.
- **Expected:** Contains the user's own account, business, transactions, customers and ledger — a complete, human-readable export.

### 28.3 Correct account/business info
- **Steps:** Your data & privacy → **Edit business info** → change name/owner/type/state/GST → **Save**. (Owner-only.)
- **Expected:** Requires business name + owner name (else "…required"); saves via PATCH /businesses/me; the change shows **immediately** (Dashboard/Settings reflect the new name).

### 28.4 Delete account — warning & confirmation phrase
- **Steps:** Your data & privacy → **Delete account**.
- **Expected:** Red-titled screen listing exactly what's erased (business, transactions, customers, "irreversible"). The **Delete** button is **disabled** until you type the exact confirmation phrase.

### 28.5 Delete account — execute
- **Steps:** Type the confirmation phrase → **Delete** → confirm the final alert.
- **Expected:** Calls DELETE /account; data is really erased server-side and the deletion is **logged with a timestamp** (compliance record, PII-free); the session is cleared and you return to Login. Logging back in does **not** restore the deleted data (a fresh onboarding starts).

### 28.6 Delete account — cancel
- **Steps:** Open Delete account → **Cancel** (or wrong phrase).
- **Expected:** Nothing deleted; returns safely.

## 29. Privacy & consent management

### 29.1 Open consent settings
- **Steps:** Settings → **Privacy & consent**.
- **Expected:** Every purpose listed with its current state and last-updated date; **Core** shown locked-on (required); **Marketing** and **AI processing** toggleable; policy version shown.

### 29.2 Turn AI processing ON
- **Steps:** Toggle **AI processing** ON.
- **Expected:** Saved server-side; AI features (Part D) now reach the provider.

### 29.3 Withdraw AI consent
- **Steps:** Tap **Withdraw** under AI processing → confirm.
- **Expected:** Confirmation explaining AI features will stop; on confirm the toggle goes OFF; AI endpoints return the "turn on AI" message again and insights fall back to heuristic (§11.5). No data is sent while off.

### 29.4 Marketing consent
- **Steps:** Toggle/withdraw Marketing.
- **Expected:** Independent of AI/core; persists.

### 29.5 Load error
- **Steps:** Open with the backend unreachable.
- **Expected:** An error state with **Retry** (not a blank screen).

## 30. Privacy & Grievances contact (DPDP)

### 30.1 Grievance section is present and separate
- **Steps:** Settings → scroll to **Privacy & Grievances**.
- **Expected:** A card with the **Grievance/Data-Protection Officer name** and a **dedicated email**, visibly **separate** from generic support (Help/§32). A **Contact** button opens the mail composer to that email with a privacy/grievance subject.

### 30.2 Matches the policy
- **Steps:** Compare the grievance name/email against the Privacy Policy (§31) and Terms.
- **Expected:** **Identical** contact details in Settings, the Privacy Policy, and the Terms (no drift — they share one source).

> ⚠️ **Pre-launch:** the grievance officer name/email and company/effective-date
> in the legal templates are **placeholders** ([legalContent.ts](src/features/legal/domain/legalContent.ts),
> [constants.ts](src/config/constants.ts)). Counsel must fill real values before release.

## 31. Legal documents (Privacy Policy & Terms)

### 31.1 Open from login
- **Steps:** On Login, tap **Terms** and **Privacy Policy** in the footer.
- **Expected:** Each opens the in-app document screen (Terms / Privacy) with real content; **Done** returns to Login.

### 31.2 Open from settings
- **Steps:** Settings → **Privacy Policy** / **Terms**.
- **Expected:** Same screens open in the app stack.

### 31.3 Language selector
- **Steps:** On a legal screen, if >1 language is registered, use the language selector.
- **Expected:** A selector appears **only when a professional translation is registered**; English is always the fallback. Switching re-renders the doc in that language with the same contact/company tokens filled. With only English registered, no selector shows (English content only) — no crash.

### 31.4 Content sanity
- **Steps:** Read each document.
- **Expected:** Sections render (Who we are, Data we collect, AI processing & sharing, Security, Your rights, Retention, Grievance officer, etc.); grievance contact matches §30.

---

# PART I — Support, feedback & diagnostics

## 32. Help & support

### 32.1 FAQ accordion
- **Steps:** Settings → **Help** (or Settings → Business → Help).
- **Expected:** FAQ list; tapping a question expands/collapses its answer; first item open by default.

### 32.2 Chat on WhatsApp
- **Steps:** **Chat on WhatsApp**.
- **Expected:** Opens WhatsApp to the support number with a prefilled message (falls back to `wa.me` link if the app isn't installed).

### 32.3 Email us
- **Steps:** **Email us**.
- **Expected:** Mail composer opens to the support email with a subject.

### 32.4 Report a problem
- **Steps:** **Report a problem**.
- **Expected:** Opens the Feedback screen pre-set to **Bug** (§33).

## 33. Feedback / report a problem

### 33.1 Send feedback
- **Steps:** Feedback → choose **Bug**/**Idea** → type a message → **Send**.
- **Expected:** Submits to the backend; "Thanks" confirmation; returns. Empty message disables Send (max 2000 chars).

### 33.2 Diagnostics transparency
- **Steps:** Expand "what diagnostics we attach".
- **Expected:** Shows exactly the device/app diagnostics snapshot that will be sent (transparent; no hidden PII beyond what's shown).

### 33.3 Offline / failure fallback
- **Steps:** Airplane mode → Send.
- **Expected:** "Couldn't send" with **Email instead** (opens mail with the message + diagnostics prefilled) and **Cancel**. No data lost.

## 34. Diagnostics / error log

### 34.1 Empty state
- **Steps:** Settings → **Diagnostics** on a healthy session.
- **Expected:** "✅ No errors logged" empty state.

### 34.2 Errors are recorded
- **Steps:** Force a failure (e.g. an API call while the backend is down), then open Diagnostics.
- **Expected:** A recent entry with context (e.g. "api GET /customers") and message + a relative timestamp ("2m ago"). A jailbreak detection (§4.7) appears as a `security/device-integrity` entry, logged **once** per session.

### 34.3 Share log
- **Steps:** **Share**.
- **Expected:** OS share sheet with a plain-text dump of the entries (for a support ticket).

### 34.4 Clear log
- **Steps:** **Clear** → confirm.
- **Expected:** Entries removed; empty state returns.

## 35. Crash resilience (error boundary)

### 35.1 Recoverable errors
- **Steps:** If any screen hits an unexpected error.
- **Expected:** Instead of a white-screen crash, a "Something went wrong" card with the message and a **Try again** button.

---

# PART J — Localization

## 36. Language / localization

### 36.1 Onboarding language
- **Steps:** During onboarding pick Hindi (or other) as preferred content language.
- **Expected:** Saved to the profile.

### 36.2 Switch content language (live)
- **Steps:** Settings → Preferences → Content language → **Hindi**.
- **Expected:** The app **immediately** re-renders in Hindi where localized — **Dashboard** (आय / व्यय / नकद शेष / रिपोर्ट / hero labels / quick actions / recent activity / logout) and **Settings**. Switch back to English to revert.

### 36.3 Voice language
- **Steps:** Settings → Preferences → Voice language → pick a language.
- **Expected:** Persists; drives the voice-entry dictation language.

### 36.4 Fallback languages
- **Steps:** Pick Kannada / Tamil / Telugu.
- **Expected:** Localized screens fall back to English cleanly (Hindi is the fully translated set) — no missing text or crash.

---

# PART K — Roles & permissions

## 37. Roles & permissions (multi-user business)

Roles: **owner** (full), **accountant** (view + export + add/edit, no
delete/settings/team), **staff** (add entries only). The **server enforces**
every rule (403); the app also hides what a role can't do.

### 37.1 Owner adds team members
- **Steps:** Owner → Settings → **Team & roles** → mobile number → **Staff**/**Accountant** → **Add to business**.
- **Expected:** Member appears with their role. Re-adding an existing mobile **updates the role** (no duplicate).

### 37.2 Member gains access on login
- **Steps:** Log in with the invited **mobile**.
- **Expected:** Lands in the shared business with the assigned role (no onboarding, no new business).

### 37.3 Staff — add-only home
- **Steps:** Log in as **staff**.
- **Expected:** Minimal home with **only add actions** (AI Entry, + Income, − Expense, Scan receipt) + Log out. **No** figures, transactions, customers, reports, or settings. Blocked APIs return 403.

### 37.4 Accountant — view/export, no delete/settings/team
- **Steps:** Log in as **accountant**.
- **Expected:** Full dashboard, customers, khata, **reports + PDF/Excel export**, add/edit entries & customers. Settings hides UPI, Item-catalog and **Team**; no delete/team access.

### 37.5 Owner — full access
- **Expected:** Everything, incl. Settings → Team & roles, UPI, item catalog, recurring, delete, data-rights edit.

### 37.6 Manage & guardrails
- **Steps:** Owner → Team → **Manage** a member → change role / remove. Try to demote/remove the **only owner**.
- **Expected:** Changes/removal work; the **last owner can't be demoted or removed** ("promote someone else first").

### 37.7 Role change takes effect on next login
- **Steps:** Owner changes a role; that member logs out and back in.
- **Expected:** Access reflects the new role (resolved live server-side; refreshed on login).

---

# PART L — Backend, connectivity & production readiness

## 38. Backend / connectivity edge cases

| # | Steps | Expected |
|---|---|---|
| 38.1 | Open `…/health`, `…/docs`, `…/` | 200 `{"status":"ok"}`; Swagger UI; friendly JSON at root (not "Not Found") |
| 38.2 | Cold start: idle >15 min, then open | First call slow (~30–60s) then recovers; not a permanent offline |
| 38.3 | Wrong/HTTP-only API URL in a build | App shows offline figures / connection error |
| 38.4 | Expired/invalid token | 401 → app routes back to Login |

## 39. Security hardening (production backend, `DEBUG=false`)

### 39.1 General rate limiting (per-IP / per-user)
- **Steps:** Against the production backend, script or rapidly repeat requests to any endpoint far beyond normal use from one client.
- **Expected:** Once over the rolling per-IP (or per-user) budget the API returns **429** with a `Retry-After` header and `{"detail":"Too many requests…"}`. Normal usage is never limited. (No-op on a `DEBUG=true` staging backend by design.)

### 39.2 Auth-path stricter limit
- **Steps:** Hammer `/auth/*` (OTP request/verify) from one IP.
- **Expected:** The stricter auth per-IP budget trips **429** sooner than general endpoints — blunts OTP brute force / credential stuffing.

### 39.3 Secure token storage
- **Steps:** (Code/QA verification) Confirm the JWT session is stored in the iOS Keychain / Android Keystore, not plaintext AsyncStorage.
- **Expected:** Existing users updating from an older build are **not logged out** (one-time migration); a fresh login persists to the secure store. See [secureAuthStorage.ts](src/features/security/data/secureAuthStorage.ts).

### 39.4 TLS enforced
- **Steps:** Confirm release builds refuse cleartext HTTP (Android network-security-config; iOS ATS).
- **Expected:** Any accidental `http://` API call fails; all traffic is HTTPS.

### 39.5 Certificate pinning status
- **Steps:** Confirm the pinning config state before release.
- **Expected:** Cert pinning ships **scaffolded but DISABLED** (placeholder pins in [Info.plist](ios/AISmartCashBook/Info.plist) / [network_security_config.xml](android/app/src/main/res/xml/network_security_config.xml)). Enabling it is an operator decision requiring real Let's-Encrypt **CA** SPKI pins + a backup pin — see [docs/CERTIFICATE_PINNING.md](docs/CERTIFICATE_PINNING.md). **Do not** ship with placeholder pins enabled.

## 40. Crash reporting (Sentry)

### 40.1 Backend Sentry
- **Steps:** With `SENTRY_DSN` set on Render, trigger a handled security alert / unhandled error.
- **Expected:** Event reaches Sentry (email alert); no PII in the payload (`send_default_pii=False`). Blank DSN = no-op (dev/tests).

### 40.2 Mobile crash reporting
- **Steps:** Follow [docs/SENTRY_REACT_NATIVE_SETUP.md](docs/SENTRY_REACT_NATIVE_SETUP.md) to verify iOS and Android crash capture end-to-end.
- **Expected:** A forced test crash on each platform surfaces in Sentry with a symbolicated stack.

---

## Regression checklist (quick smoke)

1. Login (`123456` on staging) → **Consent** → onboarding → Dashboard.
2. Add income + expense (today) → Dashboard figures update.
3. Add a customer → add credit → receive payment → outstanding correct.
4. Khata dashboard shows receivable/overdue; insights load.
5. Airplane mode → add entries (Pending) → reconnect → all sync, no dupes.
6. Reports → Month → figures correct → export PDF opens the share sheet.
7. Settings → enable App lock → background & reopen → unlock with PIN (and biometric if available).
8. Settings → Item catalog → add a product with 18% GST → appears in the list.
9. 🎤 AI Entry → `ramesh paid 2000` → Read → Confirm & save → customer + payment created.
10. Settings → switch language to Hindi → Dashboard renders in Hindi.
11. Settings → Payments → set UPI ID → customer → 💳 Request → QR shows → Mark as received.
12. Khata → 🔎 Customer intelligence → aging buckets + "who owes the most" populated.
13. Dashboard → 📈 Business summary → yesterday digest, profit, trends, forecast render.
14. Settings → 🪙 Cash counter → ₹500×10 + ₹200×5 + ₹100×8 + ₹50×4 = ₹7,000.
15. Dashboard → 🤖 Ask AI → "Who owes me the most?" → correct name + amount.
16. Dashboard → 🔁 Recurring → add a monthly rent due today → Mark paid → expense created, next due advances.
17. Settings → Privacy & consent → turn **AI processing ON**, run an AI feature, then **Withdraw** → AI blocked again with a clear message.
18. Settings → Your data & privacy → **Download my data** → JSON share sheet opens.
19. Settings → Your data & privacy → **Delete account** → phrase-gated → data gone, back to Login.
20. Settings → Privacy & Grievances contact present + matches Privacy Policy; Terms & Privacy open from Login and Settings.
21. Log out → log in with a **different** number → new Dashboard shows **no** prior-account data.
22. Log out → log in with the **original** number → straight to that business's Dashboard (no re-onboarding).
23. Log out → back to Login.

---

## 41. Production readiness sign-off

Tick before shipping to production:

- [ ] Automated suites green: `npm test` (162) and `pytest` (214).
- [ ] Pointed at the **production** backend (`DEBUG=false`): master OTP rejected, rate limiting active (§39.1–39.2).
- [ ] Legal/company placeholders filled by counsel: company legal name, address, effective date, grievance officer name + email (§30.2 drift check passes).
- [ ] Consent defaults verified: Marketing + AI **OFF** by default; AI gating works both directions (§29).
- [ ] Data-rights flows verified end-to-end: download, correct, delete (with server-side deletion log) (§28).
- [ ] Secure token storage confirmed; upgrade migration doesn't log users out (§39.3).
- [ ] TLS enforced in release; cert pinning decision made (ship disabled unless real CA pins are filled) (§39.4–39.5).
- [ ] Crash reporting verified on backend + iOS + Android (§40).
- [ ] App lock + biometric verified on a physical device (§26–§27).
- [ ] Offline → sync → no-duplicate journey verified on a device (§25).
- [ ] Roles enforced server-side (staff/accountant/owner) (§37).
- [ ] Regression smoke checklist (all 23) passes on both iOS and Android.

---

### Automated coverage
Much of the above logic is also covered by automated tests — run them before a
release: `npm test` (frontend, **162**) and `cd backend && python -m pytest`
(backend, **214** +1 xfail). See [TESTING.md](TESTING.md).
