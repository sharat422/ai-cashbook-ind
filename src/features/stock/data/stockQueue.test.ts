/**
 * S5 + SC7: stock entries and item bills join the offline queue. A van sale made offline syncs
 * exactly once; one the van no longer has stock for becomes a conflict (never
 * an oversell, never a silent failure); a count is never queued.
 */
import {ApiError, NetworkError} from '@api/client';

let mockOnline = false;
jest.mock('@/services/network/connectivity', () => ({
  connectivity: {
    isOnline: async () => mockOnline,
    beforeSave: async () => {
      if (!mockOnline) throw new (require('@api/client').NetworkError)();
    },
    subscribe: () => () => undefined,
  },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockRecord = jest.fn();
const mockCount = jest.fn();
let mockVanQty = '10.000';
jest.mock('./stock.remote', () => ({
  stockRemote: {
    record: (...a: unknown[]) => mockRecord(...a),
    transfer: jest.fn(),
    count: (...a: unknown[]) => mockCount(...a),
    van: async () => [{id: 'soap', name: 'Soap', unit: 'box', salePrice: 10, quantity: mockVanQty}],
    levels: async () => ({items: [], vans: []}),
  },
}));

const mockCreateBill = jest.fn();
jest.mock('@features/schemes/data/schemes.remote', () => ({
  schemesRemote: {createBill: (...a: unknown[]) => mockCreateBill(...a)},
}));

import {queueStock, queuedBillsFor, resolveStockConflict, saveStock, syncPendingStock, useStockQueue} from './stockQueue';
import {saveCount} from '@features/stock/presentation/hooks';

const sale = (clientId: string, quantity: string) => ({
  op: 'move' as const, itemName: 'Soap',
  input: {clientId, kind: 'sale' as const, itemId: 'soap', quantity, location: 'van' as const, date: '2026-11-11'},
});

beforeEach(() => {
  useStockQueue.setState({pending: [], conflicts: []});
  mockRecord.mockReset();
  mockCount.mockReset();
  mockCreateBill.mockReset();
  mockOnline = false;
  mockVanQty = '10.000';
});

test('an offline van sale is queued and synced exactly once', async () => {
  expect(await saveStock(sale('s1', '3'))).toBe('queued');
  expect(mockRecord).not.toHaveBeenCalled();
  expect(useStockQueue.getState().pending).toHaveLength(1);

  mockOnline = true;
  mockRecord.mockResolvedValue([]);
  expect(await syncPendingStock()).toBe(1);
  expect(mockRecord).toHaveBeenCalledTimes(1);
  expect(mockRecord.mock.calls[0][0]).toMatchObject({clientId: 's1', quantity: '3'});  // its own id: the server saves it once
  expect(await syncPendingStock()).toBe(0);  // syncing again sends nothing
  expect(mockRecord).toHaveBeenCalledTimes(1);
  expect(useStockQueue.getState().pending).toEqual([]);
});

test('a lost connection mid-send keeps the entry queued', async () => {
  await saveStock(sale('s1', '3'));
  mockOnline = true;
  mockRecord.mockRejectedValueOnce(new NetworkError());
  expect(await syncPendingStock()).toBe(0);
  expect(useStockQueue.getState().pending).toHaveLength(1);
});

test('a queued sale the van no longer has stock for becomes a conflict', async () => {
  await saveStock(sale('s1', '5'));
  mockOnline = true;
  mockVanQty = '2.000';  // someone sold most of it first
  mockRecord.mockRejectedValue(new ApiError(422, 'Only 2 box of Soap in this van.'));
  await syncPendingStock();
  const {pending, conflicts} = useStockQueue.getState();
  expect(pending).toEqual([]);
  expect(conflicts.map(c => [c.entry.input.clientId, c.queued, c.current])).toEqual([['s1', '5', '2']]);

  await resolveStockConflict('s1', 'retry');  // still not enough: back as a conflict, nothing saved
  expect(useStockQueue.getState().conflicts).toHaveLength(1);
  await resolveStockConflict('s1', 'discard');
  expect(useStockQueue.getState()).toMatchObject({pending: [], conflicts: []});
});

test('a server refusal that isn\'t about stock is shown as failed, not a conflict', async () => {
  await saveStock(sale('s1', '1'));
  mockOnline = true;
  mockRecord.mockRejectedValue(new ApiError(403, 'You can only use your own van.'));
  await syncPendingStock();
  const {pending, conflicts} = useStockQueue.getState();
  expect(conflicts).toEqual([]);
  expect(pending[0].lastError).toBe('You can only use your own van.');
});

test('a count attempted offline is refused, not queued', async () => {
  await expect(saveCount({clientId: 'c1', location: 'godown', date: '2026-11-11', lines: []} as never))
    .rejects.toThrow('Counts need a connection');
  expect(mockCount).not.toHaveBeenCalled();
  expect(useStockQueue.getState().pending).toEqual([]);
});

// --- SC7: item bills -------------------------------------------------------

const bill = (clientId: string) => ({
  op: 'bill' as const, itemName: 'Ravi Stores',
  input: {clientId, customerId: 'ravi', date: '2026-11-10', location: 'van' as const,
    lines: [{itemId: 'soap', quantity: '20'}]},
});

test('an offline bill waits on the retailer ledger, then syncs exactly once', async () => {
  queueStock(bill('b1'));
  expect(queuedBillsFor(useStockQueue.getState().pending, 'ravi')).toHaveLength(1);  // "waiting to sync"
  expect(queuedBillsFor(useStockQueue.getState().pending, 'someone-else')).toEqual([]);

  mockOnline = true;
  mockCreateBill.mockResolvedValue({id: 'srv-1', billNumber: 'B-7'});
  expect(await syncPendingStock()).toBe(1);
  // Its own id (the server saves it once and numbers it then), marked as from the queue.
  expect(mockCreateBill).toHaveBeenCalledWith(expect.objectContaining({clientId: 'b1', queued: true}));
  expect(await syncPendingStock()).toBe(0);
  expect(mockCreateBill).toHaveBeenCalledTimes(1);
  expect(useStockQueue.getState().pending).toEqual([]);
});

test('a queued bill whose stock was sold, or whose scheme ended, goes to the conflict screen', async () => {
  queueStock(bill('short'));
  queueStock(bill('expired'));
  mockOnline = true;
  mockCreateBill
    .mockRejectedValueOnce(new ApiError(422, 'Only 1 pcs of Soap in this van.'))
    .mockRejectedValueOnce(new ApiError(409, "Scheme 'Diwali 10+1' ended on 2026-11-10, after this bill was made offline."));
  await syncPendingStock();
  const {pending, conflicts} = useStockQueue.getState();
  expect(pending).toEqual([]);  // never silently dropped: both wait for the owner
  expect(conflicts.map(c => [c.entry.input.clientId, c.reason])).toEqual([
    ['short', 'Only 1 pcs of Soap in this van.'],
    ['expired', "Scheme 'Diwali 10+1' ended on 2026-11-10, after this bill was made offline."],
  ]);
  mockCreateBill.mockRejectedValueOnce(new ApiError(422, 'Only 1 pcs of Soap in this van.'));
  await resolveStockConflict('short', 'retry');  // still short: back as a conflict, nothing saved
  expect(useStockQueue.getState().conflicts).toHaveLength(2);
});
