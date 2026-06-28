import type {Income, IncomeDraft} from './entities';

/** A draft queued locally because it couldn't be sent yet. */
export interface PendingIncome {
  /** Client-generated id used to de-duplicate on the server. */
  localId: string;
  draft: IncomeDraft;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

/**
 * Repository interface — the contract the domain layer depends on. The data
 * layer provides the implementation (remote + local + connectivity). Use cases
 * never import concrete data sources, only this interface.
 */
export interface IncomeRepository {
  /**
   * Create an income entry. When online it posts to the backend; when offline
   * it queues the draft locally and returns an optimistic `pending` entry.
   */
  create(draft: IncomeDraft): Promise<Income>;

  /** Drafts waiting to be synced. */
  getPending(): PendingIncome[];

  /** Push every queued draft to the backend; returns how many synced. */
  syncPending(): Promise<{synced: number; failed: number}>;
}
