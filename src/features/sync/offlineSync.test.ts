/**
 * Acceptance: after 2 hours offline, 20 entries (income, expense, udhar /
 * payment, shop visits) sync with zero loss and zero duplicates — even when
 * one upload's response is lost and several syncs fire at once.
 *
 * Runs the real repositories, queues and persisted stores against a fake
 * server at the fetch level that keeps one record per client id (as the
 * backend does, enforced there by unique indexes).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import {saveVisit, useVisitQueue} from '@features/beats/data/visitQueue';
import {ledgerRepository} from '@features/customers/data/ledger.repository';
import {usePendingLedgerStore} from '@features/customers/presentation/store/pendingLedger.store';
import {expenseRepository} from '@features/expense/data/expense.repository';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {incomeRepository} from '@features/income/data/income.repository';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {syncCountsNow, syncEverything} from './syncStatus';

const fetchNetInfo = NetInfo.fetch as jest.Mock;

let online = false;
let loseNextResponse = false;
const posts: string[] = []; // every client id the server received, retries included
const saved = new Map<string, Record<string, unknown>>(); // one record per client id

function clientIdOf(body: unknown): string {
  if (typeof body === 'string') return JSON.parse(body).clientId;
  return String((body as unknown as {get(k: string): unknown}).get('client_id')); // multipart income / expense / ledger
}

beforeAll(() => {
  global.fetch = jest.fn(async (_url: string, init: {method?: string; body?: unknown}) => {
    if (!online) throw new TypeError('Network request failed');
    const id = clientIdOf(init.body);
    posts.push(id);
    if (!saved.has(id)) {
      saved.set(id, {
        id: `srv_${saved.size + 1}`, client_id: id, amount: 100, category: 'Sales', vendor: 'V',
        type: 'credit', date: '2026-11-07', created_at: new Date().toISOString(),
        outcome: 'visited_ordered', customer_id: 'c1', beat_id: 'b1', visited_at: new Date().toISOString(),
      });
    }
    if (loseNextResponse) {
      loseNextResponse = false; // saved on the server, but the phone never hears back
      throw new TypeError('Network request failed');
    }
    return {ok: true, status: 200, text: async () => JSON.stringify(saved.get(id))} as Response;
  }) as unknown as typeof fetch;
  fetchNetInfo.mockImplementation(async () => ({isConnected: online, isInternetReachable: online}));
});

afterAll(() => {
  fetchNetInfo.mockImplementation(async () => ({isConnected: true, isInternetReachable: true}));
});

it('20 entries made offline survive 2 hours and sync exactly once', async () => {
  const start = Date.now();
  const day = '2026-11-07';
  const saves: (() => Promise<unknown>)[] = [];
  for (let i = 0; i < 5; i++) {
    saves.push(() => incomeRepository.create({amount: 100 + i, category: 'Sales', date: day}));
    saves.push(() => expenseRepository.create({amount: 50 + i, category: 'Fuel', vendor: 'HP', date: day}));
    saves.push(() =>
      ledgerRepository.addEntry('c1', {type: i % 2 ? 'payment' : 'credit', amount: 200 + i, date: day,
        paymentMethod: i % 2 ? 'cash' : undefined}));
    saves.push(() =>
      saveVisit({clientId: `visit_${i}`, beatId: 'b1', customerId: `c${i}`, outcome: 'visited_ordered',
        visitedAt: new Date().toISOString()}));
  }
  for (const save of saves) {
    const t0 = Date.now();
    await save();
    expect(Date.now() - t0).toBeLessThan(2000); // offline save never waits on the network
  }
  expect(posts).toEqual([]);
  expect(syncCountsNow()).toEqual({pending: 20, failed: 0, conflicts: 0});

  // Everything is on disk, so a killed app or a dead battery loses nothing.
  await new Promise(r => setImmediate(r));
  const disk = async (key: string) => JSON.parse((await AsyncStorage.getItem(key))!).state;
  expect((await disk('income-storage')).queue).toHaveLength(5);
  expect((await disk('expense-storage')).queue).toHaveLength(5);
  expect((await disk('pending-ledger')).entries).toHaveLength(5);
  expect((await disk('pending-visits')).pending).toHaveLength(5);

  // Two hours later, still offline: a sync attempt changes nothing.
  jest.spyOn(Date, 'now').mockReturnValue(start + 2 * 60 * 60 * 1000);
  await syncEverything();
  expect(syncCountsNow()).toEqual({pending: 20, failed: 0, conflicts: 0});

  // Internet back. The first upload reaches the server but its reply is lost,
  // and reconnect + foreground + "Sync now" all start a sync at once.
  online = true;
  loseNextResponse = true;
  await Promise.all([syncEverything(), syncEverything(), syncEverything()]);
  await syncEverything(); // the next sync retries the one whose reply was lost
  (Date.now as jest.Mock).mockRestore();

  expect(syncCountsNow()).toEqual({pending: 0, failed: 0, conflicts: 0});
  expect(saved.size).toBe(20); // zero loss, zero duplicates
  expect(new Set(posts).size).toBe(20);
  expect(posts).toHaveLength(21); // only the lost reply was sent twice — and kept once
  expect(useIncomeStore.getState().queue).toEqual([]);
  expect(useExpenseStore.getState().queue).toEqual([]);
  expect(usePendingLedgerStore.getState().entries).toEqual([]);
  expect(useVisitQueue.getState().pending).toEqual([]);
  expect(useIncomeStore.getState().entries.filter(e => e.syncStatus !== 'synced')).toEqual([]);
});
