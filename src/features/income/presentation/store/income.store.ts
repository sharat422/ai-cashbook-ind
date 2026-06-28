import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import type {Income} from '@features/income/domain/entities';
import type {PendingIncome} from '@features/income/domain/repository';

interface IncomeState {
  /** False until the persisted store has rehydrated from disk. */
  hydrated: boolean;
  /** All entries shown in the UI, newest first (synced + optimistic). */
  entries: Income[];
  /** Drafts awaiting upload to the backend. */
  queue: PendingIncome[];
  isSyncing: boolean;
  lastSyncedAt: string | null;

  // Entry actions
  addEntry: (entry: Income) => void;
  /** Replace an entry by id (e.g. swap an optimistic entry for the synced one). */
  replaceEntry: (id: string, entry: Income) => void;

  // Queue actions
  enqueue: (pending: PendingIncome) => void;
  removeFromQueue: (localId: string) => void;
  markQueueItemFailed: (localId: string, error: string) => void;

  // Sync flags
  setSyncing: (value: boolean) => void;
  setLastSyncedAt: (iso: string) => void;

  _setHydrated: (value: boolean) => void;
}

/**
 * Zustand store for income entries and the offline queue. Persisted to
 * AsyncStorage so pending drafts survive app restarts and sync later.
 */
export const useIncomeStore = create<IncomeState>()(
  persist(
    set => ({
      hydrated: false,
      entries: [],
      queue: [],
      isSyncing: false,
      lastSyncedAt: null,

      addEntry: entry =>
        set(state => ({entries: [entry, ...state.entries]})),

      replaceEntry: (id, entry) =>
        set(state => ({
          entries: state.entries.map(e => (e.id === id ? entry : e)),
        })),

      enqueue: pending =>
        set(state => ({queue: [...state.queue, pending]})),

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
      name: 'income-storage',
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
export const usePendingCount = (): number =>
  useIncomeStore(state => state.queue.length);
