/** Domain entities for the Reports feature. Pure data + types. */

export interface CategoryAmount {
  category: string;
  amount: number;
  /** Fraction of the total this category represents (0..1). */
  share: number;
}

/** Profit & Loss + category breakdown over a date range. */
export interface ReportSummary {
  from: string;
  to: string;
  incomeTotal: number;
  expenseTotal: number;
  profit: number;
  incomeCount: number;
  expenseCount: number;
  incomeByCategory: CategoryAmount[];
  expenseByCategory: CategoryAmount[];
  /** `remote` (backend) or `local` (computed on-device when offline). */
  source: 'remote' | 'local';
}

export function isReportEmpty(r: ReportSummary): boolean {
  return r.incomeTotal === 0 && r.expenseTotal === 0;
}

/** A flat transaction line used by the full-history exports. */
export interface ReportTxn {
  type: 'income' | 'expense';
  /** ISO date (YYYY-MM-DD). */
  date: string;
  category: string;
  /** Vendor/payee for expenses; empty for income. */
  party: string;
  amount: number;
  notes: string;
}
