# Not built yet

Things that were asked for, or came up, but are not in the code. Delete a line when it ships.

## 0. Open questions — decisions needed (November 2026)

Each one is built the way described below until someone decides otherwise.

1. **12% for bricks and tiles: fix now or after the CA confirms?** Notification 14/2025 keeps 12% from 22 Sep 2025 for building bricks, fly ash bricks/blocks/aggregates and earthen/roofing tiles (HSN 6815, 6904, 6905); the code refuses it (§3). The fix is small (allow 12% after that date only for those HSN prefixes). G1 says build nothing in GST before the CA test. Decide: fix before the pilot, or pick a pilot that doesn't sell these.
2. **The 6% brick scheme.** Some sources mention a 6% option for bricks with no input tax credit (Notification 02/2022-CT(Rate)). The app has no 6% rate. Ask the CA whether any pilot distributor uses it.
3. **Daily close difference counts cash until it's banked (R3).** Since R3, "Difference to explain" includes cash until it's deposited and matched, or recorded as kept back, so a day with cash collections is never 0.00 until then. The alternative is to leave cash out of the difference, as before R3, and show deposits separately. Keep it as is?
4. **Staff see their own count only (B6).** With per-person counts, staff see their own counted cash and over/short but not the beat's total counted or over/short, because that would reveal a colleague's short. The spec only said "own row". Should staff see the beat total?
5. **Staff see their own deposits only (R10).** Same rule for deposits: staff see whole-beat deposits and their own, not a colleague's. OK?
6. **"Helpers" or "Also on this beat" (B4).** The B4 spec calls the section "Helpers"; the app still says "Also on this beat" so the reviewed wording wasn't changed. Rename (and retranslate)?
7. **Helper dates show "16 Nov 2026", not "Mon 16 Nov" (B5).** The app has no weekday date format. Add one?
8. **Daily close after restoring a statement (R5).** Restored lines come back unmatched, so the difference stays at its after-delete value until the owner re-confirms the matches; the R5 spec said "back to its pre-delete value". Keep as is (no silent re-match)?

## Waiting on people, not code

- **CA + Tally test (G1):** docs/CA_TALLY_TEST.md. Blocks the GST help articles (G2) and the rate confirmation (G3).
- **Native translation review (R6, B3):** `review/<lang>.xlsx`, Telugu first; done when `scripts/i18n_review_sheets.py unreviewed <lang>` lists nothing, then the on-phone read-through.
- **iOS file picker on TestFlight (R7):** the 7-step check in RELEASE_NOTES.md.
- **One-off backfill after deploy (R9):** run `scripts/backfill_reference_fingerprints.py` once against production and record the counts in RELEASE_NOTES.md.
- **Approved free-export wording:** see §7.

## 1. Beat plan: gaps left (updated November 2026)

The beat plan, the staff day-list, shared beats (a primary plus helpers, which the owner adds and removes in Beat plan → Edit, including cover planned ahead), editing a beat (name, days, salesperson), deleting one (soft delete — its visits and daily closes stay), restoring a deleted beat (owner: Beat plan → Deleted beats), and the visit history (by shop, salesperson or beat) are built. Beats and visits are in "Download my data". See MANUAL_TESTING.md §37A and §37J. These parts are not built yet:

- **Shared beats** (`beat_assignments`, one open primary per beat enforced by the database; helpers added and removed in Beat plan → Edit, with a start date and optional last day for cover planned ahead, see §37J.4, §37J.7 and §37J.8). What's left: only helpers can be planned ahead; a change of salesperson still takes effect the day it's made. Daily close shows each salesperson's subtotal, and cash can be counted per salesperson (§37K.14).
- **Translations.** The `beats.*` and `visits.*` strings are machine-translated; reviewers use `scripts/i18n_review_sheets.py` (sheet 4).

## 2. Manual UPI/bank reconciliation: gaps left (updated November 2026)

