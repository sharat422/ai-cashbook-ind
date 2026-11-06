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
