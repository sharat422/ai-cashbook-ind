import type {Expense, ExpenseDraft} from './entities';

/** A draft queued locally because it hasn't been confirmed by the server yet. */
export interface PendingExpense {
  /** Client-generated id used to de-duplicate on the server. */
  localId: string;
  draft: ExpenseDraft;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

/**
 * Repository contract the domain depends on. The data layer provides the
 * implementation (remote + local + connectivity); use cases never import
 * concrete data sources, only this interface.
 */
export interface ExpenseRepository {
  /**
   * Create an expense. Offline-first + optimistic: always inserts an optimistic
   * `pending` entry immediately and queues it, returning without waiting on the
   * network. The queue is flushed by `syncPending`.
   */
  create(draft: ExpenseDraft): Promise<Expense>;

  /** Drafts waiting to be synced. */
  getPending(): PendingExpense[];

  /** Push every queued draft to the backend; returns how many synced/failed. */
  syncPending(): Promise<{synced: number; failed: number}>;
}
