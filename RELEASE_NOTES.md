# Release notes

Newest first. Each release records the manual checks that CI cannot do
(see MANUAL_ONLY_TESTS.md group 9). "CI green" is not evidence.

iOS build number = Codemagic's build index (TestFlight shows it as
`1.0 (<build>)`).

---

## Next release: not released yet

**Build:** iOS 1.0 (`____`) · Android 1.0.`____` · backend commit `____`
**Date:** ____  **Checked by:** ____

### iOS file picker on TestFlight (R7, P0 if 1 or 6 fails)

Device: ____  iOS version: ____  TestFlight build: ____

| # | Check | Result |
|---|---|---|
| 1 | Reconciliation → Import bank statement → pick a `.csv` from Files → mapping screen fills → lines import | ☐ pass ☐ fail |
| 2 | Same screen: an `.xlsx` and an old `.xls` both import | ☐ pass ☐ fail |
| 3 | Same screen: a PDF is refused with "save it as .xlsx or .csv", no crash | ☐ pass ☐ fail |
| 4 | Same screen: a CSV in iCloud Drive not yet downloaded imports or shows a clear error (no hang, no crash) | ☐ pass ☐ fail |
| 5 | Same screen: open the picker → Cancel → back on the screen, no error alert | ☐ pass ☐ fail |
| 6 | Settings → Import old khata → pick a CSV → preview → Import → customers appear | ☐ pass ☐ fail |
| 7 | Same screen: open the picker → Cancel → no error | ☐ pass ☐ fail |

Notes / failures: ____

### Translation review (R6, B3)

| Language | Sheet 1 (reconciliation & payments) applied | Sheet 5 (bills & schemes, SC13) applied | Sheet 6 (statements & documents, ST5) applied | On-phone read-through | Reviewer |
|---|---|---|---|---|---|
| Telugu | ☐ | ☐ | ☐ | ☐ | ____ |

TE4 added 83 strings from screens that had English in them (transaction history and filters, daily summary, khata, receipt scan, voice, credit limit, status pills) and retranslated 11 Telugu lines that still had English words in them. They're on the sheets by prefix, mostly sheet 8. Read them on the screens they belong to.

TE6 put the collection-assistant messages on sheet 7 (`collect.tpl.*`): the Telugu ones are the texts retailers already get, never reviewed before. The Hinglish ones go out only after review and `apply`.

Sheets 7 (messages retailers receive: reminders, payment requests, free-export wording, error reasons) and 8 (everything else) cover the rest of the file (TE2); sheet 7 before 8.

Sheet 6 is what the SERVER puts on the retailer's statement and, since TE5, on the owner's balances PDF and Excel export (48 more strings): after `apply`, commit `backend/app/doc_strings/te.json` with it.

### CA + Tally test (G1, docs/CA_TALLY_TEST.md)

Distributor: ____  Month: ____  CA: ____  TallyPrime: ____  Offline Tool: ____
Fields re-typed: ____ of ____  Offline Tool errors: ____  Discrepancy note signed ☐  Result: ☐ pass ☐ fail ☐ needs fixes
Rate list confirmed (G3): CA ____ on ____ ☐  Rates added to gst.py: ____

### Deploy check: retailer statements (ST10, before the pilot)

