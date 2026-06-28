import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import type {LedgerEntryDraft} from '@features/customers/domain/ledger';

/** A ledger entry queued locally because it couldn't reach the backend. */
export interface PendingLedgerEntry {
  localId: string;
  customerId: string;
  draft: LedgerEntryDraft;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

interface PendingLedgerState {
  entries: PendingLedgerEntry[];
  enqueue: (entry: PendingLedgerEntry) => void;
  remove: (localId: string) => void;
  markFailed: (localId: string, error: string) => void;
}

/** Persisted queue of offline ledger entries (credits/payments) awaiting sync. */
export const usePendingLedgerStore = create<PendingLedgerState>()(
  persist(
    set => ({
      entries: [],
      enqueue: entry => set(s => ({entries: [...s.entries, entry]})),
      remove: localId =>
        set(s => ({entries: s.entries.filter(e => e.localId !== localId)})),
      markFailed: (localId, error) =>
        set(s => ({
          entries: s.entries.map(e =>
            e.localId === localId
              ? {...e, retryCount: e.retryCount + 1, lastError: error}
              : e,
          ),
        })),
    }),
    {
      name: 'pending-ledger',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({entries}) => ({entries}),
    },
  ),
);

/** Pending count for a customer (drives any "N pending" hints). */
export const usePendingLedgerCount = (customerId: string): number =>
  usePendingLedgerStore(
    s => s.entries.filter(e => e.customerId === customerId).length,
  );
