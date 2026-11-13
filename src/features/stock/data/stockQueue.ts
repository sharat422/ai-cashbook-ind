import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {ApiError, NetworkError, WeakSignalError} from '@api/client';
import {connectivity} from '@/services/network/connectivity';
import {schemesRemote, type BillInput} from '@features/schemes/data/schemes.remote';
import {stockRemote, type MoveInput, type TransferInput, type VanItem} from './stock.remote';

/** A stock entry recorded without a connection: a move (purchase / sale), a
 *  transfer, or an item bill (`itemName` = the retailer; the server prices it,
 *  applies schemes and gives it a number when it syncs). Counts never queue —
 *  a count is the stock at one moment. */
/** `weakSignal`: queued because the server didn't answer a quick check (IM2). */
type Queued = {itemName: string; lastError?: string; weakSignal?: boolean};
export type QueuedStock =
  | ({op: 'move'; input: MoveInput} & Queued)
  | ({op: 'transfer'; input: TransferInput} & Queued)
  | ({op: 'bill'; input: BillInput & {clientId: string}} & Queued);

/** A queued entry the place no longer has the stock for (someone sold it
 *  first). It waits here for a choice; it's never dropped or forced through. */
export interface StockConflict {
  entry: QueuedStock;
  /** What the queued entry wanted to take, and what's there now. */
  queued: string;
  current: string;
  /** A bill: why the server refused it (stock short, or a scheme ended). */
  reason?: string;
  detectedAt: string;
}

interface StockQueueState {
  pending: QueuedStock[];
  conflicts: StockConflict[];
  /** The salesperson's own van, as last seen online: what they can bill offline. */
  van?: VanItem[];
}

/** Persisted with the other offline queues (income, expense, ledger, visits,
 *  customer edits) and synced in the same "Sync now" run. */
export const useStockQueue = create<StockQueueState>()(
  persist((): StockQueueState => ({pending: [], conflicts: []}), {
    name: 'pending-stock',
    storage: createJSONStorage(() => AsyncStorage),
  }),
);

const set = useStockQueue.setState;
const idOf = (e: QueuedStock) => e.input.clientId;
const without = <T extends {input: {clientId: string}}>(list: T[], id: string) =>
  list.filter(e => e.input.clientId !== id);

const send = (e: QueuedStock): Promise<unknown> =>
  e.op === 'move' ? stockRemote.record(e.input)
    : e.op === 'transfer' ? stockRemote.transfer(e.input)
    : schemesRemote.createBill({...e.input, queued: true});

/** Stock now at the place a queued entry takes from (null = can't tell). */
export async function availableFor(e: Exclude<QueuedStock, {op: 'bill'}>): Promise<number | null> {
  const where = e.op === 'move'
    ? {location: e.input.location, van: e.input.vanUserId}
    : {location: e.input.fromLocation ?? 'godown', van: e.input.fromVanUserId};
  const itemId = e.input.itemId;
  if (where.location === 'van' && !where.van) { // the caller's own van
    const mine = await stockRemote.van();
    return Number(mine.find(i => i.id === itemId)?.quantity ?? 0);
  }
  const {items} = await stockRemote.levels();
  const item = items.find(i => i.id === itemId);
  if (!item) return null;
  return Number(where.location === 'godown' ? item.godown : item.vans[where.van!] ?? 0);
}

const takesStock = (e: Exclude<QueuedStock, {op: 'bill'}>) => e.op === 'transfer' || e.input.kind === 'sale';

/** Put an entry on the queue (replacing one with the same client id). */
export const queueStock = (entry: QueuedStock): void => {
  set(s => ({pending: [...without(s.pending, idOf(entry)), entry]}));
};

/** Queued bills for one retailer (shown on their ledger as waiting to sync). */
export const queuedBillsFor = (pending: QueuedStock[], customerId: string) =>
  pending.flatMap(e => (e.op === 'bill' && e.input.customerId === customerId ? [e] : []));

/** Save now, or queue on a network failure. Real server errors (validation,
 *  403, not enough stock while online) are thrown so the sheet shows them. */
export async function saveStock(entry: QueuedStock): Promise<'saved' | 'queued'> {
  try {
    await connectivity.beforeSave(); // offline or weak signal: queue now, don't wait for a timeout
    await send(entry);
    return 'saved';
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;
    queueStock(err instanceof WeakSignalError ? {...entry, weakSignal: true} : entry);
    return 'queued';
  }
}

let syncing: Promise<number> | null = null;

/** Upload queued stock entries, oldest first. The server keeps one row per
 *  client id, so a retry after a lost response never adds a second. A sale or
 *  move the place no longer has the stock for becomes a conflict. */
export function syncPendingStock(): Promise<number> {
  syncing ??= (async () => {
    let synced = 0;
    try {
      if (!(await connectivity.isOnline())) return 0;
      for (const entry of [...useStockQueue.getState().pending]) {
        try {
          await send(entry);
          set(s => ({pending: without(s.pending, idOf(entry))}));
          synced += 1;
        } catch (err) {
          if (err instanceof NetworkError) break; // offline again
          const refused = err instanceof ApiError && (err.status === 409 || err.status === 422) ? err : null;
          let conflict: Omit<StockConflict, 'entry' | 'detectedAt'> | null = null;
          if (entry.op === 'bill') {
            // Stock short, or a scheme ended while offline: the owner decides.
            if (refused) conflict = {queued: '', current: '', reason: refused.message}; // translated by code (TE3)
          } else if (refused?.status === 422 && takesStock(entry)) {
            const short = await availableFor(entry).catch(() => null);
            if (short !== null && short < Number(entry.input.quantity)) {
              conflict = {queued: entry.input.quantity, current: String(short)};
            }
          }
          if (conflict) {
            const c = {...conflict, entry, detectedAt: new Date().toISOString()};
            set(s => ({
              pending: without(s.pending, idOf(entry)),
              conflicts: [...s.conflicts.filter(x => idOf(x.entry) !== idOf(entry)), c],
            }));
          } else {
            const msg = err instanceof Error ? err.message : 'Sync failed';
            set(s => ({pending: s.pending.map(e => (idOf(e) === idOf(entry) ? {...e, lastError: msg} : e))}));
          }
        }
      }
      return synced;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** The owner's choice on a conflict: drop the queued entry, or try it again
 *  (after a load or a correction). Trying again with too little stock just
 *  comes back as a conflict — it never oversells. */
export async function resolveStockConflict(clientId: string, choice: 'discard' | 'retry'): Promise<void> {
  const c = useStockQueue.getState().conflicts.find(x => idOf(x.entry) === clientId);
  if (!c) return;
  set(s => ({
    conflicts: s.conflicts.filter(x => idOf(x.entry) !== clientId),
    pending: choice === 'retry' ? [...s.pending, {...c.entry, lastError: undefined}] : s.pending,
  }));
  if (choice === 'retry') await syncPendingStock();
}
