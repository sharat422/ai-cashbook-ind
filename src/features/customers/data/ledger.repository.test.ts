import {NetworkError} from '@api/client';
import {ledgerRemote} from './ledger.remote';
import {ledgerRepository} from './ledger.repository';
import {usePendingLedgerStore} from '../presentation/store/pendingLedger.store';

jest.mock('./ledger.remote', () => ({ledgerRemote: {list: jest.fn(), add: jest.fn()}}));
const entry = {id: 'server', clientId: 'pending', type: 'credit' as const, amount: 500, date: '2026-09-15', createdAt: '1'};
beforeEach(() => {
  jest.clearAllMocks();
  usePendingLedgerStore.setState({entries: [], cached: {}, customers: {}});
});
test('keeps synced ledger history available offline', async () => {
  (ledgerRemote.list as jest.Mock).mockResolvedValueOnce([entry]);
  expect((await ledgerRepository.getLedger('customer')).outstanding).toBe(500);
  (ledgerRemote.list as jest.Mock).mockRejectedValueOnce(new NetworkError('offline'));
  expect((await ledgerRepository.getLedger('customer')).outstanding).toBe(500);
});
test('does not double-count an acknowledged retry', async () => {
  usePendingLedgerStore.getState().enqueue({localId: 'pending', customerId: 'customer', draft: entry, createdAt: '1', retryCount: 0});
  (ledgerRemote.list as jest.Mock).mockResolvedValueOnce([entry]);
  expect((await ledgerRepository.getLedger('customer')).outstanding).toBe(500);
});
test('queues a network failure but surfaces validation failures', async () => {
  (ledgerRemote.add as jest.Mock).mockRejectedValueOnce(new NetworkError('offline'));
  expect((await ledgerRepository.addEntry('customer', entry)).syncStatus).toBe('pending');
  expect(usePendingLedgerStore.getState().entries).toHaveLength(1);
  (ledgerRemote.add as jest.Mock).mockRejectedValueOnce(new Error('Invalid amount'));
  await expect(ledgerRepository.addEntry('customer', entry)).rejects.toThrow('Invalid amount');
  expect(usePendingLedgerStore.getState().entries).toHaveLength(1);
});
