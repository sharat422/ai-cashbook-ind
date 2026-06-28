import type {
  AiCategory,
  CategorizationDecision,
  CategorizationResult,
} from '@features/categorization/domain/entities';
import type {CategorizationRepository} from '@features/categorization/domain/repository';
import {categorizeByRules} from '@features/categorization/domain/ruleEngine';
import {categorizationLocal} from './categorization.local';
import {categorizationRemote} from './categorization.remote';

function makeId(): string {
  return `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Concrete repository.
 *
 * - Primary: the GPT-backed remote categorizer.
 * - Fallback: the local keyword rule engine, used whenever the backend fails
 *   (offline, timeout, or error) so the service always returns a result.
 *
 * Every decision is recorded to the persisted store for future learning.
 */
export const categorizationRepository: CategorizationRepository = {
  async categorize(text: string): Promise<CategorizationDecision> {
    let result: CategorizationResult;
    try {
      result = await categorizationRemote.categorize(text);
    } catch {
      // Backend unavailable → deterministic offline fallback.
      result = categorizeByRules(text);
    }

    const decision: CategorizationDecision = {
      id: makeId(),
      text: text.slice(0, 500),
      result,
      userCorrectedCategory: null,
      createdAt: new Date().toISOString(),
    };
    categorizationLocal.record(decision);
    return decision;
  },

  correct(decisionId: string, category: AiCategory): void {
    categorizationLocal.correct(decisionId, category);
  },

  getHistory(): CategorizationDecision[] {
    return categorizationLocal.getHistory();
  },

  clearHistory(): void {
    categorizationLocal.clear();
  },
};
