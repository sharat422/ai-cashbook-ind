import type {CategorizationDecision} from '../entities';
import type {CategorizationRepository} from '../repository';

/** Use case: categorize receipt text (AI with rule-engine fallback). */
export function categorizeExpenseUseCase(repo: CategorizationRepository) {
  return (text: string): Promise<CategorizationDecision> =>
    repo.categorize(text.trim());
}
