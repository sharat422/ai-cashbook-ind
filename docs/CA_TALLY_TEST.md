# CA + Tally acceptance test

**What this proves:** a CA can take one month of Bolcash GST sales into
Tally and the GST Offline Tool without re-typing anything. Nothing else in
GST gets built until this has run; the CA's findings decide what does.

**Who:** one pilot distributor, one named CA (not on the Bolcash team).
**What:** one full calendar month of real GST invoices.

---

## Before you start (Bolcash team)

1. Pick the pilot distributor and the month. All the month's GST sales must
   be in Bolcash (Add credit → "GST invoice?" on).
2. **Check the pilot doesn't sell bricks or tiles at 12%.** Bolcash
   refuses 12% on invoices dated from 22 Sep 2025, but
   Notification 14/2025 keeps 12% for building bricks, fly ash bricks and
   blocks, and earthen or roofing tiles. Until that's fixed, a pilot selling
   those would fail for a known reason. Pick another pilot, or fix it first.
3. In the app: **Reports → 🧾 GST reports for your CA**, pick the month, and
   download all four files:
   - GSTR-1-ready Excel
   - GSTR-3B summary
   - Tally export (Excel)
   - Tally export (CSV)
4. Send the four files to the CA together with this page.

## For the CA

Fill in the record below as you go.

1. **Tally.** Import the Tally export into TallyPrime: the Excel file, then
   the CSV, into a test company. Count:
   - the invoices in the file, and how many imported;
   - every field you had to type again or correct by hand, in either file.
2. **GSTR-3B summary.** Check it against what Tally shows for the month.
   Note every figure you had to change.
3. **GST Offline Tool.** Load the GSTR-1-ready Excel into the GST Offline
   Tool. Note every validation error, exactly as the tool shows it.
4. **Discrepancy note.** List every field you had to fix by hand: file,
   invoice number, column, what it said, and what it should say, **in your
   own words**. Write "None" if there were none. Sign and date it.

## The record

| | |
|---|---|
| Distributor | |
| Month | |
| CA (name, membership no.) | |
| TallyPrime version | |
| GST Offline Tool version | |
| Invoices in the file / imported into Tally | / |
| Fields re-typed (all four files) | |
| Fields in the export (invoices × 9) | |
| Re-typed % | |
| Offline Tool validation errors | |

## Pass or fail

- **Pass:** every invoice imported, **0** fields re-typed, **0** Offline
  Tool validation errors, and a signed discrepancy note (which can say "None").
- **Fail:** more than 10% of fields re-typed, or any invoice not imported.
- **Anything in between** means it needs fixes. Fix them and run the test again
  on the same month.

Enter the counts in the app (**CA test**, under GST reports) so the
result is recorded the same way every time (MANUAL_TESTING.md §37C.7).

## After the test (Bolcash team)

- Each line of the discrepancy note becomes one bug. **Paste the CA's
  wording into the bug as it is; don't paraphrase it.**
- Record the result in RELEASE_NOTES.md.
- The GST help articles (G2) are written from the discrepancy note: one article per confusion the CA hit, in the CA's words, one phone screen each, as `backend/app/chatbot/help_docs/gst-*.md`. Include only rates the CA confirmed. The CA reads the English before they ship; then they're translated to Telugu. Until then the assistant answers GST questions with "not in the help guide", which is deliberate.
