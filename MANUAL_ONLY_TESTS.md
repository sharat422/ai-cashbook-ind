# Bolcash — Manual-only test pass

The cases from [MANUAL_TESTING.md](MANUAL_TESTING.md) that the automated
tests **can't** check: real phones, camera and mic, apps the phone hands off
to (WhatsApp, dialer, mail, share sheet, Excel), the real AI models, real
files from banks and CAs, production settings, and the screens themselves.
Everything else in MANUAL_TESTING.md is already checked on every push by
`npm test` and `pytest`. The table at the end lists what was left out and
which test covers it.

Each case keeps its § number from MANUAL_TESTING.md; look there for the full
background if a case is unclear. The cases are grouped by what you need in
your hand, so you set up once per group.

| # | Group | You need | Time |
|---|---|---|---|
| 1 | First launch and login | 1 phone, fresh install | 15 min |
| 2 | Screens (UI smoke) | 1 phone, owner account | 30 min |
| 3 | Camera, mic and hand-offs to other apps | 1 phone with WhatsApp, a mail app, Excel/Sheets | 35 min |
| 4 | App lock and biometrics | 1 phone with fingerprint/face set up | 10 min |
| 5 | Offline on a real phone | 1 phone | 20 min (+ optional 2 h wait) |
| 6 | Two phones / other people | 2 phones, a laptop or phone without Bolcash | 25 min |
| 7 | Real AI (staging, AI consent ON) | 1 phone, test data with known totals | 45 min |
| 8 | Real files and outside checks | Real bank statements, a CA, a native Telugu speaker | spread over days |
| 9 | Production / release settings | `main` build, production backend | 30 min |
| 10 | Low-end device | The low-end test phone | 20 min |

**Before you start:** CI must be green on the build you test (`npm test` and
`pytest`). Use a `dev` build (staging, OTP `123456`) for groups 1–8 and a
`main` build for group 9. Turn **AI processing ON** (Settings → Privacy &
consent) before group 7. Run groups 1–5 on **both Android and iOS** if you can.

---

## 1. First launch and login (fresh install)

**1.1 / 1.1a / 36.6 — Splash, welcome carousel, Telugu login**
- **Steps:** Fresh install (or clear app data). Open the app. Swipe the carousel, then relaunch.
- **Expected:** Splash about 1.5 s → 3-slide carousel (Skip / Next / Get started) → Login. Relaunch: no carousel. The login screen is in **Telugu** with a **తెలుగు / Hinglish / English** toggle; tapping Hinglish or English switches the whole screen at once.

**1.2–1.7 — Login screen behaviour**
- **Steps:** Tap Continue empty, then letters, then `12345`, then a valid number. On the OTP screen: type `000000`; tap Change number; come back, watch the resend timer to 0 and tap Resend; then type `123456`.
- **Expected:** Inline errors for empty/short; only digits, max 10, `+91` fixed. Wrong OTP → inline "Invalid OTP", stays. Change number returns with the number editable. Timer counts down from 30, then Resend works and shows "OTP sent". The right OTP submits by itself on the 6th digit.

**1.10 — OTP needed on every cold start**
- **Steps:** Log in and reach home. Swipe the app away and reopen (twice). Then press Home and come back without closing.
- **Expected:** Every cold start → Login and a new OTP; after OTP your business and data are back (no Create business). Home → back does **not** log you out. The chosen language is still applied on Login. With App lock ON (group 4): PIN first, then Login.

**1.14 — Restore offer on a fresh install**
- **Steps:** On a fresh install, log in with a number that already has data. Choose **Restore my data**. Log out and in again.
- **Expected:** "Restore your data" with counts → progress (customers → income → expense → done) → home. Not offered again on later logins on this phone. With the backend unreachable: "Couldn't check your data" with Retry / Continue without restoring.

**2.1 / 3.3 — Consent and business screens (new number)**
- **Steps:** Log in with a brand-new number.
- **Expected:** Consent shows three separate rows: Core (locked on), Marketing (off), AI processing (on, can be switched off). Then Create business in the card layout, then home.

**4.7 — Rooted / jailbroken device** *(only if you have one, or an emulator the detector flags)*
- **Expected:** A non-blocking amber "Device security warning" banner; the app stays usable; ✕ hides it for the session. Clean phone: no banner.

