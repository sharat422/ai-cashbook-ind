/** Counts of what the account has stored in the cloud, from GET /restore/summary. */
export interface RestoreSummary {
  incomes: number;
  expenses: number;
  customers: number;
  ledgerEntries: number;
  /** income + expense entries (the unified transaction feed). */
  transactions: number;
  /** Everything combined — 0 means there's nothing to restore. */
  total: number;
}

import type {TKey} from '@/i18n';

/** Progress emitted while a restore runs, so the UI can show a live bar. */
export interface RestoreProgress {
  /** Steps completed so far. */
  completed: number;
  /** Total steps in this restore. */
  total: number;
  /** i18n key describing the current step (e.g. 'restore.stepIncome'). */
  labelKey: TKey;
}
