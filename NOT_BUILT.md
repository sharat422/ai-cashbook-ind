# Not built yet

Things that were asked for, or came up, but are not in the code. Delete a line when it ships.

## 1. Beat plan: gaps left after the first version (November 2026)

The beat plan and the staff day-list are built. See MANUAL_TESTING.md §37A. These parts are not built yet:

- **Editing a beat.** There is no `PUT` or `DELETE /beats/{id}`, so the name, weekdays and salesperson can't be changed and a beat can't be deleted. For now, create a new beat. The shop list and its order can be changed.
- **Data export.** Beats and visits are not in "Download my data".
- **Visit history screen.** Visits are saved, but the app only shows today's visit and the last promise date. There's no list of past visits for a shop or a salesperson.
- **One salesperson per beat.** A beat can't be shared by two staff members.
- **Old phone-only credit limits.** If the owner had different limits saved on two phones, the last phone to upload wins.
- **Translations.** The `beats.*` strings were machine-translated and need a native speaker to review them, as the te/ta/ml chatbot strings already do.

## 2. Manual UPI/bank reconciliation: gaps after the first version (November 2026)

Built: UTR required for UPI (server and app), statement import (CSV/.xlsx), suggestions, confirm, exceptions, and daily close. See MANUAL_TESTING.md §37B. **Out of scope by design:** payment collection, wallets, bank login, or any endpoint that moves money.

These parts are not built yet:

- **Undoing a confirmed match.** A wrong confirmation can't be undone in the app. For now, fix it in the database.
- **Matching by hand.** Only suggested pairs can be confirmed. An unmatched bank line can't be paired with a collection the app didn't suggest (for example, more than 3 days apart). The API accepts any same-amount pair; only the screen is missing.
- **Split or combined payments.** One bank line equals one collection. A customer paying ₹1,000 by UPI for two entries of ₹600 + ₹400 won't match.
- **Old `.xls` files and PDF statements.** These are refused; the user must save the statement as .xlsx or CSV. HTML-disguised ".xls" exports from some banks aren't handled either.
- **Column mapping screen.** Columns are found by their header names. A bank with unusual headers gets "Couldn't find the header row" and no way to pick the columns.
- **Dates are read day-first** (Indian format). A US-style `MM/DD/YYYY` export would be misread or rejected.
- **Counted cash.** "Cash in hand" is the cash the app recorded, not cash physically counted at day end. There's no field to enter the counted amount and see a cash shortfall.
- **Cash deposits.** Cash paid into the bank isn't matched to cash collections.
- **Deleting an import.** An imported statement can't be removed in the app.
- **UTR uniqueness.** The same UTR can be entered on two collections.
- **Phones on the old app version.** UPI payments without a UTR, saved offline by an older app before this update, will fail to sync and stay flagged on that phone.
- **Export.** Bank lines and matches are not in "Download my data".
- **Translations.** The `recon.*`, `close.*` and `payments.*` strings are machine-translated and need native review.
- **iOS build.** The new file picker (`@react-native-documents/picker`) is a native module. It needs `pod install` (CI does this) and a fresh build before import works on a phone.

## 3. GST invoices and CA/Tally export: gaps after the first version (November 2026)

Built: GST fields on a sale on credit (GSTIN, HSN, rate, price with/without GST, place of supply), the server's tax split with a live preview, the rate-change log, and four CA files (GSTR-1-ready, GSTR-3B summary, Tally Excel/CSV). See MANUAL_TESTING.md §37C. **Out of scope by design:** filing returns and e-invoicing (IRN/QR).

These parts are not built yet:

