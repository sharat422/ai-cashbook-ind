import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';
import {secureAuthStorage} from '@features/security/data/secureAuthStorage';
import type {Business, User} from '@features/auth/types';
import {
  DEFAULT_APP_LANGUAGE,
  type AppLanguage,
} from '@features/auth/utils/languagePreference';

/**
 * Where the user is in the authentication lifecycle. Drives which navigator
 * stack is shown by RootNavigator.
 *
 * - `unauthenticated`: needs to log in (Login → OTP).
 * - `pending-business`: authenticated but has no business yet (Create Business).
 * - `authenticated`: fully onboarded (Dashboard).
 */
export type AuthStatus =
  | 'unauthenticated'
  | 'pending-business'
  | 'authenticated';

interface AuthState {
  /** Set to false while the persisted store rehydrates from disk. */
  hydrated: boolean;
  token: string | null;
  user: User | null;
  business: Business | null;
  preferredLanguage: AppLanguage;

  // Derived selector kept as a method for ergonomic access in components.
  status: () => AuthStatus;

  // Actions
  setSession: (payload: {token: string; user: User}) => void;
  setBusiness: (business: Business) => void;
  setPreferredLanguage: (language: AppLanguage) => void;
  logout: () => void;
  _setHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      token: null,
      user: null,
      business: null,
      preferredLanguage: DEFAULT_APP_LANGUAGE,

      status: () => {
        const {token, business} = get();
        if (!token) return 'unauthenticated';
        if (!business) return 'pending-business';
        return 'authenticated';
      },

      setSession: ({token, user}) => set({token, user}),
      setBusiness: business => set({business}),
      setPreferredLanguage: language => set({preferredLanguage: language}),
      logout: () =>
        set({
          token: null,
          user: null,
          business: null,
          preferredLanguage: DEFAULT_APP_LANGUAGE,
        }),
      _setHydrated: value => set({hydrated: value}),
    }),
    {
      name: 'auth-storage',
      // Keychain/Keystore-backed, not AsyncStorage — the JWT never touches the
      // plaintext file system. Migrates legacy AsyncStorage sessions on first read.
      storage: createJSONStorage(() => secureAuthStorage),
      // Only persist durable session data, never the hydration flag.
      partialize: ({token, user, business, preferredLanguage}) => ({
        token,
        user,
        business,
        preferredLanguage,
      }),
      onRehydrateStorage: () => state => {
        state?._setHydrated(true);
      },
    },
  ),
);

/** Convenience hooks to avoid re-rendering on unrelated store changes. */
export const useAuthStatus = (): AuthStatus =>
  useAuthStore(state => state.status());
export const useIsHydrated = (): boolean =>
  useAuthStore(state => state.hydrated);
