import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {generateSalt, hashPin} from '@features/security/domain/pinHash';

/** Digits in the app-lock PIN. */
export const PIN_LENGTH = 4;

interface AppLockState {
  /** False until the persisted lock config has rehydrated from disk. */
  hydrated: boolean;
  /** Whether the app-lock is turned on. */
  enabled: boolean;
  pinHash: string | null;
  salt: string | null;
  /** Runtime-only (never persisted): is the app currently locked? */
  locked: boolean;

  /** Turn the lock on with a new PIN (also unlocks the current session). */
  setPin: (pin: string) => void;
  /** Turn the lock off and forget the PIN. */
  disableLock: () => void;
  /** Check a PIN; unlocks on success. */
  verifyPin: (pin: string) => boolean;
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
      pinHash: null,
      salt: null,
      locked: false,

      setPin: pin => {
        const salt = generateSalt();
        set({enabled: true, salt, pinHash: hashPin(pin, salt), locked: false});
      },

      disableLock: () =>
        set({enabled: false, pinHash: null, salt: null, locked: false}),

      verifyPin: pin => {
        const {salt, pinHash} = get();
        if (!salt || !pinHash) return false;
        const ok = hashPin(pin, salt) === pinHash;
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
      // Never persist the transient `locked`/`hydrated` flags.
      partialize: ({enabled, pinHash, salt}) => ({enabled, pinHash, salt}),
      onRehydrateStorage: () => state => {
        if (!state) return;
        state._setHydrated(true);
        // Start locked whenever a lock is configured.
        if (state.enabled) state.lock();
      },
    },
  ),
);

/** Convenience hooks. */
export const useIsLockActive = (): boolean =>
  useAppLockStore(s => s.hydrated && s.enabled && s.locked);
