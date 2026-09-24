# Third-party data audit — Smart CashBook

Every third-party SDK/library/service that could touch user data, what it likely
handles, whether it's more than we need, its data-processing terms to review, and
a keep/remove call. Verified against `package.json`, `backend/requirements.txt`,
the Android/iOS native config, and the code that actually calls each one
(as of 2026-09-23, `dev`).

**Headline:** there are **no analytics, ad, payment-gateway, or push-notification
SDKs**, and **no crash SDK in production yet**. The iOS privacy manifest declares
`NSPrivacyTracking = false` and no collected data types. The only services that
receive user data off-device are **OpenAI**, **Anthropic**, optionally **Meta
(WhatsApp)**, and **Render** (hosting). That's a small, defensible surface.

---

## A. External services that RECEIVE user data

### 1. OpenAI (backend) — `openai==1.59.6`
- **Used for:** voice transcription (Whisper), and GPT for transaction/expense
  parsing, categorisation, khata insights.
- **Data it receives:** the recorded **voice audio**; the **typed/spoken text**
  of a transaction; and for insights, **aggregate khata stats that include
  customer names** (top defaulters). Only sent when an API key is configured;
  otherwise the app falls back to on-device heuristics.
- **More than we need?** ⚠️ **Yes, in one place:** khata insights sends **customer
  names** to OpenAI when it only needs the numbers. Recommend sending ids/labels
  instead of names, or keeping insights on the local heuristic.
- **Terms to review:** OpenAI **API Data Processing Addendum**, and the API data
  usage policy — API inputs are **not used for training by default** and are
  retained ~30 days for abuse monitoring (**zero-retention** is available on
  request for eligible accounts). Sign the DPA before real user data.
- **Keep/remove:** **Keep** (core feature). Minimise the insights payload; sign
  the DPA; consider requesting zero-retention.

### 2. Anthropic (backend) — `anthropic==0.42.0`
- **Used for:** receipt OCR / field extraction (Claude vision).
- **Data it receives:** the **receipt image** the user scans — which can contain
  names, amounts, GSTIN and addresses.
- **More than we need?** No — the whole image is needed to read it. But it's
  high-sensitivity content.
- **Terms to review:** Anthropic **Commercial Terms + DPA**; API inputs are **not
  used for training by default**. Sign the DPA before real user data.
- **Keep/remove:** **Keep** (core feature). Sign the DPA.

### 3. Meta — WhatsApp Cloud API (backend) — via `httpx`, no SDK
- **Used for:** sending notification messages. **Off by default**
  (`WHATSAPP_ENABLED=false`, and the endpoint 503s unless tokens are set).
- **Data it receives (only if you enable it):** the **recipient's mobile number**
  and the **message text**, which may include a customer name and amount.
- **More than we need?** N/A while disabled. If enabled, keep messages minimal.
- **Terms to review:** WhatsApp Business Platform terms + **Meta's DPA**, plus
  India-specific WhatsApp Business messaging rules. Review **before** enabling.
- **Keep/remove:** **Keep disabled** until you actually need it and have the DPA.

### 4. Render (hosting + PostgreSQL) — infrastructure processor
- **Used for:** runs the API and stores the database — so it processes **all**
  app data.
- **Data it receives:** everything (incomes, expenses, customers, ledgers, etc.).
- **Terms to review:** Render's **DPA** and sub-processor list; confirm the DB
  region (currently Singapore — see `docs/DATABASE_MIGRATION_DECISION.md`) and
  encryption-at-rest. Sign the DPA.
- **Keep/remove:** **Keep** (it's your infrastructure). Sign the DPA.

### 5. Sentry — crash/error monitoring — **pending, not in production**
- **Status:** wired on the `feat/breach-detection` branch only; activates solely
  when `SENTRY_DSN` is set, with PII scrubbing (`docs/SENTRY_REACT_NATIVE_SETUP.md`).
- **Data it would receive:** stack traces + breadcrumbs (scrubbed of
  mobiles/GSTIN; `sendDefaultPii=false`).
- **Terms to review:** **Sentry DPA** + region choice (US/EU; no India region).
- **Keep/remove:** **Keep, but sign the DPA and confirm scrubbing before you set
  the DSN in production.**

### 6. Apple App Store / Google Play (incl. TestFlight) — distribution
- Not an SDK in the app. Apple/Google collect standard **store-level** telemetry
  (installs, and OS-level crash reports if the user opts in at the OS). Review
  Apple's and Google's data policies for what the stores expose to you; nothing
  extra is embedded in the app.

---

## B. On-device native modules that touch SENSITIVE data
These do **not** send data to any third party themselves — they capture data that
then flows only to **your** backend (and from there, only the audio/receipt goes
on to OpenAI/Anthropic). Listed because they drive permissions and store review.

| Library | Sensitive access | Where the data goes |
|---|---|---|
| `react-native-get-sms-android` | **Reads SMS** (Android READ_SMS) | Parsed **on-device**; only entries the user saves reach your backend. No SMS text leaves the phone. |
| `react-native-image-picker` | Camera / photo library | Chosen receipt image → your backend → Anthropic |
| `react-native-audio-recorder-player` | Microphone | Recording → your backend → OpenAI Whisper |
| `react-native-keychain` | Secure keystore | Stays in the OS Keychain/Keystore (local) |
| `@react-native-async-storage/async-storage` | Local app storage | On-device only |
| `jail-monkey` | Root/jailbreak + device signals | On-device only |

> ⚠️ **`react-native-get-sms-android` is the one to reconsider.** Reading SMS
> triggers **Google Play's restricted SMS/Call-Log permissions policy** — you must
> file a Permissions Declaration and justify it, and many apps get rejected.
> **Recommendation:** keep it **only if** the SMS-import feature is actually
> shipping and core; otherwise **remove it** to avoid the Play review burden and
> the privacy exposure. It's Android-only regardless.

---

## C. Local-only libraries (no external data transmission — for completeness)
`@react-navigation/*`, `@tanstack/react-query`, `zustand`, `nativewind`,
`react-native-reanimated`, `react-native-screens`, `react-native-safe-area-context`,
`@react-native-community/netinfo` (reads connectivity state, sends nothing),
`@react-native-community/datetimepicker`, `react-native-svg`,
`react-native-qrcode-svg`, `react-native-fs`, `react-native-html-to-pdf`,
`react-native-share`, `react-native-config`, `xlsx`.

- **`xlsx` (SheetJS)** processes data locally (Excel export) — no transmission —
  but the npm build has had security advisories; **keep it updated** (or move to
  the maintained CDN build) and only feed it the user's own data.

---

## D. Summary recommendations
1. **Sign DPAs before real user data:** OpenAI, Anthropic, Render (and Sentry
   before you enable it). These are your actual processors.
2. **Minimise the OpenAI insights payload** — stop sending customer names; send
   ids/labels or keep insights on the local heuristic.
3. **Decide on `react-native-get-sms-android`** — remove it unless SMS-import is a
   shipping, core feature (Google Play restricted-permission risk).
4. **Keep WhatsApp/Meta disabled** until needed and covered by a DPA.
5. **Nothing else to remove** — there are no analytics/ads/tracking SDKs to strip.
   Keep it that way; add tracking only with a clear need, consent, and a DPA.
6. List OpenAI, Anthropic, Render (+ Sentry/Meta when live) as **sub-processors**
   in your privacy policy, per the DPDP Act.
