import {NetworkError, WeakSignalError} from '@api/client';
import {
  buildLedger,
  type CustomerLedger,
  type LedgerEntry,
  type LedgerEntryDraft,
} from '@features/customers/domain/ledger';
import type {LedgerRepository} from '@features/customers/domain/ledgerRepository';
import {queuedBillsFor, useStockQueue} from '@features/stock/data/stockQueue';
import {connectivity} from '@/services/network/connectivity';
import {ledgerLocal, pendingToEntry} from './ledger.local';
import {ledgerRemote} from './ledger.remote';
import {usePendingLedgerStore} from '../presentation/store/pendingLedger.store';

function makeLocalId(): string {
  return `led_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Concrete ledger repository — offline-first.
 *
 * - `getLedger`: server entries (empty when offline) merged with locally-queued
 *   pending entries, then balances are derived.
 * - `addEntry`: try the backend; on a network failure queue it locally and
 *   return an optimistic `pending` entry. A server/HTTP error is rethrown so the
 *   form can show it (e.g. validation).
 */
export const ledgerRepository: LedgerRepository = {
  async getLedger(customerId: string): Promise<CustomerLedger> {
    let server: LedgerEntry[] = [];
    try {
      server = await ledgerRemote.list(customerId);
      usePendingLedgerStore.getState().cache(customerId, server);
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
      const cached = usePendingLedgerStore.getState().cached[customerId];
      if (!cached) { throw err; } // Never show a false zero balance for unseen history.
      server = cached;
    }
    const acknowledged = new Set(server.map(e => e.clientId).filter(Boolean));
    const pending = ledgerLocal.entriesForCustomer(customerId).filter(e => !acknowledged.has(e.id));
    // An item bill made offline: shown as waiting, with no amount — its total
    // (schemes, number) only exists once the server accepts it.
    const bills: LedgerEntry[] = queuedBillsFor(useStockQueue.getState().pending, customerId).map(b => ({
      id: b.input.clientId, type: 'credit', amount: 0, date: b.input.date, createdAt: b.input.date,
      syncStatus: 'pending', queuedBillLines: b.input.lines.length,
    }));
    return buildLedger([...server, ...pending, ...bills]);
  },

  async addEntry(
    customerId: string,
    draft: LedgerEntryDraft,
  ): Promise<LedgerEntry> {
    const localId = makeLocalId();
    try {
      // Offline or weak signal: queue now instead of waiting out the request
      // timeout — the entry must save in ~instantly (IM2).
      await connectivity.beforeSave();
      const entry = await ledgerRemote.add(customerId, draft, localId);
      const store = usePendingLedgerStore.getState();
      store.cache(customerId, [...(store.cached[customerId] ?? []).filter(e => e.id !== entry.id), entry]);
      return entry;
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err; // surface real errors
      ledgerLocal.enqueue(customerId, localId, draft, err instanceof WeakSignalError);
      return pendingToEntry({
        localId,
        customerId,
        draft,
        createdAt: new Date().toISOString(),
        retryCount: 0,
      });
    }
  },
};
