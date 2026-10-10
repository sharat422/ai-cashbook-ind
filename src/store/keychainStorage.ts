import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import type {StateStorage} from 'zustand/middleware';

import {logError} from '@/services/diagnostics/errorLog.store';

/**
 * Keychain/Keystore-backed `StateStorage` for zustand `persist`, used by the
 * auth store so the JWT never sits in plaintext AsyncStorage.
 *
 * On Android this is the hardware-backed **Android Keystore** (via
 * react-native-keychain's encrypted storage); on iOS it's the **Keychain**.
 * The whole serialized persist payload is stored as one generic-password
 * entry, so a rooted/jailbroken device's file system no longer yields the
 * auth token.
 *
 * Conventions (mirroring `src/features/security/data/secureStore.ts`):
 * - single service `smartcashbook.auth`, fixed username `auth`; the secret
 *   material lives in the `password` field
 * - `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: never leaves the device, never in
 *   backups (pairs with `allowBackup=false` in the manifest)
 *
 * Failure contract:
 * - **writes throw loudly** — a failed `setItem`/`removeItem` is logged to the
 *   diagnostics error log and rethrown. We never silently fall back to
 *   plaintext storage.
 * - **reads return null when empty** — `getItem` resolving null means
 *   "no session", same as before; callers treat that as unauthenticated.
 * - the secret value itself is never written to any log.
 */

const AUTH_KEYCHAIN_SERVICE = 'smartcashbook.auth';
const AUTH_KEYCHAIN_USERNAME = 'auth';
/** zustand persist `name` used before this migration (AsyncStorage key). */
const LEGACY_ASYNC_KEY = 'auth-storage';

/** Write the serialized payload; throws (loudly) when the OS store refuses. */
async function writeKeychainEntry(value: string): Promise<void> {
  let result: false | Keychain.Result;
  try {
    result = await Keychain.setGenericPassword(AUTH_KEYCHAIN_USERNAME, value, {
      service: AUTH_KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logError('auth keychainStorage.write', error);
    throw error;
  }
  // react-native-keychain resolves `false` (not a rejection) when the OS
  // keystore/keychain refuses the write — treat it as a hard failure.
  if (result === false) {
    const error = new Error(
      'react-native-keychain setGenericPassword returned false',
    );
    logError('auth keychainStorage.write', error);
    throw error;
  }
}

/**
 * One-shot migration for installs that predate this change: if the legacy
 * plaintext AsyncStorage entry exists, import it into the keychain and only
 * then delete the legacy key, so an interrupted migration never loses the
 * session. Returns the legacy value when the secure store is unavailable, so
 * the in-flight session survives and the next launch retries the migration;
 * returns null once migrated (or when there was nothing to migrate).
 */
async function migrateLegacyStorage(): Promise<string | null> {
  let legacy: string | null;
  try {
    legacy = await AsyncStorage.getItem(LEGACY_ASYNC_KEY);
  } catch (err) {
    logError('auth keychainStorage.migrateRead', err);
    return null;
  }
  if (legacy == null) return null;

  try {
    await writeKeychainEntry(legacy);
  } catch (err) {
    // Secure store unavailable: keep the legacy entry (the data was already
    // plaintext before this update — no regression) and surface the session
    // from it until a later launch can complete the migration.
    logError('auth keychainStorage.migrateWrite', err);
    return legacy;
  }

  try {
    await AsyncStorage.removeItem(LEGACY_ASYNC_KEY);
  } catch (err) {
    // Keychain already holds the value; a leftover legacy copy just means the
    // next launch re-imports the same bytes (idempotent) and retries deletion.
    logError('auth keychainStorage.migrateCleanup', err);
  }
  return null;
}

let migrationPromise: Promise<string | null> | null = null;
/** Memoized migration; never rejects — failures are logged, not thrown. */
function ensureMigrated(): Promise<string | null> {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyStorage().catch(err => {
      logError('auth keychainStorage.migrate', err);
      return null;
    });
  }
  return migrationPromise;
}

export const keychainStorage: StateStorage = {
  getItem: async _name => {
    const legacyFallback = await ensureMigrated();
    let creds: false | Keychain.UserCredentials;
    try {
      creds = await Keychain.getGenericPassword({
        service: AUTH_KEYCHAIN_SERVICE,
      });
    } catch (err) {
      logError('auth keychainStorage.read', err);
      return legacyFallback;
    }
    if (!creds) return legacyFallback;
    return creds.password;
  },

  setItem: async (_name, value) => {
    await ensureMigrated();
    // Throws loudly on failure — callers must never write this to plaintext.
    await writeKeychainEntry(value);
  },

  removeItem: async _name => {
    await ensureMigrated();
    try {
      await Keychain.resetGenericPassword({service: AUTH_KEYCHAIN_SERVICE});
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logError('auth keychainStorage.remove', error);
      throw error;
    }
    // Belt and braces: drop any leftover legacy copy too.
    try {
      await AsyncStorage.removeItem(LEGACY_ASYNC_KEY);
    } catch (err) {
      logError('auth keychainStorage.removeLegacy', err);
    }
  },
};
