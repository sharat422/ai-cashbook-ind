# React Native crash reporting (Sentry) — setup for Smart CashBook (India)

Adds mobile crash/error reporting that alerts you, to match the backend Sentry
already wired in `app/monitoring.py`. Do the native steps on a **Mac** (needs
Xcode + `pod install`). ~20–30 minutes.

Stack this is written for: **RN 0.76.5**, `react-native-config` for env, npm,
react-navigation v7, iOS bundle id `com.syntaro.aismartcashbook`, Codemagic CI.

> India / DPDP note up front: Sentry SaaS stores data in the **US or EU — there
> is no India region.** Crash reports can contain personal data, so this guide
> **minimises PII** (scrub mobile numbers/names, `sendDefaultPii: false`) and
> treats Sentry as a data processor. Do §8 before you ship to real users.

---

## 1. Create the Sentry project & pick your region
1. Sign up at **sentry.io**. When creating the **organization**, choose the data
   region — **US** or **EU** (EU keeps data in Frankfurt, closer to India and
   often preferred for privacy; **neither is India** — see §8).
2. **Create Project → React Native**. Note the **DSN**
   (Settings → Projects → *your project* → Client Keys (DSN)).
3. Keep this project in the **same Sentry org** as your backend Python project so
   all alerts land in one inbox. Confirm email alerts under
   **Settings → Notifications** (and add your phone via a Slack/Opsgenie/PagerDuty
   integration if you want push/SMS).

## 2. Install the SDK
From the repo root (Mac):
```bash
npm install --save @sentry/react-native
npx @sentry/wizard@latest -i reactNative
```
The wizard patches the native projects (iOS `AppDelegate`, Android
`build.gradle`), adds the Metro/Xcode/Gradle source-map upload hooks, and creates
a `.sentryclirc` / `sentry.properties`. **Review its git diff** — in this repo you
still need the manual tweaks below (DSN via env, PII scrubbing, NativeWind metro).

Then iOS pods:
```bash
cd ios && pod install && cd ..
```

## 3. Feed the DSN through react-native-config (don't hardcode it)
The DSN isn't a secret, but keep it out of source like every other config value.

**`.env`** (and `.env.example`) — add:
```
SENTRY_DSN=
```
Codemagic bakes real values per build (see §7). Local/dev can leave it blank
(Sentry then stays off, like the backend).

