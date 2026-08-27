# Android Platform Parity & Play Store Release

Status of the Android build for **Smart CashBook** (React Native 0.76.5, New
Architecture enabled, Hermes). This tracks the platform audit, what's already
done, what needs a native rebuild, and the decisions still blocking submission.

> **Not Flutter.** The original brief mentioned `flutter_secure_storage`; this is
> a React Native app, so the equivalent is `react-native-keychain` (Android
> Keystore–backed). All notes below use the RN toolchain.

---

## 1. Audit — platform-specific surface

Searched the entire `src/` + native folders. Findings:

| Area | Status | Detail |
|---|---|---|
| iOS **Keychain** | ✅ none present | PIN hash is in AsyncStorage, not Keychain — nothing to "port", but see §3.1. |
| **Face ID** / biometrics | ✅ none present | Lock is a 4-digit PIN. Biometric unlock is net-new (§3.2). |
| **APNs** / push | ✅ none present | Notifications are in-app only (`inbox.store`) + WhatsApp deep links. No push on either platform (§3.3). |
| Swift/ObjC custom native | ✅ none | Stock RN iOS template (`AppDelegate.mm`, `main.m`). |
| `Platform.OS` branches | ✅ already handle Android | `DateField`, `Screen` (keyboard), WhatsApp URL separators — all correct. |
| Safe-area | ✅ cross-platform | `react-native-safe-area-context` with `edges`. |
| Hardware back button | ✅ free | `@react-navigation/native-stack` maps Android back automatically; no `BackHandler` hacks needed. |
| Runtime permissions | ⚠️ verify | Manifest declares CAMERA + granular media (`READ_MEDIA_IMAGES`, scoped legacy storage). `react-native-image-picker` requests at runtime; smoke-test on Android 10 & 13 (§5). |

**Conclusion:** no iOS-only API will "break" on Android because none are used.
The real work is release hardening + a few net-new security features.

---

## 2. Build configuration — DONE (needs a Gradle build to verify)

All in `android/`:

- **applicationId** `com.syntaro.aismartcashbook` (✅ aligned to the iOS bundle id — the
  public store identity). **namespace** stays `com.aismartcashbook` (internal code package;
  the two are independent and need not match).
- **minSdkVersion 24** (Android 7.0) — good India device coverage. ✅ meets "24+".
- **targetSdkVersion 35** (bumped from 34; Play requirement Aug 2025). compileSdk already 35. ✅
- **Release signing** now reads `android/keystore.properties` (untracked). Falls back to the
  debug key only when that file is absent, so dev/CI without secrets still builds.
  → You must generate the upload key (§6) — see `android/keystore.properties.example`.
- **R8/ProGuard** enabled for release (`minifyEnabled` + `shrinkResources` = true) with keep
  rules for reanimated/screens/svg/image-picker/fs/config/okhttp in `proguard-rules.pro`.
  ⚠️ **Must smoke-test a release build** — if a reflective path was stripped, add its
  package to the keep list.
- **Cleartext disabled** via `res/xml/network_security_config.xml` (HTTPS-only). A
  `src/debug/` override permits HTTP to `10.0.2.2`/`localhost` for the dev backend only.

---

## 3. Platform-parity items

### 3.1 Secure storage for the app-lock PIN (Keystore / Keychain) — ✅ IMPLEMENTED

`react-native-keychain` added. The PIN `{salt, pinHash}` now lives in the **Android
Keystore** / **iOS Keychain** instead of AsyncStorage:
- `src/features/security/data/secureStore.ts` — wrapper (save/read/clear + biometrics).
- `src/features/security/store/appLock.store.ts` — refactored **async**; only `enabled` +
  `biometricEnabled` persist to AsyncStorage. Includes a one-time migration that moves any
  legacy plaintext PIN from AsyncStorage into the secure store on first launch.
- `pinHash.ts` (SHA-256) unchanged as the hashing function.
- Unit-tested (`appLock.store.test.ts`, 10 cases) with the native module mocked.

> **Needs a native rebuild + `cd ios && pod install` (on mac/CI) to verify the real
> Keystore/Keychain path.** I can't run that from Windows — smoke-test the lock on device
> (set PIN → background → reopen → unlock; wrong PIN; disable).

### 3.2 Biometric unlock (BiometricPrompt / Face ID) — ✅ IMPLEMENTED

Uses `react-native-keychain`'s biometric access control (no extra lib):
- Settings shows a **Biometric unlock** toggle when the device supports it and the PIN lock
  is on (`getSupportedBiometry()`), enrolling a biometric-gated Keychain sentinel.
- `UnlockScreen` auto-prompts biometrics when locked and offers a **Use biometrics** button;
  the PIN is always the fallback.
- Manifest: `USE_BIOMETRIC` permission added.
- Device QA: fingerprint/Face ID unlock, cancel → PIN still works, no-biometrics device.

### 3.3 Push notifications (FCM) — DEFERRED, needs a Firebase project

There is no APNs to "replace" — push doesn't exist yet. To add it:

```bash
npm install @react-native-firebase/app @react-native-firebase/messaging
```

Requires **your Firebase project**: `google-services.json` (Android, → `android/app/`) and
`GoogleService-Info.plist` (iOS). Then apply the `com.google.gms.google-services` Gradle
plugin, request `POST_NOTIFICATIONS` at runtime (Android 13+), register the FCM token with
the backend, and add a backend send path. **Blocked on §6.**

### 3.4 Certificate pinning — needs the API cert, and a rollover plan

Cross-platform via `react-native-ssl-pinning` **or** the zero-native OkHttp/NSURLSession
route: pin in `network_security_config.xml` (Android) + `NSPinnedDomains` (iOS). The API is
on Render behind Let's Encrypt, which **rotates every ~60–90 days**, so pin the **CA/backup
key**, not the leaf, and always ship two pins. Android form:

