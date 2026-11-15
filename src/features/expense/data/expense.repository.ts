import {NetworkError, WeakSignalError} from '@api/client';
import {singleFlight} from '@utils/singleFlight';
import {connectivity} from '@/services/network/connectivity';
import type {Expense, ExpenseDraft} from '@features/expense/domain/entities';
import type {
  ExpenseRepository,
  PendingExpense,
} from '@features/expense/domain/repository';
import {expenseLocal} from './expense.local';
import {expenseRemote} from './expense.remote';

/** Generate a unique, stable client id for idempotent retries. */
function makeLocalId(): string {
  return `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pendingToEntry(pending: PendingExpense): Expense {
  return {
    ...pending.draft,
    id: pending.localId,
    createdAt: pending.createdAt,
    syncStatus: 'pending',
  };
}

/**
 * Concrete repository wiring remote + local data sources and connectivity —
 * the same as income:
 *
 * - Online  : POST to FastAPI, store the synced entry.
 * - Offline : enqueue the draft + show an optimistic `pending` entry. The sync
 *             manager flushes the queue when connectivity returns.
 *
 * (Expenses used to always queue first and rely on a background sync, so an
 * expense could sit "waiting to sync" while an income saved at once.)
 */
export const expenseRepository: ExpenseRepository = {
  async create(draft: ExpenseDraft): Promise<Expense> {
    const localId = makeLocalId();
    const createdAt = new Date().toISOString();
    let weakSignal = false;
    try {
      await connectivity.beforeSave();
      const expense = await expenseRemote.create(draft, localId);
      expenseLocal.addEntry(expense);
      return expense;
    } catch (err) {
      // Offline, weak signal, or the network blipped mid-request: fall through
      // to the offline path so the entry is never lost.
      weakSignal = err instanceof WeakSignalError;
    }

    const pending: PendingExpense = {localId, draft, createdAt, retryCount: 0, ...(weakSignal ? {weakSignal} : {})};

    expenseLocal.enqueue(pending);
    const optimistic = pendingToEntry(pending);
    expenseLocal.addEntry(optimistic);
    return optimistic;
  },

  getPending(): PendingExpense[] {
    return expenseLocal.getQueue();
  },

  syncPending: singleFlight(async (): Promise<{synced: number; failed: number}> => {
    const queue = expenseLocal.getQueue();
    if (queue.length === 0) return {synced: 0, failed: 0};
    if (!(await connectivity.isOnline())) return {synced: 0, failed: 0};

    expenseLocal.setSyncing(true);
    let synced = 0;
    let failed = 0;

    try {
      for (const item of queue) {
        try {
          const expense = await expenseRemote.create(item.draft, item.localId);
          // Swap the optimistic entry for the server-confirmed one.
          expenseLocal.replaceEntry(item.localId, expense);
          expenseLocal.removeFromQueue(item.localId);
          synced += 1;
        } catch (err) {
          // Offline again: stop and keep the rest as pending (not "failed").
          if (err instanceof NetworkError) break;
          expenseLocal.markFailed(
            item.localId,
            err instanceof Error ? err.message : 'Sync failed',
          );
          expenseLocal.setEntryStatus(item.localId, 'failed');
          failed += 1;
        }
      }
    } finally {
      expenseLocal.setSyncing(false);
      expenseLocal.setLastSyncedAt(new Date().toISOString());
    }

    return {synced, failed};
  }),
};
