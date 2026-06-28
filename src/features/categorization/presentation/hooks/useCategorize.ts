import {useMutation} from '@tanstack/react-query';
import {useCallback} from 'react';

import {categorizationUseCases} from '@features/categorization/di';
import type {
  AiCategory,
  CategorizationDecision,
} from '@features/categorization/domain/entities';
import {useCategorizationStore} from '@features/categorization/presentation/store/categorization.store';

/**
 * Categorize receipt text (AI with rule-engine fallback) and expose the
 * persisted decision log. Recording a correction updates the same decision
 * record in the store — the signal kept for future learning.
 */
export function useCategorize() {
  const decisions = useCategorizationStore(state => state.decisions);

  const mutation = useMutation<CategorizationDecision, Error, string>({
    mutationFn: text => categorizationUseCases.categorize(text),
  });

  const correct = useCallback((decisionId: string, category: AiCategory) => {
    categorizationUseCases.correct(decisionId, category);
  }, []);

  const clearHistory = useCallback(() => {
    categorizationUseCases.clearHistory();
  }, []);

  return {
    categorize: mutation.mutate,
    decision: mutation.data,
    isCategorizing: mutation.isPending,
    reset: mutation.reset,
    correct,
    decisions,
    clearHistory,
  };
}
