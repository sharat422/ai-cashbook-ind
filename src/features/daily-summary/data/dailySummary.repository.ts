import {NetworkError} from '@api/client';
import type {DailySummary} from '@features/daily-summary/domain/entities';
import type {DailySummaryRepository} from '@features/daily-summary/domain/repository';
import {dailySummaryLocal} from './dailySummary.local';
import {dailySummaryRemote} from './dailySummary.remote';

/**
 * Concrete repository. Prefers the backend; on a network failure (offline /
 * timeout) it computes the summary locally. A server/HTTP error is rethrown so
 * the UI can show its error state.
 */
export const dailySummaryRepository: DailySummaryRepository = {
  async getForDate(date: string): Promise<DailySummary> {
    try {
      return await dailySummaryRemote.getForDate(date);
    } catch (err) {
      if (err instanceof NetworkError) {
        return dailySummaryLocal.computeForDate(date);
      }
      throw err;
    }
  },
};