- **The CA test itself.** It needs a real CA and Tally. Until a pilot month imports with 0 fields re-typed, treat the Tally layout as unproven.
- **Rate list and B2CL limit not confirmed.** The rates (0, 0.25, 3, 5, 12, 18, 28, 40%) and the ₹1 lakh B2CL limit are from the rules as of late 2025. The CA must confirm them; they live in `backend/app/gst.py` and `backend/app/gst_reports.py`.
- **One line per invoice.** An invoice has one HSN and one rate. A bill with items at different rates must be entered as separate invoices.
- **No item picker on the sale.** HSN and rate are typed or chosen on the sale; they aren't filled from the item catalog.
- **HSN quantity and unit (UQC).** Not recorded, so the HSN sheets leave them blank and the CA fills them in.
- **Cash sales.** Only sales on credit (Add credit) can be GST invoices; income entries can't.
- **Credit notes, sales returns, cancelled invoices, cess, reverse charge, exports/SEZ.** None of these exist.
- **Purchases and input tax credit.** Expenses carry no GST, so the GSTR-3B summary has no table 4.
- **Duplicate invoice numbers.** The same invoice number can be used twice in a year.
- **Editing a GST invoice.** Entries can't be edited; delete and re-enter.
- **Offline balance.** A GST sale "before GST" saved offline shows the pre-tax amount until it syncs.
- **Business details.** The seller's own GSTIN isn't stored, and states missing from the app's state list (e.g. Jammu and Kashmir, Chandigarh, Puducherry) can't be picked.
- **CA test results stay on the phone.** They are shared with the Share button, not saved on the server.
- **Help article.** The assistant has no help article for GST reports.
- **Export.** GST fields are not in "Download my data".
- **Translations.** The `gst.*` strings are machine-translated and need native review.

## 4. Stock basics: gaps after the first version (November 2026)

Built: item catalog as the SKU master (unit, purchase/sale price, low-stock alert level), godown and per-salesperson van stock, purchases, sales from the godown or a van, godown → van loads, the low-stock list, the monthly count with logged corrections, and stock history. See MANUAL_TESTING.md §37D. **Out of scope by design (Phase 1):** warehouse/bin management, batches and expiry, manufacturing.

These parts are not built yet:

- **Add credit and income don't reduce stock.** Item bills (§5) do; a plain Add credit amount or an income entry has no items, so it can't.
- **Van → godown returns and van → van moves.** Unsold stock can't be moved back; correct it with a van count.
- **Purchases don't record a supplier, price or bill,** and don't create an expense.
- **Editing or undoing a stock entry.** Not possible; correct it with a count.
- **Offline.** Stock entries need a connection; there's no offline queue.
- **Two sales at the same moment** could both pass the "enough stock?" check (see the `ponytail:` note in `backend/app/stock.py`).
- **Units.** One unit per item; no conversion (e.g. box ↔ pieces).
- **Low-stock notifications.** The list is on the Stock screen only; no push alert.
- **Count reminders and month locking.** Nothing prompts the month-end count or locks a counted month.
- **Stock value.** No valuation (FIFO/average) or stock value report.
- **Vans are labelled by the salesperson's mobile number** (users have no names).
- **Export.** Stock and its history are not in "Download my data".
- **Translations.** The `stock.*` strings are machine-translated and need native review.

## 5. Item bills and FMCG schemes: gaps after the first version (November 2026)

Built: item bills to a retailer (godown or van) that post the total to the retailer's credit and take paid and free goods out of stock; a scheme master (10+1, quantity slab, % off, free goods) with SKUs, dates and priority; automatic application at billing with the scheme as its own line; the "not applied" reason when a lower-priority scheme loses; the scheme log per bill and per retailer; and the scheme report by scheme, SKU and month. See MANUAL_TESTING.md §37E. **Out of scope by design (Phase 1):** scheme claim filing and distributor claim automation.

These parts are not built yet:

- **GST on item bills.** Bills have no GST; how scheme discounts and free goods are taxed needs the CA. GST invoices stay on Add credit and in the GST exports; item bills are not in GSTR-1 or the Tally export.
- **Mixed-SKU schemes.** A scheme on several SKUs is checked line by line; buying 6 of SKU A and 4 of SKU B doesn't count as 10.
- **Bill-level schemes.** No "₹ off above a bill value" or retailer-specific schemes.
- **Stacking.** Exactly one scheme per line; two schemes can't combine.
- **Editing, cancelling or returning a bill.** Not possible; the credit and stock can only be corrected by hand (a payment entry, a stock count).
- **Printing or sharing a bill.** There is no bill PDF or WhatsApp share yet.
- **Offline billing.** Bills need a connection; there's no offline queue.
- **Rates.** A line uses the item's sale price; changing the rate on the bill isn't in the screen yet (the API accepts it).
- **Large catalogs.** The bill and scheme screens load the first 100 items.
- **Bill numbers.** Simple running numbers (B-1, B-2…); no financial-year series or prefix setting.
- **Two bills at the same moment** could both pass the stock check (same `ponytail:` note as stock).
- **Export.** Bills and the scheme log are not in "Download my data".
- **Translations.** The `bill.*` and `schemes.*` strings are machine-translated and need native review.

