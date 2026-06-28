import {apiRequest} from '@api/client';
import type {DashboardSummary} from '@features/dashboard/domain/entities';
import {toDashboardSummary, type DashboardSummaryDto} from './dashboard.dto';

/**
 * Remote data source — talks to the FastAPI backend.
 *
 *   GET /api/v1/dashboard/summary -> DashboardSummaryDto
 *
 * The client applies its own request timeout, so the external abort signal is
 * accepted for interface parity but not required for cancellation here.
 */
export const dashboardRemote = {
  async getSummary(): Promise<DashboardSummary> {
    const dto = await apiRequest<DashboardSummaryDto>('/dashboard/summary', {
      method: 'GET',
    });
    return toDashboardSummary(dto);
  },
};
