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
4. **ITC review (purchases).** If purchases were entered with GST, open the
   ITC review file (also on the GST reports screen) and load this month's
   GSTR-2B into it. Check every "not in 2B" line. Table 4 in the GSTR-3B summary
   is a total for review only; the claim comes from GSTR-2B.
5. **Credit notes and Table 13.** If the month has credit notes, check
   the `cdnr`/`cdnur` sheets and the "Credit notes pending ITC" sheet of the
   GSTR-3B summary. Check the `docs` sheet (Table 13), including the cancelled
   numbers.
6. **Discrepancy note.** List every field you had to fix by hand: file,
   invoice number, column, what it said, and what it should say, **in your
   own words**. Write "None" if there were none. Sign and date it.

7. **Rate list (G3).** Go through the table below. For each row, tick
   whether it's right for these distributors' goods. Then list every HSN
   the distributors sell and its rate, and say whether any of them uses a
   rate that isn't in the table (give the HSN, the rate and the
   notification).

   | Rate | Goods | In Bolcash today? | CA: correct? |
   |---|---|---|---|
   | 0%, 5%, 18% | Main slabs from 22 Sep 2025 | Yes | ☐ |
   | 40% | Demerit goods from 22 Sep 2025 | Yes | ☐ |
   | 3% | Gold, silver, jewellery | Yes | ☐ |
   | 0.25% | Rough diamonds | Yes | ☐ |
   | 1.5% | Special rate (CA to name the goods) | **No**, refused | ☐ |
   | 12% | Building materials only, per Notification 14/2025-CT(R): HSN 6815, 6901 00 10, 6904 10 00, 6905 10 00 | **No**, refused from 22 Sep 2025 (a known bug) | ☐ |
   | 6% | Brick kilns, no input tax credit option | **No**, refused | ☐ |
   | 12% (all goods) | Before 22 Sep 2025 only | Yes | ☐ |
   | 28% | Pan masala and tobacco, until 1 Feb 2026 | Yes | ☐ |

   HSNs the pilot distributors sell, with their rates:

   | HSN | Goods | Rate | Notification |
   |---|---|---|---|
   | | | | |

   CA name: __________  Date: __________  Signature: __________

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

Enter the result in the app (**CA test**, under GST reports): records
imported, fields re-typed, the CA's name, Tally version, Offline Tool errors
and the discrepancy note, then **Save result**. It's kept on the server under
CA tests, so it can be found later (MANUAL_TESTING.md §37C.7).

## After the test (Bolcash team)

- Each line of the discrepancy note becomes one bug. **Paste the CA's
  wording into the bug as it is; don't paraphrase it.**
- Record the result in RELEASE_NOTES.md.
- **Rates (G3):** add each rate the CA confirmed that Bolcash doesn't
  allow yet (1.5%, the 12% building materials, 6%, or anything new) to
  `backend/app/gst.py`, the one place rates live. Put the notification
  reference next to each one, plus a comment naming the CA and the date
  they confirmed the list. Limit HSN-specific rates to their HSNs. Only add
  rates the CA confirmed.
- The GST help articles (G2) are written from the discrepancy note: one article per confusion the CA hit, in the CA's words, one phone screen each, as `backend/app/chatbot/help_docs/gst-*.md`. Include only rates the CA confirmed. The CA reads the English before they ship; then they're translated to Telugu. Until then the assistant answers GST questions with "not in the help guide", which is deliberate.

---

## Ruling: GST on item bills and schemes (SC1)

Item bills (goods with FMCG schemes) are **not GST invoices** in Bolcash
today. They aren't in the GSTR-1 file or the Tally exports; GST invoices are
made from Add credit. That stays until this ruling is written and signed.

**Bring three real item bills, each with its scheme log:** one 10+1 (free
goods), one % off, and one quantity-slab bill.

For each scheme type, please answer in writing.

1. **The free goods line.** Is it taxed, and on what value? CBIC Circular
   92/11/2019-GST, para 2(B): a free item tied to a purchase (buy one, get
   one) isn't a gift. Tax is on the price actually collected, and ITC on both
   items is kept.
2. **The % off.** Does it reduce the taxable value under s.15(3)(a), as a
   discount given at supply and shown on the invoice? Or does it need a GST
   credit note under the new s.15(3)(b) (from 1 Nov 2026), with the buyer
   reversing the attributable ITC? A commercial credit note with no GST
   doesn't reduce tax (Circular 251/08/2025-GST).
3. **Free samples or gifts.** Does any scheme in use count as a free sample
   or gift under s.17(5)(h)? Then there's no output tax, but the ITC on those
   goods is blocked and any credit already claimed is reversed in GSTR-3B
   Table 4(B)(1). The 57th GST Council (8 Oct 2026) proposed removing this
   block, but as of Nov 2026 it's a recommendation, not law.

| Scheme type | Free goods taxed? On what value? | % off: s.15(3)(a) or credit note? | Free sample / gift (s.17(5)(h))? |
|---|---|---|---|
| 10+1 / buy-get | | | |
| % off | | | |
| Quantity slab | | | |

CA name: __________  Date: __________  Signature: __________

**After the ruling (Bolcash team):** write the build prompt for GST on item
bills, quoting the ruling for each scheme type. No GST code goes on item bills
before then. `backend/tests/test_item_bills_not_gst.py` fails if a bill ever
shows up in the GSTR-1 file or the Tally export without that ruling.
