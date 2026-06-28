import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import type {
  AiCategory,
  CategorizationDecision,
} from '@features/categorization/domain/entities';

/** Keep the learning log bounded so storage doesn't grow without limit. */
const MAX_DECISIONS = 100;

interface CategorizationState {
  hydrated: boolean;
  /** Stored decisions, newest first — the "future learning" dataset. */
  decisions: CategorizationDecision[];

  addDecision: (decision: CategorizationDecision) => void;
  correctDecision: (id: string, category: AiCategory) => void;
  clearHistory: () => void;
  _setHydrated: (value: boolean) => void;
}

/**
 * Persisted store of AI/rule categorization decisions and user corrections.
 * Survives restarts so corrections can later be exported to retrain/seed the
 * model or tune the rule engine.
 */
export const useCategorizationStore = create<CategorizationState>()(
  persist(
    set => ({
      hydrated: false,
      decisions: [],

      addDecision: decision =>
        set(state => ({
          decisions: [decision, ...state.decisions].slice(0, MAX_DECISIONS),
        })),

      correctDecision: (id, category) =>
        set(state => ({
          decisions: state.decisions.map(d =>
            d.id === id ? {...d, userCorrectedCategory: category} : d,
          ),
        })),

      clearHistory: () => set({decisions: []}),
      _setHydrated: value => set({hydrated: value}),
    }),
    {
      name: 'categorization-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({decisions}) => ({decisions}),
      onRehydrateStorage: () => state => state?._setHydrated(true),
    },
  ),
);
