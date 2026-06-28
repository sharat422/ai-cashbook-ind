import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import type {Expense} from '@features/expense/domain/entities';
import type {PendingExpense} from '@features/expense/domain/repository';

interface ExpenseState {
  /** False until the persisted store has rehydrated from disk. */
  hydrated: boolean;
  /** All entries shown in the UI, newest first (optimistic + synced). */
  entries: Expense[];
  /** Drafts awaiting upload to the backend. */
  queue: PendingExpense[];
  isSyncing: boolean;
  lastSyncedAt: string | null;

  // Entry actions
  addEntry: (entry: Expense) => void;
  replaceEntry: (id: string, entry: Expense) => void;
  setEntryStatus: (id: string, syncStatus: Expense['syncStatus']) => void;

  // Queue actions
  enqueue: (pending: PendingExpense) => void;
  removeFromQueue: (localId: string) => void;
  markQueueItemFailed: (localId: string, error: string) => void;

  // Sync flags
  setSyncing: (value: boolean) => void;
  setLastSyncedAt: (iso: string) => void;

  _setHydrated: (value: boolean) => void;
}

/**
 * Zustand store for expense entries and the offline queue. Persisted to
 * AsyncStorage so optimistic/pending drafts survive restarts and sync later.
 */
export const useExpenseStore = create<ExpenseState>()(
  persist(
    set => ({
      hydrated: false,
      entries: [],
      queue: [],
      isSyncing: false,
      lastSyncedAt: null,

      addEntry: entry => set(state => ({entries: [entry, ...state.entries]})),

      replaceEntry: (id, entry) =>
        set(state => ({
          entries: state.entries.map(e => (e.id === id ? entry : e)),
        })),

      setEntryStatus: (id, syncStatus) =>
        set(state => ({
          entries: state.entries.map(e =>
            e.id === id ? {...e, syncStatus} : e,
          ),
        })),

      enqueue: pending => set(state => ({queue: [...state.queue, pending]})),

      removeFromQueue: localId =>
        set(state => ({
          queue: state.queue.filter(item => item.localId !== localId),
        })),

      markQueueItemFailed: (localId, error) =>
        set(state => ({
          queue: state.queue.map(item =>
            item.localId === localId
              ? {...item, retryCount: item.retryCount + 1, lastError: error}
              : item,
          ),
        })),

      setSyncing: value => set({isSyncing: value}),
      setLastSyncedAt: iso => set({lastSyncedAt: iso}),
      _setHydrated: value => set({hydrated: value}),
    }),
    {
      name: 'expense-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({entries, queue, lastSyncedAt}) => ({
        entries,
        queue,
        lastSyncedAt,
      }),
      onRehydrateStorage: () => state => state?._setHydrated(true),
    },
  ),
);

/** Number of drafts waiting to sync — drives the offline badge. */
export const useExpensePendingCount = (): number =>
  useExpenseStore(state => state.queue.length);
