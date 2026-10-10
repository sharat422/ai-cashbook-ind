# Sentry crash reporting (P12)

Field crash visibility for BolCash. Additive to the on-device diagnostics
error log (`DiagnosticsScreen`) — that stays as the local record.

## What was wired

- `@sentry/react-native` ^8.29.0 (package.json — run `npm ci`; CI does this
  on every build).
- `src/services/sentry/sentry.ts` — `initSentry()` called from `index.js`
  before anything else. Initializes **only** when a `SENTRY_DSN` is baked
  into the build and the build is not `__DEV__`.
- `beforeSend` scrubs Indian phone numbers and ₹ amounts from messages,
  exception values and breadcrumbs. **Never attach transaction payloads,
  phone numbers or business names to Sentry events.**
- `reportError(context, error)` helper — writes to the local error log AND
  Sentry. Prefer it over raw `Sentry.captureException`.
- Android: `io.sentry.android.gradle` plugin 5.8.0 applied in
  `android/app/build.gradle` (+ classpath in `android/build.gradle`).
  Uploads `mapping.txt` + Hermes sourcemaps on release builds so dashboard
  stack traces de-obfuscate.
- `metro.config.js` wrapped with Sentry's metro config (guarded — Metro
  boots fine if the package isn't installed yet).
- `android/sentry.properties` — org/project slugs (fill in after signup).
- QA: Diagnostics screen → "QA tools" → "Send test crash (Sentry)".

## Human steps (dashboards I can't reach)

1. **Create the Sentry account + project** at https://sentry.io
   (a "BolCash Android" project is enough for v1).
2. **Fill in** `android/sentry.properties`: `defaults.org` and
   `defaults.project` with your real slugs.
3. **DSN**: Sentry → project settings → Client Keys → copy the DSN.
   Add it to Codemagic as an encrypted env var `SENTRY_DSN` on the
   `android-production` workflow (the build seeds `.env` from these, same
   mechanism as `API_BASE_URL`). Never commit it — `.env` is git-ignored
   and `.env.example` carries only the empty placeholder.
4. **Auth token** (for mapping.txt upload): Sentry → org settings →
   Auth Tokens → create one with `project:write`. Add as encrypted
   Codemagic var `SENTRY_AUTH_TOKEN`. sentry-cli picks it up from env;
   it is deliberately NOT in `sentry.properties`.
5. **Verify**: build `android-production`, install the QA AAB, open
   Diagnostics → "Send test crash (Sentry)" → relaunch → confirm the crash
   appears in the Sentry dashboard **de-obfuscated** within a few minutes.
   Fire a second crash containing a phone number / ₹ amount somewhere in
   the message and confirm the dashboard shows `[PHONE]` / `[AMOUNT]`.

## iOS (deferred — Android-first v1)

The JS layer (`sentry.ts`, `index.js`) is platform-agnostic and will work
on iOS once `@sentry/react-native` pods are installed (`pod install`) and
the Xcode "Upload Debug Symbols" build phase is added (the Sentry wizard
does this: `npx @sentry/wizard@latest -i react-native` on a Mac).