## 6. Retailer statements and printable ledger: gaps after the first version (November 2026)

Built: a browser link (`/s/<token>`) and PDF of one retailer's statement — opening balance, entries, payments, current balance and ageing — that needs no app or login; per-retailer, per-distributor WhatsApp consent with opt-in, opt-out (by the owner or by the retailer from the link) and a log of every opt-in, opt-out, send, refusal, link and first view; and a printable ledger PDF with page totals. See MANUAL_TESTING.md §37F.

These parts are not built yet:

- **Server-sent WhatsApp needs an approved template.** `via=server` sends free-form text, which WhatsApp only delivers inside a 24-hour customer-service window. Messages a distributor starts need a Meta-approved template; until then the app opens WhatsApp on the owner's phone with the message (consent is still checked and logged).
- **"STOP" replies on WhatsApp.** There's no webhook reading the retailer's replies; they opt out from the link (or tell the owner).
- **The plain 📄 PDF share sheet** can still be sent to WhatsApp by the owner by hand; only the WhatsApp button is consent-checked.
- **Revoking a link.** Links expire after 30 days but can't be cancelled sooner.
- **Statement language.** The statement and PDF are in English (names show in any script).
- **Bill details on the statement.** Sales show the bill/invoice number, not the items or schemes.
- **Bulk sending.** No "send to all opted-in retailers" or monthly schedule.
- **Rate limiting** on the public link endpoints (the token is 192-bit random, so guessing isn't practical).
- **Translations.** The `statement.*` strings are machine-translated and need native review.
- **Deploy.** The server needs the new `fpdf2` and `uharfbuzz` packages (in requirements.txt) and `PUBLIC_BASE_URL` set to its https address, or links point at the wrong host.

## 7. Telugu-first and the free-export screen: what is not done (November 2026)

Built: Telugu is the default language for new installs, with a తెలుగు / Hinglish / English toggle on the login screen and in Settings (other languages still available). Entry, statement, reminder/collection and daily-close screens, their shared parts (payment sheet, category and method chips, error screens, photo picker) and all form-validation and server/network errors read in the chosen language. Dates are IST everywhere with month names in the chosen language; amounts use Indian grouping. A "Your data" screen in Settings explains the free export in Telugu and English and downloads Excel (all data), a balances PDF and a full backup — none of it checks a plan. See MANUAL_TESTING.md §36.6–36.10.

These parts are not done:

- **BLOCKED — approved free-export wording.** The founder's approved text was not provided, so "Your data" shows plain-language draft text under a DRAFT banner and is not linked or presented as a Terms page. To finish: replace the `yourData.draft.*` strings in en.json with the approved text, run the translation tool, have the Telugu checked, and set `FREE_EXPORT_WORDING_APPROVED = true` in YourDataScreen.tsx.
- **Translations are machine-made.** All new Telugu and the whole Hinglish file came from the translation tool and need a native speaker's review before launch, especially the reminder messages that customers receive and the free-export wording.
- **Server error detail.** In Telugu/Hinglish a server error shows a translated sentence for its kind (not found, duplicate, check the details…), not the server's specific reason. English keeps the specific reason.
- **Screens outside the four areas** (GST, stock, schemes setup, beats, team, reports, AI scan/voice, etc.) were not audited and may still show some English. The check in `src/i18n/screens.i18n.test.ts` covers only the listed screens; add others to it as they are translated.
- **Server-made files are English.** The retailer statement link/PDF, printable ledger, balances PDF and Excel headings from the server are English (names show in any script). The statement made on the phone (📄 PDF, 📊 Excel) is in the user's language.
- **Hinglish for the AI assistant and collection-assistant messages.** Those have no Hinglish option yet; they fall back to English.
- **No Telugu digits.** Numbers stay 0–9 (what Telugu shopkeepers use in practice).

## 8. Khata import and low-end/offline: what is not done (November 2026)

Built: import from Excel/CSV with column mapping (date, retailer, bill no., amount, udhar/jama, opening balance), headings recognised in English, Telugu and Hindi; a preview that is a dry run; duplicate detection (same retailer + bill no. + amount + date, against the books and within the file) so a re-import adds nothing; an import log (date, file, imported, skipped, who) and an encrypted backup of the khata taken before each import, downloadable from the log. Offline: income, expense, udhar/payment and visit queues sync exactly once — the database now refuses a second row for the same client id, and overlapping syncs share one run. One sync status (synced / waiting / failed / conflict) on home and a Sync status screen; customer edits made offline are queued; a customer changed on two devices goes to a side-by-side conflict screen and waits for a choice. Logging out warns before deleting unsynced entries. See MANUAL_TESTING.md §37G–37H.

These parts are not done:

- **BLOCKED — low-end performance target device.** "[LOW-END TEST DEVICE AND ANDROID VERSION]" was not named, so the on-device timings (open, first offline entry under 2 s, 1,000-entry scroll) have not been measured. What was done: offline saves no longer wait for a network timeout; the ledger list mounts about a screenful of rows; and the payment-risk calculation on the customer screen went from O(credits × payments) to linear (1,000 entries: ~350 ms → a few ms on a laptop) — that loop would have frozen a low-end phone for seconds. Run §37H.5 on the device once it is chosen.
- **Weak signal, not offline.** With bars but no data getting through, the first save waits up to the 15-second request timeout before it is queued. A truly offline phone (airplane mode, or Wi-Fi with no internet) queues at once.
- **Conflicts cover customer details only.** Entries, payments and visits are never edited in place, so they can't conflict (two phones adding entries both keep theirs). Items, schemes, beats and team settings still save last-write-wins.
- **Who resolves a conflict.** Owner and accountant (the roles that can edit a customer) choose on the phone where the conflict appeared; staff see the conflict but can't choose. The conflict lives on that phone, not on the server.
- **Failed entries can only be retried**, not edited or discarded, from the Sync status screen.
- **Import limits.** One sheet (the first), 10,000 rows and 5 MB per file; old .xls must be saved as .xlsx or CSV. Mobile numbers, GSTIN and notes are not imported (new retailers are created by name). A retailer name shared by two existing customers is skipped, not guessed. Rows with no bill number still count as duplicates when the retailer, amount and date match — the preview lists them, so check it.
- **No undo.** An import is undone by restoring from the backup Excel by hand; there is no one-tap undo.
- **Existing duplicate client ids.** If the production database already has two rows with one client id (see `scripts/reconcile.py`), the new unique index for that table is skipped at boot (logged) and the old look-up-first check still applies there until the duplicates are cleaned.

## 9. Accountant read-only access: what is not done (November 2026)

Built: the owner invites an accountant by mobile number (the existing Team invite). The accountant role is now read-only on the server and in the app: ledgers, ageing, daily close, GST reports and CA/Tally/Excel export only. Every write is refused for the role in one central check (so a route that forgets its own check is still covered), every screen that writes shows "Read-only access", and the add/edit buttons are hidden. Each request names one business (`X-Business-Id`) and is checked against an active membership of that business, so a CA serving several owners sees only the businesses that assigned them, with a switcher in Settings. Remove access marks the membership revoked: the very next call is refused and the app signs out. Every accountant view, export and refused write is logged; the owner sees it under Team → Accountant activity, with IST times. See MANUAL_TESTING.md §37I.

These parts are not done:

- **Existing accountants lose add/edit.** Anyone already invited as an accountant can no longer add or edit entries after this release. Owners who relied on that need to change those people to Owner (full access) — there is no "accountant who can also add" role.
- **Invite by phone only.** The existing invite is by mobile number; there is no email invite.
- **The CA cannot pick businesses on first login.** They open the first business that invited them and switch in Settings. There is no list of all assigned businesses on the login screen.
- **Audit log retention and export.** The log is kept indefinitely and shows the last 300 entries (up to 1,000 via the API); there is no date filter, Excel export of the log, or alert to the owner when an export happens.
- **What is logged.** API calls, not screens: one screen can make several entries (e.g. a customer screen logs the customer and its ledger). Files the accountant shares onward after downloading are not tracked.
- **Revocation on an open screen.** The CA is signed out on their next request. A screen already on their phone stays visible (with data already loaded) until they touch anything that talks to the server.
- **Ask AI** stays open to accountants (every assistant tool only reads the books); each question is logged as a view, but the log does not record which figures the answer used.
