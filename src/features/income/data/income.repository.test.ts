/**
 * End-to-end integration test of the offline-first income flow, driven through
 * the real use case → repository → Zustand store, with only the true
 * boundaries mocked: the network (@api/client) and connectivity (NetInfo).
 *
 * This is the app's flagship behaviour: an entry is never lost, whether the
 * device is online, offline, or the connection blips mid-request; and the
 * queued drafts sync (idempotently) once connectivity returns.
 */

// --- Boundary mocks (hoisted by Jest) ---------------------------------------
jest.mock('@api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));

import {apiRequest} from '@api/client';
import NetInfo from '@react-native-community/netinfo';
import type {IncomeDraft} from '@features/income/domain/entities';
import {incomeUseCases} from '@features/income/di';
import {incomeRepository} from '@features/income/data/income.repository';
import {useIncomeStore} from '@features/income/presentation/store/income.store';

const mockApi = apiRequest as jest.Mock;
const mockNetFetch = (NetInfo as unknown as {fetch: jest.Mock}).fetch;

const draft: IncomeDraft = {amount: 5000, category: 'Sales', date: '2026-06-17'};

/** A backend IncomeDto as the server would return it. */
const serverDto = (id = 'srv-1') => ({
  id,
  amount: 5000,
  category: 'Sales',
  date: '2026-06-17',
  notes: null,
  attachment_url: null,
  created_at: '2026-06-17T10:00:00.000Z',
});

function setOnline(online: boolean) {
  mockNetFetch.mockResolvedValue({
    isConnected: online,
    isInternetReachable: online,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useIncomeStore.setState({
    entries: [],
    queue: [],
    isSyncing: false,
    lastSyncedAt: null,
  });
});

describe('createIncome — online', () => {
  it('posts to the backend and stores a synced entry (no queue)', async () => {
    setOnline(true);
    mockApi.mockResolvedValueOnce(serverDto());

    const income = await incomeUseCases.create(draft);

    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(income.id).toBe('srv-1');
    expect(income.syncStatus).toBe('synced');
    expect(useIncomeStore.getState().entries).toHaveLength(1);
    expect(useIncomeStore.getState().queue).toHaveLength(0);
  });
});

describe('createIncome — offline', () => {
  it('queues the draft and shows an optimistic pending entry', async () => {
    setOnline(false);

    const income = await incomeUseCases.create(draft);

    expect(mockApi).not.toHaveBeenCalled();
    expect(income.syncStatus).toBe('pending');
    const state = useIncomeStore.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.queue).toHaveLength(1);
    // The optimistic entry and its queue item share the client id (for dedupe).
    expect(state.entries[0].id).toBe(state.queue[0].localId);
  });
});

describe('createIncome — online but the request blips', () => {
  it('falls back to the offline queue so the entry is never lost', async () => {
    setOnline(true);
    mockApi.mockRejectedValueOnce(new Error('socket hang up'));

    const income = await incomeUseCases.create(draft);

    expect(income.syncStatus).toBe('pending');
    expect(useIncomeStore.getState().queue).toHaveLength(1);
  });
});

describe('createIncome — validation', () => {
  it('throws with field errors and never touches the network or queue', async () => {
    setOnline(true);
    await expect(
      incomeUseCases.create({...draft, amount: -1}),
    ).rejects.toMatchObject({fields: {amount: expect.any(String)}});
    expect(mockApi).not.toHaveBeenCalled();
    expect(useIncomeStore.getState().queue).toHaveLength(0);
  });
});

describe('syncPending', () => {
  it('flushes the queue when back online: swaps optimistic → synced', async () => {
    // 1) Go offline and capture a draft.
    setOnline(false);
    await incomeUseCases.create(draft);
    expect(useIncomeStore.getState().queue).toHaveLength(1);

    // 2) Reconnect; the server confirms the entry.
    setOnline(true);
    mockApi.mockResolvedValueOnce(serverDto('srv-9'));

    const result = await incomeUseCases.syncPending();

    expect(result).toEqual({synced: 1, failed: 0});
    const state = useIncomeStore.getState();
    expect(state.queue).toHaveLength(0);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].id).toBe('srv-9');
    expect(state.entries[0].syncStatus).toBe('synced');
  });

  it('keeps the item queued and marks it failed when the server errors', async () => {
    setOnline(false);
    await incomeUseCases.create(draft);

    setOnline(true);
    mockApi.mockRejectedValueOnce(new Error('500 server error'));

    const result = await incomeUseCases.syncPending();

    expect(result).toEqual({synced: 0, failed: 1});
    const queue = useIncomeStore.getState().queue;
    expect(queue).toHaveLength(1);
    expect(queue[0].retryCount).toBe(1);
    expect(queue[0].lastError).toContain('500');
  });

  it('is a no-op when the queue is empty', async () => {
    setOnline(true);
    expect(await incomeUseCases.syncPending()).toEqual({synced: 0, failed: 0});
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('does nothing while offline', async () => {
    setOnline(false);
    await incomeUseCases.create(draft); // queue one item
    mockApi.mockClear();

    // Still offline → sync must not attempt the network.
    expect(await incomeRepository.syncPending()).toEqual({synced: 0, failed: 0});
    expect(mockApi).not.toHaveBeenCalled();
    expect(useIncomeStore.getState().queue).toHaveLength(1);
  });
});

describe('airplane mode → reconnect → sync (full journey)', () => {
  it('creates multiple entries offline, syncs all on reconnect, no duplicates on a second sync', async () => {
    // ✈️ Airplane mode: capture two entries.
    setOnline(false);
    await incomeUseCases.create({...draft, amount: 100});
    await incomeUseCases.create({...draft, amount: 200});

    let state = useIncomeStore.getState();
    expect(state.queue).toHaveLength(2);
    expect(state.entries.every(e => e.syncStatus === 'pending')).toBe(true);
    expect(mockApi).not.toHaveBeenCalled(); // nothing hit the network

    // 📶 Reconnect: the server confirms each queued draft (its client_id makes
    // the POST idempotent server-side).
    setOnline(true);
    mockApi
      .mockResolvedValueOnce(serverDto('srv-a'))
      .mockResolvedValueOnce(serverDto('srv-b'));

    const first = await incomeUseCases.syncPending();
    expect(first).toEqual({synced: 2, failed: 0});

    state = useIncomeStore.getState();
    expect(state.queue).toHaveLength(0); // queue drained
    expect(state.entries).toHaveLength(2); // optimistic entries swapped, not duplicated
    expect(state.entries.every(e => e.syncStatus === 'synced')).toBe(true);
    expect(state.lastSyncedAt).not.toBeNull();

    // 🔁 A second flush (e.g. another reconnect event) is a harmless no-op — the
    // queue is empty, so no extra POSTs and no duplicate entries.
    mockApi.mockClear();
    const second = await incomeUseCases.syncPending();
    expect(second).toEqual({synced: 0, failed: 0});
    expect(mockApi).not.toHaveBeenCalled();
    expect(useIncomeStore.getState().entries).toHaveLength(2);
  });
});
