import type {AiCategory, CategorizationDecision} from './entities';

/**
 * Repository contract. The data layer calls the GPT backend, falls back to the
 * rule engine on failure, and records every decision for future learning.
 */
export interface CategorizationRepository {
  /** Categorize receipt text and persist the decision; returns the record. */
  categorize(text: string): Promise<CategorizationDecision>;

  /** Store a human correction against a decision (the learning signal). */
  correct(decisionId: string, category: AiCategory): void;

  /** Past decisions, newest first. */
  getHistory(): CategorizationDecision[];

  /** Clear the stored learning log. */
  clearHistory(): void;
}
