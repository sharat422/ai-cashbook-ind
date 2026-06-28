import {apiRequest} from '@api/client';
import type {CategorizationResult} from '@features/categorization/domain/entities';
import {toCategorizationResult, type CategorizationDto} from './categorization.dto';

/**
 * Remote data source — calls the FastAPI backend, which runs OpenAI GPT to
 * classify the receipt text.
 *
 *   POST /api/v1/categorize  { "text": "..." }
 *     200 -> { "category": "Fuel", "confidence": 0.93 }
 */
export const categorizationRemote = {
  async categorize(text: string): Promise<CategorizationResult> {
    const dto = await apiRequest<CategorizationDto>('/categorize', {
      method: 'POST',
      body: {text},
    });
    return toCategorizationResult(dto);
  },
};
