/**
 * Domain entities for the Dashboard feature. Pure data + types, no framework
 * imports — the innermost layer of the feature's clean architecture.
 */

/** Aggregated figures shown by the dashboard widgets. All amounts in whole INR. */
export interface DashboardSummary {
  /** Income recorded today. */
  todayIncome: number;
  /** Expenses recorded today. */
  todayExpense: number;
  /** Running cash balance (all income − all expense). */
  cashBalance: number;
  /** Income recorded in the current calendar month. */
  monthRevenue: number;
  /** Expenses recorded in the current calendar month. */
  monthExpense: number;
  /** Server timestamp the figures were computed at (ISO). */
  asOf: string;
  /**
   * Where the figures came from: `remote` (backend) or `local` (computed
   * on-device from stored entries when the backend is unreachable).
   */
  source: 'remote' | 'local';
}

/** True when there is no recorded activity at all (drives the empty state). */
export function isSummaryEmpty(summary: DashboardSummary): boolean {
  return (
    summary.todayIncome === 0 &&
    summary.todayExpense === 0 &&
    summary.cashBalance === 0 &&
    summary.monthRevenue === 0 &&
    summary.monthExpense === 0
  );
}
