import {useQuery} from '@tanstack/react-query';

import {reportRepository} from '@features/reports/data/report.repository';

/** Fetches the P&L + category report for a date range (hybrid remote/local). */
export function useReportSummary(from: string, to: string) {
  return useQuery({
    queryKey: ['report-summary', from, to],
    queryFn: () => reportRepository.getSummary(from, to),
  });
}
