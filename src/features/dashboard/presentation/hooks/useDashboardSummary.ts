import {useQuery} from '@tanstack/react-query';
import {useEffect, useRef} from 'react';

import {dashboardUseCases} from '@features/dashboard/di';
import type {DashboardSummary} from '@features/dashboard/domain/entities';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';

export const DASHBOARD_SUMMARY_KEY = ['dashboard', 'summary'] as const;

/**
 * React Query hook for the dashboard summary.
 *
 * Tuned for low-end devices / flaky networks:
 * - `staleTime` 60s so navigating back doesn't refire the request.
 * - `gcTime` 5m keeps cached data to render instantly on return (no skeleton).
 * - a single retry avoids hammering the radio on poor connections.
 * Pull-to-refresh uses `refetch`; `isRefetching` drives the spinner.
 * - an income or expense added, synced or refreshed: refetch at once, so the
 *   Today / month cards match Recent activity (they were stale for up to 60s).
 */
export function useDashboardSummary() {
  const query = useQuery<DashboardSummary, Error>({
    queryKey: DASHBOARD_SUMMARY_KEY,
    queryFn: ({signal}) => dashboardUseCases.getSummary(signal),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  const incomes = useIncomeStore(state => state.entries);
  const expenses = useExpenseStore(state => state.entries);
  const first = useRef(true);
  const {refetch} = query;
  useEffect(() => {
    if (first.current) {
      first.current = false; // the query's own first fetch covers mount
      return;
    }
    void refetch();
  }, [incomes, expenses, refetch]);
  return query;
}