**`src/config/env.ts`** — add to the `ENV` object (it will NOT trip the secret
guard — `SENTRY_DSN` isn't in `MOBILE_SECRET_KEYS`, and a DSN is safe to ship):
```ts
  // Crash reporting endpoint (safe to bundle; blank disables Sentry).
  sentryDsn: required('SENTRY_DSN', ''),
```

## 4. Add an init module with PII scrubbing
Create **`src/services/monitoring/sentry.ts`**:
```ts
import * as Sentry from '@sentry/react-native';
import {ENV} from '@config/env';

// Reuses the backend's environment split: prod vs staging is inferred from the
// baked API base URL so mobile issues line up with the right backend project.
const environment = ENV.apiBaseUrl.includes('-prod') ? 'production' : 'staging';

/** Strip anything that could identify a customer before it leaves the device. */
const scrub = (s?: string | null): string | undefined => {
  if (!s) return s ?? undefined;
  return s
    .replace(/(\+?91)?\d{10}\b/g, '[mobile]') // Indian mobile numbers
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b/g, '[gstin]'); // GSTIN
};

export const navigationIntegration = Sentry.reactNavigationIntegration();

export function initSentry(): void {
  if (!ENV.sentryDsn) return; // off in dev / when unset — mirrors the backend
  Sentry.init({
    dsn: ENV.sentryDsn,
    environment,
    sendDefaultPii: false, // never attach IPs, request bodies, etc.
    tracesSampleRate: 0.1, // keep costs/volume low for a large India user base
    integrations: [navigationIntegration],
    beforeSend(event) {
      // Belt-and-braces PII scrub on message + exception text.
      if (event.message) event.message = scrub(event.message);
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrub(ex.value);
      }
      delete event.user; // we don't need user identifiers in crash reports
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.message) crumb.message = scrub(crumb.message);
      return crumb;
    },
  });
}
```

## 5. Initialise + wrap the app
**`App.tsx`** — call init at the top and wrap the export:
```ts
import {initSentry} from '@services/monitoring/sentry';
import * as Sentry from '@sentry/react-native';

initSentry(); // before the component renders

// …existing App component unchanged…

export default Sentry.wrap(App);
```
You already have a custom `ErrorBoundary` (`src/components/ui`) that shows a
fallback screen — **keep it**, and also report from it. In its `componentDidCatch`
add:
```ts
import * as Sentry from '@sentry/react-native';
// inside componentDidCatch(error, info):
Sentry.captureException(error);
```

## 6. Metro + navigation
**`metro.config.js`** — compose Sentry with your existing NativeWind wrap:
```js
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const {withNativeWind} = require('nativewind/metro');
const {withSentryConfig} = require('@sentry/react-native/metro');

const config = mergeConfig(getDefaultConfig(__dirname), {});
module.exports = withSentryConfig(withNativeWind(config, {input: './global.css'}));
```
**Navigation tracing** — in `src/navigation/RootNavigator.tsx`, register the
`NavigationContainer` with the integration so you see which screen a crash
happened on:
```ts
import {navigationIntegration} from '@services/monitoring/sentry';
// on the NavigationContainer:
<NavigationContainer ref={/* keep your existing ref if any */}
  onReady={() => navigationIntegration.registerNavigationContainer(/* ref */)}>
```
(If there's no ref today, create one with `useNavigationContainerRef()` and pass
it to both `ref` and the integration.)

## 7. Upload source maps from Codemagic (so stack traces are readable)
Without source maps, crash stacks are minified garbage. Add to **Codemagic**:
1. Sentry → **Settings → Auth Tokens** → create a token with
   `project:releases` + `org:read` scope.
2. In each mobile workflow in `codemagic.yaml`, add env vars (mark
   `SENTRY_AUTH_TOKEN` as a **secret**):
   ```yaml
       vars:
         SENTRY_ORG: "<your-org-slug>"
         SENTRY_PROJECT: "<your-rn-project-slug>"
         SENTRY_AUTH_TOKEN: $SENTRY_AUTH_TOKEN   # secret, from Codemagic env group
         SENTRY_DSN: "https://…"                 # baked like API_BASE_URL already is
   ```
   Also add `SENTRY_DSN=` to the `.env` bake step you already have (same `awk`
   line pattern used for `API_BASE_URL`).
3. The wizard's Xcode "Bundle React Native code and images" / Gradle hooks upload
   maps automatically on release builds when those env vars are present. Verify a
   release build shows a new **Release** with artifacts under Sentry → Releases.

## 8. India / DPDP checklist — do before real users
- [ ] **Region chosen deliberately** (US/EU; no India option) and recorded.
- [ ] **PII minimised**: `sendDefaultPii: false`, the `beforeSend`/`beforeBreadcrumb`
      scrub above, and `delete event.user`. Never call `Sentry.setUser` with a
      mobile number or name.
- [ ] **Sign Sentry's DPA** (sentry.io → Settings → Legal / Data Processing
      Addendum) — you are the Data Fiduciary, Sentry is a processor.
- [ ] **Privacy policy** names Sentry as a diagnostics processor and the region.
- [ ] **Retention**: set the shortest workable event retention in Sentry settings.
- [ ] Confirm crash reports contain **no ledger amounts, names, or mobiles** by
      inspecting a real test event (§9).

## 9. Test it
Add a temporary throwaway button, or in a dev build run:
```ts
import * as Sentry from '@sentry/react-native';
Sentry.captureException(new Error('Sentry mobile test — ignore'));
```
Within a minute you should get a Sentry email and see the event (with a readable
stack on a release build). Open the event and confirm no customer PII leaked,
then remove the test call.

---
Result: the mobile app now reports crashes to the same Sentry org as the backend,
alerts you by email in real time, and — with the scrubbing above — keeps
customer personal data off a third-party service you don't control.
