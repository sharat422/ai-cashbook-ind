import {apiRequest} from '@api/client';
import type {DailySummary} from '@features/daily-summary/domain/entities';
import {toDailySummary, type DailySummaryDto} from './dailySummary.dto';

/**
 * Remote data source.
 *
 *   GET /api/v1/summary/daily?date=YYYY-MM-DD -> DailySummaryDto
 */
export const dailySummaryRemote = {
  async getForDate(date: string): Promise<DailySummary> {
    const dto = await apiRequest<DailySummaryDto>(
      `/summary/daily?date=${encodeURIComponent(date)}`,
      {method: 'GET'},
    );
    return toDailySummary(dto);
  },
};
