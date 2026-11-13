/**
 * IM2: weak signal (bars, but nothing gets through) queues a save in ~2 s, not
 * after the 15-second request timeout. A 2-second GET /health decides; it
 * carries no ledger data. The queued entry syncs exactly once when the server
 * answers again, and Sync status says why it queued.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import React from 'react';
import {act, create} from 'react-test-renderer';

import {NetworkError} from '@api/client';
import {ledgerRepository} from '@features/customers/data/ledger.repository';
import {ledgerRemote} from '@features/customers/data/ledger.remote';
import {syncPendingLedger} from '@features/customers/data/ledgerSync';
import {usePendingLedgerStore} from '@features/customers/presentation/store/pendingLedger.store';
import {connectivity} from '@/services/network/connectivity';
import {SyncStatusScreen} from './presentation/SyncStatusScreen';

jest.unmock('@/services/network/probe'); // the real 2-second probe, against a fake network
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@features/customers/data/ledger.remote', () => ({
  ledgerRemote: {add: jest.fn(), list: jest.fn()},
}));

const add = ledgerRemote.add as jest.Mock;
const draft = {type: 'credit', amount: 500, date: '2026-11-13'} as never;
const healthCalls = () => (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith('/health'));

/** A server that accepts the connection and never answers (a godown). */
const silent = jest.fn((_url: string, init: {signal: AbortSignal}) =>
  new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
const answers = jest.fn(async () => ({ok: true}));

// One fake clock for the file: the 30-second re-check is a single app-wide timer.
jest.useFakeTimers();
beforeEach(() => {
  add.mockReset();
  usePendingLedgerStore.setState({entries: []});
  (NetInfo.fetch as jest.Mock).mockResolvedValue({isConnected: true, isInternetReachable: true});
});

test('on a connection that never answers, the save queues in about 2 s, not 15', async () => {
  global.fetch = silent as never;
  let done = false;
  const saving = ledgerRepository.addEntry('c1', draft).then(e => { done = true; return e; });
  await jest.advanceTimersByTimeAsync(1999);
  expect(done).toBe(false);
  await jest.advanceTimersByTimeAsync(1);                // 2 s: the probe gives up
  const entry = await saving;
  expect(entry.syncStatus).toBe('pending');
  expect(add).not.toHaveBeenCalled();                    // the real request is never tried
  const [queued] = usePendingLedgerStore.getState().entries;
  expect(queued).toMatchObject({customerId: 'c1', weakSignal: true});
  // The probe is a bare GET /health: no login, no body, no ledger data.
  const [[url, init]] = healthCalls();
  expect(String(url)).toMatch(/\/health$/);
  expect(init.method).toBe('GET');
  expect(init.body).toBeUndefined();
  expect(init.headers).toBeUndefined();
});

test('in airplane mode a save still queues at once, without a probe', async () => {
  global.fetch = jest.fn() as never;
  (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({isConnected: false, isInternetReachable: false});
  await ledgerRepository.addEntry('c1', draft);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
  expect(usePendingLedgerStore.getState().entries[0].weakSignal).toBeUndefined();
});

test('if the probe answers but the real request fails, it queues as before', async () => {
  global.fetch = answers as never;
  add.mockRejectedValueOnce(new NetworkError());
  await ledgerRepository.addEntry('c1', draft);
  expect(add).toHaveBeenCalledTimes(1);
  expect(usePendingLedgerStore.getState().entries).toHaveLength(1);
  expect(usePendingLedgerStore.getState().entries[0].weakSignal).toBeUndefined();
});

test('a weak-signal entry syncs exactly once when the server answers again', async () => {
  global.fetch = silent as never;
  const saving = ledgerRepository.addEntry('c1', draft);
  await jest.advanceTimersByTimeAsync(2000);
  await saving;
  const synced: Promise<string[]>[] = [];
  const off = connectivity.subscribe(online => online && synced.push(syncPendingLedger()));
  add.mockImplementation(async (_c: string, _d: unknown, clientId: string) => ({id: clientId, amount: 500}));
  global.fetch = answers as never;                       // the signal comes back; NetInfo never noticed it went
  await jest.advanceTimersByTimeAsync(30_000);           // the next check, 30 s later
  await Promise.all(synced);
  await syncPendingLedger();                             // and again: nothing left to send
  off();
  expect(synced).toHaveLength(1);
  expect(add).toHaveBeenCalledTimes(1);                  // exactly once, with its client id
  expect(usePendingLedgerStore.getState().entries).toEqual([]);
});

test('Sync status says why it queued', async () => {
  usePendingLedgerStore.setState({
    entries: [
      {localId: 'w1', customerId: 'c1', draft, createdAt: '2026-11-13T10:00:00Z', retryCount: 0, weakSignal: true},
      {localId: 'o1', customerId: 'c1', draft, createdAt: '2026-11-13T10:01:00Z', retryCount: 0},
    ],
  });
  let r!: ReturnType<typeof create>;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient()}>
        <SyncStatusScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />
      </QueryClientProvider>,
    );
  });
  const texts = r.root.findAll(n => (n.type as unknown) === 'Text' && typeof n.props.children === 'string')
    .map(n => n.props.children as string);
  expect(texts.filter(s => s === 'Queued — weak signal')).toHaveLength(1);   // the probe queued it
  expect(texts.filter(s => s === 'Waiting to sync')).toHaveLength(1);         // queued for another reason
  act(() => r.unmount());
});
