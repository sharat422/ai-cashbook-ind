# Bank SMS → Transaction Import

Turns Indian bank transaction SMS into cashbook entries. **The user reviews and
confirms (or edits) every candidate before anything is saved — nothing is ever
auto-saved, and no message leaves the device.**

## How it works

1. **Ingest a message** (two paths):
   - **Scan** (Android only): `READ_SMS` runtime permission → read recent inbox
     messages → keep only recognisable bank transactions.
   - **Paste** (all platforms, incl. iOS): user pastes one bank SMS.
2. **Parse** (`src/features/sms-import/domain/bankSms.ts`, pure + unit-tested):
   extracts amount, direction (debit→expense / credit→income), date, merchant,
   bank, and account tail. Skips balance/limit amounts; rejects OTPs & promos.
3. **Review** (`SmsImportScreen`): each candidate is an editable card (type,
   amount, party, category, date) showing the original SMS. The user taps
   **Add transaction** to save via the normal income/expense flow, or **Ignore**.

## Supported banks / formats

Tested against real-world templates for **SBI, HDFC, ICICI, Axis, Kotak** — UPI
debits, card spends, NEFT/IMPS credits, and account transfers (see
`bankSms.test.ts`, 18 cases). The parser is tolerant: unknown senders still parse
if they contain an amount + a debit/credit verb; anything else returns `null`.

## Platform limitations

- **iOS: no SMS reading.** Apple's sandbox forbids inbox access entirely — there
  is no entitlement for it. iOS users use the **paste** path. This is a hard
  platform limitation, not a bug.
- **Android:** inbox reading works via `react-native-get-sms-android` +
  `READ_SMS`. Needs a native rebuild to verify (can't build from a Windows/CI-less
  shell); the parser + reader logic are unit-tested with the native module mocked.

## ⚠️ Google Play restriction (BLOCKER for the scan path)

`READ_SMS` is a **restricted permission**. Since 2019 Play only allows it for the
device's **default SMS handler** or apps granted a **Permissions Declaration
exception**. "Financial-transaction SMS parsing" *is* an accepted exception use
case, but it requires:

- a Permissions Declaration Form in the Play Console,
- a privacy policy stating SMS is processed on-device and never transmitted,
- usually a short demo video, and review by Google.

**Until that exception is granted, shipping the `READ_SMS` line risks app
rejection.** Options:

- **A — Pursue the exception** (keep scan + paste). Recommended if auto-import is
  a headline feature.
- **B — Paste-only for launch**: remove the `<uses-permission READ_SMS>` line and
  the "Scan bank SMS" button is automatically hidden (`isSmsScanSupported()` also
  gates on platform). The parser + review flow ship unchanged and are 100%
  Play-safe on both platforms. Fastest path to store.

The code is structured so switching between A and B is just the manifest line +
nothing else — the paste path never depends on the permission.

## Privacy

Messages are parsed **on-device**; only a user-confirmed transaction is persisted
(and it syncs like any other entry). The raw SMS text is stored in the entry's
notes for the audit trail. No SMS content is uploaded for parsing.
