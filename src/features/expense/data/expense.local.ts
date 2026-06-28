import type {Expense} from '@features/expense/domain/entities';
import type {PendingExpense} from '@features/expense/domain/repository';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';

/**
 * Local data source — the offline-durable store. Wraps the Zustand store
 * (persisted to AsyncStorage) so the repository depends on a plain data API
 * rather than React hooks.
 */
export const expenseLocal = {
  addEntry(entry: Expense): void {
    useExpenseStore.getState().addEntry(entry);
  },

  replaceEntry(id: string, entry: Expense): void {
    useExpenseStore.getState().replaceEntry(id, entry);
  },

  setEntryStatus(id: string, status: Expense['syncStatus']): void {
    useExpenseStore.getState().setEntryStatus(id, status);
  },

  enqueue(pending: PendingExpense): void {
    useExpenseStore.getState().enqueue(pending);
  },

  getQueue(): PendingExpense[] {
    return useExpenseStore.getState().queue;
  },

  removeFromQueue(localId: string): void {
    useExpenseStore.getState().removeFromQueue(localId);
  },

  markFailed(localId: string, error: string): void {
    useExpenseStore.getState().markQueueItemFailed(localId, error);
  },

  setSyncing(value: boolean): void {
    useExpenseStore.getState().setSyncing(value);
  },

  setLastSyncedAt(iso: string): void {
    useExpenseStore.getState().setLastSyncedAt(iso);
  },
};
