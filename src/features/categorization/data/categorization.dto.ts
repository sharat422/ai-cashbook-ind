import {
  toAiCategory,
  type CategorizationResult,
} from '@features/categorization/domain/entities';

/** Backend response — the requested `{category, confidence}` shape. */
export interface CategorizationDto {
  category: string;
  confidence: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, Number(n) || 0));

/** Map the GPT-backed response into a domain result (source = 'ai'). */
export function toCategorizationResult(
  dto: CategorizationDto,
): CategorizationResult {
  return {
    category: toAiCategory(dto.category),
    confidence: clamp01(dto.confidence),
    source: 'ai',
  };
}
