# Priority feature audit and implementation

Base: 7e4b6805a60106649aae8a39630c5aa418a82dd8. Branch: feat/priority-feature-gaps.

This is a source audit plus automated test run, not a claim of device E2E completion.

| Feature | Evidence and status |
|---|---|
| AI Voice Transaction | Existing AITransactionScreen, recorder, /voice/parse and editable confirmation. Changed customer lookup to cached repository and ledger saves to offline queue. New-customer creation and transcription still require connectivity. |
| Ultra-fast Khata Entry | Existing AddCreditScreen, amount shortcuts, saved drafts and payment sheet. Speed/tap-count not measured on a device. |
| WhatsApp Collections | Existing localized reminder templates and WhatsApp composer/SMS fallback. User must send; composer handoff does not prove delivery. Backend WhatsApp credentials are required for server sending. |
| UPI Payment Collection | Existing UPI URI, QR, reference and share screen. Payment received is manually recorded; no bank confirmation. |
| Automatic Payment Reconciliation | Missing. No connected bank/payment provider or authenticated payment-event source exists. Requires selecting a provider and merchant onboarding model; cannot infer bank success from opening a UPI link. |
| AI Business Assistant | Existing AssistantScreen and /assistant/ask: business-scoped computed analytics with AI intent selection and keyword fallback. Live AI not called in tests. |
| Customer Payment Score | Existing explainable risk score, factors, confidence and customer UI. Fixed delay allocation: partial payments consume value FIFO instead of falsely settling all earlier credits. This is an internal heuristic, not a bureau score. |
| Daily AI Business Summary | Existing numeric summary, foreground timer and inbox. Added POST /summary/daily/insights plus on-demand UI; AI narrative uses recorded totals with labelled rules fallback. App-closed scheduled push is still absent. New narrative UI currently English. |
| Regional Voice/Languages | Existing auto-detect and ten explicit voice languages; locale dictionaries and language settings. Recognition tests use mocked transcription; real accents/noise need devices/provider. |
| Offline + Cloud Sync | Existing income/expense/ledger queues and root sync managers. Added cached customer search/detail and ledger history; client-id matching prevents displayed double counts after ambiguous retries; cache clears on business reset. Unseen ledger history reports a connectivity error rather than false zero. New customer creation remains online; OS-closed sync not implemented. |

## Changed behavior

- A previously fetched ledger is visible offline.
- A parsed AI entry for an existing cached customer can queue for upload after connectivity is lost.
- Uploaded ledger responses preserve client_id so a retry does not appear twice in displayed totals.
- Queued entries copied into synced cache before removal remain visible offline after successful sync.
- Partial payments contribute proportional delay to the risk model.
- Daily narrative explicitly identifies AI versus recorded-totals fallback; backend provider failures return recorded totals.

## Verification

Results: TypeScript passed; 34 Jest suites / 178 tests passed; 156 backend tests passed.

Run from root: npm run tsc; npm test -- --ci --runInBand.
Run from backend: python -m pip install -r requirements-dev.txt; python -m pytest -o addopts='' -q.

Automated tests use FastAPI TestClient and isolated SQLite; external voice/AI providers are mocked. No production data or payments were used. Native E2E was not run: this workspace has no adb, emulator or Xcode. The prior Android build attempt was blocked downloading Gradle by network restrictions.

## Required device acceptance journeys

1. Sign in, create a customer, add ₹1000 credit, receive ₹100 and verify ₹900 outstanding.
2. Speak a transaction in Hindi/Telugu, review/edit it, resolve the customer and save once. Repeat with denied microphone permission, silence and provider timeout.
3. Load a customer and ledger online. Enable airplane mode; reopen the ledger; create an entry. Restart the app, reconnect and verify exactly one server entry and matching balances.
4. Switch users and verify cached history and queued entries do not appear in the next account.
5. Open collection QR and WhatsApp composer; cancel without sending and confirm no payment is recorded. Verify a real payment in the bank before manual recording.
6. View payment score after partial payments across multiple credits; verify partially unpaid credits remain represented in delay.
7. Generate a daily summary with AI configured, then without it; verify totals match the ledger's income/expense records and fallback is labelled.
8. Confirm foreground-only summary scheduling limitation by closing the app. Add backend scheduler/push before promising app-closed delivery.

## Reconciliation integration needed

Select the merchant payment provider/bank and whether each merchant brings their own account. Then implement provider-specific creation of a persisted payment request, authenticated webhook validation, tenant/merchant binding, integer-paise amount and currency verification, immutable event IDs, database-enforced duplicate protection, atomic ledger posting, pending/failed/refund states, and a status UI. Test duplicates, out-of-order events, wrong signatures, wrong merchant/currency/amount and concurrent delivery in the provider sandbox before live use.
