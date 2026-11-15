/**
 * Expenses save like incomes: online → straight to the server (synced at once,
 * nothing queued); offline, weak signal or a blip mid-request → queued and
 * shown as waiting to sync, never lost. (They used to always queue first, so
 * an expense could sit "waiting to sync" while an income saved at once.)
 */
jest.mock('@api/client', () => {
  class NetworkError extends Error {}
  return {
    apiRequest: jest.fn(),
    ApiError: class ApiError extends Error {},
    NetworkError,
    WeakSignalError: class WeakSignalError extends NetworkError {},
  };
});

import {apiRequest, NetworkError} from '@api/client';
import NetInfo from '@react-native-community/netinfo';
import {expenseUseCases} from '@features/expense/di';
import type {ExpenseDraft} from '@features/expense/domain/entities';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {probeServer} from '@/services/network/probe';

const mockApi = apiRequest as jest.Mock;
const mockNetFetch = (NetInfo as unknown as {fetch: jest.Mock}).fetch;
const mockProbe = probeServer as jest.Mock;

const draft: ExpenseDraft = {amount: 800, category: 'Fuel', vendor: 'Indian Oil', date: '2026-11-15'};
const serverDto = {id: 'srv-e1', amount: 800, category: 'Fuel', vendor: 'Indian Oil', date: '2026-11-15',
  notes: null, attachment_url: null, created_at: '2026-11-15T10:00:00.000Z'};

const setOnline = (online: boolean) =>
  mockNetFetch.mockResolvedValue({isConnected: online, isInternetReachable: online});

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe.mockResolvedValue(true);
  useExpenseStore.setState({entries: [], queue: [], isSyncing: false, lastSyncedAt: null});
});

test('online: saved on the server at once, nothing queued', async () => {
  setOnline(true);
  mockApi.mockResolvedValueOnce(serverDto);
  const expense = await expenseUseCases.create(draft);
  expect(expense.syncStatus).toBe('synced');
  expect(expense.id).toBe('srv-e1');
  expect(useExpenseStore.getState().queue).toEqual([]);
  expect(useExpenseStore.getState().entries.map(e => e.syncStatus)).toEqual(['synced']);
});

test('offline: queued and shown as waiting to sync; then syncs once', async () => {
  setOnline(false);
  const expense = await expenseUseCases.create(draft);
  expect(expense.syncStatus).toBe('pending');
  expect(mockApi).not.toHaveBeenCalled();
  expect(useExpenseStore.getState().queue).toHaveLength(1);

  setOnline(true);
  mockApi.mockResolvedValueOnce(serverDto);
  await expenseUseCases.syncPending();
  expect(useExpenseStore.getState().queue).toEqual([]);
  expect(useExpenseStore.getState().entries.map(e => e.syncStatus)).toEqual(['synced']);
});

test('weak signal: queued at once and marked as weak signal', async () => {
  setOnline(true);
  mockProbe.mockResolvedValueOnce(false);
  const expense = await expenseUseCases.create(draft);
  expect(expense.syncStatus).toBe('pending');
  expect(mockApi).not.toHaveBeenCalled();
  expect(useExpenseStore.getState().queue[0].weakSignal).toBe(true);
});

test('the connection drops mid-request: queued, not lost', async () => {
  setOnline(true);
  mockApi.mockRejectedValueOnce(new NetworkError('dropped'));
  const expense = await expenseUseCases.create(draft);
  expect(expense.syncStatus).toBe('pending');
  expect(useExpenseStore.getState().queue).toHaveLength(1);
  expect(useExpenseStore.getState().queue[0].weakSignal).toBeUndefined();
});
