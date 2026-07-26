/**
 * Integration test for the dashboard repository's online/offline decision —
 * the logic behind the app's "Showing offline figures from this device" banner.
 *
 *   backend OK        → remote figures (source: 'remote')
 *   NetworkError      → locally-computed figures (source: 'local')
 *   genuine ApiError  → rethrow so the UI shows its error state
 */

jest.mock('@api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));

import {apiRequest, ApiError, NetworkError} from '@api/client';
import {toISODate} from '@utils/date';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {dashboardRepository} from './dashboard.repository';

const mockApi = apiRequest as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useIncomeStore.setState({entries: [], queue: []});
  useExpenseStore.setState({entries: [], queue: []});
});

it('returns remote figures when the backend responds', async () => {
  mockApi.mockResolvedValueOnce({
    today_income: 5000,
    today_expense: 1200,
    cash_balance: 3800,
    month_revenue: 5000,
    month_expense: 1200,
    as_of: '2026-06-17T10:00:00.000Z',
  });

  const summary = await dashboardRepository.getSummary();

  expect(summary.source).toBe('remote');
  expect(summary.todayIncome).toBe(5000);
  expect(summary.cashBalance).toBe(3800);
});

it('falls back to on-device figures on a NetworkError', async () => {
  const today = toISODate(new Date());
  useIncomeStore.setState({
    entries: [
      {id: 'p1', amount: 700, category: 'Sales', date: today, syncStatus: 'pending'},
    ] as any,
  });
  mockApi.mockRejectedValueOnce(new NetworkError('device offline'));

  const summary = await dashboardRepository.getSummary();

  expect(summary.source).toBe('local');
  expect(summary.todayIncome).toBe(700);
  expect(summary.cashBalance).toBe(700);
});

it('rethrows a genuine server error (ApiError) instead of masking it', async () => {
  mockApi.mockRejectedValueOnce(new ApiError('500 internal'));
  await expect(dashboardRepository.getSummary()).rejects.toBeInstanceOf(ApiError);
});
