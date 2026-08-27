import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {generateSalt, hashPin} from '@features/security/domain/pinHash';
import {
  authenticateBiometric,
  clearAppLockSecret,
  enrollBiometric,
  getSupportedBiometry,
  readAppLockSecret,
  saveAppLockSecret,
  unenrollBiometric,
} from '@features/security/data/secureStore';

/** Digits in the app-lock PIN. */
export const PIN_LENGTH = 4;

interface AppLockState {
  /** False until the persisted lock config has rehydrated from disk. */
  hydrated: boolean;
  /** Whether the app-lock is turned on. */
  enabled: boolean;
  /** Whether biometric (fingerprint/Face ID) unlock is enrolled. */
  biometricEnabled: boolean;
  /** Runtime-only (never persisted): is the app currently locked? */
  locked: boolean;

  /** Turn the lock on with a new PIN (also unlocks the current session). */
  setPin: (pin: string) => Promise<void>;
  /** Turn the lock off and forget the PIN + biometric enrolment. */
  disableLock: () => Promise<void>;
  /** Check a PIN; unlocks on success. */
  verifyPin: (pin: string) => Promise<boolean>;
  /** Enrol biometric unlock; resolves false if the device can't do it. */
  enableBiometric: () => Promise<boolean>;
  disableBiometric: () => Promise<void>;
  /** Attempt biometric unlock; resolves true only on OS auth success. */
  unlockWithBiometrics: () => Promise<boolean>;
  /** Lock now (no-op when the lock is disabled). */
  lock: () => void;
  unlock: () => void;
  _setHydrated: (value: boolean) => void;
}

export const useAppLockStore = create<AppLockState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      enabled: false,
      biometricEnabled: false,
      locked: false,

      setPin: async pin => {
        const salt = generateSalt();
        await saveAppLockSecret({salt, pinHash: hashPin(pin, salt)});
        set({enabled: true, locked: false});
      },

      disableLock: async () => {
        await clearAppLockSecret();
        set({enabled: false, biometricEnabled: false, locked: false});
      },

      verifyPin: async pin => {
        const secret = await readAppLockSecret();
        if (!secret) return false;
        const ok = hashPin(pin, secret.salt) === secret.pinHash;
        if (ok) set({locked: false});
        return ok;
      },

      enableBiometric: async () => {
        const ok = await enrollBiometric();
        if (ok) set({biometricEnabled: true});
        return ok;
      },

      disableBiometric: async () => {
        await unenrollBiometric();
        set({biometricEnabled: false});
      },

      unlockWithBiometrics: async () => {
        if (!get().biometricEnabled) return false;
        const ok = await authenticateBiometric('Unlock Smart CashBook');
        if (ok) set({locked: false});
        return ok;
      },

      lock: () => {
        if (get().enabled) set({locked: true});
      },
      unlock: () => set({locked: false}),
      _setHydrated: value => set({hydrated: value}),
    }),
    {
      name: 'app-lock-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // The PIN secret now lives in the Keystore/Keychain, never AsyncStorage —
      // only these non-sensitive flags are persisted here.
      partialize: ({enabled, biometricEnabled}) => ({enabled, biometricEnabled}),
      onRehydrateStorage: () => state => {
        if (!state) return;
        void migrateLegacyPin(state);
        state._setHydrated(true);
        // Start locked whenever a lock is configured.
        if (state.enabled) state.lock();
      },
    },
  ),
);

/**
 * One-time migration: earlier builds stored the PIN hash + salt directly in
 * AsyncStorage. Move any such secret into the secure store on first launch of
 * this version, then drop the plaintext copy so it can't linger on disk.
 */
async function migrateLegacyPin(state: AppLockState): Promise<void> {
  const legacy = state as unknown as {pinHash?: string; salt?: string};
  if (!state.enabled || !legacy.pinHash || !legacy.salt) return;
  try {
    // Only seed the secure store if it doesn't already hold the secret.
    if (!(await readAppLockSecret())) {
      await saveAppLockSecret({salt: legacy.salt, pinHash: legacy.pinHash});
    }
  } finally {
    // Overwrite the persisted blob (partialize excludes the legacy fields).
    useAppLockStore.setState({enabled: state.enabled});
  }
}

/** Convenience hooks. */
export const useIsLockActive = (): boolean =>
  useAppLockStore(s => s.hydrated && s.enabled && s.locked);

/** null when unsupported, else the biometry type — for the Settings toggle. */
export {getSupportedBiometry};
