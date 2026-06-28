import type {LedgerEntry, LedgerEntryDraft} from '@features/customers/domain/ledger';
import {
  usePendingLedgerStore,
  type PendingLedgerEntry,
} from '@features/customers/presentation/store/pendingLedger.store';

/** Map a queued pending entry to an optimistic LedgerEntry for the timeline. */
export function pendingToEntry(pending: PendingLedgerEntry): LedgerEntry {
  const {draft} = pending;
  return {
    id: pending.localId,
    type: draft.type,
    amount: draft.amount,
    date: draft.date,
    invoiceNumber: draft.invoiceNumber,
    notes: draft.notes,
    paymentMethod: draft.paymentMethod,
    referenceNumber: draft.referenceNumber,
    attachment: draft.attachment ?? null,
    createdAt: pending.createdAt,
    syncStatus: 'pending',
  };
}

/** Local data source wrapping the persisted pending-ledger queue. */
export const ledgerLocal = {
  enqueue(customerId: string, localId: string, draft: LedgerEntryDraft): void {
    usePendingLedgerStore.getState().enqueue({
      localId,
      customerId,
      draft,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    });
  },

  remove(localId: string): void {
    usePendingLedgerStore.getState().remove(localId);
  },

  markFailed(localId: string, error: string): void {
    usePendingLedgerStore.getState().markFailed(localId, error);
  },

  all(): PendingLedgerEntry[] {
    return usePendingLedgerStore.getState().entries;
  },

  /** Pending entries for one customer, as optimistic LedgerEntry objects. */
  entriesForCustomer(customerId: string): LedgerEntry[] {
    return usePendingLedgerStore
      .getState()
      .entries.filter(e => e.customerId === customerId)
      .map(pendingToEntry);
  },
};
