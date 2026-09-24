# Certificate Pinning

**Status: scaffolded, DISABLED by default.** The pinning config exists in both
platforms as commented, ready-to-fill templates. It ships **off** on purpose —
enabling it with wrong or stale pins bricks every API call in the released app,
and that failure only shows up in production. Read this whole doc before you
turn it on.

- Android: [`android/app/src/main/res/xml/network_security_config.xml`](../android/app/src/main/res/xml/network_security_config.xml) — commented `<domain-config>` with a `<pin-set>`.
- iOS: [`ios/AISmartCashBook/Info.plist`](../ios/AISmartCashBook/Info.plist) — commented `NSPinnedDomains` block (iOS 14+).

React Native's `fetch` (used in [`src/api/client.ts`](../src/api/client.ts)) has **no
JS-level pinning API**, so pinning must be enforced at the native/OS layer via
these two files. That's what the scaffolds do.

## Why it's off: the Render + Let's Encrypt rotation trap

The API is hosted on Render, which serves TLS with **Let's Encrypt** certificates
that **auto-renew roughly every ~60 days**. If you pin the **leaf certificate's**
public key, the very next renewal rotates that key and the shipped app — which
can't be updated as fast as the cert rotates — loses all connectivity. Users are
locked out until they update, and you cannot hotfix a pinned binary remotely.

**Pin the CA/intermediate key, not the leaf**, and always ship a **backup pin**:

1. **Primary pin** = SPKI SHA-256 of the **intermediate CA** currently signing
   the cert (e.g. Let's Encrypt `R10`/`R11`, or the ISRG Root `X1`/`X2`). This
   survives leaf renewals as long as the same intermediate is used.
2. **Backup pin** = SPKI SHA-256 of a **second** valid intermediate (Let's
   Encrypt publishes multiple, and rotates which one signs). Pinning both means a
   switch between intermediates doesn't brick the app.

Both platforms **require at least two pins**. Set an `expiration` (Android) and
plan an app update well before the pinned CAs could change.

> If you later move the API behind your **own custom domain with a certificate
> you control**, you can pin more aggressively (your own CA / long-lived cert).
> Until then, CA-pinning Let's Encrypt intermediates is the only safe option.

## Computing the SPKI SHA-256 pins

Get the base64 SHA-256 of the **Subject Public Key Info** for each certificate in
the chain you intend to pin (intermediate + backup intermediate):

```bash
# Dump the served chain, then hash the SPKI of a given cert in it.
# Replace YOUR-API-HOST.onrender.com and inspect each cert in the chain.
openssl s_client -connect YOUR-API-HOST.onrender.com:443 -servername YOUR-API-HOST.onrender.com -showcerts </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

To pin the **intermediate** rather than the leaf, feed the intermediate cert (the
2nd cert in the `-showcerts` output, or download the current Let's Encrypt
intermediates from https://letsencrypt.org/certificates/) into the
`x509 -pubkey` step above. Compute a pin for the current signing intermediate
**and** at least one backup intermediate.

The resulting base64 string (ends with `=`) is what goes in the config.

## Enabling — Android

In `network_security_config.xml`, uncomment the `<domain-config>` and replace:

- `YOUR-API-HOST.onrender.com` → the real API host.
- `PLACEHOLDER_PRIMARY_SPKI_SHA256_BASE64=` → primary intermediate pin.
- `PLACEHOLDER_BACKUP_SPKI_SHA256_BASE64=` → backup intermediate pin.
- `expiration` → a date before which you WILL ship an app update.

Note the `debug` build variant overrides this file, so pinning applies to release
builds. Test a release build against the live API before publishing.

## Enabling — iOS

In `Info.plist`, uncomment the `NSPinnedDomains` block and replace the host and
both `SPKI-SHA256-BASE64` placeholder strings with the same pins. `NSPinnedDomains`
requires iOS 14+. Keep `NSAllowsArbitraryLoads` = `false`.

## Verifying before release

1. Build a **release** binary (pinning is bypassed in debug on Android).
2. Confirm normal API calls succeed against the live host.
3. Negative test: point at a host whose cert chain does NOT match the pins (or use
   a proxy like mitmproxy/Charles) and confirm the connection is **rejected** —
   that proves pinning is active, not silently disabled.
4. Re-verify after each Let's Encrypt intermediate change and before the
   `expiration` date.

## Rollback

Pinning failures look like total loss of connectivity for updated users. If a
rotation slips past a shipped build, the only remote fix is a **fast app update**
that corrects the pins (or comments the block out again). This is why the backup
pin and the CA-level (not leaf) strategy are mandatory, not optional.
