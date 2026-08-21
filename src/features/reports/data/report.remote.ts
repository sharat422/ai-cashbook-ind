import {apiRequest} from '@api/client';
import type {ReportSummary} from '@features/reports/domain/entities';
import {toReportSummary, type ReportSummaryDto} from './report.dto';

/**
 * Remote data source.
 *
 *   GET /api/v1/reports/summary?from&to -> ReportSummaryDto
 */
export const reportRemote = {
  async getSummary(from: string, to: string): Promise<ReportSummary> {
    const params = new URLSearchParams({from, to});
    const dto = await apiRequest<ReportSummaryDto>(
      `/reports/summary?${params.toString()}`,
      {method: 'GET'},
    );
    return toReportSummary(dto);
  },
};
