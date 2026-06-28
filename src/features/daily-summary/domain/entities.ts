/**
 * Domain entities for the Daily Summary Engine. Pure types — no framework
 * imports.
 */

/** An expense category total with its share of the day's total expense. */
export interface CategoryTotal {
  category: string;
  amount: number;
  /** Fraction of the day's total expense, 0..1. */
  share: number;
}

/** The generated end-of-day summary. */
export interface DailySummary {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  income: number;
  expense: number;
  /** income − expense (may be negative). */
  profit: number;
  transactionCount: number;
  /** Highest-spend categories first. */
  topExpenseCategories: CategoryTotal[];
  /** Whether the figures came from the backend or were computed on-device. */
  source: 'remote' | 'local';
}

/** True when there was no activity at all that day. */
export function isSummaryEmpty(summary: DailySummary): boolean {
  return (
    summary.income === 0 &&
    summary.expense === 0 &&
    summary.transactionCount === 0
  );
}