Do this on the server itself, not a laptop. A laptop has the fonts and packages and hides a broken server.
1. **Packages.** `backend/requirements.txt` pins `fpdf2==2.8.3` and `uharfbuzz==0.45.0` (uharfbuzz shapes Telugu and other Indian scripts). In the Render shell of each service, run `pip freeze | grep -iE "fpdf2|uharfbuzz"` and confirm both versions.
2. **Base URL.** Links are built from `PUBLIC_BASE_URL`. If it isn't set, the server uses Render's own `RENDER_EXTERNAL_URL` (https://<service>.onrender.com), and outside Render the default is the emulator address `http://10.0.2.2:8000`, which is wrong for a phone. Set it explicitly only for a custom domain: https, no trailing slash. Check on the service's Environment tab that nothing sets it to localhost, 10.0.2.2 or http.
3. **From a phone** (not on the office Wi-Fi), as the owner: Statement → 🟢 WhatsApp link (or SMS) to a test retailer. Open the link. It must load from the address below, show the statement, and **Download PDF** must open a PDF with a Telugu name in it rendered correctly. Then Settings → a statement's 🖨️ Printable ledger → Save: it opens.

| | Staging | Production |
|---|---|---|
| Service URL | https://smart-cashbook-api.onrender.com | https://ai-cashbook-ind.onrender.com |
| PUBLIC_BASE_URL (set? value) | ____ | ____ |
| Host the link opened from | ____ | ____ |
| fpdf2 / uharfbuzz (pip freeze) | ____ / ____ | ____ / ____ |
| Link loads ☐ PDF downloads ☐ Telugu name OK ☐ | ☐ ☐ ☐ | ☐ ☐ ☐ |
| Checked by / date | ____ | ____ |

### One-off: WhatsApp statement template (ST1)

Done by the owner of the WhatsApp Business account (Meta Business Suite → WhatsApp Manager → Message templates → Create).
1. Category **Utility**, name `statement_ready`, language **English** (`en`).
2. Body, exactly: `Namaste {{1}}, your statement from {{2}} is ready. Balance: ₹{{3}}. View: {{4}}` with the samples `Ravi Stores`, `Sri Lakshmi Agencies`, `1,500.00`, `https://…/s/abc`. No offer, no extra greeting, no buttons, or Meta may re-categorise it as marketing (₹0.8631 vs ₹0.115 + GST per utility message, Oct 2026 rate card; re-check at signup).
3. Wait for **APPROVED**. Then on the server set `WHATSAPP_STATEMENT_TEMPLATE=statement_ready`, `WHATSAPP_TEMPLATE_LANGUAGE=en`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`. Subscribe the webhook `{API host}/api/v1/whatsapp/inbound` to **messages** (delivery statuses and replies such as STOP both arrive there).
4. Check: share a statement with `via=server` to a test retailer who opted in. It arrives, and the retailer's history shows "sent" and then "delivered". Until step 3, server sends stay off and the phone opens WhatsApp (correct, not a bug).

5. STOP (ST2): from the test retailer's phone, reply **STOP** to that statement. Their consent turns to "Opted out" (by the retailer), nothing comes back on WhatsApp, and the next statement send is refused. Reply "thanks" from another opted-in test retailer: nothing changes.

6. Bulk and monthly (ST7): set `CRON_SECRET` on each Render service and the same values as GitHub secrets `CRON_SECRET_STAGING` / `CRON_SECRET_PROD`. Settings → **📨 Send statements to all retailers**: the preview counts are right, and Send reaches only opted-in test retailers; a second Send the same day sends 0. Set the monthly schedule for the next hour; after the hourly job, "Last run" shows the result. Turn it off.

Submitted on: ____  Approved on: ____  Category shown by Meta: ____ ☐ still Utility  ☐ STOP checked  ☐ bulk + schedule checked

### Before the release: owners whose accountant could add entries (AC1)

On `main` an accountant can add and edit; after this release they can't. Message every owner first, so nobody learns it from a failed save. Production doesn't record who wrote an entry, so "wrote in the last 90 days" can't be listed: message every owner with an active accountant. Read-only, in Render's database shell:
```sql
SELECT b.business_name, b.owner_name, owner.mobile AS owner_mobile,
       acc.mobile AS accountant_mobile, m.created_at AS invited_on
FROM business_members m
JOIN businesses b ON b.id = m.business_id
JOIN users owner ON owner.id = b.user_id
LEFT JOIN users acc ON acc.id = m.user_id
WHERE m.role = 'accountant' AND m.status = 'active'
ORDER BY b.business_name;
```
Message, in the owner's language (have the Telugu checked by the reviewer, not machine-made):
> Your accountant <accountant mobile> can no longer add or edit after this update. Change them to Owner for full access, or keep them read-only and add entries yourself. If they have entries waiting to sync on their phone, ask them to sync before updating.

| Business | Owner | Accountant | Sent on | Channel | Owner's choice (Owner / read-only) |
|---|---|---|---|---|---|
| ____ | ____ | ____ | ____ | ____ | ____ |

Every owner in the query messaged before the release ☐ · after the release, an accountant's save shows "Accountants are read-only now — ask the owner to change your role" ☐

### One-off: duplicate client ids, before the unique indexes apply (IM8)

The first production boot of this release adds one unique index per table on the offline client id (`uq_income_client`, `uq_expense_client`, `uq_ledger_client`). If old rows already share a client id, that index is skipped and the boot log says `migration: could not add uq_… (duplicate client_ids?)`. That's a state to clean up, not a design. The index isn't on `main` yet, so production has never tried to add it.

1. **Find them (read-only).** Run before the deploy, or right after if the log shows a skip, in Render's database shell. There's no `scripts/reconcile.py`; these queries are the report:
   ```sql
   SELECT 'incomes' AS t, business_id AS scope, client_id, COUNT(*) FROM incomes
     WHERE client_id IS NOT NULL GROUP BY business_id, client_id HAVING COUNT(*) > 1
   UNION ALL
   SELECT 'expenses', business_id, client_id, COUNT(*) FROM expenses
     WHERE client_id IS NOT NULL GROUP BY business_id, client_id HAVING COUNT(*) > 1
   UNION ALL
   SELECT 'ledger_entries', customer_id, client_id, COUNT(*) FROM ledger_entries
     WHERE client_id IS NOT NULL GROUP BY customer_id, client_id HAVING COUNT(*) > 1;
   ```
   Then see each group's rows side by side: `SELECT * FROM <table> WHERE client_id = '<id>' ORDER BY created_at;`.
2. **Merge by hand, one group at a time; never in bulk.**
   - **The same entry twice** (same amount, date, type, notes, reference): keep the earliest. Before deleting the copy, check nothing points at it, e.g. `SELECT 'bank_matches', COUNT(*) FROM bank_matches WHERE entry_id = '<copy id>'`, and the same for `payment_utrs.ledger_entry_id`, `gst_invoice_numbers.ledger_entry_id`, `credit_notes.invoice_entry_id`/`ledger_entry_id` and `bank_lines.matched_entry_id`. If something does, keep that row and delete the other.
   - **Two different entries that happen to share an id:** keep both. Give the later one a new id: `UPDATE <table> SET client_id = client_id || '-2' WHERE id = '<later id>';`.
   - **After deleting a ledger row,** recompute that retailer's balance: `cd backend && .venv/Scripts/python.exe -c "from app.database import SessionLocal; from app.calc import recompute_customer; from app.models import Customer; db = SessionLocal(); recompute_customer(db, db.get(Customer, '<customer id>')); db.commit()"`.
3. **Restart the service** (the boot migration runs again). The log must have no `could not add uq_` line, and step 1 must return no rows.

| Date | Table | Client id | Rows | Action (deleted copy / renamed / kept) | By |
|---|---|---|---|---|---|
| ____ | ____ | ____ | ____ | ____ | ____ |

Boot log shows every index applied ☐ · step 1 returns no rows ☐

### One-off after deploying the reference warning (R9)

Run once against production, by hand:
`cd backend && .venv/Scripts/python.exe ../scripts/backfill_reference_fingerprints.py`

Fingerprinted: ____  Skipped (no reference): ____  Repeated references found: ____
Run again: Fingerprinted 0 ☐

### One-off: quantity/UQC on old GST invoices (G6)

Run once against production, by hand:
`cd backend && .venv/Scripts/python.exe ../scripts/backfill_invoice_qty_uqc.py`

Lines fixed: ____  Lines still blank (CA fills in the HSN sheet): ____  Run again: Lines fixed 0 ☐

### One-off: the supplier list from old purchases (S3)

Run once against production, by hand:
`cd backend && .venv/Scripts/python.exe ../scripts/backfill_suppliers.py`

Purchases linked: ____  Suppliers created: ____  Run again: 0 and 0 ☐
(Names that differ only by more than case/spaces stay separate; merge by hand.)

### Deploy: email for accountant invites (AC2)

Set on Render (staging, then production): `SMTP_HOST`, `SMTP_PORT` (587, STARTTLS), `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`. Without them an email invite is refused (503), nothing breaks, and phone invites work as before. Then run MANUAL_TESTING.md 37I.1a on a phone; the app build must include the new `bolcash://` link scheme.

Email arrives ☐ · Open in Bolcash opens the app (Android ☐ iOS ☐) · Resend kills the old link ☐

### Other group 9 checks

See MANUAL_ONLY_TESTS.md group 9; record pass/fail and anything odd here.
