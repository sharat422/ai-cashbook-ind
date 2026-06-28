import {useQuery} from '@tanstack/react-query';

import {khataUseCases} from '@features/khata/di';
import type {
  KhataFilters,
  KhataSummary,
} from '@features/khata/domain/entities';

/** React Query hook for the khata summary, re-fetched when filters change. */
export function useKhataSummary(filters: KhataFilters) {
  return useQuery<KhataSummary, Error>({
    queryKey: ['khata-summary', filters],
    queryFn: () => khataUseCases.getSummary(filters),
    staleTime: 60_000,
    retry: 1,
  });
}
