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

| Language | Sheet 1 (reconciliation & payments) applied | On-phone read-through | Reviewer |
|---|---|---|---|
| Telugu | ☐ | ☐ | ____ |

### CA + Tally test (G1, docs/CA_TALLY_TEST.md)

Distributor: ____  Month: ____  CA: ____  TallyPrime: ____  Offline Tool: ____
Fields re-typed: ____ of ____  Offline Tool errors: ____  Discrepancy note signed ☐  Result: ☐ pass ☐ fail ☐ needs fixes

### One-off after deploying the reference warning (R9)

Run once against production, by hand:
`cd backend && .venv/Scripts/python.exe ../scripts/backfill_reference_fingerprints.py`

Fingerprinted: ____  Skipped (no reference): ____  Repeated references found: ____
Run again: Fingerprinted 0 ☐

### Other group 9 checks

See MANUAL_ONLY_TESTS.md group 9; record pass/fail and anything odd here.
