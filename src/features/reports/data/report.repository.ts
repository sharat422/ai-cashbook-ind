import {NetworkError} from '@api/client';
import type {ReportSummary} from '@features/reports/domain/entities';
import {reportLocal} from './report.local';
import {reportRemote} from './report.remote';

/**
 * Tries the backend first; on a NetworkError (offline/timeout) falls back to
 * figures computed on-device. A real server error (ApiError) is rethrown so the
 * UI can show its error state. Mirrors the dashboard repository.
 */
export const reportRepository = {
  async getSummary(from: string, to: string): Promise<ReportSummary> {
    try {
      return await reportRemote.getSummary(from, to);
    } catch (err) {
      if (err instanceof NetworkError) {
        return reportLocal.computeSummary(from, to);
      }
      throw err;
    }
  },
};
