import {NetworkError} from '@api/client';
import type {Insight} from '@features/insights/domain/entities';
import type {InsightsRepository} from '@features/insights/domain/repository';
import {insightsLocal} from './insight.local';
import {insightsRemote} from './insight.remote';

/**
 * Concrete repository. Backend (OpenAI) first; on a network failure it falls
 * back to on-device heuristic insights. A server error is rethrown for the
 * error state.
 */
export const insightsRepository: InsightsRepository = {
  async getInsights(): Promise<Insight[]> {
    try {
      return await insightsRemote.getInsights();
    } catch (err) {
      if (err instanceof NetworkError) return insightsLocal.compute();
      throw err;
    }
  },
};
