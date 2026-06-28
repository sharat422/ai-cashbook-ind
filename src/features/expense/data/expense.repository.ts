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
 * Concrete repository wiring remote + local data sources and connectivity.
 *
 * Offline-first + optimistic: `create` ALWAYS inserts a `pending` entry and
 * queues the draft immediately, returning without awaiting the network. The
 * UI updates instantly; `syncPending` reconciles each entry against the server
 * (replacing it with the synced version, or flagging it `failed` to retry).
 */
export const expenseRepository: ExpenseRepository = {
  async create(draft: ExpenseDraft): Promise<Expense> {
    const localId = makeLocalId();
    const createdAt = new Date().toISOString();
    const pending: PendingExpense = {localId, draft, createdAt, retryCount: 0};

    expenseLocal.enqueue(pending);
    const optimistic = pendingToEntry(pending);
    expenseLocal.addEntry(optimistic);
    return optimistic;
  },

  getPending(): PendingExpense[] {
    return expenseLocal.getQueue();
  },

  async syncPending(): Promise<{synced: number; failed: number}> {
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
  },
};
