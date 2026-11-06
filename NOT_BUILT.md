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

- **Sales aren't linked to bills.** A stock sale is entered on the stock screen; **Add credit** and income entries don't reduce stock, and a stock sale doesn't create a bill. The salesperson records both for now.
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
