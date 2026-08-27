import * as Keychain from 'react-native-keychain';

/**
 * Keystore/Keychain-backed storage for the app-lock secret.
 *
 * On Android this is the hardware-backed **Android Keystore** (via Keychain's
 * encrypted storage); on iOS it's the **Keychain**. This replaces keeping the
 * PIN hash in plaintext AsyncStorage — the secret is no longer readable on a
 * rooted/jailbroken device's file system.
 *
 * Two items are used so the PIN and biometric paths stay independent:
 *   - PIN_SERVICE : the {salt, pinHash}, readable silently for PIN comparison.
 *   - BIO_SERVICE : a sentinel stored behind biometric access control; reading
 *                   it forces the OS biometric prompt (BiometricPrompt / Face ID).
 */

const PIN_SERVICE = 'smartcashbook.applock';
const BIO_SERVICE = 'smartcashbook.applock.bio';

export interface AppLockSecret {
  salt: string;
  pinHash: string;
}

/** Persist the salted PIN hash in the secure enclave. */
export async function saveAppLockSecret(secret: AppLockSecret): Promise<void> {
  await Keychain.setGenericPassword('applock', JSON.stringify(secret), {
    service: PIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** Read the stored secret for a silent PIN comparison (no biometric prompt). */
export async function readAppLockSecret(): Promise<AppLockSecret | null> {
  const creds = await Keychain.getGenericPassword({service: PIN_SERVICE});
  if (!creds) return null;
  try {
    return JSON.parse(creds.password) as AppLockSecret;
  } catch {
    return null;
  }
}

/** Remove the PIN secret and any biometric enrolment. */
export async function clearAppLockSecret(): Promise<void> {
  await Keychain.resetGenericPassword({service: PIN_SERVICE});
  await Keychain.resetGenericPassword({service: BIO_SERVICE});
}

/** null when the device has no usable biometrics; else the type (FaceID/…). */
export async function getSupportedBiometry(): Promise<Keychain.BIOMETRY_TYPE | null> {
  try {
    return await Keychain.getSupportedBiometryType();
  } catch {
    return null;
  }
}

/**
 * Enrol biometric unlock by storing a sentinel behind biometric access control.
 * Returns false when the device can't do biometrics (caller keeps PIN-only).
 */
export async function enrollBiometric(): Promise<boolean> {
  if (!(await getSupportedBiometry())) return false;
  await Keychain.setGenericPassword('applock', 'ok', {
    service: BIO_SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return true;
}

export async function unenrollBiometric(): Promise<void> {
  await Keychain.resetGenericPassword({service: BIO_SERVICE});
}

/**
 * Prompt the OS biometric check. Returns true only when the user authenticates.
 * Any cancel/failure/lockout resolves false so the caller falls back to the PIN.
 */
export async function authenticateBiometric(prompt: string): Promise<boolean> {
  try {
    const creds = await Keychain.getGenericPassword({
      service: BIO_SERVICE,
      authenticationPrompt: {title: prompt},
    });
    return !!creds;
  } catch {
    return false;
  }
}
