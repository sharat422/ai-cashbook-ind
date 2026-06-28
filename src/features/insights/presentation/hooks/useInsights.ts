import {useQuery} from '@tanstack/react-query';

import {insightsUseCases} from '@features/insights/di';
import type {Insight} from '@features/insights/domain/entities';

/** React Query hook for the AI khata insights. */
export function useInsights() {
  return useQuery<Insight[], Error>({
    queryKey: ['khata-insights'],
    queryFn: () => insightsUseCases.getInsights(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
