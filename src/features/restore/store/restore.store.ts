import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

export type RestoreDecision = 'restored' | 'skipped';

interface RestoreState {
  /** False until the persisted decisions have rehydrated from disk. */
  hydrated: boolean;
  /**
   * Per-business record of whether the restore step has been handled, so we
   * offer it exactly once per account on this device (a fresh install has an
   * empty map → the offer shows; after restoring/skipping it won't nag).
   * Keyed by business id.
   */
  decided: Record<string, RestoreDecision>;

  /** Whether the restore step still needs to be offered for this business. */
  needsDecision: (businessId: string | null | undefined) => boolean;
  markDecided: (businessId: string, decision: RestoreDecision) => void;
  /** Let the user re-run restore later (e.g. from Settings). */
  reset: (businessId: string) => void;
  _setHydrated: (value: boolean) => void;
}

export const useRestoreStore = create<RestoreState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      decided: {},

      needsDecision: businessId => {
        if (!businessId) return false; // no business yet → nothing to restore
        return get().decided[businessId] === undefined;
      },

      markDecided: (businessId, decision) =>
        set(state => ({decided: {...state.decided, [businessId]: decision}})),

      reset: businessId =>
        set(state => {
          const next = {...state.decided};
          delete next[businessId];
          return {decided: next};
        }),

      _setHydrated: value => set({hydrated: value}),
    }),
    {
      name: 'restore-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({decided}) => ({decided}),
      onRehydrateStorage: () => state => state?._setHydrated(true),
    },
  ),
);
