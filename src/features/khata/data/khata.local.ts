import type {
  KhataFilters,
  KhataSummary,
  TrendPoint,
} from '@features/khata/domain/entities';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {toISODate} from '@utils/date';

const DAY = 86_400_000;
const MAX_POINTS = 30;

/** Build the inclusive date list for the range (capped to the last N days). */
function dateRange(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const total = Math.floor((end - start) / DAY) + 1;
  const count = Math.min(total, MAX_POINTS);
  const first = end - (count - 1) * DAY;
  return Array.from({length: count}, (_, i) => toISODate(new Date(first + i * DAY)));
}

const sumByDate = (entries: {amount: number; date: string}[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const e of entries) map.set(e.date, (map.get(e.date) ?? 0) + e.amount);
  return map;
};

/**
 * Offline fallback. Receivables/payables/overdue/defaulters live across all
 * customers on the server, so they're unavailable offline (0/empty). The
 * payment trend and today's collections are computed on-device from the income
 * (collected) and expense (billed) stores.
 */
export const khataLocal = {
  computeSummary(filters: KhataFilters): KhataSummary {
    const collected = sumByDate(useIncomeStore.getState().entries);
    const billed = sumByDate(useExpenseStore.getState().entries);
    const today = toISODate(new Date());

    const trend: TrendPoint[] = dateRange(filters.from, filters.to).map(date => ({
      date,
      collected: collected.get(date) ?? 0,
      billed: billed.get(date) ?? 0,
    }));

    return {
      totalReceivable: 0,
      totalPayable: 0,
      overdueAmount: 0,
      todayCollections: collected.get(today) ?? 0,
      topDefaulters: [],
      trend,
      source: 'local',
    };
  },
};
