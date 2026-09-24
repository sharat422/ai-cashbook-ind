import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import type {StateStorage} from 'zustand/middleware';

/**
 * Keychain/Keystore-backed persistence for the auth session (JWT + profile).
 *
 * The session used to live in plaintext AsyncStorage, which is readable on a
 * rooted/jailbroken device's file system — an unacceptable exposure for a
 * bearer token that grants full account access. This adapter moves the blob
 * into the iOS **Keychain** / Android **Keystore** (hardware-backed where
 * available) via react-native-keychain, exposing the tiny `StateStorage`
 * surface (getItem/setItem/removeItem) that zustand's `persist` needs.
 *
 * The whole persisted JSON string is stored as a single generic-password
 * item under one service. `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps it off
 * device backups and iCloud, and inaccessible while the device is locked.
 *
 * Migration: the first read transparently imports any legacy AsyncStorage
 * value and deletes the plaintext copy, so existing users are NOT logged out
 * when they update to this build.
 */

const AUTH_SERVICE = 'smartcashbook.auth';
// The zustand persist key; also the legacy AsyncStorage key we migrate from.
const LEGACY_KEY = 'auth-storage';
const KEYCHAIN_USERNAME = 'session';

async function migrateFromAsyncStorage(): Promise<string | null> {
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacy == null) return null;
    // Move it into the secure store, then remove the plaintext original.
    await Keychain.setGenericPassword(KEYCHAIN_USERNAME, legacy, {
      service: AUTH_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await AsyncStorage.removeItem(LEGACY_KEY);
    return legacy;
  } catch {
    // A migration hiccup must not brick startup — treat as "no session".
    return null;
  }
}

export const secureAuthStorage: StateStorage = {
  async getItem(_name: string): Promise<string | null> {
    try {
      const creds = await Keychain.getGenericPassword({service: AUTH_SERVICE});
      if (creds) return creds.password;
      // Nothing in the Keychain yet — attempt a one-time legacy migration.
      return await migrateFromAsyncStorage();
    } catch {
      return null;
    }
  },

  async setItem(_name: string, value: string): Promise<void> {
    try {
      await Keychain.setGenericPassword(KEYCHAIN_USERNAME, value, {
        service: AUTH_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {
      // Persisting the session is best-effort; the in-memory store still works
      // for the current run even if the secure write fails.
    }
  },

  async removeItem(_name: string): Promise<void> {
    try {
      await Keychain.resetGenericPassword({service: AUTH_SERVICE});
    } catch {
      // ignore — logout clears in-memory state regardless.
    }
  },
};
