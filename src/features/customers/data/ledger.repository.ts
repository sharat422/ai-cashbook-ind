import {NetworkError} from '@api/client';
import {
  buildLedger,
  type CustomerLedger,
  type LedgerEntry,
  type LedgerEntryDraft,
} from '@features/customers/domain/ledger';
import type {LedgerRepository} from '@features/customers/domain/ledgerRepository';
import {ledgerLocal, pendingToEntry} from './ledger.local';
import {ledgerRemote} from './ledger.remote';

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
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err; // offline → server stays []
    }
    const pending = ledgerLocal.entriesForCustomer(customerId);
    return buildLedger([...server, ...pending]);
  },

  async addEntry(
    customerId: string,
    draft: LedgerEntryDraft,
  ): Promise<LedgerEntry> {
    const localId = makeLocalId();
    try {
      return await ledgerRemote.add(customerId, draft, localId);
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err; // surface real errors
      ledgerLocal.enqueue(customerId, localId, draft);
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
