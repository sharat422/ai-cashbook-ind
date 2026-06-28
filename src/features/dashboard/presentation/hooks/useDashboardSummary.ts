import {useQuery} from '@tanstack/react-query';

import {dashboardUseCases} from '@features/dashboard/di';
import type {DashboardSummary} from '@features/dashboard/domain/entities';

export const DASHBOARD_SUMMARY_KEY = ['dashboard', 'summary'] as const;

/**
 * React Query hook for the dashboard summary.
 *
 * Tuned for low-end devices / flaky networks:
 * - `staleTime` 60s so navigating back doesn't refire the request.
 * - `gcTime` 5m keeps cached data to render instantly on return (no skeleton).
 * - a single retry avoids hammering the radio on poor connections.
 * Pull-to-refresh uses `refetch`; `isRefetching` drives the spinner.
 */
export function useDashboardSummary() {
  return useQuery<DashboardSummary, Error>({
    queryKey: DASHBOARD_SUMMARY_KEY,
    queryFn: ({signal}) => dashboardUseCases.getSummary(signal),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
