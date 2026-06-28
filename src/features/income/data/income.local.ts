import type {Income} from '@features/income/domain/entities';
import type {PendingIncome} from '@features/income/domain/repository';
import {useIncomeStore} from '@features/income/presentation/store/income.store';

/**
 * Local data source — the offline-durable store. Wraps the Zustand store
 * (persisted to AsyncStorage) so the repository depends on a plain data API
 * rather than React hooks.
 */
export const incomeLocal = {
  addEntry(entry: Income): void {
    useIncomeStore.getState().addEntry(entry);
  },

  replaceEntry(id: string, entry: Income): void {
    useIncomeStore.getState().replaceEntry(id, entry);
  },

  enqueue(pending: PendingIncome): void {
    useIncomeStore.getState().enqueue(pending);
  },

  getQueue(): PendingIncome[] {
    return useIncomeStore.getState().queue;
  },

  removeFromQueue(localId: string): void {
    useIncomeStore.getState().removeFromQueue(localId);
  },

  markFailed(localId: string, error: string): void {
    useIncomeStore.getState().markQueueItemFailed(localId, error);
  },

  setSyncing(value: boolean): void {
    useIncomeStore.getState().setSyncing(value);
  },

  setLastSyncedAt(iso: string): void {
    useIncomeStore.getState().setLastSyncedAt(iso);
  },
};
