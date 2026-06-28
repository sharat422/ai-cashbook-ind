/**
 * Domain entities for the Khata (executive) Dashboard. Pure types.
 */

export interface KhataDefaulter {
  customerId: string;
  name: string;
  amount: number;
  daysOverdue: number;
}

/** One point on the payment-trend chart. */
export interface TrendPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  collected: number;
  billed: number;
}

export interface KhataSummary {
  totalReceivable: number;
  totalPayable: number;
  overdueAmount: number;
  todayCollections: number;
  topDefaulters: KhataDefaulter[];
  trend: TrendPoint[];
  /** Where the figures came from. */
  source: 'remote' | 'local';
}

/** All filters applied to the dashboard query. */
export interface KhataFilters {
  /** Inclusive ISO date range. */
  from: string;
  to: string;
  /** Branch id, or 'all'. */
  branch: string;
  /** Business id, or 'all'. */
  business: string;
}

export function isKhataEmpty(summary: KhataSummary): boolean {
  return (
    summary.totalReceivable === 0 &&
    summary.totalPayable === 0 &&
    summary.todayCollections === 0 &&
    summary.topDefaulters.length === 0 &&
    summary.trend.every(p => p.collected === 0 && p.billed === 0)
  );
}
