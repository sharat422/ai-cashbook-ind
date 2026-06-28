import {apiRequest} from '@api/client';
import type {Insight} from '@features/insights/domain/entities';
import {toInsight, type InsightDto} from './insight.dto';

/**
 * Remote data source — the backend analyzes the khata data with OpenAI GPT and
 * returns structured insights.
 *
 *   GET /api/v1/khata/insights -> { insights: InsightDto[] }
 */
export const insightsRemote = {
  async getInsights(): Promise<Insight[]> {
    const res = await apiRequest<{insights: InsightDto[]}>('/khata/insights', {
      method: 'GET',
    });
    return (res.insights ?? []).map(toInsight);
  },
};