---

## 2. Screens (UI smoke)

The logic behind these screens is tested; this pass checks that the buttons
and screens are wired up. Go fast and stop only if something is broken, blank,
in the wrong language, or crashes.

1. **Home (4.1–4.4):** figures, quick actions, recent activity; pull to refresh shows skeletons then numbers. New business: "No activity yet".
2. **Add income / expense (5.1–5.4, 5.7, 6.1–6.3, 6.5):** save one of each; try amount empty and 0, a future date, notes over the limit (280 income / 5,000 expense) → messages under the fields; category chips select one at a time; Cancel saves nothing.
3. **Transaction history (7.1–7.5):** View all → search, filters (chips removable, badge count), each sort, a filter matching nothing → "No transactions found" + Clear filters.
4. **Reports (8.1–8.5):** each date preset and a custom range; a range with nothing → "Nothing to report"; negative profit shows red.
5. **Customers (9.1–9.5, 10.1–10.4):** add a customer, search, edit, open the profile (all sections show), add credit (quick amounts add up), save a credit as draft → reopen → "Draft restored" → Discard; receive a payment with each method chip (reference field changes; UPI needs a UTR).
6. **Credit limit (16.1, 16.3):** set ₹50,000 → take dues to ~₹47,500 (amber warning) then over (red, also shown on Add credit before saving). Payment Score card shows.
7. **Khata and insights (11.1–11.3, 16.4, 16.5, 18.1–18.4):** Khata dashboard figures and trend; presets; Customer intelligence ageing buckets and smart lists (tap a row → that customer); Business summary cards.
8. **Items, recurring, cash counter (21.1–21.5, 22.1–22.9, 23):** add a product and a service, empty name / no price errors, edit, delete; add a monthly recurring due today → DUE badge → Mark paid → next due moves on; pause → no DUE; cash counter ₹500×10 + ₹200×5 + ₹100×8 + ₹50×4 = **₹7,000**, 27 pieces, Reset.
9. **Create business validation (3.2):** on a new number, tap Create business with everything blank → an error on every required field.
10. **Settings and data rights (26.1, 28.3, 28.4, 28.6, 29.1–29.5):** all sections present; Edit business info → name changes on home at once; Delete account → Delete stays disabled for `delete my account` and enables only for `DELETE MY ACCOUNT` (**not covered by any automated test**), then Cancel; consent screen toggles AI and Marketing independently, Withdraw asks first; with the backend down → error + Retry.
11. **Team, roles and accountant (37.1–37.7, 37I.1–37I.2):** add a staff and an accountant; log in as each. Staff home: only add actions, no figures, no Ask AI. Accountant home: blue "Read-only access" note, no add/edit buttons on home, customer list or customer profile. Owner → Team → Manage: change role, remove; the only owner can't be demoted.
12. **Beats, stock, schemes (37A.1–37A.5, 37A.7, 37J, 37D.1–37D.5, 37M.2, 37E.1, 37E.7):** create, edit and delete a beat, reorder shops, open History and a shop's 🚶 Visits; staff sees today's list and records each visit type; stock purchase (supplier, price, bill), load van, sale, count; give a staff member a name and see it on the van; one 10+1 bill shows the free line; scheme log and report open.
13. **Reconciliation, GST, import, sync (37B.4–37B.6, 37C.1–37C.2, 37G.1–37G.4, 37H.2, 37K, 37L.4):** confirm a suggested match; Match by hand with two collections, and one collection with two bank lines (37K.9); Undo; Delete statement; enter counted cash in Daily close; record a cash deposit and kept-back cash and match the deposit (37K.11); the statement import screen's column pickers and date-format chips; a GST sale shows the tax box, the item picker fills HSN/rate/unit; khata import preview → import → past imports; Sync status screen tiles.
14. **Notifications (24.1–24.4):** Daily summary; toggle the schedule and move the time past 23 (wraps); Send summary now → bell badge goes up → inbox → opening clears the badge → Clear all.
15. **Help, feedback, diagnostics, error card (32.1, 32.4, 33.1, 33.2, 34.1, 34.2, 34.4):** FAQ expands; Report a problem opens Feedback set to Bug; send feedback; the diagnostics preview shows what's attached; force an API error (backend down) → Diagnostics lists it → Clear.

