import {connectivity} from '@/services/network/connectivity';
import type {Income, IncomeDraft} from '@features/income/domain/entities';
import type {
  IncomeRepository,
  PendingIncome,
} from '@features/income/domain/repository';
import {incomeLocal} from './income.local';
import {incomeRemote} from './income.remote';

/** Generate a unique, stable client id for idempotent retries. */
function makeLocalId(): string {
  return `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pendingToEntry(pending: PendingIncome): Income {
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
 * - Online  : POST to FastAPI, store the synced entry.
 * - Offline : enqueue the draft + show an optimistic `pending` entry. The sync
 *             manager flushes the queue when connectivity returns.
 */
export const incomeRepository: IncomeRepository = {
  async create(draft: IncomeDraft): Promise<Income> {
    const localId = makeLocalId();
    const createdAt = new Date().toISOString();
    const online = await connectivity.isOnline();

    if (online) {
      try {
        const income = await incomeRemote.create(draft, localId);
        incomeLocal.addEntry(income);
        return income;
      } catch {
        // Network blipped mid-request — fall through to the offline path so the
        // entry is never lost.
      }
    }

    const pending: PendingIncome = {localId, draft, createdAt, retryCount: 0};
    incomeLocal.enqueue(pending);
    const optimistic = pendingToEntry(pending);
    incomeLocal.addEntry(optimistic);
    return optimistic;
  },

  getPending(): PendingIncome[] {
    return incomeLocal.getQueue();
  },

  async syncPending(): Promise<{synced: number; failed: number}> {
    const queue = incomeLocal.getQueue();
    if (queue.length === 0) return {synced: 0, failed: 0};
    if (!(await connectivity.isOnline())) return {synced: 0, failed: 0};

    incomeLocal.setSyncing(true);
    let synced = 0;
    let failed = 0;

    try {
      for (const item of queue) {
        try {
          const income = await incomeRemote.create(item.draft, item.localId);
          // Swap the optimistic entry for the server-confirmed one.
          incomeLocal.replaceEntry(item.localId, income);
          incomeLocal.removeFromQueue(item.localId);
          synced += 1;
        } catch (err) {
          incomeLocal.markFailed(
            item.localId,
            err instanceof Error ? err.message : 'Sync failed',
          );
          failed += 1;
        }
      }
    } finally {
      incomeLocal.setSyncing(false);
      incomeLocal.setLastSyncedAt(new Date().toISOString());
    }

    return {synced, failed};
  },
};
