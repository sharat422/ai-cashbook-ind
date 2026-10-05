import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import type {Customer} from '@features/customers/domain/entities';
import type {LedgerEntry, LedgerEntryDraft} from '@features/customers/domain/ledger';

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
  cached: Record<string, LedgerEntry[]>;
  customers: Record<string, Customer>;
  cacheCustomers: (customers: Customer[]) => void;
  cache: (customerId: string, entries: LedgerEntry[]) => void;
  enqueue: (entry: PendingLedgerEntry) => void;
  remove: (localId: string) => void;
  markFailed: (localId: string, error: string) => void;
}

/** Persisted queue of offline ledger entries (credits/payments) awaiting sync. */
export const usePendingLedgerStore = create<PendingLedgerState>()(
  persist(
    set => ({
      entries: [],
      cached: {},
      customers: {},
      cacheCustomers: customers => set(s => ({customers: {...s.customers, ...Object.fromEntries(customers.map(c => [c.id, c]))}})),
      cache: (customerId, entries) => set(s => ({cached: {...s.cached, [customerId]: entries}})),
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
      partialize: ({entries, cached, customers}) => ({entries, cached, customers}),
    },
  ),
);

/** Pending count for a customer (drives any "N pending" hints). */
export const usePendingLedgerCount = (customerId: string): number =>
  usePendingLedgerStore(
    s => s.entries.filter(e => e.customerId === customerId).length,
  );
