import JailMonkey from 'jail-monkey';

/**
 * Best-effort root/jailbreak detection (heuristic — not a hard guarantee).
 *
 * Policy: **flag, don't block.** We warn the user and can log a telemetry event,
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