```xml
<domain-config>
  <domain includeSubdomains="true">smart-cashbook-api.onrender.com</domain>
  <pin-set expiration="2026-12-31">
    <pin digest="SHA-256">PRIMARY_KEY_PIN_BASE64=</pin>
    <pin digest="SHA-256">BACKUP_KEY_PIN_BASE64=</pin>
  </pin-set>
</domain-config>
```

Get pins with: `openssl s_client -connect smart-cashbook-api.onrender.com:443 | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64`. **Blocked on §6** (confirm final API domain + pin strategy — a bad pin bricks the app in the field).

### 3.5 Root detection (flag, don't block) — ✅ IMPLEMENTED

`jail-monkey` added. `src/features/security/data/deviceIntegrity.ts` wraps `isJailBroken()`
(fails safe to `false` on error); `DeviceIntegrityBanner` shows a **dismissible, non-blocking**
warning on the Dashboard for rooted/jailbroken devices — never hard-exits. Unit-tested
(`deviceIntegrity.test.ts`). Needs a native rebuild to exercise the real check.

---

## 4. Security summary (Android)

| Control | State |
|---|---|
| Cleartext blocked (ATS-equiv) | ✅ `network_security_config.xml`, release HTTPS-only |
| Encrypted at-rest secrets | ✅ PIN in Keystore/Keychain (§3.1) — verify on device |
| Biometric unlock | ✅ implemented (§3.2) — verify on device |
| Certificate pinning | ⏳ deferred (§3.4 — needs cert + rollover plan) |
| Root detection (flag) | ✅ implemented (§3.5) — verify on device |
| Signing key out of VCS | ✅ `keystore.properties` + `*.jks` gitignored |

---

## 5. Testing / QA

**Emulator profiles to create (Android Studio → Device Manager):**
- **Low-end:** Pixel-class, **2 GB RAM**, **Android 11 (API 30)** — India's mid-market floor.
- **Modern:** Pixel 7/8, **Android 14/15 (API 34/35)**.
- (Optional) **Android 10 (API 29)** to catch scoped-storage/permission differences.

**Manual QA matrix before submission** (run on BOTH profiles):

1. Cold app launch (no crash, splash → Login).
2. OTP login (existing number → Dashboard; new number → onboarding).
3. Language: register in Telugu → Dashboard renders Telugu.
4. Add income + add expense → Dashboard figures update.
5. Add customer → add credit → receive payment → outstanding correct.
6. Receipt scan: **camera runtime permission** prompt → capture → review.
7. Attachment: **gallery/media permission** (Android 13 granular vs ≤12 storage).
8. Reports → export **PDF/CSV** → Android share sheet opens (`react-native-share`).
9. Recurring expense → Mark paid → expense created.
10. Ask AI + Business summary load.
11. App-lock: set PIN → background/reopen → unlock; wrong PIN rejected; disable clears it.
    Biometric toggle (Settings) → lock → **Use biometrics** unlock; cancel → PIN fallback.
    Root-detection banner appears on a rooted emulator/device (dismissible, non-blocking).
12. Offline: airplane mode → add entries (queued) → reconnect → sync, no dupes.
13. **Hardware back button** across stacks + modals; no dead-ends.
14. Logout → local data cleared → login as different number shows no leaked data.
15. Rotate device / small-screen (360dp) layout sanity.
16. Notifications runtime permission (Android 13+) if/when push ships.

---

## 6. Decisions — RESOLVED (2026-08-26)

1. ✅ **applicationId** → `com.syntaro.aismartcashbook` (aligned to iOS). Done.
2. ⏳ **Upload keystore** → still needed from you. Generate with the `keytool` command in
   `android/keystore.properties.example`, drop the `.jks` in `android/app/`, and fill in
   `android/keystore.properties` (gitignored). Enroll in **Play App Signing** (recommended).
   This is the only remaining hard blocker for producing the signed `.aab`.
3. ✅ **Push/FCM** → **deferred.** Nothing depends on it today. §3.3 stays as the recipe.
4. ✅ **Cert pinning** → **deferred** (Render's LE cert rotates; revisit with a rollover plan).
   ✅ **Root detection** → **approved**, flag-only (see §3.5, being implemented).
5. ✅ **Secure storage + biometric** → **approved.** `react-native-keychain` integration
   (§3.1–3.2) is being implemented. Needs a device/CI rebuild to verify the native path —
   I can't build from this Windows shell; JS logic is unit-tested with the native module mocked.

## 7. Build the signed AAB

### In CI (recommended — no local Android toolchain needed)

The **`android-production`** workflow in `codemagic.yaml` builds the signed `.aab`. One-time
setup: create an encrypted variable **group** `android_release_keystore` in Codemagic with:

| Variable | Value |
|---|---|
| `CM_KEYSTORE` | the upload `.jks`, base64-encoded (`base64 smartcashbook-upload.jks`) |
| `CM_KEYSTORE_PASSWORD` | store password |
| `CM_KEY_ALIAS` | key alias |
| `CM_KEY_PASSWORD` | key password |

The build decodes the keystore, writes `android/keystore.properties`, runs `bundleRelease`
with a unique `versionCode` (= Codemagic build number), verifies the signature, and exposes
the `.aab` + `mapping.txt` as artifacts. It fails fast if any secret is missing (so it can
never silently emit a debug-signed bundle). Auto-publish to a Play track is a commented-out
`publishing: google_play:` block — enable it once you add a Play service-account JSON.

### Locally (if you have the Android SDK)

```bash
# with android/keystore.properties present:
cd android
./gradlew bundleRelease      # -> app/build/outputs/bundle/release/app-release.aab
./gradlew assembleRelease    # APK for sideload testing
```
