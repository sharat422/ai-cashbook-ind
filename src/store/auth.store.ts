import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';
import {secureAuthStorage} from '@features/security/data/secureAuthStorage';
import type {BusinessChoice} from '@api/auth.api';
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
 * - `choosing-business`: signed in with more than one business: pick one (AC3).
 * - `pending-business`: authenticated but has no business yet (Create Business).
 * - `authenticated`: fully onboarded (Dashboard).
 */
export type AuthStatus =
  | 'unauthenticated'
  | 'choosing-business'
  | 'pending-business'
  | 'authenticated';

interface AuthState {
  /** Set to false while the persisted store rehydrates from disk. */
  hydrated: boolean;
  token: string | null;
  user: User | null;
  business: Business | null;
  /** AC3: after login, every business this person may open, when there's more than one. */
  businessChoices: BusinessChoice[] | null;
  preferredLanguage: AppLanguage;
  /** Shown on the login screen after the server says the owner removed access. */
  notice: 'accessRevoked' | null;

  // Derived selector kept as a method for ergonomic access in components.
  status: () => AuthStatus;

  // Actions
  setSession: (payload: {token: string; user: User}) => void;
  setBusiness: (business: Business) => void;
  setBusinessChoices: (choices: BusinessChoice[] | null) => void;
  setPreferredLanguage: (language: AppLanguage) => void;
  logout: () => void;
  /** The owner revoked this user's access: sign out now and say why. */
  accessRevoked: () => void;
  _setHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      token: null,
      user: null,
      business: null,
      businessChoices: null,
      preferredLanguage: DEFAULT_APP_LANGUAGE,
      notice: null,

      status: () => {
        const {token, business, businessChoices} = get();
        if (!token) return 'unauthenticated';
        if (!business && (businessChoices?.length ?? 0) > 1) return 'choosing-business';
        if (!business) return 'pending-business';
        return 'authenticated';
      },

      setSession: ({token, user}) => set({token, user, notice: null}),
      setBusiness: business => set({business, businessChoices: null}),
      setBusinessChoices: businessChoices => set({businessChoices}),
      setPreferredLanguage: language => set({preferredLanguage: language}),
      logout: () =>
        set({
          token: null,
          user: null,
          business: null,
          businessChoices: null,
          // The language stays: the next person on this phone most likely reads it too.
        }),
      accessRevoked: () => set({token: null, user: null, business: null, businessChoices: null, notice: 'accessRevoked'}),
      _setHydrated: value => set({hydrated: value}),
    }),
    {
      name: 'auth-storage',
      // Keychain/Keystore-backed, not AsyncStorage — the JWT never touches the
      // plaintext file system. Migrates legacy AsyncStorage sessions on first read.
      storage: createJSONStorage(() => secureAuthStorage),
      // Session is memory-only: every cold start requires a fresh OTP login.
      // Business is re-fetched after login (useSyncBusiness). Only the language
      // preference survives.
      partialize: ({preferredLanguage}) => ({preferredLanguage}),
      // Ignore token/user/business left in storage by older builds.
      merge: (persisted, current) => ({
        ...current,
        preferredLanguage:
          (persisted as Partial<AuthState> | undefined)?.preferredLanguage ??
          current.preferredLanguage,
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
