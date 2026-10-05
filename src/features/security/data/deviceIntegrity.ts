import JailMonkey from 'jail-monkey';

import {logError} from '@/services/diagnostics/errorLog.store';

/**
 * Best-effort root/jailbreak detection (heuristic — not a hard guarantee).
 *
 * Policy: **flag, don't block.** We warn the user and log a telemetry event,
 * but never hard-exit — false positives happen (custom ROMs, dev devices), and
 * locking a legitimate shopkeeper out of their own cashbook is worse than the
 * risk. Any detection error is treated as "not compromised" so a library hiccup
 * can't nag every user.
 */
export function isDeviceCompromised(): boolean {
  try {
    return JailMonkey.isJailBroken();
  } catch {
    return false;
  }
}

// Log the occurrence at most once per app session — the banner re-renders often
// and we don't want to flood the diagnostic buffer with duplicates.
let _logged = false;

/**
 * Evaluate device integrity AND record a one-off telemetry event when the
 * device looks compromised. Returns the same boolean as `isDeviceCompromised`
 * so callers (e.g. the warning banner) can both render and log in one call.
 */
export function reportDeviceIntegrity(): boolean {
  const compromised = isDeviceCompromised();
  if (compromised && !_logged) {
    _logged = true;
    logError(
      'security/device-integrity',
      'Device appears rooted or jailbroken (flagged, not blocked)',
    );
  }
  return compromised;
}

/** Test-only: reset the once-per-session log guard. */
export function __resetDeviceIntegrityLogForTests(): void {
  _logged = false;
}
