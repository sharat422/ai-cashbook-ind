import {gstSplitLines, placeOfSupply} from '@features/gst/domain/gstSplit';
import {useAuthStore} from '@store/auth.store';
import type {LedgerEntry, LedgerEntryDraft} from '@features/customers/domain/ledger';
import {
  usePendingLedgerStore,
  type PendingLedgerEntry,
} from '@features/customers/presentation/store/pendingLedger.store';

/** What the customer owes for this entry: for a GST sale, the invoice total the
 *  server will compute (same formula on the phone), not the pre-tax price. */
export function invoiceTotal(draft: LedgerEntryDraft): number {
  const seller = useAuthStore.getState().business?.gstin;
  if (!draft.gst || !seller) return draft.amount;
  const pos = placeOfSupply(seller, draft.gst.customerGstin, draft.gst.placeOfSupply);
  const lines = draft.gst.lines?.length ? draft.gst.lines : [{amount: draft.amount, rate: draft.gst.rate}];
  return Number(gstSplitLines(lines, draft.gst.priceIncludesGst, pos !== seller.slice(0, 2)).total);
}

/** Map a queued pending entry to an optimistic LedgerEntry for the timeline. */
export function pendingToEntry(pending: PendingLedgerEntry): LedgerEntry {
  const {draft} = pending;
  return {
    id: pending.localId,
    type: draft.type,
    amount: invoiceTotal(draft),
    date: draft.date,
    invoiceNumber: draft.invoiceNumber,
    gstStatus: draft.gst?.draft ? 'draft' : undefined,
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
  enqueue(customerId: string, localId: string, draft: LedgerEntryDraft, weakSignal = false): void {
    usePendingLedgerStore.getState().enqueue({
      localId,
      customerId,
      draft,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      ...(weakSignal ? {weakSignal} : {}),
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
