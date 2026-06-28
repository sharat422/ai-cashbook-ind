/**
 * Domain entities for the AI Expense Categorization service. Pure types — no
 * framework imports.
 */

/** The categories this service classifies receipt text into. */
export const AI_CATEGORIES = [
  'Rent',
  'Salary',
  'Food',
  'Travel',
  'Fuel',
  'Inventory',
  'Utilities',
  'Marketing',
  'Miscellaneous',
] as const;

export type AiCategory = (typeof AI_CATEGORIES)[number];

/** Whether a result came from the GPT model or the local fallback rule engine. */
export type CategorizationSource = 'ai' | 'rule';

/** The core service output: a category and a confidence in [0, 1]. */
export interface CategorizationResult {
  category: AiCategory;
  confidence: number;
  source: CategorizationSource;
}

/**
 * A persisted record of one decision — the stored signal used for "future
 * learning". `userCorrectedCategory` captures the human correction when the
 * model/rule got it wrong.
 */
export interface CategorizationDecision {
  id: string;
  /** The receipt text that was categorized (trimmed for storage). */
  text: string;
  result: CategorizationResult;
  userCorrectedCategory?: AiCategory | null;
  createdAt: string;
}

/** Coerce an arbitrary string to a known category, defaulting to Miscellaneous. */
export function toAiCategory(value: string | null | undefined): AiCategory {
  const match = AI_CATEGORIES.find(
    c => c.toLowerCase() === (value ?? '').trim().toLowerCase(),
  );
  return match ?? 'Miscellaneous';
}
