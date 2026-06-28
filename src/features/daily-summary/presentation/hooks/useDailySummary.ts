import {useQuery} from '@tanstack/react-query';

import {dailySummaryUseCases} from '@features/daily-summary/di';
import type {DailySummary} from '@features/daily-summary/domain/entities';

/** React Query hook for a single day's summary. */
export function useDailySummary(date: string) {
  return useQuery<DailySummary, Error>({
    queryKey: ['daily-summary', date],
    queryFn: () => dailySummaryUseCases.getForDate(date),
    staleTime: 60_000,
    retry: 1,
  });
}
