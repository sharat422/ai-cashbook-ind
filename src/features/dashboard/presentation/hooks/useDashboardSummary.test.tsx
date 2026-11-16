/**
 * Adding an expense refreshes the Today / month cards at once (they used to
 * stay stale for up to a minute while Recent activity already showed it).
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useDashboardSummary} from './useDashboardSummary';

const mockGetSummary = jest.fn();
jest.mock('@features/dashboard/di', () => ({
  dashboardUseCases: {getSummary: () => mockGetSummary()},
}));

function Probe(): null {
  useDashboardSummary();
  return null;
}

test('a new entry in the store refetches the summary', async () => {
  mockGetSummary.mockResolvedValue({todayIncome: 0, todayExpense: 0, cashBalance: 0,
    monthRevenue: 0, monthExpense: 0, asOf: 'x', source: 'remote'});
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  });
  expect(mockGetSummary).toHaveBeenCalledTimes(1);

  await act(async () => {
    useExpenseStore.setState({entries: [{id: 'e1', amount: 11000, category: 'Rent', date: '2026-11-16',
      createdAt: 'x', syncStatus: 'synced'}] as never});
  });
  expect(mockGetSummary).toHaveBeenCalledTimes(2);
  act(() => r.unmount());
  client.clear();
});
