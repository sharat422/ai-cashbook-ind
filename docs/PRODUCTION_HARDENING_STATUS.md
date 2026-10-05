# Production hardening status

NOT READY FOR PUBLIC CUSTOMERS. This change is a tested hardening increment, not a full security certification or a finished production deployment.

## Implemented

- Development OTPs expire after five minutes, have five attempts, are bound to a challenge and phone, and are single-use under a lock.
- Secure random code generation; no OTP values logged. Outstanding challenges are bounded and requests per phone are limited.
- Production OTP requests/verification return 503 because this repository has no real SMS transport or shared OTP store. This deliberately exposes the existing deployment blocker instead of returning a code that was never delivered. Do not enable DEBUG in production to bypass this guard.
- Non-debug configuration refuses weak/default JWT secrets. JWT verification requires subject and expiry claims.
- Income, expense and Khata entry dates, nonblank idempotency keys, category/vendor and notes are checked. Onboarding/customer names and assistant/parser text are bounded.
- Attachments restricted to documented extensions and 10 MB; voice input capped at 20 MB. Extension checks do not replace content scanning.
- Cross-origin cookies disabled for the bearer-token API.
- Existing CI now installs requirements-dev.txt, runs the security regression tests, and grants read-only repository permissions.
- Earlier offline, scoring and daily-summary changes remain included.

## Release blockers requiring more work

1. Real SMS provider, India sender/template setup where applicable, shared OTP storage, distributed per-account/IP rate limiting and production OTP integration tests. Current OTP implementation is development-only.
2. Receipt uploads remain public static URLs. Add tenant-authorized downloads/private object storage, content verification, retention policy and access-control tests before storing real customer documents.
3. Payment provider/merchant onboarding choice, authenticated webhook reconciliation, duplicate/concurrent event safety and sandbox payment tests.
4. Database-enforced idempotency under concurrent requests, migration review on existing data, durable PostgreSQL/backups and a demonstrated restore drill. Current lookup-before-insert is not sufficient for concurrent retries.
5. Full mobile E2E on physical Android/iOS devices: microphone, UPI/WhatsApp handoff, offline restart/sync, session switching, permissions, release signing and upgrade paths.
6. Fix existing ESLint errors; validate dependencies and native release builds. This workspace cannot run Xcode or an Android emulator.
7. Background summary/push delivery, production monitoring/error alerts, ownership of incident response, privacy/deletion flows and store release checks.
8. Review asynchronous cache/session-switch races, secure local storage and offline creation of new customers. Current offline changes are not a complete multi-device synchronization solution.

## Push safely from Windows PowerShell

Use the cumulative patch on a fresh feature branch based on the audited main commit. It includes the earlier priority feature changes; do not apply both cumulative and earlier patches.

    cd C:\Users\tapaw\repos\AI_Smart_CashBook
    git status
    git switch main
    git pull --ff-only origin main
    git switch -c feat/production-hardening
    git apply --check "$env:USERPROFILE\Downloads\cashbook-production-changes.patch"
    git apply "$env:USERPROFILE\Downloads\cashbook-production-changes.patch"
    git diff --check
    npm ci
    npm run tsc
    npm test -- --ci --runInBand
    py -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
    cd backend
    ..\.venv\Scripts\python.exe -m pytest -q
    cd ..
    git add .github/workflows/tests.yml backend/app backend/tests src docs/PRIORITY_FEATURE_AUDIT.md docs/PRODUCTION_HARDENING_STATUS.md
    git diff --cached --stat
    git commit -m "Harden authentication and validation; improve offline cashbook"
    git push -u origin feat/production-hardening

Commit/stash your own pending changes before switching branches. If patch checking fails, stop; the local code has diverged or already includes changes. Never force-apply or force-push to work around this. Review staged files for generated files or secrets before committing.

Open a pull request into dev for staging review. Do not merge to main until the blockers above are resolved: the existing Codemagic configuration can trigger builds/uploads on main pushes. Review actual CI checks before configuring branch protection.
