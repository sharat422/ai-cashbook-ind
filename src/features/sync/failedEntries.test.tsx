/**
 * IM5: a failed entry on Sync status can be fixed (same client id, synced again)
 * or discarded by the owner, after a confirm that names the amount. Staff don't
 * get Discard. Discarding needs the server (it records the client id first).
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {apiRequest, NetworkError} from '@api/client';
import {ledgerRemote} from '@features/customers/data/ledger.remote';
import {usePendingLedgerStore} from '@features/customers/presentation/store/pendingLedger.store';
import {SyncStatusScreen} from './presentation/SyncStatusScreen';

jest.setTimeout(60_000);
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@api/client', () => ({...jest.requireActual('@api/client'), apiRequest: jest.fn()}));
jest.mock('@features/customers/data/ledger.remote', () => ({ledgerRemote: {add: jest.fn(), list: jest.fn()}}));
let mockOwner = true;
jest.mock('@features/auth/hooks', () => ({
  usePermissions: () => ({can: (p: string) => p !== 'entry.delete' || mockOwner}),
}));

const failed = () => usePendingLedgerStore.setState({
  entries: [{localId: 'q-1', customerId: 'c1', createdAt: '2026-11-13T10:00:00Z', retryCount: 3,
    lastError: 'This UTR is already on a UPI payment…',
    draft: {type: 'payment', amount: 10000, date: '2026-11-13', paymentMethod: 'upi', referenceNumber: '700000000001'}}],
  customers: {c1: {id: 'c1', fullName: 'Ramesh Kirana'} as never},
});

async function open(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient()}>
        <SyncStatusScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />
      </QueryClientProvider>,
    );
  });
  return r;
}
const byId = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && n.props.onPress);

beforeEach(() => {
  mockOwner = true;
  (apiRequest as jest.Mock).mockReset();
  (ledgerRemote.add as jest.Mock).mockReset();
  failed();
});

test('Edit fixes the entry where it waits and syncs it with the same client id', async () => {
  (ledgerRemote.add as jest.Mock).mockResolvedValue({id: 'q-1', type: 'payment', amount: 10000});
  const r = await open();
  await act(async () => { byId(r, 'sync-edit-q-1')[0].props.onPress(); });
  await act(async () => {
    r.root.findAll(n => n.props.testID === 'edit-queued-reference' && n.props.onChangeText)[0]
      .props.onChangeText('700000000999');
  });
  await act(async () => { byId(r, 'edit-queued-save')[0].props.onPress(); });
  expect(ledgerRemote.add).toHaveBeenCalledTimes(1);
  const [customerId, draft, clientId] = (ledgerRemote.add as jest.Mock).mock.calls[0];
  expect([customerId, clientId]).toEqual(['c1', 'q-1']);                  // the same client id
  expect(draft).toMatchObject({amount: 10000, referenceNumber: '700000000999'});
  expect(usePendingLedgerStore.getState().entries).toEqual([]);           // synced, off the queue
  act(() => r.unmount());
});

test('Discard confirms with the amount, tells the server first, then drops the entry', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (apiRequest as jest.Mock).mockResolvedValue({discarded: true});
  const r = await open();
  await act(async () => { byId(r, 'sync-discard-q-1')[0].props.onPress(); });
  const [, message, buttons] = alert.mock.calls[0] as [string, string, {text: string; onPress?: () => Promise<void>}[]];
  expect(message).toContain('Ramesh Kirana ₹10,000');
  const discard = buttons.find(b => b.text.startsWith('Discard'))!;
  expect(discard.text).toBe('Discard ₹10,000');                          // the amount, on the button
  expect(usePendingLedgerStore.getState().entries).toHaveLength(1);      // nothing until confirmed
  await act(async () => { await discard.onPress!(); });
  expect(apiRequest).toHaveBeenCalledWith('/sync/discard', {method: 'POST', body: expect.objectContaining(
    {clientId: 'q-1', kind: 'ledger', amount: 10000})});
  expect(usePendingLedgerStore.getState().entries).toEqual([]);
  alert.mockRestore();
  act(() => r.unmount());
});

test('offline, Discard keeps the entry and says it needs a connection', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (apiRequest as jest.Mock).mockRejectedValue(new NetworkError());
  const r = await open();
  await act(async () => { byId(r, 'sync-discard-q-1')[0].props.onPress(); });
  const buttons = alert.mock.calls[0][2] as {text: string; onPress?: () => Promise<void>}[];
  await act(async () => { await buttons.find(b => b.text.startsWith('Discard'))!.onPress!(); });
  expect(String(alert.mock.calls[1][0])).toContain('needs a connection');
  expect(usePendingLedgerStore.getState().entries).toHaveLength(1);
  alert.mockRestore();
  act(() => r.unmount());
});

test('staff see the failed entry and can fix it, but get no Discard', async () => {
  mockOwner = false;
  const r = await open();
  expect(byId(r, 'sync-edit-q-1').length).toBeGreaterThan(0);
  expect(byId(r, 'sync-discard-q-1')).toHaveLength(0);
  act(() => r.unmount());
});
