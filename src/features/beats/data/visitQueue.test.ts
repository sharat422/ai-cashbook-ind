import {ApiError, NetworkError} from '@api/client';
import {connectivity} from '@/services/network/connectivity';
import {beatsRemote, type VisitInput} from './beats.remote';
import {saveVisit, syncPendingVisits, useVisitQueue} from './visitQueue';

jest.mock('./beats.remote', () => ({beatsRemote: {recordVisit: jest.fn()}}));
jest.mock('@/services/network/connectivity', () => ({connectivity: {isOnline: jest.fn()}}));

const record = beatsRemote.recordVisit as jest.Mock;
const visit: VisitInput = {
  clientId: 'visit-1',
  beatId: 'beat',
  customerId: 'shop',
  outcome: 'visited_no_order',
  reason: 'stock_enough',
  visitedAt: '2026-11-04T10:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  useVisitQueue.setState({pending: []});
  (connectivity.isOnline as jest.Mock).mockResolvedValue(true);
});

test('a visit saved offline syncs exactly once, with the same clientId', async () => {
  record.mockRejectedValueOnce(new NetworkError('offline'));
  expect(await saveVisit(visit)).toBe(false);
  expect(useVisitQueue.getState().pending).toHaveLength(1);

  record.mockResolvedValue({id: 'server'});
  // Reconnect and app-foreground firing together must not upload twice.
  const [a, b] = await Promise.all([syncPendingVisits(), syncPendingVisits()]);
  expect([a, b]).toEqual([1, 1]); // both callers share the one run
  expect(record).toHaveBeenCalledTimes(2); // the failed first try + one sync
  expect(record.mock.calls[1][0]).toEqual(visit);
  expect(useVisitQueue.getState().pending).toEqual([]);

  expect(await syncPendingVisits()).toBe(0);
  expect(record).toHaveBeenCalledTimes(2);
});

test('stays queued while offline; a server rejection is kept and flagged', async () => {
  useVisitQueue.getState().enqueue(visit);
  (connectivity.isOnline as jest.Mock).mockResolvedValueOnce(false);
  expect(await syncPendingVisits()).toBe(0);
  expect(record).not.toHaveBeenCalled();

  record.mockRejectedValueOnce(new ApiError(403, "This beat isn't assigned to you."));
  expect(await syncPendingVisits()).toBe(0);
  expect(useVisitQueue.getState().pending[0].lastError).toBe("This beat isn't assigned to you.");
});

test('validation errors are shown, not queued', async () => {
  record.mockRejectedValueOnce(new ApiError(422, 'Unknown visit outcome.'));
  await expect(saveVisit(visit)).rejects.toThrow('Unknown visit outcome.');
  expect(useVisitQueue.getState().pending).toEqual([]);
});
