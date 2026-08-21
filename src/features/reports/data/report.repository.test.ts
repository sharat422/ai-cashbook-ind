/**
 * Integration test for the reports repository's hybrid online/offline behavior,
 * mirroring the dashboard: backend → remote figures; NetworkError → on-device
 * figures; ApiError → rethrow.
 */

jest.mock('@api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));

import {apiRequest, ApiError, NetworkError} from '@api/client';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {reportRepository} from './report.repository';

const mockApi = apiRequest as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useIncomeStore.setState({entries: [], queue: []});
  useExpenseStore.setState({entries: [], queue: []});
});

it('returns remote figures when the backend responds', async () => {
  mockApi.mockResolvedValueOnce({
    from: '2026-06-01',
    to: '2026-06-30',
    income_total: 7000,
    expense_total: 2000,
    profit: 5000,
    income_count: 2,
    expense_count: 2,
    income_by_category: [{category: 'Sales', amount: 7000, share: 1}],
    expense_by_category: [{category: 'Fuel', amount: 2000, share: 1}],
  });

  const r = await reportRepository.getSummary('2026-06-01', '2026-06-30');
  expect(r.source).toBe('remote');
  expect(r.profit).toBe(5000);
  expect(r.expenseByCategory[0].category).toBe('Fuel');
});

it('falls back to on-device figures on a NetworkError', async () => {
  useIncomeStore.setState({
    entries: [
      {id: 'i1', amount: 1000, category: 'Sales', date: '2026-06-10', syncStatus: 'synced'},
    ] as any,
  });
  useExpenseStore.setState({
    entries: [
      {id: 'e1', amount: 400, category: 'Fuel', date: '2026-06-11', syncStatus: 'synced'},
    ] as any,
  });
  mockApi.mockRejectedValueOnce(new NetworkError('offline'));

  const r = await reportRepository.getSummary('2026-06-01', '2026-06-30');
  expect(r.source).toBe('local');
  expect(r.incomeTotal).toBe(1000);
  expect(r.expenseTotal).toBe(400);
  expect(r.profit).toBe(600);
});

it('rethrows a genuine server error (ApiError)', async () => {
  mockApi.mockRejectedValueOnce(new ApiError('500'));
  await expect(
    reportRepository.getSummary('2026-06-01', '2026-06-30'),
  ).rejects.toBeInstanceOf(ApiError);
});
