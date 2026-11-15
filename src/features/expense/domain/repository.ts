import type {Expense, ExpenseDraft} from './entities';

/** A draft queued locally because it hasn't been confirmed by the server yet. */
export interface PendingExpense {
  /** Client-generated id used to de-duplicate on the server. */
  localId: string;
  draft: ExpenseDraft;
  createdAt: string;
  retryCount: number;
  lastError?: string;
  /** Queued because the server didn't answer in time, not because the phone was offline (IM2). */
  weakSignal?: boolean;
}

/**
 * Repository contract the domain depends on. The data layer provides the
 * implementation (remote + local + connectivity); use cases never import
 * concrete data sources, only this interface.
 */
export interface ExpenseRepository {
  /**
   * Create an expense: saved on the server when it can be reached; otherwise
   * queued with an optimistic `pending` entry, flushed later by `syncPending`.
   */
  create(draft: ExpenseDraft): Promise<Expense>;

  /** Drafts waiting to be synced. */
  getPending(): PendingExpense[];

  /** Push every queued draft to the backend; returns how many synced/failed. */
  syncPending(): Promise<{synced: number; failed: number}>;
}
