import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

/**
 * Tracks whether the first-run welcome/intro has been shown. Persisted so the
 * carousel appears only once, ever — not on every launch or after logout.
 */
interface OnboardingState {
  /** False until the flag has rehydrated from disk. */
  hydrated: boolean;
  seen: boolean;
  markSeen: () => void;
  _setHydrated: (value: boolean) => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    set => ({
      hydrated: false,
      seen: false,
      markSeen: () => set({seen: true}),
      _setHydrated: value => set({hydrated: value}),
    }),
    {
      name: 'onboarding',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({seen}) => ({seen}),
      onRehydrateStorage: () => state => state?._setHydrated(true),
    },
  ),
);