Built: UTR required for UPI (server and app) and unique per business; a warning, never a block, when a bank-transfer reference or a cheque (number + bank + account) repeats an earlier payment; statement import (CSV, .xlsx, and old .xls — real Excel 97-2003 or an HTML table saved as .xls, told apart by the file's first bytes; the server needs `xlrd` from requirements.txt) with a column-mapping screen and a date-format choice, suggestions, matching by hand, one bank line covering several collections, one collection paid in several transfers, several transfers paying several collections (the server refuses any match that isn't covered exactly), undo (a split is undone as a whole), deleting a statement (its matches are undone first) and restoring it (its lines come back unmatched; refused if the same file or its lines were imported again since), counted cash with over/short, cash deposits (the owner records cash taken to the bank or kept back in the shop, per salesperson or for the whole beat; a deposit is matched to its bank line, and the daily close difference counts cash until it's deposited or kept back), and old-app UTR-less payments kept and fixable. See MANUAL_TESTING.md §37B and §37K. **Out of scope by design:** payment collection, wallets, bank login, or any endpoint that moves money.

These parts are not built yet:

- **PDF statements — out of scope by design.** Per-bank PDF layouts plus OCR are a project of their own and unreliable on scans. A PDF is refused with "save it as .xlsx or .csv"; the user downloads the statement from the bank in one of those.
- **Old cheques match on number only.** `scripts/backfill_reference_fingerprints.py` (run once after deploy) brings payments saved before the warning into it, but cheques saved before bank and account were asked for have only a number, so they match only a later cheque entered without bank and account. Payments with no reference stored are skipped. Duplicate UPI UTRs saved before the UPI rule are kept as they are (the first one is indexed; the rest are logged at boot).
- **Cash with no salesperson.** Cash is counted and deposited per salesperson or for the whole beat. Cash recorded with no salesperson (e.g. the owner's own entry) can only be in the whole-beat figures, so with per-person counts the beat's over/short waits until that cash is counted that way. An old SQLite dev database can't match deposits until it's recreated (Postgres is migrated); recreate it.
- **Translations (R6).** The `recon.*`, `close.*`, `bankImport.*`, `bankMatch.*`, `payments.*` and `deposit.*` strings are machine-translated; review sheets are built (`review/<lang>.xlsx`), Telugu first, then an on-phone read-through. Waiting on a native reviewer, who writes a correction or OK on every sheet-1 line; `scripts/i18n_review_sheets.py unreviewed te` lists what's left.
- **iOS file picker not yet checked on a phone (R7).** CI fails the iOS build if the file-picker pod isn't linked, but that doesn't prove the picker opens. The 7-step check (Import bank statement and Import old khata on a TestFlight build) is in RELEASE_NOTES.md; record device, iOS version and build number there. A failure to open is a P0.

## 3. GST invoices and CA/Tally export: gaps left (updated November 2026)

Built: GST fields on a sale on credit; rates by invoice date (0, 5, 18, 40% plus 3% gold/silver and 0.25% rough diamonds from 22 Sep 2025; 12% only before 22 Sep 2025 — wrong for bricks and tiles, see the bug below — and 28% only before 1 Feb 2026); the seller's own GSTIN (checked against the business state); every state and UT; server-assigned invoice numbers, consecutive and unique per business per financial year (Rule 46), never reused after a delete; quantity and UQC on every new GST invoice, in the GSTR-1 HSN sheets; an item picker that fills HSN, rate and unit; the same tax split on the phone for an offline sale; the rate-change log (IST days); and four CA files. See MANUAL_TESTING.md §37C and §37L. **Out of scope by design:** filing returns and e-invoicing (IRN/QR).

These parts are not built yet:

- **BLOCKED — the CA + Tally test.** Needs a real CA and Tally, one pilot month, 0 fields re-typed, 0 GST Offline Tool errors, a signed discrepancy note. Runbook: docs/CA_TALLY_TEST.md. Its prerequisites (invoice numbers, quantity/UQC) are in; nothing else in GST is built until it runs.
- **BUG — 12% refused for bricks and tiles.** `backend/app/gst.py` treats 12% as retired from 22 Sep 2025, but Notification 14/2025 keeps 12% for building bricks, fly ash bricks/blocks/aggregates and earthen/roofing tiles (HSN 6815, 6904, 6905). Those invoices can't be entered today. The "12% only before 22 Sep 2025" line below describes the code, not the law.
- **BLOCKED — GST help articles (G2).** Written only after the CA test, from the CA's discrepancy note (steps in docs/CA_TALLY_TEST.md, "After the test"). The assistant has no GST help article yet, and says "not in the help guide" for GST questions; that's deliberate until then.
- **Rate list confirmed by the CA (G3).** The dated rates are in `backend/app/gst.py` (one place). Have the CA confirm them, including any special rate the distributors' goods use (12% bricks and tiles, the 6% brick scheme; see §0).
- **GSTR-1 file never checked against the GST Offline Tool.** Nothing has loaded the GSTR-1-ready Excel into the Offline Tool's import template yet; the CA test's Offline Tool step is the first check and may find errors.
- **One line per invoice.** An invoice has one item, HSN and rate. A bill with several items must be entered as separate invoices.
- **The amount isn't filled from the item.** The item picker fills HSN, rate and unit; the price is still typed.
- **Old invoices.** GST invoices saved before this release have no quantity/UQC (their HSN rows have a blank unit for the CA to fill) and keep the invoice numbers typed in the app.
- **Cash sales.** Only sales on credit (Add credit) can be GST invoices; income entries can't.
- **Credit notes, sales returns, cancelled invoices, cess, reverse charge, exports/SEZ.** None of these exist. A deleted invoice's number is kept as cancelled in the database but isn't reported yet (GSTR-1 table 13).
- **Purchases and input tax credit.** Purchases record supplier, price and bill but no GST, so the GSTR-3B summary has no table 4.
- **Editing a GST invoice.** Entries can't be edited; delete and re-enter (the deleted number isn't reused).
- **CA test results stay on the phone.** They are shared with the Share button, not saved on the server.
- **Translations.** The `gst.*` strings are machine-translated; sheet 2 of the review files.

## 4. Stock basics: gaps left (updated November 2026)

Built: item catalog as the SKU master, godown and per-salesperson van stock, purchases (with supplier, price per unit and the supplier's bill number; the item keeps the latest price), sales from the godown or a van, godown → van loads, the low-stock list, the monthly count with logged corrections, stock history, and stock in "Download my data". Stock can't be oversold: taking stock out is one conditional database update, backed by a CHECK (qty ≥ 0) and a 20-sales-at-once test. Vans and people show the name the owner gives them. See MANUAL_TESTING.md §37D and §37M. **Out of scope by design (Phase 1):** warehouse/bin management, batches and expiry, manufacturing.

These parts are not built yet:

- **Add credit and income don't reduce stock.** Item bills do; a plain Add credit amount or an income entry has no items, so it can't.
- **Van → godown returns and van → van moves.** Unsold stock can't be moved back; correct it with a van count.
- **Purchases don't create an expense** or keep a supplier list; the supplier is typed each time.
- **Editing or undoing a stock entry.** Not possible; correct it with a count.
- **Offline.** Stock entries need a connection; there's no offline queue.
- **Units.** One unit per item; no conversion (e.g. box ↔ pieces).
- **Low-stock notifications.** The list is on the Stock screen only; no push alert.
- **Count reminders and month locking.** Nothing prompts the month-end count or locks a counted month.
- **Stock value.** No valuation (FIFO/average) or stock value report.
- **Existing oversold stock.** If the old ledger already summed below zero somewhere, that place starts at 0 (logged at boot); the next count corrects it.
- **Translations.** The `stock.*` strings are machine-translated; sheet 3 of the review files.

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
- **Conflicts cover customer details and credit limits.** Customer edits get the side-by-side screen; a stale credit-limit save is refused and the server's limit is shown with a notice (old phone-only limits never overwrite a newer one). Entries, payments and visits are never edited in place, so they can't conflict. Items, schemes, beats and team settings still save last-write-wins.
- **Who resolves a conflict.** The owner (the only role that can edit a customer) chooses on the phone where the conflict appeared; others see the conflict but can't choose. The conflict lives on that phone, not on the server.
- **Failed entries can only be retried**, not edited or discarded, from the Sync status screen.
- **Import limits.** One sheet (the first), 10,000 rows and 5 MB per file; old .xls is read too (same reader as bank statements); PDF is refused. Mobile numbers, GSTIN and notes are not imported (new retailers are created by name). A retailer name shared by two existing customers is skipped, not guessed. Rows with no bill number still count as duplicates when the retailer, amount and date match — the preview lists them, so check it.
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
