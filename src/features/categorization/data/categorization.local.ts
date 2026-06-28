import type {
  AiCategory,
  CategorizationDecision,
} from '@features/categorization/domain/entities';
import {useCategorizationStore} from '@features/categorization/presentation/store/categorization.store';

/**
 * Local data source — wraps the persisted decision store so the repository
 * depends on a plain data API rather than React hooks.
 */
export const categorizationLocal = {
  record(decision: CategorizationDecision): void {
    useCategorizationStore.getState().addDecision(decision);
  },

  correct(id: string, category: AiCategory): void {
    useCategorizationStore.getState().correctDecision(id, category);
  },

  getHistory(): CategorizationDecision[] {
    return useCategorizationStore.getState().decisions;
  },

  clear(): void {
    useCategorizationStore.getState().clearHistory();
  },
};
