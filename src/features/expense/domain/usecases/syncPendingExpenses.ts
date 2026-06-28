import type {ExpenseRepository} from '../repository';

/**
 * Use case: flush the offline queue. Safe to call repeatedly (e.g. on every
 * reconnect or right after an optimistic create) — the repository no-ops when
 * the queue is empty or the device is offline.
 */
export function syncPendingExpensesUseCase(repo: ExpenseRepository) {
  return () => repo.syncPending();
}