---

## 3. Camera, mic and hand-offs to other apps

**Camera and gallery (5.5, 14.1, 14.4)**
- Add income → attach a photo from the gallery → saves with the attachment.
- Scan receipt → Take photo (allow camera) and Choose from gallery; cancel returns cleanly.
- Airplane mode → scan → "Couldn't read the receipt" with Retry and **Enter manually**.

**Voice in AI Entry (17.5, 17.5a, 17.5b, 36.3)**
- Pick a voice language, tap 🎤, allow the mic, say "Ramesh ko 2500 ka maal diya", tap ⏹ → live words while speaking, then "Transcribing…", final text in the box and parsed.
- Right after the final text appears, switch on airplane mode → the text stays; **no** "Live transcription disconnected before completion".
- Deny the mic permission → "Voice is unavailable right now"; typing still works.
- A recording stops by itself at about 2 minutes; long use in a day is never blocked.

**Voice in Ask AI (19.10, 19.9 60-second stop)**

| Steps | Expected |
|---|---|
| Tap 🎤 **once** | First time: mic prompt. Then "Connecting…", then "Listening… 0:03 / 1:00"; button turns red ⏹ |
| Say `aaj ka collection kitna hai` | Words appear in the box as you speak |
| Tap ⏹ | "Transcribing…"; final text replaces the live text. **Nothing is sent by itself** |
| Edit a word, tap ➤ | The edited question is answered |
| Tap 🎤, stay silent, tap ⏹ | "I didn't catch that - try again or type it." |
| Lose network while speaking | "Voice didn't work: …"; the words so far stay in the box |
| While "Transcribing…", tap ➤ | Sends the box; a late transcript does not overwrite it |
| Leave the screen / background the app while listening | Recording stops; nothing sent |
| Speak for over 60 s | Stops by itself at about 60 s; words so far stay |
| Telugu and Tamil voice | Work the same way (Malayalam: note how well it works, don't block) |

**Phone, WhatsApp, SMS, share sheet (9.6, 12.2, 13.1, 20.5, 20.6, 32.2, 36.7 reminder)**
- 📞 Call opens the dialer with the customer's number.
- 🤝 Collect → WhatsApp opens to the customer with the message (SMS if WhatsApp isn't installed); Share opens the share sheet.
- 🔔 Reminder → send on WhatsApp; with the app in Telugu, the message that opens in WhatsApp is in Telugu.
- 💳 Request → Send on WhatsApp (amount, UPI ID, tappable `upi://` link, reference) and Share payment request.
- Help → Chat on WhatsApp opens the support chat (or `wa.me` without the app).

**UPI QR scans in a real UPI app (20.2, 20.4, 20.7, 20.8)**
- Settings → Payments → your UPI ID. Customer → 💳 Request → change the amount → scan the QR with GPay / PhonePe (don't pay).
- **Expected:** The UPI app shows **your** payee name and UPI ID and the **amount you typed**. ✓ Mark as received adds a UPI payment and the balance drops.

**Mail (30.1, 32.3, 33.3)**
- Settings → Privacy & Grievances → Contact opens mail to the grievance email with a subject.
- Help → Email us opens mail to support.
- Airplane mode → send feedback → "Couldn't send" → **Email instead** opens mail with the message and diagnostics filled in.

**Files you open in other apps (8.6–8.9, 28.1, 28.2, 34.3, 36.7, 36.10)**
- Reports → custom range → ⬇ PDF: share sheet; the PDF has the summary, categories and a transaction table; the file name has the range. ⬇ Excel: two sheets, amounts are numbers (they add up in Excel). Change the range and export again → only that range.
- Offline → export either → built from the phone's entries (pending ones included).
- Your data & privacy → Download my data → JSON share sheet; cancelling the share is **not** an error; the file contains your account, business, transactions, customers and ledger.
- Diagnostics → Share → plain-text log in the share sheet.
- In Telugu: customer Statement → 📄 PDF and 📊 Excel → Telugu headings show correctly (open the Excel in Excel or Google Sheets, not just a preview).
- Settings → 📦 Your data → All data (Excel), Customer balances (PDF), Full backup: files open; the DRAFT banner shows; as staff, Excel/PDF are replaced by "ask the owner".

**Notifications on the phone (24.5)** *(only if WhatsApp delivery is configured on the server)*
- Send summary now → it arrives on WhatsApp. Without the config, only the in-app inbox gets it, with no error.

---

## 4. App lock and biometrics (26.2–26.8, 27.1–27.3)

- App lock → On → PIN → confirm with a different PIN → "PINs did not match"; set it properly → "App lock enabled".
- Background and reopen → PIN overlay before any content; wrong PIN → "Incorrect PIN", field clears; right PIN → back exactly where you were.
- Swipe-close and relaunch → PIN before anything, then Login.
- Biometric unlock → On → background → face/finger unlocks; cancel the prompt → PIN still works (never locked out). Biometric Off → PIN only. On a phone with no biometrics the row is hidden or says it's unavailable.
- App lock → Off → confirm → relaunch has no PIN.

---

## 5. Offline on a real phone

**37H.1 — 20 entries offline, app killed, synced once** *(also a release sign-off item)*
- **Steps:** Airplane mode. Add 5 incomes, 5 expenses, 3 udhar and 2 payments, and 5 beat visits. Kill the app halfway. (Optional: wait 2 hours.) Reconnect and open the app.
- **Expected:** Each save finishes at once with "will sync". Home shows "⏳ 20 waiting to sync · offline", also after the kill. After reconnecting → "✓ All synced". On phone B (or the web) exactly 20 new records, none twice.

**Offline messages (4.5, 8.9, 11.4, 37C.3, 37H.4)**
- Home offline: the status line ends "· offline" and the amber "offline figures" banner shows.
- Khata dashboard offline → "Offline — on-device trend & collections only".
- GST sale offline → "You're offline. The tax will be worked out when this syncs."; after sync the entry shows the server's total.
- Offline, add an entry, then Log out → the warning gives the count and the button reads "Log out and delete them"; Cancel keeps everything.

---

## 6. Two phones / other people

**Statement link on a phone without Bolcash (37F.1, 37F.4, 37F.5)**
- Customer A → Statement → 📩 SMS link → open it on a device that has never had Bolcash. The page shows the balances, ageing and entries; **Download PDF** opens a real PDF with the same figures; Hindi/Telugu names show correctly.
- On that page tap **Stop WhatsApp statements** → owner's 🟢 WhatsApp link is now refused. Opt back in from the same page.
- Statement → 🖨️ Printable ledger → print or save as PDF: A4 pages with page totals, brought forward and period total.

**WhatsApp consent (37F.3)**
- Before consent: 🟢 WhatsApp link refused. Retailer agreed → it opens WhatsApp to the retailer with the link.

**Two phones on one business (16.2, 37H.3, 37I.5)**
- Set a credit limit on phone A → the same limit shows on phone B and on the staff day-list.
- Open the same customer on both; save an edit on B, then a different edit on A → A shows **Changed on two phones** with both versions; nothing changes until you pick.
- Phone B logged in as the accountant, a customer open → owner removes access on A → B's next tap signs it out with "The owner has removed your access…".

---

## 7. Real AI (staging, AI consent ON)

**Run the scripted pack instead of asking the question tables by hand (19.15, covers most of 19.2–19.8)**
```
cd backend
python scripts/chatbot_eval.py           # 50 account + 30 app-help + 20 attack questions
python scripts/voice_accuracy_eval.py    # needs the clips/ recordings and META_MODEL_API_KEY
```
- **Pass bar:** 0 wrong numbers and 0 unsafe answers. Any single one blocks release. Also check the help answers and the p95 time in the report.

**Ask AI screens (19.1, 19.4–19.6, 19.11, 19.14)**
- Opening: title, text box, 🎤, the six suggestion chips; tapping a chip asks it.
- Under a balance answer: an "As of …" date chip; under a period answer: "from – to".
- **View details** opens the right screen (one customer → profile; transactions → history; dues/collections → Khata) and the numbers match.
- Two customers named Ramesh: `Ramesh ka balance?` → **Which one?** buttons; tap one → answer for that one only.
- 👍 shows selected; 👎 with a note → "Thanks for the feedback"; New chat clears; airplane mode → "Sorry — …" in the chat, no crash.
- Settings → Privacy & consent → **Save Ask AI history** is OFF by default; **Delete voice history** → "Voice history deleted."

**Ask AI languages (19.12, 36.5)** — set the app to each and ask `Ramesh ka balance kitna hai?` in that language: Hinglish (Roman script), Hindi, English, Telugu, Tamil, Malayalam. Same number every time; one language and script per answer; refusals and limit messages also in that language.

**Receipts (14.2, 14.2a, 14.3, 14.3a)** — scan 3 real bills (a long supermarket bill, a faded one, a GST bill).
- Fields filled with confidence; **All receipt details** has every item in printed order and invents nothing on the faded one.
- Create expense draft → fields filled, receipt attached, the details text in Notes and still there after saving and reopening.
- A bill with a future date → "Date cannot be in the future" until corrected.

**AI entry with the real model (17.1–17.12)**
- Run the sentences from §17.1–17.4 and the §17.4a table with AI ON. Type, amount and category as listed; `sold rice to mahesh for 800` → customer Mahesh.
- Nothing is saved until **Confirm & save**; every field can be edited first and the edit is what's saved. Clear the name / amount → "Enter the customer name" / "Enter an amount".
- `ramesh paid 2000` → a **Payment method** row (credits have none); the method is saved on the entry.
- A brand-new name → customer created, success alert offers **View customer**. A name matching exactly one customer → saves to them with no picker. Two Rameshes → `Ramesh ko 500 diye` → "Which 'Ramesh'?" picker with ➕ Create new.

**Other AI screens (11.5, 15.1–15.4)**
- Khata → ✨ AI Insights shows the cards. Turn AI consent off → heuristic insights still show, no error.
- Categorize "Swiggy order — lunch for staff ₹640" → Food; Try an example → Fuel; pick another chip → "Saved for future learning" and it appears in the log; Use in new expense → category filled.

---

## 8. Real files and outside checks

- **Bank statements (37B.2, 37K.5, 37K.10, release sign-off):** import real CSV, .xlsx and .xls statements from the banks your users have. Columns are recognised or easy to pick on the mapping screen, the sample dates match the statement (switch the date format if not), lines are read (not "rows not read"), and after confirming every match Daily close reaches **₹0.00**.
- **GST files in Excel (37C.6):** open each of the four downloads in Excel. Telugu/Hindi names show correctly; a customer name starting with `=` shows as text.
- **CA test (37C.7, required before release):** one real month of GST sales → Tally export → the CA imports it into Tally → enter records imported and fields re-typed in **CA test**. Passed only with all records in and 0 re-typed. The CA also confirms the GST rate list and the B2CL limit.
- **No filing claims (37C.8):** no screen, file or help answer says Bolcash files GSTR-1/3B or creates e-invoices. Ask Ask AI "Does Bolcash do GST filing?" → not in the guide.
- **A real old khata (37G):** import an export from the app your first users are moving from, plus one hand-typed Excel. Columns are recognised (or easy to map) and the balances match the old app.
- **Legal content (30.2, 31.1–31.4):** Terms and Privacy open from Login and Settings; sections render. The grievance name and email in Settings, the Privacy Policy and the Terms are **identical** (no automated check). Counsel has replaced the placeholders.
- **Native speaker review (19.12, 36.4, 36.7):** run `backend/.venv/Scripts/python.exe scripts/i18n_review_sheets.py build` → one Excel per language (sheets in order: reconciliation & payments, GST, stock, beats). Reviewers fill the Correction column in parallel; `… apply review/te.xlsx` copies the corrections in. A Telugu reader also checks the entry, statement, reminder, daily close, sync, import and team screens on the phone, and the reminder text customers receive. Also Tamil and Malayalam for Ask AI. Every language shows only its own script.
- **Free-export wording (36.10):** still a DRAFT until the founder approves the text.

---

## 9. Production / release settings (`main` build, production backend)

- **0.9:** the TestFlight build shows no "Missing Compliance"; Android build on the internal track.
- **iOS file picker:** on the TestFlight build, Reconciliation → Import bank statement and Settings → Import old khata each open the iOS file picker and read a CSV. (CI fails the build if the picker pod isn't linked, but only a real build proves it opens.) Record the 7-step result in RELEASE_NOTES.md.
- **38.1:** `/health` → `{"status":"ok"}`; `/` gives a friendly JSON.
- **1.8 — not covered by any automated test:** request an OTP for the same number many times quickly → after the cap, "Too many requests"/"please wait"; the app shows it and doesn't crash.
- **39.1 / 39.2:** hammer an endpoint and `/auth/*` from one IP → 429 with `Retry-After`; auth trips sooner. Normal use never limited. The master OTP `123456` is refused.
- **39.4:** an `http://` API URL fails in the release build; all traffic is HTTPS.
- **39.5:** certificate pinning is shipped **disabled** (no placeholder pins enabled).
- **40.1 / 40.2:** a test error reaches Sentry from the backend, iOS and Android, symbolicated, with no personal data.
- **38.2:** after 15+ minutes idle, the first call is slow (30–60 s) and then recovers.
- **38.4 — likely to fail, check it:** log in, then make the token invalid (e.g. change the server's secret on staging) and use the app. MANUAL_TESTING says the app goes back to Login on a 401, but no code in the app does that today; expect an error message instead. Log it if so.
- **Staging after this release:** the server log shows no "could not add uq_… (duplicate client_ids?)" line after boot (if it does, run `scripts/reconcile.py`).

---

## 10. Low-end device (37H.5)

**Device: [LOW-END TEST DEVICE AND ANDROID VERSION — not yet named]**
- Cold-start the app and note the time to home (no target yet).
- Airplane mode → time the first entry from Save to the success screen → **under 2 seconds**.
- Import a customer with 1,000 entries (§37G), open them and fling through the whole timeline → no freeze, no "app isn't responding", no rows that stay blank.

---

## Left out — covered by automated tests

These cases from MANUAL_TESTING.md are not repeated above because the tests
below check them on every push. The UI smoke in group 2 still clicks through
their screens once.

| MANUAL_TESTING.md § | What is checked automatically | Tests |
|---|---|---|
| 1.9, 1.12, 1.13, 2.2, 2.3, 3.1 | Onboarding order, returning login finds the business, no duplicate business, data isolated per account, consent saved and skipped once done | `test_auth_onboarding.py`, `test_consent.py`, `test_isolation.py`, `sessionReset.test.ts`, `RootNavigator.test.tsx` |
| 1.11 | Logout clears the session | `auth.store.test.ts` |
| 4.4a, 5.2–5.4, 6.5 | Future dates refused (in IST), amount and notes limits on app and server | `test_input_rules.py`, `test_validation.py`, `validation.test.ts`, `date.test.ts` |
| 4.6 | Server error vs offline told apart | `client.test.ts`, `dashboard.repository.test.ts` |
| 5.6, 6.4, 10.8, 25.1–25.5, 37A.6, 37H.1 (logic) | Offline queue, sync once, retries, failed vs pending, survives restart | `offlineSync.test.ts`, `income.repository.test.ts`, `ledger.repository.test.ts`, `visitQueue.test.ts`, `test_income_expense.py`, `test_customers_ledger.py`, `test_ledger_import.py` (unique client id) |
| 7.x, 8.3, 8.4 | Transaction filters/sort, P&L and category totals | `test_transactions.py`, `test_reports.py`, `reportTransactions.test.ts`, `report.repository.test.ts`, `exportReport.test.ts` |
| 9.2, 9.4, 10.5, 10.6 | Customer create/edit rules, balance sign, overdue after 30 days | `test_customers.py`, `test_customers_ledger.py`, `test_aggregates.py`, `risk.test.ts` |
| 16.2a, 16.4 | Old phone limits upload once; ageing buckets, oldest dues paid first | `creditLimit.store.test.ts`, `test_customer_insights.py` |
| 17.1–17.4a (offline parser) | The no-AI parser reads the listed sentences | `test_ai_parse.py`, `test_expense_parse.py` |
| 18.x | Business summary figures | `test_summary_insights.py` |
| 19.2–19.3, 19.6–19.9, 19.13 (rules) | Tool answers from the server, refusals without the AI, help guides, hourly and voice limits, consent and role gates (the real-model check is the pack in group 7) | `test_chatbot_*.py`, `test_voice_live.py`, `test_ai_consent_gate.py`, `AssistantScreen.test.tsx` |
| 20.1, 20.4 | UPI ID format, QR link text | `upi.test.ts` |
| 21.4a | Item price and GST slab rules | `test_items.py`, `test_gst.py` |
| 22.5–22.7 | Month-end, catch-up, one expense per due date | `test_recurring.py` |
| 23 | Cash counter totals | `denominations.test.ts` |
| 25.6, 37H.3 (logic) | Two-device customer edit becomes a conflict, never an overwrite | `conflict.test.tsx` |
| 26.x, 27.x (logic) | PIN hashing, lock state | `pinHash.test.ts`, `appLock.store.test.ts` |
| 28.5, 28.2 | Account deletion really erases and is logged; export contents | `test_account.py` |
| 29.2–29.4 | AI gated on consent both ways, marketing independent | `test_consent.py`, `test_ai_consent_gate.py`, `test_insights_privacy.py` |
| 33.1 | Feedback saved, 2,000-character limit | `test_feedback.py` |
| 34.2 | Errors recorded in the log | `errorLog.store.test.ts`, `collectDiagnostics.test.ts` |
| 36.2, 36.4 (keys), 36.7–36.9 | Every key translated, Telugu screens and errors with no English, IST dates | `i18n.test.ts`, `teluguFirst.test.tsx`, `screens.i18n.test.ts`, `date.test.ts`, `npm run i18n:check` |
| 37.x, 37I.x | Role rules on every route, staff/accountant blocks, last-owner guard, revoke, scoping, audit log in IST | `test_rbac.py`, `test_accountant.py`, `test_owner_guard.py`, `test_cross_tenant_idor.py`, `accountantAccess.test.tsx` |
| 37A.x, 37J | Beat access per staff, day-list figures, visit rules, edit, soft delete, restore, visit history, names on visits | `test_beats.py`, `test_beats_edit.py`, `test_beat_restore.py`, `test_beat_helpers.py`, `test_beat_future_helpers.py`, `test_rbac.py` |
| 37B.1–37B.8, 37K | UTR rule and uniqueness, statement parsing, column mapping and date formats, re-import, paisa-exact and split matching, undo, statement delete, counted cash, old-app UTR backfill, permissions | `test_reconciliation.py`, `test_recon_rework.py`, `test_recon_split.py`, `test_recon_many_to_many.py`, `test_statement_xls.py`, `test_cash_deposits.py`, `test_cash_deposits_per_person.py`, `test_reference_warning.py`, `test_reference_backfill.py`, `test_statement_restore.py`, `test_utr_unique.py`, `test_cash_count.py`, `test_cash_count_per_person.py`, `money.test.ts` |
| 37C.1–37C.6, 37L | CGST/SGST vs IGST, rates by date, seller GSTIN, every state/UT, consecutive invoice numbers per FY, quantity/UQC in GSTR-1, the phone's tax split = the server's (2,976 cases), rate-change log, CSV formula guard | `test_gst.py`, `gst.test.ts`, `gstSplit.test.ts` |
| 37D.x, 37M.1 | Stock places, van loads, purchases with supplier/price/bill, low stock, counts, retries, no overselling under 20 concurrent sales, CHECK backstop | `test_stock.py`, `test_stock_race.py`, `qty.test.ts` |
| 37E.x | Scheme maths, priority, expiry, slabs, free goods, van bills, report totals | `test_schemes.py`, `schemeText.test.ts` |
| 37F.2–37F.5 (logic) | Link scoping and expiry, consent and opt-out, printable ledger totals | `test_statements.py`, `exportStatement.test.ts` |
| 37G.x | Preview = dry run, mapping, duplicates, re-import adds 0, log, backup, permissions | `test_ledger_import.py`, `KhataImportScreen.test.tsx` |
| 37H.5 (logic) | 1,000-entry ledger: fast balances/risk, list mounts a screenful | `ledgerPerf.test.tsx` |
| 39.1–39.3 (logic) | Rate-limit maths per IP/user/auth path, OTP single use and attempt limit, session not persisted | `test_monitoring.py`, `test_production_guards.py`, `secureAuthStorage.test.ts` |

**Not tested anywhere and not easy to test by hand:** 35.1 (the "Something
went wrong" card appears only when a screen crashes; there is no way to cause
one on purpose in a release build).
