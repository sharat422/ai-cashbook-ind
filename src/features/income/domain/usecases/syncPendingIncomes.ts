import type {IncomeRepository} from '../repository';

/**
 * Use case: flush the offline queue. Safe to call repeatedly (e.g. on every
 * reconnect) — the repository no-ops when the queue is empty.
 */
export function syncPendingIncomesUseCase(repo: IncomeRepository) {
  return () => repo.syncPending();
}
