import type {QueryClient} from '@tanstack/react-query';

import {expenseRemote} from '@features/expense/data/expense.remote';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {incomeRemote} from '@features/income/data/income.remote';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {customerUseCases} from '@features/customers/di';
import {CUSTOMERS_KEY} from '@features/customers/presentation/hooks/useCustomers';
import {dashboardUseCases} from '@features/dashboard/di';
import {DASHBOARD_SUMMARY_KEY} from '@features/dashboard/presentation/hooks/useDashboardSummary';
import type {TKey} from '@/i18n';
import type {RestoreProgress} from './entities';

interface RunRestoreArgs {
  /** Optional — when provided, server-backed screens (customers, dashboard) are
   * pre-warmed so they render instantly and are available offline afterwards. */
  queryClient?: QueryClient;
  onProgress?: (progress: RestoreProgress) => void;
}

/**
 * Pull the account's cloud data down onto this device.
 *
 * The two "critical" steps backfill the device-local income/expense stores —
 * these are the only data the app keeps locally (they drive the dashboard's
 * figures and recent activity), so without this a restored device would look
 * empty until the user re-entered everything. If either fails the whole restore
 * rejects so the UI can show an error and offer a retry.
 *
 * The remaining steps merely warm React Query caches; those screens refetch on
 * their own when opened, so a failure there is non-fatal and never blocks.
 */
export async function runRestore({
  queryClient,
  onProgress,
}: RunRestoreArgs = {}): Promise<void> {
  const steps: Array<{labelKey: TKey; critical: boolean; run: () => Promise<void>}> = [
    {
      labelKey: 'restore.stepIncome',
      critical: true,
      run: async () => {
        const entries = await incomeRemote.list();
        useIncomeStore.getState().restoreEntries(entries);
      },
    },
    {
      labelKey: 'restore.stepExpense',
      critical: true,
      run: async () => {
        const entries = await expenseRemote.list();
        useExpenseStore.getState().restoreEntries(entries);
      },
    },
  ];

  if (queryClient) {
    steps.push(
      {
        labelKey: 'restore.stepCustomers',
        critical: false,
        run: () =>
          queryClient.prefetchInfiniteQuery({
            queryKey: [CUSTOMERS_KEY, 'list', ''],
            queryFn: ({pageParam, signal}) =>
              customerUseCases.list(
                {search: '', cursor: (pageParam as string | null) ?? null, limit: 20},
                signal,
              ),
            initialPageParam: null as string | null,
          }),
      },
      {
        labelKey: 'restore.stepSummary',
        critical: false,
        run: () =>
          queryClient.prefetchQuery({
            queryKey: DASHBOARD_SUMMARY_KEY,
            queryFn: ({signal}) => dashboardUseCases.getSummary(signal),
          }),
      },
    );
  }

  const total = steps.length;
  for (let i = 0; i < total; i++) {
    const step = steps[i];
    onProgress?.({completed: i, total, labelKey: step.labelKey});
    try {
      await step.run();
    } catch (err) {
      // Critical steps abort the restore; best-effort steps are swallowed so a
      // flaky prefetch never strands the user (the screen will refetch later).
      if (step.critical) throw err;
    }
  }
  onProgress?.({completed: total, total, labelKey: 'restore.stepDone'});
}
